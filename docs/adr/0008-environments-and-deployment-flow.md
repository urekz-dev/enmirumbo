# ADR 0008: Environments and deployment flow

- Status: accepted
- Date: 2026-10-11
- Owner: Alexis Zazueta

## Context

The team wants `dev.enmirumbo.com`, `stage.enmirumbo.com` and `enmirumbo.com`, and wants `dev` to be a single URL where any branch can be deployed by hand to look at it. The project is built in public, so previews need no protection beyond the admin panel. Wrangler environments create one Worker per environment, by default named `<name>-<env>`, with its own bindings, variables and secrets; bindings and variables are not inherited, while routes and triggers are. Custom Domains need exact hostnames, create their DNS record and certificate on first deploy, and fail when a record already exists on the hostname. Astro's Cloudflare adapter chooses the Wrangler environment at build time through `CLOUDFLARE_ENV`. The `enmirumbo.com` zone has been active on Cloudflare since 2026-10-29; its apex and `www` records still point to the Vercel prototype until H4. When `workers_dev` is on, Version URLs are on by default too, and a path-based Access application does not cover them.

## Decision

Four environments. The deployed ones are identified as `dev`, `stage` and `prod` everywhere: Wrangler environments, Neon branches and GitHub Environments (amended by ADR 0020). Local runs `astro dev` in workerd with PostgreSQL in Docker. `dev`: a Wrangler environment, deployed only by a manual GitHub Actions workflow (`workflow_dispatch`) where the person picks the branch; before deploying, the workflow resets the Neon `dev` branch from `stage`, applies the branch's migrations and seeds, and records branch and commit in the run summary and in the page footer. `stage`: deployed automatically on every merge to `main`. Production: deployed from a tag `vX.Y.Z` that also creates a GitHub Release; versions stay at 0.x until the cut-over, which is 1.0.0. Each environment sets its Worker name explicitly: `dev-enmirumbo`, `stage-enmirumbo` and `enmirumbo` for production. The `dev` and `stage` Workers use `dev.enmirumbo.com` and `stage.enmirumbo.com` as Custom Domains with `workers_dev` off. Production remains at `enmirumbo.urekz.workers.dev` with `workers_dev` on until H4 attaches the apex and `www`; `urekz` is the account's `workers.dev` subdomain.

Every deploy builds for its target with `CLOUDFLARE_ENV=<env>` and deploys with the project's own Wrangler; no artifact is promoted between environments. Routes and Cron Triggers are declared inside each environment block, never at the top level, so nothing is inherited by accident: `dev` and `stage` each declare one Custom Domain route matching their `SITE_URL`, production has no route until H4, and the hourly trigger exists only on `stage` and production. `preview_urls` is off in every environment, so no Version URL can bypass Access. No automatic previews per pull request. Non-production environments send `X-Robots-Tag: noindex` and a closed `robots.txt`, keep the admin behind Access, and use only fictional data. Absolute URLs, canonicals, Open Graph and the sitemap come from a per-environment site URL variable.

## Consequences

Two always-on Workers plus one that changes on demand; the Cron Trigger count stays within the free plan. Whatever is stored in `dev` is lost on the next deploy, by design. The first deploy of each environment needs a token allowed to create Workers; attaching the Custom Domains also needs permission on the zone. The shared links of `dev` and `stage` use their Custom Domains; production stays on `workers.dev` until H4. If two people compete for `dev`, Cloudflare Previews on `workers.dev` can be enabled later without changing this flow.

Amended on 2026-10-29 (EMR-63) by decision of the product owner: `enmirumbo.com` is active on Cloudflare. `dev` and `stage` use their Custom Domains with `workers_dev: false`; production keeps `workers_dev: true` and its `workers.dev` URL until H4 moves the apex and `www` to the Worker.
