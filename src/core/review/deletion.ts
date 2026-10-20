// The permanent deletion of a card, the ARCO cancellation (PRD §8;
// docs/specs/admin-review.md, "Permanent deletion is confirmed in two steps,
// by typing a word", "Permanent deletion takes everything and leaves no
// trace of personal data", "The destructive actions of the admin write to the
// audit log with the Access identity (v2)" and "Unpublishing, a new link and
// the permanent deletion are forms of the detail, and their actions check
// everything again (v2)"; docs/specs/data-model.md, "Permanent deletion of a
// business (ARCO operation)" and "The audit log records the destructive
// actions of the admin (v2)"; docs/specs/deployment.md, "Permanent deletion
// refuses to claim it deleted what it did not delete" and "A deleted photo
// is purged from the cache of the media hostname, and a purge that fails is
// retried every hour (v2)").
//
// The first step is a screen of its own, /admin/registros/<id>/borrar, which
// a GET opens and which deletes nothing (deletionScreen). Its form posts the
// second step, which the action (src/actions/index.ts) brings here with the
// Access email, the identifier of the page's address, its connection and the
// media bucket. In this order:
//
// 1. The card, and the permission `businesses.delete` in its locality
//    (./decision.ts): a card that no longer exists, or that the user may not
//    see, is "Esta ficha ya no existe." (deleting is idempotent, and the
//    panel never tells a user that a card exists); one the user sees but may
//    not delete, forbidden.
// 2. The word: BORRAR, whatever its case and the spaces around it, and no
//    other. Anything else deletes nothing.
// 3. The photos first (deployment), the card's and the new photos of its
//    edits, whatever their status: both objects of each, then both of its
//    addresses from the cache of the media hostname (removePhoto,
//    ../photos/upload.ts). When the bucket cannot be reached, the deletion
//    stops there and says so: no row is touched, and the card keeps every
//    key a new attempt needs. When a purge fails, its addresses wait for the
//    hourly retry, which needs no card, and the deletion goes on; it then
//    says that the photo may still be seen a while. When even keeping them
//    fails, the deletion stops like an unreachable bucket, since only the
//    card still knows the key. A card without a photo is deleted whatever
//    the state of the bucket.
// 4. One transaction: the card's row, and with it, by the cascade of every
//    foreign key to `businesses`, its trades, its reports, its edits, its
//    consent record and the fingerprint of its link, so its card and its
//    link answer the same 404 as ones that never existed; and the entry of
//    the audit log, which keeps no foreign key to the card and outlives it:
//    the admin's Access email, the locality, the card's identifier, `delete`
//    and the status the card had, never a copy of its data. A card deleted
//    meanwhile is "Esta ficha ya no existe." A failure deletes no row and
//    says so, and whether the photos are already gone.
// 5. A photo that a resubmission or an edit gave the card between steps 3 and
//    4 is deleted after the rows, like any photo nothing names any more.
//
// The scheduled purge of a rejected card (purgeRejectedCard, EMR-56) is this
// same deletion, with the scheduled job as the actor and `purge` as the
// action, of a card that is still rejected and past its 90 days (data-model,
// "Rejected registrations are permanently deleted after 90 days"). It holds
// the card's row from the check of its term to the deletion of its rows, so a
// resubmission cannot lose its photo to a purge that no longer applies.
//
// The log says only the kind of a failure: no name, no number, no key.
//
// Binding: HYPERDRIVE_FRESH.
import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { failureKind } from "../db/failure.ts";
import {
  adminAuditLog,
  businesses,
  pendingEdits,
  SCHEDULED_JOB_ACTOR,
} from "../db/schema/index.ts";
import { formText } from "../forms/text.ts";
import { isPhotoKey } from "../photos/photo.ts";
import { type MediaBucket, removePhoto } from "../photos/upload.ts";
import { actorOf, cardToDecide, type DecisionTarget } from "./decision.ts";
import { DELETE_WORD } from "./texts.ts";

/** The name of the field where the word is typed. */
export const DELETE_WORD_FIELD = "confirmacion";

/** Whether `typed` is the word that confirms a deletion: its case and the spaces around it do not count. */
export function isDeleteWord(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_WORD;
}

export type DeletionOutcome =
  /** Deleted; `photoCached` when a purge failed and the photo may still be served a while. */
  | { kind: "deleted"; photoCached: boolean }
  /** No card to delete: "Esta ficha ya no existe." */
  | { kind: "gone" }
  /** The word was not BORRAR: nothing was deleted. */
  | { kind: "invalid" }
  /** The photos could not be deleted: nothing of the card's rows was touched. */
  | { kind: "storage" }
  /** The rows could not be deleted; `photoRemoved` when the photos already were. */
  | { kind: "failed"; photoRemoved: boolean }
  | { kind: "forbidden" };

const GONE: DeletionOutcome = { kind: "gone" };
const STORAGE: DeletionOutcome = { kind: "storage" };

/** Every photo key of the card `businessId` and of its edits that names a photo of the server's. */
async function photoKeysOf(db: Db, businessId: string): Promise<string[]> {
  const [card, edits] = await Promise.all([
    db.select({ key: businesses.photoKey }).from(businesses).where(eq(businesses.id, businessId)),
    db
      .select({ key: pendingEdits.newPhotoKey })
      .from(pendingEdits)
      .where(and(eq(pendingEdits.businessId, businessId), isNotNull(pendingEdits.newPhotoKey))),
  ]);
  const keys = [...card, ...edits].map(({ key }) => key).filter(isPhotoKey);
  return [...new Set(keys)];
}

/** Deletes the photos `keys` one after the other; stops at the first the store or the cache cannot take. */
async function removeKeys(
  bucket: MediaBucket,
  keys: readonly string[],
): Promise<{ kind: "removed"; photoCached: boolean; photoRemoved: boolean } | { kind: "storage" }> {
  let photoCached = false;
  let photoRemoved = false;
  let foreign = false;
  for (const key of keys) {
    const removal = await removePhoto(bucket, key);
    if (removal.kind === "foreign") {
      foreign = true;
      continue;
    }
    if (removal.kind === "kept" || removal.cache === "failed") return { kind: "storage" };
    photoRemoved = true;
    if (removal.cache === "deferred") photoCached = true;
  }
  return { kind: "removed", photoCached, photoRemoved: photoRemoved && !foreign };
}

/** Who deletes, and how the audit log calls it: the panel's `delete` or the scheduled `purge`. */
interface DeletionEntry {
  actor: string;
  action: "delete" | "purge";
}

/**
 * Step 4: the rows of the card `businessId` and its entry of the audit log in
 * the transaction `tx`. Gives the photos the card and its edits named that
 * `known` did not, or null when there is no such card.
 */
async function deleteRows(
  tx: Db,
  businessId: string,
  { actor, action }: DeletionEntry,
  known: readonly string[],
): Promise<{ late: string[] } | null> {
  const edits = await tx
    .delete(pendingEdits)
    .where(eq(pendingEdits.businessId, businessId))
    .returning({ key: pendingEdits.newPhotoKey });
  const [card] = await tx.delete(businesses).where(eq(businesses.id, businessId)).returning({
    localityCode: businesses.localityCode,
    status: businesses.status,
    key: businesses.photoKey,
  });
  if (card === undefined) return null;
  await tx.insert(adminAuditLog).values({
    localityCode: card.localityCode,
    businessId,
    actor,
    action,
    previousStatus: card.status,
  });
  const named = [card, ...edits].map(({ key }) => key).filter(isPhotoKey);
  return { late: [...new Set(named)].filter((key) => !known.includes(key)) };
}

/**
 * Deletes the card `businessId` for good with everything that hangs from it,
 * its photos first, and writes its entry of the audit log with `email`
 * (steps 3 to 5 above).
 */
export async function deleteCard(
  db: Db,
  businessId: string,
  email: string,
  bucket: MediaBucket,
): Promise<DeletionOutcome> {
  const keys = await photoKeysOf(db, businessId);
  const removal = await removeKeys(bucket, keys);
  if (removal.kind === "storage") return STORAGE;
  let photoCached = removal.photoCached;

  let deleted: { late: string[] } | null;
  try {
    deleted = await db.transaction((tx) =>
      deleteRows(tx, businessId, { actor: actorOf(email), action: "delete" }, keys),
    );
  } catch (error) {
    console.error(`review: a card could not be deleted (${failureKind(error)})`);
    return { kind: "failed", photoRemoved: removal.photoRemoved };
  }
  if (deleted === null) return GONE;

  for (const key of deleted.late) {
    const late = await removePhoto(bucket, key);
    if (late.kind === "removed" && late.cache === "deferred") photoCached = true;
  }
  return { kind: "deleted", photoCached };
}

/**
 * Whether the rejection of the card, by its locality's time zone, is `days`
 * local calendar days old or more at `at`: the local date of the rejection is
 * on or before the local date `days` before the local date of `at`. A card
 * whose rejection was cleared by a resubmission has none, so none is old.
 */
export function rejectionOlderThan(days: number, at: Date): SQL {
  const now = at.toISOString();
  return sql`exists (
    select 1 from localities l
    where l.code = ${businesses.localityCode}
      and (${businesses.rejectedAt} at time zone l.time_zone)::date
        <= (${now}::timestamptz at time zone l.time_zone)::date - ${days}::int
  )`;
}

/** The days after which a rejected registration is purged (PRD §8). */
export const REJECTED_RETENTION_DAYS = 90;

export type PurgeOutcome =
  /** Deleted for good, with its entry `purge` in the audit log. */
  | { kind: "purged" }
  /** Not a rejected card past its term any more, or no card: nothing was touched. */
  | { kind: "not-due" }
  /** The photos could not be deleted: no row was touched, and a new run tries again. */
  | { kind: "storage" }
  /** The rows could not be deleted: none was, and a new run tries again. */
  | { kind: "failed" };

/**
 * The scheduled purge of one rejected card whose rejection is
 * REJECTED_RETENTION_DAYS old or more at `at` (docs/specs/data-model.md,
 * "Rejected registrations are permanently deleted after 90 days"): the same
 * deletion as the panel's, with its photos first and its entry of the audit
 * log, whose actor is the scheduled job and whose action is `purge`.
 *
 * Nothing but a rejected card past its term is deleted. The card's row is
 * locked and checked again before its photos go, and stays locked until its
 * rows are deleted, so a resubmission that arrives meanwhile waits and then
 * finds no card, instead of losing its photo to a purge that no longer
 * applies. The panel's deletion does not hold the row so long: it deletes
 * what the admin chose, whatever the card is, and cleans up after it
 * (step 5).
 */
export async function purgeRejectedCard(
  db: Db,
  businessId: string,
  at: Date,
  bucket: MediaBucket,
): Promise<PurgeOutcome> {
  try {
    return await db.transaction(async (tx): Promise<PurgeOutcome> => {
      const [due] = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(
          and(
            eq(businesses.id, businessId),
            eq(businesses.status, "rejected"),
            isNotNull(businesses.rejectedAt),
            rejectionOlderThan(REJECTED_RETENTION_DAYS, at),
          ),
        )
        .for("update");
      if (due === undefined) return { kind: "not-due" };
      const keys = await photoKeysOf(tx, businessId);
      if ((await removeKeys(bucket, keys)).kind === "storage") return { kind: "storage" };
      const deleted = await deleteRows(
        tx,
        businessId,
        { actor: SCHEDULED_JOB_ACTOR, action: "purge" },
        keys,
      );
      return deleted === null ? { kind: "not-due" } : { kind: "purged" };
    });
  } catch (error) {
    console.error(`review: a rejected card could not be purged (${failureKind(error)})`);
    return { kind: "failed" };
  }
}

/** What a deletion needs from the action. */
export interface SubmitDeletionDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
  /** The public media bucket, with the cache of its media hostname (mediaBucket). */
  bucket: MediaBucket;
}

/** A submission of the deletion form of `target`, from what arrived to what the admin is told. */
export function submitDeletion(
  form: FormData,
  target: DecisionTarget,
  deps: SubmitDeletionDeps,
): Promise<DeletionOutcome> {
  return deps.useDb(async (db) => {
    const access = await cardToDecide(db, target, "businesses.delete");
    if (access.kind === "not-found") return GONE;
    if (access.kind === "forbidden") return access;
    if (!isDeleteWord(formText(form, DELETE_WORD_FIELD))) return { kind: "invalid" };
    return deleteCard(db, access.card.id, target.email, deps.bucket);
  });
}

/** What the first step shows of the card to delete. */
export type DeletionScreen =
  | { kind: "card"; name: string }
  | { kind: "not-found" }
  | { kind: "forbidden" };

/**
 * The card the confirmation of a deletion names, for a user who may delete
 * it: a card that does not exist, or that the user may not see, is not
 * found; one the user sees but may not delete, forbidden. It reads, and
 * changes nothing.
 */
export async function deletionScreen(db: Db, target: DecisionTarget): Promise<DeletionScreen> {
  const access = await cardToDecide(db, target, "businesses.delete");
  if (access.kind !== "card") return access;
  const [card] = await db
    .select({ name: businesses.name })
    .from(businesses)
    .where(eq(businesses.id, access.card.id));
  return card === undefined ? { kind: "not-found" } : { kind: "card", name: card.name };
}
