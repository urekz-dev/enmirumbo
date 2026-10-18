# ADR 0012: Abuse controls with Durable Object quotas and Turnstile

- Status: accepted
- Date: 2026-10-11
- Owner: Alexis Zazueta

## Context

The privacy notice promises that the visitor's IP address is used for less than an hour, only in memory, never in the database. The admin verifies ten to fifteen cards per week, so fake registrations consume the scarcest resource. Cloudflare's Rate Limiting binding only supports 10- and 60-second windows and counts per location. Turnstile is free (20 widgets, 10 hostnames each, subdomains included) and in managed mode shows a checkbox only when Cloudflare is unsure.

## Decision

Per-IP quotas for registration, edits, reports, search and SMS live in a Durable Object keyed by an HMAC of the IP and the purpose (amended on 2026-10-15: one instance for every purpose, under rules that bound its cost); counters are deleted when their window ends and are never persisted to PostgreSQL. The registration and edit forms include Turnstile in managed mode; the Worker validates the token server-side and rejects submissions without a valid one. Turnstile is on from day one behind a kill switch so it can be turned off without a deploy if Cloudflare's challenge service fails or rejects legitimate people. The honeypot field stays.

Amended on 2026-10-15 (EMR-71), by decision of the product owner, after comparing the common rate-limiting patterns:

- The counters stay in the memory of a Durable Object: it is the only cheap option that is exact and keeps the privacy notice true as written. What changes is that a runaway bill becomes impossible by design. The Durable Object bills reported in public, of tens of thousands of dollars, came from alarms that schedule themselves again, often across many preview deployments, and from one object per key. Workers Free never bills: past one of its daily limits, further operations of that type fail with an error. On Workers Paid, duration is billed for 128 MB per object for as long as it is in memory and cannot hibernate, which a pending timer prevents, and the usage beyond what is included is rounded up to the next million GB-s, at 12.50 USD per million.
- One single instance serves every purpose: the search, the reports and, later, the forms. Its name is a constant (`QUOTA_COUNTER_NAME`), never one per visitor, address, user or purpose. The purpose stays part of the code of each counter, so each purpose still counts apart, with its own limit and window. One object awake all day uses 86,400 s × 128 MB, about 11,000 GB-s, under the 13,000 GB-s a day of Workers Free, so it can never reach that limit; two or more could, and then the counter would fail and the quotas would let every request through. The objects the first quotas created, one per purpose, hold nothing in their storage, so they are left behind and evicted; there is nothing to migrate.
- The rules, written in `AGENTS.md` and checked by automated tests on the source and on the running object (`test/scripts/quota-guardrails.test.ts`, `test/worker/quota.test.ts`): the purposes are a fixed list in `QUOTAS`, each taken with a literal; the name of the instance is that constant; the counter never uses its storage (`ctx.storage`); it sets no alarm (`setAlarm`, `alarm()`); its one timer exists only while at least one counter exists, each arming is at most `MAX_TIMER_MS` (10 minutes, under the 15 minutes for which a pending operation keeps a Durable Object from being evicted), and it is never set again once no counter remains; and `preview_urls` stays `false` at the top level and in every environment of `wrangler.jsonc`.
- The cost ceiling: 0 USD on Workers Free. On Workers Paid, at most one object awake all month: 30 days × 86,400 s × 128 MB = 331,776 GB-s (342,835 in a month of 31 days), inside the 400,000 GB-s a month included, so 0 USD in duration; requests (each counted request is one call to the object) have 1 million a month included and cost 0.15 USD per million beyond it. On Workers Free, past 100,000 requests to Durable Objects in a day the counter fails until 00:00 UTC, and the quotas let every request through until then, while the honeypot, Turnstile and the caps keep working. Figures from Cloudflare's Durable Objects pricing page (<https://developers.cloudflare.com/durable-objects/platform/pricing/>) and lifecycle page (<https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/>), read on 2026-10-18.

Amended on 2026-10-18 (EMR-42), by decision of the product owner:

- The kill switch lives in the database: a column of `site_settings`, a table of one row for the site's switches, on by default, changed with one SQL statement today and from the panel later. The action reads it uncached, so turning Turnstile off lets submissions through at once; the form page reads it through the cached Hyperdrive, so the widget disappears within a minute.
- Turnstile fails closed: a submission whose token Cloudflare's siteverify does not confirm within 3 seconds, for whatever reason, is refused with "No pudimos comprobar que eres una persona. Vuelve a intentarlo.", and the admin turns the switch off if Cloudflare is down. Siteverify receives the secret and the token only, never the visitor's address, so the privacy notice stays true as written.
- The test keys count only on the local Worker, where they are emulated without network; no deployed environment accepts the dummy token, and the deploy refuses a site key that is not a real one.
- The daily registrations threshold is a column of each locality, 20 by default. The hourly job alerts once per local day per locality, keeping the day of the last alert in the locality, and until the email to the admin arrives (EMR-55) the alert is a structured line in the Worker log.

## Consequences

The forms require JavaScript; the page says so when it is missing. The privacy notice references Cloudflare's Turnstile privacy addendum. The test keys allow local and CI runs without network.
