import { and, eq, sql } from "drizzle-orm";
import { can } from "../access/queries.ts";
import type { Db } from "../db/client.ts";
import { failureKind } from "../db/failure.ts";
import { dailyAdminEmailState, users } from "../db/schema/index.ts";
import type { PhotoFolder } from "../photos/photo.ts";
import { dailyEmailText, dailySummary, hasDailyNews, reservedEmailDomain } from "./summary.ts";

/** One locality's immutable batch; each recipient gets a separate email. */
export interface DailyEmailBatch {
  idempotencyKey: string;
  recipients: string[];
  subject: string;
  text: string;
}

/** All recipients come from access rules; no role name or configured address list. */
export async function dailyRecipients(
  db: Db,
  locality: string,
  environment: string,
): Promise<{ recipients: string[]; skipped: number }> {
  const active = await db.select({ email: users.email }).from(users).where(eq(users.active, true));
  const recipients: string[] = [];
  let skipped = 0;
  for (const { email } of active) {
    if (!(await can(db, email, "businesses.review", locality))) continue;
    if (environment !== "prod" && reservedEmailDomain(email)) skipped += 1;
    else recipients.push(email);
  }
  return { recipients: recipients.sort(), skipped };
}

export const DAILY_EMAIL_LOCAL_HOUR = 8;
export const MAX_DAILY_EMAIL_BATCHES_PER_RUN = 5;
export const MAX_DAILY_EMAIL_RECIPIENTS = 100;
export const DAILY_EMAIL_RETRY_MS = 23 * 60 * 60 * 1000;

export interface DailyEmailOptions {
  environment: string;
  scope: { base: string | null; folder: PhotoFolder };
  links: (locality: string) => { queue: string; businesses: string };
  send: (batch: DailyEmailBatch) => Promise<boolean>;
  dryRun?: boolean;
  // The real request clock bounds Resend's idempotency lifetime, even for a
  // manual run whose selected scheduled instant differs from the wall clock.
  wallClock?: () => Date;
}

export interface DailyEmailCounts extends Record<string, number> {
  sent: number;
  emails: number;
  skipped: number;
  empty: number;
  previewed: number;
  failed: number;
  deferred: number;
}

/**
 * A durable immutable batch is committed before the external call. Its row
 * lock serializes senders; Resend's key closes the send/commit crash window.
 * Repeated runs cannot change the payload of a timed-out request. No provider
 * error is propagated: callers fail the run using these counts alone.
 */
export async function runDailyAdminEmail(
  db: Db,
  now: Date,
  options: DailyEmailOptions,
): Promise<DailyEmailCounts> {
  const counts: DailyEmailCounts = {
    sent: 0,
    emails: 0,
    skipped: 0,
    empty: 0,
    previewed: 0,
    failed: 0,
    deferred: 0,
  };
  const clock = options.wallClock ?? (() => new Date());
  const at = now.toISOString();
  const { rows: due } = await db.execute<{ code: string; name: string; day: string }>(sql`
    select l.code, m.name, to_char((${at}::timestamptz at time zone l.time_zone)::date, 'YYYY-MM-DD') as day
    from localities l join municipalities m on m.code = l.code
    left join daily_admin_email_state s on s.locality_code = l.code
    where l.active and (
      (extract(hour from ${at}::timestamptz at time zone l.time_zone) = ${DAILY_EMAIL_LOCAL_HOUR}
        and (s.locality_code is null or s.environment <> ${options.environment}
          or s.day < (${at}::timestamptz at time zone l.time_zone)::date))
      or (s.environment = ${options.environment} and not s.completed
        and s.day = (${at}::timestamptz at time zone l.time_zone)::date
        and extract(hour from ${at}::timestamptz at time zone l.time_zone) >= ${DAILY_EMAIL_LOCAL_HOUR})
    )
    order by s.first_attempt_at nulls first, l.code
  `);
  let batches = 0;
  for (const locality of due) {
    try {
      const selected = await dailyRecipients(db, locality.code, options.environment);
      counts.skipped += selected.skipped;
      // Preparation is its own transaction. ON CONFLICT preserves a concurrent
      // winner's snapshot and never rewinds a completed or later local day.
      const summary = await dailySummary(db, locality.code, now, options.scope);
      const news = hasDailyNews(summary);
      if (selected.recipients.length > MAX_DAILY_EMAIL_RECIPIENTS) {
        counts.failed += 1;
        continue;
      }
      if (options.dryRun) {
        if (news) {
          dailyEmailText(summary, locality.name, locality.day, options.links(locality.code));
          counts.previewed += 1;
        } else counts.empty += 1;
        continue;
      }
      const batch: DailyEmailBatch | null =
        news && selected.recipients.length > 0
          ? {
              idempotencyKey: `daily-admin-email/${options.environment}/${locality.code}/${locality.day}`,
              recipients: selected.recipients,
              subject: `enmirumbo: pendientes de ${locality.name} (${locality.day})`,
              text: dailyEmailText(
                summary,
                locality.name,
                locality.day,
                options.links(locality.code),
              ),
            }
          : null;
      await db
        .insert(dailyAdminEmailState)
        .values({
          localityCode: locality.code,
          environment: options.environment,
          day: locality.day,
          firstAttemptAt: clock(),
          completed: batch === null,
          batch,
        })
        .onConflictDoUpdate({
          target: dailyAdminEmailState.localityCode,
          set: {
            environment: options.environment,
            day: locality.day,
            firstAttemptAt: clock(),
            completed: batch === null,
            batch,
          },
          setWhere: sql`${dailyAdminEmailState.environment} <> ${options.environment}
          or ${dailyAdminEmailState.day} < ${locality.day}::date`,
        });
      await db.transaction(async (tx) => {
        const [state] = await tx
          .select()
          .from(dailyAdminEmailState)
          .where(eq(dailyAdminEmailState.localityCode, locality.code))
          .for("update");
        if (!state || state.environment !== options.environment || state.day !== locality.day)
          return;
        if (state.completed || !state.batch) {
          if (batch === null) counts.empty += 1;
          return;
        }
        // Never deliver to someone deactivated or deprived of review access
        // since the snapshot. Changing the body would break idempotency.
        const current = await dailyRecipients(tx, locality.code, options.environment);
        if (
          state.batch.recipients.some((email) => !current.recipients.includes(email)) ||
          clock().getTime() - state.firstAttemptAt.getTime() >= DAILY_EMAIL_RETRY_MS
        ) {
          counts.failed += 1;
          return;
        }
        if (batches >= MAX_DAILY_EMAIL_BATCHES_PER_RUN) {
          counts.deferred += 1;
          return;
        }
        batches += 1;
        let sent = false;
        try {
          sent = await options.send(state.batch);
        } catch {
          /* Counts only. */
        }
        if (!sent) {
          counts.failed += 1;
          return;
        }
        await tx
          .update(dailyAdminEmailState)
          .set({ completed: true, batch: null })
          .where(
            and(
              eq(dailyAdminEmailState.localityCode, locality.code),
              eq(dailyAdminEmailState.day, locality.day),
            ),
          );
        counts.sent += 1;
        counts.emails += state.batch.recipients.length;
      });
    } catch (error) {
      console.error(
        `daily email: a locality could not be prepared or sent (${failureKind(error)})`,
      );
      counts.failed += 1;
    }
  }
  return counts;
}
