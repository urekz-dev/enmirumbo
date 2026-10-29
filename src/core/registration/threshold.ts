// The daily registrations alert (ADR 0012, ADR 0013; docs/specs/
// business-registration.md, "The daily registrations alert goes out once per
// local day (v2)"), a task of the hourly job (src/scheduled.ts). It blocks
// nobody: it only tells the admin that a locality received more
// registrations in one of its days than its threshold, which can be a wave of
// fake ones.
//
// - The day is the locality's local day, in its IANA time zone, up to the
//   moment the job was scheduled for. The registrations are the organic
//   businesses whose `registered_at` falls in it: new cards and resubmitted
//   ones, whose wait restarts. A card the admin creates is not one.
// - The threshold is the locality's `daily_registration_threshold`, 20 by
//   default; none disables the alert.
// - Once a day per locality: the alert is claimed by writing the day to
//   `daily_registration_alerted_on`, in the same statement that finds it, and
//   only a locality whose last alert is from an earlier day is claimed. So
//   the runs of the rest of the day, a run repeated, two runs at once and a
//   run after a missed one all alert at most once, and the first run after
//   the threshold is passed alerts, whichever hour it is.
//
// The channel is a structured line in the Worker log, by
// `logRegistrationThresholdAlert`: the locality's code, its day, the count
// and the threshold, never anything about a business or a person. The email
// to the admin reads this state and the previous local day's counts at 08:00.
//
// Binding: HYPERDRIVE_FRESH, since it writes.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";

/** One locality past its threshold in one of its days. */
export interface RegistrationThresholdAlert {
  /** The INEGI code of the locality. */
  locality: string;
  /** The locality's local day, `YYYY-MM-DD`. */
  day: string;
  /** The registrations of that day up to the run. */
  registrations: number;
  threshold: number;
}

/** The immediate alert channel; the daily email reads its state the next morning. */
export type RegistrationThresholdChannel = (alert: RegistrationThresholdAlert) => Promise<void>;

/**
 * Finds every active locality whose registrations of its local day, up to
 * `now`, are more than its threshold and that was not alerted that day yet,
 * and claims each one for that day. Each is returned once per local day.
 */
export async function claimRegistrationThresholdAlerts(
  db: Db,
  now: Date,
): Promise<RegistrationThresholdAlert[]> {
  const at = now.toISOString();
  const { rows } = await db.execute<{
    locality: string;
    day: string;
    registrations: number;
    threshold: number;
  }>(sql`
    with today as (
      select
        l.code,
        l.daily_registration_threshold as threshold,
        (${at}::timestamptz at time zone l.time_zone)::date as day,
        (
          select count(*)::int from businesses b
          where b.locality_code = l.code
            and b.origin = 'organic'
            and b.registered_at >= (
              ((${at}::timestamptz at time zone l.time_zone)::date)::timestamp at time zone l.time_zone
            )
            and b.registered_at <= ${at}::timestamptz
        ) as registrations
      from localities l
      where l.active and l.daily_registration_threshold is not null
    )
    update localities as l
    set daily_registration_alerted_on = today.day,
      daily_registration_alert_snapshots = jsonb_build_array(jsonb_build_object(
        'day', today.day::text, 'registrations', today.registrations, 'threshold', today.threshold
      )) || coalesce((
        select jsonb_agg(snapshot) from jsonb_array_elements(
          coalesce(l.daily_registration_alert_snapshots, '[]'::jsonb)
        ) snapshot where snapshot->>'day' = (today.day - 1)::text
      ), '[]'::jsonb)
    from today
    where l.code = today.code
      and today.registrations > today.threshold
      and (l.daily_registration_alerted_on is null or l.daily_registration_alerted_on < today.day)
    returning
      l.code as locality,
      to_char(today.day, 'YYYY-MM-DD') as day,
      today.registrations,
      today.threshold
  `);
  return rows
    .map(({ locality, day, registrations, threshold }) => ({
      locality,
      day,
      registrations: Number(registrations),
      threshold: Number(threshold),
    }))
    .sort((a, b) => a.locality.localeCompare(b.locality));
}

/** The immediate alert channel: one structured line in the log. */
export async function logRegistrationThresholdAlert(
  alert: RegistrationThresholdAlert,
): Promise<void> {
  console.warn({
    message: "registration: the daily registrations of a locality passed its threshold",
    alert: "daily-registrations",
    ...alert,
  });
}

/** The task of the hourly job: claims the alerts due at `now` and sends each one. */
export async function runRegistrationThresholdTask(
  db: Db,
  now: Date,
  send: RegistrationThresholdChannel = logRegistrationThresholdAlert,
): Promise<{ alerts: number }> {
  const alerts = await claimRegistrationThresholdAlerts(db, now);
  for (const alert of alerts) await send(alert);
  return { alerts: alerts.length };
}
