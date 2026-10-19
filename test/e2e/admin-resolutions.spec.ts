// Attending reports and resolving pending edits on the built site, through
// the Access check (docs/specs/admin-review.md): "Marking a report as
// attended, only once", "Applying the pending edit updates the published
// card and only that", "Discarding the pending edit requires a reason, does
// not touch the card and offers to notify by WhatsApp", "A pending edit is
// resolved only once and only if it is still the latest", "Applying or
// discarding a pending edit carries out what it asks of the photo (v2)",
// "The panel says that a change takes up to a minute to reach the site (v2)",
// "The panel is operated from the phone and without unnecessary client
// JavaScript" and "Attending a report and resolving a pending edit are forms
// of their details, and their action checks everything again (v2)".
//
// `astro preview` runs with the local vars of wrangler.jsonc (ENVIRONMENT
// local) on localhost, so every request carries the fixed local identity,
// which the global setup made a super admin (./local-admin.ts). This file
// adds fictitious published cards to Tizayuca, with numbers of the
// 7719998xxx series, reports, pending edits and photos in the local media
// bucket; it attends the reports, applies and discards the edits, and
// removes all of it before and after. It runs alone, in its own project of
// playwright.config.ts ("phone, admin resolutions"), because the queue, the
// sitemap and the crawls would see its cards.
import { expect, type Page, test } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { withLocalMediaBucket } from "../../scripts/seed-media.ts";
import { newBusinessId } from "../../src/core/business/id.ts";
import { seedPhotoObjects } from "../../src/core/db/seed/photos.ts";
import {
  businesses,
  categories,
  pendingEdits,
  reports,
  zones,
} from "../../src/core/db/schema/index.ts";
import { newPhotoKey, photoObjectKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import { withDatabase } from "./database.ts";

const TIZAYUCA = "13069";
const PHONES = "7719998";
const DELAY = "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.";

const NAMES = {
  reported: "Reportada para Atender de Mentiras",
  applied: "Con Cambios por Aplicar de Mentiras",
  discarded: "Con Cambios por Descartar de Mentiras",
  noJs: "Con Cambios Sin JavaScript de Mentiras",
} as const;

const PHOTOS = {
  applied: newPhotoKey(),
  proposed: newPhotoKey(),
  discarded: newPhotoKey(),
  dropped: newPhotoKey(),
};

const ids = {
  reported: newBusinessId(),
  applied: newBusinessId(),
  discarded: newBusinessId(),
  noJs: newBusinessId(),
  noJsDiscard: newBusinessId(),
};
const edits = { applied: 0, discarded: 0, noJs: 0, noJsDiscard: 0 };
const reportIds = { first: 0, last: 0, noJs: 0 };
let huicalco = 0;

async function removeData(): Promise<void> {
  await withDatabase(async (db) => {
    await db.delete(businesses).where(like(businesses.whatsapp, `${PHONES}%`));
  });
  await withLocalMediaBucket(async (bucket) => {
    await bucket.delete(Object.values(PHOTOS).flatMap(photoObjectKeys));
  });
}

test.beforeAll(async () => {
  await removeData();
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 60 * 60 * 1000);
  await withDatabase(async (db) => {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, "servicios-del-hogar"));
    const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.slug, "huicalco"));
    if (!category || !zone) {
      throw new Error("e2e: the catalogues are missing; is the database migrated?");
    }
    huicalco = zone.id;
    const base = {
      localityCode: TIZAYUCA,
      categoryId: category.id,
      zoneId: zone.id,
      status: "published" as const,
      publishedAt: ago(100),
      registeredAt: ago(120),
      consentedToNoticeAt: ago(120),
      consentedToNoticeVersion: "2",
      openingHours: "De 9 a 5 (de mentiras)",
    };
    await db.insert(businesses).values([
      { ...base, id: ids.reported, name: NAMES.reported, whatsapp: `${PHONES}001` },
      {
        ...base,
        id: ids.applied,
        name: NAMES.applied,
        whatsapp: `${PHONES}002`,
        photoKey: PHOTOS.applied,
      },
      {
        ...base,
        id: ids.discarded,
        name: NAMES.discarded,
        whatsapp: `${PHONES}003`,
        photoKey: PHOTOS.discarded,
      },
      { ...base, id: ids.noJs, name: NAMES.noJs, whatsapp: `${PHONES}004` },
      {
        ...base,
        id: ids.noJsDiscard,
        name: "Con Cambios por Descartar Sin JavaScript de Mentiras",
        whatsapp: `${PHONES}005`,
      },
    ]);
    const editOf = (businessId: string, whatsapp: string) => ({
      businessId,
      localityCode: TIZAYUCA,
      categoryId: category.id,
      whatsapp,
      createdAt: ago(3),
    });
    const [applied] = await db
      .insert(pendingEdits)
      .values({
        ...editOf(ids.applied, `${PHONES}002`),
        name: NAMES.applied,
        zoneId: null,
        zoneOther: "Colonia Nueva de Mentiras",
        openingHours: "De 10 a 7 (de mentiras)",
        photoChange: "replace",
        newPhotoKey: PHOTOS.proposed,
      })
      .returning({ id: pendingEdits.id });
    const [discarded] = await db
      .insert(pendingEdits)
      .values({
        ...editOf(ids.discarded, `${PHONES}013`),
        name: "Nombre Que No Va de Mentiras",
        zoneId: zone.id,
        openingHours: "Nunca (de mentiras)",
        photoChange: "replace",
        newPhotoKey: PHOTOS.dropped,
      })
      .returning({ id: pendingEdits.id });
    const [noJs] = await db
      .insert(pendingEdits)
      .values({
        ...editOf(ids.noJs, `${PHONES}004`),
        name: NAMES.noJs,
        zoneId: zone.id,
        openingHours: "Sin JavaScript (de mentiras)",
      })
      .returning({ id: pendingEdits.id });
    const [noJsDiscard] = await db
      .insert(pendingEdits)
      .values({
        ...editOf(ids.noJsDiscard, `${PHONES}005`),
        name: "Nombre que se va a descartar sin JavaScript",
        zoneId: zone.id,
        openingHours: "Horario propuesto para descartar",
      })
      .returning({ id: pendingEdits.id });
    edits.applied = applied?.id ?? 0;
    edits.discarded = discarded?.id ?? 0;
    edits.noJs = noJs?.id ?? 0;
    edits.noJsDiscard = noJsDiscard?.id ?? 0;
    const [first, last] = await db
      .insert(reports)
      .values([
        { businessId: ids.reported, localityCode: TIZAYUCA, reason: "closed", createdAt: ago(30) },
        {
          businessId: ids.reported,
          localityCode: TIZAYUCA,
          reason: "incorrect_data",
          comment: "Ya no contestan (comentario de mentira)",
          createdAt: ago(2),
        },
      ])
      .returning({ id: reports.id });
    reportIds.first = first?.id ?? 0;
    reportIds.last = last?.id ?? 0;
    const [noJsReport] = await db
      .insert(reports)
      .values({
        businessId: ids.noJs,
        localityCode: TIZAYUCA,
        reason: "incorrect_data",
        comment: "Comentario para marcar sin JavaScript",
        createdAt: ago(1),
      })
      .returning({ id: reports.id });
    reportIds.noJs = noJsReport?.id ?? 0;
  });
  await withLocalMediaBucket(async (bucket) => {
    const objects = seedPhotoObjects([
      { name: NAMES.applied, photoKey: PHOTOS.applied, shade: 1 },
      { name: "Foto Nueva de Mentiras", photoKey: PHOTOS.proposed, shade: 2 },
      { name: NAMES.discarded, photoKey: PHOTOS.discarded, shade: 3 },
      { name: "Foto Descartada de Mentiras", photoKey: PHOTOS.dropped, shade: 4 },
    ]);
    for (const { key, body, contentType, cacheControl } of objects) {
      await bucket.put(key, body, { httpMetadata: { contentType, cacheControl } });
    }
  });
});

test.afterAll(removeData);

/** The row of the queue or the reported section that names `name`. */
const rowOf = (page: Page, testId: string, name: string) =>
  page
    .getByTestId(testId)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

/** The text of the WhatsApp message a wa.me link opens with. */
function whatsappText(href: string | null): string {
  return new URL(href ?? "").searchParams.get("text") ?? "";
}

/** The path of the absolute address in `text` that contains `segment`. */
function pathIn(text: string, segment: string): string {
  const url = text.split(/\s+/).find((word) => word.includes(segment));
  if (url === undefined) throw new Error(`e2e: no address with ${segment} in the message`);
  return new URL(url).pathname;
}

/** How many objects of a photo are in the local media bucket. */
async function objectsOf(photoKey: string): Promise<number> {
  let count = 0;
  await withLocalMediaBucket(async (bucket) => {
    for (const key of photoObjectKeys(photoKey)) if ((await bucket.head(key)) !== null) count += 1;
  });
  return count;
}

async function cardRow(id: string) {
  let found: typeof businesses.$inferSelect | undefined;
  await withDatabase(async (db) => {
    [found] = await db.select().from(businesses).where(eq(businesses.id, id));
  });
  return found;
}

async function editRow(id: number) {
  let found: typeof pendingEdits.$inferSelect | undefined;
  await withDatabase(async (db) => {
    [found] = await db.select().from(pendingEdits).where(eq(pendingEdits.id, id));
  });
  return found;
}

/** No sideways scroll at 390px, and every control of the main content measures 44px. */
async function expectPhoneReady(page: Page): Promise<void> {
  expect(page.viewportSize()?.width).toBe(390);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const controls = page.getByRole("main").locator("a, button, select, textarea");
  for (const control of await controls.all()) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    const label = `${page.url()} "${await control.innerText()}"`;
    expect.soft(box, label).not.toBeNull();
    if (box) expect.soft(Math.min(box.width, box.height), label).toBeGreaterThanOrEqual(44);
  }
}

test.describe("marking the reports of a card as attended", () => {
  test("each report once: its notice, the section and the queue follow, and sending it again changes nothing", async ({
    page,
    baseURL,
  }) => {
    const detail = `/admin/registros/${ids.reported}`;
    await page.goto(detail);
    const section = page.getByTestId("pending-reports");
    await expect(section.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText(/Reporte atendido\.|ya lo habías atendido/)).toHaveCount(0);
    await expectPhoneReady(page);

    const answer = page.waitForResponse((response) => response.request().method() === "POST");
    await section
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: "Marcar como atendido" })
      .click();
    const response = await answer;
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(new URL(page.url()).pathname).toBe(detail);
    expect(new URL(page.url()).search).toBe("?_action=admin.attendReport");
    await expect(page.getByRole("status")).toHaveText("Reporte atendido.");
    await expect(page.getByRole("status")).toBeInViewport();
    await expect(section.getByRole("listitem")).toHaveCount(1);
    await expect(section).toContainText("Ya no contestan (comentario de mentira)");
    await expect(page.getByText(DELAY)).toHaveCount(0);

    await page.goto("/admin");
    await expect(rowOf(page, "reported", NAMES.reported)).toContainText("1 reporte sin atender");

    // Opened any other way, the detail paints no notice.
    await page.goto(detail);
    await expect(page.getByText("Reporte atendido.")).toHaveCount(0);
    await page.getByRole("button", { name: "Marcar como atendido" }).click();
    await expect(page.getByRole("status")).toHaveText("Reporte atendido.");
    await expect(page.getByTestId("pending-reports")).toHaveCount(0);
    await expect(page.getByText("Reportes sin atender")).toHaveCount(0);

    await page.goto("/admin");
    await expect(rowOf(page, "reported", NAMES.reported)).toHaveCount(0);

    // The card did not change.
    expect(await cardRow(ids.reported)).toMatchObject({
      status: "published",
      name: NAMES.reported,
    });

    // Sending it again (a reload, a tab left open): it was attended, its date stays.
    let attendedAt: Date | null | undefined;
    await withDatabase(async (db) => {
      [{ attendedAt } = { attendedAt: undefined }] = await db
        .select({ attendedAt: reports.attendedAt })
        .from(reports)
        .where(eq(reports.id, reportIds.first));
    });
    const origin = new URL(baseURL ?? "http://localhost:4321").origin;
    const again = await page.request.post(`${detail}?_action=admin.attendReport`, {
      form: { reporte: String(reportIds.first) },
      headers: { Origin: origin },
    });
    expect(again.status()).toBe(409);
    expect(await again.text()).toContain("Este reporte ya lo habías atendido.");
    await withDatabase(async (db) => {
      const [row] = await db
        .select({ attendedAt: reports.attendedAt })
        .from(reports)
        .where(eq(reports.id, reportIds.first));
      expect(row?.attendedAt).toEqual(attendedAt);
    });

    // A report of another card, or none: the same 404, naming nothing.
    for (const reporte of [String(reportIds.last), "999999999"]) {
      const response = await page.request.post(
        `/admin/registros/${ids.applied}?_action=admin.attendReport`,
        { form: { reporte }, headers: { Origin: origin } },
      );
      expect(response.status(), reporte).toBe(404);
      expect(await response.text(), reporte).not.toMatch(/Mentiras|7719998/);
    }
  });
});

test.describe("resolving a pending edit", () => {
  test("applying a new photo and an Otra: the zone first, then the card says it, and the public card shows it", async ({
    page,
    baseURL,
  }) => {
    const detail = `/admin/ediciones/${edits.applied}`;
    await page.goto(detail);
    const apply = page.getByTestId("apply-form");
    await expect(
      apply.getByText('El negocio escribió su colonia como "Otra": Colonia Nueva de Mentiras'),
    ).toBeVisible();
    await expect(page.getByTestId("discard-form")).toBeVisible();
    await expectPhoneReady(page);

    // Without a zone nothing is applied.
    const refused = page.waitForResponse((response) => response.request().method() === "POST");
    await apply.getByRole("button", { name: "Aplicar los cambios" }).click();
    expect((await refused).status()).toBe(400);
    await expect(page.getByText("Elige la colonia de este negocio")).toBeVisible();
    expect((await editRow(edits.applied))?.status).toBe("pending");
    expect((await cardRow(ids.applied))?.photoKey).toBe(PHOTOS.applied);

    await page.getByTestId("apply-form").getByLabel("¿En qué colonia está?").selectOption({
      label: "Huicalco",
    });
    const answer = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.status() === 303,
    );
    await page
      .getByTestId("apply-form")
      .getByRole("button", { name: "Aplicar los cambios" })
      .click();
    expect((await answer).headers()["location"]).toBe(`${detail}/aplicada`);
    await expect(page).toHaveURL(`${detail}/aplicada`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Listo, la ficha ya se actualizó.",
    );
    await expect(page.getByText(DELAY)).toBeVisible();
    const notify = page.getByRole("link", { name: "Avisarle por WhatsApp" });
    await expect(notify).toHaveAttribute(
      "href",
      new RegExp(`^https://wa\\.me/52${PHONES}002\\?text=`),
    );
    const message = whatsappText(await notify.getAttribute("href"));
    expect(message).toMatch(
      new RegExp(
        `^¡Listo! Ya actualizamos la ficha de «${NAMES.applied}» en enmirumbo\\. Así quedó: `,
      ),
    );
    const cardPath = pathIn(message, "/negocio/");
    expect(cardPath).toBe(
      `/hidalgo/tizayuca/negocio/con-cambios-por-aplicar-de-mentiras-${ids.applied}`,
    );
    await expectPhoneReady(page);

    expect(await cardRow(ids.applied)).toMatchObject({
      status: "published",
      zoneId: huicalco,
      zoneOther: "Colonia Nueva de Mentiras",
      openingHours: "De 10 a 7 (de mentiras)",
      photoKey: PHOTOS.proposed,
    });
    expect((await editRow(edits.applied))?.status).toBe("applied");
    // The old photo is gone once the card was saved; the new one is the card's.
    expect(await objectsOf(PHOTOS.applied)).toBe(0);
    expect(await objectsOf(PHOTOS.proposed)).toBe(2);

    // The public card shows it within a minute.
    await expect
      .poll(async () => (await page.request.get(cardPath)).text(), { timeout: 70_000 })
      .toContain(photoObjectKey(PHOTOS.proposed, "full"));
    await page.goto(cardPath);
    await expect(page.getByRole("main")).toContainText("De 10 a 7 (de mentiras)");
    await expect(page.getByRole("main").locator("img").first()).toHaveAttribute(
      "src",
      `/_media/${photoObjectKey(PHOTOS.proposed, "full")}`,
    );

    // Reloading the confirmation applies nothing again; sending the form again finds it resolved.
    await page.goto(`${detail}/aplicada`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Listo, la ficha ya se actualizó.",
    );
    const origin = new URL(baseURL ?? "http://localhost:4321").origin;
    const again = await page.request.post(`${detail}?_action=admin.applyEdit`, {
      form: { colonia: "huicalco" },
      headers: { Origin: origin },
    });
    expect(again.status()).toBe(409);
    expect(await again.text()).toContain("Estos cambios ya los habías resuelto.");
    await page.goto(detail);
    await expect(page.getByText("Estos cambios ya los habías resuelto.")).toBeVisible();
    await expect(page.getByTestId("apply-form")).toHaveCount(0);
  });

  test("discarding needs a reason, leaves the card as it was, deletes the new photo and offers the notice", async ({
    page,
    baseURL,
  }) => {
    const detail = `/admin/ediciones/${edits.discarded}`;
    const before = await cardRow(ids.discarded);
    await page.goto(detail);
    const discard = page.getByTestId("discard-form");

    const refused = page.waitForResponse((response) => response.request().method() === "POST");
    await discard.getByRole("button", { name: "Descartar los cambios" }).click();
    expect((await refused).status()).toBe(400);
    await expect(page.getByText("Escribe por qué descartas los cambios")).toBeVisible();
    expect((await editRow(edits.discarded))?.status).toBe("pending");

    const reason = "El nombre nuevo no es el del negocio (motivo de mentira)";
    await page.getByLabel("¿Por qué no aplicas los cambios?").fill(reason);
    await page
      .getByTestId("discard-form")
      .getByRole("button", { name: "Descartar los cambios" })
      .click();
    await expect(page).toHaveURL(`${detail}/descartada`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cambios descartados.");
    await expect(page.getByText(DELAY)).toHaveCount(0);
    const notify = page.getByRole("link", { name: "Avisarle por WhatsApp" });
    // To the published number: the changes did not reach the card.
    await expect(notify).toHaveAttribute(
      "href",
      new RegExp(`^https://wa\\.me/52${PHONES}003\\?text=`),
    );
    expect(whatsappText(await notify.getAttribute("href"))).toBe(
      `Hola, revisamos los cambios que mandaste para «${NAMES.discarded}» en enmirumbo y por ahora no los pudimos aplicar: ${reason}. Tu ficha sigue publicada como estaba y puedes mandarlos otra vez con tu mismo enlace.`,
    );
    await expectPhoneReady(page);

    expect(await cardRow(ids.discarded)).toEqual(before);
    expect(await editRow(edits.discarded)).toMatchObject({
      status: "discarded",
      discardReason: reason,
      newPhotoKey: null,
    });
    expect(await objectsOf(PHOTOS.dropped)).toBe(0);
    expect(await objectsOf(PHOTOS.discarded)).toBe(2);

    await page.goto("/admin");
    await expect(rowOf(page, "queue", NAMES.discarded)).toHaveCount(0);

    const origin = new URL(baseURL ?? "http://localhost:4321").origin;
    const again = await page.request.post(`${detail}?_action=admin.discardEdit`, {
      form: { motivo: "Otra vez" },
      headers: { Origin: origin },
    });
    expect(again.status()).toBe(409);
    expect(await again.text()).toContain("Estos cambios ya los habías resuelto.");
  });

  test("a resolution posted from another page, or to /_actions/, resolves nothing", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost:4321").origin;
    for (const [path, status] of [
      // The queue answers as it would, with the action's 404, and resolves nothing.
      [`/admin?_action=admin.applyEdit`, 404],
      // The detail of a card takes no resolution of an edit.
      [`/admin/registros/${ids.noJs}?_action=admin.discardEdit`, 405],
      [`/admin/ediciones/${edits.noJs}?_action=admin.attendReport`, 405],
      [`/_actions/admin.applyEdit`, 404],
      [`/_actions/admin.discardEdit`, 404],
      [`/_actions/admin.attendReport`, 404],
    ] as const) {
      const response = await page.request.post(path, {
        form: { motivo: "Desde otro lado", colonia: "huicalco", reporte: String(reportIds.last) },
        headers: { Origin: origin },
      });
      expect(response.status(), path).toBe(status);
      expect(await response.text(), path).not.toMatch(/Listo, la ficha|Cambios descartados/);
    }
    expect((await editRow(edits.noJs))?.status).toBe("pending");
  });
});

test.describe("resolving without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("applying is a plain form submission", async ({ page }) => {
    await page.goto(`/admin/ediciones/${edits.noJs}`);
    await page
      .getByTestId("apply-form")
      .getByRole("button", { name: "Aplicar los cambios" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Listo, la ficha ya se actualizó.",
    );
    expect((await cardRow(ids.noJs))?.openingHours).toBe("Sin JavaScript (de mentiras)");
    await withDatabase(async (db) => {
      const rows = await db
        .select({ status: pendingEdits.status })
        .from(pendingEdits)
        .where(inArray(pendingEdits.id, [edits.noJs]));
      expect(rows).toEqual([{ status: "applied" }]);
    });

    await page.goto(`/admin/registros/${ids.noJs}`);
    await page.getByRole("button", { name: "Marcar como atendido" }).click();
    await expect(page.getByRole("status")).toHaveText("Reporte atendido.");
    await expect(page.getByTestId("pending-reports")).toHaveCount(0);
    await withDatabase(async (db) => {
      const [report] = await db
        .select({ attendedAt: reports.attendedAt })
        .from(reports)
        .where(eq(reports.id, reportIds.noJs));
      expect(report?.attendedAt).toBeInstanceOf(Date);
    });

    await page.goto(`/admin/ediciones/${edits.noJsDiscard}`);
    await page
      .getByLabel("¿Por qué no aplicas los cambios?")
      .fill("No aplicamos estos cambios en la prueba sin JavaScript.");
    await page.getByRole("button", { name: "Descartar los cambios" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cambios descartados.");
    await withDatabase(async (db) => {
      const [edit] = await db
        .select({ status: pendingEdits.status, discardReason: pendingEdits.discardReason })
        .from(pendingEdits)
        .where(eq(pendingEdits.id, edits.noJsDiscard));
      expect(edit).toMatchObject({
        status: "discarded",
        discardReason: "No aplicamos estos cambios en la prueba sin JavaScript.",
      });
    });
  });
});
