// Scenarios of docs/specs/base-layout.md on the built site, served by `astro
// preview` with the local vars of wrangler.jsonc (SITE_URL
// http://localhost:4321): "The sitemap lists the pages that exist, from the
// database (v2)", "The sitemap includes the two legal pages (v2)", "Every page
// declares its title, description, canonical and share preview (v2)" and
// "Each locality has its own share image, one static image per locality
// (v2)"; and docs/specs/public-directory.md, "The card looks good when shared
// over WhatsApp or Facebook". It runs with Tizayuca alone and again with a second, fictitious
// locality (playwright.config.ts), so every active locality is checked. The
// sitemap's URLs carry SITE_URL's origin, while the server under test may
// listen on another port (E2E_PORT), so each URL is requested by its path.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { cardPath } from "../../src/core/business/card-path.ts";
import { FAKE_BUSINESSES } from "../../src/core/db/seed/businesses.ts";

const SITE_URL = "http://localhost:4321";

/** The <loc> URLs of the sitemap. */
async function sitemapUrls(request: APIRequestContext): Promise<string[]> {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/xml; charset=utf-8");
  const xml = await response.text();
  expect(xml).toMatch(
    /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/,
  );
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, url]) => url ?? "");
}

const pathOf = (url: string) => new URL(url).pathname;

/** Whether a share image is a card's photo, which the local Worker serves under /_media/photos/. */
const isPhoto = (url: string) => url.startsWith(`${SITE_URL}/_media/photos/`);

test.describe("The sitemap lists the pages that exist, from the database (v2)", () => {
  test("every URL is absolute, from SITE_URL, and answers 200 without a redirect", async ({
    request,
  }) => {
    const urls = await sitemapUrls(request);

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith(`${SITE_URL}/`), url).toBe(true);
      const response = await request.get(pathOf(url), { maxRedirects: 0 });
      expect.soft(response.status(), url).toBe(200);
    }
  });

  test("it lists the home of the active locality and the two legal pages, once each", async ({
    request,
  }) => {
    const paths = (await sitemapUrls(request)).map(pathOf);

    for (const path of ["/hidalgo/tizayuca", "/aviso-de-privacidad", "/terminos"]) {
      expect(
        paths.filter((listed) => listed === path),
        path,
      ).toHaveLength(1);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });

  // Scenarios: card date; nothing that is not a public page
  test("it lists every published card of Tizayuca at its current URL with its publication date, and no other card", async ({
    request,
  }) => {
    const tizayuca = { slug: "tizayuca", state: { slug: "hidalgo" } };
    const published = FAKE_BUSINESSES.filter(({ status }) => status === "published");
    const xml = await (await request.get("/sitemap.xml")).text();
    const cards = [
      ...xml.matchAll(
        /<url><loc>([^<]*\/negocio\/[^<]*)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?<\/url>/g,
      ),
    ].map(([, url = "", lastmod]) => ({ path: pathOf(url), lastmod }));

    expect(published.length).toBeGreaterThan(5);
    expect(cards.map(({ path }) => path).toSorted()).toEqual(
      published.map((fake) => cardPath(tizayuca, fake)).toSorted(),
    );
    for (const { path, lastmod } of cards) expect(lastmod, path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // Scenario: no private or search pages
  test("it lists no panel, search, report, thank-you or edit page", async ({ request }) => {
    for (const path of (await sitemapUrls(request)).map(pathOf)) {
      expect(path).not.toMatch(/^\/admin|\/buscar|\/reportar|\/gracias|\/editar/);
    }
  });
});

test.describe("Every page declares its title, description, canonical and share preview (v2)", () => {
  test("every page of the sitemap declares itself as canonical, with its share preview", async ({
    page,
    request,
  }) => {
    for (const url of await sitemapUrls(request)) {
      await page.goto(pathOf(url));
      await expect.soft(page.locator('link[rel="canonical"]'), url).toHaveAttribute("href", url);
      await expect
        .soft(page.locator('meta[property="og:url"]'), url)
        .toHaveAttribute("content", url);
      expect.soft(await page.title(), url).toMatch(/enmirumbo/);
      await expect
        .soft(page.locator('meta[property="og:title"]'), url)
        .toHaveAttribute("content", await page.title());
      const description = page.locator('meta[name="description"]');
      if ((await description.count()) > 0) {
        await expect
          .soft(page.locator('meta[property="og:description"]'), url)
          .toHaveAttribute("content", (await description.getAttribute("content")) ?? "");
      }
      // A card with a photo shares its photo (public-directory, "The card looks
      // good when shared over WhatsApp or Facebook"); every other page, the
      // image of its locality.
      const photo = isPhoto(
        (await page.locator('meta[property="og:image"]').getAttribute("content")) ?? "",
      );
      await expect
        .soft(page.locator('meta[property="og:image:width"]'), url)
        .toHaveAttribute("content", "1200");
      await expect
        .soft(page.locator('meta[property="og:image:height"]'), url)
        .toHaveAttribute("content", photo ? "900" : "630");
      await expect
        .soft(page.locator('meta[property="og:image:alt"]'), url)
        .toHaveAttribute("content", photo ? /^Foto de / : /^enmirumbo/);
    }
  });

  test("every share image is absolute, from SITE_URL, and is served as a PNG, or a card's photo as WebP", async ({
    page,
    request,
  }) => {
    const images = new Set<string>();
    for (const url of await sitemapUrls(request)) {
      await page.goto(pathOf(url));
      images.add((await page.locator('meta[property="og:image"]').getAttribute("content")) ?? "");
    }
    for (const image of images) {
      expect(image.startsWith(`${SITE_URL}/`), image).toBe(true);
      const response = await request.get(pathOf(image));
      expect.soft(response.status(), image).toBe(200);
      expect
        .soft(response.headers()["content-type"], image)
        .toBe(isPhoto(image) ? "image/webp" : "image/png");
    }
    // The seed's cards with a photo share it.
    expect([...images].some(isPhoto)).toBe(true);
  });

  test("the home of Tizayuca shares its own image, and a page outside a locality the generic one", async ({
    page,
  }) => {
    await page.goto("/hidalgo/tizayuca");
    const own = await page.locator('meta[property="og:image"]').getAttribute("content");
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
      "content",
      "enmirumbo, el directorio de negocios de Tizayuca, Hidalgo",
    );

    await page.goto("/terminos");
    const generic = await page.locator('meta[property="og:image"]').getAttribute("content");
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
      "content",
      "enmirumbo",
    );
    expect(own).not.toBe(generic);
  });

  test("a 404 declares no canonical", async ({ page }) => {
    await page.goto("/no-existe");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await page.goto("/hidalgo/tizayuca/no-existe");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });
});
