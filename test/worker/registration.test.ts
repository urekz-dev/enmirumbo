// Scenarios of docs/specs/business-registration.md for the registration,
// below the page: what a submission is (src/core/registration/submission.ts,
// src/core/registration/zone.ts, src/core/forms/), what the form offers
// (src/core/registration/catalogue.ts, examples.ts), how it is decided and
// saved (src/core/registration/submit.ts, save.ts) with the database and the
// quota counter, and how the action and the page read it
// (src/lib/registration.ts). "Required and optional form fields", "The
// "¿Qué ofreces?" example adapts to the chosen category", "The server
// normalizes and validates the WhatsApp to 10 digits", "The server validates
// every field and returns per-field errors in Spanish", "One card per
// WhatsApp number", "Consent with a visible simplified notice and a consent
// record", "Nobody consents to a notice version they did not have in front
// of them", "Zone "Otra" with free text pending normalization", "A
// successful submission queues the business and shows the thank-you
// screen", "The registration leaves the card ready for the search", "The
// zone options come from the active locality (v2)", "The zone is chosen from
// the zones of the postal code the business types, or written when it does
// not appear (v2)", "The registration's honeypot and per-IP quota are
// those of the public forms (v2)" and "The registration page of a locality
// lives under it, and lands on its thank-you page (v2)"; and of
// docs/specs/data-model.md, "The consent record stores which notice version
// it was given against" and "One card per WhatsApp number within a locality
// (v2)" and "A business and its pending edit store the postal code the owner
// typed (v2)". The form and its pages are rendered in
// test/astro/registration.test.ts and run end to end in
// test/e2e/registration.spec.ts.
//
// The businesses belong to the fixture localities of this file, which
// `cleanup` removes. Tizayuca is only read. Every address is from the range
// reserved for documentation 198.51.100.0/24, so none is a real person's,
// and every number follows 771999xxxx.
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { ActionError } from "astro:actions";
import { businesses, businessTrades, zones } from "../../src/core/db/schema/index.ts";
import { HONEYPOT_FIELD } from "../../src/core/forms/honeypot.ts";
import { boundedText, formText, isChecked } from "../../src/core/forms/text.ts";
import { CONSENT_CHECKBOX } from "../../src/core/legal/privacy-notice.ts";
import { isLaterNoticeVersion, NOTICE_VERSION } from "../../src/core/legal/version.ts";
import { QUOTAS } from "../../src/core/quota/quotas.ts";
import {
  type RegistrationCatalogue,
  registrationCatalogue,
  zoneOptions,
} from "../../src/core/registration/catalogue.ts";
import {
  GENERIC_WHAT_YOU_OFFER_EXAMPLE,
  WHAT_YOU_OFFER_EXAMPLES,
  whatYouOfferExample,
} from "../../src/core/registration/examples.ts";
import {
  REGISTRATION_SEGMENT,
  registrationPath,
  registrationThanksPath,
} from "../../src/core/registration/paths.ts";
import { saveRegistration } from "../../src/core/registration/save.ts";
import {
  EMPTY_REGISTRATION_DRAFT,
  ERROR_CODES,
  ERROR_FIELDS,
  errorMessage,
  GENERAL_ERROR_MESSAGES,
  isLandline,
  MAX_LENGTHS,
  type NewRegistration,
  pageLink,
  REGISTRATION_FIELDS as F,
  registrationDraft,
  registrationWhatsapp,
  THANK_YOU_MESSAGE,
  validateRegistration,
} from "../../src/core/registration/submission.ts";
import {
  submitRegistration,
  type SubmitRegistrationDeps,
  type SubmitRegistrationOutcome,
} from "../../src/core/registration/submit.ts";
import {
  chooseZone,
  OTHER_ZONE,
  postalCodeGroups,
  type ZoneOption,
  zoneHasPostalCode,
} from "../../src/core/registration/zone.ts";
import { isPostalCode } from "../../src/core/catalogue/postal-code.ts";
import { TURNSTILE_DUMMY_TOKEN, TURNSTILE_RESPONSE_FIELD } from "../../src/core/turnstile/keys.ts";
import { RESERVED_SEGMENTS } from "../../src/core/catalogue/root-urls.ts";
import { mediaBucket } from "../../src/lib/media-bucket.ts";
import { CLIENT_IP_HEADER, takeQuota } from "../../src/lib/quota/quota.ts";
import {
  decodeErrors,
  encodeErrors,
  REGISTRATION_ROUTE,
  registrationActionError,
  registrationLocality,
  registrationPageFailure,
} from "../../src/lib/registration.ts";
import { LOCALITY_DISALLOW } from "../../src/lib/robots.ts";
import { turnstileVerifier } from "../../src/lib/turnstile.ts";
import {
  cleanup,
  createFixture,
  db,
  type Fixture,
  fakePostalCode,
  insertBusiness,
} from "./fixtures.ts";

const STATE = "83";
let f: Fixture;
/** The fixture locality A as the action passes it: its code and its name. */
let localityA: { code: string; name: string };
/** The catalogue of locality A. */
let catalogue: RegistrationCatalogue;
/** A category of the fixtures, by slug, and its id. */
let category: { id: number; slug: string };

/** The fixture's "Centro" has the postal code 1; the zones this file adds, 1, 3, 4, 5 or none. */
const POSTAL_CODE = {
  centro: fakePostalCode(STATE, 1),
  carmen: fakePostalCode(STATE, 3),
  haciendas: fakePostalCode(STATE, 4),
  chopo: fakePostalCode(STATE, 5),
  /** A postal code no zone of the fixtures has. */
  none: fakePostalCode(STATE, 9),
};

/** Zones of locality A this file adds, beside the fixture's "Centro". */
const EXTRA_ZONES = [
  { type: "Colonia", name: "El Carmen", slug: "colonia-el-carmen", postalCode: POSTAL_CODE.carmen },
  {
    type: "Fraccionamiento",
    name: "El Carmen",
    slug: "fraccionamiento-el-carmen",
    postalCode: POSTAL_CODE.carmen,
  },
  {
    type: "Fraccionamiento",
    name: "Haciendas de Pueblo Uno",
    slug: "haciendas-de-pueblo-uno",
    postalCode: POSTAL_CODE.haciendas,
  },
  { type: "Colonia", name: "Ángeles", slug: "angeles", postalCode: POSTAL_CODE.centro },
  {
    type: "Rancho",
    name: "El Chopo",
    slug: "rancho-el-chopo",
    visible: false,
    postalCode: POSTAL_CODE.chopo,
  },
  { type: "Pueblo", name: "El Chopo", slug: "pueblo-el-chopo", postalCode: POSTAL_CODE.chopo },
  {
    type: "Colonia",
    name: "Oculta",
    slug: "oculta",
    visible: false,
    postalCode: POSTAL_CODE.centro,
  },
  // Added by the admin before zones had a postal code.
  { type: "Colonia", name: "Sin Código", slug: "sin-codigo", postalCode: null },
];

beforeAll(async () => {
  f = await createFixture(STATE);
  localityA = { code: f.localityA, name: "Pueblo Uno" };
  await db((tx) =>
    tx.insert(zones).values(EXTRA_ZONES.map((zone) => ({ ...zone, localityCode: f.localityA }))),
  );
  catalogue = await db((tx) => registrationCatalogue(tx, localityA));
  const own = catalogue.categories.find(({ id }) => id === f.categoryId);
  if (!own) throw new Error("the fixture category is not in the catalogue");
  category = own;
});

afterAll(async () => {
  await cleanup(STATE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A form as a browser sends it; a list sends the field once per value. */
function form(fields: Record<string, string | string[] | Blob>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  }
  return data;
}

let phone = 0;
/** A fictitious number of this file, 7719995xxx. */
const newPhone = () => `771999${5000 + ++phone}`;

/**
 * The required fields of a valid submission, with the trap field empty
 * and the token the local Worker's Turnstile accepts (test/worker/
 * turnstile.test.ts tests the check itself).
 */
function required(
  overrides: Record<string, string | string[] | Blob> = {},
): Record<string, string | string[] | Blob> {
  return {
    [HONEYPOT_FIELD]: "",
    [TURNSTILE_RESPONSE_FIELD]: TURNSTILE_DUMMY_TOKEN,
    [F.name]: "Plomería de Mentiras",
    [F.category]: category.slug,
    [F.whatsapp]: newPhone(),
    [F.postalCode]: POSTAL_CODE.centro,
    [F.zone]: "centro",
    [F.noticeVersion]: NOTICE_VERSION,
    [F.consent]: "on",
    ...overrides,
  };
}

const valid = (overrides: Record<string, string | string[] | Blob> = {}) =>
  form(required(overrides));

/** The address of one test, from the range reserved for documentation. */
let lastAddress = 100;
const newAddress = () => `198.51.100.${++lastAddress}`;

/** The local Worker's Turnstile check, which emulates the always-pass test secret. */
const verifyTurnstile = turnstileVerifier(env);

/** The local Images binding and media bucket, as the action passes them. */
const PHOTOS = { images: env.IMAGES, bucket: mediaBucket(env) };

/**
 * What the action gives the core: a fresh connection, the registration quota
 * of `address`, the Turnstile check and what the photo needs.
 */
function deps(address: string | null = newAddress()): SubmitRegistrationDeps {
  const headers = new Headers(address === null ? {} : { [CLIENT_IP_HEADER]: address });
  return {
    useDb: db,
    takeQuota: () => takeQuota(env, headers, "registration"),
    verifyTurnstile,
    photos: PHOTOS,
  };
}

/** Dependencies that count what they are asked; the quota always lets it go on. */
function counted() {
  const calls = { connections: 0, quota: 0, turnstile: 0 };
  const using: SubmitRegistrationDeps = {
    useDb: (run) => {
      calls.connections += 1;
      return db(run);
    },
    takeQuota: async () => {
      calls.quota += 1;
      return { allowed: true };
    },
    verifyTurnstile: (token, action) => {
      calls.turnstile += 1;
      return verifyTurnstile(token, action);
    },
    photos: PHOTOS,
  };
  return { calls, using };
}

const submit = (data: FormData, using: SubmitRegistrationDeps = deps()) =>
  submitRegistration(data, localityA, using);

const RECEIVED: SubmitRegistrationOutcome = { kind: "received" };

/** The business of `whatsapp` in locality A, or undefined. */
async function businessOf(whatsapp: string, localityCode = f.localityA) {
  const [row] = await db((tx) =>
    tx
      .select()
      .from(businesses)
      .where(and(eq(businesses.localityCode, localityCode), eq(businesses.whatsapp, whatsapp))),
  );
  return row;
}

async function countOf(whatsapp: string): Promise<number> {
  const rows = await db((tx) =>
    tx
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.localityCode, f.localityA), eq(businesses.whatsapp, whatsapp))),
  );
  return rows.length;
}

/** The id of a zone of locality A by slug. */
async function zoneId(slug: string): Promise<number> {
  const [row] = await db((tx) =>
    tx
      .select({ id: zones.id })
      .from(zones)
      .where(and(eq(zones.localityCode, f.localityA), eq(zones.slug, slug))),
  );
  if (!row) throw new Error(`no zone ${slug}`);
  return row.id;
}

/** Validates against the catalogue of locality A. */
const validate = (data: FormData) => validateRegistration(data, catalogue);

/** The errors of a submission, or undefined when it is valid. */
function errorsOf(data: FormData) {
  const validation = validate(data);
  return validation.kind === "invalid" ? validation.errors : undefined;
}

/** What a valid submission saves. */
function registrationOf(data: FormData): NewRegistration {
  const validation = validate(data);
  if (validation.kind !== "valid") throw new Error(JSON.stringify(validation.errors));
  return validation.registration;
}

describe("Required and optional form fields", () => {
  // Scenario: registration with required fields only
  it("the required fields alone are a registration whose optional fields are empty", () => {
    const whatsapp = newPhone();
    expect(registrationOf(valid({ [F.whatsapp]: whatsapp }))).toEqual({
      name: "Plomería de Mentiras",
      categoryId: category.id,
      whatsapp,
      postalCode: POSTAL_CODE.centro,
      zoneId: catalogue.zones.find(({ name }) => name === "Centro")?.id,
      zoneOther: null,
      whatYouOffer: null,
      homeDelivery: false,
      landline: null,
      address: null,
      openingHours: null,
      facebookUrl: null,
    });
  });

  it("the optional fields are read as written, trimmed; the delivery box is yes or no", () => {
    const registration = registrationOf(
      valid({
        [F.whatYouOffer]: "  destape de drenajes\r\ny bombas  ",
        [F.homeDelivery]: "on",
        [F.landline]: "(775) 123-45-67",
        [F.address]: "a un lado de la primaria",
        [F.openingHours]: "Solo fines de semana",
        [F.facebookUrl]: "https://facebook.com/minegocio",
      }),
    );
    expect(registration).toMatchObject({
      whatYouOffer: "destape de drenajes\ny bombas",
      homeDelivery: true,
      landline: "(775) 123-45-67",
      address: "a un lado de la primaria",
      openingHours: "Solo fines de semana",
      facebookUrl: "https://facebook.com/minegocio",
    });
    // Only what a browser sends for a checked box is a yes.
    for (const value of ["", "off", "false", "yes", "1"]) {
      expect(registrationOf(valid({ [F.homeDelivery]: value })).homeDelivery, value).toBe(false);
    }
  });

  // Scenarios: the opening hours remain free text; landline phone with separators
  it("the opening hours and the landline are saved exactly as written", () => {
    for (const hours of ["Solo fines de semana", "L-S 9am-7pm", "Todos los días de 8 a 8 🙂"]) {
      expect(registrationOf(valid({ [F.openingHours]: hours })).openingHours).toBe(hours);
    }
    for (const landline of ["(775) 123-45-67", "+52 775 123 4567"]) {
      expect(registrationOf(valid({ [F.landline]: landline })).landline).toBe(landline);
    }
  });

  it("the fields of the form and their limits", () => {
    expect(F).toEqual({
      name: "name",
      category: "category",
      whatsapp: "whatsapp",
      postalCode: "postalCode",
      zone: "zone",
      zoneOther: "zoneOther",
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
    });
    expect(MAX_LENGTHS.whatYouOffer).toBe(200);
    expect(MAX_LENGTHS.postalCode).toBe(5);
    expect(MAX_LENGTHS.zoneOther).toBe(80);
  });
});

describe('The "¿Qué ofreces?" example adapts to the chosen category', () => {
  // Scenarios: home services example; sports example
  it("each of the 8 categories has its example, the two of the spec literally", () => {
    expect(whatYouOfferExample("servicios-del-hogar")).toBe(
      "ej. plomería, destape de drenajes, bombas de agua",
    );
    expect(whatYouOfferExample("clubes-y-escuelas-deportivas")).toBe(
      "ej. futbol infantil 6-12 años, entrenamientos martes y jueves",
    );
    expect(Object.keys(WHAT_YOU_OFFER_EXAMPLES)).toEqual([
      "restaurantes-y-fondas",
      "servicios-del-hogar",
      "belleza",
      "salud",
      "abarrotes-y-comercio",
      "talleres",
      "clubes-y-escuelas-deportivas",
      "otro",
    ]);
    for (const example of Object.values(WHAT_YOU_OFFER_EXAMPLES)) {
      expect(example).toMatch(/^ej\. /);
    }
  });

  it("the categories of the catalogue are those 8, in catalogue order", async () => {
    const slugs = catalogue.categories
      .map(({ slug }) => slug)
      .filter((slug) => !slug.startsWith("categoria-prueba-"));
    expect(slugs).toEqual(Object.keys(WHAT_YOU_OFFER_EXAMPLES));
  });

  it("while no category is chosen, or for one with no example, the generic example", () => {
    for (const slug of [null, undefined, "", "constructor", "toString", category.slug]) {
      expect(whatYouOfferExample(slug), String(slug)).toBe(GENERIC_WHAT_YOU_OFFER_EXAMPLE);
    }
    expect(GENERIC_WHAT_YOU_OFFER_EXAMPLE).toBe("ej. palabras clave de lo que ofreces");
  });
});

describe("The server normalizes and validates the WhatsApp to 10 digits", () => {
  // Scenario: variants of the same number are saved the same way
  it("every way of writing the same number is its ten digits", () => {
    for (const written of [
      "+52 771 999 4567",
      "771-999-4567",
      "7719994567",
      "(771) 999.45.67",
      "52 7719994567",
      "521 771 999 4567",
      "+521 (771) 999-4567",
    ]) {
      expect(registrationWhatsapp(written), written).toBe("7719994567");
      expect(registrationOf(valid({ [F.whatsapp]: ` ${written} ` })).whatsapp, written).toBe(
        "7719994567",
      );
    }
  });

  // Scenarios: number with fewer than 10 digits; text that is not a number;
  // normalization happens even if the browser does not validate
  it("anything else is the WhatsApp error", () => {
    for (const written of [
      "77199945",
      "no tengo",
      "771 123 45",
      "",
      "77199945671",
      "53 7719994567",
      "tel 7719994567",
      "7719994567 ext",
      // Past its 30 characters, however few digits.
      `771${" ".repeat(25)}9994567`,
    ]) {
      expect(errorsOf(valid({ [F.whatsapp]: written }))?.whatsapp, written).toBe("invalid");
    }
    expect(errorMessage("whatsapp", "invalid")).toBe(
      "Revisa tu número de WhatsApp: deben ser 10 dígitos",
    );
  });
});

describe("The server validates every field and returns per-field errors in Spanish", () => {
  // Scenario: empty required fields
  it("an empty submission is an error next to each required field", () => {
    expect(errorsOf(new FormData())).toEqual({
      name: "required",
      category: "required",
      whatsapp: "invalid",
      postalCode: "required",
      zone: "required",
      consent: "notice-changed",
    });
    expect(errorsOf(form({ [F.noticeVersion]: NOTICE_VERSION }))).toEqual({
      name: "required",
      category: "required",
      whatsapp: "invalid",
      postalCode: "required",
      zone: "required",
      consent: "required",
    });
    // Spaces are no name, no postal code and no zone.
    expect(errorsOf(valid({ [F.name]: "   ", [F.postalCode]: "  ", [F.zone]: " \n " }))).toEqual({
      name: "required",
      postalCode: "required",
      zone: "required",
    });
  });

  it("every message is literally the spec's", () => {
    const messages = Object.fromEntries(
      ERROR_FIELDS.flatMap((field) =>
        ERROR_CODES[field].map((code) => [`${field}.${code}`, errorMessage(field, code)]),
      ),
    );
    expect(messages).toEqual({
      "name.required": "Escribe el nombre de tu negocio",
      "name.length": "Deja esto en 80 caracteres o menos",
      "category.required": "Elige una categoría",
      "whatsapp.invalid": "Revisa tu número de WhatsApp: deben ser 10 dígitos",
      "whatsapp.duplicate":
        "Este número ya tiene una ficha registrada. Si es tu negocio, no hace falta registrarlo otra vez: te vamos a pasar por WhatsApp el enlace para editarlo.",
      // The edit's (business-registration, "The edit goes through the same
      // validations as the registration and cannot set what is not its to set").
      "whatsapp.taken": "Ese número ya está en otra ficha del directorio.",
      "postalCode.required": "Escribe tu código postal",
      "postalCode.invalid": "Revisa tu código postal: deben ser 5 dígitos",
      "zone.required": "Elige tu colonia",
      "zone.postal-code":
        "Esa colonia no es de ese código postal. Revisa el código o elige otra colonia.",
      "zoneOther.required": "Escribe el nombre de tu colonia",
      "zoneOther.length": "Deja esto en 80 caracteres o menos",
      "whatYouOffer.length": "Deja esto en 200 caracteres o menos",
      "landline.invalid":
        "Revisa el teléfono fijo: escribe solo números (puedes usar espacios, guiones o paréntesis)",
      "landline.length": "Deja esto en 20 caracteres o menos",
      "address.length": "Deja esto en 200 caracteres o menos",
      "openingHours.length": "Deja esto en 100 caracteres o menos",
      "facebookUrl.invalid": "El link de Facebook debe empezar con http:// o https://",
      "facebookUrl.length": "Deja esto en 300 caracteres o menos",
      "photo.too-large": "Esa foto pesa más de 5 MB. Sube una más ligera.",
      "photo.unreadable": "No pudimos leer esa foto. Sube una imagen JPG, PNG o WebP.",
      "photo.busy": "Estamos recibiendo muchas fotos, intenta de nuevo en un momento",
      "photo.failed": "No pudimos procesar tu foto. Intenta con otra o envía tu registro sin foto.",
      "consent.required": "Marca la casilla para poder registrar tu negocio",
      "consent.notice-changed":
        "El aviso de privacidad cambió mientras llenabas esto. Léelo otra vez y vuelve a marcar la casilla.",
    });
    expect(errorMessage("name", "duplicate")).toBe("");
    expect(errorMessage("name", "toString")).toBe("");
    expect(GENERAL_ERROR_MESSAGES).toEqual({
      turnstile: "No pudimos comprobar que eres una persona. Vuelve a intentarlo.",
      quota: "Ya recibimos varios registros desde aquí. Espera un rato y vuelve a intentar.",
      server: "No pudimos guardar tu registro. Vuelve a intentarlo en un momento.",
    });
  });

  // Scenario: "¿Qué ofreces?" too long
  it('"¿Qué ofreces?" of more than 200 characters is its error; 200 are accepted, a line break counts once', () => {
    expect(errorsOf(valid({ [F.whatYouOffer]: "a".repeat(250) }))).toEqual({
      whatYouOffer: "length",
    });
    expect(registrationOf(valid({ [F.whatYouOffer]: "a".repeat(200) })).whatYouOffer).toBe(
      "a".repeat(200),
    );
    const lines = `${"a".repeat(99)}\r\n${"b".repeat(99)}`;
    expect(registrationOf(valid({ [F.whatYouOffer]: lines })).whatYouOffer).toBe(
      lines.replace("\r\n", "\n"),
    );
  });

  it("every free-text field has its limit", () => {
    const over = (max: number) => "a".repeat(max + 1);
    expect(
      errorsOf(
        valid({
          [F.name]: over(MAX_LENGTHS.name),
          [F.zone]: OTHER_ZONE,
          [F.zoneOther]: over(MAX_LENGTHS.zoneOther),
          [F.landline]: "1".repeat(MAX_LENGTHS.landline + 1),
          [F.address]: over(MAX_LENGTHS.address),
          [F.openingHours]: over(MAX_LENGTHS.openingHours),
          [F.facebookUrl]: `https://facebook.com/${over(MAX_LENGTHS.facebookUrl)}`,
        }),
      ),
    ).toEqual({
      name: "length",
      zoneOther: "length",
      landline: "length",
      address: "length",
      openingHours: "length",
      facebookUrl: "length",
    });
  });

  // Scenario: Facebook link with a disallowed scheme
  it("the Facebook link only with http:// or https://, and without credentials", () => {
    for (const link of [
      "javascript:alert(1)",
      "facebook.com/minegocio",
      "data:text/html,<b>x</b>",
      "//facebook.com/minegocio",
      "ftp://facebook.com/minegocio",
      "https:facebook.com/minegocio",
      "https://facebook.com@evil.example/",
      "https://user:pass@facebook.com/",
      "https://",
    ]) {
      expect(pageLink(link), link).toBeNull();
      expect(errorsOf(valid({ [F.facebookUrl]: link })), link).toEqual({ facebookUrl: "invalid" });
    }
    expect(pageLink("https://facebook.com/minegocio")).toBe("https://facebook.com/minegocio");
    expect(pageLink("HTTP://Facebook.com/Mi Negocio")).toBe("http://facebook.com/Mi%20Negocio");
  });

  // Scenarios: landline phone with letters; landline phone without a single digit
  it("the landline only with digits and the separators of a phone, and at least one digit", () => {
    for (const landline of ["no tengo", "llámame al celu", "()", "--", "771.999.4567", "a@b.mx"]) {
      expect(isLandline(landline), landline).toBe(false);
      expect(errorsOf(valid({ [F.landline]: landline })), landline).toEqual({
        landline: "invalid",
      });
    }
    expect(isLandline("+52 (775) 123-45-67")).toBe(true);
  });

  // Scenario: category or zone outside the catalogue
  it("a category that is not one of the catalogue is the category error", () => {
    for (const slug of ["", "inventada", "Belleza", String(category.id), "constructor"]) {
      expect(errorsOf(valid({ [F.category]: slug }))?.category, slug).toBe("required");
    }
  });

  // Scenario: the client cannot publish itself; the client cannot set the
  // search text
  it("fields the server owns are never read from a submission", () => {
    const whatsapp = newPhone();
    const registration = registrationOf(
      valid({
        [F.whatsapp]: whatsapp,
        id: "zzzzzzzzzz",
        localityCode: f.localityB,
        status: "published",
        origin: "seeded",
        publishedAt: "2026-01-01",
        managementTokenHash: "a".repeat(64),
        consentedToNoticeVersion: "1",
        consentedToNoticeAt: "2020-01-01",
        nameNormalized: "otro nombre",
        photoKey: "https://evil.example/x.png",
        zoneId: String(f.zoneB),
        trades: "1",
      }),
    );
    expect(Object.keys(registration).toSorted()).toEqual(
      [
        "name",
        "categoryId",
        "whatsapp",
        "postalCode",
        "zoneId",
        "zoneOther",
        "whatYouOffer",
        "homeDelivery",
        "landline",
        "address",
        "openingHours",
        "facebookUrl",
      ].toSorted(),
    );
    expect(registration.zoneId).not.toBe(f.zoneB);
  });

  // Scenario: what was entered is not lost
  it("the draft is what the same submission wrote, trimmed and bounded, except the consent", () => {
    expect(
      registrationDraft(
        valid({
          [F.name]: "  Tacos <b>Doña</b>  ",
          [F.whatsapp]: "771 999 45",
          [F.postalCode]: " 438150000 ",
          [F.zone]: OTHER_ZONE,
          [F.zoneOther]: `  Rinconada ${"b".repeat(200)}`,
          [F.whatYouOffer]: "a".repeat(5000),
          [F.homeDelivery]: "on",
          [F.landline]: "no tengo",
          [F.address]: "</textarea><script>x</script>",
          [F.openingHours]: "L-S",
          [F.facebookUrl]: "facebook.com/x",
        }),
      ),
    ).toEqual({
      name: "Tacos <b>Doña</b>",
      category: category.slug,
      whatsapp: "771 999 45",
      postalCode: "43815",
      zone: OTHER_ZONE,
      zoneOther: `Rinconada ${"b".repeat(70)}`,
      whatYouOffer: "a".repeat(200),
      homeDelivery: true,
      landline: "no tengo",
      address: "</textarea><script>x</script>",
      openingHours: "L-S",
      facebookUrl: "facebook.com/x",
      photo: false,
      removePhoto: false,
    });
    expect(Object.keys(EMPTY_REGISTRATION_DRAFT)).not.toContain("consent");
    expect(registrationDraft(new FormData())).toEqual(EMPTY_REGISTRATION_DRAFT);
    expect(registrationDraft(form({ [F.name]: new Blob(["x"]) }))).toEqual(
      EMPTY_REGISTRATION_DRAFT,
    );
  });

  it("the form's text: first value, line breaks as one, no NUL, bounded without splitting a character", () => {
    expect(formText(form({ x: ["uno", "dos"] }), "x")).toBe("uno");
    expect(formText(form({ x: "a\r\nb\rc\0d" }), "x")).toBe("a\nb\ncd");
    expect(formText(form({ x: new Blob(["x"]) }), "x")).toBe("");
    expect(boundedText(`${"a".repeat(9)}🙂`, 10)).toBe("a".repeat(9));
    expect(boundedText("abc", 10)).toBe("abc");
    expect(isChecked(form({ x: "on" }), "x")).toBe(true);
    expect(isChecked(form({ x: "true" }), "x")).toBe(false);
  });

  // Scenario: save failure
  it("a server failure is told without detail, and the log keeps nothing the owner wrote", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error("connection lost saving Plomería Secreta"), {
      code: "57P01",
    });
    const outcome = await submit(
      valid({ [F.name]: "Plomería Secreta", [F.whatsapp]: "7719994999" }),
      {
        useDb: () => Promise.reject(failure),
        takeQuota: async () => ({ allowed: true }),
        verifyTurnstile,
        photos: PHOTOS,
      },
    );
    expect(outcome).toEqual({ kind: "server" });
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("PostgreSQL 57P01");
    for (const secret of ["Secreta", "7719994999", "198.51.100"]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe("Consent with a visible simplified notice and a consent record", () => {
  // Scenario: without the checkbox there is no submission
  it("without the checkbox, or with anything a browser does not send for it, nothing is saved", async () => {
    for (const consent of [undefined, "", "off", "false", "yes", "true"]) {
      const fields = required();
      if (consent === undefined) delete fields[F.consent];
      else fields[F.consent] = consent;
      expect(errorsOf(form(fields)), String(consent)).toEqual({ consent: "required" });
    }
    const whatsapp = newPhone();
    const outcome = await submit(valid({ [F.whatsapp]: whatsapp, [F.consent]: "" }));
    expect(outcome).toEqual({ kind: "invalid", errors: { consent: "required" } });
    expect(await businessOf(whatsapp)).toBeUndefined();
    expect(CONSENT_CHECKBOX).toBe(
      "Acepto el aviso de privacidad y confirmo que este negocio es mío o que tengo permiso para registrarlo.",
    );
  });

  // Scenario: consent record; data-model, "creation with its version"
  it("a saved registration has the moment the server saved it and the version in force", async () => {
    const whatsapp = newPhone();
    const before = Date.now();
    expect(await submit(valid({ [F.whatsapp]: whatsapp }))).toEqual(RECEIVED);
    const saved = await businessOf(whatsapp);
    expect(saved?.consentedToNoticeVersion).toBe(NOTICE_VERSION);
    expect(saved?.consentedToNoticeAt.getTime()).toBe(saved?.registeredAt.getTime());
    expect(saved?.consentedToNoticeAt.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(saved?.consentedToNoticeAt.getTime()).toBeLessThanOrEqual(Date.now() + 5000);
    expect(saved?.reconsentedToNoticeAt).toBeNull();
    expect(saved?.reconsentedToNoticeVersion).toBeNull();
  });
});

describe("Nobody consents to a notice version they did not have in front of them", () => {
  // Scenarios: the notice changed mid-entry; invented version in the submission
  it("a version that is not the one in force, or none, is the notice-changed error and saves nothing", async () => {
    const earlier = String(Number(NOTICE_VERSION) - 1);
    for (const version of [earlier, String(Number(NOTICE_VERSION) + 1), "", "2-legal", " "]) {
      expect(errorsOf(valid({ [F.noticeVersion]: version })), version).toEqual({
        consent: "notice-changed",
      });
    }
    const fields = required();
    delete fields[F.noticeVersion];
    expect(errorsOf(form(fields))).toEqual({ consent: "notice-changed" });
    // It wins over an unchecked box.
    expect(errorsOf(valid({ [F.noticeVersion]: earlier, [F.consent]: "" }))).toEqual({
      consent: "notice-changed",
    });

    const whatsapp = newPhone();
    const outcome = await submit(valid({ [F.whatsapp]: whatsapp, [F.noticeVersion]: earlier }));
    expect(outcome).toEqual({ kind: "invalid", errors: { consent: "notice-changed" } });
    expect(await businessOf(whatsapp)).toBeUndefined();
  });

  // Scenarios: retry after the change; the stored version is set by the server
  it("the stored version is always the server's", async () => {
    const whatsapp = newPhone();
    // With the version in force, whatever else the submission says about it.
    expect(await submit(valid({ [F.whatsapp]: whatsapp, consentedToNoticeVersion: "99" }))).toEqual(
      RECEIVED,
    );
    expect((await businessOf(whatsapp))?.consentedToNoticeVersion).toBe(NOTICE_VERSION);
    // A server whose version is another stores its own.
    const later = String(Number(NOTICE_VERSION) + 1);
    const other = newPhone();
    const registration = registrationOf(valid({ [F.whatsapp]: other }));
    await db((tx) => saveRegistration(tx, f.localityA, registration, { noticeVersion: later }));
    expect((await businessOf(other))?.consentedToNoticeVersion).toBe(later);
  });

  it('"later" is an order of whole numbers; a missing or odd version compares with none', () => {
    expect(isLaterNoticeVersion("2", "1")).toBe(true);
    expect(isLaterNoticeVersion("10", "9")).toBe(true);
    expect(isLaterNoticeVersion("2", "2")).toBe(false);
    expect(isLaterNoticeVersion("1", "2")).toBe(false);
    expect(isLaterNoticeVersion("2", null)).toBe(false);
    expect(isLaterNoticeVersion("2-legal", "1")).toBe(false);
    expect(isLaterNoticeVersion("2", "1-legal")).toBe(false);
  });
});

describe("The zone is chosen from the zones of the postal code the business types, or written when it does not appear (v2)", () => {
  const zone = (id: number, slug: string, displayName: string, postalCode: string | null) => ({
    id,
    slug,
    name: displayName.replace(/ \(.*\)$/, ""),
    displayName,
    postalCode,
  });
  const options: ZoneOption[] = [
    zone(1, "haciendas-de-tizayuca", "Haciendas de Tizayuca", "43815"),
    zone(2, "colonia-el-carmen", "El Carmen (Colonia)", "43815"),
    zone(3, "huicalco", "Huicalco", "43808"),
    zone(4, "tizayuca-centro", "Tizayuca Centro", "43800"),
    zone(5, "nueva", "Nueva", null),
  ];
  const choose = (value: string, other = "", postalCode: string | null = "43815") =>
    chooseZone(value, other, postalCode, options, 80);

  it("a postal code is exactly five digits", () => {
    expect(isPostalCode("43815")).toBe(true);
    expect(isPostalCode("01000")).toBe(true);
    for (const text of ["", "4381", "438155", "43 815", " 43815", "4381a", "٤٣٨١٥", "43815\n"]) {
      expect(isPostalCode(text), text).toBe(false);
    }
    // The server trims what arrives, and nothing else.
    expect(registrationOf(valid({ [F.postalCode]: ` ${POSTAL_CODE.centro} ` })).postalCode).toBe(
      POSTAL_CODE.centro,
    );
    for (const text of ["4381", "438155", "43 815", "C.P. 43815", "cuatro", "٤٣٨١٥"]) {
      expect(errorsOf(valid({ [F.postalCode]: text })), text).toEqual({ postalCode: "invalid" });
    }
    expect(errorsOf(valid({ [F.postalCode]: "" }))).toEqual({ postalCode: "required" });
  });

  it("a zone the form offers, by its slug, when it is of the postal code typed", () => {
    expect(choose("haciendas-de-tizayuca")).toEqual({ zoneId: 1, zoneOther: null });
    expect(choose("huicalco", "", "43808")).toEqual({ zoneId: 3, zoneOther: null });
    expect(choose("huicalco")).toEqual({ field: "zone", code: "postal-code" });
    // Without a postal code to compare with, the postal code's error is the caller's.
    expect(choose("huicalco", "", null)).toEqual({ zoneId: 3, zoneOther: null });
    // A zone without a postal code cannot be checked, so it belongs to any.
    expect(choose("nueva", "", "99999")).toEqual({ zoneId: 5, zoneOther: null });
    expect(zoneHasPostalCode(options[4]!, "43815")).toBe(true);
    expect(zoneHasPostalCode(options[2]!, "43815")).toBe(false);
    // By slug only: a name, an identifier or anything else is no zone.
    for (const value of ["", "Huicalco", "3", "inventada", "constructor", "_OTRA"]) {
      expect(choose(value), value).toEqual({ field: "zone", code: "required" });
    }
  });

  it('"Mi colonia no aparece" keeps the name written, and asks for it', () => {
    expect(choose(OTHER_ZONE, "Rinconada del Venado")).toEqual({
      zoneId: null,
      zoneOther: "Rinconada del Venado",
    });
    expect(choose(OTHER_ZONE, "")).toEqual({ field: "zoneOther", code: "required" });
    expect(choose(OTHER_ZONE, "a".repeat(81))).toEqual({ field: "zoneOther", code: "length" });
    // A catalogue zone with leftover free text keeps only the zone.
    expect(choose("colonia-el-carmen", "Rinconada")).toEqual({ zoneId: 2, zoneOther: null });
    expect(OTHER_ZONE).not.toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("the select groups the zones by postal code, in order, those without one last", () => {
    expect(
      postalCodeGroups(options).map(({ postalCode, zones }) => [
        postalCode,
        zones.map(({ id }) => id),
      ]),
    ).toEqual([
      ["43800", [4]],
      ["43808", [3]],
      ["43815", [1, 2]],
      [null, [5]],
    ]);
    expect(postalCodeGroups([])).toEqual([]);
  });

  it("the options are the visible zones with their display names, slugs and postal codes, in alphabetical order", () => {
    expect(
      catalogue.zones.map(({ displayName, slug, postalCode }) => [displayName, slug, postalCode]),
    ).toEqual([
      ["Ángeles", "angeles", POSTAL_CODE.centro],
      ["Centro", "centro", POSTAL_CODE.centro],
      ["El Carmen (Colonia)", "colonia-el-carmen", POSTAL_CODE.carmen],
      ["El Carmen (Fraccionamiento)", "fraccionamiento-el-carmen", POSTAL_CODE.carmen],
      // Its namesake is hidden, but still counts for its display name.
      ["El Chopo (Pueblo)", "pueblo-el-chopo", POSTAL_CODE.chopo],
      ["Haciendas de Pueblo Uno", "haciendas-de-pueblo-uno", POSTAL_CODE.haciendas],
      ["Sin Código", "sin-codigo", null],
    ]);
    expect(
      zoneOptions(
        [
          { id: 1, slug: "b", name: "Beta", type: "Colonia", visible: true, postalCode: "43800" },
          { id: 2, slug: "a", name: " Alfa ", type: "Colonia", visible: true, postalCode: null },
          { id: 3, slug: "c", name: "Cero", type: "Colonia", visible: false, postalCode: "43800" },
        ],
        "Pueblo",
      ),
    ).toEqual([
      { id: 2, slug: "a", name: "Alfa", displayName: "Alfa", postalCode: null },
      { id: 1, slug: "b", name: "Beta", displayName: "Beta", postalCode: "43800" },
    ]);
  });

  // Scenario: options (v2)
  it("the options of Tizayuca are its visible zones, each with its postal code, and no zone of another locality", async () => {
    const tizayuca = await db((tx) =>
      registrationCatalogue(tx, { code: "13069", name: "Tizayuca" }),
    );
    const names = tizayuca.zones.map(({ displayName }) => displayName);
    expect(names).toHaveLength(105);
    expect(names).toEqual(
      expect.arrayContaining([
        "Haciendas de Tizayuca",
        "El Carmen (Colonia)",
        "El Carmen (Fraccionamiento)",
        "Tizayuca (Zona industrial)",
      ]),
    );
    expect(names).not.toContain("Centro");
    expect(
      tizayuca.zones.filter(({ postalCode }) => !/^438[0-9]{2}$/.test(postalCode ?? "")),
    ).toEqual([]);
    expect(postalCodeGroups(tizayuca.zones)).toHaveLength(15);
    const haciendas = tizayuca.zones.find(({ name }) => name === "Haciendas de Tizayuca");
    expect(chooseZone("haciendas-de-tizayuca", "", "43815", tizayuca.zones, 80)).toEqual({
      zoneId: haciendas?.id,
      zoneOther: null,
    });
  });

  it("a registration saves the postal code and the zone it chose, or the free text, never both", async () => {
    const carmen = newPhone();
    expect(
      await submit(
        valid({
          [F.whatsapp]: carmen,
          [F.postalCode]: POSTAL_CODE.carmen,
          [F.zone]: "colonia-el-carmen",
          [F.zoneOther]: "Sobra",
        }),
      ),
    ).toEqual(RECEIVED);
    expect(await businessOf(carmen)).toMatchObject({
      postalCode: POSTAL_CODE.carmen,
      zoneId: await zoneId("colonia-el-carmen"),
      zoneOther: null,
    });

    const other = newPhone();
    expect(
      await submit(
        valid({
          [F.whatsapp]: other,
          [F.postalCode]: POSTAL_CODE.none,
          [F.zone]: OTHER_ZONE,
          [F.zoneOther]: "  Rinconada del Venado ",
        }),
      ),
    ).toEqual(RECEIVED);
    expect(await businessOf(other)).toMatchObject({
      postalCode: POSTAL_CODE.none,
      zoneId: null,
      zoneOther: "Rinconada del Venado",
    });
  });

  // Scenario: any postal code with "Mi colonia no aparece"
  it('with "Mi colonia no aparece", any five digits are its postal code', () => {
    for (const postalCode of ["43899", "01000", "99999", POSTAL_CODE.centro]) {
      expect(
        registrationOf(
          valid({ [F.postalCode]: postalCode, [F.zone]: OTHER_ZONE, [F.zoneOther]: "Nueva" }),
        ),
        postalCode,
      ).toMatchObject({ postalCode, zoneId: null, zoneOther: "Nueva" });
    }
  });

  // Scenario: a zone of another postal code
  it("a zone of another postal code than the one typed is its error, and nothing is saved", async () => {
    expect(errorsOf(valid({ [F.postalCode]: POSTAL_CODE.carmen }))).toEqual({
      zone: "postal-code",
    });
    expect(errorMessage("zone", "postal-code")).toBe(
      "Esa colonia no es de ese código postal. Revisa el código o elige otra colonia.",
    );
    // A postal code that is not one is its own error, and the zone waits for it.
    expect(errorsOf(valid({ [F.postalCode]: "0083" }))).toEqual({ postalCode: "invalid" });
    // A zone without a postal code goes with any.
    expect(
      registrationOf(valid({ [F.postalCode]: POSTAL_CODE.none, [F.zone]: "sin-codigo" })),
    ).toMatchObject({ zoneId: await zoneId("sin-codigo"), postalCode: POSTAL_CODE.none });

    const whatsapp = newPhone();
    expect(
      await submit(valid({ [F.whatsapp]: whatsapp, [F.postalCode]: POSTAL_CODE.haciendas })),
    ).toEqual({ kind: "invalid", errors: { zone: "postal-code" } });
    expect(await businessOf(whatsapp)).toBeUndefined();
  });

  // Scenarios: a zone of another locality (v2); category or zone outside the catalogue
  it("a zone of another locality, a hidden zone or an identifier is no zone the form offers: nothing is saved", async () => {
    for (const value of ["haciendas-de-tizayuca", "oculta", "rancho-el-chopo", String(f.zoneA)]) {
      expect(errorsOf(valid({ [F.zone]: value })), value).toEqual({ zone: "required" });
      const whatsapp = newPhone();
      expect(await submit(valid({ [F.whatsapp]: whatsapp, [F.zone]: value })), value).toEqual({
        kind: "invalid",
        errors: { zone: "required" },
      });
      expect(await businessOf(whatsapp), value).toBeUndefined();
    }
  });

  // Scenarios: no zone; "Otra" without text
  it('no zone chosen, or "Mi colonia no aparece" without its name, is its error', () => {
    expect(errorsOf(valid({ [F.zone]: "" }))).toEqual({ zone: "required" });
    expect(errorMessage("zone", "required")).toBe("Elige tu colonia");
    expect(errorsOf(valid({ [F.zone]: OTHER_ZONE, [F.zoneOther]: "   " }))).toEqual({
      zoneOther: "required",
    });
    expect(errorMessage("zoneOther", "required")).toBe("Escribe el nombre de tu colonia");
  });
});

describe("A successful submission queues the business and shows the thank-you screen", () => {
  // Scenario: successful registration; the registration leaves the card ready
  // for the search
  it("the business is saved in review, organic, without trades, unpublished, in the page's locality", async () => {
    const whatsapp = newPhone();
    const outcome = await submit(
      valid({
        [F.name]: "Plomería Güicho",
        [F.whatsapp]: `+52 ${whatsapp}`,
        [F.whatYouOffer]: "Destape de drenajes y BOMBAS de agua",
      }),
    );
    expect(outcome).toEqual(RECEIVED);
    const saved = await businessOf(whatsapp);
    expect(saved).toMatchObject({
      localityCode: f.localityA,
      name: "Plomería Güicho",
      whatsapp,
      status: "in_review",
      origin: "organic",
      publishedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      managementTokenHash: null,
      managementTokenCreatedAt: null,
      photoKey: null,
      latitude: null,
      longitude: null,
      nameNormalized: "plomeria guicho",
      whatYouOfferNormalized: "destape de drenajes y bombas de agua",
    });
    expect(saved?.id).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
    const trades = await db((tx) =>
      tx
        .select()
        .from(businessTrades)
        .where(eq(businessTrades.businessId, saved?.id ?? "")),
    );
    expect(trades).toEqual([]);
  });

  // Scenario: the client cannot publish itself
  it("fields a submission adds change nothing the server owns", async () => {
    const whatsapp = newPhone();
    expect(
      await submit(
        valid({
          [F.whatsapp]: whatsapp,
          status: "published",
          origin: "seeded",
          publishedAt: "2026-01-01",
          managementTokenHash: "a".repeat(64),
          nameNormalized: "otro",
          photoKey: "aaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      ),
    ).toEqual(RECEIVED);
    expect(await businessOf(whatsapp)).toMatchObject({
      status: "in_review",
      origin: "organic",
      publishedAt: null,
      managementTokenHash: null,
      nameNormalized: "plomeria de mentiras",
      photoKey: null,
    });
  });

  it("the thank-you message, and the addresses of the form and its thank-you page", () => {
    expect(THANK_YOU_MESSAGE).toBe(
      "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo.",
    );
    const tizayuca = { slug: "tizayuca", state: { slug: "hidalgo" } };
    expect(registrationPath(tizayuca)).toBe("/hidalgo/tizayuca/registro");
    expect(registrationThanksPath(tizayuca)).toBe("/hidalgo/tizayuca/registro/gracias");
    expect(RESERVED_SEGMENTS).toContain(REGISTRATION_SEGMENT);
    expect(LOCALITY_DISALLOW).toContainEqual(["registro", "gracias"]);
    expect(LOCALITY_DISALLOW).not.toContainEqual(["registro"]);
  });

  it("a repeated identifier is answered with another one", async () => {
    const taken = await insertBusiness(f);
    const ids = [taken, "x9x9x9x9x9"];
    const whatsapp = newPhone();
    const registration = registrationOf(valid({ [F.whatsapp]: whatsapp }));
    expect(
      await db((tx) =>
        saveRegistration(tx, f.localityA, registration, { newId: () => ids.shift() ?? "" }),
      ),
    ).toEqual({ kind: "created" });
    expect((await businessOf(whatsapp))?.id).toBe("x9x9x9x9x9");
  });
});

describe("One card per WhatsApp number", () => {
  // Scenarios: number with a published card; number with a card in review;
  // duplicate written in another format
  it("a number with a card in review or published is told so, and the card does not change", async () => {
    for (const status of ["published", "in_review"] as const) {
      const whatsapp = newPhone();
      const id = await insertBusiness(f, {
        whatsapp,
        status,
        publishedAt: status === "published" ? new Date("2026-01-01") : null,
        name: "Original",
      });
      const before = await businessOf(whatsapp);
      const written = `+52 ${whatsapp.slice(0, 3)} ${whatsapp.slice(3, 6)} ${whatsapp.slice(6)}`;
      const outcome = await submit(valid({ [F.whatsapp]: written, [F.name]: "Otro nombre" }));
      expect(outcome, status).toEqual({ kind: "invalid", errors: { whatsapp: "duplicate" } });
      expect(await countOf(whatsapp), status).toBe(1);
      expect(await businessOf(whatsapp), status).toEqual(before);
      expect(before?.id).toBe(id);
    }
  });

  // data-model, "One card per WhatsApp number within a locality (v2)": the
  // same number in two localities
  it("the same number may have a card in another locality", async () => {
    const whatsapp = newPhone();
    await insertBusiness(f, {
      whatsapp,
      localityCode: f.localityB,
      zoneId: f.zoneB,
      status: "published",
      publishedAt: new Date(),
    });
    expect(await submit(valid({ [F.whatsapp]: whatsapp }))).toEqual(RECEIVED);
    expect(await businessOf(whatsapp)).toBeDefined();
    expect(await businessOf(whatsapp, f.localityB)).toBeDefined();
  });

  // Scenario: race between two simultaneous submissions
  it("of two simultaneous registrations of one number, one is saved and the other is the duplicate", async () => {
    const whatsapp = newPhone();
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => submit(valid({ [F.whatsapp]: whatsapp }))),
    );
    expect(outcomes.filter((outcome) => outcome.kind === "received")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === "invalid")).toEqual(
      Array.from({ length: 3 }, () => ({ kind: "invalid", errors: { whatsapp: "duplicate" } })),
    );
    expect(await countOf(whatsapp)).toBe(1);
  });

  /** A rejected card of locality A, with everything a resubmission must keep. */
  async function rejectedCard(consentedToNoticeVersion: string | null) {
    const whatsapp = newPhone();
    const id = await insertBusiness(f, {
      whatsapp,
      name: "Nombre rechazado",
      origin: "seeded",
      status: "rejected",
      rejectedAt: new Date("2026-09-01T12:00:00Z"),
      rejectionReason: "No contestó el WhatsApp",
      registeredAt: new Date("2026-08-01T12:00:00Z"),
      consentedToNoticeAt: new Date("2026-08-01T12:00:00Z"),
      consentedToNoticeVersion,
      publishedAt: new Date("2026-08-10T12:00:00Z"),
      unpublishedAt: new Date("2026-08-20T12:00:00Z"),
      unpublishReason: "Lo pidió el dueño",
      managementTokenHash: String(phone).padStart(64, "0"),
      managementTokenCreatedAt: new Date("2026-08-10T12:00:00Z"),
      photoKey: `${"c".repeat(20)}${String(phone).padStart(4, "0")}`,
    });
    await db((tx) => tx.insert(businessTrades).values({ businessId: id, tradeId: f.tradeIds[0] }));
    return { id, whatsapp, before: await businessOf(whatsapp) };
  }

  // Scenarios: resubmission after a rejection; the consent record is not
  // replaced on resubmission; the resubmission does not publish itself
  it("a rejected card takes the new data, goes back to review as just arrived, and keeps what is not the form's", async () => {
    const { id, whatsapp, before } = await rejectedCard(NOTICE_VERSION);
    const sent = Date.now();
    const outcome = await submit(
      valid({
        [F.whatsapp]: whatsapp,
        [F.name]: "Nombre corregido",
        [F.postalCode]: POSTAL_CODE.none,
        [F.zone]: OTHER_ZONE,
        [F.zoneOther]: "Rinconada",
        [F.openingHours]: "Lunes a viernes",
        status: "published",
        origin: "organic",
        publishedAt: "2026-10-01",
        consentedToNoticeVersion: "1",
        trades: String(f.tradeIds[1]),
      }),
    );
    expect(outcome).toEqual(RECEIVED);
    const after = await businessOf(whatsapp);
    expect(after).toMatchObject({
      id,
      name: "Nombre corregido",
      nameNormalized: "nombre corregido",
      postalCode: POSTAL_CODE.none,
      zoneId: null,
      zoneOther: "Rinconada",
      openingHours: "Lunes a viernes",
      status: "in_review",
      rejectedAt: null,
      rejectionReason: null,
      // The rejection it answers, kept for the panel ("Reenvío").
      previousRejectedAt: before?.rejectedAt,
      previousRejectionReason: "No contestó el WhatsApp",
      // Kept.
      origin: "seeded",
      consentedToNoticeAt: before?.consentedToNoticeAt,
      consentedToNoticeVersion: NOTICE_VERSION,
      reconsentedToNoticeAt: null,
      reconsentedToNoticeVersion: null,
      publishedAt: before?.publishedAt,
      unpublishedAt: before?.unpublishedAt,
      unpublishReason: before?.unpublishReason,
      managementTokenHash: before?.managementTokenHash,
      managementTokenCreatedAt: before?.managementTokenCreatedAt,
      photoKey: before?.photoKey,
    });
    // The wait restarts with the resubmission.
    expect(after?.registeredAt.getTime()).toBeGreaterThanOrEqual(sent - 5000);
    const trades = await db((tx) =>
      tx.select().from(businessTrades).where(eq(businessTrades.businessId, id)),
    );
    expect(trades.map(({ tradeId }) => tradeId)).toEqual([f.tradeIds[0]]);
    expect(await countOf(whatsapp)).toBe(1);
  });

  // Scenarios: resubmission against a new version of the notice; of a card
  // that predates versioning; after reverting the deployment
  it("the re-acceptance is noted only when the version in force is later than the record's", async () => {
    const current = Number(NOTICE_VERSION);
    for (const [version, noted] of [
      [String(current - 1), true],
      [String(current), false],
      [String(current + 1), false],
      [null, false],
    ] as const) {
      const { whatsapp, before } = await rejectedCard(version);
      expect(await submit(valid({ [F.whatsapp]: whatsapp })), String(version)).toEqual(RECEIVED);
      const after = await businessOf(whatsapp);
      expect(after?.consentedToNoticeVersion, String(version)).toBe(version);
      expect(after?.consentedToNoticeAt, String(version)).toEqual(before?.consentedToNoticeAt);
      if (noted) {
        expect(after?.reconsentedToNoticeVersion).toBe(NOTICE_VERSION);
        expect(after?.reconsentedToNoticeAt?.getTime()).toBe(after?.registeredAt.getTime());
      } else {
        expect(after?.reconsentedToNoticeVersion, String(version)).toBeNull();
        expect(after?.reconsentedToNoticeAt, String(version)).toBeNull();
      }
    }
  });

  // Scenario: the resubmission goes through the same defenses
  it("a resubmission with the trap field, an invalid field or no quota changes nothing", async () => {
    const { whatsapp, before } = await rejectedCard(NOTICE_VERSION);
    expect(await submit(valid({ [F.whatsapp]: whatsapp, [HONEYPOT_FIELD]: "bot" }))).toEqual(
      RECEIVED,
    );
    expect(await submit(valid({ [F.whatsapp]: whatsapp, [F.name]: "" }))).toEqual({
      kind: "invalid",
      errors: { name: "required" },
    });
    expect(
      await submit(valid({ [F.whatsapp]: whatsapp }), {
        useDb: db,
        takeQuota: async () => ({ allowed: false, retryAfterSeconds: 60 }),
        verifyTurnstile,
        photos: PHOTOS,
      }),
    ).toEqual({ kind: "quota" });
    expect(await businessOf(whatsapp)).toEqual(before);
  });

  it("of two simultaneous resubmissions of one rejected card, one is taken and the other is the duplicate", async () => {
    const { whatsapp } = await rejectedCard(NOTICE_VERSION);
    const outcomes = await Promise.all([
      submit(valid({ [F.whatsapp]: whatsapp, [F.name]: "Primero" })),
      submit(valid({ [F.whatsapp]: whatsapp, [F.name]: "Segundo" })),
    ]);
    expect(outcomes).toEqual(
      expect.arrayContaining([RECEIVED, { kind: "invalid", errors: { whatsapp: "duplicate" } }]),
    );
    expect((await businessOf(whatsapp))?.status).toBe("in_review");
  });
});

describe("The registration's honeypot and per-IP quota are those of the public forms (v2)", () => {
  // Scenario: honeypot filled in a registration
  it("a filled trap field is told it was received, and nothing happens, not even a connection", async () => {
    const whatsapp = newPhone();
    const { calls, using } = counted();
    for (const trap of ["https://spam.example", " x ", ["", "y"]]) {
      expect(
        await submit(valid({ [F.whatsapp]: whatsapp, [HONEYPOT_FIELD]: trap }), using),
      ).toEqual(RECEIVED);
    }
    expect(calls).toEqual({ connections: 0, quota: 0, turnstile: 0 });
    expect(await businessOf(whatsapp)).toBeUndefined();
  });

  // Scenario: honeypot with only spaces
  it("a trap field of only spaces is no trap", async () => {
    const whatsapp = newPhone();
    expect(await submit(valid({ [F.whatsapp]: whatsapp, [HONEYPOT_FIELD]: "  \t " }))).toEqual(
      RECEIVED,
    );
    expect(await businessOf(whatsapp)).toBeDefined();
  });

  // Scenario: registration quota
  it("3 registrations an hour from one address; the fourth saves nothing", async () => {
    expect(QUOTAS.registration).toEqual({ limit: 3, windowSeconds: 3600 });
    const using = deps();
    for (let n = 0; n < 3; n++) {
      expect(await submit(valid(), using), String(n)).toEqual(RECEIVED);
    }
    const fourth = newPhone();
    expect(await submit(valid({ [F.whatsapp]: fourth }), using)).toEqual({ kind: "quota" });
    expect(await businessOf(fourth)).toBeUndefined();
    // Another address registers normally.
    expect(await submit(valid({ [F.whatsapp]: fourth }))).toEqual(RECEIVED);
  });

  it("only a submission that passed the trap and the fields spends quota; a duplicate does", async () => {
    const { calls, using } = counted();
    await submit(valid({ [HONEYPOT_FIELD]: "bot" }), using);
    await submit(valid({ [F.name]: "" }), using);
    await submit(valid({ [F.noticeVersion]: "0" }), using);
    expect(calls.quota).toBe(0);
    const whatsapp = newPhone();
    await submit(valid({ [F.whatsapp]: whatsapp }), using);
    await submit(valid({ [F.whatsapp]: whatsapp }), using);
    expect(calls.quota).toBe(2);
  });

  // Scenario: independent counters
  it("an address over its report quota registers, and one over its registration quota reports and searches", async () => {
    const reporter = newAddress();
    const headers = new Headers({ [CLIENT_IP_HEADER]: reporter });
    for (let n = 0; n < QUOTAS.report.limit; n++) await takeQuota(env, headers, "report");
    expect((await takeQuota(env, headers, "report")).allowed).toBe(false);
    expect(await submit(valid(), deps(reporter))).toEqual(RECEIVED);

    const registrant = newAddress();
    const using = deps(registrant);
    for (let n = 0; n < QUOTAS.registration.limit; n++) await submit(valid(), using);
    expect(await submit(valid(), using)).toEqual({ kind: "quota" });
    const theirs = new Headers({ [CLIENT_IP_HEADER]: registrant });
    expect(await takeQuota(env, theirs, "report")).toEqual({ allowed: true });
    expect(await takeQuota(env, theirs, "search")).toEqual({ allowed: true });
  });

  it("without the address of its visitor, no registration is held back", async () => {
    const using = deps(null);
    for (let n = 0; n <= QUOTAS.registration.limit; n++) {
      expect(await submit(valid(), using), String(n)).toEqual(RECEIVED);
    }
  });
});

describe("The registration page of a locality lives under it, and lands on its thank-you page (v2)", () => {
  const tizayuca = {
    code: "13069",
    name: "Tizayuca",
    slug: "tizayuca",
    state: { code: "13", name: "Hidalgo", slug: "hidalgo" },
    timeZone: "America/Mexico_City",
    contactWhatsapp: "7719990100",
    othersActive: false,
    seat: null,
  };

  it("the action registers only from the registration page, in its locality", () => {
    expect(REGISTRATION_ROUTE).toBe("/[state]/[municipality]/registro");
    expect(
      registrationLocality({ routePattern: REGISTRATION_ROUTE, locals: { locality: tizayuca } }),
    ).toBe(tizayuca);
    for (const routePattern of [
      "/[state]/[municipality]",
      "/[state]/[municipality]/registro/gracias",
      "/_actions/[...path]",
      "/[state]/[municipality]/negocio/[card]/reportar",
    ]) {
      expect(registrationLocality({ routePattern, locals: { locality: tizayuca } })).toBeNull();
    }
    expect(registrationLocality({ routePattern: REGISTRATION_ROUTE, locals: {} })).toBeNull();
  });

  it("each outcome is its answer: nothing for a received one, 400, 429 or 500 otherwise", () => {
    expect(registrationActionError({ kind: "received" })).toBeNull();
    const invalid = registrationActionError({
      kind: "invalid",
      errors: { name: "required", whatsapp: "duplicate" },
    });
    expect(invalid?.status).toBe(400);
    expect(invalid?.message).toBe("name:required whatsapp:duplicate");
    expect(registrationActionError({ kind: "quota" })?.status).toBe(429);
    expect(registrationActionError({ kind: "server" })?.status).toBe(500);
  });

  it("the page reads the errors back from the action's message, and nothing else", () => {
    const errors = { name: "length", consent: "notice-changed", zone: "required" } as const;
    expect(decodeErrors(encodeErrors(errors))).toEqual(errors);
    for (const message of [
      "",
      "name",
      "name:",
      "name:invalid",
      "website:required",
      "name:required name:length",
      "name:required:x",
      "toString:required",
      "Plomería Güicho",
    ]) {
      expect(decodeErrors(message), message).toBeNull();
    }
  });

  it("the page answers each error of the action, and an error it did not throw as a failure without the draft", () => {
    const of = (outcome: SubmitRegistrationOutcome) => {
      const error = registrationActionError(outcome);
      if (error === null) throw new Error("received");
      return registrationPageFailure(error);
    };
    expect(of({ kind: "invalid", errors: { whatsapp: "invalid" } })).toEqual({
      errors: { whatsapp: "invalid" },
      general: null,
      keepsDraft: true,
    });
    expect(of({ kind: "quota" })).toEqual({ errors: {}, general: "quota", keepsDraft: true });
    expect(of({ kind: "server" })).toEqual({ errors: {}, general: "server", keepsDraft: true });
    // A body over the limit of the actions, refused unread: the photo was
    // too large, and there is no draft to read.
    expect(
      registrationPageFailure(new ActionError({ code: "CONTENT_TOO_LARGE", message: "too large" })),
    ).toEqual({ errors: { photo: "too-large" }, general: null, keepsDraft: false });
    for (const error of [
      new ActionError({ code: "UNSUPPORTED_MEDIA_TYPE" }),
      new ActionError({ code: "BAD_REQUEST", message: "Plomería Güicho" }),
      new ActionError({ code: "TOO_MANY_REQUESTS", message: "server" }),
    ]) {
      expect(registrationPageFailure(error), error.code).toEqual({
        errors: {},
        general: "server",
        keepsDraft: false,
      });
    }
  });
});
