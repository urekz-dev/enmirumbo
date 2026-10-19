// Scenarios of docs/specs/business-registration.md on the built site, with
// the seeded directory of Tizayuca: "Public registration page on a single
// screen", "Required and optional form fields", "The "¿Qué ofreces?" example
// adapts to the chosen category", "The server normalizes and validates the
// WhatsApp to 10 digits", "The server validates every field and returns
// per-field errors in Spanish", "One card per WhatsApp number", "Consent with
// a visible simplified notice and a consent record", "Nobody consents to a
// notice version they did not have in front of them", "Zone "Otra" with free
// text pending normalization", "A successful submission queues the business
// and shows the thank-you screen", "Form states and registration
// accessibility", "The zone options come from the active locality (v2)",
// "The zone is chosen from the zones of the postal code the business types,
// or written when it does not appear (v2)", "The registration's honeypot
// and per-IP quota are those of the public forms (v2)", "The registration
// page of a locality lives under it, and lands on its thank-you page (v2)",
// "The registration and edit forms are protected by quotas, honeypot and
// Turnstile (v2)", "The registration and edit forms require JavaScript for
// the anti-bot check and say so (v2)", "Turnstile is checked on the server,
// fails closed and has a switch in the database (v2)", "Without
// JavaScript the registration says so and cannot be sent while Turnstile is
// on (v2)" and, for the addresses of the two screens, "No form data travels
// to the measurement".
// The form is rendered state by state in test/astro/registration.test.ts,
// and the submission is tested with the database in
// test/worker/registration.test.ts; the layout rules of the registration
// pages (390px, metadata, brand, the one script) are checked by
// surfaces.spec.ts, the entries of the home and of the empty listings by
// home.spec.ts and listings.spec.ts.
//
// Turnstile is on, as in every environment, with the local fake of its
// script (./turnstile.ts) and the preview's emulated test secret. The flows
// without JavaScript first built by EMR-39 run with its switch off, which is
// why this file runs alone (playwright.config.ts, "phone, registration").
//
// Every business this file creates in Tizayuca has a number of the
// 7719994xxx series, and is removed before and after. Miniflare gives every
// request of this machine a loopback address, which the quota does not
// count; the test of the quota sends the address Cloudflare would write, one
// from the IPv6 range reserved for documentation, new on every run.
import type { APIRequestContext, Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import { newBusinessId } from "../../src/core/business/id.ts";
import { businesses, categories, zones } from "../../src/core/db/schema/index.ts";
import { NOTICE_VERSION } from "../../src/core/legal/version.ts";
import {
  TURNSTILE_DUMMY_TOKEN,
  TURNSTILE_RESPONSE_FIELD,
  TURNSTILE_TEST_SITE_KEYS,
} from "../../src/core/turnstile/keys.ts";
import { withDatabase } from "./database.ts";
import { expect, setTurnstileSwitch, stubTurnstile, test, TURNSTILE_ORIGIN } from "./turnstile.ts";

const TIZAYUCA = "13069";
const HOME = "/hidalgo/tizayuca";
const FORM = `${HOME}/registro`;
const THANKS = `${FORM}/gracias`;
const PHONES = "7719994";

const THANK_YOU =
  "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo.";
const DUPLICATE =
  "Este número ya tiene una ficha registrada. Si es tu negocio, no hace falta registrarlo otra vez: te vamos a pasar por WhatsApp el enlace para editarlo.";

async function removeRegistrations(): Promise<void> {
  await withDatabase(async (db) => {
    await db
      .delete(businesses)
      .where(and(eq(businesses.localityCode, TIZAYUCA), like(businesses.whatsapp, `${PHONES}%`)));
  });
}

type Business = typeof businesses.$inferSelect;

/** The businesses of Tizayuca with `whatsapp`. */
async function businessesOf(whatsapp: string): Promise<Business[]> {
  let rows: Business[] = [];
  await withDatabase(async (db) => {
    rows = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.localityCode, TIZAYUCA), eq(businesses.whatsapp, whatsapp)));
  });
  return rows;
}

/** The id of the zone of Tizayuca named `name`. */
async function zoneIdOf(name: string): Promise<number> {
  let id = 0;
  await withDatabase(async (db) => {
    const [zone] = await db
      .select({ id: zones.id })
      .from(zones)
      .where(and(eq(zones.localityCode, TIZAYUCA), eq(zones.name, name)));
    id = zone?.id ?? 0;
  });
  return id;
}

/** What the form of the page is filled with; a field left out is not touched. */
interface Fields {
  name?: string;
  category?: string;
  whatsapp?: string;
  postalCode?: string;
  /** The option of the zone select, by what it says. */
  zone?: string;
  zoneOther?: string;
  whatYouOffer?: string;
  homeDelivery?: boolean;
  landline?: string;
  address?: string;
  openingHours?: string;
  facebookUrl?: string;
  consent?: boolean;
}

const LABELS = {
  name: "¿Cómo se llama tu negocio?",
  category: "¿A qué se dedica?",
  whatsapp: "Tu WhatsApp (10 dígitos)",
  postalCode: "Código postal",
  zone: "¿En qué colonia estás?",
  zoneOther: "Si tu colonia no aparece, escribe cómo se llama",
  whatYouOffer: "¿Qué ofreces? (opcional)",
  homeDelivery: "¿Haces entregas o vas a domicilio? (opcional)",
  landline: "Teléfono fijo (opcional)",
  address: "Dirección o referencias (opcional)",
  openingHours: "Horario (opcional)",
  facebookUrl: "Link de tu Facebook (opcional)",
  consent:
    "Acepto el aviso de privacidad y confirmo que este negocio es mío o que tengo permiso para registrarlo.",
} as const;

const field = (page: Page, key: keyof typeof LABELS) =>
  page.getByLabel(LABELS[key], { exact: true });

/**
 * Fills the form of the page as a person would: the postal code before the
 * zone, which its script narrows, and the name of a zone that does not
 * appear after choosing "Mi colonia no aparece", which shows its field.
 */
async function fill(page: Page, fields: Fields): Promise<void> {
  for (const key of ["name", "whatsapp", "postalCode"] as const) {
    const value = fields[key];
    if (value !== undefined) await field(page, key).fill(value);
  }
  if (fields.zone !== undefined) await field(page, "zone").selectOption({ label: fields.zone });
  for (const key of [
    "zoneOther",
    "whatYouOffer",
    "landline",
    "address",
    "openingHours",
    "facebookUrl",
  ] as const) {
    const value = fields[key];
    if (value !== undefined) await field(page, key).fill(value);
  }
  if (fields.category !== undefined) {
    await field(page, "category").selectOption({ label: fields.category });
  }
  if (fields.homeDelivery !== undefined)
    await field(page, "homeDelivery").setChecked(fields.homeDelivery);
  if (fields.consent !== undefined) await field(page, "consent").setChecked(fields.consent);
}

const submitButton = (page: Page) =>
  page.getByRole("button", { name: "Registrar mi negocio", exact: true });

/** Sends the form of the page, and gives the answer to the POST. */
async function send(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse((answer) => answer.request().method() === "POST"),
    submitButton(page).click(),
  ]);
  return response;
}

/** The required fields of a valid registration. */
const REQUIRED = (whatsapp: string): Fields => ({
  name: "Taller de Prueba Inventado",
  category: "Talleres",
  whatsapp,
  postalCode: "43808",
  zone: "Huicalco",
  consent: true,
});

/** Posts the registration form as a browser would, without following the answer. */
function post(request: APIRequestContext, form: Record<string, string>, path = FORM) {
  return request.post(`${path}?_action=register`, { form, maxRedirects: 0 });
}

/** A valid submission, as posted, with the token of the widget. */
const posted = (whatsapp: string, extra: Record<string, string> = {}) => ({
  website: "",
  [TURNSTILE_RESPONSE_FIELD]: TURNSTILE_DUMMY_TOKEN,
  name: "Taller Posteado de Mentiras",
  category: "talleres",
  whatsapp,
  postalCode: "43808",
  zone: "huicalco",
  noticeVersion: NOTICE_VERSION,
  consent: "on",
  ...extra,
});

/** The error next to the field labelled `label`, by its aria-describedby. */
async function errorOf(page: Page, key: keyof typeof LABELS): Promise<string> {
  const control = field(page, key);
  await expect(control).toHaveAttribute("aria-invalid", "true");
  const ids = ((await control.getAttribute("aria-describedby")) ?? "").split(" ");
  const id = ids.find((one) => one.endsWith("-error")) ?? "";
  return ((await page.locator(`[id="${id}"]`).innerText()) ?? "").replace(/^⚠\s*/, "").trim();
}

test.beforeAll(removeRegistrations);
test.afterAll(removeRegistrations);

test.describe("Registering without JavaScript while Turnstile's switch is off, from the home to the thank-you page", () => {
  test.use({ javaScriptEnabled: false });
  // The kill switch: with Turnstile off, the form works without JavaScript.
  test.beforeAll(() => setTurnstileSwitch(false));
  test.afterAll(() => setTurnstileSwitch(true));

  // Scenarios: the owner reaches registration from the home page; empty form
  // on open; empty required fields; announced errors; what was entered is
  // not lost; number with fewer than 10 digits; Facebook link with a
  // disallowed scheme; landline phone with letters; variants of the same
  // number are saved the same way; successful registration; reload after
  // success; submission without JS
  test("the errors come back next to their fields with what was written, then the registration is saved", async ({
    page,
    context,
  }) => {
    await page.goto(HOME);
    await page.getByRole("link", { name: "Registra tu negocio gratis", exact: true }).click();
    await expect(page).toHaveURL(FORM);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registra tu negocio gratis");
    await expect(page.getByRole("alert")).toHaveCount(0);

    // Nothing written: an error next to each required field, the focus on the first.
    const empty = await send(page);
    expect(empty.status()).toBe(400);
    expect(empty.headers()["cache-control"]).toBe("no-store");
    expect(empty.headers()["set-cookie"]).toBeUndefined();
    expect(await errorOf(page, "name")).toBe("Escribe el nombre de tu negocio");
    expect(await errorOf(page, "category")).toBe("Elige una categoría");
    expect(await errorOf(page, "whatsapp")).toBe(
      "Revisa tu número de WhatsApp: deben ser 10 dígitos",
    );
    expect(await errorOf(page, "postalCode")).toBe("Escribe tu código postal");
    expect(await errorOf(page, "zone")).toBe("Elige tu colonia");
    expect(await errorOf(page, "consent")).toBe("Marca la casilla para poder registrar tu negocio");
    await expect(field(page, "name")).toBeFocused();

    // Some fields wrong: their errors, and everything that was written stays.
    await fill(page, {
      name: "Taller Mecánico Güicho de Mentiras",
      category: "Talleres",
      whatsapp: "771 999 40",
      postalCode: "43815",
      zone: "Haciendas de Tizayuca",
      whatYouOffer: "afinación y frenos",
      homeDelivery: true,
      landline: "no tengo",
      openingHours: "Lunes a sábado de 9 a 7",
      facebookUrl: "facebook.com/tallerguicho",
      consent: true,
    });
    const wrong = await send(page);
    expect(wrong.status()).toBe(400);
    expect(await errorOf(page, "whatsapp")).toBe(
      "Revisa tu número de WhatsApp: deben ser 10 dígitos",
    );
    expect(await errorOf(page, "landline")).toBe(
      "Revisa el teléfono fijo: escribe solo números (puedes usar espacios, guiones o paréntesis)",
    );
    expect(await errorOf(page, "facebookUrl")).toBe(
      "El link de Facebook debe empezar con http:// o https://",
    );
    await expect(field(page, "whatsapp")).toBeFocused();
    await expect(field(page, "name")).toHaveValue("Taller Mecánico Güicho de Mentiras");
    await expect(field(page, "category")).toHaveValue("talleres");
    await expect(field(page, "postalCode")).toHaveValue("43815");
    await expect(field(page, "zone")).toHaveValue("haciendas-de-tizayuca");
    await expect(field(page, "whatYouOffer")).toHaveValue("afinación y frenos");
    await expect(field(page, "homeDelivery")).toBeChecked();
    await expect(field(page, "openingHours")).toHaveValue("Lunes a sábado de 9 a 7");
    // The consent has to be checked again.
    await expect(field(page, "consent")).not.toBeChecked();
    // What was written stays in neither the address nor a cookie: the errors
    // come back at the form's own path, whose only query is the name of the
    // action, which the measurement leaves out (business-registration, "No
    // form data travels to the measurement"; the script's tag is tested in
    // test/astro/registration.test.ts).
    expect(decodeURIComponent(page.url())).not.toMatch(/Güicho|tallerguicho|haciendas|43815/);
    const answered = new URL(page.url());
    expect(answered.pathname).toBe(FORM);
    expect([...answered.searchParams]).toEqual([["_action", "register"]]);
    expect(await businessesOf("7719994001")).toEqual([]);

    // Corrected: the thank-you page, at its address with no query.
    await fill(page, {
      whatsapp: "+52 771 999 4001",
      landline: "(775) 123-45-67",
      facebookUrl: "https://facebook.com/tallerguicho",
      consent: true,
    });
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(THANK_YOU);
    const [saved, ...more] = await businessesOf("7719994001");
    expect(more).toEqual([]);
    expect(saved).toMatchObject({
      name: "Taller Mecánico Güicho de Mentiras",
      postalCode: "43815",
      zoneId: await zoneIdOf("Haciendas de Tizayuca"),
      zoneOther: null,
      whatYouOffer: "afinación y frenos",
      homeDelivery: true,
      landline: "(775) 123-45-67",
      openingHours: "Lunes a sábado de 9 a 7",
      facebookUrl: "https://facebook.com/tallerguicho",
      status: "in_review",
      origin: "organic",
      publishedAt: null,
      managementTokenHash: null,
      consentedToNoticeVersion: NOTICE_VERSION,
      nameNormalized: "taller mecanico guicho de mentiras",
    });

    // Reloading the thank-you page creates nothing.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(THANK_YOU);
    expect(await businessesOf("7719994001")).toHaveLength(1);
    expect(await context.cookies()).toEqual([]);

    await page.getByRole("link", { name: "Volver al inicio" }).click();
    await expect(page).toHaveURL(HOME);
    // A card in review is nowhere in the directory.
    const search = await page.request.get(`${HOME}/buscar?q=guicho`);
    expect(await search.text()).not.toContain("Güicho");
  });

  // Scenarios: options (v2); the select without JavaScript; a zone of another
  // postal code
  test("the select lists every zone of Tizayuca grouped by postal code, and a zone of another postal code is its error", async ({
    page,
  }) => {
    await page.goto(FORM);
    const zone = field(page, "zone");
    const groups = await zone.locator("optgroup").evaluateAll((all) =>
      all.map((group) => ({
        label: group.getAttribute("label"),
        options: [...group.querySelectorAll("option")].map((option) => option.textContent),
      })),
    );
    expect(groups).toHaveLength(15);
    expect(groups.map(({ label }) => label)).toEqual(
      [
        "43800",
        "43802",
        "43803",
        "43804",
        "43806",
        "43807",
        "43808",
        "43810",
        "43815",
        "43816",
        "43817",
        "43820",
        "43823",
        "43824",
        "43825",
      ].map((code) => `C.P. ${code}`),
    );
    expect(groups.flatMap(({ options }) => options)).toHaveLength(105);
    expect(groups.find(({ label }) => label === "C.P. 43815")?.options).toEqual(
      expect.arrayContaining([
        "Haciendas de Tizayuca",
        "El Carmen (Colonia)",
        "El Carmen (Fraccionamiento)",
      ]),
    );
    await expect(zone.locator("option").first()).toHaveText("Elige tu colonia");
    await expect(zone.locator("option").last()).toHaveText("Mi colonia no aparece");
    // Without JavaScript the field for a zone that does not appear is always there.
    await expect(field(page, "zoneOther")).toBeVisible();

    await fill(page, { ...REQUIRED("7719994003"), zone: "Haciendas de Tizayuca" });
    const wrong = await send(page);
    expect(wrong.status()).toBe(400);
    expect(await errorOf(page, "zone")).toBe(
      "Esa colonia no es de ese código postal. Revisa el código o elige otra colonia.",
    );
    expect(await businessesOf("7719994003")).toEqual([]);
    await fill(page, { postalCode: "43815", consent: true });
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    expect(await businessesOf("7719994003")).toEqual([
      expect.objectContaining({
        postalCode: "43815",
        zoneId: await zoneIdOf("Haciendas de Tizayuca"),
      }),
    ]);
  });

  // Scenarios: registration with zone "Otra"; any postal code with "Mi colonia
  // no aparece"; registration with required fields only
  test("Mi colonia no aparece keeps the name as written, for the admin to normalize, with any postal code", async ({
    page,
  }) => {
    await page.goto(FORM);
    await fill(page, {
      ...REQUIRED("7719994002"),
      postalCode: "43899",
      zone: "Mi colonia no aparece",
    });
    const empty = await send(page);
    expect(empty.status()).toBe(400);
    expect(await errorOf(page, "zoneOther")).toBe("Escribe el nombre de tu colonia");

    await fill(page, { zoneOther: "Rinconada del Venado de Mentiras", consent: true });
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    expect(await businessesOf("7719994002")).toEqual([
      expect.objectContaining({
        postalCode: "43899",
        zoneId: null,
        zoneOther: "Rinconada del Venado de Mentiras",
        whatYouOffer: null,
        landline: null,
        address: null,
        openingHours: null,
        facebookUrl: null,
        homeDelivery: false,
        photoKey: null,
      }),
    ]);
  });

  // Scenarios: number with a published card; number with a card in review;
  // duplicate written in another format; registration does not hand out
  // management links
  test("a number whose card is published or in review is told so, and nothing is created", async ({
    page,
  }) => {
    for (const [written, number] of [
      ["+52 771 999 0101", "7719990101"],
      ["771-999-0111", "7719990111"],
    ] as const) {
      await page.goto(FORM);
      await fill(page, { ...REQUIRED(written), name: "Otro negocio de Mentiras" });
      const response = await send(page);
      expect(response.status(), number).toBe(400);
      expect(await errorOf(page, "whatsapp"), number).toBe(DUPLICATE);
      expect(await businessesOf(number), number).toHaveLength(1);
      const links = await page
        .getByRole("main")
        .getByRole("link")
        .evaluateAll((all) => all.map((link) => link.getAttribute("href")));
      expect(links, number).toEqual(["/aviso-de-privacidad"]);
    }
  });

  // Scenarios: resubmission after a rejection; the form does not give away
  // the rejection
  test("a rejected card resubmitted with the same number goes back to review, and the owner sees the usual thank-you page", async ({
    page,
  }) => {
    const whatsapp = "7719994010";
    const reason = "Motivo de rechazo de mentiras";
    await withDatabase(async (db) => {
      const [talleres] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, "talleres"));
      await db.insert(businesses).values({
        id: newBusinessId(),
        localityCode: TIZAYUCA,
        name: "Taller Rechazado de Mentiras",
        categoryId: talleres?.id ?? 0,
        whatsapp,
        zoneOther: "Colonia de Mentiras",
        consentedToNoticeAt: new Date("2026-09-01T12:00:00Z"),
        consentedToNoticeVersion: NOTICE_VERSION,
        registeredAt: new Date("2026-09-01T12:00:00Z"),
        status: "rejected",
        rejectedAt: new Date("2026-09-02T12:00:00Z"),
        rejectionReason: reason,
      });
    });

    await page.goto(FORM);
    expect(await page.content()).not.toContain(reason);
    await fill(page, { ...REQUIRED(whatsapp), name: "Taller Corregido de Mentiras" });
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(THANK_YOU);
    expect(await page.content()).not.toContain(reason);
    expect(await businessesOf(whatsapp)).toEqual([
      expect.objectContaining({
        name: "Taller Corregido de Mentiras",
        status: "in_review",
        rejectedAt: null,
        rejectionReason: null,
        consentedToNoticeAt: new Date("2026-09-01T12:00:00Z"),
      }),
    ]);
  });
});

test.describe("What a submission cannot do", () => {
  // Scenario: the notice changed mid-entry; invented version in the
  // submission; retry after the change
  test("a submission with another notice version saves nothing and asks to read the notice again", async ({
    request,
  }) => {
    for (const noticeVersion of [String(Number(NOTICE_VERSION) - 1), "", "99"]) {
      const response = await post(request, posted("7719994020", { noticeVersion }));
      expect(response.status(), noticeVersion).toBe(400);
      expect(await response.text(), noticeVersion).toContain(
        "El aviso de privacidad cambió mientras llenabas esto. Léelo otra vez y vuelve a marcar la casilla.",
      );
    }
    expect(await businessesOf("7719994020")).toEqual([]);
    const retry = await post(request, posted("7719994020"));
    expect(retry.status()).toBe(303);
    expect((await businessesOf("7719994020"))[0]?.consentedToNoticeVersion).toBe(NOTICE_VERSION);
  });

  // Scenarios: the client cannot publish itself; the client cannot set the
  // search text; the submission does not choose where to return
  test("fields a submission adds change nothing, and the answer is always the thank-you page of its locality", async ({
    request,
  }) => {
    const response = await post(
      request,
      posted("7719994021", {
        status: "published",
        origin: "seeded",
        publishedAt: "2026-01-01",
        managementTokenHash: "a".repeat(64),
        nameNormalized: "otra cosa",
        consentedToNoticeVersion: "1",
        redirect: "https://evil.example",
        next: "//evil.example",
      }),
    );
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toBe(THANKS);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(await businessesOf("7719994021")).toEqual([
      expect.objectContaining({
        status: "in_review",
        origin: "organic",
        publishedAt: null,
        managementTokenHash: null,
        nameNormalized: "taller posteado de mentiras",
        consentedToNoticeVersion: NOTICE_VERSION,
      }),
    ]);
  });

  test("the action reached any other way saves nothing", async ({ request }) => {
    for (const path of [HOME, `${HOME}/servicios-del-hogar`, THANKS]) {
      const response = await post(request, posted("7719994022"), path);
      expect(response.status(), path).toBe(404);
    }
    const endpoint = await request.post("/_actions/register", { form: posted("7719994022") });
    expect(endpoint.status()).toBe(404);
    expect(endpoint.headers()["set-cookie"]).toBeUndefined();
    expect(await businessesOf("7719994022")).toEqual([]);
  });

  test("the registration page of a municipality that is not served answers 404", async ({
    request,
  }) => {
    const nowhere = "/hidalgo/municipio-inventado/registro";
    expect((await request.get(nowhere)).status()).toBe(404);
    expect((await post(request, posted("7719994023"), nowhere)).status()).toBe(404);
    expect(await businessesOf("7719994023")).toEqual([]);
  });
});

test.describe("The registration's honeypot and per-IP quota are those of the public forms (v2)", () => {
  // Scenario: honeypot filled in a registration
  test("a filled trap field lands on the same thank-you page and saves nothing", async ({
    request,
  }) => {
    const response = await post(request, posted("7719994030", { website: "https://spam.example" }));

    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toBe(THANKS);
    expect(await businessesOf("7719994030")).toEqual([]);
  });

  // Scenario: honeypot with only spaces
  test("a trap field of only spaces is no trap: the registration is saved", async ({ request }) => {
    const response = await post(request, posted("7719994031", { website: "   " }));

    expect(response.status()).toBe(303);
    expect(await businessesOf("7719994031")).toHaveLength(1);
  });

  // Scenarios: registration quota; independent counters
  test("a fourth registration from one address in the hour saves nothing and says so", async ({
    browser,
  }) => {
    const hex = () => Math.floor(Math.random() * 0x10000).toString(16);
    const address = `2001:db8:${hex()}:${hex()}::39`;
    const context = await browser.newContext({
      extraHTTPHeaders: { "CF-Connecting-IP": address },
    });
    await stubTurnstile(context);
    const page = await context.newPage();
    for (let n = 1; n <= 3; n++) {
      await page.goto(FORM);
      await fill(page, REQUIRED(`771999410${n}`));
      await submitButton(page).click();
      await expect(page).toHaveURL(THANKS);
    }

    await page.goto(FORM);
    await fill(page, { ...REQUIRED("7719994104"), name: "El Cuarto de Mentiras" });
    const over = await send(page);
    expect(over.status()).toBe(429);
    expect(over.headers()["cache-control"]).toBe("no-store");
    await expect(page.getByRole("alert")).toHaveText(
      /Ya recibimos varios registros desde aquí\. Espera un rato y vuelve a intentar\./,
    );
    await expect(field(page, "name")).toHaveValue("El Cuarto de Mentiras");
    expect(await businessesOf("7719994104")).toEqual([]);

    // The search and the reports of the same address are not held back.
    expect((await page.goto(`${HOME}/buscar?q=taller`))?.status()).toBe(200);
    expect(
      (
        await page.goto(`${HOME}/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72/reportar`)
      )?.status(),
    ).toBe(200);
    await context.close();
  });
});

test.describe("Registering with JavaScript", () => {
  /** The groups of the zone select as a person sees them, and its options. */
  const zoneSelect = async (page: Page) =>
    field(page, "zone").evaluate((element) => {
      const select = element as unknown as HTMLSelectElement;
      return {
        groups: [...select.querySelectorAll("optgroup")].map((group) => group.label),
        options: [...select.options].map((option) => option.text),
        value: select.value,
      };
    });

  // Scenarios: the postal code narrows the zones; a postal code no zone has;
  // registration with zone "Otra"
  test("typing a postal code narrows the select to its zones, and Mi colonia no aparece shows the field for its name", async ({
    page,
  }) => {
    await page.goto(FORM);
    const hint = page.getByRole("status").filter({ hasText: "No tenemos colonias" });
    await expect(field(page, "zoneOther")).toBeHidden();
    expect((await zoneSelect(page)).groups).toHaveLength(15);

    await field(page, "postalCode").fill("43808");
    const huicalco = await zoneSelect(page);
    expect(huicalco.groups).toEqual(["C.P. 43808"]);
    expect(huicalco.options).toEqual([
      "Elige tu colonia",
      "Arboledas",
      "Atempa",
      "Campestre",
      "Huicalco",
      "Quinta Esperanza",
      "Quintas de Tizayuca",
      "Real de San Jerónimo",
      "Mi colonia no aparece",
    ]);
    await field(page, "zone").selectOption({ label: "Huicalco" });
    await expect(field(page, "zoneOther")).toBeHidden();

    // Another postal code: the zone chosen is no longer there, so none is.
    await field(page, "postalCode").fill("43815");
    const carmen = await zoneSelect(page);
    expect(carmen.groups).toEqual(["C.P. 43815"]);
    expect(carmen.options).toHaveLength(22);
    expect(carmen.options).toEqual(
      expect.arrayContaining(["El Carmen (Colonia)", "El Carmen (Fraccionamiento)"]),
    );
    expect(carmen.value).toBe("");
    // Fewer digits: every group again.
    await field(page, "postalCode").fill("438");
    expect((await zoneSelect(page)).groups).toHaveLength(15);
    await expect(hint).toHaveCount(0);

    // A postal code no zone has: the form says so, and leaves only Mi colonia no aparece.
    await field(page, "postalCode").fill("43899");
    await expect(page.getByRole("status").filter({ hasText: "No tenemos colonias" })).toHaveText(
      "No tenemos colonias con ese código postal. Revisa que esté bien o elige “Mi colonia no aparece”.",
    );
    expect((await zoneSelect(page)).options).toEqual(["Elige tu colonia", "Mi colonia no aparece"]);
    await field(page, "zone").selectOption({ label: "Mi colonia no aparece" });
    await expect(field(page, "zoneOther")).toBeVisible();

    await fill(page, {
      name: "Taller de Prueba Inventado",
      category: "Talleres",
      whatsapp: "7719994042",
      zoneOther: "Privada de Mentiras",
      consent: true,
    });
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    expect(await businessesOf("7719994042")).toEqual([
      expect.objectContaining({
        postalCode: "43899",
        zoneId: null,
        zoneOther: "Privada de Mentiras",
      }),
    ]);
  });

  // Scenarios: home services example; sports example; the example changes
  // when the category changes
  test("the example of ¿Qué ofreces? follows the category, without erasing what was written", async ({
    page,
  }) => {
    await page.goto(FORM);
    const offer = field(page, "whatYouOffer");

    await expect(offer).toHaveAttribute("placeholder", "ej. palabras clave de lo que ofreces");
    await field(page, "category").selectOption({ label: "Servicios del hogar" });
    await expect(offer).toHaveAttribute(
      "placeholder",
      "ej. plomería, destape de drenajes, bombas de agua",
    );
    await offer.fill("destape de drenajes");
    await field(page, "category").selectOption({ label: "Clubes y escuelas deportivas" });
    await expect(offer).toHaveAttribute(
      "placeholder",
      "ej. futbol infantil 6-12 años, entrenamientos martes y jueves",
    );
    await expect(offer).toHaveValue("destape de drenajes");
    await field(page, "category").selectOption({ label: "Elige una categoría" });
    await expect(offer).toHaveAttribute("placeholder", "ej. palabras clave de lo que ofreces");
  });

  // Scenario: submitting state
  test("while the form is sent the button says Enviando... and is disabled, so a second tap sends nothing", async ({
    page,
  }) => {
    await page.goto(FORM);
    await fill(page, REQUIRED("7719994040"));
    // The test keeps the form on the page: after the form's own script, a
    // listener counts each submission and cancels its navigation.
    await page.locator("form[data-registration-form]").evaluate((form) => {
      const counted = form as HTMLFormElement & { submissions?: number };
      counted.submissions = 0;
      form.addEventListener("submit", (event) => {
        counted.submissions = (counted.submissions ?? 0) + 1;
        event.preventDefault();
      });
    });

    await submitButton(page).click();
    const sending = page.getByRole("button", { name: "Enviando...", exact: true });
    await expect(sending).toBeDisabled();
    // A second tap sends nothing.
    await sending.click({ force: true });
    const submissions = await page
      .locator("form[data-registration-form]")
      .evaluate((form) => (form as HTMLFormElement & { submissions?: number }).submissions);
    expect(submissions).toBe(1);
  });

  // Registration works without client JavaScript: scenario "JS limited to
  // the example field" (the script changes nothing else)
  test("with the page's script the registration lands on the thank-you page as without it", async ({
    page,
  }) => {
    await page.goto(FORM);
    await fill(page, { ...REQUIRED("7719994041"), category: "Servicios del hogar" });
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(THANK_YOU);
    expect(await businessesOf("7719994041")).toHaveLength(1);
  });

  // Scenario: mobile-first at 390px; the content security policy lets the
  // form's own script run
  test("on a 390px phone every control is at least 44px, nothing scrolls sideways, and the policy allows the script", async ({
    page,
  }) => {
    const response = await page.goto(FORM);
    expect(response?.headers()["content-security-policy"]).toMatch(/script-src 'self'/);
    const main = page.getByRole("main");

    // The field for a zone that does not appear waits hidden until it is asked for.
    for (const control of await main
      .locator(
        "input:not([type=hidden]):not([type=checkbox]):not([tabindex='-1']), select, textarea, button, form a",
      )
      .filter({ visible: true })
      .all()) {
      const box = await control.boundingBox();
      expect(
        box?.height ?? 0,
        await control.evaluate((el) => el.outerHTML.slice(0, 80)),
      ).toBeGreaterThanOrEqual(44);
    }
    for (const label of await main.locator("label:has(input[type=checkbox])").all()) {
      expect((await label.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    // The form's script, the widget's, and Turnstile's api.js, which the
    // widget's adds.
    const own = page.locator('script:not([src^="https://"])');
    await expect(own).toHaveCount(2);
    for (const script of await own.all()) {
      await expect(script).toHaveAttribute("src", /^\/_astro\/[^/]+\.js$/);
    }
    await expect(page.locator(`script[src^="${TURNSTILE_ORIGIN}/"]`)).toHaveCount(1);
  });
});

test.describe("Turnstile is checked on the server, fails closed and has a switch in the database (v2)", () => {
  const FAILED = "No pudimos comprobar que eres una persona. Vuelve a intentarlo.";

  test.describe("with the widget solved when the test says so", () => {
    test.use({ turnstileSolve: "manual" });

    // Scenarios: a valid Turnstile token; with JavaScript; the owner reaches
    // registration from the home page
    test("the widget renders in Spanish with the site key and the form's action, the button waits for its token, and the registration lands on the thank-you page", async ({
      page,
    }) => {
      await page.goto(HOME);
      await page.getByRole("link", { name: "Registra tu negocio gratis", exact: true }).click();
      await expect(page).toHaveURL(FORM);
      // With JavaScript, no message about it.
      await expect(page.getByText("activa JavaScript")).toBeHidden();

      await fill(page, REQUIRED("7719994050"));
      await expect(submitButton(page)).toBeDisabled();
      expect(
        await page.evaluate(
          () => (window as never as { __turnstileRenders: unknown[] }).__turnstileRenders,
        ),
      ).toEqual([
        {
          sitekey: TURNSTILE_TEST_SITE_KEYS.alwaysPasses,
          action: "registration",
          language: "es",
          size: "flexible",
        },
      ]);
      await page.evaluate(() =>
        (window as never as { __turnstileSolve: () => void }).__turnstileSolve(),
      );
      await expect(submitButton(page)).toBeEnabled();

      const [request] = await Promise.all([
        page.waitForRequest((sent) => sent.method() === "POST"),
        submitButton(page).click(),
      ]);
      // The form is multipart, for the photo: the token is one of its parts.
      expect(request.headers()["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
      expect(request.postData()).toContain(
        `name="${TURNSTILE_RESPONSE_FIELD}"\r\n\r\n${TURNSTILE_DUMMY_TOKEN}\r\n`,
      );
      await expect(page).toHaveURL(THANKS);
      expect(await businessesOf("7719994050")).toHaveLength(1);
    });
  });

  // Scenario: a missing or invalid token
  test("a submission without a valid token comes back with the message and what was written, and a new token sends it", async ({
    page,
  }) => {
    await page.goto(FORM);
    await fill(page, { ...REQUIRED("7719994051"), name: "Taller Sin Token de Mentiras" });
    await expect(submitButton(page)).toBeEnabled();
    // The token is lost on the way, as if the widget had not run.
    await page.locator(`input[name="${TURNSTILE_RESPONSE_FIELD}"]`).evaluate((input) => {
      (input as HTMLInputElement).value = "a-forged-token";
    });
    const refused = await send(page);
    expect(refused.status()).toBe(403);
    expect(refused.headers()["cache-control"]).toBe("no-store");
    await expect(page.getByRole("alert").first()).toHaveText(new RegExp(FAILED));
    await expect(field(page, "name")).toHaveValue("Taller Sin Token de Mentiras");
    expect(await businessesOf("7719994051")).toEqual([]);

    // The form that comes back has the widget again: checking the consent
    // and sending is enough.
    await fill(page, { consent: true });
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    expect(await businessesOf("7719994051")).toHaveLength(1);
  });

  test("a submission posted without the widget's token is refused and saves nothing", async ({
    request,
  }) => {
    for (const token of [undefined, "", "a-forged-token", "x".repeat(3000)]) {
      const form = posted("7719994052");
      if (token === undefined) delete (form as Record<string, string>)[TURNSTILE_RESPONSE_FIELD];
      else form[TURNSTILE_RESPONSE_FIELD] = token;
      const response = await post(request, form);
      expect(response.status(), String(token)).toBe(403);
      expect(await response.text(), String(token)).toContain(FAILED);
    }
    expect(await businessesOf("7719994052")).toEqual([]);
  });

  // Scenario: the kill switch
  test("with the switch off the form shows no widget, asks for no JavaScript and is saved without a token; on again, it asks", async ({
    page,
    request,
  }) => {
    const outside: string[] = [];
    page.on("request", (sent) => {
      if (sent.url().startsWith(TURNSTILE_ORIGIN)) outside.push(sent.url());
    });
    await setTurnstileSwitch(false);
    try {
      await page.goto(FORM);
      await expect(page.locator("[data-turnstile-widget]")).toHaveCount(0);
      expect(await page.content()).not.toContain("activa JavaScript");
      await expect(submitButton(page)).toBeEnabled();
      expect(outside).toEqual([]);

      const form = posted("7719994053");
      delete (form as Record<string, string>)[TURNSTILE_RESPONSE_FIELD];
      expect((await post(request, form)).status()).toBe(303);
      expect(await businessesOf("7719994053")).toHaveLength(1);
      // The trap field still works.
      const trapped = posted("7719994054", { website: "https://spam.example" });
      delete (trapped as Record<string, string>)[TURNSTILE_RESPONSE_FIELD];
      expect((await post(request, trapped)).status()).toBe(303);
      expect(await businessesOf("7719994054")).toEqual([]);
    } finally {
      await setTurnstileSwitch(true);
    }
    const form = posted("7719994055");
    delete (form as Record<string, string>)[TURNSTILE_RESPONSE_FIELD];
    expect((await post(request, form)).status()).toBe(403);
    await page.goto(FORM);
    await expect(page.locator("[data-turnstile-widget]")).toHaveCount(1);
  });

  // Scenario: only the forms that need it
  test("the report form and the search include no Turnstile", async ({ page }) => {
    const outside: string[] = [];
    page.on("request", (sent) => {
      if (sent.url().startsWith(TURNSTILE_ORIGIN)) outside.push(sent.url());
    });
    for (const path of [
      `${HOME}/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72/reportar`,
      `${HOME}/buscar?q=plomero`,
      HOME,
    ]) {
      await page.goto(path);
      await expect(page.locator("[data-turnstile-widget]"), path).toHaveCount(0);
      expect(await page.content(), path).not.toContain("activa JavaScript");
    }
    expect(outside).toEqual([]);
  });
});

test.describe("Without JavaScript the registration says so and cannot be sent while Turnstile is on (v2)", () => {
  test.use({ javaScriptEnabled: false });

  // Scenario: no JavaScript
  test("the page says so plainly, the button is disabled, and neither a tap nor Enter sends anything", async ({
    page,
  }) => {
    const posts: string[] = [];
    page.on("request", (sent) => {
      if (sent.method() === "POST") posts.push(sent.url());
    });
    await page.goto(FORM);
    await expect(
      page.getByText(
        "Para registrar tu negocio, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona.",
        { exact: true },
      ),
    ).toBeVisible();
    await fill(page, REQUIRED("7719994060"));
    await expect(submitButton(page)).toBeDisabled();
    await submitButton(page).click({ force: true });
    await field(page, "name").press("Enter");
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
    await expect(page).toHaveURL(FORM);
    expect(await businessesOf("7719994060")).toEqual([]);
  });
});
