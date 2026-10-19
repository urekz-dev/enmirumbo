// Scenarios of docs/specs/business-registration.md for the edit mode of the
// management link, on the built site with the seeded directory of Tizayuca:
// "The management link opens the card in edit mode with the same prefilled
// form", "A token that is not exactly the current one opens nothing and
// gives nothing away", "Sending the edit does not touch the public card: it
// creates a pending edit", "The edit goes through the same validations as
// the registration and cannot set what is not its to set", "Sending changes
// when others are already waiting replaces the previous ones", "The
// registration and edit forms are protected by quotas, honeypot and
// Turnstile (v2)", "The registration and edit forms require JavaScript for
// the anti-bot check and say so (v2)", "The edit's honeypot and per-IP quota
// are those of the public forms (v2)", "The edit of a card may change its
// photo, which reaches the card only when the edit is applied (v2)" and "The
// edit mode of a locality lives under it, and lands on its confirmation
// (v2)"; of docs/specs/base-layout.md, "The admin panel and the edit mode
// stay out of the measurement by where they live (v2)"; and of
// docs/specs/public-directory.md, "An edit awaiting review does not show
// through on any public surface". The form is rendered state by state in
// test/astro/edit.test.ts, and the submission is tested with the database in
// test/worker/edit.test.ts and test/worker/management-link.test.ts.
//
// The links are issued as the panel will issue them (epic F), with the core's
// issueManagementLink: no page, action or script of the site issues one.
// Turnstile is on, with the local fake of its script (./turnstile.ts); the
// flows without JavaScript turn its switch off for a while, which is why this
// file runs alone (playwright.config.ts, "phone, edit").
//
// Every business this file creates has a number of the 7719997xxx series, in
// Tizayuca or in a fictitious, inactive locality of its own (state 88), and
// is removed before and after, with its edits and the objects of their
// photos. Miniflare gives every request of this machine a loopback address,
// which the quota does not count; the test of the quota sends the address
// Cloudflare would write, one from the IPv6 range reserved for documentation,
// new on every run.
import { crc32, deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { and, eq, inArray, like } from "drizzle-orm";
import { withLocalMediaBucket } from "../../scripts/seed-media.ts";
import { newBusinessId } from "../../src/core/business/id.ts";
import { cardPath } from "../../src/core/business/card-path.ts";
import {
  businesses,
  categories,
  localities,
  municipalities,
  pendingEdits,
  states,
  zones,
} from "../../src/core/db/schema/index.ts";
import { issueManagementLink } from "../../src/core/management-link/link.ts";
import { newManagementToken } from "../../src/core/management-link/token.ts";
import { isPhotoKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import { HONEYPOT_FIELD } from "../../src/core/forms/honeypot.ts";
import { TURNSTILE_DUMMY_TOKEN, TURNSTILE_RESPONSE_FIELD } from "../../src/core/turnstile/keys.ts";
import { withDatabase } from "./database.ts";
import { expect, setTurnstileSwitch, stubTurnstile, test, TURNSTILE_ORIGIN } from "./turnstile.ts";

const TIZAYUCA = { code: "13069", slug: "tizayuca", state: { slug: "hidalgo" } };
const HOME = "/hidalgo/tizayuca";
const EDIT = `${HOME}/editar`;
const THANKS = `${EDIT}/gracias`;
const PHONES = "7719997";

/** A fictitious, inactive locality of this file, for a card of another locality. */
const ELSEWHERE = {
  code: "88001",
  name: "Pueblo Lejano",
  slug: "pueblo-lejano",
  state: { code: "88", name: "Estado de prueba 88", slug: "estado-de-prueba-88" },
} as const;

const THANK_YOU =
  "¡Gracias! Ya recibimos tus cambios. Los revisamos y en cuanto los aprobemos tu ficha se actualiza. Mientras tanto sigue publicada como está.";
const WARNING =
  "Ojo: ya tienes cambios esperando revisión. Si mandas otros, estos reemplazan a los anteriores.";
const NOTE =
  "Tus datos siguen protegidos por el mismo aviso de privacidad que aceptaste al registrarte.";

type Business = typeof businesses.$inferSelect;
type Edit = typeof pendingEdits.$inferSelect;

/** Removes this file's businesses, their edits and the objects of their photos. */
async function removeCards(): Promise<void> {
  const keys: string[] = [];
  await withDatabase(async (db) => {
    const mine = like(businesses.whatsapp, `${PHONES}%`);
    const ids = (await db.select({ id: businesses.id }).from(businesses).where(mine)).map(
      ({ id }) => id,
    );
    if (ids.length > 0) {
      const edits = await db
        .select({ key: pendingEdits.newPhotoKey })
        .from(pendingEdits)
        .where(inArray(pendingEdits.businessId, ids));
      for (const { key } of edits) if (isPhotoKey(key)) keys.push(...photoObjectKeys(key));
    }
    await db.delete(businesses).where(mine);
    await db.delete(localities).where(eq(localities.code, ELSEWHERE.code));
    await db.delete(municipalities).where(eq(municipalities.code, ELSEWHERE.code));
    await db.delete(states).where(eq(states.code, ELSEWHERE.state.code));
  });
  if (keys.length > 0) await withLocalMediaBucket(async (bucket) => bucket.delete(keys));
}

test.beforeAll(removeCards);
test.afterAll(removeCards);

let lastPhone = 0;
const newPhone = () => `${PHONES}${String(100 + ++lastPhone).padStart(3, "0")}`;

interface CardValues {
  name?: string;
  status?: "published" | "in_review";
  localityCode?: string;
  zone?: string | null;
  zoneOther?: string | null;
  openingHours?: string | null;
  address?: string | null;
  whatsapp?: string;
}

/** A card of this file, published unless told otherwise, with a management link. */
async function cardWithLink(values: CardValues = {}) {
  const id = newBusinessId();
  const name = values.name ?? "Estética de Mentiras";
  const whatsapp = values.whatsapp ?? newPhone();
  let token = "";
  await withDatabase(async (db) => {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, "belleza"));
    const localityCode = values.localityCode ?? TIZAYUCA.code;
    let zoneId: number | null = null;
    if (values.zone !== null && localityCode === TIZAYUCA.code) {
      const [zone] = await db
        .select({ id: zones.id })
        .from(zones)
        .where(
          and(eq(zones.localityCode, TIZAYUCA.code), eq(zones.name, values.zone ?? "Huicalco")),
        );
      zoneId = zone?.id ?? null;
    }
    await db.insert(businesses).values({
      id,
      localityCode,
      name,
      categoryId: category?.id ?? 0,
      whatsapp,
      zoneId,
      zoneOther: zoneId === null ? (values.zoneOther ?? "Colonia de mentiras") : null,
      openingHours: values.openingHours ?? "Lunes a viernes de 9 a 6",
      address: values.address ?? "Calle Inventada 123",
      consentedToNoticeAt: new Date(),
      consentedToNoticeVersion: "2",
      status: "published",
      publishedAt: new Date(),
    });
    token = (await issueManagementLink(db, id)) ?? "";
    if (values.status === "in_review") {
      await db
        .update(businesses)
        .set({ status: "in_review", unpublishedAt: new Date(), unpublishReason: "Cerró un rato" })
        .where(eq(businesses.id, id));
    }
  });
  if (token === "") throw new Error("e2e: the card got no link");
  return { id, name, whatsapp, token, path: `${EDIT}/${token}` };
}

async function cardRow(id: string): Promise<Business | undefined> {
  let row: Business | undefined;
  await withDatabase(async (db) => {
    [row] = await db.select().from(businesses).where(eq(businesses.id, id));
  });
  return row;
}

async function editsOf(id: string): Promise<Edit[]> {
  let rows: Edit[] = [];
  await withDatabase(async (db) => {
    rows = await db
      .select()
      .from(pendingEdits)
      .where(eq(pendingEdits.businessId, id))
      .orderBy(pendingEdits.id);
  });
  return rows;
}

const byLabel = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const submitButton = (page: Page) =>
  page.getByRole("button", { name: "Enviar cambios", exact: true });

/** Sends the form of the page, and gives the answer to the POST. */
async function send(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse((answer) => answer.request().method() === "POST"),
    submitButton(page).click(),
  ]);
  return response;
}

/** The error next to the field labelled `label`, by its aria-describedby. */
async function errorOf(page: Page, label: string): Promise<string> {
  const control = byLabel(page, label);
  await expect(control).toHaveAttribute("aria-invalid", "true");
  const ids = ((await control.getAttribute("aria-describedby")) ?? "").split(" ");
  const id = ids.find((one) => one.endsWith("-error")) ?? "";
  return ((await page.locator(`[id="${id}"]`).innerText()) ?? "").replace(/^⚠\s*/, "").trim();
}

/** The headers of the edit mode on an answer. */
function expectEditModeHeaders(response: { headers(): Record<string, string> } | null | undefined) {
  const headers = response?.headers() ?? {};
  expect(headers["referrer-policy"]).toBe("strict-origin");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(headers["cache-control"]).toBe("no-store");
}

/** A PNG photo of `width`×`height` in one colour, written with zlib. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test.describe("Opening a management link and sending changes, with JavaScript", () => {
  // Scenarios: the owner opens their link; the edit does not ask for consent
  // again; the changes enter review and the card does not move; the listing
  // and the search do not find out either; reloading the confirmation;
  // warning when opening with pending changes; the new changes replace the
  // old ones; a valid Turnstile token
  test("the link opens the prefilled form; the changes land on the confirmation, wait for review and the card does not move", async ({
    page,
  }) => {
    const card = await cardWithLink({ name: "Estética Lupita de Mentiras" });
    const opened = await page.goto(card.path);
    expect(opened?.status()).toBe(200);
    expectEditModeHeaders(opened);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Edita tu ficha");
    await expect(
      page.getByText(
        "Cambia lo que necesites y lo revisamos antes de publicarlo. Mientras tanto tu ficha sigue como está.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page).toHaveTitle("Edita tu ficha — enmirumbo");
    await expect(byLabel(page, "¿Cómo se llama tu negocio?")).toHaveValue(card.name);
    await expect(byLabel(page, "¿A qué se dedica?")).toHaveValue("belleza");
    await expect(byLabel(page, "Tu WhatsApp (10 dígitos)")).toHaveValue(card.whatsapp);
    await expect(byLabel(page, "¿En qué colonia estás?")).toHaveValue("Huicalco");
    await expect(byLabel(page, "Horario (opcional)")).toHaveValue("Lunes a viernes de 9 a 6");
    await expect(page.getByText(NOTE, { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Acepto el aviso/ })).toHaveCount(0);
    await expect(page.getByText(WARNING, { exact: true })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "strict-origin");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    // The widget renders with the edit's action, and enables the button.
    await expect(submitButton(page)).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __turnstileRenders: { action: string }[] }).__turnstileRenders,
      ),
    ).toEqual([expect.objectContaining({ action: "edit" })]);

    await byLabel(page, "Horario (opcional)").fill("Todos los días de 8 a 8");
    await byLabel(page, "Dirección o referencias (opcional)").fill("Calle Nueva de Mentiras 7");
    const [confirmation] = await Promise.all([
      page.waitForResponse((answer) => new URL(answer.url()).pathname === THANKS),
      submitButton(page).click(),
    ]);
    await expect(page).toHaveURL(THANKS);
    expectEditModeHeaders(confirmation);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(THANK_YOU);
    await expect(page).toHaveTitle("Gracias por tus cambios — enmirumbo");

    const before = await cardRow(card.id);
    expect(before).toMatchObject({
      openingHours: "Lunes a viernes de 9 a 6",
      address: "Calle Inventada 123",
    });
    const [edit] = await editsOf(card.id);
    expect(edit).toMatchObject({
      status: "pending",
      openingHours: "Todos los días de 8 a 8",
      address: "Calle Nueva de Mentiras 7",
      name: card.name,
      whatsapp: card.whatsapp,
    });

    // Reloading the confirmation sends nothing again.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(THANK_YOU);
    expect(await editsOf(card.id)).toHaveLength(1);

    // The public card still shows what is published.
    const cardPage = cardPath(TIZAYUCA, card);
    await page.goto(cardPage);
    const published = await page.content();
    expect(published).toContain("Lunes a viernes de 9 a 6");
    expect(published).not.toContain("Todos los días de 8 a 8");
    expect(published).not.toContain("Calle Nueva de Mentiras");

    // Opened again: the warning, and what was sent last time.
    await page.goto(card.path);
    await expect(page.getByText(WARNING, { exact: true })).toBeVisible();
    await expect(byLabel(page, "Horario (opcional)")).toHaveValue("Todos los días de 8 a 8");
    await byLabel(page, "¿Cómo se llama tu negocio?").fill(
      "Estética Lupita y Asociados de Mentiras",
    );
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    const edits = await editsOf(card.id);
    expect(edits.map(({ status }) => status)).toEqual(["superseded", "pending"]);
    expect(edits[1]?.name).toBe("Estética Lupita y Asociados de Mentiras");
    expect(edits[0]?.resolvedAt).toEqual(edits[1]?.createdAt);

    // The search does not find the proposed name.
    await page.goto(`${HOME}/buscar?q=asociados`);
    expect(await page.content()).not.toContain("Estética Lupita y Asociados");
    expect((await cardRow(card.id))?.name).toBe(card.name);
  });

  // Scenario: the token does not leave in the Referer
  test("the privacy notice and the home receive at most the site's origin, never an edit address", async ({
    page,
    baseURL,
  }) => {
    const card = await cardWithLink();
    const referers: Record<string, string | undefined> = {};
    page.on("request", (sent) => {
      const path = new URL(sent.url()).pathname;
      if (sent.isNavigationRequest()) referers[path] = sent.headers()["referer"];
    });
    await page.goto(card.path);
    await page
      .getByRole("link", { name: "Lee el aviso de privacidad completo", exact: true })
      .click();
    await expect(page).toHaveURL("/aviso-de-privacidad");
    const origin = `${new URL(baseURL ?? "").origin}/`;
    expect(referers["/aviso-de-privacidad"]).toBe(origin);

    await page.goto(card.path);
    await page.locator("header a").first().click();
    await expect(page).toHaveURL(HOME);
    expect(referers[HOME]).toBe(origin);
    for (const referer of Object.values(referers)) expect(referer ?? "").not.toContain("/editar");
  });

  // Scenarios: mobile-first at 390px; the edit route does not travel to any third party
  test("on a 390px phone every control is at least 44px, nothing scrolls sideways, and no script comes from another site but Turnstile", async ({
    page,
  }) => {
    const card = await cardWithLink();
    const outside: string[] = [];
    page.on("request", (sent) => {
      const url = new URL(sent.url());
      if (url.hostname !== "localhost" && url.origin !== TURNSTILE_ORIGIN) outside.push(sent.url());
    });
    await page.goto(card.path);
    const main = page.getByRole("main");
    for (const control of await main
      .locator(
        "input:not([type=hidden]):not([type=checkbox]):not([tabindex='-1']), select, textarea, button, form a",
      )
      .all()) {
      const box = await control.boundingBox();
      expect(
        box?.height ?? 0,
        await control.evaluate((el) => el.outerHTML.slice(0, 80)),
      ).toBeGreaterThanOrEqual(44);
    }
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    const own = page.locator('script:not([src^="https://"])');
    await expect(own).toHaveCount(2);
    for (const script of await own.all()) {
      await expect(script).toHaveAttribute("src", /^\/_astro\/[^/]+\.js$/);
    }
    await expect(page.locator('script[src^="https://"]')).toHaveCount(1);
    await expect(page.locator(`script[src^="${TURNSTILE_ORIGIN}/"]`)).toHaveCount(1);
    await expect(page.locator("[data-umami-event]")).toHaveCount(0);

    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    await expect(page.locator("script")).toHaveCount(0);
    expect(outside).toEqual([]);
  });

  // Scenarios: a new photo in the edit; the new photo of the edit waiting stays
  test("a new photo travels with the changes and waits in the pending edit under its own key; the card keeps its own, and later changes keep the new one", async ({
    page,
  }) => {
    const card = await cardWithLink();
    await page.goto(card.path);
    await byLabel(page, "Foto de tu negocio (opcional)").setInputFiles({
      name: "foto.png",
      mimeType: "image/png",
      buffer: png(800, 600),
    });
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    const [edit] = await editsOf(card.id);
    expect(edit?.photoChange).toBe("replace");
    expect(isPhotoKey(edit?.newPhotoKey)).toBe(true);
    let stored: string[] = [];
    await withLocalMediaBucket(async (bucket) => {
      const listed = await bucket.list({ prefix: `photos/${edit?.newPhotoKey}/` });
      stored = listed.objects.map(({ key }) => key).toSorted();
    });
    expect(stored).toEqual(photoObjectKeys(edit?.newPhotoKey ?? "").toSorted());
    expect((await cardRow(card.id))?.photoKey).toBeNull();
    // No public page names it.
    await page.goto(cardPath(TIZAYUCA, card));
    expect(await page.content()).not.toContain(edit?.newPhotoKey ?? "-");

    // Opened again, the field says the new photo stays; changes sent without
    // choosing another keep it, and its objects stay.
    await page.goto(card.path);
    await expect(
      page.getByText("La foto nueva que nos mandaste se queda, a menos que elijas otra.", {
        exact: true,
      }),
    ).toBeVisible();
    await byLabel(page, "Horario (opcional)").fill("Sábados y domingos de mentiras");
    await submitButton(page).click();
    await expect(page).toHaveURL(THANKS);
    const edits = await editsOf(card.id);
    expect(edits.map(({ status, newPhotoKey }) => [status, newPhotoKey])).toEqual([
      ["superseded", null],
      ["pending", edit?.newPhotoKey],
    ]);
    expect(edits[1]).toMatchObject({
      photoChange: "replace",
      openingHours: "Sábados y domingos de mentiras",
    });
    let kept: string[] = [];
    await withLocalMediaBucket(async (bucket) => {
      const listed = await bucket.list({ prefix: `photos/${edit?.newPhotoKey}/` });
      kept = listed.objects.map(({ key }) => key).toSorted();
    });
    expect(kept).toEqual(stored);
  });
});

test.describe("A token that is not exactly the current one opens nothing and gives nothing away", () => {
  // Scenarios: invented token; token invalidated by a regeneration; token of
  // a business that is not published; a token only edits its own card; the
  // link of a deleted business does not resolve
  test("an invented, altered, invalidated, unpublished, deleted or another locality's token, and no token, answer the same 404", async ({
    request,
  }) => {
    const open = await cardWithLink();
    const invalidated = await cardWithLink();
    await withDatabase(async (db) => {
      await issueManagementLink(db, invalidated.id);
    });
    const unpublished = await cardWithLink({ status: "in_review" });
    const deleted = await cardWithLink();
    await withDatabase(async (db) => {
      await db.delete(businesses).where(eq(businesses.id, deleted.id));
      await db.insert(states).values(ELSEWHERE.state).onConflictDoNothing();
      await db
        .insert(municipalities)
        .values({
          code: ELSEWHERE.code,
          stateCode: ELSEWHERE.state.code,
          name: ELSEWHERE.name,
          slug: ELSEWHERE.slug,
        })
        .onConflictDoNothing();
      await db
        .insert(localities)
        .values({ code: ELSEWHERE.code, timeZone: "America/Mexico_City" })
        .onConflictDoNothing();
    });
    const elsewhere = await cardWithLink({ localityCode: ELSEWHERE.code, zone: null });
    const swap = (token: string) => `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    // The open link opens.
    expect((await request.get(open.path)).status()).toBe(200);

    const closed: [string, string][] = [
      ["invented", `${EDIT}/${newManagementToken()}`],
      ["altered", `${EDIT}/${swap(open.token)}`],
      ["invalidated", invalidated.path],
      ["not published", unpublished.path],
      ["deleted", deleted.path],
      ["of another locality", `${EDIT}/${elsewhere.token}`],
      ["no token", EDIT],
      ["of another shape", `${EDIT}/no-es-un-enlace`],
    ];
    const answers: {
      what: string;
      status: number;
      body: string;
      headers: Record<string, string>;
    }[] = [];
    for (const [what, path] of closed) {
      const answer = await request.get(path, { maxRedirects: 0 });
      const { date: _date, ...headers } = answer.headers();
      answers.push({ what, status: answer.status(), body: await answer.text(), headers });
    }
    const posted = await request.post(`${EDIT}/${newManagementToken()}?_action=edit`, {
      form: {
        [HONEYPOT_FIELD]: "",
        [TURNSTILE_RESPONSE_FIELD]: TURNSTILE_DUMMY_TOKEN,
        name: "Nada",
        category: "belleza",
        whatsapp: newPhone(),
        zone: "Huicalco",
      },
      maxRedirects: 0,
    });
    {
      const { date: _date, ...headers } = posted.headers();
      answers.push({ what: "posted", status: posted.status(), body: await posted.text(), headers });
    }

    const [first] = answers;
    expect(first?.status).toBe(404);
    expect(first?.body).toContain("No encontramos esta página");
    expect(first?.headers["referrer-policy"]).toBe("strict-origin");
    for (const answer of answers) {
      expect(answer.status, answer.what).toBe(404);
      expect(answer.body, answer.what).toBe(first?.body);
      expect(answer.headers, answer.what).toEqual(first?.headers);
    }
    // Nothing was saved for any of them.
    for (const id of [invalidated.id, unpublished.id, elsewhere.id]) {
      expect(await editsOf(id)).toEqual([]);
    }
  });

  // Scenario: the action reached from elsewhere
  test("the edit action reached any other way saves nothing and answers 404", async ({
    request,
  }) => {
    const card = await cardWithLink();
    const form = {
      [HONEYPOT_FIELD]: "",
      [TURNSTILE_RESPONSE_FIELD]: TURNSTILE_DUMMY_TOKEN,
      name: "Cambio de Mentiras",
      category: "belleza",
      whatsapp: card.whatsapp,
      zone: "Huicalco",
      token: card.token,
    };
    for (const path of [
      `${HOME}?_action=edit`,
      `${HOME}/registro?_action=edit`,
      `${THANKS}?_action=edit`,
      "/_actions/edit",
    ]) {
      const answer = await request.post(path, { form, maxRedirects: 0 });
      expect(answer.status(), path).toBe(404);
    }
    expect(await editsOf(card.id)).toEqual([]);
  });
});

test.describe("The edit's honeypot and per-IP quota are those of the public forms (v2)", () => {
  /** A valid edit as posted, with the token of the widget. */
  const posted = (whatsapp: string, extra: Record<string, string> = {}) => ({
    [HONEYPOT_FIELD]: "",
    [TURNSTILE_RESPONSE_FIELD]: TURNSTILE_DUMMY_TOKEN,
    name: "Estética Posteada de Mentiras",
    category: "belleza",
    whatsapp,
    zone: "Huicalco",
    ...extra,
  });

  // Scenario: honeypot filled in an edit
  test("a filled trap field lands on the same confirmation and saves nothing", async ({
    request,
  }) => {
    const card = await cardWithLink();
    const answer = await request.post(`${card.path}?_action=edit`, {
      form: posted(card.whatsapp, { [HONEYPOT_FIELD]: "https://spam.example" }),
      maxRedirects: 0,
    });
    expect(answer.status()).toBe(303);
    expect(answer.headers()["location"]).toBe(THANKS);
    expect(await editsOf(card.id)).toEqual([]);
  });

  // Scenarios: edit quota; independent counters
  test("a fourth edit from one address in the hour saves nothing and says so; the registration is not held back", async ({
    browser,
  }) => {
    const card = await cardWithLink();
    const hex = () => Math.floor(Math.random() * 0x10000).toString(16);
    const address = `2001:db8:${hex()}:${hex()}::43`;
    const context = await browser.newContext({ extraHTTPHeaders: { "CF-Connecting-IP": address } });
    await stubTurnstile(context);
    const page = await context.newPage();
    for (let n = 1; n <= 3; n++) {
      await page.goto(card.path);
      await byLabel(page, "Horario (opcional)").fill(`Horario ${n}`);
      await submitButton(page).click();
      await expect(page).toHaveURL(THANKS);
    }
    await page.goto(card.path);
    await byLabel(page, "Horario (opcional)").fill("Horario del cuarto");
    const over = await send(page);
    expect(over.status()).toBe(429);
    expectEditModeHeaders(over);
    await expect(page.getByRole("alert")).toHaveText(
      /Ya recibimos varios cambios desde aquí\. Espera un rato y vuelve a intentar\./,
    );
    await expect(byLabel(page, "Horario (opcional)")).toHaveValue("Horario del cuarto");
    expect((await editsOf(card.id)).map(({ openingHours }) => openingHours)).toEqual([
      "Horario 1",
      "Horario 2",
      "Horario 3",
    ]);
    // The registration of the same address is not held back.
    expect((await page.goto(`${HOME}/registro`))?.status()).toBe(200);
    await context.close();
  });
});

test.describe("Without JavaScript the edit says so and cannot be sent while Turnstile is on (v2)", () => {
  test.use({ javaScriptEnabled: false });

  // Scenario: no JavaScript
  test("the page says so plainly, the button is disabled, and neither a tap nor Enter sends anything", async ({
    page,
  }) => {
    const card = await cardWithLink();
    const posts: string[] = [];
    page.on("request", (sent) => {
      if (sent.method() === "POST") posts.push(sent.url());
    });
    await page.goto(card.path);
    await expect(
      page.getByText(
        "Para editar tu ficha, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
    await submitButton(page).click({ force: true });
    await byLabel(page, "¿Cómo se llama tu negocio?").press("Enter");
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
    expect(await editsOf(card.id)).toEqual([]);
  });

  test.describe("with Turnstile's switch off", () => {
    test.beforeAll(() => setTurnstileSwitch(false));
    test.afterAll(() => setTurnstileSwitch(true));

    // Scenarios: the edit works without JavaScript; invalid WhatsApp in the
    // edit; WhatsApp that already has another card; what was entered is not
    // lost; the switch off without JavaScript
    test("the errors come back next to their fields with what was written, then the changes land on the confirmation", async ({
      page,
    }) => {
      const other = await cardWithLink();
      const card = await cardWithLink({
        zone: null,
        zoneOther: "Rinconada del Venado de Mentiras",
      });
      await page.goto(card.path);
      await expect(page.getByText(/activa JavaScript/)).toHaveCount(0);
      await expect(byLabel(page, "¿En qué colonia estás?")).toHaveValue(
        "Rinconada del Venado de Mentiras",
      );

      await byLabel(page, "Tu WhatsApp (10 dígitos)").fill("771 999 7");
      await byLabel(page, "Horario (opcional)").fill("Sábados de mentiras");
      const invalid = await send(page);
      expect(invalid.status()).toBe(400);
      expectEditModeHeaders(invalid);
      expect(invalid.headers()["set-cookie"]).toBeUndefined();
      expect(await errorOf(page, "Tu WhatsApp (10 dígitos)")).toBe(
        "Revisa tu número de WhatsApp: deben ser 10 dígitos",
      );
      await expect(byLabel(page, "Tu WhatsApp (10 dígitos)")).toBeFocused();
      await expect(byLabel(page, "Horario (opcional)")).toHaveValue("Sábados de mentiras");
      expect(new URL(page.url()).pathname).toBe(card.path);

      await byLabel(page, "Tu WhatsApp (10 dígitos)").fill(other.whatsapp);
      const taken = await send(page);
      expect(taken.status()).toBe(400);
      expect(await errorOf(page, "Tu WhatsApp (10 dígitos)")).toBe(
        "Ese número ya está en otra ficha del directorio.",
      );
      expect(await editsOf(card.id)).toEqual([]);

      await byLabel(page, "Tu WhatsApp (10 dígitos)").fill(card.whatsapp);
      const sent = await send(page);
      expect(sent.status()).toBe(303);
      await expect(page).toHaveURL(THANKS);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(THANK_YOU);
      const [edit] = await editsOf(card.id);
      expect(edit).toMatchObject({
        status: "pending",
        zoneId: null,
        zoneOther: "Rinconada del Venado de Mentiras",
        openingHours: "Sábados de mentiras",
      });
    });
  });
});
