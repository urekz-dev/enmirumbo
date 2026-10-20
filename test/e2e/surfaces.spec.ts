// Checks of docs/specs/base-layout.md that hold on every page of the site, run
// on every page reachable by links from the start pages and the sitemap, so a
// page added later is checked as soon as something links to it or the sitemap
// lists it: "Global layout with header and footer on every page", "Mobile-first
// design with no horizontal scroll", "Base accessibility from PRD §8", "Server
// Component with a document in es-MX and base metadata", "Phone number
// auto-detection is turned off (v2)" and "No surface of the site names the
// previous brand or attaches the locality to the name". The 390px checks run in
// the phone project of playwright.config.ts, with the viewport emulated, as the
// spec asks.
import type { Page } from "@playwright/test";
import { expect, test, TURNSTILE_ORIGIN } from "./turnstile.ts";
import { brandFindings } from "../brand-rules.ts";
import { collapseProblems } from "../responsive-rules.ts";

/**
 * Where the crawl starts: the root, which leads to the home of the locality
 * (or, with two, to the list of localities), the panel (never linked), a 404,
 * the states of the search results (only the search box's form leads to
 * them, and the crawl follows links), the thank-you pages of a report and of
 * a registration (only a received submission leads there), and every page of
 * the sitemap, so a page nothing links to yet is checked too, and the report
 * forms of its cards.
 */
const START = [
  "/",
  "/admin",
  "/no-existe",
  "/hidalgo/tizayuca/buscar",
  "/hidalgo/tizayuca/buscar?q=plomero",
  "/hidalgo/tizayuca/buscar?q=veterinario%20espacial",
  "/hidalgo/tizayuca/reportar/gracias?negocio=b5q68b2e72",
  "/hidalgo/tizayuca/registro/gracias",
];
/** Includes the editor linked by every panel card, with two localities. */
const MAX_PAGES = 200;

/** The paths of the sitemap. */
async function sitemapPaths(page: Page): Promise<string[]> {
  const xml = await (await page.request.get("/sitemap.xml")).text();
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, url = ""]) => new URL(url).pathname);
}

/** Every path reachable by links from START and the sitemap, after redirects. */
async function crawl(page: Page): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...START, ...(await sitemapPaths(page))];
  while (queue.length > 0 && seen.size < MAX_PAGES) {
    const path = queue.shift() ?? "/";
    const response = await page.request.get(path);
    const url = new URL(response.url());
    const landed = `${url.pathname}${url.search}`;
    if (seen.has(landed)) continue;
    seen.add(landed);
    if (!(response.headers()["content-type"] ?? "").startsWith("text/html")) continue;
    for (const [, href = ""] of (await response.text()).matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
      if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/_astro/")) continue;
      const next = href.split("#")[0] ?? href;
      if (!seen.has(next) && !queue.includes(next)) queue.push(next);
    }
  }
  return [...seen];
}

let pages: string[] = [];

test.beforeEach(async ({ page }) => {
  if (pages.length === 0) pages = await crawl(page);
});

test("the crawl reaches the start pages, the home, the legal pages, the listings, the cards, their reports and the registration", () => {
  expect(pages).toEqual(
    expect.arrayContaining([
      "/hidalgo/tizayuca",
      "/admin",
      "/admin/tareas",
      "/no-existe",
      "/hidalgo/tizayuca/buscar",
      "/hidalgo/tizayuca/buscar?q=plomero",
      "/hidalgo/tizayuca/buscar?q=veterinario%20espacial",
      "/aviso-de-privacidad",
      "/terminos",
      "/hidalgo/tizayuca/servicios-del-hogar",
      "/hidalgo/tizayuca/clubes-y-escuelas-deportivas",
      "/hidalgo/tizayuca/servicios-del-hogar?colonia=huicalco",
      "/hidalgo/tizayuca/plomeria",
      "/hidalgo/tizayuca/plomeria-huicalco",
      "/hidalgo/tizayuca/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72",
      "/hidalgo/tizayuca/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72/reportar",
      "/hidalgo/tizayuca/reportar/gracias?negocio=b5q68b2e72",
      "/hidalgo/tizayuca/registro",
      "/hidalgo/tizayuca/registro/gracias",
    ]),
  );
  expect(pages.length).toBeLessThan(MAX_PAGES);
});

test("every page is an es-MX document inside the layout, with its base metadata", async ({
  page,
}) => {
  for (const path of pages) {
    await page.goto(path);
    expect.soft(await page.locator("html").getAttribute("lang"), path).toBe("es-MX");
    await expect.soft(page.locator("meta[charset]"), path).toHaveAttribute("charset", "utf-8");
    await expect
      .soft(page.locator('meta[name="viewport"]'), path)
      .toHaveAttribute("content", "width=device-width, initial-scale=1");
    await expect
      .soft(page.locator('meta[name="format-detection"]'), path)
      .toHaveAttribute("content", "telephone=no");
    expect.soft(await page.title(), path).toMatch(/enmirumbo/);
    // Scenario: semantic structure
    for (const landmark of ["banner", "main", "contentinfo"] as const) {
      await expect.soft(page.getByRole(landmark), `${path} ${landmark}`).toHaveCount(1);
    }
    await expect.soft(page.locator("h1"), path).toHaveCount(1);
    // Scenario: header with the wordmark
    await expect
      .soft(page.getByRole("banner").getByRole("link", { name: "enmirumbo", exact: true }), path)
      .toBeVisible();
    // Scenario: footer with the legal links and no dead links (the crawl
    // follows them, so each one answers)
    const footer = page.getByRole("contentinfo");
    await expect
      .soft(footer.getByRole("link", { name: "Aviso de privacidad", exact: true }), path)
      .toHaveAttribute("href", "/aviso-de-privacidad");
    await expect
      .soft(footer.getByRole("link", { name: "Términos y condiciones", exact: true }), path)
      .toHaveAttribute("href", "/terminos");
    // Scenario: no client JS in the layout. Third-party scripts are not the
    // layout's (the analytics, docs/specs/base-layout.md), and a card's
    // Schema.org block is data, which no browser runs (public-directory,
    // "Directory in Server Components, mobile-first and usable without
    // JavaScript"). The registration form of a locality is the one page with
    // scripts of the site, two bundled files: the form's (business-
    // registration, "Registration works without client JavaScript": scenario
    // "JS limited to the example field") and its Turnstile widget's, which
    // adds Turnstile's api.js ("The registration and edit forms require
    // JavaScript for the anti-bot check and say so (v2)").
    const own = page.locator('script:not([src^="https://"]):not([type="application/ld+json"])');
    if (/^\/[^/]+\/[^/]+\/registro$/.test(new URL(page.url()).pathname)) {
      await expect.soft(own, path).toHaveCount(2);
      const sources = await own.evaluateAll((scripts) =>
        scripts.map((script) => `${script.getAttribute("type")} ${script.getAttribute("src")}`),
      );
      expect
        .soft(sources.sort(), path)
        .toEqual([
          expect.stringMatching(/^module \/_astro\/RegistrationForm\.[^/]*\.js$/),
          expect.stringMatching(/^module \/_astro\/TurnstileWidget\.[^/]*\.js$/),
        ]);
    } else if (/^\/admin\/registros\/[^/]+\/editar$/.test(new URL(page.url()).pathname)) {
      // The shared registration form's progressive enhancement only; no widget.
      await expect.soft(own, path).toHaveCount(1);
      await expect.soft(own, path).toHaveAttribute("type", "module");
      await expect
        .soft(own, path)
        .toHaveAttribute("src", /^\/_astro\/RegistrationForm\.[^/]*\.js$/);
    } else {
      await expect.soft(own, path).toHaveCount(0);
    }
  }
});

// Scenarios: touch areas; the footer links can be tapped on a phone
test("every tappable element of the header and the footer measures at least 44px", async ({
  page,
}) => {
  for (const path of pages) {
    await page.goto(path);
    const tappable = page.locator(
      "header :is(a, button, input, select, textarea, summary), footer :is(a, button, input, select, textarea, summary)",
    );
    for (const element of await tappable.all()) {
      const box = await element.boundingBox();
      const label = `${path} "${await element.innerText()}"`;
      expect.soft(box, label).not.toBeNull();
      if (box) expect.soft(Math.min(box.width, box.height), label).toBeGreaterThanOrEqual(44);
    }
  }
});

// Scenarios: phone at 390px; width measurement does not depend on the window size
test("no page scrolls sideways on a 390px phone", async ({ page }) => {
  expect(page.viewportSize()?.width).toBe(390);
  for (const path of pages) {
    await page.goto(path);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect.soft(clientWidth, path).toBe(390);
    expect.soft(scrollWidth, path).toBeLessThanOrEqual(clientWidth);
  }
});

// Scenario: desktop adaptation
for (const width of [768, 1280]) {
  test(`at ${width}px every page keeps a centred maximum width with no horizontal scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of pages) {
      await page.goto(path);
      const layout = await page.evaluate(() => {
        const main = document.querySelector("main")?.getBoundingClientRect();
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          left: main?.left ?? 0,
          right: document.documentElement.clientWidth - (main?.right ?? 0),
          width: main?.width ?? 0,
        };
      });
      expect.soft(layout.scrollWidth, path).toBeLessThanOrEqual(layout.clientWidth);
      expect.soft(layout.width, path).toBeLessThanOrEqual(768);
      expect.soft(Math.abs(layout.left - layout.right), path).toBeLessThanOrEqual(1);
    }
  });
}

// Scenario: no public screen blocks responsive collapse
test("no served page uses a class that blocks the responsive collapse", async ({ page }) => {
  for (const path of pages) {
    await page.goto(path);
    const lists = await page
      .locator("[class]")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("class") ?? ""));
    expect.soft(lists.flatMap(collapseProblems), path).toEqual([]);
  }
});

// Scenarios: a new literal brings the old brand; someone attaches the locality
// to the brand again; the wordmark and the title are lowercase; no old
// spelling on any surface
test("no page names the previous brand, spells the brand otherwise or attaches a place to it", async ({
  page,
}) => {
  for (const path of pages) {
    await page.goto(path);
    const metadata = await page
      .locator('meta[name="description"], meta[property^="og:"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("content") ?? ""));
    const text = [await page.title(), ...metadata, await page.locator("body").innerText()].join(
      "\n",
    );
    expect.soft(brandFindings(text), path).toEqual([]);
    expect.soft(brandFindings(await page.content()), path).toEqual([]);
  }
});

// Palette and typography: the system font stack, so no page downloads a font
// or asks anything of another origin, but the registration form, which asks
// Turnstile for its script (here, the local fake of ./turnstile.ts).
test("every page uses the system font and requests nothing outside the site", async ({ page }) => {
  const outside: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return;
    const from = new URL(page.url()).pathname;
    const turnstile = url.href.startsWith(`${TURNSTILE_ORIGIN}/turnstile/v0/api.js?`);
    if (turnstile && /^\/[^/]+\/[^/]+\/registro$/.test(from)) return;
    outside.push(`${from} ${request.url()}`);
  });
  for (const path of pages) {
    await page.goto(path);
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect.soft(font, path).toMatch(/^system-ui,/);
  }
  expect(outside).toEqual([]);
});
