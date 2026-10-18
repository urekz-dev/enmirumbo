// Scenarios of docs/specs/data-model.md about the fictitious seed
// (src/core/db/seed), its photos included, which are written here to the
// local media bucket of the tests. Each test seeds inside a transaction that is rolled
// back, so the shared test database keeps Tizayuca as the migrations leave it
// (locality.test.ts checks it) while the other files run. The runner's
// refusals are in test/scripts/db-seed.test.ts.
import { env } from "cloudflare:workers";
import { count, eq, inArray, lt, TransactionRollbackError } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { BUSINESS_ID_PATTERN } from "../../src/core/business/id.ts";
import {
  businesses,
  businessTrades,
  categories,
  localities,
  trades,
  zones,
} from "../../src/core/db/schema/index.ts";
import { FAKE_BUSINESSES } from "../../src/core/db/seed/businesses.ts";
import {
  SEED_CONTACT_WHATSAPP,
  SEED_EARLIER_NOTICE_VERSION,
  SEED_LOCALITY_CODE,
  SEED_NOTICE_VERSION,
  type SeedDb,
  seed,
  seedSummary,
} from "../../src/core/db/seed/index.ts";
import { NOTICE_VERSION } from "../../src/core/legal/version.ts";
import { seedPhotoObjects, writeSeedPhotos } from "../../src/core/db/seed/photos.ts";
import {
  isPhotoKey,
  PHOTO_CACHE_CONTROL,
  PHOTO_CONTENT_TYPE,
  PHOTO_VARIANTS,
  photoObjectKey,
  photoObjectKeys,
} from "../../src/core/photos/photo.ts";
import { normalizeText, searchTerms } from "../../src/core/search/normalize.ts";
import { db, FIRST_FIXTURE_CODE } from "./fixtures.ts";

const NOW = new Date("2026-10-14T18:00:00.000Z");

/** The fake businesses with a photo, as the seed reports them. */
const SEEDED_PHOTOS = FAKE_BUSINESSES.flatMap(({ name, photoKey }, shade) =>
  photoKey === undefined ? [] : [{ name, photoKey, shade }],
);

/** Runs `run` in a transaction that is always rolled back, and returns its result. */
async function rolledBack<T>(run: (tx: SeedDb) => Promise<T>): Promise<T> {
  let result: { value: T } | undefined;
  try {
    await db((client) =>
      client.transaction(async (tx) => {
        result = { value: await run(tx) };
        tx.rollback();
      }),
    );
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  if (!result) throw new Error("rolledBack: the transaction gave no result");
  return result.value;
}

/** The seeded locality's businesses, with the slugs of their category, zone and trades. */
async function seeded(tx: SeedDb) {
  const rows = await tx
    .select({
      business: businesses,
      category: categories.slug,
      zone: zones.slug,
    })
    .from(businesses)
    .innerJoin(categories, eq(categories.id, businesses.categoryId))
    .leftJoin(zones, eq(zones.id, businesses.zoneId))
    .where(eq(businesses.localityCode, SEED_LOCALITY_CODE))
    .orderBy(businesses.id);
  const links = await tx
    .select({ businessId: businessTrades.businessId, name: trades.name, slug: trades.slug })
    .from(businessTrades)
    .innerJoin(trades, eq(trades.id, businessTrades.tradeId))
    .innerJoin(businesses, eq(businesses.id, businessTrades.businessId))
    .where(eq(businesses.localityCode, SEED_LOCALITY_CODE))
    .orderBy(businessTrades.businessId, trades.slug);
  return rows.map(({ business, category, zone }) => ({
    ...business,
    category,
    zone,
    trades: links.filter(({ businessId }) => businessId === business.id),
  }));
}

type Seeded = Awaited<ReturnType<typeof seeded>>[number];

/** Seeds, then reads what the seed left. */
async function seedThenRead(tx: SeedDb) {
  await seed(tx, NOW);
  return seeded(tx);
}

const contactOf = async (tx: SeedDb) =>
  (
    await tx
      .select({ contactWhatsapp: localities.contactWhatsapp, active: localities.active })
      .from(localities)
      .where(eq(localities.code, SEED_LOCALITY_CODE))
  )[0];

const OPTIONAL = [
  "whatYouOffer",
  "landline",
  "address",
  "latitude",
  "longitude",
  "openingHours",
  "facebookUrl",
] as const;

const allOptional = (b: Seeded) => b.homeDelivery && OPTIONAL.every((field) => b[field] !== null);
const onlyRequired = (b: Seeded) => !b.homeDelivery && OPTIONAL.every((field) => b[field] === null);
const published = (rows: Seeded[]) => rows.filter(({ status }) => status === "published");

describe("Seed of fictitious businesses for development (v2)", () => {
  it("the migrations create no business", async () => {
    // Fixture localities of other test files are in states above INEGI's 32.
    const [row] = await db((tx) =>
      tx
        .select({ n: count() })
        .from(businesses)
        .where(lt(businesses.localityCode, FIRST_FIXTURE_CODE)),
    );
    expect(row?.n).toBe(0);
  });

  it("seeding fictitious businesses covers the cases of the directory", async () => {
    const { report, rows } = await rolledBack(async (tx) => ({
      report: await seed(tx, NOW),
      rows: await seeded(tx),
    }));

    expect(report).toEqual({
      locality: "Tizayuca",
      inserted: FAKE_BUSINESSES.length,
      alreadyThere: 0,
      activated: true,
      photos: SEEDED_PHOTOS,
    });
    expect(rows).toHaveLength(FAKE_BUSINESSES.length);

    const live = published(rows);
    const liveCategories = new Set(live.map(({ category }) => category));
    expect(liveCategories.size).toBeGreaterThanOrEqual(2);
    expect(liveCategories).toContain("clubes-y-escuelas-deportivas");
    expect(new Set(live.map(({ zone }) => zone).filter(Boolean)).size).toBeGreaterThanOrEqual(2);
    expect(live.some(({ homeDelivery }) => homeDelivery)).toBe(true);
    expect(live.some(({ homeDelivery }) => !homeDelivery)).toBe(true);
    expect(live.some(allOptional)).toBe(true);
    expect(live.some(onlyRequired)).toBe(true);
    expect(
      live.filter(({ zoneId, zoneOther }) => zoneId === null && zoneOther !== null),
    ).toHaveLength(1);
    for (const b of live) {
      expect(b.publishedAt).not.toBeNull();
      expect(b.publishedAt!.getTime()).toBeGreaterThanOrEqual(b.registeredAt.getTime());
    }

    const inReview = rows.filter(({ status }) => status === "in_review");
    expect(inReview).toHaveLength(1);
    expect(inReview[0]).toMatchObject({ publishedAt: null, rejectedAt: null, origin: "organic" });

    const rejected = rows.filter(({ status }) => status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.publishedAt).toBeNull();
    expect(rejected[0]?.trades).toEqual([]);
  });

  it("fixtures for the search by trade", async () => {
    const live = published(await rolledBack(seedThenRead));
    expect(live.some(({ trades }) => trades.length > 0)).toBe(true);
    // A trade that the search cannot reach through the name or "¿Qué ofreces?":
    // none of the stems it searches for is in them.
    const hidden = live.filter(({ trades, nameNormalized, whatYouOfferNormalized }) =>
      trades.some(({ name }) =>
        searchTerms(name, "").every(
          (stem) => !`${nameNormalized} ${whatYouOfferNormalized}`.includes(stem),
        ),
      ),
    );
    expect(hidden.map(({ name }) => name)).toEqual(["Cocina Doña Chela de Mentiras"]);
  });

  it("fixtures with accents, normalized without them", async () => {
    const live = published(await rolledBack(seedThenRead));
    const accented = live.filter(({ whatYouOffer }) => /[áéíóúüñ]/i.test(whatYouOffer ?? ""));
    expect(accented.map(({ name }) => name)).toContain("Academia Halcones de Mentiras");
    for (const b of accented) {
      expect(b.whatYouOfferNormalized).toBe(normalizeText(b.whatYouOffer!));
      expect(b.whatYouOfferNormalized).not.toMatch(/[^a-z0-9 ]/);
      expect(b.nameNormalized).toBe(normalizeText(b.name));
    }
  });

  it("idempotent seed: a second run changes nothing and repeats no trade", async () => {
    const { first, second, before, after } = await rolledBack(async (tx) => {
      const first = await seed(tx, NOW);
      const before = await seeded(tx);
      // A later run, as on the next deploy.
      const second = await seed(tx, new Date(NOW.getTime() + 86_400_000));
      return { first, second, before, after: await seeded(tx) };
    });
    expect(first.inserted).toBe(FAKE_BUSINESSES.length);
    expect(second).toEqual({
      locality: "Tizayuca",
      inserted: 0,
      alreadyThere: FAKE_BUSINESSES.length,
      activated: false,
      // The rows still name their photos, so the caller writes them again.
      photos: SEEDED_PHOTOS,
    });
    expect(after).toEqual(before);
    const links = after.flatMap(({ id, trades }) => trades.map(({ slug }) => `${id} ${slug}`));
    expect(new Set(links).size).toBe(links.length);
    expect(links.length).toBe(
      FAKE_BUSINESSES.reduce((total, fake) => total + (fake.trades?.length ?? 0), 0),
    );
  });

  it("fictitious data and nothing real", async () => {
    const { rows, contact } = await rolledBack(async (tx) => {
      await seed(tx, NOW);
      return { rows: await seeded(tx), contact: await contactOf(tx) };
    });
    const numbers = [
      contact?.contactWhatsapp,
      ...rows.flatMap(({ whatsapp, landline }) => [whatsapp, landline]),
    ].filter((n) => n !== null);
    expect(numbers.length).toBeGreaterThan(rows.length);
    for (const number of numbers) expect(number).toMatch(/^771999[0-9]{4}$/);
    // Every name says it is made up.
    for (const { name } of rows) {
      expect(name).toMatch(/Fictici|Inventad|Mentira|Imaginari|Fantasma/);
    }
    for (const { id } of rows) expect(id).toMatch(new RegExp(BUSINESS_ID_PATTERN));
    // A photo key, when there is one, is one the server would generate.
    for (const { photoKey } of rows) if (photoKey !== null) expect(isPhotoKey(photoKey)).toBe(true);
  });

  it("a business that is already there", async () => {
    // Someone registered in the locality with the number of a fake business.
    const own = {
      id: "zzzzzzzzzz",
      localityCode: SEED_LOCALITY_CODE,
      name: "Registro de prueba hecho a mano",
      whatsapp: FAKE_BUSINESSES[0]!.whatsapp,
      zoneOther: "Una colonia de prueba",
      consentedToNoticeAt: NOW,
      consentedToNoticeVersion: SEED_NOTICE_VERSION,
    };
    const { report, row, links } = await rolledBack(async (tx) => {
      const [category] = await tx.select({ id: categories.id }).from(categories).limit(1);
      await tx.insert(businesses).values({ ...own, categoryId: category!.id });
      const report = await seed(tx, NOW);
      const [row] = await tx.select().from(businesses).where(eq(businesses.id, own.id));
      const links = await tx
        .select({ n: count() })
        .from(businessTrades)
        .where(inArray(businessTrades.businessId, [own.id, FAKE_BUSINESSES[0]!.id]));
      return { report, row, links };
    });
    expect(report.inserted).toBe(FAKE_BUSINESSES.length - 1);
    expect(report.alreadyThere).toBe(1);
    expect(report.photos).toEqual(SEEDED_PHOTOS);
    expect(row).toMatchObject({ name: own.name, zoneOther: own.zoneOther, status: "in_review" });
    expect(links[0]?.n).toBe(0);
  });

  it("fictitious data and nothing real: the output warns that the data is fake", () => {
    const lines = seedSummary({
      locality: "Pueblo Uno",
      inserted: 12,
      alreadyThere: 0,
      activated: true,
      photos: [],
    });
    expect(lines.join("\n")).toContain("FAKE DATA");
    expect(lines.join("\n")).toContain("771999xxxx");
    expect(lines.join("\n")).toContain(
      `Pueblo Uno activated with the fictitious contact WhatsApp ${SEED_CONTACT_WHATSAPP}`,
    );
    expect(
      seedSummary({
        locality: "Pueblo Uno",
        inserted: 0,
        alreadyThere: 12,
        activated: false,
        photos: [],
      }),
    ).toContain("db:seed: Pueblo Uno keeps its contact WhatsApp and its active flag.");
  });

  it("activating Tizayuca", async () => {
    const { before, report, after } = await rolledBack(async (tx) => {
      const before = await contactOf(tx);
      const report = await seed(tx, NOW);
      return { before, report, after: await contactOf(tx) };
    });
    expect(before).toEqual({ contactWhatsapp: null, active: false });
    expect(report.activated).toBe(true);
    expect(after).toEqual({ contactWhatsapp: SEED_CONTACT_WHATSAPP, active: true });
  });

  it.each([false, true])(
    "a contact WhatsApp someone set, with the active flag %s",
    async (active) => {
      const { report, after } = await rolledBack(async (tx) => {
        await tx
          .update(localities)
          .set({ contactWhatsapp: "7719990199", active })
          .where(eq(localities.code, SEED_LOCALITY_CODE));
        const report = await seed(tx, NOW);
        return { report, after: await contactOf(tx) };
      });
      expect(report.activated).toBe(false);
      expect(after).toEqual({ contactWhatsapp: "7719990199", active });
    },
  );
});

describe("Review status, origin and lifecycle timestamps", () => {
  it("the demo seed includes a rejection with a reason", async () => {
    const rows = await rolledBack(seedThenRead);
    const [rejected] = rows.filter(({ status }) => status === "rejected");
    expect(rejected?.rejectedAt).toBeInstanceOf(Date);
    expect(rejected?.rejectionReason).toMatch(/de mentira/);
  });
});

describe("The consent record stores which notice version it was given against", () => {
  // docs/specs/legal-pages.md, "The privacy notice has a stable version
  // declared in a single place": the seed reads it, with no copy.
  it("the seed names the current notice version of the single module, and an earlier one", () => {
    expect(SEED_NOTICE_VERSION).toBe(NOTICE_VERSION);
    expect(Number(SEED_EARLIER_NOTICE_VERSION)).toBeLessThan(Number(SEED_NOTICE_VERSION));
  });

  it("the demo seed seeds the version, except the two cases of the panel", async () => {
    const rows = await rolledBack(seedThenRead);
    const consent = ({
      consentedToNoticeVersion,
      reconsentedToNoticeAt,
      reconsentedToNoticeVersion,
    }: Seeded) => [
      consentedToNoticeVersion,
      reconsentedToNoticeAt !== null,
      reconsentedToNoticeVersion,
    ];

    const usual = rows.filter(
      ({ consentedToNoticeVersion }) => consentedToNoticeVersion === SEED_NOTICE_VERSION,
    );
    expect(usual).toHaveLength(rows.length - 2);
    for (const b of usual) expect(consent(b)).toEqual([SEED_NOTICE_VERSION, false, null]);

    const others = rows.filter(
      ({ consentedToNoticeVersion }) => consentedToNoticeVersion !== SEED_NOTICE_VERSION,
    );
    expect(others.map(consent)).toEqual(
      expect.arrayContaining([
        // From before versioning: no version and no re-acceptance.
        [null, false, null],
        // An earlier version, and the one in force accepted on a resubmission.
        [SEED_EARLIER_NOTICE_VERSION, true, SEED_NOTICE_VERSION],
      ]),
    );
    const reconsented = others.find(({ reconsentedToNoticeAt }) => reconsentedToNoticeAt !== null)!;
    expect(reconsented.consentedToNoticeAt.getTime()).toBeLessThan(
      reconsented.reconsentedToNoticeAt!.getTime(),
    );
  });
});

describe("The fictitious numbers of the seeds follow the 771999xxxx convention (v2)", () => {
  it("seeds and fixtures", () => {
    const numbers = [
      SEED_CONTACT_WHATSAPP,
      ...FAKE_BUSINESSES.flatMap(({ whatsapp, landline }) => [whatsapp, landline ?? whatsapp]),
    ];
    for (const number of numbers) expect(number).toMatch(/^771999[0-9]{4}$/);
    expect(new Set(FAKE_BUSINESSES.map(({ whatsapp }) => whatsapp)).size).toBe(
      FAKE_BUSINESSES.length,
    );
  });
});

/** The width and height a lossless WebP file declares, or null when it is not one. */
function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP" || text(12, 16) !== "VP8L") return null;
  if (bytes[20] !== 0x2f) return null;
  const bits =
    (bytes[21] ?? 0) |
    ((bytes[22] ?? 0) << 8) |
    ((bytes[23] ?? 0) << 16) |
    ((bytes[24] ?? 0) << 24);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

/** The keys under photos/ of the media bucket. */
async function storedPhotoKeys(): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix: "photos/" });
  return listed.objects.map(({ key }) => key).toSorted();
}

describe("The demo seed leaves cards with a photo to see the directory as the resident will see it", () => {
  afterEach(async () => {
    const keys = await storedPhotoKeys();
    if (keys.length > 0) await env.MEDIA.delete(keys);
  });

  // Scenario: seeding with photos
  it("at least one published card has its photo and its files, and at least one has none", async () => {
    const { report, rows } = await rolledBack(async (tx) => ({
      report: await seed(tx, NOW),
      rows: await seeded(tx),
    }));
    const live = published(rows);
    const withPhoto = live.filter(({ photoKey }) => photoKey !== null);
    expect(withPhoto.length).toBeGreaterThanOrEqual(1);
    expect(live.some(({ photoKey }) => photoKey === null)).toBe(true);
    expect(report.photos.map(({ photoKey }) => photoKey).toSorted()).toEqual(
      rows.flatMap(({ photoKey }) => (photoKey === null ? [] : [photoKey])).toSorted(),
    );

    const objects = seedPhotoObjects(report.photos);
    await writeSeedPhotos(env.MEDIA, objects);

    expect(await storedPhotoKeys()).toEqual(
      withPhoto.flatMap(({ photoKey }) => photoObjectKeys(photoKey!)).toSorted(),
    );
    for (const { photoKey } of withPhoto) {
      for (const variant of ["card", "full"] as const) {
        const object = await env.MEDIA.get(photoObjectKey(photoKey!, variant));
        const bytes = new Uint8Array(await object!.arrayBuffer());
        const { width, height, maxBytes } = PHOTO_VARIANTS[variant];
        expect(webpSize(bytes), variant).toEqual({ width, height });
        // "Photo weight does not break the 4G budget"
        expect(bytes.length).toBeLessThanOrEqual(maxBytes);
        expect(object?.httpMetadata).toEqual({
          contentType: PHOTO_CONTENT_TYPE,
          cacheControl: PHOTO_CACHE_CONTROL,
        });
      }
    }
  });

  // Scenario: idempotent demo seed with photos
  it("run twice, it leaves one photo per seeded card and nothing loose", async () => {
    const { first, second } = await rolledBack(async (tx) => ({
      first: await seed(tx, NOW),
      second: await seed(tx, new Date(NOW.getTime() + 86_400_000)),
    }));
    await writeSeedPhotos(env.MEDIA, seedPhotoObjects(first.photos));
    const before = await Promise.all(
      (await storedPhotoKeys()).map(async (key) => [key, (await env.MEDIA.head(key))?.etag]),
    );

    await writeSeedPhotos(env.MEDIA, seedPhotoObjects(second.photos));

    const after = await Promise.all(
      (await storedPhotoKeys()).map(async (key) => [key, (await env.MEDIA.head(key))?.etag]),
    );
    // The same keys, with the same bytes: the images are drawn the same way.
    expect(after).toEqual(before);
    expect(after).toHaveLength(2 * first.photos.length);
  });

  it("a business that took the WhatsApp of a fake one with a photo gets no seeded photo", async () => {
    const fake = FAKE_BUSINESSES.find(({ photoKey }) => photoKey !== undefined)!;
    const report = await rolledBack(async (tx) => {
      const [category] = await tx.select({ id: categories.id }).from(categories).limit(1);
      await tx.insert(businesses).values({
        id: "zzzzzzzzzy",
        localityCode: SEED_LOCALITY_CODE,
        categoryId: category!.id,
        name: "Registro de prueba hecho a mano",
        whatsapp: fake.whatsapp,
        zoneOther: "Una colonia de prueba",
        consentedToNoticeAt: NOW,
        consentedToNoticeVersion: SEED_NOTICE_VERSION,
      });
      return seed(tx, NOW);
    });
    expect(report.photos.map(({ photoKey }) => photoKey)).not.toContain(fake.photoKey);
    expect(report.photos).toHaveLength(SEEDED_PHOTOS.length - 1);
  });

  it("the images are drawn, not files: the same name and size give the same bytes", () => {
    const [photo] = SEEDED_PHOTOS;
    const once = seedPhotoObjects([photo!]);
    const twice = seedPhotoObjects([photo!]);
    expect(twice).toEqual(once);
    expect(once.map(({ key }) => key)).toEqual(photoObjectKeys(photo!.photoKey));
  });
});
