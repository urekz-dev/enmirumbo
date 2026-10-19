// What the edit form of a management link says and sends
// (docs/specs/business-registration.md, "The management link opens the card
// in edit mode with the same prefilled form", "Sending the edit does not
// touch the public card: it creates a pending edit", "The edit goes through
// the same validations as the registration and cannot set what is not its
// to set", "Sending changes when others are already waiting replaces the
// previous ones" and "The edit mode of a locality lives under it, and lands
// on its confirmation (v2)"). The form is the registration's
// (src/components/RegistrationForm.astro in its edit mode), with the same
// fields, limits, rules and messages (src/core/registration/submission.ts);
// what differs is here: the texts of the edit, no consent, and what the
// form is prefilled with. Status, origin, trades, dates, the consent record
// and the link fingerprint are never read from a submission, so no field can
// set them. Everything here is pure.
import type { PendingEditPhotoChange } from "../db/schema/index.ts";
import type { RegistrationCatalogue } from "../registration/catalogue.ts";
import {
  EMPTY_REGISTRATION_DRAFT,
  type ErrorField,
  errorMessage,
  type GeneralError,
  type NewRegistration,
  type RegistrationDraft,
  type RegistrationValidation,
  validateBusinessFields,
} from "../registration/submission.ts";
import { TURNSTILE_FAILED_MESSAGE } from "../turnstile/keys.ts";

/** The heading of the edit page, its only `h1`, and its title. */
export const EDIT_HEADING = "Edita tu ficha";

/** The phrase under the heading. */
export const EDIT_PHRASE =
  "Cambia lo que necesites y lo revisamos antes de publicarlo. Mientras tanto tu ficha sigue como está.";

/** The submit button of the edit form. */
export const EDIT_SUBMIT = "Enviar cambios";

/**
 * What the edit form shows where the registration has its consent block:
 * the consent of the registration stays in force, so it is not asked again.
 * The link "Lee el aviso de privacidad completo" goes with it.
 */
export const EDIT_PRIVACY_NOTE =
  "Tus datos siguen protegidos por el mismo aviso de privacidad que aceptaste al registrarte.";

/** What the edit page says at the top while an edit of the card waits for review. */
export const PENDING_EDIT_WARNING =
  "Ojo: ya tienes cambios esperando revisión. Si mandas otros, estos reemplazan a los anteriores.";

/** The confirmation, its only `h1`, whatever the submission was (saved or caught by the trap). */
export const EDIT_THANK_YOU_MESSAGE =
  "¡Gracias! Ya recibimos tus cambios. Los revisamos y en cuanto los aprobemos tu ficha se actualiza. Mientras tanto sigue publicada como está.";

/** The static title of the confirmation, which names nothing of the card. */
export const EDIT_THANKS_TITLE = "Gracias por tus cambios";

/** Why the edit form comes back, above it: the edit's own literals. */
export const EDIT_GENERAL_ERROR_MESSAGES: Readonly<Record<GeneralError, string>> = {
  turnstile: TURNSTILE_FAILED_MESSAGE,
  quota: "Ya recibimos varios cambios desde aquí. Espera un rato y vuelve a intentar.",
  server: "No pudimos guardar tus cambios. Vuelve a intentarlo en un momento.",
};

/**
 * What the photo field of the edit says when Images could not process the
 * photo: the registration's message speaks of a registration, so the edit
 * has its own. Every other message of a field is the registration's.
 */
export const EDIT_PHOTO_FAILED_MESSAGE =
  "No pudimos procesar tu foto. Intenta con otra o envía tus cambios sin cambiar la foto.";

/** The message next to `field` of the edit form for `code`: the registration's, but its own failed photo. */
export function editErrorMessage(field: ErrorField, code: string): string {
  return field === "photo" && code === "failed"
    ? EDIT_PHOTO_FAILED_MESSAGE
    : errorMessage(field, code);
}

/**
 * What the photo field of the edit says when the edit waiting carries a new
 * photo, which a submission without a file or "Dejar mi ficha sin foto"
 * keeps (./save.ts): no browser can show it in the file field.
 */
export const EDIT_PHOTO_KEPT_NOTE =
  "La foto nueva que nos mandaste se queda, a menos que elijas otra.";

/**
 * What the edit page says, above the form, to a browser that does not run
 * JavaScript while Turnstile is on: the form cannot be sent then.
 */
export const EDIT_NO_JAVASCRIPT_MESSAGE =
  "Para editar tu ficha, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona.";

/**
 * Reads and validates an edit with the registration's rules and literal
 * messages, every field at once, against the catalogue of the card's
 * locality (editForm, ./card.ts). Nothing about consent: the registration's
 * stays in force. Whether the WhatsApp is another card's is decided when the
 * edit is saved (./save.ts).
 */
export function validateEdit(
  form: FormData,
  catalogue: RegistrationCatalogue,
): RegistrationValidation {
  return validateBusinessFields(form, catalogue);
}

/** The fields a form is prefilled with: a published card, or the edit it has waiting. */
export type EditableFields = NewRegistration;

/** What an edit waiting for review proposes: its fields and what it asks of the photo. */
export interface WaitingEditFields extends EditableFields {
  photoChange: PendingEditPhotoChange;
}

/**
 * The form prefilled with `fields`: the category by its slug, the zone by
 * the name it is shown with, or the free text of "Otra" as it was written,
 * and the optional fields as they are, empty when they are null. No photo was
 * sent from it, and "Dejar mi ficha sin foto" is checked only when
 * `removePhoto`.
 */
function draftOf(
  fields: EditableFields,
  catalogue: RegistrationCatalogue,
  removePhoto: boolean,
): RegistrationDraft {
  const category = catalogue.categories.find(({ id }) => id === fields.categoryId);
  const zone =
    fields.zoneId === null
      ? (fields.zoneOther ?? "")
      : (catalogue.zones.find(({ id }) => id === fields.zoneId)?.displayName ?? "");
  return {
    ...EMPTY_REGISTRATION_DRAFT,
    name: fields.name,
    category: category?.slug ?? "",
    whatsapp: fields.whatsapp,
    zone,
    whatYouOffer: fields.whatYouOffer ?? "",
    homeDelivery: fields.homeDelivery,
    landline: fields.landline ?? "",
    address: fields.address ?? "",
    openingHours: fields.openingHours ?? "",
    facebookUrl: fields.facebookUrl ?? "",
    removePhoto,
  };
}

/** The edit form of a card with no edit waiting: its published data. */
export function cardDraft(
  card: EditableFields,
  catalogue: RegistrationCatalogue,
): RegistrationDraft {
  return draftOf(card, catalogue, false);
}

/**
 * The edit form of a card with an edit waiting: what the owner sent last
 * time, so they do not have to write it again, with "Dejar mi ficha sin
 * foto" checked when that edit removes the photo. A new photo it carried
 * cannot be put back in a file field: the form says it stays
 * (EDIT_PHOTO_KEPT_NOTE).
 */
export function waitingEditDraft(
  edit: WaitingEditFields,
  catalogue: RegistrationCatalogue,
): RegistrationDraft {
  return draftOf(edit, catalogue, edit.photoChange === "remove");
}
