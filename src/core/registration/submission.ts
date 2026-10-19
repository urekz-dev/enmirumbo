// What a registration form sends, read on the server
// (docs/specs/business-registration.md, "Required and optional form fields",
// "The server normalizes and validates the WhatsApp to 10 digits", "The
// server validates every field and returns per-field errors in Spanish",
// "Consent with a visible simplified notice and a consent record", "Nobody
// consents to a notice version they did not have in front of them", "The
// zone is typed with the locality's zones as suggestions, and a name that is
// none of them is kept as "Otra" (v2)", "The photo field explains the PRD
// §6.1 policy and opens the phone gallery" and "Resubmission after a
// rejection allows changing or removing the photo"). The form works without
// JavaScript and a submission can arrive without it, so every rule is
// enforced here, on whatever arrives: no browser validation is trusted, and
// only the fields below are read. Status, origin, the consent record, the search text, the
// management link, the trades and the dates are never read from a
// submission, so no field can set them. Everything here is pure.
import { nationalNumber } from "../business/contact.ts";
import { boundedText, formText, isChecked } from "../forms/text.ts";
import { NOTICE_VERSION } from "../legal/version.ts";
import { MAX_PHOTO_BYTES, PHOTO_FORMATS } from "../photos/limits.ts";
import { TURNSTILE_FAILED_MESSAGE } from "../turnstile/keys.ts";
import type { RegistrationCatalogue } from "./catalogue.ts";
import { chooseZone } from "./zone.ts";

/** The names of the form's fields, in the order of the screen. */
export const REGISTRATION_FIELDS = {
  name: "name",
  category: "category",
  whatsapp: "whatsapp",
  zone: "zone",
  whatYouOffer: "whatYouOffer",
  homeDelivery: "homeDelivery",
  landline: "landline",
  address: "address",
  openingHours: "openingHours",
  facebookUrl: "facebookUrl",
  photo: "photo",
  removePhoto: "removePhoto",
  noticeVersion: "noticeVersion",
  consent: "consent",
} as const;

/** The fields a person types, and the longest each may be, in the units `maxlength` counts. */
export const MAX_LENGTHS = {
  name: 80,
  whatsapp: 30,
  zone: 80,
  whatYouOffer: 200,
  landline: 20,
  address: 200,
  openingHours: 100,
  facebookUrl: 300,
} as const;

export type TextField = keyof typeof MAX_LENGTHS;

/** The fields an error is shown next to, in the order of the screen. */
export const ERROR_FIELDS = [
  "name",
  "category",
  "whatsapp",
  "zone",
  "whatYouOffer",
  "landline",
  "address",
  "openingHours",
  "facebookUrl",
  "photo",
  "consent",
] as const;

export type ErrorField = (typeof ERROR_FIELDS)[number];

/** Why each field can come back, and nothing else. */
export const ERROR_CODES = {
  name: ["required", "length"],
  category: ["required"],
  // `taken` is the edit's: the number of another card (src/core/edit/).
  whatsapp: ["invalid", "duplicate", "taken"],
  zone: ["required", "length"],
  whatYouOffer: ["length"],
  landline: ["invalid", "length"],
  address: ["length"],
  openingHours: ["length"],
  facebookUrl: ["invalid", "length"],
  // src/core/photos/upload.ts says when each happens.
  photo: ["too-large", "unreadable", "busy", "failed"],
  consent: ["required", "notice-changed"],
} as const satisfies Record<ErrorField, readonly string[]>;

export type ErrorCode<F extends ErrorField = ErrorField> = (typeof ERROR_CODES)[F][number];

/** The error of each field that has one. */
export type RegistrationErrors = { [F in ErrorField]?: ErrorCode<F> };

/** "Deja esto en 200 caracteres o menos": the spec's literal, for any field and its limit. */
export function lengthMessage(max: number): string {
  return `Deja esto en ${max} caracteres o menos`;
}

/** What the form says next to each field, literally the spec's. */
const MESSAGES: { [F in ErrorField]: Record<ErrorCode<F>, string> } = {
  name: { required: "Escribe el nombre de tu negocio", length: lengthMessage(MAX_LENGTHS.name) },
  category: { required: "Elige una categoría" },
  whatsapp: {
    invalid: "Revisa tu número de WhatsApp: deben ser 10 dígitos",
    duplicate:
      "Este número ya tiene una ficha registrada. Si es tu negocio, no hace falta registrarlo otra vez: te vamos a pasar por WhatsApp el enlace para editarlo.",
    taken: "Ese número ya está en otra ficha del directorio.",
  },
  zone: { required: "Escribe el nombre de tu colonia", length: lengthMessage(MAX_LENGTHS.zone) },
  whatYouOffer: { length: lengthMessage(MAX_LENGTHS.whatYouOffer) },
  landline: {
    invalid:
      "Revisa el teléfono fijo: escribe solo números (puedes usar espacios, guiones o paréntesis)",
    length: lengthMessage(MAX_LENGTHS.landline),
  },
  address: { length: lengthMessage(MAX_LENGTHS.address) },
  openingHours: { length: lengthMessage(MAX_LENGTHS.openingHours) },
  facebookUrl: {
    invalid: "El link de Facebook debe empezar con http:// o https://",
    length: lengthMessage(MAX_LENGTHS.facebookUrl),
  },
  photo: {
    "too-large": "Esa foto pesa más de 5 MB. Sube una más ligera.",
    unreadable: "No pudimos leer esa foto. Sube una imagen JPG, PNG o WebP.",
    busy: "Estamos recibiendo muchas fotos, intenta de nuevo en un momento",
    failed: "No pudimos procesar tu foto. Intenta con otra o envía tu registro sin foto.",
  },
  consent: {
    required: "Marca la casilla para poder registrar tu negocio",
    "notice-changed":
      "El aviso de privacidad cambió mientras llenabas esto. Léelo otra vez y vuelve a marcar la casilla.",
  },
};

/**
 * What the photo field says when the form comes back for any other reason
 * and the submission carried a photo: no browser fills a file field again,
 * and nothing of that submission was kept on the server.
 */
export const PHOTO_NOT_KEPT_MESSAGE =
  "Tu foto no se quedó guardada: vuelve a elegirla antes de enviar.";

/** The help above the photo field, the photo policy of PRD §6.1. */
export const PHOTO_POLICY =
  "Una foto de tu local, de tus productos o de tu trabajo. Que no salgan personas que se puedan reconocer. Máximo 5 MB (JPG, PNG o WebP); nosotros la comprimimos para que cargue rápido.";

/**
 * What the photo field accepts: the formats the server takes, never
 * `image/*`. A phone still opens its gallery, and iOS turns a HEIC photo
 * into a JPEG before it is sent instead of uploading a format the server
 * refuses.
 */
export const PHOTO_ACCEPT = PHOTO_FORMATS.join(",");

/** The checkbox that leaves a card without a photo, the same for everyone. */
export const REMOVE_PHOTO_LABEL = "Dejar mi ficha sin foto";

/** The message of `field` for `code`, or an empty string for a code it does not have. */
export function errorMessage(field: ErrorField, code: string): string {
  const messages: Record<string, string> = MESSAGES[field];
  return Object.hasOwn(messages, code) ? (messages[code] ?? "") : "";
}

/** Why the whole form comes back, above it, rather than next to a field. */
export type GeneralError = "turnstile" | "quota" | "server";

export const GENERAL_ERROR_MESSAGES: Readonly<Record<GeneralError, string>> = {
  turnstile: TURNSTILE_FAILED_MESSAGE,
  quota: "Ya recibimos varios registros desde aquí. Espera un rato y vuelve a intentar.",
  server: "No pudimos guardar tu registro. Vuelve a intentarlo en un momento.",
};

/**
 * What the registration page says, above the form, to a browser that does
 * not run JavaScript while Turnstile is on: the form cannot be sent then.
 */
export const NO_JAVASCRIPT_MESSAGE =
  "Para registrar tu negocio, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona.";

/**
 * What the thank-you page says, the literal of PRD §6.1, whatever the
 * submission was: a new card, a resubmission or a bot caught by the trap.
 */
export const THANK_YOU_MESSAGE =
  "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo.";

/** The submit button while the form is sent, which only the page's script shows. */
export const SENDING_TEXT = "Enviando...";

/** What a valid registration saves: the fields of the form, normalized, and nothing else. */
export interface NewRegistration {
  name: string;
  categoryId: number;
  /** Ten digits. */
  whatsapp: string;
  zoneId: number | null;
  /** The free text of "Otra", only without a catalogue zone. */
  zoneOther: string | null;
  whatYouOffer: string | null;
  homeDelivery: boolean;
  /** As the owner wrote it. */
  landline: string | null;
  address: string | null;
  openingHours: string | null;
  /** An http(s) URL, in its canonical form. */
  facebookUrl: string | null;
}

/**
 * What a valid submission asks of the photo: leave the card's as it is (a
 * new card has none), take the uploaded file, or leave the card without one
 * ("Dejar mi ficha sin foto", which wins over a file chosen with it, so the
 * file is never opened).
 */
export type PhotoRequest = { kind: "keep" } | { kind: "upload"; file: File } | { kind: "remove" };

export type RegistrationValidation =
  | { kind: "invalid"; errors: RegistrationErrors }
  | { kind: "valid"; registration: NewRegistration; photo: PhotoRequest };

/**
 * The file of the field `name`: its first value, when it is a file with
 * something in it. A file field left empty sends an empty file, which is no
 * file; further files of the same field are never read.
 */
export function uploadedFile(form: FormData, name: string): File | null {
  const value = form.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

/** The characters a WhatsApp number may be written with: digits and separators. */
const WHATSAPP_CHARACTERS = /^[0-9\s().+-]*$/;

/**
 * The WhatsApp in its ten digits, or null: spaces, hyphens, dots and
 * brackets are dropped, and the country code `+52`, `52` or `521` when ten
 * digits remain without it (nationalNumber). Any other character (a letter,
 * "no tengo") makes it no number.
 */
export function registrationWhatsapp(text: string): string | null {
  return WHATSAPP_CHARACTERS.test(text) ? nationalNumber(text) : null;
}

/**
 * Whether a landline reads as a phone number: only digits and the separators
 * people write one with (space, hyphen, brackets and `+`), and at least one
 * digit. It is saved as written.
 */
export function isLandline(text: string): boolean {
  return /^[0-9+() -]+$/.test(text) && /[0-9]/.test(text);
}

/**
 * The page link in its canonical form, or null: it must start with
 * `http://` or `https://`, parse as such, and carry no credentials
 * (`https://facebook.com@evil.example` leads to evil.example). Any domain is
 * allowed; the card shows the real one.
 */
export function pageLink(text: string): string | null {
  if (!/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.href;
}

/** What the fields of a valid submission describe: the business and what it asks of the photo. */
interface BusinessFields {
  registration: NewRegistration;
  photo: PhotoRequest;
}

/**
 * Reads the fields a business enters, against the catalogue of its locality,
 * every one at once, and notes each error in `errors`: the same rules for the
 * registration and the edit (business-registration, "The edit goes through
 * the same validations as the registration and cannot set what is not its
 * to set"). The photo is only weighed here, never opened. Null when a field
 * is wrong.
 */
function readBusinessFields(
  form: FormData,
  catalogue: RegistrationCatalogue,
  errors: RegistrationErrors,
): BusinessFields | null {
  const F = REGISTRATION_FIELDS;
  const text = (field: string) => formText(form, field).trim();

  const name = text(F.name);
  if (name === "") errors.name = "required";
  else if (name.length > MAX_LENGTHS.name) errors.name = "length";

  const categorySlug = text(F.category);
  const category = catalogue.categories.find(({ slug }) => slug === categorySlug);
  if (category === undefined) errors.category = "required";

  const whatsappText = text(F.whatsapp);
  const whatsapp =
    whatsappText.length > MAX_LENGTHS.whatsapp ? null : registrationWhatsapp(whatsappText);
  if (whatsapp === null) errors.whatsapp = "invalid";

  const zoneText = text(F.zone);
  if (zoneText === "") errors.zone = "required";
  else if (zoneText.length > MAX_LENGTHS.zone) errors.zone = "length";

  /** An optional field: null when empty, and an error past its limit. */
  const optional = (
    field: "whatYouOffer" | "landline" | "address" | "openingHours" | "facebookUrl",
  ) => {
    const value = text(F[field]);
    if (value.length > MAX_LENGTHS[field]) {
      errors[field] = "length";
      return null;
    }
    return value === "" ? null : value;
  };
  const whatYouOffer = optional("whatYouOffer");
  const landline = optional("landline");
  if (landline !== null && !isLandline(landline)) errors.landline = "invalid";
  const address = optional("address");
  const openingHours = optional("openingHours");
  const facebookText = optional("facebookUrl");
  const facebookUrl = facebookText === null ? null : pageLink(facebookText);
  if (facebookText !== null && facebookUrl === null) errors.facebookUrl = "invalid";

  // Only its weight here: the file is opened after every defense
  // (src/core/registration/submit.ts, src/core/edit/submit.ts).
  const removePhoto = isChecked(form, F.removePhoto);
  const file = removePhoto ? null : uploadedFile(form, F.photo);
  if (file !== null && file.size > MAX_PHOTO_BYTES) errors.photo = "too-large";

  if (Object.keys(errors).length > 0 || category === undefined || whatsapp === null) return null;
  return {
    registration: {
      name,
      categoryId: category.id,
      whatsapp,
      ...chooseZone(zoneText, catalogue.zones),
      whatYouOffer,
      homeDelivery: isChecked(form, F.homeDelivery),
      landline,
      address,
      openingHours,
      facebookUrl,
    },
    photo: removePhoto
      ? { kind: "remove" }
      : file === null
        ? { kind: "keep" }
        : { kind: "upload", file },
  };
}

/** The validation of `errors` and the fields they left. */
function validation(
  errors: RegistrationErrors,
  fields: BusinessFields | null,
): RegistrationValidation {
  return fields === null || Object.keys(errors).length > 0
    ? { kind: "invalid", errors }
    : { kind: "valid", ...fields };
}

/**
 * Reads and validates a registration against the catalogue of its locality,
 * every field at once, so the form comes back with every error together.
 * The consent comes last: a notice version that is not the server's
 * (`noticeVersion`), missing or forged, is the notice that changed, which
 * matters more than an unchecked box. The version only detects the
 * mismatch: the one stored is always the server's (./save.ts).
 */
export function validateRegistration(
  form: FormData,
  catalogue: RegistrationCatalogue,
  noticeVersion: string = NOTICE_VERSION,
): RegistrationValidation {
  const errors: RegistrationErrors = {};
  const fields = readBusinessFields(form, catalogue, errors);
  if (formText(form, REGISTRATION_FIELDS.noticeVersion).trim() !== noticeVersion) {
    errors.consent = "notice-changed";
  } else if (!isChecked(form, REGISTRATION_FIELDS.consent)) {
    errors.consent = "required";
  }
  return validation(errors, fields);
}

/**
 * Reads and validates the fields of a business with the registration's rules
 * and messages, and nothing else: no consent, no notice version. The edit of
 * the management link (src/core/edit/submission.ts) is this, since the
 * consent of the registration stays in force.
 */
export function validateBusinessFields(
  form: FormData,
  catalogue: RegistrationCatalogue,
): RegistrationValidation {
  const errors: RegistrationErrors = {};
  return validation(errors, readBusinessFields(form, catalogue, errors));
}

/** What the form shows again when it comes back: what the owner had written. */
export interface RegistrationDraft {
  name: string;
  /** The slug the owner chose; an unknown one chooses no option. */
  category: string;
  whatsapp: string;
  zone: string;
  whatYouOffer: string;
  homeDelivery: boolean;
  landline: string;
  address: string;
  openingHours: string;
  facebookUrl: string;
  /** Whether the submission carried a photo it did not leave out, which has to be chosen again. */
  photo: boolean;
  /** "Dejar mi ficha sin foto". */
  removePhoto: boolean;
}

/** The form before anything was written. */
export const EMPTY_REGISTRATION_DRAFT: RegistrationDraft = {
  name: "",
  category: "",
  whatsapp: "",
  zone: "",
  whatYouOffer: "",
  homeDelivery: false,
  landline: "",
  address: "",
  openingHours: "",
  facebookUrl: "",
  photo: false,
  removePhoto: false,
};

/** The longest category slug worth reading back; it is matched, never shown. */
const MAX_CATEGORY_LENGTH = 80;

/**
 * What the owner had written, read from the same submission, so it never
 * travels in an address or a cookie: each field trimmed and bounded to its
 * limit, so a forged submission cannot make the page echo a large body; the
 * page renders it as text. The consent checkbox is never kept: it has to be
 * checked again, with the notice in front of the owner; nor is the photo,
 * which no browser fills again, so the draft only says whether one was sent.
 */
export function registrationDraft(form: FormData): RegistrationDraft {
  const F = REGISTRATION_FIELDS;
  const text = (field: TextField) =>
    boundedText(formText(form, F[field]).trim(), MAX_LENGTHS[field]);
  return {
    name: text("name"),
    category: boundedText(formText(form, F.category).trim(), MAX_CATEGORY_LENGTH),
    whatsapp: text("whatsapp"),
    zone: text("zone"),
    whatYouOffer: text("whatYouOffer"),
    homeDelivery: isChecked(form, F.homeDelivery),
    landline: text("landline"),
    address: text("address"),
    openingHours: text("openingHours"),
    facebookUrl: text("facebookUrl"),
    photo: !isChecked(form, F.removePhoto) && uploadedFile(form, F.photo) !== null,
    removePhoto: isChecked(form, F.removePhoto),
  };
}
