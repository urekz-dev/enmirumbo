// Direct rectification from the panel (admin-review, F6). The registration
// form and validator own every editable field. Status, trades, consent and
// management links are never taken from the submission. Pending owner edits
// stay untouched; the card lock serializes this save with their application.
import { and, eq, ne } from "drizzle-orm";
import { can } from "../access/queries.ts";
import type { Db } from "../db/client.ts";
import { failureKind } from "../db/failure.ts";
import { adminAuditLog, businesses, zones } from "../db/schema/index.ts";
import { editForm } from "../edit/card.ts";
import type { EditPhotoChange } from "../edit/save.ts";
import { isPhotoKey } from "../photos/photo.ts";
import { deletePhoto, type PhotoServices, storePhoto } from "../photos/upload.ts";
import {
  type NewRegistration,
  type RegistrationErrors,
  validateBusinessFields,
} from "../registration/submission.ts";
import { formText } from "../forms/text.ts";
import type { RegistrationCatalogue } from "../registration/catalogue.ts";
import { REGISTRATION_FIELDS } from "../registration/submission.ts";
import { localityZoneChoices } from "./approval.ts";
import { hiddenZoneOption } from "./texts.ts";
import { actorOf, cardToDecide, type DecisionTarget } from "./decision.ts";
import { panelLocalities } from "./localities.ts";

/** Published cards offer every local catalogue zone, with the approval's hidden labels. */
export async function rectificationForm(
  db: Db,
  locality: { code: string; name: string },
  businessId: string,
  published: boolean,
) {
  const choices = published ? await localityZoneChoices(db, locality.code) : [];
  const form = await editForm(
    db,
    locality,
    businessId,
    choices.map(({ id }) => id),
  );
  if (form === null || !published) return form;
  const hidden = new Set(choices.filter(({ hidden }) => hidden).map(({ id }) => id));
  return {
    ...form,
    catalogue: {
      ...form.catalogue,
      zones: form.catalogue.zones.map((zone) => ({
        ...zone,
        displayName: hidden.has(zone.id) ? hiddenZoneOption(zone.displayName) : zone.displayName,
      })),
    },
  };
}

/** The shared registration validation, with the published card's catalogue-only requirement. */
function validateRectification(
  form: FormData,
  catalogue: RegistrationCatalogue,
  published: boolean,
) {
  const validation = validateBusinessFields(form, catalogue);
  const slug = formText(form, REGISTRATION_FIELDS.zone).trim();
  if (!published || catalogue.zones.some((zone) => zone.slug === slug)) return validation;
  const errors: RegistrationErrors = validation.kind === "invalid" ? { ...validation.errors } : {};
  // The published form has no free-text field; put its only zone error next to the select.
  delete errors.zoneOther;
  errors.zone = "required";
  return { kind: "invalid", errors } as const;
}

export type RectificationOutcome =
  | { kind: "saved" }
  | { kind: "invalid"; errors: RegistrationErrors }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "server" };

type SaveOutcome =
  | Exclude<RectificationOutcome, { kind: "saved" }>
  | {
      kind: "saved";
      droppedPhotoKey: string | null;
    };

/** Includes a concurrent registration taking the number after our check. */
function whatsappTaken(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    const pg = cause as Error & { code?: string; constraint?: string };
    if (pg.code === "23505") return pg.constraint === "businesses_locality_whatsapp_unique";
  }
  return false;
}

export async function rectifyCard(
  db: Db,
  target: DecisionTarget,
  fields: NewRegistration,
  photo: EditPhotoChange,
): Promise<SaveOutcome> {
  try {
    return await db.transaction(async (tx): Promise<SaveOutcome> => {
      const [card] = await tx
        .select()
        .from(businesses)
        .where(eq(businesses.id, target.businessId))
        .for("update");
      if (card === undefined) return { kind: "not-found" };
      // Check again at the write, in the locality of the locked card.
      const access = await cardToDecide(tx, target, "businesses.edit");
      if (access.kind !== "card") return access;
      if (!(await can(tx, target.email, "businesses.edit", card.localityCode))) {
        return { kind: "forbidden" };
      }
      // Status can change after the form was read. Enforce the invariant under the card lock.
      if (card.status === "published") {
        if (fields.zoneId === null) return { kind: "invalid", errors: { zone: "required" } };
        const [zone] = await tx
          .select({ id: zones.id })
          .from(zones)
          .where(and(eq(zones.id, fields.zoneId), eq(zones.localityCode, card.localityCode)));
        if (zone === undefined) return { kind: "invalid", errors: { zone: "required" } };
      }
      const [other] = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(
          and(
            eq(businesses.localityCode, card.localityCode),
            eq(businesses.whatsapp, fields.whatsapp),
            ne(businesses.id, card.id),
          ),
        )
        .limit(1);
      if (other !== undefined) return { kind: "invalid", errors: { whatsapp: "taken" } };
      const photoKey =
        photo.kind === "replace" ? photo.key : photo.kind === "remove" ? null : card.photoKey;
      const [saved] = await tx
        .update(businesses)
        .set({ ...fields, photoKey })
        .where(and(eq(businesses.id, card.id), eq(businesses.status, card.status)))
        .returning({ id: businesses.id });
      if (saved === undefined) throw new Error("rectification: locked card was not saved");
      if (
        card.whatsapp !== fields.whatsapp ||
        card.landline !== fields.landline ||
        card.address !== fields.address ||
        card.facebookUrl !== fields.facebookUrl
      ) {
        await tx.insert(adminAuditLog).values({
          actor: actorOf(target.email),
          localityCode: card.localityCode,
          businessId: card.id,
          action: "edit_contact",
          previousStatus: card.status,
        });
      }
      return {
        kind: "saved",
        droppedPhotoKey:
          isPhotoKey(card.photoKey) && card.photoKey !== photoKey ? card.photoKey : null,
      };
    });
  } catch (error) {
    if (whatsappTaken(error)) return { kind: "invalid", errors: { whatsapp: "taken" } };
    throw error;
  }
}

export interface RectificationDeps {
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
  photos: PhotoServices;
}

/** No public-form defenses here: Access and locality permissions protect it. */
export async function submitRectification(
  form: FormData,
  target: DecisionTarget,
  deps: RectificationDeps,
): Promise<RectificationOutcome> {
  try {
    return await deps.useDb(async (db) => {
      const access = await cardToDecide(db, target, "businesses.edit");
      if (access.kind !== "card") return access;
      const [locality] = await panelLocalities(db, [access.card.localityCode]);
      if (locality === undefined) return { kind: "not-found" };
      const published = access.card.status === "published";
      const editing = await rectificationForm(db, locality, access.card.id, published);
      if (editing === null) return { kind: "not-found" };
      const validation = validateRectification(form, editing.catalogue, published);
      if (validation.kind === "invalid") return validation;
      let photo: EditPhotoChange;
      if (validation.photo.kind === "upload") {
        const stored = await storePhoto(validation.photo.file, deps.photos);
        if (stored.kind !== "stored") return { kind: "invalid", errors: { photo: stored.error } };
        photo = { kind: "replace", key: stored.key };
      } else photo = validation.photo;
      let outcome;
      try {
        outcome = await rectifyCard(db, target, validation.registration, photo);
      } catch (error) {
        if (photo.kind === "replace") await deletePhoto(deps.photos.bucket, photo.key);
        throw error;
      }
      if (outcome.kind !== "saved") {
        if (photo.kind === "replace") await deletePhoto(deps.photos.bucket, photo.key);
        return outcome;
      }
      if (outcome.droppedPhotoKey !== null)
        await deletePhoto(deps.photos.bucket, outcome.droppedPhotoKey);
      return { kind: "saved" };
    });
  } catch (error) {
    console.error(`rectification: changes could not be saved (${failureKind(error)})`);
    return { kind: "server" };
  }
}
