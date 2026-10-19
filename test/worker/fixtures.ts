// Fixtures for the database tests: a fictitious state with two localities,
// their zones, a municipality without a locality, a category and trades. The
// database holds only the reference data of the localities it serves
// (Hidalgo and Tizayuca), so every other state or municipality a test needs is
// one of these. Each test file passes its own state code, above the 32 codes
// INEGI gives the states so it never takes a real state's, and files can run
// at the same time; each removes everything it created with `cleanup`. All
// phone numbers follow the 771999xxxx convention.
import { waitUntil, env } from "cloudflare:workers";
import { eq, inArray, like, sql } from "drizzle-orm";
import { newBusinessId } from "../../src/core/business/id.ts";
import { type Db, withDb } from "../../src/core/db/client.ts";
import {
  adminAuditLog,
  businesses,
  categories,
  localities,
  municipalities,
  states,
  trades,
  zones,
} from "../../src/core/db/schema/index.ts";

/** Runs `run` with a client on HYPERDRIVE_FRESH, as the application writes. */
export function db<T>(run: (db: Db) => Promise<T>): Promise<T> {
  return withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run);
}

export interface Fixture {
  stateCode: string;
  /** Two localities of the same fictitious state. */
  localityA: string;
  localityB: string;
  /** A zone of locality A and one of locality B, each with its postal code. */
  zoneA: number;
  zoneB: number;
  postalCodeA: string;
  postalCodeB: string;
  categoryId: number;
  tradeIds: [number, number, number];
}

/** The slug of the municipality of every fixture state that has no locality. */
export const UNSERVED_MUNICIPALITY = "pueblo-sin-localidad";

let phoneCounter = 0;

/** A fictitious WhatsApp number of the 771999xxxx series. */
export function fakePhone(): string {
  phoneCounter += 1;
  return `771999${String(phoneCounter).padStart(4, "0")}`;
}

/**
 * A fictitious postal code of the fixture state `stateCode`: no real postal
 * code starts with 00 (SEPOMEX's start at 01000), and the state code keeps
 * each file's apart.
 */
export function fakePostalCode(stateCode: string, n: number): string {
  return `00${stateCode}${n}`;
}

export async function createFixture(stateCode: string): Promise<Fixture> {
  const localityA = `${stateCode}001`;
  const localityB = `${stateCode}002`;
  const postalCodeA = fakePostalCode(stateCode, 1);
  const postalCodeB = fakePostalCode(stateCode, 2);
  await cleanup(stateCode);
  return db(async (tx) => {
    await tx.insert(states).values({
      code: stateCode,
      name: `Estado de prueba ${stateCode}`,
      slug: `estado-de-prueba-${stateCode}`,
    });
    await tx.insert(municipalities).values([
      { code: localityA, stateCode, name: "Pueblo Uno", slug: "pueblo-uno" },
      { code: localityB, stateCode, name: "Pueblo Dos", slug: "pueblo-dos" },
      // 004: data-model.test.ts saves a locality for 003 to see it rejected.
      {
        code: `${stateCode}004`,
        stateCode,
        name: "Pueblo Sin Localidad",
        slug: UNSERVED_MUNICIPALITY,
      },
    ]);
    await tx.insert(localities).values([
      {
        code: localityA,
        timeZone: "America/Mexico_City",
        contactWhatsapp: "7719990001",
        active: true,
      },
      { code: localityB, timeZone: "America/Mexico_City", contactWhatsapp: "7719990002" },
    ]);
    const [zoneA] = await tx
      .insert(zones)
      .values({
        localityCode: localityA,
        type: "Colonia",
        name: "Centro",
        slug: "centro",
        postalCode: postalCodeA,
      })
      .returning({ id: zones.id });
    const [zoneB] = await tx
      .insert(zones)
      .values({
        localityCode: localityB,
        type: "Colonia",
        name: "Centro",
        slug: "centro",
        postalCode: postalCodeB,
      })
      .returning({ id: zones.id });
    const [category] = await tx
      .insert(categories)
      .values({ name: `Categoría de prueba ${stateCode}`, slug: `categoria-prueba-${stateCode}` })
      .returning({ id: categories.id });
    const tradeRows = await tx
      .insert(trades)
      .values(
        ["uno", "dos", "tres"].map((n) => ({
          name: `Giro de prueba ${stateCode} ${n}`,
          slug: `giro-prueba-${stateCode}-${n}`,
        })),
      )
      .returning({ id: trades.id });
    if (!zoneA || !zoneB || !category || tradeRows.length !== 3) {
      throw new Error("fixture: an insert returned no row");
    }
    return {
      stateCode,
      localityA,
      localityB,
      zoneA: zoneA.id,
      zoneB: zoneB.id,
      postalCodeA,
      postalCodeB,
      categoryId: category.id,
      tradeIds: [tradeRows[0]!.id, tradeRows[1]!.id, tradeRows[2]!.id],
    };
  });
}

export type NewBusiness = typeof businesses.$inferInsert;

/** The required fields of a business in locality A, overridable. */
export function businessValues(
  fixture: Fixture,
  overrides: Partial<NewBusiness> = {},
): NewBusiness {
  return {
    id: newBusinessId(),
    localityCode: fixture.localityA,
    name: "Plomería de Prueba",
    categoryId: fixture.categoryId,
    whatsapp: fakePhone(),
    zoneId: fixture.zoneA,
    consentedToNoticeAt: new Date(),
    consentedToNoticeVersion: "1",
    ...overrides,
  };
}

export async function insertBusiness(
  fixture: Fixture,
  overrides: Partial<NewBusiness> = {},
): Promise<string> {
  const values = businessValues(fixture, overrides);
  await db((tx) => tx.insert(businesses).values(values));
  return values.id;
}

/**
 * Whether a category or trade slug belongs to the fixtures of a test file
 * that runs at the same time, rather than to the migrations.
 */
export function isFixtureSlug(slug: string): boolean {
  return /^(categoria|giro)-prueba-/.test(slug);
}

/**
 * The states of the fixtures, and their municipalities, localities and zones,
 * have codes above the 32 that INEGI gives the states.
 */
export const FIRST_FIXTURE_CODE = "33";

/** Whether a state is a fixture of a test file that runs at the same time. */
export function isFixtureState(state: { code: string; slug: string }): boolean {
  return state.code >= FIRST_FIXTURE_CODE && state.slug === `estado-de-prueba-${state.code}`;
}

/** Removes every row the fixture of `stateCode` created, in dependency order. */
export async function cleanup(stateCode: string): Promise<void> {
  await db(async (tx) => {
    const codes = [`${stateCode}001`, `${stateCode}002`];
    await tx.delete(adminAuditLog).where(inArray(adminAuditLog.localityCode, codes));
    await tx.delete(businesses).where(inArray(businesses.localityCode, codes));
    await tx.delete(zones).where(inArray(zones.localityCode, codes));
    await tx.delete(localities).where(inArray(localities.code, codes));
    await tx.delete(municipalities).where(eq(municipalities.stateCode, stateCode));
    await tx.delete(states).where(eq(states.code, stateCode));
    await tx.delete(categories).where(like(categories.slug, `categoria-prueba-${stateCode}%`));
    await tx.delete(trades).where(like(trades.slug, `giro-prueba-${stateCode}-%`));
  });
}

/**
 * The PostgreSQL error code of a failed query (`23505` unique, `23514` check,
 * `23503` foreign key, `23502` not null), or undefined when it succeeds.
 */
export async function pgErrorCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    for (let e: unknown = error; e instanceof Error; e = e.cause) {
      const code = (e as Error & { code?: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    }
    throw error;
  }
}

export const PG = {
  unique: "23505",
  check: "23514",
  foreignKey: "23503",
  notNull: "23502",
} as const;

/** Rows of a catalogue query, for the schema checks. */
export async function query<T extends Record<string, unknown>>(text: string): Promise<T[]> {
  return db(async (tx) => (await tx.execute(sql.raw(text))).rows as T[]);
}
