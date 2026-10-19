# enmirumbo v2 — Product Requirements

- Status: draft for review
- Date: 2026-10-11
- Owner: Alexis Zazueta (interim product owner; the role is confirmed in the team's roles meeting)

This document is the map of the rebuild. The blueprint is the set of seven functional specifications inherited from the prototype (168 requirements and 751 scenarios), which move into the new repository as `docs/specs/`. When this document and a specification disagree, the specification wins on behaviour and this document wins on intent. Technical decisions live in `docs/adr/`. The one-page brief lives in Plane ("Product Overview"); this document expands it and does not replace it.

## 1. What enmirumbo is

enmirumbo is a hyperlocal web directory. Businesses register themselves from a phone without creating an account, a person verifies each one before it is published, and residents find them and contact them directly through WhatsApp. The first and only locality at launch is Tizayuca, Hidalgo.

The advantage is not the listing. It is trust, because every published card went through a human conversation, and immediacy, because everything ends in WhatsApp.

Version 2 is a rewrite from scratch of the prototype at `SoyJorgePilo/enmirumbo` (ADR 0002). It keeps the functionality and the user interface one to one, changes the whole stack and the way of working, and prepares the data model for more localities without launching any.

## 2. Business principles (not negotiable)

Any implementation must keep these, in order of importance.

1. **No accounts or passwords for the public.** Businesses manage their card with a secret link received by WhatsApp when approved. The only protected area is the admin panel, and its access is provided by Cloudflare Access with a one-time code by email, not by a password of our own.
2. **Registering and appearing is free, always.** Future monetisation never charges the basic card nor the resident.
3. **Human verification before publishing.** Nothing is published on its own. The admin contacts the business by WhatsApp and approves or rejects with a reason. SMS verification exists behind a flag that is off at launch, and even when on it only marks "number confirmed"; it never replaces the human approval.
4. **WhatsApp is the channel.** The main button of every card opens WhatsApp with a prefilled message. Call, directions and Facebook are secondary.
5. **Structural honesty.** The system never lies: if configuration is missing it fails visibly, if it deletes it deletes for real (files before rows, a partial deletion is reported as failed), and if a legal text changes its version goes up and re-acceptance is requested.
6. **Colloquial Mexican Spanish in every UI text.** "Registra tu negocio gratis", never "Crear listado".
7. **Mobile first for real.** Designed at 390 px; desktop is an adaptation. Visible content in under two seconds on 4G.
8. **No star ratings.** The quality mechanism is the "Reportar" button plus human verification.
9. **Privacy as a promise we can keep (LFPDPPP).** Data is never sold or shared; analytics use no cookies and identify nobody.

## 3. Users and flows

- **Flow A, the business registers.** One-screen form: name, category, ten-digit WhatsApp, zone, "what do you offer", plus optional landline, address or references, free-text hours, Facebook and one photo. Consent checkbox with the simplified privacy notice visible and its version recorded. On submit the business enters review and sees the thank-you screen. Anti-abuse: per-IP quotas, honeypot, Turnstile in managed mode, and a daily threshold that alerts the admin.
- **Flow B, the resident finds.** Home with search box, the eight categories as large buttons and the "Deporte en {municipio}" block. Search by name and by the words of "what do you offer". Listings by category and by category plus zone with clean indexable URLs. Card with the "Negocio verificado" seal and the WhatsApp button as the main action. Empty states always offer a way out.
- **Flows C and D, the business manages itself.** The approval message carries the management link (a 256-bit token; only its SHA-256 fingerprint is stored). The link opens the prefilled form; changes never touch the public card, they create a pending revision for the admin. "Perdí mi enlace" opens WhatsApp to the admin. Regenerating the link invalidates the previous one.
- **Flow E, the admin operates.** Review queue (new registrations, edits and resubmissions, one row per business, a marker after 48 hours), list of all businesses with filters and pagination, resident reports, and the detail with the actions: approve (generates the link and the prefilled WhatsApp messages), reject with a reason, unpublish, delete permanently, regenerate the link, attend reports, apply or discard edits, and, new in v2, edit any card with the registration form and send the business a copy of its data by WhatsApp (access and rectification rights). Everything works from a phone.
- **Flow F, the locality (new in v2).** Every public URL names the state and the municipality; there is no short alias such as `/tizayuca` (decision of 2026-10-14). While there is one active locality the root redirects to it. When there are two or more, the root shows the list of localities with the nearest one highlighted from the visitor's approximate location, never redirecting automatically; the choice is stored in a cookie that holds only the locality slug, and later visits to the root honour it.

## 4. Lifecycle rules

- States of a business: `in_review` → `published` or `rejected`; `published` can return to `in_review` when unpublished, with its own marker in the queue.
- A rejected business can resubmit with corrections; the resubmission re-accepts the current notice version.
- Rejected registrations are deleted permanently after 90 days. Pending revisions that were applied, discarded or superseded, and registrations never verified, are deleted after 30 days; the daily email to the admin lists what expires in the next seven days.
- Permanent deletion removes everything: photos first, then rows and revisions in cascade. A deletion that cannot complete says so.
- Operational goal: review pending items within 48 hours. The panel shows the marker and a daily email lists the pending items.
- Every destructive or irreversible admin action is written to the audit log with who, when, which card and the previous state: reject, unpublish, delete, purge, and edits to contact data. Nothing else is logged.

## 5. Brand and copy

- The brand is **enmirumbo**, one word, always lowercase, also at the start of a sentence or in a title. The compound "enmirumbo Tizayuca" is forbidden; a test guards it.
- When context is needed: "enmirumbo, el directorio de negocios de {municipio}", only on first mention in long texts.
- The footer line is fixed and parametrised: "Hecho para los vecinos de {municipio}, {estado}."
- Prefilled message from resident to business: "Hola, te vi en enmirumbo. ¿Me das informes?"
- WhatsApp green is the action colour and is used only for the main action.
- Every text that names the locality reads it from the locality record; no locality name is hard-coded.

## 6. Commitments that look technical but are business

1. **The site works without JavaScript**, with one exception: the registration and edit forms require it for the anti-bot check and say so plainly when it is missing. Listings, filters, pagination, search, legal pages and the whole admin panel work with server HTML.
2. **Under two seconds on 4G**, measured with Lighthouse on mobile.
3. **Local SEO**: clean URLs by category and category plus zone, LocalBusiness structured data, sitemap, and Open Graph previews worth sharing on WhatsApp.
4. **Analytics without cookies or personal data** (Umami Cloud). Two events, WhatsApp click from a listing card and WhatsApp click from a card, each with locality and category; searches with no results tag their page view; the registration funnel is the views of the registration page and its thank-you page (ADR 0014, amended on 2026-10-15 and 2026-10-18). The admin panel and the management-link screens are outside measurement.
5. **SMS verification behind a flag**, off at launch. With the flag on, registration asks for a code sent to the WhatsApp number; with it off, the flow is identical to today.
6. **Secrets never in the repository**, which is public. Management tokens never in clear in the database or in analytics.
7. **No third-party JavaScript** except the analytics script and the Turnstile widget, under a strict content security policy.
8. **Photos leave the device as they are and are stored stripped**: resized to two sizes, converted to WebP and without metadata, served from a dedicated hostname per environment.

## 7. Legal commitments (LFPDPPP)

The published privacy notice is a contract. What it promises, the system does.

- Only the data the business knows will be public is published; the simplified notice says it before consent.
- The visitor's IP address is used for quotas for less than one hour, only in memory and as a keyed hash; it is never written to the database. The notice says so in those words, subject to legal review.
- The notice names the processors: Cloudflare (hosting, storage, access control, anti-bot check), Neon (database), Twilio (SMS verification, only when the flag is on), Resend (email to the admin) and Umami (analytics). It also references Cloudflare's Turnstile privacy addendum.
- Rights of access, rectification, cancellation and opposition are served from the panel: unpublish and delete already exist; in v2 the admin can also edit any card and send the business a copy of its data by WhatsApp. Committed response time: 20 working days.
- The notice is versioned with a cryptographic fingerprint. Changing the text requires a new version; who accepted an earlier version keeps that evidence. Version 2 goes with the rebuild because the text changes.
- Honest placeholders: while the legal responsible party (legal name, address, jurisdiction) is missing, the legal pages show a visible draft mark. They are never filled with invented data.
- Retention: rejected 90 days, pending revisions and unverified registrations 30 days.
- Cookies: one functional cookie with the chosen locality slug, and the Cloudflare Access cookie only on the admin panel. No cookie banner is needed; the notice lists both.
- Contact for data matters: `contacto@enmirumbo.com` (to confirm against the Zoho mailboxes).
- Pending human task before launch: professional legal review of both texts.

## 8. What changes from the prototype

| Area                   | Prototype                                                                                          | v2                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Localities             | Tizayuca hard-coded in texts, catalogues and URLs                                                  | Locality as a first-class record keyed by the INEGI municipality code; zones from the SEPOMEX postal catalogue; categories global; one admin with a locality filter hidden while there is one |
| URLs                   | `/plomeria-haciendas-de-tizayuca`                                                                  | `/hidalgo/tizayuca/plomeria-haciendas-de-tizayuca`; root and `/tizayuca` redirect while there is one locality                                                                                 |
| Geolocation            | none                                                                                               | Suggestion of the nearest locality on the root page when there are two or more; never an automatic redirect                                                                                   |
| Admin access           | Environment password and signed session                                                            | Cloudflare Access with one-time code by email; the identity feeds the audit log                                                                                                               |
| Audit log              | none                                                                                               | Destructive admin actions logged with who, when, card and previous state                                                                                                                      |
| Retention              | Rejected purged at 90 days; pending edits kept forever                                             | Pending revisions and unverified registrations purged at 30 days with a reminder                                                                                                              |
| Anti-bot               | Honeypot and per-IP quotas                                                                         | Plus Turnstile in managed mode, with a kill switch                                                                                                                                            |
| Search flood           | none                                                                                               | Per-IP quota on the search endpoint                                                                                                                                                           |
| Rights handling        | Delete and unpublish from the panel; access and rectification by hand                              | Access and rectification from the panel                                                                                                                                                       |
| Analytics              | Umami with page views                                                                              | Umami with two product events and a tag for searches with no results                                                                                                                          |
| Photos                 | sharp on the server, bucket on Supabase                                                            | Transformed on upload with Cloudflare Images, stored in R2, served from a dedicated hostname                                                                                                  |
| Minor debt             | Legal pages missing from the sitemap, report routes indexable, heading jumps, phone auto-detection | Fixed as part of the corresponding stories                                                                                                                                                    |
| Backups and monitoring | External daily backup documented, no monitoring                                                    | Nightly dump to a private bucket with 30-day retention; an availability check every 30 minutes                                                                                                |

## 9. Out of scope

Everything in the prototype's PRD §6.6 stays out: automatic verification as a substitute for human review, user accounts, payments, reviews and ratings, orders or bookings, native app, multiple branches per business, and launching other cities. Also out of v2: a metrics view of our own, a city chooser in the UI while there is one locality, and the structured opening hours.

## 10. Success metrics

From the brief: at least 50 active businesses and at least 200 WhatsApp contacts per month for two consecutive months. The prototype's 60-day thresholds remain as operating guidance: 50 published businesses, at least 15 organic registrations, more than 70 % of registrations completed without help, publication within 48 hours, WhatsApp clicks over card views above 15 %, 300 weekly unique visitors. Each card records its origin (seeded or organic) at approval so the metrics can be separated.

## 11. Launch criteria (version 1.0.0)

1. Every scenario of the seven specifications, with the v2 amendments, is covered by tests and green in CI.
2. The professional legal review of the privacy notice and the terms is done and the responsible party is filled in.
3. Accounts exist with a custodian recorded: Cloudflare (zone, Workers, R2, Access, Turnstile), Neon, Resend, Umami Cloud, Twilio (may wait for the flag). Secrets live in the GitHub Environments (ADR 0020).
4. DNS of enmirumbo.com is served by Cloudflare; the registrar transfer may happen later.
5. Backups and the availability check are running against production.
6. The cut-over plan is written: tag 1.0.0, production deploy, DNS switch from the Vercel prototype, archive the prototype repository, delete the Vercel and Supabase projects.

## 12. Risks

- **The rebuild takes longer than the team's appetite.** Mitigation: the backlog is split into bets that each close a usable surface; nothing is launched until parity is complete, but each bet is verifiable on `stage`.
- **Parity drift.** Mitigation: the specifications are the contract and the tests map to their scenarios; the UI is compared screen by screen against the prototype before each epic closes.
- **Free-plan limits** (10 ms CPU per request on Workers Free, Neon compute hours shared across branches, Hyperdrive configurations). Mitigation: Workers Paid from public launch; the rest is measured on `stage` before the cut-over.
- **Legal framework still settling.** Mitigation: placeholders and the human review before launch.
- **Dependence on the admin.** Mitigation: the 48-hour marker and the daily email; any of the five team members can operate the panel.

## 13. Related documents

- Functional specifications: `docs/specs/` (seven capabilities, OpenSpec requirement and scenario format, English with UI copy quoted in Spanish).
- Technical decisions: `docs/adr/0002` to `docs/adr/0019`.
- Work: Plane project EMR, epics EMR-5 (A · Foundations of v2) to EMR-12 (H · Launch).
- Brief: Plane, Project Page "Product Overview", mirrored in `docs/product-brief.md`.
