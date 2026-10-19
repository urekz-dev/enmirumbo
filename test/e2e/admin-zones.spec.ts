// The zones screen of the panel on the built site, through the Access check
// (docs/specs/admin-review.md): "The admin can hide and rename the zones of a
// locality (v2)", "The admin can add a zone to a locality (v2)", "The panel
// says that a change takes up to a minute to reach the site (v2)", "Inside
// the panel, a user can do only what their roles allow (v2)" and "The panel
// is operated from the phone and without unnecessary client JavaScript".
//
// `astro preview` runs with the local vars of wrangler.jsonc on localhost, so
// every request carries the fixed local identity, which the global setup made
// a super admin (./local-admin.ts). Every test runs without client
// JavaScript. This file changes three zones of Tizayuca (Nacozari, Huicalco
// and Ampliación el Carmen), adds one, "Los Pinos de Mentiras", and narrows
// the roles of the local identity for a while; it gives everything back
// before and after. It runs alone, in its own project of playwright.config.ts
// ("phone, admin zones"), because the registration form, the trade pages and
// the crawls would see its changes.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { rolePermissions, roles, zones } from "../../src/core/db/schema/index.ts";
import { withDatabase } from "./database.ts";
import { ensureLocalSuperAdmin, setLocalAdminRoles } from "./local-admin.ts";

const TIZAYUCA = "13069";
const SCREEN = "/admin/colonias";
const FORM = "/hidalgo/tizayuca/registro";
const DELAY = "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.";
/** The zones this file changes, as the migrations leave them. */
const TOUCHED = {
  nacozari: "Nacozari",
  huicalco: "Huicalco",
  "ampliacion-el-carmen": "Ampliación el Carmen",
} as const;
const ADDED = { name: "Los Pinos de Mentiras", slug: "los-pinos-de-mentiras" } as const;
/** A role of this file, which reviews registrations and manages no zone. */
const NO_ZONES = "e2e_no_zones";

async function restore(): Promise<void> {
  await withDatabase(async (db) => {
    for (const [slug, name] of Object.entries(TOUCHED)) {
      await db
        .update(zones)
        .set({ name, visible: true })
        .where(and(eq(zones.localityCode, TIZAYUCA), eq(zones.slug, slug)));
    }
    await db
      .delete(zones)
      .where(and(eq(zones.localityCode, TIZAYUCA), inArray(zones.slug, [ADDED.slug, "registro"])));
    await ensureLocalSuperAdmin(db);
    await db.delete(roles).where(eq(roles.key, NO_ZONES));
  });
}

test.beforeAll(restore);
test.afterAll(restore);
test.use({ javaScriptEnabled: false });

/** The row of the zone shown as `name`. */
const rowOf = (page: Page, name: string): Locator =>
  page
    .getByTestId("zones")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

/** The zones the registration form of Tizayuca suggests. */
async function suggestions(page: Page): Promise<string[]> {
  const html = await (await page.request.get(FORM)).text();
  const list = /<datalist\b[^>]*>([\s\S]*?)<\/datalist>/.exec(html)?.[1] ?? "";
  return [...list.matchAll(/<option value="([^"]*)"/g)].map(([, value = ""]) =>
    value.replace(/&amp;/g, "&"),
  );
}

/** No sideways scroll at 390px, and every visible control of the page measures 44px. */
async function expectPhoneReady(page: Page): Promise<void> {
  expect(page.viewportSize()?.width).toBe(390);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const sizes = await page
    .getByRole("main")
    .locator("a, button, input:not([type=hidden]), select, summary")
    .evaluateAll((controls) =>
      controls
        .map((control) => {
          const box = control.getBoundingClientRect();
          return { text: control.textContent?.trim() ?? "", width: box.width, height: box.height };
        })
        // What a closed disclosure holds is not on the page yet.
        .filter(({ width, height }) => width > 0 || height > 0),
    );
  expect(sizes.length).toBeGreaterThan(200);
  expect(sizes.filter(({ width, height }) => Math.min(width, height) < 44)).toEqual([]);
}

test.describe("the zones screen", () => {
  test("the queue leads to it, and it lists the 105 zones of Tizayuca with no locality filter", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: "Administrar colonias" }).click();

    await expect(page).toHaveURL(SCREEN);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Colonias de Tizayuca");
    await expect(page.getByTestId("zones-count")).toHaveText("105 colonias");
    await expect(page.getByTestId("zones").getByRole("listitem")).toHaveCount(105);
    await expect(page.getByText("Filtrar por municipio")).toHaveCount(0);
    await expect(rowOf(page, "El Carmen (Fraccionamiento)")).toContainText(
      "En la URL: fraccionamiento-el-carmen",
    );
    await expect(page.locator("script")).toHaveCount(0);
    await expectPhoneReady(page);
  });

  test("not indexed and not cached, like the rest of the panel", async ({ page }) => {
    const response = await page.goto(SCREEN);

    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response?.headers()["cache-control"]).toBe("no-store");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    // Only its forms write, by POST: any other method gets a 405 with no body.
    const put = await page.request.put(SCREEN);
    expect(put.status()).toBe(405);
    expect(put.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(await put.text()).toBe("");
  });
});

test.describe("The admin can hide and rename the zones of a locality (v2)", () => {
  // Scenario: hide
  test("a hidden zone is no longer offered in the registration form, and Mostrar offers it again", async ({
    page,
  }) => {
    expect(await suggestions(page)).toContain("Nacozari");
    await page.goto(SCREEN);
    await page.getByRole("button", { name: "Ocultar: Nacozari", exact: true }).click();

    await expect(page).toHaveURL(/\/admin\/colonias\?localidad=13069&listo=\d+#colonia-\d+$/);
    const row = rowOf(page, "Nacozari");
    await expect(row.getByText("Oculta", { exact: true })).toBeVisible();
    await expect(row.getByRole("status")).toHaveText(`✓ ${DELAY}`);
    await expect(page.getByRole("status")).toHaveCount(1);
    await expect(page.getByTestId("zones-count")).toHaveText("105 colonias, 1 oculta");
    expect(await suggestions(page)).not.toContain("Nacozari");
    // A reload shows the page again, and sends nothing.
    await page.reload();
    await expect(row.getByText("Oculta", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Mostrar: Nacozari", exact: true }).click();
    await expect(rowOf(page, "Nacozari").getByText("Oculta", { exact: true })).toHaveCount(0);
    await expect(rowOf(page, "Nacozari").getByRole("status")).toHaveText(`✓ ${DELAY}`);
    expect(await suggestions(page)).toContain("Nacozari");
  });

  // Scenario: rename
  test("a renamed zone shows its new name everywhere, and its URLs do not change", async ({
    page,
  }) => {
    await page.goto(SCREEN);
    const row = rowOf(page, "Huicalco");
    await row.getByText("Cambiarle el nombre").click();
    await row.getByLabel("Nombre nuevo").fill("Huicalco Viejo");
    await row.getByRole("button", { name: "Guardar el nombre" }).click();

    await expect(page).toHaveURL(/listo=\d+#colonia-\d+$/);
    const renamed = rowOf(page, "Huicalco Viejo");
    await expect(renamed).toContainText("En la URL: huicalco");
    await expect(renamed.getByRole("status")).toHaveText(`✓ ${DELAY}`);
    expect(await suggestions(page)).toContain("Huicalco Viejo");
    expect(await suggestions(page)).not.toContain("Huicalco");
    // The trade and zone page answers at the same URL, with the new name.
    const response = await page.goto("/hidalgo/tizayuca/plomeria-huicalco");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Huicalco Viejo");
  });

  test("a rename that two zones would show the same way comes back with the error and what was typed", async ({
    page,
  }) => {
    await page.goto(SCREEN);
    const row = rowOf(page, "Ampliación el Carmen");
    await row.getByText("Cambiarle el nombre").click();
    await row.getByLabel("Nombre nuevo").fill("El Carmen");
    const response = page.waitForResponse((r) => r.request().method() === "POST");
    await row.getByRole("button", { name: "Guardar el nombre" }).click();

    expect((await response).status()).toBe(400);
    const again = rowOf(page, "Ampliación el Carmen");
    await expect(again.getByLabel("Nombre nuevo")).toBeVisible();
    await expect(again.getByLabel("Nombre nuevo")).toHaveValue("El Carmen");
    await expect(again.getByRole("alert")).toHaveText(
      "⚠ Ya hay otra colonia que se vería igual: «El Carmen (Colonia)». Ponle un nombre distinto.",
    );
  });
});

test.describe("The admin can add a zone to a locality (v2)", () => {
  test("a new zone gets its URL from its name, is offered in the registration form and keeps its URL", async ({
    page,
  }) => {
    await page.goto(SCREEN);
    await page.getByLabel("Nombre", { exact: true }).fill(ADDED.name);
    await page.getByLabel("Tipo", { exact: true }).selectOption("Fraccionamiento");
    await page.getByRole("button", { name: "Agregar colonia" }).click();

    await expect(page).toHaveURL(/listo=\d+#colonia-\d+$/);
    const row = rowOf(page, ADDED.name);
    await expect(row).toContainText("Tipo: Fraccionamiento");
    await expect(row).toContainText(`En la URL: ${ADDED.slug}`);
    await expect(row.getByRole("status")).toHaveText(`✓ ${DELAY}`);
    await expect(page.getByTestId("zones-count")).toHaveText("106 colonias");
    expect(await suggestions(page)).toContain(ADDED.name);
    expect((await page.request.get(`/hidalgo/tizayuca/plomeria-${ADDED.slug}`)).status()).toBe(200);

    // The same name again takes a URL that is already taken.
    await page.getByLabel("Nombre", { exact: true }).fill(ADDED.name);
    await page.getByLabel("Tipo", { exact: true }).selectOption("Colonia");
    await page.getByRole("button", { name: "Agregar colonia" }).click();
    await expect(page.locator("#add-zone-name-error")).toHaveText(
      `⚠ Ya hay una colonia con esa misma URL (${ADDED.slug}): «${ADDED.name}». Si es la misma, búscala en la lista para mostrarla o cambiarle el nombre; si es otra, ponle un nombre distinto.`,
    );

    // Renamed, it keeps the URL it was given.
    const added = rowOf(page, ADDED.name);
    await added.getByText("Cambiarle el nombre").click();
    await added.getByLabel("Nombre nuevo").fill("Los Pinos de Mentiras II");
    await added.getByRole("button", { name: "Guardar el nombre" }).click();
    await expect(rowOf(page, "Los Pinos de Mentiras II")).toContainText(`En la URL: ${ADDED.slug}`);
  });

  test("a name that takes a page of the site, or a form without name and type, comes back with its errors", async ({
    page,
  }) => {
    await page.goto(SCREEN);
    await page.getByLabel("Nombre", { exact: true }).fill("Registro");
    await page.getByLabel("Tipo", { exact: true }).selectOption("Colonia");
    const refused = page.waitForResponse((r) => r.request().method() === "POST");
    await page.getByRole("button", { name: "Agregar colonia" }).click();

    expect((await refused).status()).toBe(400);
    await expect(page.locator("#add-zone-name-error")).toHaveText(
      "⚠ Con ese nombre, la URL «registro» se confundiría con una página propia del sitio. Ponle otro nombre; por ejemplo, con su tipo adelante: «Colonia Registro».",
    );
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Registro");
    await expect(page.getByLabel("Tipo", { exact: true })).toHaveValue("Colonia");

    await page.getByLabel("Nombre", { exact: true }).fill("");
    await page.getByLabel("Tipo", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Agregar colonia" }).click();
    await expect(page.locator("#add-zone-name-error")).toHaveText(
      "⚠ Escribe el nombre de la colonia.",
    );
    await expect(page.locator("#add-zone-type-error")).toHaveText("⚠ Elige el tipo de la colonia.");
    await expect(rowOf(page, "Registro")).toHaveCount(0);
  });
});

test.describe("each user changes only the zones their roles allow", () => {
  test.afterEach(async () => {
    await withDatabase(async (db) => {
      await ensureLocalSuperAdmin(db);
      await db.delete(roles).where(eq(roles.key, NO_ZONES));
    });
  });

  test("a locality admin of Tizayuca manages its zones", async ({ page }) => {
    await withDatabase((db) =>
      setLocalAdminRoles(db, [{ role: "locality_admin", locality: TIZAYUCA }]),
    );

    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "Administrar colonias" })).toHaveAttribute(
      "href",
      SCREEN,
    );
    expect((await page.goto(SCREEN))?.status()).toBe(200);
  });

  test("a role without zones.manage does not see the entry, and the screen answers 403", async ({
    page,
    baseURL,
  }) => {
    await withDatabase(async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: NO_ZONES, name: "Sin colonias de prueba", scope: "locality" })
        .returning({ id: roles.id });
      await db
        .insert(rolePermissions)
        .values({ roleId: role!.id, permissionKey: "businesses.review" });
      await setLocalAdminRoles(db, [{ role: NO_ZONES, locality: TIZAYUCA }]);
    });

    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registros por revisar");
    await expect(page.getByRole("link", { name: "Administrar colonias" })).toHaveCount(0);
    const response = await page.goto(SCREEN);
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "No tienes acceso a esta página",
    );

    // Nor can it post to the screen.
    const posted = await page.request.post(
      `${SCREEN}?localidad=${TIZAYUCA}&_action=admin.addZone`,
      {
        form: { name: "Registro", type: "Colonia" },
        headers: { Origin: new URL(baseURL ?? "http://localhost:4321").origin },
      },
    );
    expect(posted.status()).toBe(403);
  });

  test("an action called from anywhere but the screen of a locality of the user is not found", async ({
    page,
    baseURL,
  }) => {
    const headers = { Origin: new URL(baseURL ?? "http://localhost:4321").origin };
    const form = { name: "Registro", type: "Colonia" };

    const direct = await page.request.post("/_actions/admin.addZone", { form, headers });
    expect(direct.status()).toBe(404);
    const elsewhere = await page.request.post("/admin/negocios?_action=admin.addZone", {
      form,
      headers,
    });
    expect(elsewhere.status()).toBe(405);
    const noLocality = await page.request.post(`${SCREEN}?localidad=79999&_action=admin.addZone`, {
      form,
      headers,
    });
    expect(noLocality.status()).toBe(404);
    const hidden = await page.request.post(
      `${SCREEN}?localidad=${TIZAYUCA}&_action=admin.setZoneVisibility`,
      { form: { zone: "2000000000", visible: "false" }, headers },
    );
    expect(hidden.status()).toBe(404);

    await page.goto(SCREEN);
    await expect(rowOf(page, "Registro")).toHaveCount(0);
    await expect(page.getByText("Oculta", { exact: true })).toHaveCount(0);
  });
});
