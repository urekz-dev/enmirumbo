// The business card read from the database (src/core/business/card.ts) and
// its entries in the sitemap (src/core/seo/sitemap.ts), with the fixture
// localities of this file: docs/specs/public-directory.md, "Business card at
// its own URL with the registered information and the verified seal", "Only
// what is published is shown", "An edit awaiting review does not show through
// on any public surface", "The zone is published, never the exact address nor
// the card's internal data" and "From the card the pages of its trades are
// reached"; docs/specs/base-layout.md, "The sitemap lists the pages that
// exist, from the database (v2)". The page is tested end to end
// (test/e2e/business-card.spec.ts).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { publishedCard, publishedCards } from "../../src/core/business/card.ts";
import {
  businesses,
  businessTrades,
  localities,
  pendingEdits,
} from "../../src/core/db/schema/index.ts";
import { sitemapEntries } from "../../src/core/seo/sitemap.ts";
import {
  cleanup,
  createFixture,
  db,
  type Fixture,
  insertBusiness,
  type NewBusiness,
} from "./fixtures.ts";

const STATE = "92";
const PREFIX = `/estado-de-prueba-${STATE}/pueblo-uno/negocio/`;
let f: Fixture;

beforeAll(async () => {
  f = await createFixture(STATE);
});

afterAll(async () => {
  await cleanup(STATE);
});

const PUBLISHED_AT = new Date("2026-10-01T18:00:00Z");

const publish = (overrides: Partial<NewBusiness> = {}) =>
  insertBusiness(f, { status: "published", publishedAt: PUBLISHED_AT, ...overrides });

const cardOf = (id: string, localityCode = f.localityA) =>
  db((tx) => publishedCard(tx, localityCode, id));

describe("Business card at its own URL with the registered information and the verified seal", () => {
  // Scenario: complete card
  it("a card with every optional field brings all of them, its category, its zone and its trades", async () => {
    const id = await publish({
      name: "Plomería Completa de Prueba",
      whatsapp: "7719990901",
      whatYouOffer: "Plomería, destape de drenajes y bombas de agua",
      homeDelivery: true,
      landline: "771 999 0951",
      address: "a un lado de la primaria, calle Morelos",
      latitude: 19.84,
      longitude: -98.98,
      openingHours: "Lunes a sábado de 9 a 7",
      facebookUrl: "https://mi-negocio.example/perfil",
    });
    const [, dos, tres] = f.tradeIds;
    await db((tx) =>
      tx.insert(businessTrades).values([
        { businessId: id, tradeId: tres },
        { businessId: id, tradeId: dos },
      ]),
    );

    expect(await cardOf(id)).toEqual({
      id,
      name: "Plomería Completa de Prueba",
      category: { name: `Categoría de prueba ${STATE}`, slug: `categoria-prueba-${STATE}` },
      zoneName: "Centro",
      zoneSlug: "centro",
      whatsapp: "7719990901",
      whatYouOffer: "Plomería, destape de drenajes y bombas de agua",
      homeDelivery: true,
      landline: "771 999 0951",
      address: "a un lado de la primaria, calle Morelos",
      openingHours: "Lunes a sábado de 9 a 7",
      pageUrl: "https://mi-negocio.example/perfil",
      // In catalogue order, whatever the order they were assigned in.
      trades: [
        { name: `Giro de prueba ${STATE} dos`, slug: `giro-prueba-${STATE}-dos` },
        { name: `Giro de prueba ${STATE} tres`, slug: `giro-prueba-${STATE}-tres` },
      ],
      photoKey: null,
    });
  });

  // Scenarios: card of a business that filled in only the required fields;
  // card without trades
  it("a card with only the required fields has no optional field and no trades", async () => {
    const id = await publish({ name: "Cerrajería Mínima de Prueba" });

    expect(await cardOf(id)).toMatchObject({
      whatYouOffer: null,
      homeDelivery: false,
      landline: null,
      address: null,
      openingHours: null,
      pageUrl: null,
      trades: [],
    });
  });

  it("a field left blank is a field the business did not register", async () => {
    const id = await publish({ whatYouOffer: "  ", address: "", openingHours: "\n" });

    expect(await cardOf(id)).toMatchObject({
      whatYouOffer: null,
      address: null,
      openingHours: null,
    });
  });

  // Published business with unnormalized "Otra" zone
  it('a zone "Otra" is its free text, with no catalogue slug', async () => {
    const id = await publish({ zoneId: null, zoneOther: " Privada Los Colibríes de Prueba " });

    expect(await cardOf(id)).toMatchObject({
      zoneName: "Privada Los Colibríes de Prueba",
      zoneSlug: null,
    });
  });

  // Scenario: nonexistent card
  it("an identifier that does not exist finds nothing", async () => {
    expect(await cardOf("zzzzzzzzzz")).toBeNull();
  });

  it("a published card of another locality is not found under this one", async () => {
    const id = await publish({ localityCode: f.localityB, zoneId: f.zoneB });

    expect(await cardOf(id, f.localityA)).toBeNull();
    expect(await cardOf(id, f.localityB)).not.toBeNull();
  });
});

describe("Only what is published is shown", () => {
  // Scenario: card of an unpublished business
  it("a card in review or rejected is the same null as one that does not exist", async () => {
    const inReview = await insertBusiness(f, { status: "in_review" });
    const rejected = await insertBusiness(f, {
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: "Motivo de prueba",
    });

    expect(await cardOf(inReview)).toBeNull();
    expect(await cardOf(rejected)).toBeNull();
  });

  // Scenarios: the unpublished card leaves the directory on the next request;
  // the deleted card leaves no trace either
  it("a card that is unpublished or deleted is not found on the next read, nor in the sitemap", async () => {
    const unpublished = await publish({ name: "Despublicada de Prueba" });
    const deleted = await publish({ name: "Borrada de Prueba" });
    const paths = async () =>
      (await db(sitemapEntries)).map(({ path }) => path).filter((path) => path.startsWith(PREFIX));
    expect(await paths()).toEqual(
      expect.arrayContaining([
        `${PREFIX}despublicada-de-prueba-${unpublished}`,
        `${PREFIX}borrada-de-prueba-${deleted}`,
      ]),
    );

    await db(async (tx) => {
      await tx
        .update(businesses)
        .set({
          status: "in_review",
          unpublishedAt: new Date(),
          unpublishReason: "Motivo de prueba",
        })
        .where(eq(businesses.id, unpublished));
      await tx.delete(businesses).where(eq(businesses.id, deleted));
    });

    expect(await cardOf(unpublished)).toBeNull();
    expect(await cardOf(deleted)).toBeNull();
    expect(
      (await paths()).filter((path) => path.endsWith(unpublished) || path.endsWith(deleted)),
    ).toEqual([]);
  });
});

describe("An edit awaiting review does not show through on any public surface", () => {
  // Scenarios: the card keeps showing what is published; nothing gives away
  // that changes are waiting
  it("the card is the published version, with nothing of the pending edit", async () => {
    const values = {
      name: "Estética Publicada de Prueba",
      whatYouOffer: "Corte y tinte",
      openingHours: "Lunes a viernes de 10 a 6",
      landline: "7719990961",
    };
    const id = await publish(values);
    const withoutEdit = await cardOf(id);
    await db((tx) =>
      tx.insert(pendingEdits).values({
        businessId: id,
        localityCode: f.localityA,
        name: "Estética Propuesta y Asociados",
        categoryId: f.categoryId,
        whatsapp: "7719990962",
        zoneId: null,
        zoneOther: "Colonia Propuesta",
        whatYouOffer: "Uñas propuestas",
        homeDelivery: true,
        landline: "7719990963",
        address: "Dirección propuesta",
        openingHours: "Domingos propuestos",
        facebookUrl: "https://propuesta.example/",
      }),
    );

    const card = await cardOf(id);
    expect(card).toEqual(withoutEdit);
    expect(card).toMatchObject(values);
    expect(JSON.stringify(card)).not.toMatch(/[Pp]ropuest|7719990962|7719990963/);
  });
});

describe("The zone is published, never the exact address nor the card's internal data", () => {
  // Scenario: no internal data in the response
  it("the card brings nothing internal: no status, origin, dates, consent, link or pin", async () => {
    const id = await publish({
      origin: "seeded",
      latitude: 19.84,
      longitude: -98.98,
      photoKey: `prueba${STATE}foto`,
      managementTokenHash: "a".repeat(64),
      managementTokenCreatedAt: new Date(),
    });

    const card = await cardOf(id);
    expect(Object.keys(card ?? {}).toSorted()).toEqual(
      [
        "id",
        "name",
        "category",
        "zoneName",
        "zoneSlug",
        "whatsapp",
        "whatYouOffer",
        "homeDelivery",
        "landline",
        "address",
        "openingHours",
        "pageUrl",
        "trades",
        // A published card's photo key, which only src/lib/media.ts turns into
        // an address ("The photo of an unpublished business is referenced on
        // no public surface (v2)").
        "photoKey",
      ].toSorted(),
    );
    expect(card?.photoKey).toBe(`prueba${STATE}foto`);
    expect(JSON.stringify({ ...card, photoKey: null })).not.toMatch(
      /seeded|19\.84|aaaa|published|2026-/,
    );
  });
});

describe("The sitemap lists the pages that exist, from the database (v2): the cards", () => {
  // Scenario: card date
  it("lists every published card of an active locality at its current URL, with its publication date", async () => {
    const id = await publish({ name: "Ferretería del Sitemap", publishedAt: PUBLISHED_AT });
    const entry = (await db(sitemapEntries)).find(({ path }) => path.endsWith(id));

    expect(entry).toEqual({
      path: `${PREFIX}ferreteria-del-sitemap-${id}`,
      lastModified: PUBLISHED_AT,
    });
  });

  // Scenario: nothing that is not a public page
  it("lists no card in review or rejected, and none of an inactive locality", async () => {
    const inReview = await insertBusiness(f, { status: "in_review" });
    // Locality B of the fixture is not active.
    const inactive = await publish({ localityCode: f.localityB, zoneId: f.zoneB });
    const [locality] = await db((tx) =>
      tx
        .select({ active: localities.active })
        .from(localities)
        .where(eq(localities.code, f.localityB)),
    );
    expect(locality?.active).toBe(false);

    const paths = (await db(sitemapEntries)).map(({ path }) => path);
    expect(paths.filter((path) => path.endsWith(inReview) || path.endsWith(inactive))).toEqual([]);
  });

  it("orders the cards of a locality by publication, then by name", async () => {
    const cards = await db((tx) => publishedCards(tx, f.localityA));
    const times = cards.map(({ publishedAt }) => publishedAt?.getTime() ?? 0);

    expect(times).toEqual(times.toSorted((a, b) => b - a));
  });
});
