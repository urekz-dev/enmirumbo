// The review screens of the panel on the built site, through the Access check
// (docs/specs/admin-review.md): "The panel is not indexed nor linked from the
// public site", "Review queue with the pending registrations, oldest first",
// "Visible indicator for registrations waiting more than 48 hours", "The
// queue tells which businesses have unattended reports", "'Todos los
// negocios' view with the status in sight and an entry to the detail", "The
// listing is filtered by status without leaving the view", "The listing is
// cut into pages and does not degrade when there are many records", "The
// queue has a visible entry to the listing, and the listing returns to the
// queue", "The listing inherits the panel's access, no-indexing and minimal
// data exposure", "The listing searches by name or WhatsApp (v2)",
// "Registration detail with all the captured data, only inside the panel",
// "The business detail lists its unattended reports", "The pending edit
// detail compares what is published with what is proposed", "The panel is
// operated from the phone and without unnecessary client JavaScript",
// "Locally, a fixed identity is injected only when the environment says
// `local` (v2)", "Inside the panel, a user can do only what their roles allow
// (v2)", "Each review screen checks its permission in the locality of what it
// shows (v2)", "The panel shows the photos it reviews from the media hostname
// (v2)" and "The detail of a pending edit shows the photo it proposes (v2)".
//
// `astro preview` runs with the local vars of wrangler.jsonc (ENVIRONMENT
// local) on localhost, so every request carries the fixed local identity,
// which the global setup made a super admin (./local-admin.ts); the tests of
// roles narrow it for a while and give it back. This file adds fictitious
// cards to Tizayuca, one of them published, and to a fictitious, inactive
// locality of its own (state 79), with numbers of the 7719996xxx series and
// photos in the local media bucket, and removes all of it before and after.
// It runs alone, in its own project of playwright.config.ts ("phone,
// admin"), so no other file sees them.
import { expect, type Page, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";
import { withLocalMediaBucket } from "../../scripts/seed-media.ts";
import { newBusinessId } from "../../src/core/business/id.ts";
import { seedPhotoObjects } from "../../src/core/db/seed/photos.ts";
import {
  businesses,
  categories,
  localities,
  municipalities,
  pendingEdits,
  reports,
  rolePermissions,
  roles,
  states,
  zones,
} from "../../src/core/db/schema/index.ts";
import { newPhotoKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import { withDatabase } from "./database.ts";
import { ensureLocalSuperAdmin, setLocalAdminRoles } from "./local-admin.ts";

const TIZAYUCA = "13069";
const PHONES = "7719996";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A fictitious, inactive locality of this file. */
const ELSEWHERE = {
  code: "79001",
  name: "Pueblo del Panel",
  slug: "pueblo-del-panel",
  state: { code: "79", name: "Estado de prueba 79", slug: "estado-de-prueba-79" },
} as const;

const NAMES = {
  old: "Alta Vieja del Panel de Mentiras",
  edited: "Publicada con Cambios de Mentiras",
  unpublished: "Despublicada del Panel de Mentiras",
  reported: "Reportada del Panel de Mentiras",
  elsewhere: "Alta de Otro Pueblo de Mentiras",
} as const;

const PHOTOS = { old: newPhotoKey(), edited: newPhotoKey(), proposed: newPhotoKey() };
/** A role of this file, which only attends reports. */
const REPORTS_ONLY = "e2e_reports_only";
const FILLERS = 12;

const ids = {
  old: newBusinessId(),
  edited: newBusinessId(),
  unpublished: newBusinessId(),
  reported: newBusinessId(),
  elsewhere: newBusinessId(),
};
let editId = 0;

async function removeData(): Promise<void> {
  await withDatabase(async (db) => {
    await db.delete(businesses).where(like(businesses.whatsapp, `${PHONES}%`));
    await db.delete(localities).where(eq(localities.code, ELSEWHERE.code));
    await db.delete(municipalities).where(eq(municipalities.code, ELSEWHERE.code));
    await db.delete(states).where(eq(states.code, ELSEWHERE.state.code));
    await ensureLocalSuperAdmin(db);
    await db.delete(roles).where(eq(roles.key, REPORTS_ONLY));
  });
  await withLocalMediaBucket(async (bucket) => {
    await bucket.delete(Object.values(PHOTOS).flatMap(photoObjectKeys));
  });
}

test.beforeAll(async () => {
  await removeData();
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms);
  await withDatabase(async (db) => {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, "servicios-del-hogar"));
    const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.slug, "huicalco"));
    if (!category || !zone)
      throw new Error("e2e: the catalogues are missing; is the database migrated?");
    await db.insert(states).values(ELSEWHERE.state);
    await db.insert(municipalities).values({
      code: ELSEWHERE.code,
      stateCode: ELSEWHERE.state.code,
      name: ELSEWHERE.name,
      slug: ELSEWHERE.slug,
    });
    await db.insert(localities).values({ code: ELSEWHERE.code, timeZone: "America/Mexico_City" });

    const base = {
      localityCode: TIZAYUCA,
      categoryId: category.id,
      zoneId: zone.id,
      consentedToNoticeVersion: "2",
    };
    await db.insert(businesses).values([
      {
        ...base,
        id: ids.old,
        name: NAMES.old,
        whatsapp: `${PHONES}001`,
        whatYouOffer: "Destapes de mentiras",
        landline: `${PHONES}101`,
        address: "Junto a la primaria inventada",
        openingHours: "Lunes a viernes de 9 a 6",
        photoKey: PHOTOS.old,
        registeredAt: ago(4 * DAY),
        consentedToNoticeAt: ago(4 * DAY),
      },
      {
        ...base,
        id: ids.edited,
        name: NAMES.edited,
        whatsapp: `${PHONES}002`,
        openingHours: "De 9 a 5",
        photoKey: PHOTOS.edited,
        status: "published",
        publishedAt: ago(10 * DAY),
        registeredAt: ago(11 * DAY),
        consentedToNoticeAt: ago(11 * DAY),
      },
      {
        ...base,
        id: ids.unpublished,
        name: NAMES.unpublished,
        whatsapp: `${PHONES}003`,
        registeredAt: ago(200 * DAY),
        consentedToNoticeAt: ago(200 * DAY),
        publishedAt: ago(150 * DAY),
        unpublishedAt: ago(HOUR + 60_000),
        unpublishReason: "El negocio cerró (motivo de mentira)",
      },
      {
        ...base,
        id: ids.reported,
        name: NAMES.reported,
        whatsapp: `${PHONES}004`,
        status: "published",
        publishedAt: ago(20 * DAY),
        registeredAt: ago(21 * DAY),
        consentedToNoticeAt: ago(21 * DAY),
      },
      {
        id: ids.elsewhere,
        localityCode: ELSEWHERE.code,
        categoryId: category.id,
        zoneOther: "Colonia del Panel",
        name: NAMES.elsewhere,
        whatsapp: `${PHONES}005`,
        consentedToNoticeAt: ago(2 * HOUR),
        consentedToNoticeVersion: "2",
        registeredAt: ago(2 * HOUR),
      },
      ...Array.from({ length: FILLERS }, (_, index) => ({
        ...base,
        id: newBusinessId(),
        name: `Rechazada de Relleno de Mentiras ${String(index + 1).padStart(2, "0")}`,
        whatsapp: `${PHONES}${String(200 + index)}`,
        status: "rejected" as const,
        rejectedAt: ago(DAY),
        rejectionReason: "Relleno de mentiras",
        registeredAt: ago((30 + index) * DAY),
        consentedToNoticeAt: ago((30 + index) * DAY),
      })),
    ]);
    const [row] = await db
      .insert(pendingEdits)
      .values({
        businessId: ids.edited,
        localityCode: TIZAYUCA,
        name: NAMES.edited,
        categoryId: category.id,
        whatsapp: `${PHONES}012`,
        zoneId: zone.id,
        openingHours: "De 10 a 7",
        photoChange: "replace",
        newPhotoKey: PHOTOS.proposed,
        createdAt: ago(2 * DAY),
      })
      .returning({ id: pendingEdits.id });
    editId = row?.id ?? 0;
    await db.insert(reports).values([
      {
        businessId: ids.reported,
        localityCode: TIZAYUCA,
        reason: "closed",
        createdAt: ago(3 * DAY),
      },
      {
        businessId: ids.reported,
        localityCode: TIZAYUCA,
        reason: "incorrect_data",
        comment: "<b>El teléfono</b> ya no es de ellos (comentario de mentira)",
        createdAt: ago(2 * DAY),
      },
      {
        businessId: ids.reported,
        localityCode: TIZAYUCA,
        reason: "not_real",
        status: "attended",
        attendedAt: ago(HOUR),
      },
      {
        businessId: ids.unpublished,
        localityCode: TIZAYUCA,
        reason: "closed",
        createdAt: ago(DAY),
      },
    ]);
  });
  await withLocalMediaBucket(async (bucket) => {
    const objects = seedPhotoObjects([
      { name: NAMES.old, photoKey: PHOTOS.old, shade: 1 },
      { name: NAMES.edited, photoKey: PHOTOS.edited, shade: 2 },
      { name: "Foto Nueva de Mentiras", photoKey: PHOTOS.proposed, shade: 3 },
    ]);
    for (const { key, body, contentType, cacheControl } of objects) {
      await bucket.put(key, body, { httpMetadata: { contentType, cacheControl } });
    }
  });
});

test.afterAll(removeData);

/** The row of the queue, the list or the reported section that names `name`. */
const rowOf = (page: Page, testId: string, name: string) =>
  page
    .getByTestId(testId)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

/** The names of the rows of a list of the panel, in order. */
const rowNames = (page: Page, testId: string) =>
  page.getByTestId(testId).getByRole("listitem").getByRole("heading").allInnerTexts();

/** Whether every image of the page loaded. */
async function expectImagesLoaded(page: Page, count: number): Promise<void> {
  const images = page.getByRole("main").locator("img");
  await expect(images).toHaveCount(count);
  for (const image of await images.all()) {
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  }
}

/** No sideways scroll at 390px, and every control of the page measures 44px. */
async function expectPhoneReady(page: Page): Promise<void> {
  expect(page.viewportSize()?.width).toBe(390);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  for (const control of await page.getByRole("main").locator("a, button, input").all()) {
    if ((await control.getAttribute("type")) === "hidden") continue;
    const box = await control.boundingBox();
    const label = `${page.url()} "${await control.innerText()}"`;
    expect.soft(box, label).not.toBeNull();
    if (box) expect.soft(Math.min(box.width, box.height), label).toBeGreaterThanOrEqual(44);
  }
}

test.describe("the panel's trunk", () => {
  test("/admin opens the queue for the local identity, not indexed, not cached and not measured", async ({
    page,
  }) => {
    const response = await page.goto("/admin");

    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["referrer-policy"]).toBe("strict-origin");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "strict-origin");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator("script")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: "Registros por revisar" }),
    ).toBeVisible();
  });

  test("no links from the public side: the home page does not link to /admin", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBeUndefined();
    await expect(page.locator('a[href*="admin" i]')).toHaveCount(0);
    expect(await page.content()).not.toMatch(/\/admin/i);
  });
});

test.describe("the review queue", () => {
  test("oldest first, each row labelled, with its wait, its marks and Revisar to its detail", async ({
    page,
  }) => {
    await page.goto("/admin");
    const names = await rowNames(page, "queue");
    const order = [NAMES.old, NAMES.edited, NAMES.elsewhere, NAMES.unpublished].map((name) =>
      names.indexOf(name),
    );

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(names).not.toContain(NAMES.reported);
    await expect(rowOf(page, "queue", NAMES.old)).toContainText("Hace 4 días");
    await expect(rowOf(page, "queue", NAMES.old)).toContainText("Alta nueva");
    await expect(rowOf(page, "queue", NAMES.old)).toContainText("Lleva más de 48 horas");
    await expect(rowOf(page, "queue", NAMES.edited)).toContainText("Edición");
    await expect(rowOf(page, "queue", NAMES.edited)).toContainText("Lleva más de 48 horas");
    await expect(rowOf(page, "queue", NAMES.unpublished)).toContainText("Hace 1 hora");
    await expect(rowOf(page, "queue", NAMES.unpublished)).toContainText(
      "Ya estaba publicada, la despublicaste",
    );
    await expect(rowOf(page, "queue", NAMES.unpublished)).not.toContainText("48 horas");
    await expect(page.getByTestId("overdue-count")).toHaveText(
      /^\d+ registros llevan más de 48 horas esperando\.$/,
    );
    // One active locality: no locality filter.
    await expect(page.getByText("Filtrar por municipio")).toHaveCount(0);
    await expectPhoneReady(page);
  });

  test("Revisar on an Edición opens the comparison of those changes, with the photo it proposes", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: `Revisar: ${NAMES.edited}` }).click();

    await expect(page).toHaveURL(`/admin/ediciones/${editId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Cambios por revisar" }),
    ).toBeVisible();
    const hours = page.locator('[data-field="openingHours"]');
    await expect(hours).toContainText("Cambió");
    await expect(hours).toContainText("De 9 a 5");
    await expect(hours).toContainText("De 10 a 7");
    await expect(page.locator('[data-field="name"]')).not.toContainText("Cambió");
    await expect(page.locator('[data-field="photo"]')).toContainText("Cambió");
    await expect(
      page.getByText(
        "Ojo: está cambiando su WhatsApp. Confirma con el número nuevo antes de aplicar.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Escribirle por WhatsApp" })).toHaveAttribute(
      "href",
      new RegExp(`^https://wa\\.me/52${PHONES}012\\?text=`),
    );
    await expectImagesLoaded(page, 2);
    await expect(page.locator(`img[src*="${PHOTOS.proposed}/full.webp"]`)).toHaveCount(1);
    await expectPhoneReady(page);
  });

  test("Revisar on an Alta nueva opens its detail: every field, its photo and the internal data", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: `Revisar: ${NAMES.old}` }).click();

    await expect(page).toHaveURL(`/admin/registros/${ids.old}`);
    await expect(page.getByRole("heading", { level: 1, name: NAMES.old })).toBeVisible();
    const main = page.getByRole("main");
    for (const text of [
      "Foto del negocio",
      `${PHONES}001`,
      "Huicalco",
      "Destapes de mentiras",
      "Junto a la primaria inventada",
      "Lunes a viernes de 9 a 6",
      "En revisión",
      "Se registró solo",
      "(versión 2)",
    ]) {
      await expect(main).toContainText(text);
    }
    await expectImagesLoaded(page, 1);
    await expect(page.getByRole("link", { name: "Escribirle por WhatsApp" })).toHaveAttribute(
      "href",
      new RegExp(`^https://wa\\.me/52${PHONES}001\\?text=Hola%2C%20te%20escribo%20de%20enmirumbo`),
    );
    await expect(main).not.toContainText("Reportes sin atender");
    await expectPhoneReady(page);
  });

  test("Negocios reportados lists the reported cards, and Ver reportes opens the detail with them", async ({
    page,
  }) => {
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Negocios reportados" })).toBeVisible();
    await expect(page.getByText(/^\d+ negocios tienen reportes sin atender\.$/)).toBeVisible();
    await expect(rowOf(page, "reported", NAMES.reported)).toContainText("2 reportes sin atender");
    await expect(rowOf(page, "reported", NAMES.unpublished)).toContainText("1 reporte sin atender");
    // The unpublished card is in both sections.
    await expect(rowOf(page, "queue", NAMES.unpublished)).toHaveCount(1);

    await page.getByRole("link", { name: `Ver reportes: ${NAMES.reported}` }).click();
    await expect(page).toHaveURL(`/admin/registros/${ids.reported}`);
    const section = page.getByTestId("pending-reports");
    await expect(section.getByRole("listitem")).toHaveCount(2);
    await expect(section.getByRole("listitem").first()).toContainText("Ya cerró");
    await expect(section.getByRole("listitem").nth(1)).toContainText("Los datos están mal");
    await expect(section).toContainText(
      "<b>El teléfono</b> ya no es de ellos (comentario de mentira)",
    );
    await expect(section.locator("b")).toHaveCount(0);
  });

  test("an unpublished card says when and why", async ({ page }) => {
    await page.goto(`/admin/registros/${ids.unpublished}`);

    await expect(page.getByRole("main")).toContainText("Cuándo la despublicaste");
    await expect(page.getByRole("main")).toContainText("El negocio cerró (motivo de mentira)");
  });

  test("a card or an edit that does not exist answers the site's 404, not indexed either", async ({
    page,
  }) => {
    for (const path of [
      "/admin/registros/zzzzzzzzzz",
      "/admin/registros/nada",
      "/admin/ediciones/999999999",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      expect(response?.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        "noindex, nofollow",
      );
    }
  });
});

test.describe("Todos los negocios, without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("from the queue: rows, the status filter, the pages and back to the queue", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: "Ver todos los negocios" }).click();

    await expect(page).toHaveURL("/admin/negocios");
    await expect(page.getByRole("heading", { level: 1, name: "Todos los negocios" })).toBeVisible();
    await expect(page.getByTestId("list-count")).toHaveText(/^\d+ negocios en esta lista$/);
    await expect(page.getByText("Página 1 de 2")).toBeVisible();
    await expect(page.getByTestId("businesses").getByRole("listitem")).toHaveCount(25);
    await expect(page.getByRole("link", { name: "Ver más nuevos" })).toHaveCount(0);
    const fresh = rowOf(page, "businesses", NAMES.elsewhere);
    await expect(fresh).toContainText("En revisión");
    await expect(fresh).toContainText(/Se registró el \d{1,2} de [a-z]+ de \d{4}/);
    await expect(
      fresh.getByRole("link", { name: `Ver detalle: ${NAMES.elsewhere}` }),
    ).toHaveAttribute("href", `/admin/registros/${ids.elsewhere}`);
    await expect(rowOf(page, "businesses", NAMES.unpublished)).toHaveCount(0);

    await page.getByRole("link", { name: "Ver más antiguos" }).click();
    await expect(page).toHaveURL("/admin/negocios?pagina=2");
    await expect(page.getByText("Página 2 de 2")).toBeVisible();
    await expect(rowOf(page, "businesses", NAMES.unpublished)).toContainText(
      "Ya estaba publicada, la despublicaste",
    );
    await expect(page.getByRole("link", { name: "Ver más antiguos" })).toHaveCount(0);

    await page.getByRole("link", { name: "Rechazados", exact: true }).click();
    await expect(page).toHaveURL("/admin/negocios?estado=rechazados");
    await expect(page.getByRole("link", { name: "Rechazados", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    for (const row of await page.getByTestId("businesses").getByRole("listitem").all()) {
      await expect(row).toContainText("Rechazado");
    }

    await page.getByRole("link", { name: "Publicados", exact: true }).click();
    await expect(page).toHaveURL("/admin/negocios?estado=publicados");
    await expect(rowOf(page, "businesses", NAMES.edited)).toContainText("Publicado");
    await expect(rowOf(page, "businesses", NAMES.old)).toHaveCount(0);
    await expectPhoneReady(page);

    await page.getByRole("link", { name: "Volver a la cola" }).click();
    await expect(page).toHaveURL("/admin");
  });

  test("an invented filter or page is the first page of Todos, and a page past the last has no rows", async ({
    page,
  }) => {
    const response = await page.goto("/admin/negocios?estado=inventado&estado=otro&pagina=dos");
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Página 1 de 2")).toBeVisible();
    await expect(page.getByRole("link", { name: "Todos", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await page.goto("/admin/negocios?pagina=99");
    await expect(page.getByTestId("businesses")).toHaveCount(0);
    await expect(page.getByText(/Todavía no hay|No hay negocios/)).toHaveCount(0);
    await page.getByRole("link", { name: "Ver más nuevos" }).click();
    await expect(page).toHaveURL("/admin/negocios?pagina=2");
  });

  test("a search by name or by WhatsApp, with a GET form, and the way out of it", async ({
    page,
  }) => {
    await page.goto("/admin/negocios");
    await page.getByLabel("Buscar por nombre o WhatsApp").fill("alta VIEJA panel");
    await page.getByRole("button", { name: "Buscar" }).click();

    await expect(page).toHaveURL(/\/admin\/negocios\?q=alta\+VIEJA\+panel$/);
    expect(await rowNames(page, "businesses")).toEqual([NAMES.old]);
    await expect(page.getByLabel("Buscar por nombre o WhatsApp")).toHaveValue("alta VIEJA panel");

    await page.getByLabel("Buscar por nombre o WhatsApp").fill(`+52 771 999 6001`);
    await page.getByRole("button", { name: "Buscar" }).click();
    expect(await rowNames(page, "businesses")).toEqual([NAMES.old]);

    await page.getByRole("link", { name: "Quitar la búsqueda" }).click();
    await expect(page).toHaveURL("/admin/negocios");

    await page.getByLabel("Buscar por nombre o WhatsApp").fill("veterinario espacial");
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText("No encontramos negocios con esa búsqueda.")).toBeVisible();
  });

  test("nothing is written from the list: another method gets a 405 with no data", async ({
    page,
    baseURL,
  }) => {
    const response = await page.request.post("/admin/negocios", {
      form: { estado: "publicados" },
      headers: { Origin: new URL(baseURL ?? "http://localhost:4321").origin },
    });

    expect(response.status()).toBe(405);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(await response.text()).toBe("");
  });
});

test.describe("each user sees only the localities and parts their roles allow", () => {
  test.afterEach(async () => {
    await withDatabase(async (db) => {
      await ensureLocalSuperAdmin(db);
      await db.delete(roles).where(eq(roles.key, REPORTS_ONLY));
    });
  });

  test("a locality admin of another locality sees nothing of Tizayuca", async ({ page }) => {
    await withDatabase((db) =>
      setLocalAdminRoles(db, [{ role: "locality_admin", locality: ELSEWHERE.code }]),
    );

    await page.goto("/admin");
    expect(await rowNames(page, "queue")).toEqual([NAMES.elsewhere]);
    await expect(page.getByRole("heading", { name: "Negocios reportados" })).toHaveCount(0);

    await page.goto("/admin/negocios");
    await expect(page.getByTestId("list-count")).toHaveText("1 negocio en esta lista");
    expect(await rowNames(page, "businesses")).toEqual([NAMES.elsewhere]);

    for (const path of [`/admin/registros/${ids.old}`, `/admin/ediciones/${editId}`]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("main")).not.toContainText(NAMES.old);
    }
    expect((await page.goto(`/admin/registros/${ids.elsewhere}`))?.status()).toBe(200);
  });

  test("a user on the Access policy but without any role gets the 403 and sees no data", async ({
    page,
  }) => {
    await withDatabase((db) => setLocalAdminRoles(db, []));

    for (const path of [
      "/admin",
      "/admin/negocios",
      `/admin/registros/${ids.old}`,
      `/admin/ediciones/${editId}`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(403);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "No tienes acceso a esta página",
      );
      expect(await page.content(), path).not.toMatch(/Mentiras|7719996/);
    }
  });

  test("a role that only attends reports sees the reported cards, not the registrations", async ({
    page,
  }) => {
    // A locality role holding reports.manage alone, removed afterwards.
    await withDatabase(async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: REPORTS_ONLY, name: "Solo reportes de prueba", scope: "locality" })
        .returning({ id: roles.id });
      await db
        .insert(rolePermissions)
        .values({ roleId: role!.id, permissionKey: "reports.manage" });
      await setLocalAdminRoles(db, [{ role: REPORTS_ONLY, locality: TIZAYUCA }]);
    });

    await page.goto("/admin");
    await expect(page.getByText("No hay registros esperando. Todo al día.")).toBeVisible();
    await expect(rowOf(page, "reported", NAMES.reported)).toHaveCount(1);
    await page.getByRole("link", { name: `Ver reportes: ${NAMES.reported}` }).click();
    await expect(page.getByTestId("pending-reports").getByRole("listitem")).toHaveCount(2);
    expect((await page.goto(`/admin/ediciones/${editId}`))?.status()).toBe(403);
  });
});
