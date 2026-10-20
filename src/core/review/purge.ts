// The retention purges of the hourly job (ADR 0013; docs/specs/data-model.md,
// "Rejected registrations are permanently deleted after 90 days", "Applied,
// discarded and superseded pending edits are purged after 30 days (v2)" and
// "The scheduled purges report what they could not purge"; docs/specs/
// deployment.md, "Scheduled work runs from one hourly Cron Trigger per
// environment (v2)" and "Permanent deletion refuses to claim it deleted what
// it did not delete"). Two purges, run in this order on every run:
//
// 1. Rejected cards 90 days after their rejection: the panel's permanent
//    deletion (purgeRejectedCard, ./deletion.ts), photos first, with an entry
//    `purge` of the scheduled job in the audit log. A resubmission clears the
//    card's rejection and its status, so a resubmitted card is never one.
// 2. Applied, discarded and superseded pending edits 30 days after they were
//    resolved. Their rows go, and so does the new photo one still names when
//    no card names it, photos first. A discarded or superseded edit gave its
//    key up when it was resolved, and an applied one's photo is the card's:
//    the photo of an edit is only found here when something left it behind.
//    Edits write no entry in the audit log, which is the log of cards.
//
// The term counts local calendar days in the IANA time zone of the item's
// locality: an item is due from the first moment of the local day that is
// 90 (30) days after the local day of its rejection (resolution). The purges
// run every hour and need no local hour of their own: a run that cannot
// purge something leaves it for the next hour, and nothing is decided by the
// hour of the day.
//
// One run does a bounded amount of work, so it stays within a Worker's
// limits (Workers Free: 50 subrequests, and each photo deleted is a request
// to Cloudflare's cache API; the budget the hourly run shares among its tasks
// is written in src/scheduled.ts): at most MAX_CARDS_PER_RUN cards and
// MAX_EDITS_PER_RUN edits, and no new item once MAX_PHOTOS_PER_RUN photos
// were deleted. What is left waits for the next hour, oldest first. An item
// that failed also waits, and counts among those not purged; a stuck item
// keeps its place in the order, so the run fails every hour until someone
// looks at it, which is the point of failing.
//
// The report is counts only, as a task's report is (src/scheduled.ts): it is
// what the admin's daily email (EMR-55) can add to its text.
//
// Binding: HYPERDRIVE_FRESH.
import { and, asc, eq, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { failureKind } from "../db/failure.ts";
import { businesses, pendingEdits } from "../db/schema/index.ts";
import { isPhotoKey } from "../photos/photo.ts";
import { type MediaBucket, removePhoto } from "../photos/upload.ts";
import { purgeRejectedCard, REJECTED_RETENTION_DAYS, rejectionOlderThan } from "./deletion.ts";

/** The days after which a resolved pending edit is purged (PRD §4). */
export const RESOLVED_EDIT_RETENTION_DAYS = 30;

/** The most rejected cards one run purges. */
export const MAX_CARDS_PER_RUN = 20;

/** The most resolved edits one run purges. */
export const MAX_EDITS_PER_RUN = 20;

/** The photos after which a run starts no new item. */
export const MAX_PHOTOS_PER_RUN = 15;

/** What the purges did in one run, as counts. */
export interface RetentionPurgeReport extends Record<string, number> {
  cardsPurged: number;
  cardsNotPurged: number;
  editsPurged: number;
  editsNotPurged: number;
}

/** The limits of one run; tests narrow them. */
export interface RetentionPurgeLimits {
  cards: number;
  edits: number;
  photos: number;
}

const DEFAULT_LIMITS: RetentionPurgeLimits = {
  cards: MAX_CARDS_PER_RUN,
  edits: MAX_EDITS_PER_RUN,
  photos: MAX_PHOTOS_PER_RUN,
};

/** Whether the edit was resolved `days` local days ago or more at `at`, by its locality's time zone. */
function resolvedLongerThan(days: number, at: Date): SQL {
  const now = at.toISOString();
  return sql`exists (
    select 1 from localities l
    where l.code = ${pendingEdits.localityCode}
      and (${pendingEdits.resolvedAt} at time zone l.time_zone)::date
        <= (${now}::timestamptz at time zone l.time_zone)::date - ${days}::int
  )`;
}

/** An edit that is resolved and past its term. */
function purgeableEdit(at: Date): SQL {
  return and(
    ne(pendingEdits.status, "pending"),
    isNotNull(pendingEdits.resolvedAt),
    resolvedLongerThan(RESOLVED_EDIT_RETENTION_DAYS, at),
  )!;
}

type EditOutcome = "purged" | "not-due" | "failed";

/**
 * Purges one resolved edit past its term, and the new photo it still names
 * when no card does. It locks the card before the edit, as the owner's save
 * and the admin's decisions do, and keeps both locked while the photo goes,
 * so a card that takes the photo meanwhile waits and finds it deleted only if
 * nothing named it. The edit is checked again under the lock, and deleted
 * with one conditional write.
 */
async function purgeResolvedEdit(
  db: Db,
  editId: number,
  at: Date,
  bucket: MediaBucket,
): Promise<EditOutcome> {
  try {
    return await db.transaction(async (tx): Promise<EditOutcome> => {
      const [owner] = await tx
        .select({ businessId: pendingEdits.businessId })
        .from(pendingEdits)
        .where(eq(pendingEdits.id, editId));
      if (owner === undefined) return "not-due";
      const [card] = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(eq(businesses.id, owner.businessId))
        .for("update");
      if (card === undefined) return "not-due";

      const due = and(eq(pendingEdits.id, editId), purgeableEdit(at));
      const [edit] = await tx
        .select({ key: pendingEdits.newPhotoKey })
        .from(pendingEdits)
        .where(due)
        .for("update");
      if (edit === undefined) return "not-due";

      if (isPhotoKey(edit.key)) {
        const [named] = await tx
          .select({ id: businesses.id })
          .from(businesses)
          .where(eq(businesses.photoKey, edit.key))
          .limit(1);
        if (named === undefined) {
          const removal = await removePhoto(bucket, edit.key);
          if (removal.kind === "kept" || removal.cache === "failed") return "failed";
        }
      }

      const deleted = await tx.delete(pendingEdits).where(due).returning({ id: pendingEdits.id });
      return deleted.length === 0 ? "not-due" : "purged";
    });
  } catch (error) {
    console.error(`review: a resolved edit could not be purged (${failureKind(error)})`);
    return "failed";
  }
}

/** The bucket, counting the photos deleted through it. */
function countingBucket(bucket: MediaBucket): { bucket: MediaBucket; deleted: () => number } {
  let deleted = 0;
  return {
    bucket: {
      put: bucket.put.bind(bucket) as MediaBucket["put"],
      delete: (keys) => {
        deleted += 1;
        return bucket.delete(keys);
      },
      cache: bucket.cache,
    },
    deleted: () => deleted,
  };
}

/**
 * The purges of the rejected cards and of the resolved edits that are due at
 * `now` (the time the job was scheduled for), within one run's limits.
 */
export async function runRetentionPurge(
  db: Db,
  now: Date,
  media: MediaBucket,
  limits: RetentionPurgeLimits = DEFAULT_LIMITS,
): Promise<RetentionPurgeReport> {
  const report: RetentionPurgeReport = {
    cardsPurged: 0,
    cardsNotPurged: 0,
    editsPurged: 0,
    editsNotPurged: 0,
  };
  const { bucket, deleted } = countingBucket(media);

  const cards = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.status, "rejected"),
        isNotNull(businesses.rejectedAt),
        rejectionOlderThan(REJECTED_RETENTION_DAYS, now),
      ),
    )
    .orderBy(asc(businesses.rejectedAt), asc(businesses.id))
    .limit(limits.cards);
  for (const { id } of cards) {
    if (deleted() >= limits.photos) break;
    const outcome = await purgeRejectedCard(db, id, now, bucket);
    if (outcome.kind === "purged") report.cardsPurged += 1;
    else if (outcome.kind !== "not-due") report.cardsNotPurged += 1;
  }

  const edits = await db
    .select({ id: pendingEdits.id })
    .from(pendingEdits)
    .where(purgeableEdit(now))
    .orderBy(asc(pendingEdits.resolvedAt), asc(pendingEdits.id))
    .limit(limits.edits);
  for (const { id } of edits) {
    if (deleted() >= limits.photos) break;
    const outcome = await purgeResolvedEdit(db, id, now, bucket);
    if (outcome === "purged") report.editsPurged += 1;
    else if (outcome === "failed") report.editsNotPurged += 1;
  }

  return report;
}

/** What the run reports as its failure, in counts, or null when it purged all it tried. */
export function retentionPurgeFailure(report: RetentionPurgeReport): string | null {
  if (report.cardsNotPurged === 0 && report.editsNotPurged === 0) return null;
  return (
    `${report.cardsPurged} card(s) purged, ${report.cardsNotPurged} not purged, ` +
    `${report.editsPurged} edit(s) purged, ${report.editsNotPurged} not purged`
  );
}
