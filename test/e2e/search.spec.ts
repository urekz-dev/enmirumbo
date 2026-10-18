// Scenarios of docs/specs/public-directory.md for the results page, on the
// built site with the seeded directory of Tizayuca: "Results page with the
// same cards as the listing", "With no results, the page offers the
// categories as an alternative", "The search covers name, keywords and
// trades, and only what is published", "Empty query and hostile terms
// bounded, without error", "The results page is not indexable", "The search
// endpoint has a per-IP quota (v2)", "Directory lists show 20 cards per page, with
// "Ver más" to the next (v2)" (the addresses that name no page) and "Directory in
// Server Components, mobile-first and usable without JavaScript". A list
// longer than a page is tested in search-pages/search-pagination.spec.ts, with
// fictitious businesses it adds; the states are rendered one by one in
// test/astro/search-page.test.ts; the layout rules of the results page (390px,
// metadata, brand) are checked by surfaces.spec.ts, which starts there too.
//
// Miniflare gives every request of this machine a loopback address, which
// the quota does not count, so these pages are never held back. The test of
// the quota sends the address Cloudflare would write, one from the IPv6
// range reserved for documentation, new on every run.
import { expect, test, type Page } from "@playwright/test";
import { cardPath } from "../../src/core/business/card-path.ts";
import { QUOTAS } from "../../src/core/quota/quotas.ts";
import { FAKE_BUSINESSES } from "../../src/core/db/seed/businesses.ts";

const SEARCH = "/hidalgo/tizayuca/buscar";
const TIZAYUCA = { slug: "tizayuca", state: { slug: "hidalgo" } };

/** The seeded card with every optional field but the photo. */
const PLUMBER = "Plomería Los Fontaneros Ficticios";

const CATEGORY_LINKS = [
  ["Restaurantes y fondas", "/hidalgo/tizayuca/restaurantes-y-fondas"],
  ["Servicios del hogar", "/hidalgo/tizayuca/servicios-del-hogar"],
  ["Belleza", "/hidalgo/tizayuca/belleza"],
  ["Salud", "/hidalgo/tizayuca/salud"],
  ["Abarrotes y comercio", "/hidalgo/tizayuca/abarrotes-y-comercio"],
  ["Talleres", "/hidalgo/tizayuca/talleres"],
  ["Clubes y escuelas deportivas", "/hidalgo/tizayuca/clubes-y-escuelas-deportivas"],
  ["Otro", "/hidalgo/tizayuca/otro"],
];

const search = (query: string) => `${SEARCH}?q=${encodeURIComponent(query)}`;

/** The names of the businesses listed, in order. */
const names = (page: Page) =>
  page.getByRole("main").getByRole("heading", { level: 2 }).allInnerTexts();

/** The category buttons of the page, as [name, href]. */
async function categoryLinks(page: Page): Promise<string[][]> {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => [
        // What is read: the decorative emoji is aria-hidden.
        [...link.childNodes]
          .filter((node) => !(node instanceof Element && node.getAttribute("aria-hidden")))
          .map((node) => node.textContent ?? "")
          .join("")
          .trim(),
        link.getAttribute("href") ?? "",
      ]),
    );
}

test.describe("Results page with the same cards as the listing", () => {
  // Scenario: results of a search
  test("a search shows its query as the only h1 and a listing card for each business found", async ({
    page,
  }) => {
    const response = await page.goto(search("plomero"));

    expect(response?.status()).toBe(200);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText('Resultados para "plomero"');
    await expect(page.locator("h1")).toHaveCount(1);
    expect(await names(page)).toEqual([PLUMBER]);
    const plumber = FAKE_BUSINESSES.find(({ name }) => name === PLUMBER)!;
    await expect(main.getByRole("link", { name: PLUMBER, exact: true })).toHaveAttribute(
      "href",
      cardPath(TIZAYUCA, plumber),
    );
    const whatsapp = main.getByRole("link", { name: `Enviar WhatsApp a ${PLUMBER}` });
    await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/52771999\d{4}\?text=/);
    await expect(whatsapp).toHaveAttribute("target", "_blank");
    // Only one page of results: nothing more to see.
    await expect(main.getByRole("link", { name: "Ver más" })).toHaveCount(0);
  });

  // Scenario: correcting the search without going back
  test("the search box at the top keeps the query, and searching again works without JavaScript", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(search("plomero"));

    const field = page.getByRole("searchbox", { name: "Busca lo que necesitas" });
    await expect(field).toHaveValue("plomero");
    await expect(field).toHaveAttribute("placeholder", "ej. plomero, tacos, futbol infantil");
    await field.fill("cerrajería");
    await page.getByRole("button", { name: "Buscar" }).click();

    await expect(page).toHaveURL(/\/hidalgo\/tizayuca\/buscar\?q=cerrajer%C3%ADa$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      'Resultados para "cerrajería"',
    );
    expect(await names(page)).toEqual(["Cerrajería La Llave Inventada"]);
    await context.close();
  });

  // Scenario: deterministic order
  test("the order is the listing's and is the same every time", async ({ page }) => {
    await page.goto(search("mentiras"));
    const first = await names(page);
    await page.goto(search("mentiras"));

    expect(first.length).toBeGreaterThan(2);
    expect(await names(page)).toEqual(first);
  });

  // Scenario: the query is shown as text
  test("a query that looks like markup is shown as text", async ({ page }) => {
    await page.goto(search("<b>plomero</b>"));

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      'Resultados para "<b>plomero</b>"',
    );
    await expect(page.locator("main b")).toHaveCount(0);
    expect(await names(page)).toEqual([PLUMBER]);
  });
});

test.describe("A zone whose name repeats in its locality is shown with its settlement type (v2)", () => {
  // The seeded mechanic is in the zone "Tizayuca" of type "Zona industrial",
  // named like its municipality.
  test("a search result shows its zone's display name, as the listings do", async ({ page }) => {
    await page.goto(search("tornillo"));

    await expect(page.locator("main")).toContainText("Tizayuca (Zona industrial)");
  });
});

test.describe("The search covers name, keywords and trades, and only what is published", () => {
  test("by name and by what it offers, accents and capitals aside", async ({ page }) => {
    await page.goto(search("CERRAJERIA"));
    expect(await names(page)).toEqual(["Cerrajería La Llave Inventada"]);
    await page.goto(search("garrafones"));
    expect(await names(page)).toEqual(["Abarrotes La Esperanza Inventada"]);
  });

  // Scenario: unpublished businesses never appear
  test("a business in review or rejected is not found, and nothing of it is in the page", async ({
    page,
  }) => {
    // A word of what each one offers, or of its name, that no published card has.
    for (const [status, word] of [
      ["in_review", "barba"],
      ["rejected", "fantasma"],
    ] as const) {
      const hidden = FAKE_BUSINESSES.find((business) => business.status === status)!;
      await page.goto(search(word));
      await expect(page.getByText(`No encontramos negocios para "${word}".`)).toBeVisible();
      const html = await page.content();
      expect(html, hidden.name).not.toContain(hidden.name);
      expect(html).not.toContain(hidden.id);
      expect(html).not.toContain(hidden.whatsapp);
    }
  });
});

test.describe("With no results, the page offers the categories as an alternative", () => {
  // Scenarios: search without matches; a search with no results is not an error
  test("it says so, offers the eight categories and keeps the search box", async ({ page }) => {
    const response = await page.goto(search("veterinario espacial"));

    expect(response?.status()).toBe(200);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      'Resultados para "veterinario espacial"',
    );
    await expect(
      main.getByText('No encontramos negocios para "veterinario espacial".'),
    ).toBeVisible();
    await expect(main.getByText("Prueba con otra palabra o elige una categoría:")).toBeVisible();
    expect(await categoryLinks(page)).toEqual(CATEGORY_LINKS);
    await expect(main.getByRole("searchbox")).toHaveValue("veterinario espacial");
    // Measurement is off locally: no script, so no tag.
    await expect(page.locator("script[data-tag]")).toHaveCount(0);
  });

  // Scenario: query of only filler words
  test("a query of only filler words finds nothing instead of asking what to look for", async ({
    page,
  }) => {
    await page.goto(search("quien me"));

    await expect(page.getByRole("heading", { level: 1 })).toHaveText('Resultados para "quien me"');
    await expect(page.getByText('No encontramos negocios para "quien me".')).toBeVisible();
  });
});

test.describe("Empty query and hostile terms bounded, without error", () => {
  // Scenarios: empty or only-spaces query; characters that would be wildcards
  // in a search; odd alphabets and symbols
  for (const address of [
    SEARCH,
    `${SEARCH}?q=`,
    search("     "),
    search("%"),
    search("_"),
    search("🎉🎈"),
    search("Привет"),
  ]) {
    test(`${address} asks what to look for, with the categories and no business`, async ({
      page,
    }) => {
      const response = await page.goto(address);

      expect(response?.status()).toBe(200);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1 })).toHaveText("¿Qué estás buscando?");
      // The municipality of the notice comes from the locality record.
      await expect(
        main.getByText("Escribe qué necesitas y te decimos quién lo hace en Tizayuca."),
      ).toBeVisible();
      await expect(main.getByRole("searchbox")).toHaveValue("");
      expect(await categoryLinks(page)).toEqual(CATEGORY_LINKS);
      await expect(main.getByRole("heading", { level: 2 })).toHaveCount(0);
    });
  }

  // Scenario: extremely long query
  test("a query of thousands of characters answers normally, without repeating it", async ({
    page,
  }) => {
    const response = await page.goto(search(`plomero ${"x".repeat(3_000)}`));

    expect(response?.status()).toBe(200);
    const heading = await page.getByRole("heading", { level: 1 }).innerText();
    expect(heading.length).toBeLessThan(120);
    expect(heading).toMatch(/^Resultados para "plomero x+…"$/);
  });

  // Scenario: repeated query in the URL
  test("with the query twice in the address, the first one is used", async ({ page }) => {
    await page.goto(`${SEARCH}?q=plomero&q=cerrajeria`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText('Resultados para "plomero"');
    expect(await names(page)).toEqual([PLUMBER]);
  });
});

test.describe('Directory lists show 20 cards per page, with "Ver más" to the next (v2)', () => {
  // Page 1 is the address without `pagina`; a page that does not exist is no
  // page: the empty query and a search with fewer results have only page 1.
  for (const address of [
    `${search("plomero")}&pagina=1`,
    `${search("plomero")}&pagina=01`,
    `${search("plomero")}&pagina=0`,
    `${search("plomero")}&pagina=-1`,
    `${search("plomero")}&pagina=2.5`,
    `${search("plomero")}&pagina=abc`,
    `${search("plomero")}&pagina=2`,
    `${search("veterinario espacial")}&pagina=2`,
    `${SEARCH}?pagina=2`,
  ]) {
    test(`${address} answers the site's 404`, async ({ page }) => {
      const response = await page.goto(address);

      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "No encontramos esta página",
      );
    });
  }
});

test.describe("The results page is not indexable", () => {
  // Scenario: results page metadata
  test("it asks not to be indexed, follows its links and declares no canonical", async ({
    page,
  }) => {
    for (const address of [search("plomero"), search("veterinario espacial"), SEARCH]) {
      await page.goto(address);
      await expect(page.locator('meta[name="robots"]'), address).toHaveAttribute(
        "content",
        "noindex, follow",
      );
      await expect(page.locator('link[rel="canonical"]'), address).toHaveCount(0);
      // base-layout, "The measurement carries no personal data or text typed by
      // people": a static title, without the query.
      await expect(page, address).toHaveTitle("Buscar en Tizayuca — enmirumbo");
    }
  });

  // Scenario: the directory pages stay indexable
  test("a card stays indexable", async ({ page }) => {
    const plumber = FAKE_BUSINESSES.find(({ name }) => name === PLUMBER)!;
    await page.goto(cardPath(TIZAYUCA, plumber));

    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });
});

test.describe("The search endpoint has a per-IP quota (v2)", () => {
  // Scenarios: within the quota; over the quota; the 101st search
  test("past its quota an address sees the message and no results; another address searches", async ({
    request,
    browser,
  }) => {
    const hex = () => Math.floor(Math.random() * 0x10000).toString(16);
    const address = `2001:db8:${hex()}:${hex()}::1`;
    const from = (ip: string) => ({ headers: { "CF-Connecting-IP": ip } });

    for (let n = 0; n < QUOTAS.search.limit; n++) {
      const response = await request.get(search("plomero"), from(address));
      expect(response.status(), `search ${n + 1}`).toBe(200);
    }
    // Another address of the same /64 is the same visitor.
    const over = await request.get(search("plomero"), from(address.replace(/1$/, "2")));
    expect(over.status()).toBe(429);
    expect(over.headers()["cache-control"]).toBe("no-store");
    expect(Number(over.headers()["retry-after"])).toBeGreaterThan(0);
    const html = await over.text();
    expect(html).toContain(
      "Recibimos muchas búsquedas desde aquí. Espera un rato y vuelve a intentar.",
    );
    expect(html).not.toContain(PLUMBER);
    // The empty query runs no search, so it is not held back.
    expect((await request.get(SEARCH, from(address))).status()).toBe(200);

    // What the visitor sees: no error page, the search box and the categories.
    const context = await browser.newContext({ extraHTTPHeaders: { "CF-Connecting-IP": address } });
    const page = await context.newPage();
    await page.goto(search("plomero"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText('Resultados para "plomero"');
    await expect(
      page.getByText("Recibimos muchas búsquedas desde aquí. Espera un rato y vuelve a intentar."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
    expect(await categoryLinks(page)).toEqual(CATEGORY_LINKS);
    await context.close();

    // Scenario: independent counters. Another address, and the other pages of
    // the same address, are not affected.
    const other = await request.get(search("plomero"), from(`2001:db8:${hex()}:${hex()}::1`));
    expect(other.status()).toBe(200);
    const card = FAKE_BUSINESSES.find(({ name }) => name === PLUMBER)!;
    expect((await request.get(cardPath(TIZAYUCA, card), from(address))).status()).toBe(200);
  });
});
