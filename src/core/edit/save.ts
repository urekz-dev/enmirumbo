// Saving a valid edit as the pending edit of its card
// (docs/specs/business-registration.md, "Sending the edit does not touch the
// public card: it creates a pending edit", "The edit goes through the same
// validations as the registration and cannot set what is not its to set" and
// "Sending changes when others are already waiting replaces the previous
// ones"; docs/specs/data-model.md, "A pending edit stores the full content of
// what is to be published", "A pending edit replaced by a newer one is kept as
// superseded (v2)" and "A pending edit may change the photo of its card (v2)").
//
// One transaction:
//
// 1. It locks the card the link opens, checked again: the published card of
//    the locality with that identifier and that fingerprint, so a link the
//    admin regenerated, or a card unpublished, a moment before saves
//    nothing. The lock (`FOR NO KEY UPDATE`, which does not hold back a
//    report of the card) makes two edits of one card wait for each other.
// 2. A WhatsApp that another card of the locality has, in any status, is
//    refused: applying the edit could never give the card that number. The
//    admin checks it again when applying (admin-review).
// 3. The edit waiting for review, if any, becomes `superseded`, with its
//    resolution date, and gives up the key of the new photo it carried: one
//    edit names a photo at a time.
// 4. The new edit is saved as `pending`, with the full content of the form,
//    what it asks of the photo and its arrival now, from which its wait
//    counts. An edit that keeps the photo (no file, no "Dejar mi ficha sin
//    foto") takes over the new photo of the edit it supersedes, if that one
//    carried one: no browser can put a photo back in a file field, so the
//    owner who changes something else keeps the photo they already sent.
//    Nothing of the card changes: no column of `businesses` is written.
//
// So two submissions at once leave exactly one pending edit: the second waits
// for the first's lock, then supersedes it; and the partial unique index of
// the table refuses a second pending edit whatever happens. The key of a new
// photo the superseded edit carried and the new edit did not take over is
// given back, so its objects are deleted once the transaction is over.
//
// Binding: HYPERDRIVE_FRESH, as every write.
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { businesses, pendingEdits } from "../db/schema/index.ts";
import { type OpenLink, openLinkCondition } from "../management-link/link.ts";
import { isPhotoKey } from "../photos/photo.ts";
import type { EditableFields } from "./submission.ts";

/**
 * What an edit asks of the card's photo once applied: leave it as it is,
 * put in its place the new photo just stored under `key`, or leave the card
 * without one.
 */
export type EditPhotoChange =
  | { kind: "keep" }
  | { kind: "replace"; key: string }
  | { kind: "remove" };

/**
 * What happened to an edit: saved, giving back the new photo of the edit it
 * superseded when the new one did not take it over, whose objects are then
 * deleted; refused because another card has its WhatsApp; or not saved
 * because the link no longer opens the card.
 */
export type SaveEditOutcome =
  | { kind: "saved"; droppedPhotoKey: string | null }
  | { kind: "taken" }
  | { kind: "closed" };

const TAKEN: SaveEditOutcome = { kind: "taken" };
const CLOSED: SaveEditOutcome = { kind: "closed" };

/** Saves `edit` as the pending edit of the card `link` opens in the locality `localityCode`. */
export function savePendingEdit(
  db: Db,
  localityCode: string,
  link: OpenLink,
  edit: EditableFields,
  photo: EditPhotoChange,
): Promise<SaveEditOutcome> {
  return db.transaction(async (tx) => {
    const [card] = await tx
      .select({ id: businesses.id })
      .from(businesses)
      .where(openLinkCondition(localityCode, link.fingerprint, link.businessId))
      .for("no key update");
    if (card === undefined) return CLOSED;

    const [other] = await tx
      .select({ id: businesses.id })
      .from(businesses)
      .where(
        and(
          eq(businesses.localityCode, localityCode),
          eq(businesses.whatsapp, edit.whatsapp),
          ne(businesses.id, card.id),
        ),
      )
      .limit(1);
    if (other !== undefined) return TAKEN;

    // At most one waits (the partial unique index), and the card's lock
    // keeps it from changing until this transaction ends.
    const waitingPending = and(
      eq(pendingEdits.businessId, card.id),
      eq(pendingEdits.status, "pending"),
    );
    const [waiting] = await tx
      .select({ newPhotoKey: pendingEdits.newPhotoKey })
      .from(pendingEdits)
      .where(waitingPending);
    await tx
      .update(pendingEdits)
      .set({ status: "superseded", resolvedAt: sql`now()`, newPhotoKey: null })
      .where(waitingPending);
    const waitingKey = isPhotoKey(waiting?.newPhotoKey) ? waiting.newPhotoKey : null;
    const asked: EditPhotoChange =
      photo.kind === "keep" && waitingKey !== null ? { kind: "replace", key: waitingKey } : photo;
    await tx.insert(pendingEdits).values({
      businessId: card.id,
      localityCode,
      ...edit,
      photoChange: asked.kind,
      newPhotoKey: asked.kind === "replace" ? asked.key : null,
      status: "pending",
      createdAt: sql`now()`,
    });
    const keptWaitingKey = asked.kind === "replace" && asked.key === waitingKey;
    return { kind: "saved", droppedPhotoKey: keptWaitingKey ? null : waitingKey };
  });
}
