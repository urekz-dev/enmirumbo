// Discarding a pending edit (docs/specs/admin-review.md, "Discarding the
// pending edit requires a reason, does not touch the card and offers to
// notify by WhatsApp", "A pending edit is resolved only once and only if it
// is still the latest", "Applying or discarding a pending edit carries out
// what it asks of the photo (v2)" and "Attending a report and resolving a
// pending edit are forms of their details, and their action checks
// everything again (v2)"; docs/specs/data-model.md, "A pending edit replaced
// by a newer one is kept as superseded (v2)" and "A pending edit may change
// the photo of its card (v2)"). The action of the detail's form
// (src/actions/index.ts) gives this the Access email, the number of the
// page's address, its connection and how to delete a photo. In this order:
//
// 1. The edit, and the permission `edits.review` in its locality
//    (./edit-decision.ts): forbidden, or not found.
// 2. An edit no longer pending: superseded, or already resolved. Nothing is
//    written.
// 2b. A card that is no longer published: nothing is discarded, and the edit
//    keeps waiting, as an apply does (decision of 2026-10-18, EMR-48). The
//    notice of a discard tells the owner "Tu ficha sigue publicada como
//    estaba", which would be false; once the card is published again, the
//    edit can be resolved with a notice that is true.
// 3. The reason (./reason.ts), the rules of the rejection's: required, at
//    most 500 characters counted as a person sees them, never trimmed to
//    fit, since it travels whole in the WhatsApp to the business. Errors,
//    and nothing is written; the page shows the reason again as typed.
// 4. One transaction: the edit, locked, becomes `discarded`, with its date
//    and the reason, only while it is still pending, so of two resolutions
//    at once exactly one wins; and it gives up the key of the new photo it
//    carried, as a superseded edit does, while still saying it asked
//    `replace`.
// 5. Once it is saved, the objects of that photo are deleted and its
//    addresses purged from the cache of the media hostname (deletePhoto,
//    src/core/photos/upload.ts); a deletion that fails is logged by its kind
//    there, and the orphan sweep removes what no row names; a purge that
//    fails waits for the hourly retry.
//
// Discarding touches nothing of the card: its data, its photo, its status and
// its management link stay, so the owner can send changes again with the same
// link. It changes nothing public, so its confirmation does not say that the
// site takes a minute, and it writes no entry of the audit log, which records
// only reject, unpublish, delete, purge and the edits of contact data
// (data-model, "The audit log records the destructive actions of the admin
// (v2)").
//
// Binding: HYPERDRIVE_FRESH. Nothing here is logged.
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { businesses, pendingEdits } from "../db/schema/index.ts";
import { isPhotoKey } from "../photos/photo.ts";
import { deletePhoto, type MediaBucket } from "../photos/upload.ts";
import { editToResolve, type EditTarget, noLongerPending } from "./edit-decision.ts";
import { type ReasonError, readReason } from "./reason.ts";

/** The name of the field of the reason. */
export const DISCARD_FIELD = "motivo";

export type DiscardOutcome =
  /** Discarded: `droppedPhotoKey` is the new photo it carried, deleted once it is saved. */
  | { kind: "discarded"; droppedPhotoKey: string | null }
  | { kind: "resolved" }
  | { kind: "superseded" }
  /** Its card is no longer published: nothing is discarded, and the edit keeps waiting. */
  | { kind: "unpublished" }
  | { kind: "invalid"; error: ReasonError }
  | { kind: "not-found" }
  | { kind: "forbidden" };

const RESOLVED: DiscardOutcome = { kind: "resolved" };
const SUPERSEDED: DiscardOutcome = { kind: "superseded" };
const UNPUBLISHED: DiscardOutcome = { kind: "unpublished" };
const NOT_FOUND: DiscardOutcome = { kind: "not-found" };

/** Discards the edit `editId` with `reason`, if it is still pending (step 4 above). */
export function discardEdit(db: Db, editId: number, reason: string): Promise<DiscardOutcome> {
  return db.transaction(async (tx) => {
    // Locked, so the key read is the one this transaction takes off it. The
    // lock is the edit's alone, which a new edit of the card or an apply
    // takes after the card's: nothing waits in a circle.
    const [edit] = await tx
      .select({ status: pendingEdits.status, newPhotoKey: pendingEdits.newPhotoKey })
      .from(pendingEdits)
      .where(eq(pendingEdits.id, editId))
      .for("update");
    if (edit === undefined) return NOT_FOUND;
    if (edit.status !== "pending") {
      return noLongerPending(edit.status) === "superseded" ? SUPERSEDED : RESOLVED;
    }
    // Read after the edit's lock, so an unpublishing that came first is seen.
    const [card] = await tx
      .select({ status: businesses.status })
      .from(businesses)
      .innerJoin(pendingEdits, eq(pendingEdits.businessId, businesses.id))
      .where(eq(pendingEdits.id, editId));
    if (card?.status !== "published") return UNPUBLISHED;
    const [discarded] = await tx
      .update(pendingEdits)
      .set({
        status: "discarded",
        resolvedAt: sql`now()`,
        discardReason: reason,
        newPhotoKey: null,
      })
      .where(and(eq(pendingEdits.id, editId), eq(pendingEdits.status, "pending")))
      .returning({ id: pendingEdits.id });
    if (discarded === undefined) return RESOLVED;
    return {
      kind: "discarded",
      droppedPhotoKey: isPhotoKey(edit.newPhotoKey) ? edit.newPhotoKey : null,
    };
  });
}

/** Where a discard's connection comes from, and how the edit's new photo is deleted. */
export interface SubmitDiscardDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
  /**
   * The public media bucket with the cache of its media hostname (mediaBucket),
   * where deletePhoto deletes a photo's objects and purges its addresses.
   */
  bucket: MediaBucket;
}

/** What the admin is told after a discard: the outcome, without the photo it dropped. */
export type SubmitDiscardOutcome =
  | Exclude<DiscardOutcome, { kind: "discarded" }>
  | { kind: "discarded" };

/** A submission of the discard form of `target`, from what arrived to what the admin is told. */
export async function submitDiscardEdit(
  form: FormData,
  target: EditTarget,
  deps: SubmitDiscardDeps,
): Promise<SubmitDiscardOutcome> {
  const outcome = await deps.useDb(async (db): Promise<DiscardOutcome> => {
    const access = await editToResolve(db, target);
    if (access.kind !== "edit") return access;
    const { edit } = access;
    if (edit.status !== "pending") {
      return noLongerPending(edit.status) === "superseded" ? SUPERSEDED : RESOLVED;
    }
    if (edit.cardStatus !== "published") return UNPUBLISHED;
    const reading = readReason(form, DISCARD_FIELD);
    if (reading.kind === "invalid") return reading;
    return discardEdit(db, edit.id, reading.reason);
  });
  if (outcome.kind !== "discarded") return outcome;
  if (outcome.droppedPhotoKey !== null) await deletePhoto(deps.bucket, outcome.droppedPhotoKey);
  return { kind: "discarded" };
}

/** What the confirmation of a discard shows: the notice, with the reason stored. */
export interface DiscardedNotice {
  /** The card's name and WhatsApp as published: the edit changed neither. */
  name: string;
  whatsapp: string;
  reason: string;
}

/**
 * The notice of the discarded edit `target` names, for its confirmation; or
 * null when there is nothing to confirm, so the page goes back to the detail
 * of the edit: no edit, one the user may not resolve, one that is not
 * discarded, one with no reason (a message with a blank reason is a wrong
 * WhatsApp to a third party), or one whose card is no longer published (the
 * notice says it still is). The reason is the one stored, never one an
 * address carries.
 */
export async function discardedNotice(db: Db, target: EditTarget): Promise<DiscardedNotice | null> {
  const access = await editToResolve(db, target);
  if (access.kind !== "edit" || access.edit.status !== "discarded") return null;
  if (access.edit.cardStatus !== "published") return null;
  const [row] = await db
    .select({
      name: businesses.name,
      whatsapp: businesses.whatsapp,
      reason: pendingEdits.discardReason,
    })
    .from(pendingEdits)
    .innerJoin(businesses, eq(businesses.id, pendingEdits.businessId))
    .where(eq(pendingEdits.id, access.edit.id));
  if (row === undefined || !row.reason?.trim()) return null;
  return { name: row.name, whatsapp: row.whatsapp, reason: row.reason };
}
