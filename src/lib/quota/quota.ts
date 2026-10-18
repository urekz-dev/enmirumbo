// How a page or an action asks for a per-IP quota (ADR 0012; docs/specs/
// deployment.md, "Anti-abuse counters live in a Durable Object and never in
// PostgreSQL (v2)"): `takeQuota(env, request.headers, "search")` counts the
// request for its purpose in the quota counter (src/lib/quota/counter.ts) and
// says whether it may go on. Each purpose and its limit are in QUOTAS
// (src/core/quota/quotas.ts), and the purpose is written as a literal where
// it is taken.
//
// Every purpose reaches one single instance of the counter, named
// QUOTA_COUNTER_NAME: the purpose is part of the code of each counter, so each
// purpose still counts apart, with its own limit and window. One object awake
// all day stays under the daily duration of Workers Free and inside what
// Workers Paid includes in a month; a Durable Object per visitor, address,
// user or purpose would not (ADR 0012, amended on 2026-10-15). The binding is
// never addressed by any other name (test/scripts/quota-guardrails.test.ts).
//
// The address is the one Cloudflare puts in `CF-Connecting-IP`, which a
// visitor cannot set: Cloudflare writes it on every request that reaches the
// Worker. Without it (only possible on this machine) nothing is counted. The
// address is passed on in memory and never stored or logged. When the counter
// cannot answer, the request goes on: a quota may fail to count, but it never
// turns into an error page.
import type { QuotaPurpose } from "../../core/quota/quotas.ts";
import { quotaSubject } from "../../core/quota/subject.ts";
import type { QuotaDecision } from "../../core/quota/window.ts";

/** The header where Cloudflare writes the address of the visitor. */
export const CLIENT_IP_HEADER = "CF-Connecting-IP";

/** The name of the one instance of the quota counter, for every purpose. */
export const QUOTA_COUNTER_NAME = "quotas";

export type { QuotaDecision };

/** Counts one request from the address of `headers` for `purpose`. */
export async function takeQuota(
  env: Pick<Env, "QUOTA_COUNTER">,
  headers: Headers,
  purpose: QuotaPurpose,
): Promise<QuotaDecision> {
  const subject = quotaSubject(headers.get(CLIENT_IP_HEADER));
  if (subject === null) return { allowed: true };
  try {
    return await env.QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME).take(purpose, subject);
  } catch (error) {
    // The error comes from the runtime, never with the address in it.
    console.error(
      `quota: the counter did not answer for "${purpose}"; the request was not counted`,
      error,
    );
    return { allowed: true };
  }
}

/**
 * The headers of an answer over the quota: when to try again, and never
 * stored, since it depends on the visitor.
 */
export function overQuotaHeaders(decision: { retryAfterSeconds: number }): Record<string, string> {
  return {
    "Retry-After": String(Math.max(1, decision.retryAfterSeconds)),
    "Cache-Control": "no-store",
  };
}
