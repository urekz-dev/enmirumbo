// Scenarios of docs/specs/base-layout.md, "Internal links to existing routes
// and protected external links", and docs/specs/public-directory.md, "Public
// URLs carry the state and the municipality (v2)", scenario "links keep the
// prefix", on the rendered site: starting at `/` (the home of the seeded
// locality), at a page that does not exist and at every page of the sitemap
// (so a page that nothing links to yet is visited too), it follows every
// internal link and form destination of the public pages, such as the home's
// search box, and checks that each one answers, that the links of a page of a
// locality keep its prefix, and that links that open a new tab carry
// `rel="noopener noreferrer"`. The panel is left out: no public page links to
// it. test/scripts/internal-links.test.ts checks the links written literally
// in the source.
import { expect, test } from "@playwright/test";
import { routePath, staticRoutes } from "../site-routes.ts";

/** Enough for every page the seeded directory links to. */
const MAX_PAGES = 200;
// Cloudflare Access owns this same-host endpoint; it is not an Astro page.
const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

/** The `/{estado}/{municipio}` of a page of a locality, or null for the site's own pages. */
function localityPrefix(path: string, routes: Set<string>): string | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2 || routes.has(routePath(path))) return null;
  return `/${segments[0]}/${segments[1]}`;
}

test("every internal link and form of the public pages leads to a page that exists", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://localhost:4321").origin;
  const routes = staticRoutes();
  // A page that does not exist is visited too, for the links of the 404 page.
  const missing = "/no-existe-esta-pagina";
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(
    ([, url = ""]) => new URL(url).pathname,
  );
  const queue = ["/", missing, ...listed];
  const visited = new Set<string>();
  const problems: string[] = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const path = queue.shift() ?? "/";
    if (visited.has(path)) continue;
    visited.add(path);

    const status = (await page.goto(path))?.status() ?? 0;
    if (status >= 400 && path !== missing) {
      problems.push(`${path} answers ${status}`);
      continue;
    }
    const here = new URL(page.url()).pathname;
    const prefix = localityPrefix(here, routes);

    const links = await page.locator("a[href]").evaluateAll((anchors) =>
      anchors.map((a) => ({
        href: (a as HTMLAnchorElement).href,
        target: a.getAttribute("target") ?? "",
        rel: a.getAttribute("rel") ?? "",
      })),
    );
    const forms = await page
      .locator("form")
      .evaluateAll((all) => all.map((form) => (form as HTMLFormElement).action));

    const internal: string[] = [];
    for (const link of links) {
      const url = new URL(link.href);
      // Do not crawl the Cloudflare Access logout endpoint as an Astro route.
      if (url.pathname === ACCESS_LOGOUT_PATH) {
        continue;
      } else if (url.protocol === "tel:") {
        if (link.target) problems.push(`${here}: the call link ${link.href} opens a new tab`);
      } else if (url.origin !== origin) {
        const rel = link.rel.split(/\s+/);
        if (link.target === "_blank" && !(rel.includes("noopener") && rel.includes("noreferrer"))) {
          problems.push(`${here}: ${link.href} opens a new tab without rel="noopener noreferrer"`);
        }
      } else {
        internal.push(url.pathname + url.search);
      }
    }
    for (const action of forms) {
      const url = new URL(action);
      if (url.origin === origin) internal.push(url.pathname);
    }

    for (const target of internal) {
      const targetPath = routePath(target);
      if (prefix && !routes.has(targetPath) && !`${targetPath}/`.startsWith(`${prefix}/`)) {
        problems.push(`${here}: the link to ${target} does not keep the prefix ${prefix}`);
      }
      if (!targetPath.startsWith("/admin")) queue.push(target);
    }
  }

  expect(visited.size).toBeGreaterThan(1);
  expect(problems).toEqual([]);
});
