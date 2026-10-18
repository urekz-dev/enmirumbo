// The per-IP quotas of the site (ADR 0012; docs/specs/deployment.md,
// "Anti-abuse counters live in a Durable Object and never in PostgreSQL
// (v2)"). Each purpose counts apart in the one quota counter, so exhausting
// one never affects another, and has its own limit: at most `limit` requests
// from one IP address in a fixed window of `windowSeconds`, which starts with
// the first request. The purposes are this fixed list, each named as a literal
// by the page or the action that takes it, and never built from a request
// (test/scripts/quota-guardrails.test.ts). A purpose arrives with the surface
// it protects: the search, the report form and the registration form have
// theirs; the edit (EMR-43) and the SMS add theirs here.

export interface Quota {
  /** Requests allowed in one window. */
  limit: number;
  /** How long a window lasts: at most an hour, since the IP is kept less than one. */
  windowSeconds: number;
}

/** The longest window: the privacy notice keeps the IP's code less than an hour. */
export const MAX_WINDOW_SECONDS = 60 * 60;

export const QUOTAS = {
  // public-directory, "The search endpoint has a per-IP quota (v2)": enough
  // for a resident who corrects a search and pages through its results, and
  // for the neighbours who share one address behind their carrier, but not
  // for a script that walks the directory one query after another.
  search: { limit: 100, windowSeconds: 10 * 60 },
  // public-directory, "Report anti-abuse without captcha: honeypot, per-IP
  // quota and pending cap per business" and "The report's per-IP quota is
  // counted in the quota counter (v2)": 3 reports an hour from one address.
  report: { limit: 3, windowSeconds: 60 * 60 },
  // business-registration, "The registration's honeypot and per-IP quota are
  // those of the public forms (v2)": 3 registrations an hour from one
  // address, resubmissions included.
  registration: { limit: 3, windowSeconds: 60 * 60 },
} as const satisfies Record<string, Quota>;

/** What a quota protects. */
export type QuotaPurpose = keyof typeof QUOTAS;

/** Whether `value` names a quota, for a counter that receives it from outside. */
export function isQuotaPurpose(value: string): value is QuotaPurpose {
  return Object.hasOwn(QUOTAS, value);
}
