# ADR 0013: Scheduled jobs on one hourly Cron Trigger per environment

- Status: accepted
- Date: 2026-10-11
- Owner: Alexis Zazueta

## Context

Workers Free allows five Cron Triggers per account. The scheduled work is: the daily pending-items email to the admin, the purge of rejected registrations at 90 days, the purge of pending revisions and unverified registrations at 30 days, the orphan-photo sweep, and the daily registrations threshold alert. Localities carry an IANA time zone and may differ in the future.

## Decision

Each deployed environment has exactly one Cron Trigger that fires every hour. The `scheduled` handler runs every task, and each task decides by the local hour of each locality whether it is its turn (for example, the pending-items email at 8:00 local). Tasks are idempotent and log what they did and what they could not do.

## Consequences

Two triggers in total for `stage` and production, well under the limit. Adding a locality in another time zone changes nothing. The `dev` environment does not need a trigger; tasks can be run from a test-only route there.

Amended on 2026-10-18 (EMR-48): one more task, the retry of the purges of the media hostname's cache that failed (ADR 0011), which runs every hour whatever the local hour and fails the run while a purge keeps failing.
