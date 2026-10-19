// Scenarios of docs/specs/base-layout.md, "Internal links to existing routes
// and protected external links", and docs/specs/public-directory.md, "Public
// URLs carry the state and the municipality (v2)", on the source: every link
// (`href`) and form destination (`action`) written literally in src/ must name
// a route of the site with no parameter. A link to a page of a locality is
// never literal, because its prefix comes from the locality record
// (`localityPath`); test/e2e/internal-links.spec.ts follows those on the
// rendered pages.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { routePath, siteRoutes, staticRoutes } from "../site-routes.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const SOURCE = /\.(astro|ts|tsx|js|md|mdx|html)$/;
// Cloudflare Access owns this same-host endpoint; it is not an Astro route.
const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

/** The site paths written as `href="/…"` or `action="/…"`, in quotes or in braces. */
function literalLinks(source: string): string[] {
  const links = [];
  const attribute = /\b(?:href|action)\s*=\s*\{?\s*(["'`])(\/(?!\/)[^"'`\s]*)\1/g;
  for (const match of source.matchAll(attribute)) links.push(match[2] ?? "");
  return links;
}

/** `file: link` for every literal link in `files` that names no static route. */
function brokenLinks(files: Record<string, string>, routes: Set<string>): string[] {
  return Object.entries(files).flatMap(([file, source]) =>
    literalLinks(source)
      // Exempt Access's logout endpoint from the Astro route check.
      .filter((link) => link !== ACCESS_LOGOUT_PATH && !routes.has(routePath(link)))
      .map((link) => `${file}: ${link}`),
  );
}

function sourceFiles(): Record<string, string> {
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((file) =>
    SOURCE.test(file),
  );
  return Object.fromEntries(
    files.map((file) => [`src/${file}`, readFileSync(join(SRC, file), "utf8")]),
  );
}

describe("Internal links to existing routes and protected external links", () => {
  it("the routes come from src/pages", () => {
    const routes = siteRoutes();
    expect(routes).toEqual(
      expect.arrayContaining(["/", "/[state]/[municipality]", "/admin", "/health"]),
    );
    expect(routes).toContain("/robots.txt");
    expect(staticRoutes()).not.toContain("/[state]/[municipality]");
  });

  // docs/specs/public-directory.md, "There is no short alias of a locality
  // (v2)": a single segment is either a page of the site or a 404.
  it("no route takes any single segment, so /tizayuca is no page", () => {
    const anySegment = (route: string) => /^\/\[[^/]*\]$/.test(route);
    expect(siteRoutes().filter(anySegment)).toEqual([]);
    // The check itself: the alias route EMR-28 had, and a catch-all.
    expect(["/[alias]", "/[...path]", "/[state]/[municipality]"].filter(anySegment)).toEqual([
      "/[alias]",
      "/[...path]",
    ]);
  });

  it("every literal link and form destination of the site names a route that exists", () => {
    const files = sourceFiles();
    expect(Object.keys(files).length).toBeGreaterThan(10);
    expect(brokenLinks(files, staticRoutes())).toEqual([]);
  });

  it("internal link to a nonexistent route: the verification fails, flagging that link", () => {
    const files = {
      "src/components/Footer.astro": '<a href="/">Inicio</a> <a href="/no-existe">x</a>',
      "src/pages/x.astro": "<a href={'/admin/'}>panel</a> <a href='/admin#top'>panel</a>",
    };
    expect(brokenLinks(files, new Set(["/", "/admin"]))).toEqual([
      "src/components/Footer.astro: /no-existe",
    ]);
  });

  // Scenario: the legal routes exist and the verification recognizes them
  it("the legal routes exist and pass, and a misspelled one still fails", () => {
    const routes = staticRoutes();
    expect(routes).toContain("/aviso-de-privacidad");
    expect(routes).toContain("/terminos");
    const footer = [
      '<a href="/aviso-de-privacidad">Aviso de privacidad</a>',
      '<a href="/terminos">Términos y condiciones</a>',
      '<a href="/terminos-y-condiciones">Términos y condiciones</a>',
    ].join("\n");
    expect(brokenLinks({ "src/components/Footer.astro": footer }, routes)).toEqual([
      "src/components/Footer.astro: /terminos-y-condiciones",
    ]);
  });

  it("Cloudflare Access owns its logout endpoint rather than an Astro route", () => {
    const navigation = '<a href="/cdn-cgi/access/logout">Salir</a>';
    expect(literalLinks(navigation)).toEqual([ACCESS_LOGOUT_PATH]);
    expect(
      brokenLinks({ "src/components/admin/PanelNavigation.astro": navigation }, staticRoutes()),
    ).toEqual([]);
  });

  it("search form destination: a form that submits to a route that does not exist fails", () => {
    const form = '<form action="/buscar" method="get"><input name="q" /></form>';
    expect(brokenLinks({ "src/pages/index.astro": form }, new Set(["/"]))).toEqual([
      "src/pages/index.astro: /buscar",
    ]);
  });

  it("links keep the prefix: a literal path to a page of a locality is flagged", () => {
    const links = '<a href="/hidalgo/tizayuca/registro">Registra tu negocio gratis</a>';
    const routes = staticRoutes();
    expect(brokenLinks({ "src/pages/x.astro": links }, routes)).toEqual([
      "src/pages/x.astro: /hidalgo/tizayuca/registro",
    ]);
    // External, protocol-relative and built links are not literal site paths.
    const others = [
      '<a href="https://wa.me/5217719990001" target="_blank" rel="noopener noreferrer">',
      '<a href="//example.com/x">',
      "<a href={localityPath(locality, 'registro')}>",
      '<a href="tel:7719990001">',
    ].join("\n");
    expect(literalLinks(others)).toEqual([]);
  });
});
