// Unpublishing, a new management link and the permanent deletion on the
// built site, through the Access check (docs/specs/admin-review.md):
// "Unpublish a published card, with a mandatory reason and conditioned on the
// status", "On unpublishing, an offer is made to notify the business by
// WhatsApp", "The admin can generate a new link, and the previous one stops
// working", "Permanent deletion is confirmed in two steps, by typing a word",
// "Permanent deletion takes everything and leaves no trace of personal data",
// "The detail offers the actions that correspond to the status, with the
// context in sight", "The panel says that a change takes up to a minute to
// reach the site (v2)", "Inside the panel, a user can do only what their roles
// allow (v2)", "The panel is operated from the phone and without unnecessary
// client JavaScript" and "Unpublishing, a new link and the permanent deletion
// are forms of the detail, and their actions check everything again (v2)".
//
// `astro preview` runs with the local vars of wrangler.jsonc (ENVIRONMENT
// local) on localhost, so every request carries the fixed local identity,
// which the global setup made a super admin (./local-admin.ts); one test
// narrows it for a while and gives it back. Locally the media bucket is
// served under /_media/ with no cache in front, so a deletion purges nothing.
// This file adds fictitious cards to Tizayuca, with numbers of the 7719995xxx
// series and photos in the local media bucket, and unpublishes, relinks and
// deletes them, writing entries of the audit log. It removes all of it before
// and after. It runs alone, in its own project of playwright.config.ts
// ("phone, admin removals"), so no other file sees them.
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
  pendingEdits,
  reports,
  rolePermissions,
  roles,
  trades,
  zones,
} from "../../src/core/db/schema/index.ts";
import { issueManagementLink } from "../../src/core/management-link/link.ts";
import { newPhotoKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import { withDatabase } from "./database.ts";
import { ensureLocalSuperAdmin, setLocalAdminRoles } from "./local-admin.ts";
import { stubTurnstile } from "./turnstile.ts";

const TIZAYUCA = "13069";
const PHONES = "7719995";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DELAY = "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.";
/** A role of this file, which reviews registrations and does nothing else. */
const REVIEW_ONLY = "e2e_review_only";

const NAMES = {
  unpublish: "Por Despublicar del Panel de Mentiras",
  relink: "Con Enlace Nuevo del Panel de Mentiras",
  remove: "Por Borrar del Panel de Mentiras",
  unpublishNoJs: "Despublicada Sin JavaScript de Mentiras",
  relinkNoJs: "Enlace Sin JavaScript de Mentiras",
  removeNoJs: "Borrada Sin JavaScript de Mentiras",
  untouched: "Intocable del Panel de Mentiras",
} as const;

const ids = Object.fromEntries(Object.keys(NAMES).map((key) => [key, newBusinessId()])) as Record<
  keyof typeof NAMES,
  string
>;

const PHOTOS = { remove: newPhotoKey(), proposed: newPhotoKey() };
/** The pending edit of the card this file unpublishes. */
let unpublishEdit = 0;
/** The management links issued in the setup, by card. */
const tokens: Partial<Record<keyof typeof NAMES, string>> = {};

async function removeData(): Promise<void> {
  await withDatabase(async (db) => {
    await db.delete(adminAuditLog).where(inArray(adminAuditLog.businessId, Object.values(ids)));
    await db.delete(businesses).where(like(businesses.whatsapp, `${PHONES}%`));
    await ensureLocalSuperAdmin(db);
    await db.delete(roles).where(eq(roles.key, REVIEW_ONLY));
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
    const [trade] = await db
      .select({ id: trades.id })
      .from(trades)
      .where(eq(trades.slug, "plomeria"));
    if (!category || !zone || !trade) {
      throw new Error("e2e: the catalogues are missing; is the database migrated?");
    }
    const published = {
      localityCode: TIZAYUCA,
      categoryId: category.id,
      zoneId: zone.id,
      consentedToNoticeAt: ago(30 * DAY),
      consentedToNoticeVersion: "2",
      registeredAt: ago(30 * DAY),
      status: "published" as const,
      publishedAt: ago(20 * DAY),
    };
    await db.insert(businesses).values([
      { ...published, id: ids.unpublish, name: NAMES.unpublish, whatsapp: `${PHONES}001` },
      { ...published, id: ids.relink, name: NAMES.relink, whatsapp: `${PHONES}002` },
      {
        ...published,
        id: ids.remove,
        name: NAMES.remove,
        whatsapp: `${PHONES}003`,
        address: "Junto a la plaza inventada",
        photoKey: PHOTOS.remove,
      },
      {
        ...published,
        id: ids.unpublishNoJs,
        name: NAMES.unpublishNoJs,
        whatsapp: `${PHONES}004`,
      },
      { ...published, id: ids.relinkNoJs, name: NAMES.relinkNoJs, whatsapp: `${PHONES}005` },
      {
        ...published,
        id: ids.removeNoJs,
        name: NAMES.removeNoJs,
        whatsapp: `${PHONES}006`,
        status: "in_review",
        publishedAt: null,
      },
      { ...published, id: ids.untouched, name: NAMES.untouched, whatsapp: `${PHONES}007` },
    ]);
    for (const key of ["relink", "remove", "relinkNoJs"] as const) {
      const token = await issueManagementLink(db, ids[key]);
      if (token === null) throw new Error("e2e: a published card got no link");
      tokens[key] = token;
    }
    await db.insert(businessTrades).values({ businessId: ids.remove, tradeId: trade.id });
    await db.insert(reports).values([
      { businessId: ids.unpublish, localityCode: TIZAYUCA, reason: "closed", createdAt: ago(DAY) },
      { businessId: ids.remove, localityCode: TIZAYUCA, reason: "not_real", createdAt: ago(DAY) },
    ]);
    const [waiting] = await db
      .insert(pendingEdits)
      .values({
        businessId: ids.unpublish,
        localityCode: TIZAYUCA,
        name: NAMES.unpublish,
        categoryId: category.id,
        whatsapp: `${PHONES}011`,
        zoneId: zone.id,
        openingHours: "Cambios que esperan (de mentiras)",
        createdAt: ago(3 * HOUR),
      })
      .returning({ id: pendingEdits.id });
    unpublishEdit = waiting?.id ?? 0;
    await db.insert(pendingEdits).values({
      businessId: ids.remove,
      localityCode: TIZAYUCA,
      name: NAMES.remove,
      categoryId: category.id,
      whatsapp: `${PHONES}013`,
      zoneId: zone.id,
      photoChange: "replace",
      newPhotoKey: PHOTOS.proposed,
      createdAt: ago(2 * HOUR),
    });
  });
  await withLocalMediaBucket(async (bucket) => {
    const objects = seedPhotoObjects([
      { name: NAMES.remove, photoKey: PHOTOS.remove, shade: 1 },
      { name: "Foto Nueva de Mentiras", photoKey: PHOTOS.proposed, shade: 2 },
    ]);
    for (const { key, body, contentType, cacheControl } of objects) {
      await bucket.put(key, body, { httpMetadata: { contentType, cacheControl } });
    }
  });
});

test.afterAll(removeData);

function whatsappText(href: string | null): string {
  return new URL(href ?? "").searchParams.get("text") ?? "";
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

async function auditOf(id: string): Promise<{ action: string; previousStatus: string }[]> {
  let entries: { action: string; previousStatus: string }[] = [];
  await withDatabase(async (db) => {
    entries = await db
      .select({ action: adminAuditLog.action, previousStatus: adminAuditLog.previousStatus })
      .from(adminAuditLog)
      .where(eq(adminAuditLog.businessId, id));
  });
  return entries;
}

/** The origin a form of the site posts from, which Astro checks. */
const originOf = (page: Page) => ({ Origin: new URL(page.url()).origin });

/** No sideways scroll at 390px, and every control of the page measures 44px. */
async function expectPhoneReady(page: Page): Promise<void> {
  expect(page.viewportSize()?.width).toBe(390);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const controls = page.getByRole("main").locator("a, button, input, textarea");
  for (const control of await controls.all()) {
    if ((await control.getAttribute("type")) === "hidden") continue;
    const box = await control.boundingBox();
    const label = `${page.url()} "${await control.innerText()}"`;
    expect.soft(box, label).not.toBeNull();
    if (box) expect.soft(Math.min(box.width, box.height), label).toBeGreaterThanOrEqual(44);
  }
}

test.describe("the actions of a published card", () => {
  test("the detail offers them after the data, the reports and the verification", async ({
    page,
  }) => {
    await page.goto(`/admin/registros/${ids.unpublish}`);
    await expect(page.getByTestId("approve-form")).toHaveCount(0);
    await expect(page.getByTestId("reject-form")).toHaveCount(0);
    const unpublish = page.getByTestId("unpublish-form");
    await expect(unpublish.getByText("¿Por qué la despublicas?")).toBeVisible();
    await expect(
      unpublish.getByText("Este motivo se le enviará al negocio por WhatsApp."),
    ).toBeVisible();
    await expect(page.getByTestId("new-link-form")).toBeVisible();
    await expect(page.getByTestId("delete-control")).toContainText("Acción irreversible");
    const order = await page
      .getByRole("main")
      .locator(
        '[data-testid="pending-reports"], a:has-text("Escribirle por WhatsApp"), [data-testid="unpublish-form"], [data-testid="new-link-form"], [data-testid="delete-control"]',
      )
      .evaluateAll((elements) => elements.map((e) => e.getAttribute("data-testid") ?? "verify"));
    expect(order).toEqual([
      "pending-reports",
      "verify",
      "unpublish-form",
      "new-link-form",
      "delete-control",
    ]);
    await expectPhoneReady(page);

    // A card in review offers the decisions and the deletion, not these.
    await page.goto(`/admin/registros/${ids.removeNoJs}`);
    await expect(page.getByTestId("unpublish-form")).toHaveCount(0);
    await expect(page.getByTestId("new-link-form")).toHaveCount(0);
    await expect(page.getByTestId("approve-form")).toBeVisible();
    await expect(page.getByTestId("delete-control")).toBeVisible();
  });

  test("unpublishing: the reason is required, the notice carries it, and the card goes back to the queue", async ({
    page,
  }) => {
    await page.goto(`/admin/registros/${ids.unpublish}`);
    await page.getByTestId("unpublish-form").getByRole("button", { name: "Despublicar" }).click();
    await expect(page.getByText("Escribe por qué la despublicas")).toBeVisible();
    expect(await statusOf(ids.unpublish)).toBe("published");

    const reason = "El negocio cerró (motivo de mentira)";
    await page.getByLabel("¿Por qué la despublicas?").fill(reason);
    await page.getByTestId("unpublish-form").getByRole("button", { name: "Despublicar" }).click();

    await expect(page).toHaveURL(`/admin/registros/${ids.unpublish}/despublicado`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ya la despublicaste.");
    await expect(page.getByText(DELAY)).toBeVisible();
    const notify = page.getByRole("link", { name: "Avisarle por WhatsApp" });
    await expect(notify).toHaveAttribute("href", new RegExp(`^https://wa\\.me/52${PHONES}001\\?`));
    expect(whatsappText(await notify.getAttribute("href"))).toBe(
      `Hola, te escribo de enmirumbo. Bajamos del directorio la ficha de «${NAMES.unpublish}»: ${reason}. Si quieres que la volvamos a publicar o tienes alguna duda, contéstame por aquí.`,
    );
    expect(await statusOf(ids.unpublish)).toBe("in_review");
    expect(await auditOf(ids.unpublish)).toEqual([
      { action: "unpublish", previousStatus: "published" },
    ]);

    // Reloading the confirmation unpublishes nothing again.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ya la despublicaste.");
    expect(await auditOf(ids.unpublish)).toHaveLength(1);

    // Sending it again finds the card no longer published.
    const again = await page.request.post(
      `/admin/registros/${ids.unpublish}?_action=admin.unpublish`,
      { form: { motivo: "Otra vez" }, headers: originOf(page) },
    );
    expect(again.status()).toBe(409);
    expect(await again.text()).toContain("Esta ficha ya no estaba publicada.");
    expect(await auditOf(ids.unpublish)).toHaveLength(1);

    // The public card is gone; the queue has it back, marked, and with its report.
    const card = await page.goto(
      `/hidalgo/tizayuca/negocio/por-despublicar-del-panel-de-mentiras-${ids.unpublish}`,
    );
    expect(card?.status()).toBe(404);
    await page.goto("/admin");
    const row = page
      .getByTestId("queue")
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: NAMES.unpublish, exact: true }) });
    await expect(row).toContainText("Ya estaba publicada, la despublicaste");
    await expect(
      page
        .getByTestId("reported")
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: NAMES.unpublish, exact: true }) }),
    ).toHaveCount(1);

    // The confirmation of a card that was never unpublished goes back to its detail.
    await page.goto(`/admin/registros/${ids.removeNoJs}/despublicado`);
    await expect(page).toHaveURL(`/admin/registros/${ids.removeNoJs}`);

    // Its pending edit is not discarded while it is unpublished: the notice
    // would tell the owner that the card is still published.
    await page.goto(`/admin/ediciones/${unpublishEdit}`);
    await page.getByLabel("¿Por qué no aplicas los cambios?").fill("Ya no aplica (de mentiras)");
    const answer = page.waitForResponse((response) => response.request().method() === "POST");
    await page.getByRole("button", { name: "Descartar los cambios" }).click();
    expect((await answer).status()).toBe(409);
    await expect(
      page.getByText(
        "No se descartó nada: esta ficha ya no está publicada. Los cambios siguen esperando; resuélvelos cuando la vuelvas a publicar.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("¿Por qué no aplicas los cambios?")).toHaveValue(
      "Ya no aplica (de mentiras)",
    );
    await withDatabase(async (db) => {
      const [edit] = await db
        .select({ status: pendingEdits.status })
        .from(pendingEdits)
        .where(eq(pendingEdits.id, unpublishEdit));
      expect(edit?.status).toBe("pending");
    });
  });

  test("a new link: the old one stops opening, the new one opens, and it is shown once", async ({
    page,
  }) => {
    const old = tokens.relink ?? "";
    await page.goto(`/admin/registros/${ids.relink}`);
    const form = page.getByTestId("new-link-form");
    await expect(form).toContainText(
      "El enlace que tiene ahora el negocio deja de servir en cuanto generes otro.",
    );
    const answer = page.waitForResponse((response) => response.request().method() === "POST");
    await form.getByRole("button", { name: "Generar un enlace nuevo" }).click();
    const response = await answer;

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(response.url()).toBe(
      new URL(`/admin/registros/${ids.relink}?_action=admin.newLink`, page.url()).href,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Listo, el enlace anterior ya no sirve.",
    );
    await expect(
      page.getByText("Mándale el mensaje ahora: este enlace solo se ve aquí."),
    ).toBeVisible();
    await expect(page.getByText(DELAY)).toHaveCount(0);
    const send = page.getByRole("link", { name: "Mandarle el enlace por WhatsApp" });
    await expect(send).toHaveAttribute("rel", "noopener noreferrer");
    const message = whatsappText(await send.getAttribute("href"));
    expect(message).toMatch(
      new RegExp(
        `^Hola, te mandamos un enlace nuevo para editar tu ficha de «${NAMES.relink}» en enmirumbo: http\\S+/hidalgo/tizayuca/editar/[A-Za-z0-9_-]{43}\\. El anterior ya no sirve\\. Guarda este mensaje`,
      ),
    );
    const editUrl = message.split(/\s+/).find((word) => word.includes("/editar/")) ?? "";
    const editPath = new URL(editUrl.replace(/\.$/, "")).pathname;
    const token = editPath.split("/").at(-1) ?? "";
    expect(token).not.toBe(old);
    expect((await page.content()).split(token)).toHaveLength(2);
    expect(await auditOf(ids.relink)).toEqual([]);

    // Sending the same form again issues no other link.
    const again = await page.request.post(`/admin/registros/${ids.relink}?_action=admin.newLink`, {
      form: { enlace: "2020-01-01T00:00:00.000Z" },
      headers: originOf(page),
    });
    expect(again.status()).toBe(409);
    const body = await again.text();
    expect(body).toContain("Este enlace ya lo habías cambiado.");
    expect(body).not.toMatch(/\/editar\/|wa\.me/);

    // Back on the detail, the link is nowhere.
    await page.goto(`/admin/registros/${ids.relink}`);
    expect(await page.content()).not.toContain(token);

    // The old link answers the site's 404; the new one opens the edit mode of the card.
    await stubTurnstile(page.context());
    expect((await page.goto(`/hidalgo/tizayuca/editar/${old}`))?.status()).toBe(404);
    expect((await page.goto(editPath))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Edita tu ficha");
  });

  test("deleting: two steps and the word, photos and everything else, and a screen with nothing of the card", async ({
    page,
  }) => {
    await page.goto(`/admin/registros/${ids.remove}`);
    await page.getByRole("link", { name: "Borrar definitivamente" }).click();
    await expect(page).toHaveURL(`/admin/registros/${ids.remove}/borrar`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "¿Seguro que quieres borrar esta ficha?",
    );
    await expect(
      page.getByText(
        `Esto borra para siempre el registro de «${NAMES.remove}», sus giros y sus reportes. No hay papelera y no se puede deshacer.`,
      ),
    ).toBeVisible();
    await expect(page.getByText(/^Antes de borrar: confirma por WhatsApp/)).toBeVisible();
    await expectPhoneReady(page);

    // Opening, reloading and going back and forth deletes nothing.
    await page.reload();
    await page.goBack();
    await page.goForward();
    expect(await statusOf(ids.remove)).toBe("published");

    // Changing one's mind goes back to the detail, complete.
    await page.getByRole("link", { name: "Mejor no, regresar" }).click();
    await expect(page).toHaveURL(`/admin/registros/${ids.remove}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAMES.remove);

    // A word that is not BORRAR deletes nothing.
    await page.goto(`/admin/registros/${ids.remove}/borrar`);
    await page.getByLabel("Escribe BORRAR para confirmar").fill("borra");
    await page.getByRole("button", { name: "Sí, borrar para siempre" }).click();
    await expect(page.getByText("Para borrar, escribe BORRAR en el campo.")).toBeVisible();
    await expect(page.getByLabel("Escribe BORRAR para confirmar")).toHaveValue("");
    expect(await statusOf(ids.remove)).toBe("published");

    // Lowercase and spaces around it count.
    await page.getByLabel("Escribe BORRAR para confirmar").fill(" borrar ");
    await page.getByRole("button", { name: "Sí, borrar para siempre" }).click();
    await expect(page).toHaveURL("/admin/borrado");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ya se borró para siempre.");
    await expect(page.getByText(DELAY)).toBeVisible();
    await expect(page.getByRole("link", { name: "Volver a la cola" })).toHaveAttribute(
      "href",
      "/admin",
    );
    const screen = await page.content();
    for (const trace of [NAMES.remove, `${PHONES}003`, ids.remove, "Junto a la plaza"]) {
      expect(screen).not.toContain(trace);
      expect(page.url()).not.toContain(trace);
    }

    // Everything went: the rows, the photos of the card and of its edit, its card and its link.
    await withDatabase(async (db) => {
      expect(await db.select().from(businesses).where(eq(businesses.id, ids.remove))).toEqual([]);
      for (const table of [businessTrades, reports, pendingEdits]) {
        expect(await db.select().from(table).where(eq(table.businessId, ids.remove))).toEqual([]);
      }
    });
    expect(await auditOf(ids.remove)).toEqual([{ action: "delete", previousStatus: "published" }]);
    for (const key of Object.values(PHOTOS)) {
      for (const object of photoObjectKeys(key)) {
        expect((await page.request.get(`/_media/${object}`)).status(), object).toBe(404);
      }
    }
    expect(
      (
        await page.goto(`/hidalgo/tizayuca/negocio/por-borrar-del-panel-de-mentiras-${ids.remove}`)
      )?.status(),
    ).toBe(404);
    expect((await page.goto(`/hidalgo/tizayuca/editar/${tokens.remove ?? ""}`))?.status()).toBe(
      404,
    );

    // Deleting again: no server error, and it says the card no longer exists.
    await page.goto("/admin");
    const again = await page.request.post(
      `/admin/registros/${ids.remove}/borrar?_action=admin.deleteCard`,
      { form: { confirmacion: "BORRAR" }, headers: originOf(page) },
    );
    expect(again.status()).toBe(404);
    expect(await again.text()).toContain("Esta ficha ya no existe.");
    expect(await auditOf(ids.remove)).toHaveLength(1);
    // Its confirmation is the site's 404 now.
    expect((await page.goto(`/admin/registros/${ids.remove}/borrar`))?.status()).toBe(404);
  });

  test("an action posted from another page, or to /_actions/, does nothing", async ({ page }) => {
    await page.goto("/admin");
    for (const [path, status] of [
      ["/_actions/admin.unpublish", 404],
      ["/_actions/admin.newLink", 404],
      ["/_actions/admin.deleteCard", 404],
      ["/admin?_action=admin.deleteCard", 404],
      [`/admin/registros/${ids.untouched}?_action=admin.deleteCard`, 405],
      [`/admin/registros/${ids.untouched}/borrar?_action=admin.unpublish`, 405],
    ] as const) {
      const response = await page.request.post(path, {
        form: { motivo: "Desde otro lado", confirmacion: "BORRAR", enlace: "" },
        headers: originOf(page),
      });
      expect(response.status(), path).toBe(status);
      expect(await response.text(), path).not.toMatch(
        /\/editar\/|Ya la despublicaste|Ya se borró|enlace anterior ya no sirve/,
      );
    }
    expect(await statusOf(ids.untouched)).toBe("published");
    expect(await auditOf(ids.untouched)).toEqual([]);
  });

  test("a user who may not do them sees none of them, and each is refused", async ({ page }) => {
    await withDatabase(async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: REVIEW_ONLY, name: "Solo revisar de prueba", scope: "locality" })
        .returning({ id: roles.id });
      await db
        .insert(rolePermissions)
        .values({ roleId: role!.id, permissionKey: "businesses.review" });
      await setLocalAdminRoles(db, [{ role: REVIEW_ONLY, locality: TIZAYUCA }]);
    });
    try {
      await page.goto(`/admin/registros/${ids.untouched}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAMES.untouched);
      for (const testId of ["unpublish-form", "new-link-form", "delete-control"]) {
        await expect(page.getByTestId(testId)).toHaveCount(0);
      }
      expect((await page.goto(`/admin/registros/${ids.untouched}/borrar`))?.status()).toBe(403);
      for (const [path, form] of [
        [`/admin/registros/${ids.untouched}?_action=admin.unpublish`, { motivo: "Sin permiso" }],
        [`/admin/registros/${ids.untouched}?_action=admin.newLink`, { enlace: "" }],
        [
          `/admin/registros/${ids.untouched}/borrar?_action=admin.deleteCard`,
          { confirmacion: "BORRAR" },
        ],
      ] as const) {
        const response = await page.request.post(path, { form, headers: originOf(page) });
        expect(response.status(), path).toBe(403);
        expect(await response.text(), path).not.toContain(NAMES.untouched);
      }
      expect(await statusOf(ids.untouched)).toBe("published");
    } finally {
      await withDatabase(async (db) => {
        await ensureLocalSuperAdmin(db);
        await db.delete(roles).where(eq(roles.key, REVIEW_ONLY));
      });
    }
  });
});

test.describe("the actions of a card without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("unpublishing, a new link and deleting are plain form submissions", async ({ page }) => {
    await page.goto(`/admin/registros/${ids.unpublishNoJs}`);
    await page.getByLabel("¿Por qué la despublicas?").fill("Sin JavaScript (motivo de mentira)");
    await page.getByTestId("unpublish-form").getByRole("button", { name: "Despublicar" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ya la despublicaste.");
    expect(await statusOf(ids.unpublishNoJs)).toBe("in_review");

    await page.goto(`/admin/registros/${ids.relinkNoJs}`);
    await page.getByRole("button", { name: "Generar un enlace nuevo" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Listo, el enlace anterior ya no sirve.",
    );
    expect((await page.goto(`/hidalgo/tizayuca/editar/${tokens.relinkNoJs ?? ""}`))?.status()).toBe(
      404,
    );

    await page.goto(`/admin/registros/${ids.removeNoJs}`);
    await page.getByRole("link", { name: "Borrar definitivamente" }).click();
    await page.getByLabel("Escribe BORRAR para confirmar").fill("BORRAR");
    await page.getByRole("button", { name: "Sí, borrar para siempre" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ya se borró para siempre.");
    expect(await statusOf(ids.removeNoJs)).toBeUndefined();
    expect(await auditOf(ids.removeNoJs)).toEqual([
      { action: "delete", previousStatus: "in_review" },
    ]);
  });
});
