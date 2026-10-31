// Scenarios of docs/specs/base-layout.md, requirements "Deployed environments
// stay out of search engines until the cut-over (v2)" and "The open
// robots.txt allows the public site and excludes what is not relevant (v2)".
// src/worker.ts applies withRobotsPolicy to every response and
// src/pages/robots.txt.ts serves CLOSED_ROBOTS_TXT where indexing is blocked
// and openRobotsTxt elsewhere; the end-to-end tests cover the local behaviour
// through the build.
import { describe, expect, it } from "vite-plus/test";
import type { LocalityRef } from "../../src/core/locality/paths.ts";
import { ADMIN_HEADERS, forbiddenResponse } from "../../src/lib/access/admin-gate.ts";
import {
  blocksIndexing,
  CLOSED_ROBOTS_TXT,
  openRobotsTxt,
  withRobotsPolicy,
} from "../../src/lib/robots.ts";

const DEPLOYED = ["dev", "stage", "prod"] as const;

function page(headers: Record<string, string> = {}): Response {
  return new Response("<!doctype html><title>enmirumbo</title>", {
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

describe("Deployed environments stay out of search engines until the cut-over (v2)", () => {
  it.for(DEPLOYED)("any response of %s carries X-Robots-Tag: noindex", (environment) => {
    expect(blocksIndexing(environment)).toBe(true);
    for (const response of [
      page(),
      new Response("Not found", { status: 404 }),
      new Response(null, { status: 500 }),
      Response.json({ ok: true }),
    ]) {
      const result = withRobotsPolicy(response, environment);
      expect(result.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(result.status).toBe(response.status);
    }
  });

  it("a response with immutable headers is copied with the header", () => {
    // The headers of a redirect made with Response.redirect are immutable, like
    // those of a response that comes from fetch().
    const redirect = Response.redirect("https://enmirumbo.com/", 302);
    expect(() => redirect.headers.set("X-Test", "1")).toThrow();

    const result = withRobotsPolicy(redirect, "prod");

    expect(result.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("https://enmirumbo.com/");
  });

  it.for(DEPLOYED)("the panel keeps its stricter value in %s", (environment) => {
    const response = withRobotsPolicy(forbiddenResponse(), environment);
    expect(response.headers.get("X-Robots-Tag")).toBe(ADMIN_HEADERS["X-Robots-Tag"]);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("robots.txt closes the whole site where indexing is blocked", () => {
    expect(CLOSED_ROBOTS_TXT).toBe("User-agent: *\nDisallow: /\n");
  });

  it.for([undefined, "", "production", "Local", " local"])(
    "an unknown or missing environment (%j) counts as deployed",
    (environment) => {
      expect(blocksIndexing(environment)).toBe(true);
      expect(withRobotsPolicy(page(), environment).headers.get("X-Robots-Tag")).toBe("noindex");
    },
  );

  it("local: no header", () => {
    expect(blocksIndexing("local")).toBe(false);
    const response = page();
    expect(withRobotsPolicy(response, "local")).toBe(response);
    expect(response.headers.has("X-Robots-Tag")).toBe(false);
  });
});

const TIZAYUCA: LocalityRef = { slug: "tizayuca", state: { slug: "hidalgo" } };
const OTHER: LocalityRef = { slug: "pueblo-uno", state: { slug: "estado-de-prueba-98" } };
const SITEMAP = "https://enmirumbo.example/sitemap.xml";

/** Whether a Disallow rule matches a path (RFC 9309: a prefix, where * is any text). */
function matches(rule: string, path: string): boolean {
  const [first = "", ...rest] = rule.split("*");
  if (!path.startsWith(first)) return false;
  let at = first.length;
  for (const part of rest) {
    const found = path.indexOf(part, at);
    if (found === -1) return false;
    at = found + part.length;
  }
  return true;
}

describe("The open robots.txt allows the public site and excludes what is not relevant (v2)", () => {
  // Scenarios: what is public can be crawled; the panel and the results stay
  // out; report routes; the sitemap is announced with an absolute URL
  it("excludes the panel and, for the active locality, the results, the report routes and the thank-you pages", () => {
    expect(openRobotsTxt([TIZAYUCA], SITEMAP)).toBe(
      [
        "User-agent: *",
        "Disallow: /admin",
        "Disallow: /hidalgo/tizayuca/buscar",
        "Disallow: /hidalgo/tizayuca/negocio/*/reportar",
        "Disallow: /hidalgo/tizayuca/reportar/gracias",
        "Disallow: /hidalgo/tizayuca/registro/gracias",
        "",
        `Sitemap: ${SITEMAP}`,
        "",
      ].join("\n"),
    );
  });

  // Scenario: public pages stay crawlable
  it("blocks no home, listing, trade page or card", () => {
    const disallowed = openRobotsTxt([TIZAYUCA, OTHER], SITEMAP)
      .split("\n")
      .filter((line) => line.startsWith("Disallow: "))
      .map((line) => line.slice("Disallow: ".length));
    const blocked = (path: string) => disallowed.some((rule) => matches(rule, path));
    for (const path of [
      "/",
      "/hidalgo/tizayuca",
      "/hidalgo/tizayuca/servicios-del-hogar",
      "/hidalgo/tizayuca/plomeria",
      "/hidalgo/tizayuca/plomeria-centro",
      "/hidalgo/tizayuca/negocio/plomeria-lopez-a1b2c3d4",
      "/hidalgo/tizayuca/registro",
      "/aviso-de-privacidad",
      "/terminos",
      "/estado-de-prueba-98/pueblo-uno",
    ]) {
      expect(blocked(path), path).toBe(false);
    }
    for (const path of [
      "/admin",
      "/admin/registros/1",
      "/hidalgo/tizayuca/buscar?q=plomero",
      "/hidalgo/tizayuca/negocio/plomeria-lopez-a1b2c3d4/reportar",
      "/estado-de-prueba-98/pueblo-uno/reportar/gracias",
      "/estado-de-prueba-98/pueblo-uno/registro/gracias",
    ]) {
      expect(blocked(path), path).toBe(true);
    }
  });

  // Scenario: secret routes are not announced
  it("never names the edit mode", () => {
    expect(openRobotsTxt([TIZAYUCA, OTHER], SITEMAP)).not.toContain("editar");
  });

  it("every active locality gets its exclusions, and no other", () => {
    const text = openRobotsTxt([TIZAYUCA, OTHER], SITEMAP);
    expect(text).toContain("Disallow: /estado-de-prueba-98/pueblo-uno/registro/gracias\n");
    expect(openRobotsTxt([OTHER], SITEMAP)).not.toContain("tizayuca");
    expect(openRobotsTxt([], SITEMAP)).toBe(
      `User-agent: *\nDisallow: /admin\n\nSitemap: ${SITEMAP}\n`,
    );
  });

  it("without a base for absolute URLs, the sitemap line is left out", () => {
    expect(openRobotsTxt([TIZAYUCA], null)).not.toContain("Sitemap");
    expect(openRobotsTxt([TIZAYUCA], null)).not.toContain("localhost");
  });
});
