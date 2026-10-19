// F6 through the local Access identity, including a JavaScript-free save.
// Runs alone after the other panel suites because it publishes fixture cards.
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { newBusinessId } from "../../src/core/business/id.ts";
import {
  adminAuditLog,
  businesses,
  categories,
  pendingEdits,
  rolePermissions,
  roles,
  zones,
} from "../../src/core/db/schema/index.ts";
import { withDatabase } from "./database.ts";
import { ensureLocalSuperAdmin, setLocalAdminRoles } from "./local-admin.ts";

const ids = [newBusinessId(), newBusinessId()];
const EDIT_ROLE = "e2e_rectification_edit_only";
const DELAY = "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.";
async function cleanup() {
  await withDatabase(async (db) => {
    await ensureLocalSuperAdmin(db);
    await db.delete(roles).where(eq(roles.key, EDIT_ROLE));
    await db.delete(adminAuditLog).where(inArray(adminAuditLog.businessId, ids));
    await db.delete(businesses).where(inArray(businesses.id, ids));
  });
}
test.beforeAll(async () => {
  await cleanup();
  await withDatabase(async (db) => {
    const [category] = await db.select().from(categories).where(eq(categories.slug, "salud"));
    const [zone] = await db.select().from(zones).where(eq(zones.slug, "huicalco"));
    for (const [n, id] of ids.entries()) {
      await db.insert(businesses).values({
        id,
        localityCode: "13069",
        name: `Ficha Rectificable ${n} de Mentira`,
        whatsapp: `771999490${n}`,
        categoryId: category!.id,
        zoneId: zone!.id,
        postalCode: zone!.postalCode!,
        status: "published",
        publishedAt: new Date(),
        consentedToNoticeAt: new Date("2026-10-18T18:00:00Z"),
        consentedToNoticeVersion: "2",
        facebookUrl: "https://example.test/anterior",
      });
    }
    await db.insert(pendingEdits).values({
      businessId: ids[0]!,
      localityCode: "13069",
      name: "Cambios esperando de Mentira",
      whatsapp: "7719994900",
      categoryId: category!.id,
      zoneId: zone!.id,
      homeDelivery: false,
    });
  });
});
test.afterAll(cleanup);

test("corrects a published card directly and offers its data copy in WhatsApp", async ({
  page,
  context,
}) => {
  const detail = `/admin/registros/${ids[0]}`;
  await page.goto(detail);
  await page.getByRole("link", { name: "Editar ficha", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${detail}/editar$`));
  await expect(
    page.getByText(
      "Este negocio tiene cambios esperando revisión; si los aplicas después, reemplazan lo que cambies aquí.",
    ),
  ).toBeVisible();
  await expect(page.locator('[name="name"]')).toHaveValue("Ficha Rectificable 0 de Mentira");
  await expect(page.locator('[name="consent"], [name="website"], .cf-turnstile')).toHaveCount(0);
  await expect(page.locator('option[value="_otra"], [name="zoneOther"]')).toHaveCount(0);
  const zone = page.getByLabel("¿En qué colonia estás?");
  await zone.selectOption("");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Elige la colonia de este negocio" }),
  ).toBeVisible();
  await zone.selectOption("huicalco");
  await page
    .getByLabel("Dirección o referencias (opcional)")
    .fill("Dirección corregida de mentira");
  await page.getByLabel("Link de tu Facebook (opcional)").fill("");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page).toHaveURL(new RegExp(`${detail}/editado$`));
  await expect(page.getByText(DELAY)).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "Volver al detalle" }).click();
  const copy = page.getByRole("link", { name: "Mandar copia de sus datos por WhatsApp" });
  const href = (await copy.getAttribute("href"))!;
  const url = new URL(href);
  expect(url.pathname).toBe("/527719994900");
  const text = url.searchParams.get("text")!;
  expect(text).toContain("Dirección o referencias: Dirección corregida de mentira");
  expect(text).toContain("Link de Facebook: No capturado");
  expect(text).toContain("Aviso de privacidad aceptado: 18 de octubre de 2026, 12:00; versión 2");
  expect(text).toContain("Foto guardada: No");
  expect(text).not.toContain("Cambios esperando");
  await context.route("https://wa.me/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>WhatsApp de prueba</p>" }),
  );
  const popupEvent = page.waitForEvent("popup");
  await copy.click();
  const popup = await popupEvent;
  await expect(popup).toHaveURL(href);
  await popup.close();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/hidalgo/tizayuca/negocio/${ids[0]}`);
        return await response.text();
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toContain("Dirección corregida de mentira");
  await withDatabase(async (db) => {
    const entries = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.businessId, ids[0]!));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "edit_contact",
      actor: "admin@enmirumbo.test",
      previousStatus: "published",
    });
    const edits = await db.select().from(pendingEdits).where(eq(pendingEdits.businessId, ids[0]!));
    expect(edits).toHaveLength(1);
    expect(edits[0]?.status).toBe("pending");
  });
});

test("validates and saves without JavaScript and refuses calls from another page or the endpoint", async ({
  browser,
  request,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: baseURL!,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const path = `/admin/registros/${ids[1]}/editar`;
  await page.goto(path);
  await page.getByLabel("¿Cómo se llama tu negocio?").fill("");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Escribe el nombre de tu negocio" }),
  ).toBeVisible();
  await page.getByLabel("¿Cómo se llama tu negocio?").fill("Ficha Corregida Sin JS de Mentira");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("heading", { name: "Cambios guardados." })).toBeVisible();
  await context.close();
  const wrongPage = await request.post(`/admin/registros/${ids[1]}?_action=admin.rectify`, {
    form: {},
  });
  // The action refuses it as not found; this detail's method guard answers 405.
  expect(wrongPage.status()).toBe(405);
  const queue = await request.post("/admin?_action=admin.rectify", { form: {} });
  expect(queue.status()).toBe(404);
  const endpoint = await request.post("/_actions/admin.rectify", { form: {} });
  // The local Access identity works here; route authorization still refuses it.
  expect(endpoint.status()).toBe(404);
});

test("an edit-only user reaches a card editor from the panel home", async ({ page }) => {
  try {
    await withDatabase(async (db) => {
      const [role] = await db
        .insert(roles)
        .values({
          key: EDIT_ROLE,
          name: "Rectificación de mentira",
          scope: "locality",
        })
        .returning();
      await db.insert(rolePermissions).values({
        roleId: role!.id,
        permissionKey: "businesses.edit",
      });
      await setLocalAdminRoles(db, [{ role: EDIT_ROLE, locality: "13069" }]);
    });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Panel de enmirumbo");
    await page.getByRole("link", { name: "Todos los negocios", exact: true }).click();
    await page
      .getByRole("link", { name: "Ver detalle: Ficha Rectificable 0 de Mentira", exact: true })
      .click();
    await page.getByRole("link", { name: "Editar ficha", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/registros/${ids[0]}/editar$`));
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeVisible();
  } finally {
    await withDatabase(async (db) => {
      await ensureLocalSuperAdmin(db);
      await db.delete(roles).where(eq(roles.key, EDIT_ROLE));
    });
  }
});
