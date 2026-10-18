// Fixed-window counters, kept in memory and nowhere else (docs/specs/
// deployment.md, "Anti-abuse counters live in a Durable Object and never in
// PostgreSQL (v2)"). The quota counter (src/lib/quota/counter.ts), one
// Durable Object for every purpose, holds one of these, keyed by the codes it
// makes from each purpose and IP address; this module only counts, with the
// time passed in, so it is tested without waiting. Everything here is pure: no
// database, no clock, no storage.
import type { Quota } from "./quotas.ts";

/** The answer of a quota: go on, or wait until the window ends. */
export type QuotaDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Counter {
  count: number;
  /** When the window ends, in milliseconds since the epoch. */
  endsAt: number;
}

/**
 * Counters past this number, of every purpose together, make room by dropping
 * the oldest. A flood of distinct addresses can then only make the quotas
 * forget some of them, never block more people or exhaust the memory of the
 * Durable Object.
 */
export const MAX_COUNTERS = 100_000;

export class FixedWindowCounters {
  readonly #counters = new Map<string, Counter>();
  readonly #capacity: number;

  constructor(capacity: number = MAX_COUNTERS) {
    this.#capacity = capacity;
  }

  /**
   * Counts one request of `key` at `now` and says whether it is within
   * `quota`. The check and the count are one synchronous step, so requests
   * that arrive at the same time are counted one by one. A request over the
   * quota is not counted, and the window does not move: it ends when it
   * would have ended.
   */
  take(key: string, quota: Quota, now: number): QuotaDecision {
    let counter = this.#counters.get(key);
    if (counter === undefined || counter.endsAt <= now) {
      this.#counters.delete(key);
      if (this.#counters.size >= this.#capacity) this.#dropOldest();
      counter = { count: 0, endsAt: now + quota.windowSeconds * 1000 };
      this.#counters.set(key, counter);
    }
    if (counter.count >= quota.limit) {
      return { allowed: false, retryAfterSeconds: Math.ceil((counter.endsAt - now) / 1000) };
    }
    counter.count += 1;
    return { allowed: true };
  }

  /** Deletes every counter whose window ended at `now` or before. */
  sweep(now: number): void {
    for (const [key, counter] of this.#counters) {
      if (counter.endsAt <= now) this.#counters.delete(key);
    }
  }

  /** When the next window ends, or null when there is no counter. */
  nextEnd(): number | null {
    let next: number | null = null;
    for (const { endsAt } of this.#counters.values()) {
      if (next === null || endsAt < next) next = endsAt;
    }
    return next;
  }

  /** How many counters are kept. */
  get size(): number {
    return this.#counters.size;
  }

  /** The keys kept, for the tests that check what a key looks like. */
  keys(): string[] {
    return [...this.#counters.keys()];
  }

  /** The oldest counter is the first inserted: a renewed window is inserted again. */
  #dropOldest(): void {
    const oldest = this.#counters.keys().next();
    if (!oldest.done) this.#counters.delete(oldest.value);
  }
}
