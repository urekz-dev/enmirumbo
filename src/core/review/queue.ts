// The review queue, the panel's main screen (docs/specs/admin-review.md,
// "Review queue with the pending registrations, oldest first", "Visible
// indicator for registrations waiting more than 48 hours" and "The queue
// tells which businesses have unattended reports").
//
// "Registros por revisar" lists two things together, from the one that has
// waited longest to the newest:
//
// - "Alta nueva": every card in `in_review`. It entered the queue at the
//   later of its registration (a resubmission restarts `registered_at`) and
//   its last unpublishing: a card published for months and unpublished today
//   has waited since today. When the unpublishing is the later, the row says
//   "Ya estaba publicada, la despublicaste". The unpublishing trace is never
//   cleared, so an old one never moves a card that was resubmitted after it.
// - "Edición": every pending edit of a card that is not in the queue itself,
//   since the moment its owner sent it; a newer edit supersedes it and so
//   restarts the clock. A card in `in_review` takes one row only, as "Alta
//   nueva": its pending edit keeps waiting and comes back as "Edición" once
//   the card is published again.
//
// The same clock orders the rows, writes their wait and decides the marker
// past 48 hours. Published and rejected cards never enter by themselves,
// and applied, discarded or superseded edits never do.
//
// "Negocios reportados" lists the cards with at least one pending report,
// from the one whose oldest unattended report is the oldest, whatever their
// status; it never changes "Registros por revisar".
//
// Each part reads only the localities its permission allows (./scope.ts).
// The queue is the pending work of the people of a few localities: tens of
// rows, read whole, never in pages. Nothing here is written to a log.
//
// Binding: HYPERDRIVE_FRESH, as all of the panel.
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { ShowsZone } from "../catalogue/zone-names.ts";
import type { Db } from "../db/client.ts";
import { businesses, localities, pendingEdits, reports, zones } from "../db/schema/index.ts";
import { isOverdue } from "./time.ts";

export type QueueRowKind = "registration" | "edit";

export interface QueueRow extends ShowsZone {
  kind: QueueRowKind;
  businessId: string;
  /** The pending edit of an "Edición" row; null for "Alta nueva". */
  editId: number | null;
  localityCode: string;
  timeZone: string;
  /** The card's name, as it is now. */
  name: string;
  /** When it entered the queue: the clock of its order, its wait and its marker. */
  since: Date;
  /** Waiting for more than 48 hours. */
  overdue: boolean;
  /** An "Alta nueva" that entered the queue because the admin unpublished it. */
  unpublished: boolean;
}

/** The localities where the user sees each kind of row. */
export interface QueueScope {
  review: readonly string[];
  edits: readonly string[];
}

/** The catalogue zone of the card, or the free text of "Otra". */
const zoneColumns = {
  zoneSlug: zones.slug,
  zoneName: sql<string | null>`coalesce(${zones.name}, nullif(btrim(${businesses.zoneOther}), ''))`,
};

/**
 * Whether a card went back to review because the admin unpublished it: its
 * last unpublishing is later than its registration or resubmission. The list
 * marks it with the same condition.
 */
export function cameFromUnpublishing(registeredAt: Date, unpublishedAt: Date | null): boolean {
  return unpublishedAt !== null && unpublishedAt > registeredAt;
}

/** When a card in review entered the queue: the later of its registration and its last unpublishing. */
export function enteredQueueAt(registeredAt: Date, unpublishedAt: Date | null): Date {
  return unpublishedAt !== null && cameFromUnpublishing(registeredAt, unpublishedAt)
    ? unpublishedAt
    : registeredAt;
}

/** "Registros por revisar", oldest first, as of `now`. */
export async function reviewQueue(db: Db, scope: QueueScope, now: Date): Promise<QueueRow[]> {
  const registrations =
    scope.review.length === 0
      ? []
      : await db
          .select({
            businessId: businesses.id,
            localityCode: businesses.localityCode,
            timeZone: localities.timeZone,
            name: businesses.name,
            registeredAt: businesses.registeredAt,
            unpublishedAt: businesses.unpublishedAt,
            ...zoneColumns,
          })
          .from(businesses)
          .innerJoin(localities, eq(localities.code, businesses.localityCode))
          .leftJoin(zones, eq(zones.id, businesses.zoneId))
          .where(
            and(
              eq(businesses.status, "in_review"),
              inArray(businesses.localityCode, [...scope.review]),
            ),
          );
  const edits =
    scope.edits.length === 0
      ? []
      : await db
          .select({
            editId: pendingEdits.id,
            businessId: businesses.id,
            localityCode: businesses.localityCode,
            timeZone: localities.timeZone,
            name: businesses.name,
            createdAt: pendingEdits.createdAt,
            ...zoneColumns,
          })
          .from(pendingEdits)
          .innerJoin(businesses, eq(businesses.id, pendingEdits.businessId))
          .innerJoin(localities, eq(localities.code, businesses.localityCode))
          .leftJoin(zones, eq(zones.id, businesses.zoneId))
          .where(
            and(
              eq(pendingEdits.status, "pending"),
              // One row per business: a card in the queue itself is
              // resolved first, and its edit waits.
              ne(businesses.status, "in_review"),
              inArray(businesses.localityCode, [...scope.edits]),
            ),
          );

  const rows: QueueRow[] = [
    ...registrations.map(({ registeredAt, unpublishedAt, ...row }) => {
      const since = enteredQueueAt(registeredAt, unpublishedAt);
      return {
        ...row,
        kind: "registration" as const,
        editId: null,
        since,
        overdue: isOverdue(since, now),
        unpublished: cameFromUnpublishing(registeredAt, unpublishedAt),
      };
    }),
    ...edits.map(({ createdAt, ...row }) => ({
      ...row,
      kind: "edit" as const,
      since: createdAt,
      overdue: isOverdue(createdAt, now),
      unpublished: false,
    })),
  ];
  return rows.sort(
    (a, b) =>
      a.since.getTime() - b.since.getTime() ||
      a.businessId.localeCompare(b.businessId) ||
      (a.editId ?? 0) - (b.editId ?? 0),
  );
}

/** How many rows wait past the goal. */
export function overdueCount(rows: readonly QueueRow[]): number {
  return rows.filter((row) => row.overdue).length;
}

/** A card with unattended reports. */
export interface ReportedBusiness {
  businessId: string;
  localityCode: string;
  name: string;
  /** Its pending reports. */
  pending: number;
}

/**
 * "Negocios reportados": the cards of `localityCodes` with at least one
 * pending report, from the one whose oldest pending report is the oldest.
 */
export async function reportedBusinesses(
  db: Db,
  localityCodes: readonly string[],
): Promise<ReportedBusiness[]> {
  if (localityCodes.length === 0) return [];
  return db
    .select({
      businessId: businesses.id,
      localityCode: businesses.localityCode,
      name: businesses.name,
      pending: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(reports)
    .innerJoin(businesses, eq(businesses.id, reports.businessId))
    .where(and(eq(reports.status, "pending"), inArray(reports.localityCode, [...localityCodes])))
    .groupBy(businesses.id)
    .orderBy(sql`min(${reports.createdAt})`, asc(businesses.id));
}
