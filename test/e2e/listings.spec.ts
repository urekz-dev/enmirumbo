// Scenarios of docs/specs/public-directory.md on the built site, with the
// fictitious businesses of the seed in Tizayuca (src/core/db/seed/
// businesses.ts): "Category listing at a clean URL with the catalogue slug",
// "Only what is published is shown", "Zone filter in the listing, without
// client-side JavaScript", "The listing card brings the essentials and
// WhatsApp without extra taps", "Indexable trade page at the root, generated
// from the closed catalogue", "Indexable trade and zone page", "Trade pages
// without published businesses are neither indexed nor linked, but are not
// 404 either", "From the card the pages of its trades are reached", "Own
// title and description on each directory page, with its canonical",
// "Directory in Server Components, mobile-first and usable without
// JavaScript", "Public URLs carry the state and the municipality (v2)",
// "Heading levels never skip (v2)", "Directory lists show 20 cards per page,
// with "Ver más" to the next (v2)" and "A zone whose name repeats in its
// locality is shown with its settlement type (v2)"; and
// docs/specs/base-layout.md, "The sitemap lists the pages that exist, from
// the database (v2)". The empty states invite to register (EMR-39). A listing
// longer than a page is tested in many-cards/pagination.spec.ts, which runs
// alone. The 390px layout of every listing the sitemap names is checked by
// surfaces.spec.ts.
import type { Page } from "@playwright/test";
// The empty listings lead to the registration form, whose Turnstile widget gets the local fake.
import { expect, test } from "./turnstile.ts";

const HOME = "/hidalgo/tizayuca";
const SITE_URL = "http://localhost:4321";

/** The names of the listing cards of the page, in order. */
function cardNames(page: Page) {
  return page.getByRole("main").getByRole("listitem").getByRole("heading", { level: 2 });
}

/**
 * The invitation of an empty listing, to the registration page
 * (business-registration, "Public registration page on a single screen").
 */
function registerLink(page: Page) {
  return page
    .getByRole("main")
    .getByRole("link", { name: "Registra tu negocio gratis", exact: true });
}

/** The headings of the page, in order, as `h1`, `h2`, … */
function headingLevels(page: Page): Promise<string[]> {
  return page
    .locator("main :is(h1, h2, h3, h4, h5, h6)")
    .evaluateAll((all) => all.map((heading) => heading.tagName.toLowerCase()));
}

test.describe("Category listing at a clean URL with the catalogue slug", () => {
  // Scenario: listing of a category with businesses
  test("the listing has its heading and one card per published business, newest first and ties by name", async ({
    page,
  }) => {
    const response = await page.goto(`${HOME}/servicios-del-hogar`);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Servicios del hogar en Tizayuca",
    );
    await expect(cardNames(page)).toHaveText([
      "Cerrajería La Llave Inventada",
      "Electricista Chispazo de Mentiras",
      "Plomería Los Fontaneros Ficticios",
    ]);
  });

  // Scenario: category URLs are stable
  test("a category URL answers its listing, without a redirect", async ({ request }) => {
    const response = await request.get(`${HOME}/clubes-y-escuelas-deportivas`, {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Clubes y escuelas deportivas en Tizayuca");
  });

  // Scenario: slug that is in no catalogue; compound that does not exist
  for (const segment of [
    "plomeros-baratos",
    "plomeria-colonia-inventada",
    "loquesea-huicalco",
    "huicalco",
    "Plomeria",
    "servicios-del-hogar-huicalco",
  ]) {
    test(`/${segment} answers the site's 404`, async ({ page }) => {
      const response = await page.goto(`${HOME}/${segment}`);

      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "No encontramos esta página",
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    });
  }

  // Scenario: category with no published businesses yet
  test("a category without published businesses says so", async ({ page }) => {
    const response = await page.goto(`${HOME}/otro`);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Otro en Tizayuca");
    await expect(
      page.getByText("Todavía no hay negocios publicados en esta categoría.", { exact: true }),
    ).toBeVisible();
    await expect(cardNames(page)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Filtrar por colonia" })).toHaveCount(0);
    // The invitation to register, the primary action, to the registration page.
    await expect(registerLink(page)).toHaveAttribute("href", `${HOME}/registro`);
    await expect(registerLink(page)).toHaveClass(/\bbg-action\b/);
    await registerLink(page).click();
    await expect(page).toHaveURL(`${HOME}/registro`);
  });

  // Scenario: the dynamic route does not shadow the site's own routes
  test("the card of a business is its card, not a listing", async ({ page }) => {
    await page.goto(`${HOME}/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Plomería Los Fontaneros Ficticios",
    );
  });
});

test.describe("Only what is published is shown", () => {
  // Scenarios: a business under review does not appear in the listing; a
  // rejected business does not appear in the listing
  test("a card in review or rejected appears in no listing, and none of its data is in the HTML", async ({
    request,
  }) => {
    for (const [path, hidden] of [
      [`${HOME}/belleza`, ["Barbería El Corte Imaginario", "7719990111", "los-heroes-tizayuca"]],
      [`${HOME}/talleres`, ["Taller Fantasma de Mentiras", "7719990112", "Reparamos de todo"]],
    ] as const) {
      const html = await (await request.get(path)).text();
      for (const text of hidden) expect(html, `${path} ${text}`).not.toContain(text);
    }
  });
});

test.describe("Zone filter in the listing, without client-side JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  // Scenarios: filtering by a zone; removing the filter; only zones with businesses
  test("the zone links filter the listing and remove the filter, with no JavaScript", async ({
    page,
  }) => {
    await page.goto(`${HOME}/servicios-del-hogar`);
    const filter = page.getByRole("navigation", { name: "Filtrar por colonia" });
    await expect(filter.getByRole("link")).toHaveText(["Todas las colonias", "Atempa", "Huicalco"]);
    await expect(filter.getByRole("link", { name: "Todas las colonias" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await filter.getByRole("link", { name: "Huicalco" }).click();
    await expect(page).toHaveURL(`${HOME}/servicios-del-hogar?colonia=huicalco`);
    await expect(cardNames(page)).toHaveText([
      "Cerrajería La Llave Inventada",
      "Plomería Los Fontaneros Ficticios",
    ]);
    await expect(filter.getByRole("link", { name: "Huicalco" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Scenario: the filtered listing does not compete with the trade pages
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${SITE_URL}${HOME}/servicios-del-hogar`,
    );

    await filter.getByRole("link", { name: "Todas las colonias" }).click();
    await expect(page).toHaveURL(`${HOME}/servicios-del-hogar`);
    await expect(cardNames(page)).toHaveCount(3);
  });

  // Scenario: filter with businesses of that category but not in that zone
  test("a zone without cards of the category says so and offers all the zones", async ({
    page,
  }) => {
    const response = await page.goto(`${HOME}/belleza?colonia=atempa`);

    expect(response?.status()).toBe(200);
    await expect(
      page.getByText("No encontramos negocios de esta categoría en esa colonia.", { exact: true }),
    ).toBeVisible();
    // A zone filter leads back to all the zones, and invites to nothing else.
    await expect(registerLink(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Ver todas las colonias" }).click();
    await expect(page).toHaveURL(`${HOME}/belleza`);
    await expect(cardNames(page)).toHaveText(["Estética Tijeras de Mentira"]);
  });

  // Scenario: unknown zone in the URL
  test("a zone that is not in the catalogue is ignored", async ({ page }) => {
    const response = await page.goto(`${HOME}/servicios-del-hogar?colonia=colonia-inventada`);

    expect(response?.status()).toBe(200);
    await expect(cardNames(page)).toHaveCount(3);
  });

  // Scenario: published business with unnormalized "Otra" zone
  test('a card of the zone "Otra" shows its text, and brings no zone option', async ({ page }) => {
    await page.goto(`${HOME}/abarrotes-y-comercio`);

    const card = page.getByRole("main").getByRole("listitem");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText([
      "Abarrotes La Esperanza Inventada",
    ]);
    await expect(card.getByText("Privada Los Colibríes Imaginarios")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Filtrar por colonia" })).toHaveCount(0);
  });
});

test.describe("The listing card brings the essentials and WhatsApp without extra taps", () => {
  // Scenarios: direct WhatsApp from the card; accessible button label; "A domicilio" tag only when it applies
  test("each card has the name, the zone, the tag when it applies and the WhatsApp button", async ({
    page,
  }) => {
    await page.goto(`${HOME}/servicios-del-hogar?colonia=huicalco`);

    const plumber = page
      .getByRole("listitem")
      .filter({ hasText: "Plomería Los Fontaneros Ficticios" });
    await expect(plumber.getByText("Huicalco", { exact: true })).toBeVisible();
    await expect(plumber.getByText("A domicilio", { exact: true })).toBeVisible();
    await expect(
      plumber.getByRole("link", { name: "Enviar WhatsApp a Plomería Los Fontaneros Ficticios" }),
    ).toHaveAttribute(
      "href",
      "https://wa.me/527719990101?text=Hola%2C%20te%20vi%20en%20enmirumbo.%20%C2%BFMe%20das%20informes%3F",
    );
    const locksmith = page
      .getByRole("listitem")
      .filter({ hasText: "Cerrajería La Llave Inventada" });
    await expect(locksmith.getByText("A domicilio", { exact: true })).toHaveCount(0);
  });

  // Scenario: the card leads to the public card
  test("the rest of the card leads to the business's card", async ({ page }) => {
    await page.goto(`${HOME}/servicios-del-hogar`);

    await page.getByRole("link", { name: "Cerrajería La Llave Inventada", exact: true }).click();
    await expect(page).toHaveURL(`${HOME}/negocio/cerrajeria-la-llave-inventada-65r9anw94p`);
  });
});

test.describe("Indexable trade page at the root, generated from the closed catalogue", () => {
  // Scenario: page of a trade with businesses
  test("lists the cards with the trade, with its heading and zone navigation to own URLs", async ({
    page,
  }) => {
    const response = await page.goto(`${HOME}/plomeria`);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plomería en Tizayuca");
    await expect(cardNames(page)).toHaveText(["Plomería Los Fontaneros Ficticios"]);
    // Scenario: the zone navigation leads to own URLs
    const nav = page.getByRole("navigation", { name: "Filtrar por colonia" });
    await expect(nav.getByRole("link", { name: "Huicalco" })).toHaveAttribute(
      "href",
      `${HOME}/plomeria-huicalco`,
    );
    await expect(nav.getByRole("link")).toHaveCount(2);
  });

  // Scenario: the sports trade lands the search that PRD §6.5 asks for
  test("the heading of a sports trade is its curated phrase", async ({ page }) => {
    await page.goto(`${HOME}/futbol`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Clases de futbol en Tizayuca",
    );
    await expect(cardNames(page)).toHaveText(["Academia Halcones de Mentiras"]);
  });

  // Scenario: a business without that trade does not appear
  test("a business without the trade does not appear, even in the same category and zone", async ({
    page,
  }) => {
    await page.goto(`${HOME}/cerrajeria`);

    await expect(cardNames(page)).toHaveText(["Cerrajería La Llave Inventada"]);
  });

  test("a catalogue name with a slash is headed by its curated phrase", async ({ page }) => {
    await page.goto(`${HOME}/fonda-comida-corrida`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Fondas y comida corrida en Tizayuca",
    );
    await expect(cardNames(page)).toHaveText(["Cocina Doña Chela de Mentiras"]);
  });
});

test.describe("Indexable trade and zone page", () => {
  // Scenarios: trade and zone page with businesses; going back to the whole trade
  test("lists the cards of the trade in the zone, and leads back to the whole trade", async ({
    page,
  }) => {
    const response = await page.goto(`${HOME}/plomeria-huicalco`);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Plomería en Huicalco, Tizayuca",
    );
    await expect(cardNames(page)).toHaveText(["Plomería Los Fontaneros Ficticios"]);
    const nav = page.getByRole("navigation", { name: "Filtrar por colonia" });
    await expect(nav.getByRole("link", { name: "Huicalco" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await nav.getByRole("link", { name: "Todas las colonias" }).click();
    await expect(page).toHaveURL(`${HOME}/plomeria`);
  });

  // Scenario: the zone that already says Tizayuca does not repeat it
  test("a zone whose name says Tizayuca is not followed by it", async ({ page }) => {
    await page.goto(`${HOME}/estetica-haciendas-de-tizayuca`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Estética en Haciendas de Tizayuca",
    );
    await expect(page).toHaveTitle("Estética en Haciendas de Tizayuca — enmirumbo");
  });
});

test.describe("Trade pages without published businesses are neither indexed nor linked, but are not 404 either", () => {
  // Scenarios: catalogue trade that does not have businesses yet; the empty is not indexed
  test("a trade without businesses answers 200, says so and asks not to be indexed", async ({
    page,
  }) => {
    const response = await page.goto(`${HOME}/box`);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clases de box en Tizayuca");
    await expect(
      page.getByText("Todavía no hay negocios publicados de esto en Tizayuca.", { exact: true }),
    ).toBeVisible();
    await expect(registerLink(page)).toHaveAttribute("href", `${HOME}/registro`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });

  // Scenario: trade and zone combination without businesses
  test("a trade and zone without businesses says so and leads to the whole trade", async ({
    page,
  }) => {
    const response = await page.goto(`${HOME}/plomeria-atempa`);

    expect(response?.status()).toBe(200);
    await expect(
      page.getByText("Todavía no hay negocios publicados de esto en esta colonia.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(registerLink(page)).toHaveAttribute("href", `${HOME}/registro`);
    await page.getByRole("link", { name: "Ver todas las colonias" }).click();
    await expect(page).toHaveURL(`${HOME}/plomeria`);
  });

  test("a trade and zone of a trade without businesses links to no empty page", async ({
    page,
  }) => {
    await page.goto(`${HOME}/box-huicalco`);

    await expect(page.getByRole("link", { name: "Ver todas las colonias" })).toHaveCount(0);
    await expect(registerLink(page)).toHaveAttribute("href", `${HOME}/registro`);
  });

  // Scenarios: the empty is not linked either; what does have content is indexed
  test("no link of the listings, the trade pages or the cards leads to a page that is not indexed", async ({
    request,
  }) => {
    // The pages robots.txt keeps crawlers out of, such as the report form of
    // a card, are not indexed on purpose and are not followed.
    const robots = await (await request.get("/robots.txt")).text();
    const disallowed = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map(
      ([, rule = ""]) =>
        new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}`),
    );
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const queue = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(
      ([, url = ""]) => new URL(url).pathname,
    );
    const seen = new Set<string>();
    const problems: string[] = [];
    while (queue.length > 0 && seen.size < 200) {
      const path = queue.shift() ?? "/";
      if (seen.has(path)) continue;
      seen.add(path);
      const html = await (await request.get(path)).text();
      if (html.includes('name="robots"')) problems.push(`${path} is not indexed`);
      for (const [, href = ""] of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
        const target = href.replaceAll("&amp;", "&");
        if (!target.startsWith(`${HOME}/`) || seen.has(target)) continue;
        if (!disallowed.some((rule) => rule.test(target))) queue.push(target);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(problems).toEqual([]);
  });
});

test.describe("A zone whose name repeats in its locality is shown with its settlement type (v2)", () => {
  // The seeded taller is in the zone "Tizayuca" of type "Zona industrial",
  // named like its municipality.
  const ZONE = "Tizayuca (Zona industrial)";

  // Scenario: a zone named like its municipality
  test("the listing card and the zone filter show the zone with its type", async ({ page }) => {
    await page.goto(`${HOME}/talleres`);

    await expect(page.getByRole("article").getByText(ZONE, { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Filtrar por colonia" })
        .getByRole("link", { name: ZONE }),
    ).toHaveAttribute("href", `${HOME}/talleres?colonia=zona-industrial-tizayuca`);
  });

  test("the trade and zone page heads with it, at the same URL", async ({ page }) => {
    const response = await page.goto(`${HOME}/taller-mecanico-zona-industrial-tizayuca`);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Taller mecánico en Tizayuca (Zona industrial)",
    );
    await expect(page).toHaveTitle("Taller mecánico en Tizayuca (Zona industrial) — enmirumbo");
  });

  test("the card shows it, in its zone and its title", async ({ page }) => {
    await page.goto(`${HOME}/negocio/taller-mecanico-el-tornillo-inventado-5k3fca733a`);

    await expect(page.getByRole("main").getByText(ZONE, { exact: true })).toBeVisible();
    await expect(page).toHaveTitle(
      "Taller Mecánico El Tornillo Inventado en Tizayuca (Zona industrial) — enmirumbo",
    );
  });

  test("a zone whose name repeats nowhere keeps its name alone", async ({ page }) => {
    await page.goto(`${HOME}/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72`);

    await expect(page).toHaveTitle(
      "Plomería Los Fontaneros Ficticios en Huicalco, Tizayuca — enmirumbo",
    );
  });
});

test.describe("From the card the pages of its trades are reached", () => {
  // Scenarios: card with assigned trades; trade links never lead to an empty page
  test("each trade of a card links to its page, which lists that card", async ({ page }) => {
    await page.goto(`${HOME}/negocio/estetica-tijeras-de-mentira-uw3ffjy6fw`);

    const trades = page.getByRole("navigation", { name: "Lo que hace este negocio" });
    await expect(trades.getByRole("link")).toHaveText(["Estética", "Uñas", "Maquillaje"]);
    await trades.getByRole("link", { name: "Uñas" }).click();
    await expect(page).toHaveURL(`${HOME}/unas`);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(cardNames(page)).toHaveText(["Estética Tijeras de Mentira"]);
  });
});

test.describe("Own title and description on each directory page, with its canonical", () => {
  // Scenario: each page with its own title
  test("the listing, the trade page and the trade and zone page each have their own texts and canonical", async ({
    page,
  }) => {
    const expected = [
      [
        "servicios-del-hogar",
        "Servicios del hogar en Tizayuca",
        "Servicios del hogar en Tizayuca: negocios de aquí, verificados uno por uno, que contactas directo por WhatsApp.",
      ],
      [
        "plomeria",
        "Plomería en Tizayuca",
        "Plomería en Tizayuca: negocios verificados que contactas directo por WhatsApp, sin intermediarios.",
      ],
      [
        "plomeria-huicalco",
        "Plomería en Huicalco, Tizayuca",
        "Plomería en Huicalco: negocios verificados de Tizayuca que contactas directo por WhatsApp.",
      ],
    ] as const;
    for (const [segment, title, description] of expected) {
      await page.goto(`${HOME}/${segment}`);
      await expect(page).toHaveTitle(`${title} — enmirumbo`);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        description,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `${SITE_URL}${HOME}/${segment}`,
      );
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    }
  });
});

test.describe("Heading levels never skip (v2)", () => {
  // Scenario: a listing
  test("the h1 comes first and the business names are h2", async ({ page }) => {
    for (const path of [`${HOME}/servicios-del-hogar`, `${HOME}/plomeria`, `${HOME}/box`]) {
      await page.goto(path);
      const levels = await headingLevels(page);
      expect(levels[0], path).toBe("h1");
      expect(new Set(levels.slice(1)), path).toEqual(new Set(levels.length > 1 ? ["h2"] : []));
    }
  });
});

test.describe("Directory in Server Components, mobile-first and usable without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  // Scenario: navigation without JavaScript (the journey through the search
  // is in home.spec.ts)
  test("home → category → zone filter → card → trade → trade and zone → WhatsApp, with no JavaScript", async ({
    page,
  }) => {
    await page.goto(HOME);
    await page.getByRole("link", { name: "Servicios del hogar", exact: true }).click();
    await expect(page).toHaveURL(`${HOME}/servicios-del-hogar`);
    await page.getByRole("link", { name: "Huicalco" }).click();
    await page
      .getByRole("link", { name: "Plomería Los Fontaneros Ficticios", exact: true })
      .click();
    await expect(page).toHaveURL(`${HOME}/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72`);
    await page
      .getByRole("navigation", { name: "Lo que hace este negocio" })
      .getByRole("link", { name: "Plomería" })
      .click();
    await expect(page).toHaveURL(`${HOME}/plomeria`);
    await page.getByRole("link", { name: "Huicalco" }).click();
    await expect(page).toHaveURL(`${HOME}/plomeria-huicalco`);
    await expect(
      page.getByRole("link", { name: "Enviar WhatsApp a Plomería Los Fontaneros Ficticios" }),
    ).toHaveAttribute("href", /^https:\/\/wa\.me\/527719990101\?text=/);
  });
});

test.describe('Directory lists show 20 cards per page, with "Ver más" to the next (v2)', () => {
  // Scenario: a page number that is not one; past the last page
  for (const query of ["pagina=1", "pagina=0", "pagina=01", "pagina=abc", "pagina=", "pagina=2"]) {
    test(`?${query} answers 404`, async ({ request }) => {
      const response = await request.get(`${HOME}/servicios-del-hogar?${query}`);

      expect(response.status()).toBe(404);
    });
  }

  test('a list that fits one page has no "Ver más"', async ({ page }) => {
    await page.goto(`${HOME}/servicios-del-hogar`);

    await expect(page.getByRole("link", { name: "Ver más" })).toHaveCount(0);
  });
});

test.describe("The sitemap lists the pages that exist, from the database (v2)", () => {
  test("it lists the 8 listings, the trade pages with published businesses and the registration form, and no other", async ({
    request,
  }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    const paths = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(
      ([, url = ""]) => new URL(url).pathname,
    );
    const pages = paths.filter((path) => /^\/hidalgo\/tizayuca\/[^/]+$/.test(path)).toSorted();

    expect(pages).toEqual(
      [
        "restaurantes-y-fondas",
        "servicios-del-hogar",
        "belleza",
        "salud",
        "abarrotes-y-comercio",
        "talleres",
        "clubes-y-escuelas-deportivas",
        "otro",
        "plomeria",
        "plomeria-huicalco",
        "electricidad",
        "electricidad-atempa",
        "cerrajeria",
        "cerrajeria-huicalco",
        "fonda-comida-corrida",
        "fonda-comida-corrida-tizayuca-centro",
        "futbol",
        "futbol-nuevo-tizayuca",
        "natacion",
        "natacion-fuentes-de-tizayuca",
        "estetica",
        "estetica-haciendas-de-tizayuca",
        "unas",
        "unas-haciendas-de-tizayuca",
        "maquillaje",
        "maquillaje-haciendas-de-tizayuca",
        // "Otra" zone: the trade page, and no trade and zone page.
        "abarrotes",
        "veterinaria",
        "veterinaria-el-cid",
        "farmacia",
        "farmacia-atempa",
        "dentista",
        "dentista-tizayuca-centro",
        "taller-mecanico",
        "taller-mecanico-zona-industrial-tizayuca",
        // The registration form, the one page of the site's own at this depth
        // (not its thank-you page).
        "registro",
      ]
        .map((segment) => `${HOME}/${segment}`)
        .toSorted(),
    );
    expect(paths.filter((path) => path.includes("?") || path.endsWith("/box"))).toEqual([]);
  });
});
