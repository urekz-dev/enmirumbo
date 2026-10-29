// Counts only: no query selects a card's captured fields, identifier or photo key.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import type { PhotoFolder } from "../photos/photo.ts";
import { REJECTED_RETENTION_DAYS } from "../review/deletion.ts";
import { RESOLVED_EDIT_RETENTION_DAYS } from "../review/purge.ts";

export interface DailySummary {
  registrations: number;
  resubmissions: number;
  edits: number;
  reports: number;
  overdue: number;
  expiringCards: number;
  expiringEdits: number;
  expiredCards: number;
  expiredEdits: number;
  cachePurges: number;
  staleSweep: number;
  alertRegistrations: number;
  alertThreshold: number;
}

/** Retention dates use the same local calendar days as the purge. */
export async function dailySummary(
  db: Db,
  locality: string,
  now: Date,
  scope: { base: string | null; folder: PhotoFolder },
): Promise<DailySummary> {
  const at = now.toISOString();
  const { rows } = await db.execute<Record<keyof DailySummary, number>>(sql`
    with clock as (
      select code, time_zone, daily_registration_threshold as threshold,
        daily_registration_alerted_on as alerted, daily_registration_alert_snapshots as snapshots,
        (${at}::timestamptz at time zone time_zone)::date as day
      from localities where code = ${locality}
    ), waiting as (
      select greatest(registered_at, unpublished_at) as since,
        previous_rejected_at is not null and
          (unpublished_at is null or unpublished_at <= registered_at) as resubmitted
      from businesses where locality_code = ${locality} and status = 'in_review'
    ), card_terms as (
      select (rejected_at at time zone c.time_zone)::date + ${REJECTED_RETENTION_DAYS}::int as due
      from businesses b, clock c
      where b.locality_code = c.code and b.status = 'rejected' and b.rejected_at is not null
    ), edit_terms as (
      select (resolved_at at time zone c.time_zone)::date + ${RESOLVED_EDIT_RETENTION_DAYS}::int as due
      from pending_edits e, clock c
      where e.locality_code = c.code and e.status <> 'pending' and e.resolved_at is not null
    )
    select
      (select count(*)::int from waiting where not resubmitted) as registrations,
      (select count(*)::int from waiting where resubmitted) as resubmissions,
      (select count(*)::int from pending_edits where locality_code = c.code and status = 'pending') as edits,
      (select count(*)::int from reports where locality_code = c.code and status = 'pending') as reports,
      ((select count(*) from waiting where since < ${at}::timestamptz - interval '48 hours') +
       (select count(*) from pending_edits where locality_code = c.code and status = 'pending'
          and created_at < ${at}::timestamptz - interval '48 hours') +
       (select count(*) from reports where locality_code = c.code and status = 'pending'
          and created_at < ${at}::timestamptz - interval '48 hours'))::int as overdue,
      (select count(*)::int from card_terms where due > c.day and due <= c.day + 7) as "expiringCards",
      (select count(*)::int from edit_terms where due > c.day and due <= c.day + 7) as "expiringEdits",
      (select count(*)::int from card_terms where due <= c.day) as "expiredCards",
      (select count(*)::int from edit_terms where due <= c.day) as "expiredEdits",
      (select count(*)::int from photo_cache_purges where
        ${scope.base}::text is not null and starts_with(url, ${`${scope.base}/${scope.folder}`})) as "cachePurges",
      (select count(*)::int from orphan_photo_sweep_state where
        coalesce(photo_folder, 'photos/') = ${scope.folder}
        and started_at < ${at}::timestamptz - interval '24 hours') as "staleSweep",
      coalesce((select (snapshot->>'registrations')::int from jsonb_array_elements(coalesce(c.snapshots, '[]'::jsonb)) snapshot
        where snapshot->>'day' = (c.day - 1)::text limit 1), case when c.alerted = c.day - 1 then
        (select count(*)::int from businesses b where b.locality_code = c.code and b.origin = 'organic'
          and (b.registered_at at time zone c.time_zone)::date = c.day - 1)
        else 0 end) as "alertRegistrations",
      coalesce((select (snapshot->>'threshold')::int from jsonb_array_elements(coalesce(c.snapshots, '[]'::jsonb)) snapshot
        where snapshot->>'day' = (c.day - 1)::text limit 1),
        case when c.alerted = c.day - 1 then coalesce(c.threshold, 0) else 0 end) as "alertThreshold"
    from clock c
  `);
  return rows[0]!;
}

export function hasDailyNews(summary: DailySummary): boolean {
  return Object.values(summary).some((count) => count > 0);
}

/** Plain text avoids HTML interpolation and sends only counts and panel links. */
export function dailyEmailText(
  summary: DailySummary,
  localityName: string,
  day: string,
  links: { queue: string; businesses: string },
): string {
  return [
    `Esto hay por revisar en ${localityName} (${day}):`,
    "",
    `Registros por revisar: ${summary.registrations}`,
    `Reenvíos: ${summary.resubmissions}`,
    `Ediciones pendientes: ${summary.edits}`,
    `Reportes sin atender: ${summary.reports}`,
    `Pendientes con más de 48 horas: ${summary.overdue}`,
    "",
    "En los próximos 7 días se borrarán:",
    `Registros rechazados que cumplen 90 días: ${summary.expiringCards}`,
    `Ediciones resueltas que cumplen 30 días: ${summary.expiringEdits}`,
    "",
    "Las tareas todavía no pudieron terminar:",
    `Registros rechazados fuera de plazo: ${summary.expiredCards}`,
    `Ediciones resueltas fuera de plazo: ${summary.expiredEdits}`,
    `Direcciones de fotos con limpieza de caché pendiente: ${summary.cachePurges}`,
    `Revisiones de fotos sin terminar desde hace más de un día: ${summary.staleSweep}`,
    ...(summary.alertThreshold > 0
      ? [
          "",
          `Ayer se activó la alerta de registros: ${summary.alertRegistrations} registros; el límite es ${summary.alertThreshold}.`,
        ]
      : []),
    "",
    `Abre la cola de revisión: ${links.queue}`,
    `Todos los negocios: ${links.businesses}`,
  ].join("\n");
}

export function reservedEmailDomain(email: string): boolean {
  const domain = email
    .slice(email.lastIndexOf("@") + 1)
    .toLowerCase()
    .replace(/\.$/, "");
  return (
    /\.(test|example|invalid)$/.test(domain) ||
    /^(test|example|invalid|example\.(com|net|org))$/.test(domain)
  );
}
