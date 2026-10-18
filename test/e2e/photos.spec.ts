// Scenarios of docs/specs/public-directory.md about the photos, on the built
// site with the seed's photos in the local media bucket (the global setup
// writes them, scripts/seed-media.ts, and the local Worker serves them under
// /_media/, src/lib/media.ts): "The listing card brings the essentials and
// WhatsApp without extra taps" (card content; the photo is announced with the
// business name; the layout does not jump), "The card shows the business photo
// when it has one", "Photo weight does not break the 4G budget", "The card
// looks good when shared over WhatsApp or Facebook", "Each published card
// emits Schema.org LocalBusiness" and "The photo of an unpublished business is
// referenced on no public surface (v2)"; and docs/specs/data-model.md, "The
// demo seed leaves cards with a photo to see the directory as the resident
// will see it". In the seed, "Salud" lists the farmacia (photo), the
// veterinaria (no photo) and the dentista (photo), newest first.
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { businesses, categories } from "../../src/core/db/schema/index.ts";
import { FAKE_BUSINESSES } from "../../src/core/db/seed/businesses.ts";
import {
  PHOTO_CACHE_CONTROL,
  PHOTO_VARIANTS,
  photoObjectKey,
  photoObjectKeys,
} from "../../src/core/photos/photo.ts";
import { withDatabase } from "./database.ts";

const HOME = "/hidalgo/tizayuca";
const SITE_URL = "http://localhost:4321";

const PHARMACY = "Farmacia La Pastilla de Mentiras";
const VET = "Veterinaria Patitas Ficticias";
const DENTIST = "Dentista Sonrisa de Mentiras";

/** The photo key of the seeded business `name`. */
function photoKeyOf(name: string): string {
  const key = FAKE_BUSINESSES.find((business) => business.name === name)?.photoKey;
  if (key === undefined) throw new Error(`e2e: the seed gives ${name} no photo`);
  return key;
}
const pharmacy = () => ({ photoKey: photoKeyOf(PHARMACY) });
const dentist = () => ({ photoKey: photoKeyOf(DENTIST) });
const PHARMACY_CARD = `${HOME}/negocio/farmacia-la-pastilla-de-mentiras-rq7ka9z3yd`;
const VET_CARD = `${HOME}/negocio/veterinaria-patitas-ficticias-5dncvpyj8k`;

/** The photo of the listing card named `name`, or its placeholder. */
function cardOf(page: Page, name: string) {
  return page.getByRole("main").getByRole("listitem").filter({ hasText: name });
}

/** Every image the page requested, by path. */
function imageRequests(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image") paths.push(new URL(request.url()).pathname);
  });
  return paths;
}

test.describe("The listing card brings the essentials and WhatsApp without extra taps: the photo", () => {
  // Scenarios: card content; the photo is announced with the business name
  test("a listing with photos and without: photo, placeholder, photo, each in its square", async ({
    page,
  }) => {
    await page.goto(`${HOME}/salud`);

    const first = cardOf(page, PHARMACY).getByRole("img", { name: `Foto de ${PHARMACY}` });
    await expect(first).toHaveAttribute(
      "src",
      `/_media/${photoObjectKey(pharmacy().photoKey, "card")}`,
    );
    await expect(first).toHaveAttribute("width", "400");
    await expect(first).toHaveAttribute("height", "400");
    // The image the seed drew, decoded by the browser.
    await expect
      .poll(() => first.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(PHOTO_VARIANTS.card.width);

    await expect(cardOf(page, VET).getByTestId("photo-placeholder")).toHaveCount(1);
    await expect(cardOf(page, VET).locator("img")).toHaveCount(0);
    await expect(
      cardOf(page, DENTIST).getByRole("img", { name: `Foto de ${DENTIST}` }),
    ).toHaveAttribute("src", `/_media/${photoObjectKey(dentist().photoKey, "card")}`);

    // Scenario: the layout does not jump. The photo fills the same square slot
    // as the placeholder.
    const box = async (name: string, inner: string) =>
      cardOf(page, name).locator(inner).first().boundingBox();
    const photo = await box(PHARMACY, "img");
    const placeholder = await box(VET, '[data-testid="photo-placeholder"]');
    expect(photo?.width).toBe(placeholder?.width);
    expect(photo?.height).toBe(placeholder?.height);
    expect(photo?.width).toBe(photo?.height);
  });
});

test.describe("Photo weight does not break the 4G budget", () => {
  // Scenario: the listing does not download what is not seen
  test("only the first row loads its photo at once; the rest load lazily", async ({ page }) => {
    await page.goto(`${HOME}/salud`);

    await expect(cardOf(page, PHARMACY).locator("img")).toHaveAttribute("loading", "eager");
    await expect(cardOf(page, DENTIST).locator("img")).toHaveAttribute("loading", "lazy");
  });

  // Scenario: the card does not use the large photo
  test("a listing and a results page request only the listing card's variant", async ({ page }) => {
    const requested = imageRequests(page);
    for (const path of [`${HOME}/salud`, `${HOME}/buscar?q=farmacia`, `${HOME}/buscar?q=sonrisa`]) {
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForLoadState("networkidle");
    }

    const photos = requested.filter((path) => path.startsWith("/_media/"));
    expect(photos.length).toBeGreaterThan(0);
    expect(
      photos.every((path) => path.endsWith("/card.webp")),
      photos.join("\n"),
    ).toBe(true);
  });

  // Scenario: weight of the variants (the seed's; the registration's are
  // tested where it compresses them)
  test("every seeded variant is a WebP within its cap, cached for a year", async ({ request }) => {
    for (const { photoKey } of FAKE_BUSINESSES.filter((fake) => fake.photoKey !== undefined)) {
      for (const variant of ["card", "full"] as const) {
        const response = await request.get(`/_media/${photoObjectKey(photoKey!, variant)}`);
        expect(response.status()).toBe(200);
        expect(response.headers()["content-type"]).toBe("image/webp");
        expect(response.headers()["cache-control"]).toBe(PHOTO_CACHE_CONTROL);
        expect((await response.body()).length).toBeLessThanOrEqual(
          PHOTO_VARIANTS[variant].maxBytes,
        );
      }
    }
  });
});

test.describe("The card shows the business photo when it has one", () => {
  // Scenario: card with a photo; and "The card looks good when shared over
  // WhatsApp or Facebook" and "Each published card emits Schema.org
  // LocalBusiness" with a photo
  test("a card with a photo shows its full variant, shares it and names it in its data", async ({
    page,
  }) => {
    const requested = imageRequests(page);
    await page.goto(PHARMACY_CARD);
    const full = `/_media/${photoObjectKey(pharmacy().photoKey, "full")}`;

    const image = page.getByRole("img", { name: `Foto de ${PHARMACY}` });
    await expect(image).toHaveAttribute("src", full);
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBe(PHOTO_VARIANTS.full.width);
    // Larger than on the listing card.
    const { width } = (await image.boundingBox())!;
    expect(width).toBeGreaterThan(80);

    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      `${SITE_URL}${full}`,
    );
    await expect(page.locator('meta[property="og:image:type"]')).toHaveAttribute(
      "content",
      "image/webp",
    );
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      "content",
      "1200",
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      "content",
      "900",
    );
    const data = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
    ) as { image?: string[] };
    expect(data.image).toEqual([`${SITE_URL}${full}`]);
    expect(requested.filter((path) => path.startsWith("/_media/"))).toEqual([full]);
  });

  // Scenario: card without a photo
  test("a card without a photo has no image, shares its locality's image and names none", async ({
    page,
  }) => {
    await page.goto(VET_CARD);

    await expect(page.getByRole("main").locator("img")).toHaveCount(0);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      /\/_astro\/.*tizayuca.*\.png$/,
    );
    const data = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
    ) as { image?: string[] };
    expect(data.image).toBeUndefined();
  });
});

test.describe("The photo of an unpublished business is referenced on no public surface (v2)", () => {
  // A registration in review with a photo, which the test adds and removes.
  const REVIEW = { id: "zz35zz35zz", photoKey: "zz35zz35zz35zz35zz35zz35" } as const;

  test.beforeAll(async () => {
    await withDatabase(async (db) => {
      const [category] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, "salud"));
      await db
        .insert(businesses)
        .values({
          id: REVIEW.id,
          localityCode: "13069",
          name: "Farmacia En Revisión de Mentiras",
          categoryId: category!.id,
          whatsapp: "7719990135",
          zoneOther: "Colonia de mentiras",
          whatYouOffer: "Medicamentos de mentiras",
          consentedToNoticeAt: new Date(),
          photoKey: REVIEW.photoKey,
        })
        .onConflictDoNothing();
    });
  });

  test.afterAll(async () => {
    await withDatabase(async (db) => {
      await db.delete(businesses).where(eq(businesses.id, REVIEW.id));
    });
  });

  // Scenarios: a published card; a registration in review
  test("its key is in no page, sitemap, preview or structured data; a published card's is", async ({
    request,
  }) => {
    const pages = [
      HOME,
      `${HOME}/salud`,
      `${HOME}/farmacia`,
      `${HOME}/buscar?q=farmacia`,
      `${HOME}/negocio/farmacia-en-revision-de-mentiras-${REVIEW.id}`,
      PHARMACY_CARD,
      "/sitemap.xml",
      "/robots.txt",
    ];
    const bodies = await Promise.all(pages.map(async (path) => (await request.get(path)).text()));

    for (const [index, body] of bodies.entries()) {
      expect(body, pages[index]).not.toContain(REVIEW.photoKey);
      expect(body, pages[index]).not.toContain("En Revisión de Mentiras");
    }
    expect(bodies.join("\n")).toContain(pharmacy().photoKey);
  });

  // Scenario: the bucket does not list
  test("the root of the media and any prefix list nothing", async ({ request }) => {
    for (const path of [
      "/_media",
      "/_media/",
      "/_media/photos/",
      `/_media/photos/${pharmacy().photoKey}/`,
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(await response.text()).not.toContain("card.webp");
    }
    for (const key of photoObjectKeys(REVIEW.photoKey)) {
      expect((await request.get(`/_media/${key}`)).status()).toBe(404);
    }
  });
});
