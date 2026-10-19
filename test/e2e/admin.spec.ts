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
// (v2)", "The detail of a pending edit shows the photo it proposes (v2)",
// "Approving assigns trades, normalizes the zone, marks the origin and
// publishes the card", "Approving a registration generates its management
// link, unique and unrepeatable", "On approving, an offer is made to notify
// the business by WhatsApp with its card link and its management link",
// "Rejecting requires a reason, stores it with its date and offers to notify
// by WhatsApp", "A transition is only applied to a registration that is still
// in review", "Approving and rejecting are forms of the detail, and their
// action checks everything again (v2)", "The management link is shown only in
// the answer to the approval (v2)" and "The queue labels the resubmission of
// a rejected card, and its detail says why it was rejected before (v2)".
//
// `astro preview` runs with the local vars of wrangler.jsonc (ENVIRONMENT
// local) on localhost, so every request carries the fixed local identity,
// which the global setup made a super admin (./local-admin.ts); the tests of
// roles narrow it for a while and give it back. This file adds fictitious
// cards to Tizayuca, one of them published, and to a fictitious, inactive
// locality of its own (state 79), with numbers of the 7719996xxx series and
// photos in the local media bucket; its decisions publish some and reject
// others, writing entries of the audit log. It removes all of it before and
// after.
// It runs alone, in its own project of playwright.config.ts ("phone,
// admin"), so no other file sees them.
import { expect, type Page, test } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { withLocalMediaBucket } from "../../scripts/seed-media.ts";
import { newBusinessId } from "../../src/core/business/id.ts";
import { seedPhotoObjects } from "../../src/core/db/seed/photos.ts";
import {
  adminAuditLog,
  businessTrades,
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
import { stubTurnstile } from "./turnstile.ts";

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
  toApprove: "Por Aprobar del Panel de Mentiras",
  toReject: "Por Rechazar del Panel de Mentiras",
  resubmitted: "Reenviada del Panel de Mentiras",
  approveNoJs: "Aprobada Sin JavaScript de Mentiras",
  rejectNoJs: "Rechazada Sin JavaScript de Mentiras",
} as const;

const PHOTOS = {
  old: newPhotoKey(),
  edited: newPhotoKey(),
  proposed: newPhotoKey(),
  toApprove: newPhotoKey(),
};
/** The reason the resubmitted card was rejected for. */
const PREVIOUS_REASON = "La foto tenía personas (motivo de mentira)";
/** A role of this file, which only attends reports. */
const REPORTS_ONLY = "e2e_reports_only";
const FILLERS = 12;

const ids = {
  old: newBusinessId(),
  edited: newBusinessId(),
  unpublished: newBusinessId(),
  reported: newBusinessId(),
  elsewhere: newBusinessId(),
  toApprove: newBusinessId(),
  toReject: newBusinessId(),
  resubmitted: newBusinessId(),
  approveNoJs: newBusinessId(),
  rejectNoJs: newBusinessId(),
};
let editId = 0;

async function removeData(): Promise<void> {
  await withDatabase(async (db) => {
    await db.delete(adminAuditLog).where(inArray(adminAuditLog.businessId, Object.values(ids)));
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
      {
        ...base,
        id: ids.toApprove,
        name: NAMES.toApprove,
        whatsapp: `${PHONES}021`,
        zoneId: null,
        zoneOther: "Colonia Inventada del Panel",
        photoKey: PHOTOS.toApprove,
        registeredAt: ago(3 * HOUR),
        consentedToNoticeAt: ago(3 * HOUR),
      },
      {
        ...base,
        id: ids.toReject,
        name: NAMES.toReject,
        whatsapp: `${PHONES}022`,
        registeredAt: ago(5 * HOUR),
        consentedToNoticeAt: ago(5 * HOUR),
      },
      {
        ...base,
        id: ids.resubmitted,
        name: NAMES.resubmitted,
        whatsapp: `${PHONES}023`,
        previousRejectedAt: ago(3 * DAY),
        previousRejectionReason: PREVIOUS_REASON,
        registeredAt: ago(2 * HOUR),
        consentedToNoticeAt: ago(10 * DAY),
      },
      {
        ...base,
        id: ids.approveNoJs,
        name: NAMES.approveNoJs,
        whatsapp: `${PHONES}024`,
        registeredAt: ago(6 * HOUR),
        consentedToNoticeAt: ago(6 * HOUR),
      },
      {
        ...base,
        id: ids.rejectNoJs,
        name: NAMES.rejectNoJs,
        whatsapp: `${PHONES}025`,
        registeredAt: ago(7 * HOUR),
        consentedToNoticeAt: ago(7 * HOUR),
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
      { name: NAMES.toApprove, photoKey: PHOTOS.toApprove, shade: 4 },
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
  const controls = page.getByRole("main").locator("a, button, input, select, textarea");
  for (const control of await controls.all()) {
    const type = await control.getAttribute("type");
    if (type === "hidden") continue;
    // A checkbox or a radio is tapped through its label.
    const target =
      type === "checkbox" || type === "radio"
        ? control.locator("xpath=ancestor::label[1]")
        : control;
    // A control inside a list that scrolls by itself is measured once in view.
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
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

async function statusOf(id: string): Promise<string | undefined> {
  let status: string | undefined;
  await withDatabase(async (db) => {
    const [row] = await db
      .select({ status: businesses.status })
      .from(businesses)
      .where(eq(businesses.id, id));
    status = row?.status;
  });
  return status;
}

async function auditEntries(id: string): Promise<number> {
  let count = 0;
  await withDatabase(async (db) => {
    count = (await db.select().from(adminAuditLog).where(eq(adminAuditLog.businessId, id))).length;
  });
  return count;
}

test.describe("deciding on a registration in review", () => {
  test("approving: the trades, the zone of an Otra, the origin, and the notice with both links, once", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`/admin/registros/${ids.toApprove}`);
    const approveForm = page.getByTestId("approve-form");
    await expect(approveForm.getByText("Giros (de 1 a 3, o ninguno si no embona)")).toBeVisible();
    await expect(
      approveForm.getByText(
        'El negocio escribió su colonia como "Otra": Colonia Inventada del Panel',
      ),
    ).toBeVisible();
    await expect(page.getByTestId("reject-form")).toBeVisible();
    await expectPhoneReady(page);

    // Four trades and no zone: nothing is published, and what was chosen comes back.
    for (const trade of ["Plomería", "Herrería", "Electricidad", "Pintura"]) {
      await approveForm.getByLabel(trade, { exact: true }).check();
    }
    await approveForm.getByLabel("Lo sembramos nosotros").check();
    await approveForm.getByRole("button", { name: "Aprobar y publicar" }).click();
    await expect(page.getByText("Elige máximo 3 giros")).toBeVisible();
    await expect(page.getByText("Elige la colonia de este negocio")).toBeVisible();
    for (const trade of ["Plomería", "Herrería", "Electricidad", "Pintura"]) {
      await expect(
        page.getByTestId("approve-form").getByLabel(trade, { exact: true }),
      ).toBeChecked();
    }
    await expect(
      page.getByTestId("approve-form").getByLabel("Lo sembramos nosotros"),
    ).toBeChecked();
    expect(await statusOf(ids.toApprove)).toBe("in_review");

    // Two trades, a catalogue zone and the origin: published, with its notice.
    const form = page.getByTestId("approve-form");
    await form.getByLabel("Electricidad", { exact: true }).uncheck();
    await form.getByLabel("Pintura", { exact: true }).uncheck();
    await form.getByLabel("¿En qué colonia está?").selectOption({ label: "Huicalco" });
    const answer = page.waitForResponse((response) => response.request().method() === "POST");
    await form.getByRole("button", { name: "Aprobar y publicar" }).click();
    const response = await answer;

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(response.url()).toBe(
      new URL(`/admin/registros/${ids.toApprove}?_action=admin.approve`, page.url()).href,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ya quedó publicado.");
    await expect(
      page.getByText("Listo. El cambio puede tardar hasta un minuto en verse en el sitio."),
    ).toBeVisible();
    await expect(
      page.getByText("Mándale el mensaje ahora: este enlace solo se ve aquí."),
    ).toBeVisible();
    const notify = page.getByRole("link", { name: "Avisarle por WhatsApp" });
    await expect(notify).toHaveAttribute(
      "href",
      new RegExp(`^https://wa\\.me/52${PHONES}021\\?text=`),
    );
    await expect(notify).toHaveAttribute("rel", "noopener noreferrer");
    const message = whatsappText(await notify.getAttribute("href"));
    expect(message).toMatch(
      new RegExp(
        `^¡Listo! Ya quedó publicado «${NAMES.toApprove}» en enmirumbo\\. Esta es tu ficha: `,
      ),
    );
    expect(message).toContain("guarda este mensaje (puedes destacarlo con la estrella)");
    const cardPath = pathIn(message, "/negocio/");
    const editPath = pathIn(message, "/editar/");
    expect(cardPath).toBe(
      `/hidalgo/tizayuca/negocio/por-aprobar-del-panel-de-mentiras-${ids.toApprove}`,
    );
    // The management link is in the notice and nowhere else of the page.
    const token = editPath.split("/").at(-1) ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await page.content()).split(token)).toHaveLength(2);

    await withDatabase(async (db) => {
      const [card] = await db.select().from(businesses).where(eq(businesses.id, ids.toApprove));
      expect(card).toMatchObject({
        status: "published",
        origin: "seeded",
        zoneOther: "Colonia Inventada del Panel",
      });
      expect(card?.zoneId).not.toBeNull();
      expect(card?.managementTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(card)).not.toContain(token);
      const assigned = await db
        .select()
        .from(businessTrades)
        .where(eq(businessTrades.businessId, ids.toApprove));
      expect(assigned).toHaveLength(2);
    });

    // Sending the same approval again (a reload, a tab left open): already resolved, no link.
    const again = await page.request.post(
      `/admin/registros/${ids.toApprove}?_action=admin.approve`,
      {
        form: { giro: "plomeria", origen: "organic" },
        headers: { Origin: new URL(baseURL ?? "http://localhost:4321").origin },
      },
    );
    expect(again.status()).toBe(409);
    const body = await again.text();
    expect(body).toContain("Este registro ya lo habías resuelto.");
    expect(body).not.toMatch(/\/editar\/|wa\.me/);

    // Back on the detail, the link is no longer anywhere; only that it has one.
    await page.goto(`/admin/registros/${ids.toApprove}`);
    await expect(page.getByText(/^Tiene enlace de gestión, generado el /)).toBeVisible();
    expect(await page.content()).not.toContain(token);
    await expect(page.getByTestId("approve-form")).toHaveCount(0);
    await expect(page.getByTestId("reject-form")).toHaveCount(0);

    // The card answers on its public address, with its photo and its trades,
    // and the management link opens its edit mode.
    const publicCard = await page.goto(cardPath);
    expect(publicCard?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAMES.toApprove);
    await expect(page.getByRole("main")).toContainText("Plomería");
    await expect(page.locator(`img[src*="${PHOTOS.toApprove}/full.webp"]`)).toHaveCount(1);
    await stubTurnstile(page.context());
    const edit = await page.goto(editPath);
    expect(edit?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Edita tu ficha");
  });

  test("rejecting: the reason is required and never trimmed, and the notice carries it", async ({
    page,
  }) => {
    await page.goto(`/admin/registros/${ids.toReject}`);
    const reject = page.getByTestId("reject-form");

    await reject.getByRole("button", { name: "Rechazar" }).click();
    await expect(page.getByText("Escribe por qué lo rechazas")).toBeVisible();

    const long = `${"Este motivo es demasiado largo para el aviso. ".repeat(11)}Fin.`;
    expect(long.length).toBeGreaterThan(500);
    await page.getByLabel("¿Por qué lo rechazas?").fill(long);
    await page.getByTestId("reject-form").getByRole("button", { name: "Rechazar" }).click();
    await expect(
      page.getByText(
        "El motivo no puede pasar de 500 caracteres. Recórtalo un poco: así, completo, es como le va a llegar al negocio.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("¿Por qué lo rechazas?")).toHaveValue(long);
    expect(await statusOf(ids.toReject)).toBe("in_review");

    const reason = "No publicamos préstamos informales (motivo de mentira)";
    await page.getByLabel("¿Por qué lo rechazas?").fill(reason);
    await page.getByTestId("reject-form").getByRole("button", { name: "Rechazar" }).click();

    await expect(page).toHaveURL(`/admin/registros/${ids.toReject}/rechazado`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registro rechazado.");
    await expect(page.getByText("tardar hasta un minuto")).toHaveCount(0);
    const notify = page.getByRole("link", { name: "Avisarle por WhatsApp" });
    expect(whatsappText(await notify.getAttribute("href"))).toBe(
      `Hola, revisamos el registro de «${NAMES.toReject}» en enmirumbo y por ahora no lo pudimos publicar: ${reason}. Si lo corriges, lo puedes volver a enviar desde el mismo formulario con este mismo número.`,
    );
    expect(await statusOf(ids.toReject)).toBe("rejected");
    expect(await auditEntries(ids.toReject)).toBe(1);

    // Reloading the confirmation rejects nothing again.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registro rechazado.");
    expect(await auditEntries(ids.toReject)).toBe(1);

    // The detail shows the rejection, offers no decision, and the card is no public page.
    await page.goto(`/admin/registros/${ids.toReject}`);
    await expect(page.getByRole("main")).toContainText(reason);
    await expect(page.getByTestId("approve-form")).toHaveCount(0);
    const publicCard = await page.goto(
      `/hidalgo/tizayuca/negocio/por-rechazar-del-panel-de-mentiras-${ids.toReject}`,
    );
    expect(publicCard?.status()).toBe(404);

    // The confirmation of a card that is not rejected goes back to its detail.
    await page.goto(`/admin/registros/${ids.old}/rechazado`);
    await expect(page).toHaveURL(`/admin/registros/${ids.old}`);
  });

  test("a resubmission is a Reenvío in the queue, and its detail says why it was rejected before", async ({
    page,
  }) => {
    await page.goto("/admin");
    const row = rowOf(page, "queue", NAMES.resubmitted);
    await expect(row).toContainText("Reenvío");
    await expect(row).not.toContainText("Alta nueva");
    await expect(rowOf(page, "queue", NAMES.old)).toContainText("Alta nueva");

    await page.getByRole("link", { name: `Revisar: ${NAMES.resubmitted}` }).click();
    await expect(page.getByTestId("previous-rejection")).toContainText(
      `La rechazaste antes por: ${PREVIOUS_REASON}`,
    );
    await expect(page.getByTestId("previous-rejection")).toContainText(
      /Fue el \d{1,2} de [a-z]+ de \d{4}, \d{2}:\d{2}\./,
    );
  });

  test("a decision posted from another page, or to /_actions/, decides nothing", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost:4321").origin;
    for (const [path, status] of [
      // The queue answers as it would, with the action's 404, and decides nothing.
      [`/admin?_action=admin.approve`, 404],
      [`/admin/negocios?_action=admin.reject`, 405],
      [`/_actions/admin.approve`, 404],
      [`/_actions/admin.reject`, 404],
    ] as const) {
      const response = await page.request.post(path, {
        form: { motivo: "Desde otro lado", origen: "organic" },
        headers: { Origin: origin },
      });
      expect(response.status(), path).toBe(status);
      expect(await response.text(), path).not.toMatch(
        /\/editar\/|Ya quedó publicado|Registro rechazado/,
      );
    }
    expect(await statusOf(ids.resubmitted)).toBe("in_review");
    expect(await auditEntries(ids.resubmitted)).toBe(0);
  });
});

test.describe("deciding without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("approving and rejecting are plain form submissions", async ({ page }) => {
    await page.goto(`/admin/registros/${ids.approveNoJs}`);
    await page
      .getByTestId("approve-form")
      .getByRole("button", { name: "Aprobar y publicar" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ya quedó publicado.");
    expect(await statusOf(ids.approveNoJs)).toBe("published");

    await page.goto(`/admin/registros/${ids.rejectNoJs}`);
    await page.getByLabel("¿Por qué lo rechazas?").fill("Sin JavaScript (motivo de mentira)");
    await page.getByTestId("reject-form").getByRole("button", { name: "Rechazar" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registro rechazado.");
    expect(await statusOf(ids.rejectNoJs)).toBe("rejected");
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

    // It opens the detail of a card in review, without its decisions, and may not decide.
    expect((await page.goto(`/admin/registros/${ids.old}`))?.status()).toBe(200);
    await expect(page.getByTestId("approve-form")).toHaveCount(0);
    await expect(page.getByTestId("reject-form")).toHaveCount(0);
    const decision = await page.request.post(`/admin/registros/${ids.old}?_action=admin.reject`, {
      form: { motivo: "Sin permiso (motivo de mentira)" },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(decision.status()).toBe(403);
    expect(await decision.text()).not.toContain(NAMES.old);
    expect(await statusOf(ids.old)).toBe("in_review");
  });
});
