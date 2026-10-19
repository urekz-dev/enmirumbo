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
// The log says only the kind of a failure: no name, no number, no key.
//
// Binding: HYPERDRIVE_FRESH.
import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { failureKind } from "../db/failure.ts";
import { adminAuditLog, businesses, pendingEdits } from "../db/schema/index.ts";
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
  let photoCached = false;
  for (const key of keys) {
    const removal = await removePhoto(bucket, key);
    if (removal.kind === "kept" || removal.cache === "failed") return STORAGE;
    if (removal.cache === "deferred") photoCached = true;
  }

  let deleted: { late: string[] } | null;
  try {
    deleted = await db.transaction(async (tx) => {
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
        actor: actorOf(email),
        action: "delete",
        previousStatus: card.status,
      });
      const named = [card, ...edits].map(({ key }) => key).filter(isPhotoKey);
      return { late: [...new Set(named)].filter((key) => !keys.includes(key)) };
    });
  } catch (error) {
    console.error(`review: a card could not be deleted (${failureKind(error)})`);
    return { kind: "failed", photoRemoved: keys.length > 0 };
  }
  if (deleted === null) return GONE;

  for (const key of deleted.late) {
    const removal = await removePhoto(bucket, key);
    if (removal.kind === "removed" && removal.cache === "deferred") photoCached = true;
  }
  return { kind: "deleted", photoCached };
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
