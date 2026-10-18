// Scenarios of docs/specs/base-layout.md for the global layout, rendered with
// Astro's Container API and a fixture locality in Astro.locals, as the
// middleware sets it on the routes under /{estado}/{municipio}/ (ADR 0007).
// The served pages, their sizes and their touch areas are tested end to end in
// test/e2e/surfaces.spec.ts and test/e2e/not-found.spec.ts.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { ServedLocality } from "../../src/core/locality/served.ts";
import BaseLayout from "../../src/layouts/BaseLayout.astro";
import NotFound from "../../src/pages/404.astro";
import { attachedLocalityNames, brandFindings } from "../brand-rules.ts";
import { env } from "./cloudflare-workers.ts";

const TIZAYUCA: ServedLocality = {
  code: "13069",
  name: "Tizayuca",
  slug: "tizayuca",
  state: { code: "13", name: "Hidalgo", slug: "hidalgo" },
  timeZone: "America/Mexico_City",
  contactWhatsapp: "7719990001",
  othersActive: false,
  seat: null,
};

const OTHER: ServedLocality = {
  code: "98001",
  name: "Pueblo Uno",
  slug: "pueblo-uno",
  state: { code: "98", name: "Estado de prueba 98", slug: "estado-de-prueba-98" },
  timeZone: "America/Mexico_City",
  contactWhatsapp: "7719990002",
  othersActive: false,
  seat: null,
};

/** The links of the footer: the two legal pages, which every page shares. */
const LEGAL_LINKS = [
  ["/aviso-de-privacidad", "Aviso de privacidad"],
  ["/terminos", "Términos y condiciones"],
];

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

afterEach(() => {
  for (const key of Object.keys(env)) delete env[key as keyof Env];
  env.ENVIRONMENT = "local";
  vi.restoreAllMocks();
});

/**
 * What the middleware leaves in Astro.locals. The adapter's own locals
 * (cfContext) exist only in workerd, and the layout does not read them.
 */
function localsWith(locality: ServedLocality | undefined): App.Locals {
  return (locality === undefined ? {} : { locality }) as App.Locals;
}

/** The 404 page, a page with no title of its own, as a whole document. */
function renderNotFound(locality?: ServedLocality): Promise<string> {
  return container.renderToString(NotFound, {
    partial: false,
    locals: localsWith(locality),
  });
}

/** The layout around a page with its own title and head elements. */
function renderPage(locality: ServedLocality | undefined, title?: string): Promise<string> {
  return container.renderToString(BaseLayout, {
    partial: false,
    props: { title },
    slots: {
      default: "<h1>Servicios del hogar</h1>",
      head: '<meta name="robots" content="noindex, nofollow">',
    },
    locals: localsWith(locality),
  });
}

/** The layout of an indexable page at `path`, requested at `path`. */
function renderIndexable(
  locality: ServedLocality | undefined,
  path: string,
  props: { title?: string; description?: string } = {},
): Promise<string> {
  return container.renderToString(BaseLayout, {
    partial: false,
    props: { ...props, canonicalPath: path },
    slots: { default: "<h1>Una página</h1>" },
    request: new Request(`http://localhost:4321${path}`),
    locals: localsWith(locality),
  });
}

/** The text a person reads, one line per block, like innerText. */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(
      /<\/?(?:p|div|h[1-6]|li|ul|ol|header|footer|main|section|nav|title|br)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&amp;/g, "&");
}

/** The contents of the first element named `tag`. */
function element(html: string, tag: string): string {
  return new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(html)?.[1] ?? "";
}

function meta(html: string, attribute: "name" | "property", value: string): string | undefined {
  const tag = new RegExp(`<meta ${attribute}="${value}"[^>]*>`).exec(html)?.[0];
  return tag === undefined
    ? undefined
    : /content="([^"]*)"/.exec(tag)?.[1]?.replaceAll("&amp;", "&");
}

/** The href of the canonical link, if any. */
function canonical(html: string): string | undefined {
  return /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
}

/** Every script tag of a document. */
function scripts(html: string): string[] {
  return html.match(/<script\b[^>]*>/g) ?? [];
}

/** Every link of a fragment, as [href, text]. */
function links(html: string): [string, string][] {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    ([, href, text]) => [href ?? "", visibleText(text ?? "").trim()],
  );
}

describe("Global layout with header and footer on every page", () => {
  // Scenario: header with the wordmark
  it("the header shows the wordmark alone, linked to the home of the locality", async () => {
    const header = element(await renderNotFound(TIZAYUCA), "header");

    expect(links(header)).toEqual([["/hidalgo/tizayuca", "enmirumbo"]]);
    expect(visibleText(header)).not.toMatch(/tizayuca|hidalgo/i);
  });

  it("outside a locality the wordmark leads to the root", async () => {
    const header = element(await renderNotFound(), "header");

    expect(links(header)).toEqual([["/", "enmirumbo"]]);
  });

  // Scenarios: hyperlocal positioning stays visible outside the header; the
  // footer closing line did not change with the rebrand
  it("the footer reads the line for the neighbours of the locality, word for word", async () => {
    const footer = visibleText(element(await renderNotFound(TIZAYUCA), "footer"));

    expect(footer).toContain("\nHecho para los vecinos de Tizayuca, Hidalgo.\n");
  });

  // Scenario: footer with the legal links and no dead links (that each one
  // answers is checked end to end, in test/e2e/surfaces.spec.ts)
  it("the footer identifies the site and links to the two legal pages", async () => {
    const footer = element(await renderNotFound(TIZAYUCA), "footer");

    expect(visibleText(footer)).toMatch(/^\s*enmirumbo\n/);
    expect(links(footer)).toEqual(LEGAL_LINKS);
  });

  // Scenario: the footer links can be tapped on a phone (measured end to end)
  it("each footer link has a touch area of at least 44px", async () => {
    const footer = element(await renderNotFound(TIZAYUCA), "footer");
    const anchors = footer.match(/<a\b[^>]*>/g) ?? [];

    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) expect(anchor).toMatch(/\bmin-h-11\b/);
  });

  it("outside a locality the footer names no locality but keeps the brand and the legal links", async () => {
    const footer = element(await renderNotFound(), "footer");

    expect(visibleText(footer)).not.toContain("Hecho para los vecinos");
    expect(visibleText(footer)).toMatch(/^\s*enmirumbo\n/);
    expect(links(footer)).toEqual(LEGAL_LINKS);
  });
});

describe("Server Component with a document in es-MX and base metadata", () => {
  // Scenario: document in Mexican Spanish with metadata
  it("the document is in es-MX and its title and description name the locality", async () => {
    const html = await renderNotFound(TIZAYUCA);

    expect(html).toMatch(/^<!DOCTYPE html><html lang="es-MX"[ >]/i);
    expect(html).toContain('<meta charset="utf-8">');
    expect(meta(html, "name", "viewport")).toBe("width=device-width, initial-scale=1");
    expect(element(html, "title")).toBe("enmirumbo — Encuentra negocios y servicios en Tizayuca");
    expect(meta(html, "name", "description")).toBe(
      "Encuentra negocios, servicios y deporte en Tizayuca y contáctalos directo por WhatsApp. Registro gratis para negocios locales.",
    );
  });

  // Scenario: a page with its own title carries the brand at the end
  it("a page with its own title carries the brand at the end, and adds its own head elements", async () => {
    const html = await renderPage(TIZAYUCA, "Servicios del hogar en Tizayuca");

    expect(element(html, "title")).toBe("Servicios del hogar en Tizayuca — enmirumbo");
    expect(meta(html, "name", "robots")).toBe("noindex, nofollow");
  });

  // Scenario: the card shared through WhatsApp arrives with the new brand
  // (the identity part; the brand image and absolute URLs come with SEO)
  it("every page declares the identity of the share preview", async () => {
    const html = await renderPage(undefined);

    expect(meta(html, "property", "og:site_name")).toBe("enmirumbo");
    expect(meta(html, "property", "og:locale")).toBe("es_MX");
    expect(meta(html, "property", "og:type")).toBe("website");
  });

  it("outside a locality the title is the brand alone and there is no description", async () => {
    const html = await renderNotFound();

    expect(element(html, "title")).toBe("enmirumbo");
    expect(meta(html, "name", "description")).toBeUndefined();
  });

  // Scenario: no client JS in the layout
  it("the layout sends no script", async () => {
    expect(await renderNotFound(TIZAYUCA)).not.toMatch(/<script\b/i);
    expect(await renderPage(TIZAYUCA, "Una página")).not.toMatch(/<script\b/i);
  });
});

describe("Phone number auto-detection is turned off (v2)", () => {
  // Scenario: the meta tag
  it("the head turns off phone number detection", async () => {
    expect(meta(await renderNotFound(), "name", "format-detection")).toBe("telephone=no");
    expect(meta(await renderPage(TIZAYUCA, "Una página"), "name", "format-detection")).toBe(
      "telephone=no",
    );
  });
});

describe("Base accessibility from PRD §8", () => {
  // Scenario: semantic structure
  it("the content is inside header, main and footer, with a single h1", async () => {
    const html = await renderNotFound(TIZAYUCA);

    for (const landmark of ["header", "main", "footer"]) {
      expect(html.match(new RegExp(`<${landmark}\\b`, "g")), landmark).toHaveLength(1);
    }
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(element(html, "main")).toContain("No encontramos esta página");
  });
});

describe("404 page in Spanish inside the layout", () => {
  // Scenario: unknown URL (inside a locality; the root's is tested end to end)
  it("inside a locality it answers 404, keeps the locality's footer and leads to its home", async () => {
    const response = await container.renderToResponse(NotFound, {
      partial: false,
      locals: localsWith(TIZAYUCA),
    });
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(element(html, "h1").trim()).toBe("No encontramos esta página");
    expect(visibleText(element(html, "main"))).toContain(
      "A lo mejor el negocio ya no está publicado o la dirección quedó mal escrita.",
    );
    expect(links(element(html, "main"))).toEqual([["/hidalgo/tizayuca", "Ir al inicio"]]);
    expect(visibleText(element(html, "footer"))).toContain(
      "Hecho para los vecinos de Tizayuca, Hidalgo.",
    );
  });
});

describe("Every text that names the locality reads it from the locality record (v2)", () => {
  // Scenario: the footer
  it("the footer of a page of Tizayuca", async () => {
    expect(visibleText(element(await renderNotFound(TIZAYUCA), "footer"))).toContain(
      "Hecho para los vecinos de Tizayuca, Hidalgo.",
    );
  });

  // Scenario: a second locality
  it("another locality shows its own municipality and state, and Tizayuca appears nowhere", async () => {
    const html = await renderNotFound(OTHER);

    expect(visibleText(element(html, "footer"))).toContain(
      "Hecho para los vecinos de Pueblo Uno, Estado de prueba 98.",
    );
    expect(element(html, "title")).toBe("enmirumbo — Encuentra negocios y servicios en Pueblo Uno");
    expect(meta(html, "name", "description")).toContain("deporte en Pueblo Uno y");
    expect(links(element(html, "header"))).toEqual([
      ["/estado-de-prueba-98/pueblo-uno", "enmirumbo"],
    ]);
    expect(html).not.toMatch(/tizayuca|hidalgo/i);
  });
});

describe("No surface of the site names the previous brand or attaches the locality to the name", () => {
  // Scenario: the brand stays alone (base-layout, "Every text that names the
  // locality reads it from the locality record (v2)")
  it.for([
    ["Tizayuca", TIZAYUCA],
    ["another locality", OTHER],
    ["no locality", undefined],
  ] as const)("with %s, no rendered text breaks the brand rules", async ([, locality]) => {
    for (const html of [await renderNotFound(locality), await renderPage(locality, "Una página")]) {
      const text = [
        visibleText(html),
        meta(html, "name", "description") ?? "",
        meta(html, "property", "og:site_name") ?? "",
      ].join("\n");
      expect(brandFindings(text)).toEqual([]);
      const names = locality === undefined ? [] : [locality.name, locality.state.name];
      expect(attachedLocalityNames(text, names)).toEqual([]);
    }
  });

  it("the check of rendered text catches the locality attached to the brand", () => {
    expect(attachedLocalityNames("Bienvenido a enmirumbo Pueblo Uno", ["Pueblo Uno"])).toEqual([
      "Pueblo Uno",
    ]);
    expect(attachedLocalityNames("enmirumbo, el directorio de Pueblo Uno", ["Pueblo Uno"])).toEqual(
      [],
    );
  });
});

// docs/specs/deployment.md, requirement "The dev footer names the branch and
// commit deployed (v2)"; src/lib/deploy-info.ts decides when.
describe("The dev footer names the branch and commit deployed (v2)", () => {
  const COMMIT = "167a5a8e0c4f3b2a1d9e8f7a6b5c4d3e2f1a0b9c";

  // Scenario: dev
  it("on dev the footer names the branch and the short commit", async () => {
    Object.assign(env, {
      ENVIRONMENT: "dev",
      DEPLOY_BRANCH: "EMR-27-layout",
      DEPLOY_COMMIT: COMMIT,
    });
    const footer = element(await renderNotFound(TIZAYUCA), "footer");

    expect(visibleText(footer).replace(/\s+/g, " ")).toContain(
      "Versión de prueba: rama EMR-27-layout, commit 167a5a8",
    );
    expect(footer).toContain(`title="${COMMIT}"`);
  });

  // Scenario: another environment
  it("elsewhere there is no deploy footer, even with both values", async () => {
    Object.assign(env, { ENVIRONMENT: "stage", DEPLOY_BRANCH: "main", DEPLOY_COMMIT: COMMIT });

    expect(await renderNotFound(TIZAYUCA)).not.toContain("Versión de prueba");
  });
});

// docs/specs/public-directory.md, "The pages of a locality offer to change
// municipality while two or more are active (v2)", and the scenario "no
// chooser" of "While there is one active locality, the root redirects to it
// (v2)". The middleware reads othersActive with the locality.
describe("The pages of a locality offer to change municipality while two or more are active (v2)", () => {
  it("with another locality active, the footer links to the list", async () => {
    const footer = element(await renderNotFound({ ...TIZAYUCA, othersActive: true }), "footer");

    expect(links(footer)).toEqual([
      ["/?cambiar", "Cambiar de municipio"],
      ["/aviso-de-privacidad", "Aviso de privacidad"],
      ["/terminos", "Términos y condiciones"],
    ]);
  });

  // Scenario: no chooser
  it("as the only active locality, the footer offers no change", async () => {
    const html = await renderNotFound(TIZAYUCA);

    expect(html).not.toContain("Cambiar de municipio");
    expect(html).not.toContain("?cambiar");
  });

  it("outside a locality there is no locality to change", async () => {
    expect(await renderNotFound()).not.toContain("Cambiar de municipio");
  });
});

// docs/specs/base-layout.md, "Every page declares its title, description,
// canonical and share preview (v2)", "Canonical URLs, share previews and the
// sitemap use the full locality path (v2)" and "Each locality has its own
// share image, one static image per locality (v2)".
describe("Every page declares its title, description, canonical and share preview (v2)", () => {
  it("an indexable page of a locality: canonical and og:url absolute, from SITE_URL", async () => {
    Object.assign(env, {
      ENVIRONMENT: "stage",
      SITE_URL: "https://stage-enmirumbo.urekz.workers.dev",
    });
    const html = await renderIndexable(TIZAYUCA, "/hidalgo/tizayuca");

    expect(canonical(html)).toBe("https://stage-enmirumbo.urekz.workers.dev/hidalgo/tizayuca");
    expect(meta(html, "property", "og:url")).toBe(canonical(html));
    expect(meta(html, "property", "og:title")).toBe(
      "enmirumbo — Encuentra negocios y servicios en Tizayuca",
    );
    expect(meta(html, "property", "og:description")).toBe(meta(html, "name", "description"));
  });

  it("a page with its own title and description shares them", async () => {
    const html = await renderIndexable(undefined, "/terminos", {
      title: "Términos y condiciones",
      description: "Las reglas de enmirumbo.",
    });

    expect(canonical(html)).toBe("http://localhost:4321/terminos");
    expect(meta(html, "property", "og:title")).toBe("Términos y condiciones — enmirumbo");
    expect(meta(html, "property", "og:description")).toBe("Las reglas de enmirumbo.");
  });

  it("a page that passes no path (a 404, the panel) declares no canonical and no og:url", async () => {
    const html = await renderNotFound(TIZAYUCA);

    expect(canonical(html)).toBeUndefined();
    expect(meta(html, "property", "og:url")).toBeUndefined();
  });

  // public-directory, "The results page is not indexable": a page that must
  // not be indexed asks so, and declares no canonical even with a path.
  it("a page that passes noindex asks not to be indexed, follows its links and has no canonical", async () => {
    const html = await container.renderToString(BaseLayout, {
      partial: false,
      props: { canonicalPath: "/hidalgo/tizayuca/buscar", noindex: true },
      slots: { default: "<h1>Una página</h1>" },
      request: new Request("http://localhost:4321/hidalgo/tizayuca/buscar"),
      locals: localsWith(TIZAYUCA),
    });

    expect(meta(html, "name", "robots")).toBe("noindex, follow");
    expect(canonical(html)).toBeUndefined();
    expect(meta(html, "property", "og:url")).toBeUndefined();
    expect(meta(await renderIndexable(TIZAYUCA, "/hidalgo/tizayuca"), "name", "robots")).toBe(
      undefined,
    );
  });

  // Scenario: the card shared through WhatsApp arrives with the new brand
  it("a locality with its own image shares it: 1200×630, with the brand and the locality as descriptor", async () => {
    const html = await renderIndexable(TIZAYUCA, "/hidalgo/tizayuca");
    const image = meta(html, "property", "og:image") ?? "";

    expect(image).toMatch(/^http:\/\/localhost:4321\/.*tizayuca.*\.png/);
    expect(meta(html, "property", "og:image:type")).toBe("image/png");
    expect(meta(html, "property", "og:image:width")).toBe("1200");
    expect(meta(html, "property", "og:image:height")).toBe("630");
    expect(meta(html, "property", "og:image:alt")).toBe(
      "enmirumbo, el directorio de negocios de Tizayuca, Hidalgo",
    );
  });

  it("a locality without an image, and a page outside a locality, share the generic one", async () => {
    for (const html of [
      await renderIndexable(OTHER, "/estado-de-prueba-98/pueblo-uno"),
      await renderIndexable(undefined, "/"),
      await renderNotFound(),
    ]) {
      expect(meta(html, "property", "og:image")).toMatch(/\/[^/]*enmirumbo[^/]*\.png/);
      expect(meta(html, "property", "og:image:width")).toBe("1200");
      expect(meta(html, "property", "og:image:height")).toBe("630");
      expect(meta(html, "property", "og:image:alt")).toBe("enmirumbo");
    }
  });

  // public-directory, "The card looks good when shared over WhatsApp or
  // Facebook", scenario: card with a photo
  it("a card with a photo shares its photo instead of its locality's image", async () => {
    const photo = "https://media-enmirumbo.urekz.com/photos/yya626vdevvbuxa5avc2n8e6/full.webp";
    const html = await container.renderToString(BaseLayout, {
      partial: false,
      props: {
        canonicalPath: "/hidalgo/tizayuca/negocio/farmacia-la-pastilla-de-mentiras-rq7ka9z3yd",
        image: {
          src: photo,
          width: 1200,
          height: 900,
          type: "image/webp",
          alt: "Foto de Farmacia La Pastilla de Mentiras",
        },
      },
      slots: { default: "<h1>Farmacia La Pastilla de Mentiras</h1>" },
      locals: localsWith(TIZAYUCA),
    });

    expect(meta(html, "property", "og:image")).toBe(photo);
    expect(meta(html, "property", "og:image:type")).toBe("image/webp");
    expect(meta(html, "property", "og:image:width")).toBe("1200");
    expect(meta(html, "property", "og:image:height")).toBe("900");
    expect(meta(html, "property", "og:image:alt")).toBe("Foto de Farmacia La Pastilla de Mentiras");
  });

  // Scenario: a page without a locality (base-layout, "Pages outside a
  // locality name no locality (v2)")
  it("a page outside a locality names none in its metadata", async () => {
    const html = await renderIndexable(undefined, "/");
    const head = element(html, "head");

    expect(element(html, "title")).toBe("enmirumbo");
    expect(head).not.toMatch(/tizayuca|hidalgo/i);
    expect(meta(html, "property", "og:title")).toBe("enmirumbo");
  });

  // Scenarios: production without a declared public URL; a deployed
  // environment without a usable SITE_URL
  it("without a base for absolute URLs, no canonical, og:url or og:image, and the page renders", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(env, { ENVIRONMENT: "prod", SITE_URL: "http://localhost:4321" });
    const html = await renderIndexable(TIZAYUCA, "/hidalgo/tizayuca");

    expect(canonical(html)).toBeUndefined();
    expect(meta(html, "property", "og:url")).toBeUndefined();
    expect(meta(html, "property", "og:image")).toBeUndefined();
    expect(html).not.toContain("localhost");
    expect(element(html, "h1")).toBe("Una página");
  });
});

// docs/specs/base-layout.md, "Cookieless measurement is loaded only in
// production and only when configured (v2)", "The admin panel and edit mode
// stay out of the measurement" and "A single deferred script and zero own
// client JavaScript".
describe("Cookieless measurement is loaded only in production and only when configured (v2)", () => {
  const WEBSITE_ID = "94db1cb1-74f4-4a40-ad6c-962362670409";

  function measured(environment: string, websiteId = WEBSITE_ID): void {
    Object.assign(env, {
      ENVIRONMENT: environment,
      SITE_URL: "https://enmirumbo.urekz.workers.dev",
      UMAMI_WEBSITE_ID: websiteId,
    });
  }

  // Scenarios: a single deferred script; with both variables the provider's
  // script is loaded
  it("in production with a Website ID, one deferred script of Umami Cloud", async () => {
    measured("prod");
    const tags = scripts(await renderIndexable(TIZAYUCA, "/hidalgo/tizayuca"));

    expect(tags).toEqual([
      `<script defer src="https://cloud.umami.is/script.js" data-website-id="${WEBSITE_ID}" data-exclude-search="true">`,
    ]);
  });

  // Scenarios: with no variables configured nothing is loaded; other
  // environments and excluded screens
  it.for([
    ["prod without a Website ID", "prod", ""],
    ["stage with a Website ID", "stage", WEBSITE_ID],
    ["dev with a Website ID", "dev", WEBSITE_ID],
    ["local with a Website ID", "local", WEBSITE_ID],
  ] as const)("%s: no script at all", async ([, environment, websiteId]) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    measured(environment, websiteId);

    expect(scripts(await renderIndexable(TIZAYUCA, "/hidalgo/tizayuca"))).toEqual([]);
  });

  // Scenarios: the panel does not load the script; edit mode does not load
  // the script either
  it.for(["/admin", "/admin/registros/1/loquesea", "/hidalgo/tizayuca/editar/abc"])(
    "%s never loads it, even in production with a Website ID",
    async (path) => {
      measured("prod");
      const html = await container.renderToString(BaseLayout, {
        partial: false,
        slots: { default: "<h1>Panel</h1>" },
        request: new Request(`https://enmirumbo.urekz.workers.dev${path}`),
        locals: localsWith(undefined),
      });

      expect(scripts(html)).toEqual([]);
      expect(html).not.toContain("umami");
    },
  );
});
