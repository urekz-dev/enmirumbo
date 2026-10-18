// Scenarios of docs/specs/data-model.md about the localities and the states
// and municipalities they belong to, against the database the migrations
// leave: Hidalgo, Tizayuca and its locality come from
// drizzle/0003_inegi_catalogue.sql, which drizzle/0010_tizayuca_only.sql
// trims to them, and its seat from drizzle/0009_tizayuca_coordinates.sql. Any
// other state or municipality is a fictitious one of the fixtures
// (./fixtures.ts). Also the function the public routes use to resolve
// `/{estado}/{municipio}` (src/core/locality).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { localities, municipalities, states } from "../../src/core/db/schema/index.ts";
import { servedLocality } from "../../src/core/locality/served.ts";
import {
  cleanup,
  createFixture,
  db,
  FIRST_FIXTURE_CODE,
  type Fixture,
  isFixtureState,
  UNSERVED_MUNICIPALITY,
} from "./fixtures.ts";
import { slugify } from "./slug.ts";

const STATE = "96";
const STATE_SLUG = `estado-de-prueba-${STATE}`;
let f: Fixture;

beforeAll(async () => {
  f = await createFixture(STATE);
});

afterAll(async () => {
  await cleanup(STATE);
});

const served = (stateSlug: string, municipalitySlug: string) =>
  db((tx) => servedLocality(tx, stateSlug, municipalitySlug));

const setActive = (code: string, active: boolean) =>
  db((tx) => tx.update(localities).set({ active }).where(eq(localities.code, code)));

describe("The locality is a first-class record keyed by the INEGI municipality code (v2)", () => {
  it("Tizayuca as a locality, inactive and without a contact WhatsApp", async () => {
    const [row] = await db((tx) =>
      tx
        .select({
          code: localities.code,
          name: municipalities.name,
          slug: municipalities.slug,
          stateName: states.name,
          stateSlug: states.slug,
          timeZone: localities.timeZone,
          contactWhatsapp: localities.contactWhatsapp,
          dailyRegistrationThreshold: localities.dailyRegistrationThreshold,
          active: localities.active,
          latitude: localities.latitude,
          longitude: localities.longitude,
        })
        .from(localities)
        .innerJoin(municipalities, eq(municipalities.code, localities.code))
        .innerJoin(states, eq(states.code, municipalities.stateCode))
        .where(eq(localities.code, "13069")),
    );

    expect(row).toEqual({
      code: "13069",
      name: "Tizayuca",
      slug: "tizayuca",
      stateName: "Hidalgo",
      stateSlug: "hidalgo",
      timeZone: "America/Mexico_City",
      contactWhatsapp: null,
      // The default of every locality (drizzle/0011_turnstile_switch_registration_alert.sql).
      dailyRegistrationThreshold: 20,
      active: false,
      // Its municipal seat, INEGI's locality 130690001
      // (drizzle/0009_tizayuca_coordinates.sql).
      latitude: 19.8410889,
      longitude: -98.9815842,
    });
  });
});

describe("The database holds only the reference data of the localities it serves (v2)", () => {
  // Scenario: only Tizayuca's reference data
  it("one state, Hidalgo, and one municipality, Tizayuca, with its locality", async () => {
    // Other test files add fictitious states while this runs (./fixtures.ts).
    const [allStates, allMunicipalities, allLocalities] = await db((tx) =>
      Promise.all([
        tx.select().from(states).orderBy(states.code),
        tx.select().from(municipalities).orderBy(municipalities.code),
        tx.select({ code: localities.code }).from(localities).orderBy(localities.code),
      ]),
    );
    // Every state but the fixtures', whose codes are above INEGI's 32, so
    // their municipalities and localities are too.
    const notFixture = ({ code }: { code: string }) => code.slice(0, 2) < FIRST_FIXTURE_CODE;

    expect(allStates.filter((state) => !isFixtureState(state))).toEqual([
      { code: "13", name: "Hidalgo", slug: "hidalgo" },
    ]);
    expect(allMunicipalities.filter(notFixture)).toEqual([
      { code: "13069", stateCode: "13", name: "Tizayuca", slug: "tizayuca" },
    ]);
    expect(allLocalities.filter(notFixture)).toEqual([{ code: "13069" }]);
    // Its seat is checked above, and its zones in zones.test.ts.
  });

  it("their slugs follow the slug rule", async () => {
    const [hidalgo] = await db((tx) => tx.select().from(states).where(eq(states.code, "13")));
    const [tizayuca] = await db((tx) =>
      tx.select().from(municipalities).where(eq(municipalities.code, "13069")),
    );
    expect(hidalgo?.slug).toBe(slugify(hidalgo!.name));
    expect(tizayuca?.slug).toBe(slugify(tizayuca!.name));
  });

  it("an active locality is served with its data", async () => {
    expect(await served(STATE_SLUG, "pueblo-uno")).toEqual({
      code: f.localityA,
      name: "Pueblo Uno",
      slug: "pueblo-uno",
      state: { code: STATE, name: `Estado de prueba ${STATE}`, slug: STATE_SLUG },
      timeZone: "America/Mexico_City",
      contactWhatsapp: "7719990001",
      // Other test files activate their own fixture localities meanwhile;
      // test/worker/locality-routes.test.ts checks this flag.
      othersActive: expect.any(Boolean),
      seat: null,
    });
  });

  it("an unknown state or municipality is not served", async () => {
    // A real state and a real municipality that the database does not hold.
    expect(await served("jalisco", "tizayuca")).toBeNull();
    expect(await served("hidalgo", "pachuca-de-soto")).toBeNull();
  });

  it("a municipality without an active locality is not served", async () => {
    // A locality with the active flag off.
    expect(await served(STATE_SLUG, "pueblo-dos")).toBeNull();
    // Tizayuca, until a super admin activates it.
    expect(await served("hidalgo", "tizayuca")).toBeNull();
    // A municipality of the database without a locality.
    expect(await served(STATE_SLUG, UNSERVED_MUNICIPALITY)).toBeNull();
  });

  it("activating a locality is data only", async () => {
    await setActive(f.localityB, true);
    try {
      expect(await served(STATE_SLUG, "pueblo-dos")).toMatchObject({
        code: f.localityB,
        contactWhatsapp: "7719990002",
      });
    } finally {
      await setActive(f.localityB, false);
    }
    expect(await served(STATE_SLUG, "pueblo-dos")).toBeNull();
  });
});

// docs/specs/public-directory.md: the routes answer 404 when servedLocality
// returns null; they arrive with the public directory.
describe("Unknown or inactive state and municipality answer 404 (v2)", () => {
  it("a state that does not exist", async () => {
    expect(await served("atlantida", "tizayuca")).toBeNull();
    expect(await served("atlantida", "pueblo-uno")).toBeNull();
  });

  it("a municipality under the wrong state", async () => {
    // Both states and both municipalities exist; Pueblo Uno is active.
    expect(await served("hidalgo", "pueblo-uno")).toBeNull();
    expect(await served(STATE_SLUG, "tizayuca")).toBeNull();
  });

  it("a segment that cannot be a slug", async () => {
    expect(await served(STATE_SLUG.toUpperCase(), "pueblo-uno")).toBeNull();
    expect(await served(STATE_SLUG, "pueblo-uno/")).toBeNull();
    expect(await served(STATE_SLUG, "")).toBeNull();
  });
});
