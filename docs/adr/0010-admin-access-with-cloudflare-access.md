# ADR 0010: Admin access through Cloudflare Access with one-time codes by email

- Status: accepted
- Date: 2026-10-11
- Owner: Alexis Zazueta

## Context

The prototype protected the panel with a single environment password and a signed session, and the founder asked for a second factor and an audit log that names who acted. Five people will operate the panel. The team's mailboxes are on Zoho, which offers no identity provider for Access; GitHub was considered and rejected by the founder. Access sends a signed JWT to the origin in the `Cf-Access-Jwt-Assertion` header. The Workers runtime has an Access identity helper, but Workers with Static Assets, like this one, do not receive it.

## Decision

One self-hosted application in Cloudflare Access (Zero Trust free plan, up to 50 users) protects `/admin` with three destinations, one per hostname: `https://dev.enmirumbo.com`, `https://stage.enmirumbo.com` and production's `https://enmirumbo.urekz.workers.dev` until H4 (ADR 0008). Login is a one-time code sent by email; the policy lists the five team mailboxes explicitly; sessions last 24 hours. On every `/admin` request the Worker verifies the JWT with `jose` against the team's JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), checking the issuer and the application's AUD tag, and reads the email claim for the audit log. A request without a valid token gets 403, even if it reached the Worker without passing through Access. The application has no login form, password, session cookie or second factor of its own. Locally, a fixed identity is injected only when the environment variable says `local`; deployed environments never accept it, and a test proves it.

## Consequences

The second factor is the mailbox itself, which the team protects with two-factor authentication. The login page is the only screen that is not one to one with the prototype. Team domain and AUD tag are per-environment variables. The requirements of the prototype's `revision-admin` specification about passwords, sessions and the IP hash of login attempts are replaced by requirements about the Access identity.

Amended on 2026-10-29 (EMR-63) by decision of the product owner: the Access destinations for `dev` and `stage` are `dev.enmirumbo.com` and `stage.enmirumbo.com`; production remains at its `workers.dev` URL until H4.
