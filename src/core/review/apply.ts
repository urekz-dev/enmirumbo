// Applying a pending edit (docs/specs/admin-review.md, "Applying the pending
// edit updates the published card and only that", "A pending edit is
// resolved only once and only if it is still the latest", "Applying or
// discarding a pending edit carries out what it asks of the photo (v2)" and
// "Attending a report and resolving a pending edit are forms of their
// details, and their action checks everything again (v2)";
// docs/specs/data-model.md, "A pending edit stores the full content of what
// is to be published", "A pending edit may change the photo of its card
// (v2)", "One card per WhatsApp number within a locality (v2)" and "The
// database derives the normalized name and "¿Qué ofreces?" of a business for
// the search (v2)"). The action of the detail's form (src/actions/index.ts)
// gives this the Access email, the number of the page's address, its
// connection and how to delete a photo. In this order:
//
// 1. The edit, and the permission `edits.review` in its locality
//    (./edit-decision.ts): forbidden, or not found.
// 2. An edit no longer pending: superseded by a newer one ("Estos cambios ya
//    no son los últimos: el negocio mandó otros más nuevos."), or already
//    applied or discarded ("Estos cambios ya los habías resuelto."). Nothing
//    is written.
// 3. A card no longer published: nothing is applied, and the edit keeps
//    waiting, so its changes can be applied when the card is published again.
// 4. The form: when the edit proposes the free text of "Otra", a zone of the
//    card's locality, hidden ones included, or "Elige la colonia de este
//    negocio" (decision of the product owner, 2026-10-18: "Otra" is
//    normalized on approving and on applying an owner's edit, so a published
//    card always has a catalogue zone).
// 5. One transaction, which locks the card first, as the owner's save does
//    (src/core/edit/save.ts), so an apply and a new edit of the same card
//    wait for each other and never deadlock. Under that lock it checks 2 and
//    3 again; refuses a WhatsApp that another card of the locality has, in
//    any status ("Ese número ya está en otra ficha: no se pudieron aplicar
//    los cambios."), leaving the edit pending; marks the edit `applied`, with
//    its date, only while it is still pending (a conditional update, so of
//    two resolutions at once exactly one wins); and copies to the card
//    exactly the fields of the form and what the edit asks of the photo:
//    `replace` gives the card the edit's new photo, `remove` leaves it
//    without one, `keep` leaves it as it is. Nothing else of the card
//    changes: status, origin, trades, dates, consent record, management link
//    and pin stay. The database derives the search columns again.
// 6. Once the card is saved, the objects of the photo it no longer names are
//    deleted and purged from the cache of the media hostname (deletePhoto,
//    src/core/photos/upload.ts); a deletion that fails is logged by its kind
//    there and left to the orphan sweep, a purge that fails to the hourly
//    retry. An edit that is not applied changes nothing of the photo either.
//
// An applied edit keeps the key of the photo it brought, which is now its
// card's (data-model, "A pending edit may change the photo of its card
// (v2)"). Applying writes no entry of the audit log: the log does not record
// the owner's edits the admin applies (data-model, "The audit log records the
// destructive actions of the admin (v2)").
//
// Binding: HYPERDRIVE_FRESH. Nothing here is logged.
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { businesses, municipalities, pendingEdits, states } from "../db/schema/index.ts";
import { formText } from "../forms/text.ts";
import type { LocalityRef } from "../locality/paths.ts";
import { isPhotoKey } from "../photos/photo.ts";
import { deletePhoto, type MediaBucket } from "../photos/upload.ts";
import { type ApprovalZone, localityZoneChoices } from "./approval.ts";
import { editToResolve, type EditTarget, noLongerPending } from "./edit-decision.ts";

/** The names of the fields of the apply form. */
export const APPLY_FIELDS = { zone: "colonia" } as const;

/** What the apply form of a pending edit needs: the zones to normalize "Otra" with. */
export interface ApplyForm {
  /** The edit proposes the free text of "Otra": the admin chooses a catalogue zone. */
  needsZone: boolean;
  /** That free text, as the owner wrote it. */
  zoneOther: string | null;
  /** Every zone of the card's locality, hidden ones included; empty when no zone is needed. */
  zones: readonly ApprovalZone[];
}

/**
 * The apply form of an edit of `localityCode`: the zones of the locality
 * only when the edit proposes the free text of "Otra" (`needsZone`).
 */
export async function applyForm(
  db: Db,
  edit: { localityCode: string; needsZone: boolean; zoneOther: string | null },
): Promise<ApplyForm> {
  const { needsZone } = edit;
  return {
    needsZone,
    zoneOther: needsZone ? edit.zoneOther : null,
    zones: needsZone ? await localityZoneChoices(db, edit.localityCode) : [],
  };
}

/** What the admin chose, as it arrived: what the form shows again after an error. */
export interface ApplyDraft {
  /** The slug of the chosen zone; empty for none. */
  zone: string;
}

export type ApplyErrors = { zone?: "required" };

/** What a submission of the apply form chose. Nothing about its shape is trusted. */
export function readApply(form: FormData): ApplyDraft {
  return { zone: formText(form, APPLY_FIELDS.zone).trim() };
}

export type ApplyValidation =
  | { kind: "valid"; zoneId: number | null }
  | { kind: "invalid"; errors: ApplyErrors };

/**
 * Checks `draft`: when `needsZone`, one of `zones`, the zones of the card's
 * locality, hidden ones included; otherwise the edit's own zone stands and
 * the choice is ignored.
 */
export function validateApply(
  draft: ApplyDraft,
  zones: readonly ApprovalZone[],
  needsZone: boolean,
): ApplyValidation {
  if (!needsZone) return { kind: "valid", zoneId: null };
  const zone = zones.find((option) => option.slug === draft.zone);
  return zone === undefined
    ? { kind: "invalid", errors: { zone: "required" } }
    : { kind: "valid", zoneId: zone.id };
}

export type ApplyOutcome =
  /**
   * Applied: the card says what the edit proposed. `droppedPhotoKey` is the
   * photo the card no longer names, whose objects are deleted once it is
   * saved.
   */
  | { kind: "applied"; droppedPhotoKey: string | null }
  /** Applied or discarded before: "Estos cambios ya los habías resuelto." */
  | { kind: "resolved" }
  /** A newer edit replaced it: "Estos cambios ya no son los últimos: …" */
  | { kind: "superseded" }
  /** The card is no longer published: nothing applied, and the edit keeps waiting. */
  | { kind: "unpublished" }
  /** Another card of the locality has the proposed WhatsApp: nothing applied. */
  | { kind: "taken" }
  | { kind: "invalid"; errors: ApplyErrors }
  | { kind: "not-found" }
  | { kind: "forbidden" };

const RESOLVED: ApplyOutcome = { kind: "resolved" };
const SUPERSEDED: ApplyOutcome = { kind: "superseded" };
const UNPUBLISHED: ApplyOutcome = { kind: "unpublished" };
const TAKEN: ApplyOutcome = { kind: "taken" };
const NOT_FOUND: ApplyOutcome = { kind: "not-found" };

/** The constraint of one card per WhatsApp number in a locality. */
const WHATSAPP_CONSTRAINT = "businesses_locality_whatsapp_unique";

/**
 * Whether `error` is another card taking the proposed number between the
 * check and the write: a registration of that number saved at that moment.
 */
function isWhatsappTaken(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    const { code, constraint } = cause as Error & { code?: unknown; constraint?: unknown };
    if (code === "23505") return constraint === WHATSAPP_CONSTRAINT;
  }
  return false;
}

/**
 * Applies the edit `editId` to its card, if it is still pending and the card
 * is published (step 5 above). `chosenZoneId` is the catalogue zone the
 * admin chose for an edit that proposes "Otra"; it is ignored otherwise.
 */
export async function applyEdit(
  db: Db,
  editId: number,
  chosenZoneId: number | null,
): Promise<ApplyOutcome> {
  try {
    return await db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ businessId: pendingEdits.businessId })
        .from(pendingEdits)
        .where(eq(pendingEdits.id, editId));
      if (owner === undefined) return NOT_FOUND;
      // The card first, as the owner's save locks it: a new edit of this card
      // waits for this transaction, and this one for a new edit being saved.
      const [card] = await tx
        .select({
          id: businesses.id,
          localityCode: businesses.localityCode,
          status: businesses.status,
          photoKey: businesses.photoKey,
        })
        .from(businesses)
        .where(eq(businesses.id, owner.businessId))
        .for("update");
      if (card === undefined) return NOT_FOUND;

      const [edit] = await tx.select().from(pendingEdits).where(eq(pendingEdits.id, editId));
      if (edit === undefined) return NOT_FOUND;
      if (edit.status !== "pending") {
        return noLongerPending(edit.status) === "superseded" ? SUPERSEDED : RESOLVED;
      }
      if (card.status !== "published") return UNPUBLISHED;
      const zoneId = edit.zoneId ?? chosenZoneId;
      if (zoneId === null) return { kind: "invalid", errors: { zone: "required" } };

      const [other] = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(
          and(
            eq(businesses.localityCode, card.localityCode),
            eq(businesses.whatsapp, edit.whatsapp),
            ne(businesses.id, card.id),
          ),
        )
        .limit(1);
      if (other !== undefined) return TAKEN;

      // Only while it is still pending: a discard of this edit may have
      // landed since it was read (a discard does not lock the card).
      const [applied] = await tx
        .update(pendingEdits)
        .set({ status: "applied", resolvedAt: sql`now()` })
        .where(and(eq(pendingEdits.id, editId), eq(pendingEdits.status, "pending")))
        .returning({ id: pendingEdits.id });
      if (applied === undefined) return RESOLVED;

      let photoKey: string | null | undefined;
      if (edit.photoChange === "replace") {
        if (!isPhotoKey(edit.newPhotoKey)) {
          throw new Error("apply: a pending edit that replaces the photo names no photo");
        }
        photoKey = edit.newPhotoKey;
      } else if (edit.photoChange === "remove") {
        photoKey = null;
      }
      const [saved] = await tx
        .update(businesses)
        .set({
          name: edit.name,
          categoryId: edit.categoryId,
          whatsapp: edit.whatsapp,
          // The zone chosen replaces only the missing catalogue zone: the free
          // text the owner wrote is kept, as the approval keeps it.
          zoneId,
          zoneOther: edit.zoneOther,
          whatYouOffer: edit.whatYouOffer,
          homeDelivery: edit.homeDelivery,
          landline: edit.landline,
          address: edit.address,
          openingHours: edit.openingHours,
          facebookUrl: edit.facebookUrl,
          ...(photoKey === undefined ? {} : { photoKey }),
        })
        .where(and(eq(businesses.id, card.id), eq(businesses.status, "published")))
        .returning({ id: businesses.id });
      // The card is locked and was published: no row means something is broken.
      if (saved === undefined) throw new Error("apply: the locked published card was not saved");

      const dropped =
        photoKey !== undefined && isPhotoKey(card.photoKey) && card.photoKey !== photoKey
          ? card.photoKey
          : null;
      return { kind: "applied", droppedPhotoKey: dropped };
    });
  } catch (error) {
    if (isWhatsappTaken(error)) return TAKEN;
    throw error;
  }
}

/** Where an apply's connection comes from, and how a photo the card no longer names is deleted. */
export interface SubmitApplyDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
  /**
   * The public media bucket with the cache of its media hostname (mediaBucket),
   * where deletePhoto deletes a photo's objects and purges its addresses.
   */
  bucket: MediaBucket;
}

/** What the admin is told after an apply: the outcome, without the photo it dropped. */
export type SubmitApplyOutcome = Exclude<ApplyOutcome, { kind: "applied" }> | { kind: "applied" };

/** A submission of the apply form of `target`, from what arrived to what the admin is told. */
export async function submitApplyEdit(
  form: FormData,
  target: EditTarget,
  deps: SubmitApplyDeps,
): Promise<SubmitApplyOutcome> {
  const outcome = await deps.useDb(async (db): Promise<ApplyOutcome> => {
    const access = await editToResolve(db, target);
    if (access.kind !== "edit") return access;
    const { edit } = access;
    if (edit.status !== "pending") {
      return noLongerPending(edit.status) === "superseded" ? SUPERSEDED : RESOLVED;
    }
    if (edit.cardStatus !== "published") return UNPUBLISHED;
    const choices = await applyForm(db, {
      localityCode: edit.localityCode,
      needsZone: edit.zoneId === null,
      zoneOther: edit.zoneOther,
    });
    const validation = validateApply(readApply(form), choices.zones, choices.needsZone);
    if (validation.kind === "invalid") return validation;
    return applyEdit(db, edit.id, validation.zoneId);
  });
  if (outcome.kind !== "applied") return outcome;
  if (outcome.droppedPhotoKey !== null) await deletePhoto(deps.bucket, outcome.droppedPhotoKey);
  return { kind: "applied" };
}

/** What the confirmation of an applied edit shows: the notice to the business. */
export interface AppliedNotice {
  id: string;
  /** The card's name and WhatsApp as they are now, after the edit. */
  name: string;
  whatsapp: string;
  locality: LocalityRef;
}

/**
 * The notice of the applied edit `target` names, for its confirmation; or
 * null when there is nothing to confirm, so the page goes back to the
 * detail of the edit: no edit, one the user may not resolve, one that is not
 * applied, or one whose card is no longer published, whose link would open
 * nothing. The name and WhatsApp are the card's now, the number the edit may
 * have given it included.
 */
export async function appliedNotice(db: Db, target: EditTarget): Promise<AppliedNotice | null> {
  const access = await editToResolve(db, target);
  if (access.kind !== "edit" || access.edit.status !== "applied") return null;
  const [card] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      whatsapp: businesses.whatsapp,
      status: businesses.status,
      slug: municipalities.slug,
      stateSlug: states.slug,
    })
    .from(businesses)
    .innerJoin(municipalities, eq(municipalities.code, businesses.localityCode))
    .innerJoin(states, eq(states.code, municipalities.stateCode))
    .where(eq(businesses.id, access.edit.businessId));
  if (card === undefined || card.status !== "published") return null;
  return {
    id: card.id,
    name: card.name,
    whatsapp: card.whatsapp,
    locality: { slug: card.slug, state: { slug: card.stateSlug } },
  };
}
