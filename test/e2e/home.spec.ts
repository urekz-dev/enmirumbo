// Scenarios of docs/specs/public-directory.md for the home of a locality, on
// the built site with the seeded directory of Tizayuca: "The home page shows
// the 8 categories as large buttons", "Highlighted "Deporte en Tizayuca" block
// on the home page", "Search box on the home page that works without
// client-side JavaScript", "The home of a locality lives under it and names
// it from the record (v2)", "Heading levels never skip (v2)" and "Directory
// in Server Components, mobile-first and usable without JavaScript"; and of
// docs/specs/base-layout.md, "Home of the site inside the layout, with the
// entry to registration". The home of another locality is tested in
// two-localities/localities-list.spec.ts and rendered in
// test/astro/locality-home.test.ts; the layout rules of every page (390px,
// metadata, brand) are checked by surfaces.spec.ts.
import type { Locator, Page } from "@playwright/test";
// The home leads to the registration form, whose Turnstile widget gets the local fake.
import { expect, test } from "./turnstile.ts";

const HOME = "/hidalgo/tizayuca";
/** The local SITE_URL of wrangler.jsonc, the base of the canonical URLs, whatever the port. */
const SITE_URL = "http://localhost:4321";

const CATEGORY_LINKS = [
  ["Restaurantes y fondas", `${HOME}/restaurantes-y-fondas`],
  ["Servicios del hogar", `${HOME}/servicios-del-hogar`],
  ["Belleza", `${HOME}/belleza`],
  ["Salud", `${HOME}/salud`],
  ["Abarrotes y comercio", `${HOME}/abarrotes-y-comercio`],
  ["Talleres", `${HOME}/talleres`],
  ["Clubes y escuelas deportivas", `${HOME}/clubes-y-escuelas-deportivas`],
  ["Otro", `${HOME}/otro`],
];

const SPORTS_LISTING = `${HOME}/clubes-y-escuelas-deportivas`;

/** The category buttons of the home. */
const categoryButtons = (page: Page) =>
  page.getByRole("main").getByRole("listitem").getByRole("link");

/** The category buttons, as [accessible name, href]: the decorative emoji is aria-hidden. */
async function categoryLinks(page: Page): Promise<string[][]> {
  return categoryButtons(page).evaluateAll((links) =>
    links.map((link) => [
      [...link.childNodes]
        .filter((node) => !(node instanceof Element && node.getAttribute("aria-hidden")))
        .map((node) => node.textContent ?? "")
        .join("")
        .trim(),
      link.getAttribute("href") ?? "",
    ]),
  );
}

async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  expect(found, String(locator)).not.toBeNull();
  return found ?? { x: 0, y: 0, width: 0, height: 0 };
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe("Home of the site inside the layout, with the entry to registration", () => {
  // Scenario: home inside the layout
  test("the home answers inside the layout, with its question and its phrase", async ({ page }) => {
    const response = await page.goto(HOME);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    const main = page.getByRole("main");
    // The municipality comes from the locality record.
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("¿Qué necesitas en Tizayuca?");
    await expect(
      main.getByText(
        "Encuentra negocios y servicios de aquí cerquita y contáctalos directo por WhatsApp.",
      ),
    ).toBeVisible();
    // Scenario: the home no longer announces that the directory is coming later
    await expect(page.getByText(/Muy pronto|Estamos armando/)).toHaveCount(0);
  });

  // Scenario: heading hierarchy; public-directory, "Heading levels never skip
  // (v2)": scenario "results and card pages"
  test("exactly one h1, and the sections are h2", async ({ page }) => {
    await page.goto(HOME);

    const headings = await page
      .locator("main :is(h1, h2, h3, h4, h5, h6)")
      .evaluateAll((all) => all.map((h) => `${h.tagName.toLowerCase()} ${h.textContent?.trim()}`));
    expect(headings).toEqual([
      "h1 ¿Qué necesitas en Tizayuca?",
      "h2 Busca por categoría",
      "h2 Deporte en Tizayuca",
      "h2 ¿Tienes un negocio en Tizayuca?",
    ]);
  });

  // Scenario: entry to registration from the home; business-registration,
  // "Public registration page on a single screen": scenario "the owner
  // reaches registration from the home page"
  test('"¿Tienes un negocio en Tizayuca?" and "Registra tu negocio gratis", in WhatsApp green, lead to the registration page', async ({
    page,
  }) => {
    await page.goto(HOME);
    const main = page.getByRole("main");
    const heading = main.getByRole("heading", {
      level: 2,
      name: "¿Tienes un negocio en Tizayuca?",
    });
    const entry = main.getByRole("link", { name: "Registra tu negocio gratis", exact: true });

    await expect(heading).toBeVisible();
    const [headingBox, entryBox] = [await box(heading), await box(entry)];
    expect(entryBox.y).toBeGreaterThan(headingBox.y);
    expect(entryBox.height).toBeGreaterThanOrEqual(44);
    // The primary action: WhatsApp green with ink text.
    expect(await entry.evaluate((link) => getComputedStyle(link).backgroundColor)).toBe(
      "rgb(37, 211, 102)",
    );
    await entry.click();
    await expect(page).toHaveURL(`${HOME}/registro`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registra tu negocio gratis");
  });

  // base-layout, "Server Component with a document in es-MX and base
  // metadata": scenario "the home keeps the site title"; public-directory,
  // "The results page is not indexable": scenario "the directory pages stay
  // indexable"
  test("the site's title and description, its own canonical, and indexable", async ({ page }) => {
    await page.goto(HOME);

    await expect(page).toHaveTitle("enmirumbo — Encuentra negocios y servicios en Tizayuca");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Encuentra negocios, servicios y deporte en Tizayuca y contáctalos directo por WhatsApp. Registro gratis para negocios locales.",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${SITE_URL}${HOME}`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });
});

test.describe("The home page shows the 8 categories as large buttons", () => {
  // Scenario: the eight categories visible
  test('under "Busca por categoría", the eight categories of the catalogue, in its order', async ({
    page,
  }) => {
    await page.goto(HOME);

    const heading = page.getByRole("heading", { level: 2, name: "Busca por categoría" });
    await expect(heading).toBeVisible();
    expect(await categoryLinks(page)).toEqual(CATEGORY_LINKS);
    const first = await box(categoryButtons(page).first());
    expect(first.y).toBeGreaterThan((await box(heading)).y);
  });

  // Scenario: tapping a category leads to its listing
  test('tapping "Servicios del hogar" leads to its listing', async ({ page }) => {
    await page.goto(HOME);
    await page.getByRole("link", { name: "Servicios del hogar", exact: true }).click();

    await expect(page).toHaveURL(`${HOME}/servicios-del-hogar`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Servicios del hogar en Tizayuca",
    );
  });

  // Scenarios: the grid collapses to a single column on very narrow screens;
  // two columns on a phone and three on a wide screen
  for (const [width, columns] of [
    [320, 1],
    [390, 2],
    [768, 3],
    [1280, 3],
  ] as const) {
    test(`at ${width}px the categories take ${columns} column(s), with every name whole`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(HOME);

      const buttons = await categoryButtons(page).all();
      expect(buttons).toHaveLength(8);
      const boxes = await Promise.all(buttons.map(box));
      expect(new Set(boxes.map(({ x }) => Math.round(x))).size).toBe(columns);
      // The buttons of a row share their height, and each is a large target.
      const rows = Map.groupBy(boxes, ({ y }) => Math.round(y));
      for (const row of rows.values()) {
        expect(new Set(row.map(({ height }) => Math.round(height))).size).toBe(1);
      }
      for (const { width: w, height } of boxes) {
        expect(Math.min(w, height)).toBeGreaterThanOrEqual(44);
      }
      // No name is clipped or forced onto one line.
      const clipped = await categoryButtons(page).evaluateAll((links) =>
        links
          .filter(
            (link) => link.scrollWidth > link.clientWidth || link.scrollHeight > link.clientHeight,
          )
          .map((link) => link.textContent?.trim()),
      );
      expect(clipped).toEqual([]);
      await noSidewaysScroll(page);
    });
  }

  // Scenario: the search box comes before the categories
  test("on a 390px phone the search box comes first, and both entry points show without scrolling", async ({
    page,
  }) => {
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(390);
    await page.goto(HOME);

    const field = await box(page.getByRole("searchbox", { name: "Busca lo que necesitas" }));
    const button = await box(page.getByRole("button", { name: "Buscar" }));
    const heading = await box(page.getByRole("heading", { level: 2, name: "Busca por categoría" }));
    const firstRow = await box(categoryButtons(page).first());
    expect(field.y + field.height).toBeLessThanOrEqual(heading.y);
    expect(button.y + button.height).toBeLessThanOrEqual(heading.y);
    // Both entry points are on the first screen: the box and the categories.
    expect(firstRow.y + firstRow.height).toBeLessThanOrEqual(viewport?.height ?? 0);
    for (const button of await categoryButtons(page).all()) await expect(button).toBeVisible();
    await noSidewaysScroll(page);
  });

  // Scenario: no dead controls on the home page
  test("every control of the home leads to a page that exists", async ({ page, request }) => {
    await page.goto(HOME);
    const main = page.getByRole("main");

    const hrefs = await main
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs).toEqual([
      ...CATEGORY_LINKS.map(([, href]) => href),
      SPORTS_LISTING,
      `${HOME}/registro`,
    ]);
    const forms = await main
      .locator("form")
      .evaluateAll((all) =>
        all.map((form) => [form.getAttribute("action"), form.getAttribute("method")]),
      );
    expect(forms).toEqual([[`${HOME}/buscar`, "get"]]);
    await expect(main.locator("input, select, textarea")).toHaveCount(1);
    await expect(main.getByRole("button")).toHaveCount(1);
    for (const href of [...hrefs, `${HOME}/buscar`]) {
      expect((await request.get(href, { maxRedirects: 0 })).status(), href).toBe(200);
    }
  });
});

test.describe('Highlighted "Deporte en Tizayuca" block on the home page', () => {
  // Scenario: the sports block is seen at the same level as the categories
  test("its heading has the weight of the categories', with its phrase and its entry", async ({
    page,
  }) => {
    await page.goto(HOME);
    const main = page.getByRole("main");

    const sports = main.getByRole("heading", {
      level: 2,
      name: "Deporte en Tizayuca",
      exact: true,
    });
    const categories = main.getByRole("heading", { level: 2, name: "Busca por categoría" });
    await expect(sports).toBeVisible();
    const style = (heading: Locator) =>
      heading.evaluate((element) => {
        const { fontSize, fontWeight } = getComputedStyle(element);
        return { fontSize, fontWeight };
      });
    expect(await style(sports)).toEqual(await style(categories));
    await expect(
      main.getByText(
        "Escuelas, clubes y entrenadores para que los niños (y los grandes) se muevan.",
      ),
    ).toBeVisible();
    const entry = main.getByRole("link", { name: "Ver clubes y escuelas deportivas" });
    await expect(entry).toBeVisible();
    const { width, height } = await box(entry);
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(44);
    // A secondary action: the action green fills nothing on the home.
    const green = await entry.evaluate((element) => {
      const { backgroundColor, color, borderTopColor } = getComputedStyle(element);
      return [backgroundColor, color, borderTopColor];
    });
    expect(green).not.toContain("rgb(37, 211, 102)");
  });

  // Scenario: the block leads to the sports listing
  test("its entry leads to the sports listing, the same as the category's button", async ({
    page,
  }) => {
    await page.goto(HOME);
    const button = page.getByRole("link", { name: "Clubes y escuelas deportivas", exact: true });
    await expect(button).toHaveAttribute("href", SPORTS_LISTING);

    await page.getByRole("link", { name: "Ver clubes y escuelas deportivas" }).click();

    await expect(page).toHaveURL(SPORTS_LISTING);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Clubes y escuelas deportivas en Tizayuca",
    );
  });
});

test.describe("Search box on the home page that works without client-side JavaScript", () => {
  // Scenarios: searching from the home page; the search box works without
  // JavaScript
  test("searching from the home leads to the results, with the query in the address, without JavaScript", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(HOME);

    await page.getByRole("searchbox", { name: "Busca lo que necesitas" }).fill("plomero");
    await page.getByRole("button", { name: "Buscar" }).click();

    await expect(page).toHaveURL(`${HOME}/buscar?q=plomero`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText('Resultados para "plomero"');
    await context.close();
  });

  // Scenario: labeled and tappable field
  test("the field is announced by its label, shows the example, and both controls measure 44px", async ({
    page,
  }) => {
    await page.goto(HOME);

    const field = page.getByRole("searchbox", { name: "Busca lo que necesitas" });
    await expect(field).toHaveAttribute("placeholder", "ej. plomero, tacos, futbol infantil");
    await expect(field).toHaveValue("");
    for (const control of [field, page.getByRole("button", { name: "Buscar" })]) {
      const { width, height } = await box(control);
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(44);
    }
  });

  // Scenario: the search box stacks on a phone
  test("on a 390px phone the field takes the whole width and the button goes whole below it", async ({
    page,
  }) => {
    await page.goto(HOME);

    const form = await box(page.getByRole("search"));
    const field = await box(page.getByRole("searchbox"));
    const button = await box(page.getByRole("button", { name: "Buscar" }));
    expect(Math.round(field.width)).toBe(Math.round(form.width));
    expect(Math.round(button.width)).toBe(Math.round(form.width));
    expect(button.y).toBeGreaterThanOrEqual(field.y + field.height);

    // With room for both, they share a row.
    await page.setViewportSize({ width: 768, height: 900 });
    const wideField = await box(page.getByRole("searchbox"));
    const wideButton = await box(page.getByRole("button", { name: "Buscar" }));
    expect(wideButton.x).toBeGreaterThanOrEqual(wideField.x + wideField.width);
    expect(Math.round(wideButton.y + wideButton.height)).toBe(
      Math.round(wideField.y + wideField.height),
    );
  });
});

test.describe("Directory in Server Components, mobile-first and usable without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  // Scenario: navigation without JavaScript (the journey from a category is
  // in listings.spec.ts)
  test("home → search → results → card → WhatsApp, with no JavaScript", async ({ page }) => {
    await page.goto(HOME);
    await page.getByRole("searchbox", { name: "Busca lo que necesitas" }).fill("cerrajería");
    await page.getByRole("button", { name: "Buscar" }).click();
    await page.getByRole("link", { name: "Cerrajería La Llave Inventada", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`${HOME}/negocio/cerrajeria-la-llave-inventada-\\w+$`));
    await expect(page.getByRole("link", { name: /^Enviar WhatsApp/ })).toHaveAttribute(
      "href",
      /^https:\/\/wa\.me\/52771999\d{4}\?text=/,
    );
  });
});
