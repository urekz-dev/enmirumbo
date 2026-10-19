// Scenarios of docs/specs/data-model.md about the reference data, against the
// database the migrations leave: the categories and trades come from
// drizzle/0007_categories_trades.sql, the zones of Tizayuca from
// drizzle/0006_tizayuca_zones.sql (zones.test.ts), Hidalgo and Tizayuca from
// drizzle/0003_inegi_catalogue.sql, which drizzle/0010_tizayuca_only.sql trims
// to them (locality.test.ts). The expected lists are the prototype PRD's (§6.1
// and Appendix B), in its order.
import { asc, count, eq, lt } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { SLUG_PATTERN } from "../../src/core/db/schema/checks.ts";
import {
  categories,
  localities,
  municipalities,
  permissions,
  roles,
  states,
  trades,
  zones,
} from "../../src/core/db/schema/index.ts";
import { PERMISSIONS } from "../../src/core/access/permissions.ts";
import { SPORTS_CATEGORY_SLUG } from "../../src/core/catalogue/categories.ts";
import { db, FIRST_FIXTURE_CODE, isFixtureSlug } from "./fixtures.ts";
import { slugify } from "../../src/core/catalogue/slug.ts";

const CATEGORIES = [
  ["Restaurantes y fondas", "restaurantes-y-fondas"],
  ["Servicios del hogar", "servicios-del-hogar"],
  ["Belleza", "belleza"],
  ["Salud", "salud"],
  ["Abarrotes y comercio", "abarrotes-y-comercio"],
  ["Talleres", "talleres"],
  ["Clubes y escuelas deportivas", "clubes-y-escuelas-deportivas"],
  ["Otro", "otro"],
];

const TRADES = [
  // Servicios del hogar
  ["Plomería", "plomeria"],
  ["Electricidad", "electricidad"],
  ["Albañilería", "albanileria"],
  ["Herrería", "herreria"],
  ["Carpintería", "carpinteria"],
  ["Pintura", "pintura"],
  ["Jardinería", "jardineria"],
  ["Fumigación", "fumigacion"],
  ["Reparación de lavadoras y refrigeradores", "reparacion-de-lavadoras-y-refrigeradores"],
  ["Cerrajería", "cerrajeria"],
  ["Mudanzas", "mudanzas"],
  // Restaurantes y fondas
  ["Fonda / comida corrida", "fonda-comida-corrida"],
  ["Antojitos", "antojitos"],
  ["Tacos", "tacos"],
  ["Pizzas", "pizzas"],
  ["Pollos", "pollos"],
  ["Mariscos", "mariscos"],
  ["Panadería", "panaderia"],
  ["Pastelería", "pasteleria"],
  // Belleza
  ["Estética", "estetica"],
  ["Barbería", "barberia"],
  ["Uñas", "unas"],
  ["Maquillaje", "maquillaje"],
  // Salud
  ["Consultorio médico", "consultorio-medico"],
  ["Dentista", "dentista"],
  ["Farmacia", "farmacia"],
  ["Veterinaria", "veterinaria"],
  ["Psicología", "psicologia"],
  // Abarrotes y comercio
  ["Abarrotes", "abarrotes"],
  ["Papelería", "papeleria"],
  ["Ferretería", "ferreteria"],
  ["Ropa", "ropa"],
  ["Celulares y accesorios", "celulares-y-accesorios"],
  ["Florería", "floreria"],
  // Talleres
  ["Taller mecánico", "taller-mecanico"],
  ["Hojalatería y pintura", "hojalateria-y-pintura"],
  ["Vulcanizadora", "vulcanizadora"],
  ["Bicicletas", "bicicletas"],
  ["Motos", "motos"],
  ["Electrónica", "electronica"],
  // Clubes y escuelas deportivas
  ["Futbol", "futbol"],
  ["Box", "box"],
  ["Taekwondo / artes marciales", "taekwondo-artes-marciales"],
  ["Gimnasio", "gimnasio"],
  ["Danza / zumba", "danza-zumba"],
  ["Natación", "natacion"],
  ["Basquetbol", "basquetbol"],
  ["Atletismo / corredores", "atletismo-corredores"],
  ["Ciclismo", "ciclismo"],
];

interface Entry {
  name: string;
  slug: string;
}
let categoryRows: Entry[];
let tradeRows: Entry[];

beforeAll(async () => {
  // Other test files add fixture categories and trades while this runs.
  const real = (rows: Entry[]) => rows.filter(({ slug }) => !isFixtureSlug(slug));
  categoryRows = real(
    await db((tx) =>
      tx
        .select({ name: categories.name, slug: categories.slug })
        .from(categories)
        .orderBy(asc(categories.id)),
    ),
  );
  tradeRows = real(
    await db((tx) =>
      tx.select({ name: trades.name, slug: trades.slug }).from(trades).orderBy(asc(trades.id)),
    ),
  );
});

const pairs = (rows: Entry[]) => rows.map(({ name, slug }) => [name, slug]);

describe("Catalogues of categories, zones and trades with stable slug (v2)", () => {
  it("catalogues populated: the 8 categories and the 49 trades of the PRD, in its order", () => {
    expect(CATEGORIES).toHaveLength(8);
    expect(TRADES).toHaveLength(49);
    expect(pairs(categoryRows)).toEqual(CATEGORIES);
    expect(pairs(tradeRows)).toEqual(TRADES);
  });

  it("URL-suitable slug: the shared slug rule, without capitals, accents or spaces", () => {
    const slug = new RegExp(SLUG_PATTERN);
    for (const row of [...categoryRows, ...tradeRows]) {
      expect(row.slug).toBe(slugify(row.name));
      expect(row.slug).toMatch(slug);
    }
    expect(tradeRows.find(({ name }) => name === "Plomería")?.slug).toBe("plomeria");
    expect(categoryRows.find(({ name }) => name === "Clubes y escuelas deportivas")?.slug).toBe(
      "clubes-y-escuelas-deportivas",
    );
  });

  // public-directory, "Highlighted "Deporte en Tizayuca" block on the home
  // page": the block's entry leads to the listing of this category.
  it("the category the sports block of the home highlights is in the catalogue", () => {
    expect(categoryRows.find(({ slug }) => slug === SPORTS_CATEGORY_SLUG)?.name).toBe(
      "Clubes y escuelas deportivas",
    );
  });
});

describe("Reproducible migrations that carry the reference data (v2)", () => {
  it("database from scratch: the migrations alone bring the reference data", async () => {
    const total = async (run: Promise<{ n: number }[]>) => (await run)[0]?.n;
    const counts = await db(async (tx) => ({
      states: await total(
        tx.select({ n: count() }).from(states).where(lt(states.code, FIRST_FIXTURE_CODE)),
      ),
      municipalities: await total(
        tx
          .select({ n: count() })
          .from(municipalities)
          .where(lt(municipalities.stateCode, FIRST_FIXTURE_CODE)),
      ),
      localities: (
        await tx
          .select({ code: localities.code })
          .from(localities)
          .where(lt(localities.code, FIRST_FIXTURE_CODE))
      ).map(({ code }) => code),
      zones: await total(
        tx.select({ n: count() }).from(zones).where(eq(zones.localityCode, "13069")),
      ),
      permissions: await total(tx.select({ n: count() }).from(permissions)),
      roles: (await tx.select({ key: roles.key }).from(roles)).map(({ key }) => key),
    }));
    expect(categoryRows).toHaveLength(8);
    expect(tradeRows).toHaveLength(49);
    expect(counts).toMatchObject({
      // Hidalgo and Tizayuca only.
      states: 1,
      municipalities: 1,
      localities: ["13069"],
      zones: 105,
      permissions: Object.keys(PERMISSIONS).length,
    });
    expect(counts.roles).toEqual(expect.arrayContaining(["super_admin", "locality_admin"]));
  });
});
