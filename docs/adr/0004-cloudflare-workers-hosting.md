# ADR 0004: Hosting on Cloudflare Workers with Static Assets

- Status: accepted
- Date: 2026-10-11
- Owner: Alexis Zazueta

## Context

Cloudflare is the team's platform for domains, DNS and edge. Cloudflare Pages is in maintenance mode and lacks Cron Triggers and Workers Logs. Containers need the paid plan, start in one to three seconds, cannot preview branches and reach bindings only over HTTP. Workers Free allows 10 ms of CPU per request and 100,000 requests per day; Cloudflare states that server-rendered workloads use 10 to 20 ms.

## Decision

The application runs as a Cloudflare Worker with Static Assets through `@astrojs/cloudflare`, with a custom entry that also exports the `scheduled` handler for cron jobs. Prerendered pages are served as static assets without invoking the Worker. We use Workers Free while building and switch to Workers Paid (5 USD per month) at public launch. Observability through Workers Logs (amended on 2026-10-18: Workers Logs and traces are off; debugging uses `wrangler tail`).

Amended on 2026-10-18 (EMR-43), by decision of the product owner: Workers Logs and traces are off in every environment, declared in `wrangler.jsonc` with every key written. An invocation log keeps the URL and the metadata of each request for days, and the address of the edit mode of the management link is the key to a card; the privacy notice also keeps the visitor's address in memory only. Debugging a deployed environment uses `wrangler tail`, which is live and keeps nothing; alerts reach the admin by email (EMR-55).

## Consequences

No servers to operate and the same platform for DNS, storage, access control and anti-bot. The CPU limit of the free plan can throttle heavy pages before launch; we measure on `stage`. Anything that needs a Linux runtime (image processing, database dumps) runs elsewhere: Cloudflare Images for photos, GitHub Actions for dumps.
