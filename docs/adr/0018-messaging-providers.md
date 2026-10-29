# ADR 0018: Messaging providers: Resend for email, Twilio Verify behind a flag

- Status: accepted
- Date: 2026-10-11
- Owner: Alexis Zazueta

## Context

The admin needs a daily email with pending items and retention warnings. SMS verification of the WhatsApp number exists in the prototype behind a flag that is off, and must stay available without becoming a launch dependency. Cloudflare's own email sending service exists but the team already standardised on Resend.

## Decision

Resend sends the daily email from the `enmirumbo.com` domain (SPF and DKIM records in Cloudflare DNS) to the admin mailboxes configured per locality (amended by ADR 0021: the panel users who may review registrations in that locality); non-production environments send only to team mailboxes. Twilio Verify handles the SMS code when the flag is on, with per-IP and per-number quotas because each SMS costs money; with the flag off no Twilio credential is required and the registration flow is identical to the prototype's.

## Consequences

Two more processors named in the privacy notice. The Twilio account can be created when the flag is first needed.

Amended on 2026-10-29 (EMR-55) by decision of the product owner: Resend's HTTP batch API sends the locality's counts-only summary at 08:00 local time, from `enmirumbo <avisos@enmirumbo.com>` with Reply-To `contacto@enmirumbo.com` (verified domain in `us-east-1`). Recipients are active users with `businesses.review` in the locality, through the database access rules, with no configured recipient list. Outside production reserved test/example/invalid domains and the three `example.com/net/org` domains are skipped and counted; this replaces the earlier “team mailboxes” restriction. The Worker secret `RESEND_API_KEY` belongs to each GitHub Environment. One row per locality keeps an immutable pending batch for the stable environment/locality/day idempotency key, cleared on success; retries stop after 23 hours and stay on the same local day. No email is sent when there is nothing to report. The deployment specification defines the content and five-request bound.
