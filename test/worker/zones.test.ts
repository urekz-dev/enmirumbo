// Scenarios of docs/specs/data-model.md about the zones of a locality, against
// the database the migrations leave: Tizayuca's zones come from
// drizzle/0006_tizayuca_zones.sql, written from SEPOMEX's postal catalogue,
// and their postal codes from drizzle/0016_zone_postal_codes.sql, from the
// same catalogue. That the migrations credit SEPOMEX is checked in
// test/scripts/reference-data.test.ts.
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { SLUG_PATTERN } from "../../src/core/db/schema/checks.ts";
import { zones } from "../../src/core/db/schema/index.ts";
import { db } from "./fixtures.ts";
import { slugify } from "../../src/core/catalogue/slug.ts";

interface Row {
  type: string;
  name: string;
  slug: string;
  visible: boolean;
}
let tizayuca: Row[];
/** The postal code of each zone of Tizayuca, by slug. */
let postalCodes: Map<string, string | null>;

beforeAll(async () => {
  const rows = await db((tx) =>
    tx
      .select({
        type: zones.type,
        name: zones.name,
        slug: zones.slug,
        visible: zones.visible,
        postalCode: zones.postalCode,
      })
      .from(zones)
      .where(eq(zones.localityCode, "13069"))
      .orderBy(zones.slug),
  );
  tizayuca = rows.map(({ type, name, slug, visible }) => ({ type, name, slug, visible }));
  postalCodes = new Map(rows.map(({ slug, postalCode }) => [slug, postalCode]));
});

/** Names that differ only in case, accents or spacing are the same. */
const nameKey = (name: string) =>
  name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();

/**
 * The prototype's 21 colonias (its PRD, Appendix A) and the slug of the
 * SEPOMEX zone that stands for each, or null when SEPOMEX has none. Nothing
 * was dropped or renamed for this cross-check: the product owner decides.
 */
const PROTOTYPE_COLONIAS: Readonly<Record<string, string | null>> = {
  "Tizayuca Centro": "tizayuca-centro",
  "El Pedregal / Pedregal Centro": "el-pedregal",
  Huicalco: "huicalco",
  Atempa: "atempa",
  "Emiliano Zapata": "emiliano-zapata",
  Nacozari: "nacozari",
  "Olmos / Ampliación Olmos": "olmos",
  "Nuevo Tizayuca": "nuevo-tizayuca",
  "El Refugio Tepojaco": "tepojaco",
  Huitzila: "huitzila",
  "Zona Industrial": "zona-industrial-tizayuca",
  "Haciendas de Tizayuca": "haciendas-de-tizayuca",
  "Fuentes de Tizayuca": "fuentes-de-tizayuca",
  Geovillas: "geo-villas",
  "Rancho Don Antonio": "rancho-don-antonio",
  "Los Héroes Tizayuca": "los-heroes-tizayuca",
  "Andalucía Residencial": "andalucia-residencial",
  "Real Toledo": null,
  "Bosques de Ibiza": "bosques-de-ibiza",
  "Las Campanas": "las-campanas",
  "El Cid": "el-cid",
};

// The categories and trades are checked in catalogues.test.ts.
describe("Catalogues of categories, zones and trades with stable slug (v2)", () => {
  it("catalogues populated: every zone has a URL slug, unique within its locality", () => {
    const slug = new RegExp(SLUG_PATTERN);
    expect(tizayuca.length).toBeGreaterThan(0);
    expect(tizayuca.filter((zone) => !slug.test(zone.slug))).toEqual([]);
    expect(new Set(tizayuca.map((zone) => zone.slug)).size).toBe(tizayuca.length);
  });

  it("URL-suitable slug", () => {
    expect(tizayuca.find((zone) => zone.name === "Haciendas de Tizayuca")?.slug).toBe(
      "haciendas-de-tizayuca",
    );
  });
});

describe("Zones belong to a locality, and Tizayuca's come from the SEPOMEX postal catalogue (v2)", () => {
  it("zones carry their locality and type", () => {
    expect(tizayuca).toHaveLength(105);
    const types = Object.fromEntries(
      [...Map.groupBy(tizayuca, (zone) => zone.type)].map(([type, list]) => [type, list.length]),
    );
    expect(types).toEqual({
      Fraccionamiento: 53,
      Colonia: 34,
      Barrio: 5,
      Pueblo: 5,
      Rancho: 4,
      "Unidad habitacional": 2,
      "Zona industrial": 1,
      Ranchería: 1,
    });
    // Every zone is offered until the admin hides it.
    expect(tizayuca.every((zone) => zone.visible)).toBe(true);
  });

  it("well-known settlements keep SEPOMEX's names, with their slugs", () => {
    const row = (type: string, name: string, slug: string) => ({ type, name, slug, visible: true });
    expect(tizayuca).toEqual(
      expect.arrayContaining([
        row("Colonia", "Tizayuca Centro", "tizayuca-centro"),
        row("Fraccionamiento", "Haciendas de Tizayuca", "haciendas-de-tizayuca"),
        row("Fraccionamiento", "Los Héroes Tizayuca", "los-heroes-tizayuca"),
        row("Barrio", "Atempa", "atempa"),
        row("Pueblo", "Huitzila", "huitzila"),
        row("Unidad habitacional", "Las Campanas", "las-campanas"),
        row("Colonia", "Geo Villas", "geo-villas"),
        row("Fraccionamiento", "San Ángel", "san-angel"),
        row("Fraccionamiento", "La Cañada", "la-canada"),
        row("Colonia", "C.T.M.", "ctm"),
        row("Fraccionamiento", "Ex-Presidentes Municipales", "ex-presidentes-municipales"),
        row("Fraccionamiento", "Don Carlos 2da. Sección", "don-carlos-2da-seccion"),
        row("Colonia", "Ciudad de los Niños (Rosas Rojas)", "ciudad-de-los-ninos-rosas-rojas"),
        row("Fraccionamiento", "Rancho la Purísima", "rancho-la-purisima"),
      ]),
    );
  });

  it("names as SEPOMEX writes them: no stray spaces, no text garbled by an encoding", () => {
    for (const zone of tizayuca) {
      expect(zone.name).toBe(zone.name.trim().replace(/\s+/gu, " "));
      // UTF-8 read as ISO-8859-1 turns "í" into "Ã­".
      expect(zone.name).not.toMatch(/[ÃÂ\uFFFD]/u);
    }
  });

  it("slugs follow the slug rule, and carry the type where a name has two types", () => {
    const twoTypes = new Set(["El Carmen", "El Chopo", "El Manantial", "Tizayuca"]);
    const expected = (zone: Row) =>
      slugify(twoTypes.has(zone.name) ? `${zone.type} ${zone.name}` : zone.name);
    expect(tizayuca.filter((zone) => zone.slug !== expected(zone))).toEqual([]);
  });

  it("no duplicates after the cleanup", () => {
    const repeated = [...Map.groupBy(tizayuca, (zone) => nameKey(zone.name))]
      .filter(([, list]) => list.length > 1)
      .map(([, list]) => list.map(({ type, name, slug }) => ({ type, name, slug })));
    // Only the names SEPOMEX lists with two settlement types repeat, each
    // with the slugs chosen by hand.
    expect(repeated).toEqual([
      [
        { type: "Colonia", name: "El Carmen", slug: "colonia-el-carmen" },
        { type: "Fraccionamiento", name: "El Carmen", slug: "fraccionamiento-el-carmen" },
      ],
      [
        { type: "Fraccionamiento", name: "El Manantial", slug: "fraccionamiento-el-manantial" },
        { type: "Rancho", name: "El Manantial", slug: "rancho-el-manantial" },
      ],
      [
        { type: "Pueblo", name: "El Chopo", slug: "pueblo-el-chopo" },
        { type: "Rancho", name: "El Chopo", slug: "rancho-el-chopo" },
      ],
      [
        { type: "Unidad habitacional", name: "Tizayuca", slug: "unidad-habitacional-tizayuca" },
        { type: "Zona industrial", name: "Tizayuca", slug: "zona-industrial-tizayuca" },
      ],
    ]);
  });

  it("cross-check against the prototype's list", () => {
    const bySlug = new Map(tizayuca.map((zone) => [zone.slug, zone]));
    const found = Object.entries(PROTOTYPE_COLONIAS).map(([colonia, slug]) => {
      const zone = slug === null ? undefined : bySlug.get(slug);
      return [colonia, zone ? `${zone.name} (${zone.type})` : null];
    });
    expect(Object.fromEntries(found)).toEqual({
      // The same spelling.
      "Tizayuca Centro": "Tizayuca Centro (Colonia)",
      Huicalco: "Huicalco (Barrio)",
      Atempa: "Atempa (Barrio)",
      "Emiliano Zapata": "Emiliano Zapata (Colonia)",
      Nacozari: "Nacozari (Barrio)",
      "Nuevo Tizayuca": "Nuevo Tizayuca (Colonia)",
      Huitzila: "Huitzila (Pueblo)",
      "Haciendas de Tizayuca": "Haciendas de Tizayuca (Fraccionamiento)",
      "Fuentes de Tizayuca": "Fuentes de Tizayuca (Fraccionamiento)",
      "Rancho Don Antonio": "Rancho Don Antonio (Fraccionamiento)",
      "Los Héroes Tizayuca": "Los Héroes Tizayuca (Fraccionamiento)",
      "Andalucía Residencial": "Andalucía Residencial (Fraccionamiento)",
      "Bosques de Ibiza": "Bosques de Ibiza (Fraccionamiento)",
      "Las Campanas": "Las Campanas (Unidad habitacional)",
      "El Cid": "El Cid (Colonia)",
      // Another spelling.
      "El Pedregal / Pedregal Centro": "El Pedregal (Colonia)",
      "Olmos / Ampliación Olmos": "Olmos (Pueblo)",
      "El Refugio Tepojaco": "Tepojaco (Barrio)",
      "Zona Industrial": "Tizayuca (Zona industrial)",
      Geovillas: "Geo Villas (Colonia)",
      // Missing from SEPOMEX.
      "Real Toledo": null,
    });
    expect(tizayuca.filter((zone) => nameKey(zone.name).includes("toledo"))).toEqual([]);
    // SEPOMEX zones that the prototype did not have.
    expect(tizayuca.length - found.filter(([, zone]) => zone !== null).length).toBe(85);
  });
});

describe("Each zone has its postal code, and Tizayuca's come from the SEPOMEX postal catalogue (v2)", () => {
  it("every zone of Tizayuca has a postal code of five digits, one of its 15", () => {
    expect([...postalCodes.values()].filter((code) => !/^438[0-9]{2}$/.test(code ?? ""))).toEqual(
      [],
    );
    expect(postalCodes.size).toBe(105);
    const counts = Object.fromEntries(
      [...Map.groupBy(postalCodes.values(), (code) => code)].map(([code, list]) => [
        code,
        list.length,
      ]),
    );
    expect(counts).toEqual({
      "43800": 1,
      "43802": 6,
      "43803": 14,
      "43804": 5,
      "43806": 10,
      "43807": 5,
      "43808": 7,
      "43810": 13,
      "43815": 20,
      "43816": 7,
      "43817": 3,
      "43820": 2,
      "43823": 3,
      "43824": 7,
      "43825": 2,
    });
  });

  it("spot checks against SEPOMEX's catalogue, the names with two types included", () => {
    expect(
      Object.fromEntries(
        [
          "tizayuca-centro",
          "huicalco",
          "haciendas-de-tizayuca",
          "atempa",
          "huitzila",
          "olmos",
          "colonia-el-carmen",
          "fraccionamiento-el-carmen",
          "pueblo-el-chopo",
          "rancho-el-chopo",
          "fraccionamiento-el-manantial",
          "rancho-el-manantial",
          "unidad-habitacional-tizayuca",
          "zona-industrial-tizayuca",
        ].map((slug) => [slug, postalCodes.get(slug)]),
      ),
    ).toEqual({
      "tizayuca-centro": "43800",
      huicalco: "43808",
      "haciendas-de-tizayuca": "43815",
      atempa: "43808",
      huitzila: "43820",
      olmos: "43825",
      "colonia-el-carmen": "43815",
      "fraccionamiento-el-carmen": "43815",
      "pueblo-el-chopo": "43824",
      "rancho-el-chopo": "43817",
      "fraccionamiento-el-manantial": "43824",
      "rancho-el-manantial": "43824",
      "unidad-habitacional-tizayuca": "43806",
      "zona-industrial-tizayuca": "43804",
    });
  });
});
