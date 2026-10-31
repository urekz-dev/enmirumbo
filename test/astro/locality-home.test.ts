// Scenarios of docs/specs/public-directory.md for the home of a locality,
// rendered with Astro's Container API (src/components/LocalityHome.astro):
// "The home page shows the 8 categories as large buttons", "Highlighted
// "Deporte en Tizayuca" block on the home page", "Search box on the home page
// that works without client-side JavaScript", "The home of a locality lives
// under it and names it from the record (v2)", "Heading levels never skip
// (v2)" and "Directory in Server Components, mobile-first and usable without
// JavaScript"; and of docs/specs/base-layout.md, "Home of the site inside the
// layout, with the entry to registration", "Every text that names the
// locality reads it from the locality record (v2)" and "Every page declares
// its title, description, canonical and share preview (v2)". The served home,
// with the categories of the database, its sizes and its links, is tested in
// test/e2e/home.spec.ts. The notice of the root with no active locality
// (src/components/ComingSoon.astro), which the home of a locality replaced,
// is rendered here too.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import type { ServedLocality } from "../../src/core/locality/served.ts";
import ComingSoon from "../../src/components/ComingSoon.astro";
import LocalityHome from "../../src/components/LocalityHome.astro";
import { ROOT_DESCRIPTION } from "../../src/lib/site.ts";
import { collapseProblems } from "../responsive-rules.ts";
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
  code: "95001",
  name: "Pueblo Uno",
  slug: "pueblo-uno",
  state: { code: "95", name: "Estado de prueba 95", slug: "estado-de-prueba-95" },
};

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

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

afterEach(() => {
  for (const key of Object.keys(env)) delete env[key as keyof Env];
  env.ENVIRONMENT = "local";
});

/** The home of `locality`, as its page renders it. */
function render(locality: ServedLocality = TIZAYUCA): Promise<string> {
  const url = new URL(`http://localhost:4321/${locality.state.slug}/${locality.slug}`);
  return container.renderToString(LocalityHome, {
    partial: false,
    props: { categories: CATEGORIES },
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

/** What a person reads of some markup: no tags, no aria-hidden parts, spaces collapsed. */
function readable(markup: string): string {
  return decode(
    markup
      .replace(/<(\w+)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/** The content of `main`. */
function main(html: string): string {
  return /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
}

/** The headings, in order, as `h<level> text`. */
function headings(html: string): string[] {
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(
    ([, level, inner = ""]) => `h${level} ${readable(inner)}`,
  );
}

/** The class attribute of every heading of `level`. */
function headingClasses(html: string, level: number): string[] {
  return [...html.matchAll(new RegExp(`<h${level}\\b[^>]*class="([^"]*)"`, "g"))].map(
    ([, classes = ""]) => classes,
  );
}

/** The links of some markup, as [href, text]. */
function anchors(markup: string): [string, string][] {
  return [...markup.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    ([, href = "", inner = ""]) => [decode(href), readable(inner)],
  );
}

/** The links of `main`, as [href, text]. */
function links(html: string): [string, string][] {
  return anchors(main(html));
}

/** The opening tag of the link whose text is `text`. */
function linkTag(html: string, text: string): string {
  const match = [...main(html).matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].find(
    ([, , inner = ""]) => readable(inner) === text,
  );
  return match?.[1] ?? "";
}

/** The texts of the paragraphs of `main`. */
function paragraphs(html: string): string[] {
  return [...main(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(([, inner = ""]) =>
    readable(inner),
  );
}

function meta(html: string, attribute: "name" | "property", key: string): string | undefined {
  const tag = new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`).exec(html);
  return tag?.[1] === undefined ? undefined : decode(tag[1]);
}

const categoryLinks = (locality: ServedLocality) =>
  CATEGORIES.map(({ name, slug }) => [`/${locality.state.slug}/${locality.slug}/${slug}`, name]);

const SPORTS_PHRASE =
  "Escuelas, clubes y entrenadores para que los niños (y los grandes) se muevan.";

describe("Home of the site inside the layout, with the entry to registration", () => {
  // Scenario: home inside the layout
  it("inside the layout, the welcome h1 and its phrase, in Spanish", async () => {
    const html = await render();

    expect(html).toMatch(/<header\b[\s\S]*<main\b[\s\S]*<footer\b/);
    expect(headings(html)[0]).toBe("h1 ¿Qué necesitas en Tizayuca?");
    expect(paragraphs(html)[0]).toBe(
      "Encuentra negocios y servicios de aquí cerquita y contáctalos directo por WhatsApp.",
    );
  });

  // Scenarios: the home no longer announces that the directory is coming
  // later; no traces of the template
  it("no notice that the directory is coming, and no trace of a template", async () => {
    const html = await render();

    expect(html).not.toContain("Muy pronto");
    expect(html).not.toContain("Estamos armando");
    expect(html).not.toMatch(/next\.js|vercel|create-next-app|astro\.build/i);
  });

  // Scenario: heading hierarchy
  it("exactly one h1, and the sections are h2 with no skipped level", async () => {
    const html = await render();

    expect(headings(html)).toEqual([
      "h1 ¿Qué necesitas en Tizayuca?",
      "h2 Busca por categoría",
      "h2 Deporte en Tizayuca",
      "h2 ¿Tienes un negocio en Tizayuca?",
    ]);
  });

  // Scenario: entry to registration from the home; business-registration,
  // "Public registration page on a single screen": scenario "the owner
  // reaches registration from the home page"
  it('the last section asks "¿Tienes un negocio en Tizayuca?" and leads to the registration page', async () => {
    const html = await render();
    const section = html.slice(html.indexOf("¿Tienes un negocio en"), html.indexOf("</main>"));

    expect(anchors(section)).toEqual([
      ["/hidalgo/tizayuca/registro", "Registra tu negocio gratis"],
    ]);
    // The last section of the home, after the sports block, at its heading level.
    expect(html.indexOf("¿Tienes un negocio en")).toBeGreaterThan(html.indexOf("Deporte en"));
    const [categories = "", , registration = ""] = headingClasses(html, 2);
    expect(registration).toBe(categories);
  });

  // base-layout, "Home of the site inside the layout, with the entry to
  // registration": the primary action style and a touch area of at least 44px
  it('"Registra tu negocio gratis" is the primary action, in WhatsApp green, at least 44px tall', async () => {
    const classes = (
      /\bclass="([^"]*)"/.exec(linkTag(await render(), "Registra tu negocio gratis"))?.[1] ?? ""
    ).split(" ");

    expect(classes).toEqual(expect.arrayContaining(["bg-action", "text-ink", "min-h-11"]));
  });
});

describe("Search box on the home page that works without client-side JavaScript", () => {
  // Scenarios: searching from the home page; the search box works without
  // JavaScript
  it("a GET form to the results page of the locality, with an empty field", async () => {
    const html = await render();
    const forms = main(html).match(/<form\b[^>]*>/g) ?? [];

    expect(forms).toEqual([
      expect.stringMatching(
        /^<form action="\/hidalgo\/tizayuca\/buscar" method="get" role="search"/,
      ),
    ]);
    const input = main(html).match(/<input\b(?:[^>"]|"[^"]*")*>/g) ?? [];
    expect(input).toHaveLength(1);
    expect(input[0]).toContain('name="q"');
    expect(input[0]).not.toMatch(/\bvalue="[^"]/);
  });

  // Scenario: labeled and tappable field
  it("a visible label, the example and the button, each at least 44px", async () => {
    const html = await render();
    const [input = ""] = main(html).match(/<input\b(?:[^>"]|"[^"]*")*>/g) ?? [];
    const id = /\bid="([^"]*)"/.exec(input)?.[1];

    expect(main(html)).toMatch(
      new RegExp(`<label for="${id}"[^>]*>\\s*Busca lo que necesitas\\s*</label>`),
    );
    expect(input).toContain('placeholder="ej. plomero, tacos, futbol infantil"');
    expect(input).toContain("min-h-11");
    const buttons = main(html).match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(buttons.map(readable)).toEqual(["Buscar"]);
    expect(buttons[0]).toContain('type="submit"');
    expect(buttons[0]).toContain("min-h-11");
  });

  // Scenario: the search box stacks on a phone
  it("the field and the button are stacked, each at full width, until there is room", async () => {
    const html = await render();
    const [form = ""] = main(html).match(/<form\b[^>]*>/g) ?? [];

    expect(form).toContain("flex-col");
    expect(form).toContain("sm:flex-row");
    expect(main(html)).toMatch(/<button\b[^>]*class="[^"]*\bw-full\b[^"]*\bsm:w-auto\b/);
  });

  // Scenario: the search box comes before the categories; the home page
  // hierarchy does not change
  it("comes before the categories, and adds no heading of its own", async () => {
    const html = await render();

    expect(html.indexOf('role="search"')).toBeGreaterThan(html.indexOf("<h1"));
    expect(html.indexOf('role="search"')).toBeLessThan(html.indexOf("Busca por categoría"));
    const form = /<form\b[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
    expect(form).not.toMatch(/<h[1-6]\b/);
  });
});

describe("The home page shows the 8 categories as large buttons", () => {
  // Scenarios: the eight categories visible; tapping a category leads to its
  // listing
  it('under "Busca por categoría", the eight categories in catalogue order, each to its listing', async () => {
    const html = await render();
    const section = html.slice(html.indexOf("Busca por categoría"), html.indexOf("Deporte en"));

    expect(anchors(section)).toEqual(categoryLinks(TIZAYUCA));
  });

  // Scenarios: the grid collapses to a single column on very narrow screens;
  // two columns on a phone and three on a wide screen
  it("the grid collapses from one column to three, and each button has a large touch area", async () => {
    const html = await render();

    expect(html).toContain('class="grid grid-cols-1 gap-3 min-[22rem]:grid-cols-2 sm:grid-cols-3"');
    expect(linkTag(html, "Servicios del hogar")).toContain("min-h-16");
    // The name is the accessible content; the emoji is decorative.
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>\s*🔧\s*<\/span>\s*Servicios del hogar/);
  });

  // Scenario: no dead controls on the home page
  it("every control leads somewhere: the listings, the results page and the registration, nothing else", async () => {
    const html = await render();
    const sports = "/hidalgo/tizayuca/clubes-y-escuelas-deportivas";

    expect(links(html)).toEqual([
      ...categoryLinks(TIZAYUCA),
      [sports, "Ver clubes y escuelas deportivas"],
      ["/hidalgo/tizayuca/registro", "Registra tu negocio gratis"],
    ]);
    expect(main(html)).not.toMatch(/<(select|textarea)\b/);
    expect(main(html).match(/<button\b/g)).toHaveLength(1);
  });
});

describe('Highlighted "Deporte en Tizayuca" block on the home page', () => {
  // Scenario: the sports block is seen at the same level as the categories
  it("its heading, its phrase and its entry, at the level of the categories", async () => {
    const html = await render();

    expect(headings(html)).toContain("h2 Deporte en Tizayuca");
    expect(paragraphs(html)).toContain(SPORTS_PHRASE);
    // The same heading level and style as "Busca por categoría", after it.
    const [categories = "", sports = ""] = headingClasses(html, 2);
    expect(sports.split(" ")).toEqual(expect.arrayContaining(categories.split(" ")));
    expect(categories).toMatch(/\btext-xl\b/);
    expect(categories).toMatch(/\bfont-bold\b/);
    // The decorative emoji is the heading's sibling: the heading reads exactly
    // "Deporte en Tizayuca".
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*>\s*⚽\s*<\/span>\s*<h2\b[^>]*>Deporte en Tizayuca<\/h2>/,
    );
  });

  // Scenario: the block leads to the sports listing
  it("its entry leads to the listing of the category, the same as its button", async () => {
    const html = await render();
    const sports = links(html).filter(([href]) => href.endsWith("/clubes-y-escuelas-deportivas"));

    expect(sports).toEqual([
      ["/hidalgo/tizayuca/clubes-y-escuelas-deportivas", "Clubes y escuelas deportivas"],
      ["/hidalgo/tizayuca/clubes-y-escuelas-deportivas", "Ver clubes y escuelas deportivas"],
    ]);
  });

  // base-layout, "Base accessibility from PRD §8": scenario "secondary
  // button outline"
  it("its entry is a secondary action with a 44px touch area, never the action green", async () => {
    const tag = linkTag(await render(), "Ver clubes y escuelas deportivas");

    const classes = (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");

    expect(classes).toContain("min-h-11");
    expect(classes).toContain("border-control");
    // Neither its background, nor its text, nor its border, in any state;
    // the focus ring is every control's.
    expect(classes.filter((name) => /(?:^|:)(?:bg|text|border)-action/.test(name))).toEqual([]);
  });
});

describe("The home of a locality lives under it and names it from the record (v2)", () => {
  // base-layout, "Every text that names the locality reads it from the
  // locality record (v2)": scenario "a second locality"
  it("another locality: its own name, its own links, and Tizayuca nowhere", async () => {
    const html = await render(OTHER);

    expect(headings(html)).toEqual([
      "h1 ¿Qué necesitas en Pueblo Uno?",
      "h2 Busca por categoría",
      "h2 Deporte en Pueblo Uno",
      "h2 ¿Tienes un negocio en Pueblo Uno?",
    ]);
    expect(links(html)).toEqual([
      ...categoryLinks(OTHER),
      [
        "/estado-de-prueba-95/pueblo-uno/clubes-y-escuelas-deportivas",
        "Ver clubes y escuelas deportivas",
      ],
      ["/estado-de-prueba-95/pueblo-uno/registro", "Registra tu negocio gratis"],
    ]);
    expect(html).toMatch(/<form action="\/estado-de-prueba-95\/pueblo-uno\/buscar"/);
    expect(html).not.toMatch(/tizayuca|hidalgo/i);
  });

  // base-layout, "Server Component with a document in es-MX and base
  // metadata": scenario "the home keeps the site title"; "Every page declares
  // its title, description, canonical and share preview (v2)": scenario "the
  // home of a locality"
  it("the site's title and description in the locality, and its own canonical", async () => {
    Object.assign(env, {
      ENVIRONMENT: "stage",
      SITE_URL: "https://stage.enmirumbo.com",
    });
    const html = await render();
    const canonical = "https://stage.enmirumbo.com/hidalgo/tizayuca";

    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(
      "enmirumbo — Encuentra negocios y servicios en Tizayuca",
    );
    expect(meta(html, "name", "description")).toBe(
      "Encuentra negocios, servicios y deporte en Tizayuca y contáctalos directo por WhatsApp. Registro gratis para negocios locales.",
    );
    expect(/<link rel="canonical" href="([^"]*)"/.exec(html)?.[1]).toBe(canonical);
    expect(meta(html, "property", "og:url")).toBe(canonical);
    // public-directory, "The results page is not indexable": scenario "the
    // directory pages stay indexable"
    expect(meta(html, "name", "robots")).toBeUndefined();
  });
});

describe("Directory in Server Components, mobile-first and usable without JavaScript", () => {
  // Scenario: no client-side JS
  it("the home adds no script", async () => {
    expect(await render()).not.toMatch(/<script\b/);
  });

  // base-layout, "Mobile-first design with no horizontal scroll": scenario
  // "no public screen blocks responsive collapse"
  it("no class of the home blocks the responsive collapse", async () => {
    const html = await render();
    const classes = [...html.matchAll(/\bclass="([^"]*)"/g)].map(([, value = ""]) => value);

    expect(classes.length).toBeGreaterThan(10);
    expect(classes.flatMap(collapseProblems)).toEqual([]);
  });
});

describe("With no active locality the root says the directory is coming (v2)", () => {
  // Scenario: production before the launch; base-layout, "Pages outside a
  // locality name no locality (v2)"
  it("the notice that the directory is being built, naming no locality", async () => {
    const html = await container.renderToString(ComingSoon, {
      partial: false,
      props: { canonicalPath: "/", description: ROOT_DESCRIPTION, showLegalLinks: false },
      request: new Request("http://localhost:4321/"),
      locals: {} as App.Locals,
    });

    expect(paragraphs(html)).toContain("Estamos armando el directorio de negocios de tu colonia.");
    expect(html).not.toMatch(/tizayuca|hidalgo/i);
    expect(
      anchors(html).filter(([href]) => ["/aviso-de-privacidad", "/terminos"].includes(href)),
    ).toEqual([]);
  });
});
