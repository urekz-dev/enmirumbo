// Scenarios of docs/specs/public-directory.md for the results page, rendered
// with Astro's Container API in every state the page can decide
// (src/components/SearchPage.astro): "Results page with the same cards as the
// listing", "With no results, the page offers the categories as an
// alternative", "Empty query and hostile terms bounded, without error", "The
// results page is not indexable", "The search endpoint has a per-IP quota
// (v2)", "Directory lists show 20 cards per page, with "Ver más" to the next (v2)", "Heading
// levels never skip (v2)" and "Every text that names the locality reads it
// from the locality record (v2)" (base-layout); and of docs/specs/
// base-layout.md, "Two product events and the no-results tag are recorded,
// only in production (v2)" and "The measurement carries no personal data or
// text typed by people". The page that decides the state, with the database
// and the quota, is served in test/e2e/search.spec.ts.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import type { ListingBusiness } from "../../src/core/business/listing.ts";
import type { ServedLocality } from "../../src/core/locality/served.ts";
import type { SearchState } from "../../src/core/search/state.ts";
import SearchPage from "../../src/components/SearchPage.astro";
import { pageAnalytics } from "../../src/lib/analytics.ts";
import { env } from "./cloudflare-workers.ts";

const TIZAYUCA: ServedLocality = {
  code: "13069",
  name: "Tizayuca",
  slug: "tizayuca",
  state: { code: "13", name: "Hidalgo", slug: "hidalgo" },
  timeZone: "America/Mexico_City",
  contactWhatsapp: "7719990100",
  othersActive: false,
  seat: null,
};

const OTHER: ServedLocality = {
  ...TIZAYUCA,
  code: "94001",
  name: "Pueblo Uno",
  slug: "pueblo-uno",
  state: { code: "94", name: "Estado de prueba 94", slug: "estado-de-prueba-94" },
};

const WEBSITE_ID = "94db1cb1-74f4-4a40-ad6c-962362670409";

/** The 8 categories, in catalogue order (drizzle/0007_categories_trades.sql). */
const CATEGORIES = [
  { name: "Restaurantes y fondas", slug: "restaurantes-y-fondas" },
  { name: "Servicios del hogar", slug: "servicios-del-hogar" },
  { name: "Belleza", slug: "belleza" },
  { name: "Salud", slug: "salud" },
  { name: "Abarrotes y comercio", slug: "abarrotes-y-comercio" },
  { name: "Talleres", slug: "talleres" },
  { name: "Clubes y escuelas deportivas", slug: "clubes-y-escuelas-deportivas" },
  { name: "Otro", slug: "otro" },
];

const PLUMBER: ListingBusiness = {
  id: "b5q68b2e72",
  name: "Plomería Los Fontaneros Ficticios",
  categorySlug: "servicios-del-hogar",
  zoneName: "Huicalco",
  zoneSlug: "huicalco",
  homeDelivery: true,
  whatsapp: "7719990101",
  photoKey: null,
};

const LOCKSMITH: ListingBusiness = {
  ...PLUMBER,
  id: "k8dw2p4n6r",
  name: "Cerrajería La Llave Inventada",
  homeDelivery: false,
  whatsapp: "7719990103",
};

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

afterEach(() => {
  for (const key of Object.keys(env)) delete env[key as keyof Env];
  env.ENVIRONMENT = "local";
});

/** Production with a Website ID: the only place the measurement is on. */
function measured(): void {
  Object.assign(env, {
    ENVIRONMENT: "prod",
    SITE_URL: "https://enmirumbo.com",
    UMAMI_WEBSITE_ID: WEBSITE_ID,
  });
}

/** The results page of `query` in `state`, as the page renders it. */
function render(
  query: string,
  state: SearchState,
  locality: ServedLocality = TIZAYUCA,
): Promise<string> {
  const url = new URL(`https://enmirumbo.com/${locality.state.slug}/${locality.slug}/buscar`);
  url.searchParams.set("q", query);
  const route = "/[state]/[municipality]/buscar";
  return container.renderToString(SearchPage, {
    partial: false,
    props: { query, state, analytics: pageAnalytics(env, url, route) },
    request: new Request(url),
    locals: { locality } as App.Locals,
  });
}

/** Text as a person reads it: entities decoded. */
function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, "&");
}

/** The text of every element named `tag`, in order. */
function texts(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map(
    ([, inner = ""]) =>
      decode(
        inner
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      ),
  );
}

/** The headings, in order, as `h<level> text`. */
function headings(html: string): string[] {
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(
    ([, level, inner = ""]) => `h${level} ${decode(inner.replace(/<[^>]+>/g, "").trim())}`,
  );
}

/** The links of `main`, as [href, text]; what is aria-hidden is not read. */
function links(html: string): [string, string][] {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
  return [...main.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    ([, href = "", inner = ""]) => [
      decode(href),
      decode(
        inner
          .replace(/<(\w+)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    ],
  );
}

/** The search field. */
function field(html: string): string {
  // Quoted attribute values may hold ">": they are skipped whole.
  const inputs = html.match(/<input\b(?:[^>"]|"[^"]*")*>/g) ?? [];
  return inputs.find((input) => input.includes('name="q"')) ?? "";
}

/** The value the search field starts with. */
function fieldValue(html: string): string {
  return decode(/\bvalue="([^"]*)"/.exec(field(html))?.[1] ?? "");
}

function scripts(html: string): string[] {
  return html.match(/<script\b[^>]*>/g) ?? [];
}

const categoryLinks = (locality: ServedLocality) =>
  CATEGORIES.map(({ name, slug }) => [`/${locality.state.slug}/${locality.slug}/${slug}`, name]);

describe("Results page with the same cards as the listing", () => {
  // Scenario: results of a search
  it("its only h1 is the query, and each business is a listing card", async () => {
    const html = await render("plomero", {
      kind: "results",
      businesses: [PLUMBER, LOCKSMITH],
      next: null,
    });

    expect(headings(html)).toEqual([
      'h1 Resultados para "plomero"',
      "h2 Plomería Los Fontaneros Ficticios",
      "h2 Cerrajería La Llave Inventada",
    ]);
    expect(links(html)).toEqual(
      expect.arrayContaining([
        ["/hidalgo/tizayuca/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72", PLUMBER.name],
        ["/hidalgo/tizayuca/negocio/cerrajeria-la-llave-inventada-k8dw2p4n6r", LOCKSMITH.name],
      ]),
    );
    expect(html).toContain(`aria-label="Enviar WhatsApp a ${PLUMBER.name}"`);
    expect(texts(html, "span")).toContain("A domicilio");
  });

  // Scenario: correcting the search without going back
  it("repeats the search box at the top, with what was typed in its field", async () => {
    const html = await render("plomero", { kind: "results", businesses: [PLUMBER], next: null });

    expect(html).toMatch(/<form action="\/hidalgo\/tizayuca\/buscar" method="get" role="search"/);
    expect(fieldValue(html)).toBe("plomero");
    expect(texts(html, "label")).toEqual(["Busca lo que necesitas"]);
    expect(field(html)).toContain('placeholder="ej. plomero, tacos, futbol infantil"');
    expect(texts(html, "button")).toEqual(["Buscar"]);
    // The box comes before the results.
    expect(html.indexOf('role="search"')).toBeLessThan(html.indexOf("<article"));
  });

  // Scenario: the query is shown as text
  it("a query that looks like markup is shown as text", async () => {
    const html = await render("<b>plomero</b>", {
      kind: "results",
      businesses: [PLUMBER],
      next: null,
    });

    // No element of the query: the heading escapes it, and inside the
    // field's quoted value it is only text.
    expect(html.replace(/="[^"]*"/g, "")).not.toContain("<b>");
    expect(html).toContain("Resultados para &quot;&lt;b&gt;plomero&lt;/b&gt;&quot;");
    expect(headings(html)[0]).toBe('h1 Resultados para "<b>plomero</b>"');
    expect(fieldValue(html)).toBe("<b>plomero</b>");
  });
});

describe('Directory lists show 20 cards per page, with "Ver más" to the next (v2)', () => {
  it('"Ver más" leads to the next page when there is one, and is not there on the last', async () => {
    const next = "/hidalgo/tizayuca/buscar?q=plomero&pagina=2";
    const withNext = await render("plomero", {
      kind: "results",
      businesses: [PLUMBER],
      next,
    });
    const last = await render("plomero", { kind: "results", businesses: [PLUMBER], next: null });

    expect(links(withNext)).toContainEqual([next, "Ver más"]);
    // Not the WhatsApp green: a secondary action.
    const more = /<a\b[^>]*>\s*Ver más\s*<\/a>/.exec(withNext)?.[0] ?? "";
    expect(more).toContain("min-h-11");
    expect(more).not.toMatch(/\bbg-action\b/);
    expect(links(last).map(([, text]) => text)).not.toContain("Ver más");
  });
});

describe("With no results, the page offers the categories as an alternative", () => {
  // Scenario: search without matches
  it("says so and offers the eight categories, which lead to their listings", async () => {
    const html = await render("veterinario espacial", {
      kind: "no-results",
      categories: CATEGORIES,
    });

    expect(headings(html)).toEqual(['h1 Resultados para "veterinario espacial"']);
    expect(texts(html, "p")).toEqual(
      expect.arrayContaining([
        'No encontramos negocios para "veterinario espacial".',
        "Prueba con otra palabra o elige una categoría:",
      ]),
    );
    expect(links(html)).toEqual(categoryLinks(TIZAYUCA));
  });

  // Scenario: a search with no results is not an error
  it("keeps the search box with what was typed", async () => {
    const html = await render("veterinario espacial", {
      kind: "no-results",
      categories: CATEGORIES,
    });

    expect(fieldValue(html)).toBe("veterinario espacial");
  });

  it("the category buttons collapse from one column to three and have a touch area", async () => {
    const html = await render("x y", { kind: "no-results", categories: CATEGORIES });

    expect(html).toContain('class="grid grid-cols-1 gap-3 min-[22rem]:grid-cols-2 sm:grid-cols-3"');
    expect(html).toContain("min-h-16");
  });
});

describe("Empty query and hostile terms bounded, without error", () => {
  // Scenario: empty or only-spaces query
  it("asks what to look for, with the empty box and the categories, and lists no business", async () => {
    const html = await render("   ", { kind: "empty", categories: CATEGORIES });

    expect(headings(html)).toEqual(["h1 ¿Qué estás buscando?"]);
    expect(texts(html, "p")).toContain(
      "Escribe qué necesitas y te decimos quién lo hace en Tizayuca.",
    );
    expect(fieldValue(html)).toBe("");
    expect(links(html)).toEqual(categoryLinks(TIZAYUCA));
    expect(html).not.toContain("<article");
  });

  // base-layout, "Every text that names the locality reads it from the
  // locality record (v2)": scenario "a second locality"
  it("the notice names the locality from its record", async () => {
    const html = await render("", { kind: "empty", categories: CATEGORIES }, OTHER);

    expect(texts(html, "p")).toContain(
      "Escribe qué necesitas y te decimos quién lo hace en Pueblo Uno.",
    );
    expect(links(html)).toEqual(categoryLinks(OTHER));
    expect(html).not.toMatch(/tizayuca|hidalgo/i);
  });

  // Scenario: extremely long query
  it("the heading never repeats a string of thousands of characters", async () => {
    const query = `plomero ${"x".repeat(5_000)}`;
    const html = await render(query, { kind: "no-results", categories: CATEGORIES });
    const [heading = ""] = headings(html);

    expect(heading.length).toBeLessThan(120);
    expect(heading).toMatch(/^h1 Resultados para "plomero x+…"$/);
    // The field gets the cut text, without the "…" a resubmission would carry.
    expect(fieldValue(html)).toMatch(/^plomero x+$/);
    expect(fieldValue(html).length).toBe(80);
    expect(html).not.toContain("x".repeat(100));
  });

  it("invisible characters and stacked accents do not reach the heading", async () => {
    const query = `plo\u0000me‮ro\nplomería ${"á".repeat(3)}z${"́".repeat(500)}`;
    const html = await render(query, { kind: "no-results", categories: CATEGORIES });

    expect(headings(html)[0]).toBe('h1 Resultados para "plo me ro plomería áááz"');
  });
});

describe("The results page is not indexable", () => {
  // Scenario: results page metadata
  it.for([
    ["results", { kind: "results", businesses: [PLUMBER], next: null }],
    ["no results", { kind: "no-results", categories: CATEGORIES }],
    ["empty", { kind: "empty", categories: CATEGORIES }],
    ["over the quota", { kind: "over-quota", categories: CATEGORIES }],
  ] as const)("%s: noindex, follow, and no canonical", async ([, state]) => {
    measured();
    const html = await render("plomero", state);

    expect(html).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
  });

  // base-layout, "The measurement carries no personal data or text typed by
  // people": scenario "what the resident searches for does not travel
  // through the title either"
  it("its title is static: what was searched is in no title", async () => {
    measured();
    const html = await render("quiero abogado por mi divorcio", {
      kind: "no-results",
      categories: CATEGORIES,
    });

    expect(texts(html, "title")).toEqual(["Buscar en Tizayuca — enmirumbo"]);
    expect(html).not.toMatch(/<meta property="og:title" content="[^"]*abogado/);
  });
});

describe("Two product events and the no-results tag are recorded, only in production (v2)", () => {
  // Scenario: search with no results
  it("with measurement on, a search with no results tags its view, and nothing else", async () => {
    measured();
    const html = await render("veterinario espacial", {
      kind: "no-results",
      categories: CATEGORIES,
    });

    expect(scripts(html)).toEqual([
      `<script defer src="https://cloud.umami.is/script.js" data-website-id="${WEBSITE_ID}" data-exclude-search="true" data-tag="search-no-results">`,
    ]);
    // The tag is a fixed word: the query is in no measurement attribute.
    expect(html).not.toMatch(/data-[a-z-]*="[^"]*veterinario/);
    expect(html).not.toContain("data-umami-event");
  });

  it.for([
    ["results", { kind: "results", businesses: [PLUMBER], next: null }],
    ["empty", { kind: "empty", categories: CATEGORIES }],
    ["over the quota", { kind: "over-quota", categories: CATEGORIES }],
  ] as const)("with measurement on, %s: the view carries no tag", async ([, state]) => {
    measured();
    const tags = scripts(await render("plomero", state));

    expect(tags).toHaveLength(1);
    expect(tags[0]).not.toContain("data-tag");
  });

  it("the WhatsApp of a result is measured with the business's own category", async () => {
    measured();
    const html = await render("plomero", { kind: "results", businesses: [PLUMBER], next: null });

    expect(html).toContain('data-umami-event="whatsapp-listing"');
    expect(html).toContain('data-umami-event-category="servicios-del-hogar"');
  });

  // Scenario: other environments and excluded screens
  it.for(["local", "dev", "stage"])(
    "with measurement off (%s), no script and so no tag",
    async (environment) => {
      Object.assign(env, { ENVIRONMENT: environment, UMAMI_WEBSITE_ID: "" });
      const html = await render("veterinario espacial", {
        kind: "no-results",
        categories: CATEGORIES,
      });

      expect(scripts(html)).toEqual([]);
      expect(html).not.toContain("data-tag");
      expect(html).not.toContain("umami");
    },
  );
});

describe("The search endpoint has a per-IP quota (v2)", () => {
  // Scenario: over the quota
  it("over the quota: the message in plain Spanish, no results, and the categories", async () => {
    const html = await render("plomero", { kind: "over-quota", categories: CATEGORIES });

    expect(headings(html)).toEqual(['h1 Resultados para "plomero"']);
    expect(texts(html, "p")).toContain(
      "Recibimos muchas búsquedas desde aquí. Espera un rato y vuelve a intentar.",
    );
    expect(html).not.toContain("<article");
    expect(fieldValue(html)).toBe("plomero");
    expect(links(html)).toEqual(categoryLinks(TIZAYUCA));
  });
});
