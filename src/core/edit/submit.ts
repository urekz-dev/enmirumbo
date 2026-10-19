// A submission of the edit form of a management link, from what arrived to
// what the owner is told (docs/specs/business-registration.md, "A token that
// is not exactly the current one opens nothing and gives nothing away",
// "Sending the edit does not touch the public card: it creates a pending
// edit", "The edit goes through the same validations as the registration and
// cannot set what is not its to set", "Sending changes when others are
// already waiting replaces the previous ones", "The registration and edit
// forms are protected by quotas, honeypot and Turnstile (v2)" and "The edit
// of a card may change its photo, which reaches the card only when the edit
// is applied (v2)"). The action of the form (src/actions/index.ts) only finds
// the locality and the token of the page's address and gives this its
// connection, its quota, its Turnstile check and what the photo needs. In
// this order:
//
// 0. The token, from the page's address, never from a field: one that does
//    not open a published card of the locality is not found, before
//    anything else, so the address of an edit answers the same 404 to every
//    request that does not open it (src/core/management-link/link.ts).
// 1. The trap field: a bot is told the changes were received, and nothing
//    else happens.
// 2. Turnstile (../turnstile/check.ts) with the action `edit`, unless its
//    switch is off: without a valid token the form comes back.
// 3. Every field, with the registration's rules and messages, against the
//    catalogue of the locality (./card.ts): errors, and nothing else
//    happens, so a typo spends no quota. The photo is only weighed here.
// 4. The per-IP quota of the edits, its own counter.
// 5. The photo, only now: checked, transformed and stored under a new key
//    (src/core/photos/upload.ts) that no public page names, or turned away
//    next to its field with nothing saved.
// 6. The pending edit (./save.ts), which supersedes the one waiting and
//    touches nothing of the card; an edit that keeps the photo takes over the
//    new photo of the edit it supersedes. When it is not saved (another card
//    has the number, the link stopped opening the card, a failure), the photo
//    of step 5 is deleted; once it is saved, the new photo of the superseded
//    edit is deleted unless the new edit took it over.
//
// Nothing here writes the token, what the owner typed, the address or
// anything about a card to the log: a failure is logged by its kind alone.
import type { Db } from "../db/client.ts";
import { failureKind } from "../db/failure.ts";
import { isHoneypotFilled } from "../forms/honeypot.ts";
import type { ServedLocality } from "../locality/served.ts";
import { resolveManagementLink } from "../management-link/link.ts";
import { deletePhoto, type PhotoServices, storePhoto } from "../photos/upload.ts";
import type { QuotaDecision } from "../quota/window.ts";
import type { PhotoRequest, RegistrationErrors } from "../registration/submission.ts";
import { checkTurnstile, passesTurnstile, type VerifyTurnstile } from "../turnstile/check.ts";
import { editForm } from "./card.ts";
import { type EditPhotoChange, savePendingEdit } from "./save.ts";
import { validateEdit } from "./submission.ts";

export interface SubmitEditDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
  /** Counts this submission in the per-IP quota of the edits, and says whether it may go on. */
  takeQuota: () => Promise<QuotaDecision>;
  /** Checks a Turnstile token with Cloudflare (src/lib/turnstile.ts), when the switch is on. */
  verifyTurnstile: VerifyTurnstile;
  /** The Images binding and the public media bucket the photo goes through. */
  photos: PhotoServices;
}

/** Where an edit was sent from: the locality and the token of the page's address. */
export interface EditTarget {
  locality: Pick<ServedLocality, "code" | "name">;
  token: string;
}

/**
 * What the owner is told: the changes were received (saved, or a bot caught
 * by the trap, which must look the same); the form comes back with errors
 * next to its fields (another card's WhatsApp and the photo's among them),
 * refused by Turnstile, over the quota, or after a failure to save; or the
 * link opens nothing, which is the site's 404.
 */
export type SubmitEditOutcome =
  | { kind: "received" }
  | { kind: "invalid"; errors: RegistrationErrors }
  | { kind: "turnstile" }
  | { kind: "quota" }
  | { kind: "server" }
  | { kind: "not-found" };

const RECEIVED: SubmitEditOutcome = { kind: "received" };
const NOT_FOUND: SubmitEditOutcome = { kind: "not-found" };

/** What the save does to the photo, once an uploaded one is stored; or why it was turned away. */
async function photoChange(
  request: PhotoRequest,
  photos: PhotoServices,
): Promise<EditPhotoChange | { kind: "rejected"; errors: RegistrationErrors }> {
  if (request.kind !== "upload") return request;
  const stored = await storePhoto(request.file, photos);
  return stored.kind === "stored"
    ? { kind: "replace", key: stored.key }
    : { kind: "rejected", errors: { photo: stored.error } };
}

export async function submitEdit(
  form: FormData,
  target: EditTarget,
  deps: SubmitEditDeps,
): Promise<SubmitEditOutcome> {
  try {
    return await deps.useDb(async (db) => {
      const link = await resolveManagementLink(db, target.locality.code, target.token);
      if (link === null) return NOT_FOUND;
      if (isHoneypotFilled(form)) return RECEIVED;
      const turnstile = await checkTurnstile(db, form, "edit", deps.verifyTurnstile);
      if (!passesTurnstile(turnstile)) return { kind: "turnstile" };
      const edit = await editForm(db, target.locality, link.businessId);
      if (edit === null) return NOT_FOUND;
      const validation = validateEdit(form, edit.catalogue);
      if (validation.kind === "invalid") return validation;
      const quota = await deps.takeQuota();
      if (!quota.allowed) return { kind: "quota" };

      const photo = await photoChange(validation.photo, deps.photos);
      if (photo.kind === "rejected") return { kind: "invalid", errors: photo.errors };
      const stored = photo.kind === "replace" ? photo.key : null;
      let saved;
      try {
        saved = await savePendingEdit(
          db,
          target.locality.code,
          link,
          validation.registration,
          photo,
        );
      } catch (error) {
        if (stored !== null) await deletePhoto(deps.photos.bucket, stored);
        throw error;
      }
      if (saved.kind !== "saved") {
        if (stored !== null) await deletePhoto(deps.photos.bucket, stored);
        return saved.kind === "taken"
          ? { kind: "invalid", errors: { whatsapp: "taken" } }
          : NOT_FOUND;
      }
      if (saved.droppedPhotoKey !== null) {
        await deletePhoto(deps.photos.bucket, saved.droppedPhotoKey);
      }
      return RECEIVED;
    });
  } catch (error) {
    console.error(`edit: an edit could not be saved (${failureKind(error)})`);
    return { kind: "server" };
  }
}
