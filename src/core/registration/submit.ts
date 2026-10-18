// A submission of the registration form, from what arrived to what the owner
// is told (docs/specs/business-registration.md, "The server validates every
// field and returns per-field errors in Spanish", "One card per WhatsApp
// number", "A successful submission queues the business and shows the
// thank-you screen", "The registration's honeypot and per-IP quota are
// those of the public forms (v2)", "Turnstile is checked on the server,
// fails closed and has a switch in the database (v2)", "Resubmission after
// a rejection allows changing or removing the photo" and "Photos are
// uploaded through the Images binding, within a ceiling of work (v2)"). The
// action of the form (src/actions/index.ts) only finds the locality of the
// page and gives this its connection, its quota, its Turnstile check and
// what the photo needs. In this order:
//
// 1. The trap field: a bot is told the registration was received, and
//    nothing else happens, not even a connection to the database.
// 2. Turnstile (../turnstile/check.ts), unless its switch is off: without a
//    valid token the form comes back, and nothing else happens.
// 3. Every field, against the catalogue of the locality: errors, and
//    nothing else happens, so a typo spends no quota. The photo is only
//    weighed here, never opened.
// 4. The per-IP quota, checked and taken in one step by its counter. It
//    comes before the number is looked up, so finding out which numbers
//    have a card takes one valid submission each, three an hour.
// 5. The photo, only now, so nothing the defenses stop costs any image
//    work: checked, transformed and stored under a new key
//    (src/core/photos/upload.ts), or turned away next to its field with
//    nothing saved.
// 6. The registration: a new card, the resubmission of a rejected one (told
//    the same as a new one, so the form never says a card was rejected), or
//    the duplicate of a card in review or published (./save.ts). When it is
//    not saved (a duplicate, a failure), the photo stored in step 5 is
//    deleted; when a resubmission replaced or removed the card's photo, the
//    old one is deleted once the card no longer names it.
//
// Nothing here writes what the owner typed, the address or anything about a
// card to the log: a failure is logged by its kind alone.
import type { Db } from "../db/client.ts";
import { failureKind } from "../db/failure.ts";
import { isHoneypotFilled } from "../forms/honeypot.ts";
import type { ServedLocality } from "../locality/served.ts";
import { deletePhoto, type PhotoServices, storePhoto } from "../photos/upload.ts";
import type { QuotaDecision } from "../quota/window.ts";
import { checkTurnstile, passesTurnstile, type VerifyTurnstile } from "../turnstile/check.ts";
import { registrationCatalogue } from "./catalogue.ts";
import { type PhotoChange, saveRegistration } from "./save.ts";
import { type PhotoRequest, type RegistrationErrors, validateRegistration } from "./submission.ts";

export interface SubmitRegistrationDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
  /** Counts this submission in the per-IP quota of the registrations, and says whether it may go on. */
  takeQuota: () => Promise<QuotaDecision>;
  /** Checks a Turnstile token with Cloudflare (src/lib/turnstile.ts), when the switch is on. */
  verifyTurnstile: VerifyTurnstile;
  /** The Images binding and the public media bucket the photo goes through. */
  photos: PhotoServices;
}

/**
 * What the owner is told: the registration was received (a new card, a
 * resubmission or a bot caught by the trap, which must look the same); the
 * form comes back with errors next to its fields (a duplicate number among
 * them, and the photo's: too large, unreadable, the server busy with other
 * photos or a failure to process it); or it comes back refused by
 * Turnstile, over the quota, or after a failure to save.
 */
export type SubmitRegistrationOutcome =
  | { kind: "received" }
  | { kind: "invalid"; errors: RegistrationErrors }
  | { kind: "turnstile" }
  | { kind: "quota" }
  | { kind: "server" };

const RECEIVED: SubmitRegistrationOutcome = { kind: "received" };

/** What the save does to the photo, once an uploaded one is stored; or why it was turned away. */
async function photoChange(
  request: PhotoRequest,
  photos: PhotoServices,
): Promise<PhotoChange | { kind: "rejected"; errors: RegistrationErrors }> {
  if (request.kind !== "upload") return request;
  const stored = await storePhoto(request.file, photos);
  return stored.kind === "stored"
    ? { kind: "set", key: stored.key }
    : { kind: "rejected", errors: { photo: stored.error } };
}

export async function submitRegistration(
  form: FormData,
  locality: Pick<ServedLocality, "code" | "name">,
  deps: SubmitRegistrationDeps,
): Promise<SubmitRegistrationOutcome> {
  if (isHoneypotFilled(form)) return RECEIVED;
  try {
    return await deps.useDb(async (db) => {
      const turnstile = await checkTurnstile(db, form, "registration", deps.verifyTurnstile);
      if (!passesTurnstile(turnstile)) return { kind: "turnstile" };
      const validation = validateRegistration(form, await registrationCatalogue(db, locality));
      if (validation.kind === "invalid") return validation;
      const quota = await deps.takeQuota();
      if (!quota.allowed) return { kind: "quota" };

      const photo = await photoChange(validation.photo, deps.photos);
      if (photo.kind === "rejected") return { kind: "invalid", errors: photo.errors };
      const stored = photo.kind === "set" ? photo.key : null;
      let saved;
      try {
        saved = await saveRegistration(db, locality.code, validation.registration, { photo });
      } catch (error) {
        if (stored !== null) await deletePhoto(deps.photos.bucket, stored);
        throw error;
      }
      if (saved.kind === "duplicate") {
        if (stored !== null) await deletePhoto(deps.photos.bucket, stored);
        return { kind: "invalid", errors: { whatsapp: "duplicate" } };
      }
      if (saved.kind === "resubmitted" && saved.droppedPhotoKey !== null) {
        await deletePhoto(deps.photos.bucket, saved.droppedPhotoKey);
      }
      return RECEIVED;
    });
  } catch (error) {
    console.error(`registration: a registration could not be saved (${failureKind(error)})`);
    return { kind: "server" };
  }
}
