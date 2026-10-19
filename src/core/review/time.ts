// The clock of the panel (docs/specs/admin-review.md, "Visible indicator for
// registrations waiting more than 48 hours" and "Dates in the panel use the
// time zone of the locality (v2)"): how long something has waited, whether it
// is past the goal of answering within 48 hours (PRD §10), and every date the
// panel writes, in the IANA time zone of the card's locality, never the
// server's. Pure: the moment "now" is always passed in.

/** The operational goal: answer each case in under 48 hours. */
export const REVIEW_GOAL_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;

/** Whether something that entered the queue at `since` has waited more than 48 hours by `now`. */
export function isOverdue(since: Date, now: Date): boolean {
  return now.getTime() - since.getTime() > REVIEW_GOAL_HOURS * HOUR_MS;
}

/**
 * How long something has waited, in words: hours up to the goal, the unit
 * the admin works in, and days past it, so nobody reads "Hace 213 horas"
 * (the prototype's copy). The queue and the reports of a detail use it.
 */
export function waitText(since: Date, now: Date): string {
  const hours = Math.floor(Math.max(0, now.getTime() - since.getTime()) / HOUR_MS);
  if (hours < 1) return "Hace menos de una hora";
  if (hours === 1) return "Hace 1 hora";
  if (hours < REVIEW_GOAL_HOURS) return `Hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Hace 1 día" : `Hace ${days} días`;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const timeFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(timeZone: string): Intl.DateTimeFormat {
  let format = dateFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("es-MX", {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    dateFormats.set(timeZone, format);
  }
  return format;
}

function timeFormat(timeZone: string): Intl.DateTimeFormat {
  let format = timeFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("es-MX", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    timeFormats.set(timeZone, format);
  }
  return format;
}

/** The local day of `at` in `timeZone`, written in full: "3 de septiembre de 2026". */
export function panelDate(at: Date, timeZone: string): string {
  return dateFormat(timeZone).format(at);
}

/** The local day and time of `at` in `timeZone`: "3 de septiembre de 2026, 14:05". */
export function panelDateTime(at: Date, timeZone: string): string {
  return `${panelDate(at, timeZone)}, ${timeFormat(timeZone).format(at)}`;
}
