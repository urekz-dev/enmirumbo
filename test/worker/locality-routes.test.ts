// Scenarios of docs/specs/public-directory.md, requirements:
// - "Public URLs carry the state and the municipality (v2)"
// - "Unknown or inactive state and municipality answer 404 (v2)"
// - "While there is one active locality, the root redirects to it (v2)"
// - "With two or more active localities the root lists them and never redirects by location (v2)"
// - "Geolocation is only a suggestion of the nearest locality (v2)"
// - "The chosen locality is remembered in a cookie that holds only its slug (v2)"
// - "The pages of a locality offer to change municipality while two or more are active (v2)"
// the pieces behind them: the active localities (src/core/locality/served.ts),
// the root (src/core/locality/root.ts), the paths
// (src/core/locality/paths.ts), the middleware's gate, the redirects and the
// locality cookie (src/lib/locality.ts). The two fixture localities of this
// file are the two active localities of the database checks. The pages
// themselves are covered by test/e2e/locality-routes.spec.ts (one active
// locality) and test/e2e/localities-list.spec.ts (two). Other test files add
// active fixture localities while this one runs, so the database checks look
// only at this file's state.
import { env, waitUntil } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { withDb } from "../../src/core/db/client.ts";
import { localities, municipalities, states } from "../../src/core/db/schema/index.ts";
import { isReservedSegment } from "../../src/core/catalogue/root-urls.ts";
import { CHANGE_LOCALITY_PATH, choicePath, localityPath } from "../../src/core/locality/paths.ts";
import { choiceTarget, chosenLocality, rootDestination } from "../../src/core/locality/root.ts";
import {
  activeLocalities,
  servedLocality,
  type ServedLocality,
} from "../../src/core/locality/served.ts";
import {
  gateLocalityRequest,
  isLocalityRoute,
  LOCALITY_COOKIE,
  localityCookieOptions,
  permanentRedirect,
  requireLocality,
  temporaryRedirect,
  type FindLocality,
  type LocalityGateContext,
} from "../../src/lib/locality.ts";
import { cleanup, createFixture, db, type Fixture, UNSERVED_MUNICIPALITY } from "./fixtures.ts";

const STATE = "94";
const STATE_SLUG = `estado-de-prueba-${STATE}`;
let f: Fixture;

beforeAll(async () => {
  f = await createFixture(STATE);
});

afterAll(async () => {
  await cleanup(STATE);
});

/** A locality as servedLocality returns it, made up for the pure checks. */
function locality(
  stateSlug: string,
  slug: string,
  seat: ServedLocality["seat"] = null,
): ServedLocality {
  return {
    code: "00000",
    name: slug,
    slug,
    state: { code: "00", name: stateSlug, slug: stateSlug },
    timeZone: "America/Mexico_City",
    contactWhatsapp: "7719990001",
    othersActive: true,
    seat,
  };
}

/** Tizayuca with the seat drizzle/0009_tizayuca_coordinates.sql gives it. */
const HIDALGO_TIZAYUCA = locality("hidalgo", "tizayuca", {
  latitude: 19.8410889,
  longitude: -98.9815842,
});
const OTHER = locality("estado-de-prueba", "pueblo-uno");
/** The same municipality slug in another state. */
const TWIN = locality("estado-de-prueba", "tizayuca");

const setActive = (code: string, active: boolean) =>
  db((tx) => tx.update(localities).set({ active }).where(eq(localities.code, code)));

/** The active localities of this file's fixture state. */
async function activeHere(): Promise<string[]> {
  const all = await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, activeLocalities);
  return all.filter((l) => l.state.code === STATE).map((l) => l.slug);
}

describe("Public URLs carry the state and the municipality (v2)", () => {
  it("the home of a locality is /{estado}/{municipio}, read from its record", () => {
    expect(localityPath(HIDALGO_TIZAYUCA)).toBe("/hidalgo/tizayuca");
  });

  it("every page of a locality hangs from its prefix", () => {
    expect(localityPath(HIDALGO_TIZAYUCA, "plomeria-haciendas-de-tizayuca")).toBe(
      "/hidalgo/tizayuca/plomeria-haciendas-de-tizayuca",
    );
    expect(localityPath(HIDALGO_TIZAYUCA, "negocio", "plomeria-de-prueba-a1b2c3d4")).toBe(
      "/hidalgo/tizayuca/negocio/plomeria-de-prueba-a1b2c3d4",
    );
  });

  it("a segment cannot add a level or leave the path", () => {
    expect(localityPath(HIDALGO_TIZAYUCA, "a/b", "?x=1")).toBe("/hidalgo/tizayuca/a%2Fb/%3Fx%3D1");
  });

  it("the middleware resolves the locality of every page under the prefix, and only there", () => {
    for (const route of [
      "/[state]/[municipality]",
      "/[state]/[municipality]/[segment]",
      "/[state]/[municipality]/negocio/[card]",
    ]) {
      expect(isLocalityRoute(route), route).toBe(true);
    }
    for (const route of [
      "/",
      "/admin",
      "/admin/[...path]",
      "/health",
      "/robots.txt",
      "/404",
      "/_actions/[...path]",
      "/[state]",
      "/[state]/[municipalityx]",
    ]) {
      expect(isLocalityRoute(route), route).toBe(false);
    }
  });

  it("no state or municipality slug of the database is one of the site's own segments", async () => {
    const slugs = await db(async (tx) => [
      ...(await tx.select({ slug: states.slug }).from(states)),
      ...(await tx.select({ slug: municipalities.slug }).from(municipalities)),
    ]);
    expect(slugs.map(({ slug }) => slug)).toEqual(expect.arrayContaining(["hidalgo", "tizayuca"]));
    expect(slugs.filter(({ slug }) => isReservedSegment(slug))).toEqual([]);
  });
});

describe("Unknown or inactive state and municipality answer 404 (v2)", () => {
  /** Runs the gate on a route and reports what it did. */
  async function gate(
    routePattern: string,
    params: Record<string, string | undefined>,
    find: FindLocality,
  ) {
    const context: LocalityGateContext = { routePattern, params, locals: {} };
    const next = vi.fn(async () => new Response("page"));
    const response = await gateLocalityRequest(context, next, find);
    return { response, next, locals: context.locals };
  }

  const fromDatabase: FindLocality = (stateSlug, municipalitySlug) =>
    withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (tx) =>
      servedLocality(tx, stateSlug, municipalitySlug),
    );

  it("an active locality reaches its page with the locality in locals", async () => {
    const { response, next, locals } = await gate(
      "/[state]/[municipality]",
      { state: STATE_SLUG, municipality: "pueblo-uno" },
      fromDatabase,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(await response.text()).toBe("page");
    expect(locals.locality).toMatchObject({ code: f.localityA, name: "Pueblo Uno" });
    expect(requireLocality(locals)).toBe(locals.locality);
  });

  it.for([
    ["a state that does not exist", "atlantida", "pueblo-uno"],
    ["a municipality the database does not hold", "hidalgo", "pachuca-de-soto"],
    ["a municipality whose locality is not active", STATE_SLUG, "pueblo-dos"],
    ["a municipality without a locality", STATE_SLUG, UNSERVED_MUNICIPALITY],
    ["a municipality under the wrong state", "hidalgo", "pueblo-uno"],
    ["a segment that cannot be a slug", STATE_SLUG.toUpperCase(), "pueblo-uno"],
  ] as const)(
    "%s answers an empty 404 and the page never runs",
    async ([, state, municipality]) => {
      const { response, next, locals } = await gate(
        "/[state]/[municipality]/[segment]",
        { state, municipality, segment: "plomeria" },
        fromDatabase,
      );
      expect(response.status).toBe(404);
      // An empty body is what makes Astro render the site's 404 page.
      expect(response.body).toBeNull();
      expect(next).not.toHaveBeenCalled();
      expect(locals.locality).toBeUndefined();
    },
  );

  it("missing parameters answer 404 without asking the database", async () => {
    const find = vi.fn<FindLocality>();
    const { response } = await gate("/[state]/[municipality]", { state: "hidalgo" }, find);
    expect(response.status).toBe(404);
    expect(find).not.toHaveBeenCalled();
  });

  it("other routes pass through without a lookup", async () => {
    const find = vi.fn<FindLocality>();
    for (const route of ["/", "/admin", "/health", "/robots.txt", "/404"]) {
      const { response, next } = await gate(route, {}, find);
      expect(next, route).toHaveBeenCalledOnce();
      expect(response.status, route).toBe(200);
    }
    expect(find).not.toHaveBeenCalled();
  });

  it("a page outside a locality cannot ask for one", () => {
    expect(() => requireLocality({})).toThrow(/not under/);
  });

  it("activating a locality serves it, deactivating it answers 404 again", async () => {
    const route = "/[state]/[municipality]";
    const params = { state: STATE_SLUG, municipality: "pueblo-dos" };
    await setActive(f.localityB, true);
    try {
      expect((await gate(route, params, fromDatabase)).locals.locality?.code).toBe(f.localityB);
    } finally {
      await setActive(f.localityB, false);
    }
    expect((await gate(route, params, fromDatabase)).response.status).toBe(404);
  });
});

describe("While there is one active locality, the root redirects to it (v2)", () => {
  it("the active localities are read from the database, inactive ones left out", async () => {
    expect(await activeHere()).toEqual(["pueblo-uno"]);
    await setActive(f.localityB, true);
    try {
      expect(await activeHere()).toEqual(["pueblo-dos", "pueblo-uno"]);
    } finally {
      await setActive(f.localityB, false);
    }
  });

  it("the root: one active locality is a redirect to its home", () => {
    expect(rootDestination([HIDALGO_TIZAYUCA])).toEqual({
      kind: "locality",
      locality: HIDALGO_TIZAYUCA,
    });
    expect(localityPath(HIDALGO_TIZAYUCA)).toBe("/hidalgo/tizayuca");
  });

  it("no chooser: a cookie, a choice or a request to change still redirect to it", () => {
    for (const request of [
      { chosen: "pueblo-uno" },
      { choose: "estado-de-prueba/pueblo-uno" },
      { choose: "hidalgo/tizayuca" },
      { changing: true },
    ]) {
      expect(rootDestination([HIDALGO_TIZAYUCA], request), JSON.stringify(request)).toEqual({
        kind: "locality",
        locality: HIDALGO_TIZAYUCA,
      });
    }
  });

  it("read from the record: another locality and its own path", async () => {
    const here = (await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, activeLocalities)).filter(
      (l) => l.state.code === STATE,
    );
    expect(here).toHaveLength(1);
    expect(rootDestination(here)).toEqual({ kind: "locality", locality: here[0] });
    expect(localityPath(here[0]!)).toBe(`/${STATE_SLUG}/pueblo-uno`);
  });

  it("with no active locality there is nothing to redirect to", () => {
    expect(rootDestination([])).toEqual({ kind: "none" });
    expect(rootDestination([], { chosen: "tizayuca", choose: "hidalgo/tizayuca" })).toEqual({
      kind: "none",
    });
  });

  it("the redirect is a 301 that browsers keep for an hour at most", async () => {
    const response = permanentRedirect("/hidalgo/tizayuca");
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/hidalgo/tizayuca");
    expect(response.headers.get("Cache-Control")).toBe("max-age=3600");
    expect(await response.text()).toBe("");
  });
});

describe("With two or more active localities the root lists them and never redirects by location (v2)", () => {
  it("the list: the root does not redirect, it lists them in order", () => {
    expect(rootDestination([HIDALGO_TIZAYUCA, OTHER])).toEqual({
      kind: "list",
      localities: [HIDALGO_TIZAYUCA, OTHER],
      suggested: null,
    });
  });

  it("each entry leads to its home through the choice", () => {
    expect(choicePath(HIDALGO_TIZAYUCA)).toBe("/?elegir=hidalgo/tizayuca");
    expect(choicePath(OTHER)).toBe("/?elegir=estado-de-prueba/pueblo-uno");
  });

  it("the list is read from the database with both fixture localities", async () => {
    await setActive(f.localityB, true);
    try {
      const all = await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, activeLocalities);
      const here = all.filter((l) => l.state.code === STATE);
      expect(rootDestination(all)).toMatchObject({ kind: "list" });
      expect(here.map((l) => [l.name, l.state.name, choicePath(l)])).toEqual([
        ["Pueblo Dos", `Estado de prueba ${STATE}`, `/?elegir=${STATE_SLUG}/pueblo-dos`],
        ["Pueblo Uno", `Estado de prueba ${STATE}`, `/?elegir=${STATE_SLUG}/pueblo-uno`],
      ]);
    } finally {
      await setActive(f.localityB, false);
    }
  });
});

describe("Geolocation is only a suggestion of the nearest locality (v2)", () => {
  /** Pachuca de Soto's seat is about 40 km north-east of Tizayuca's. */
  const NEAR_TIZAYUCA = { latitude: 20.1, longitude: -98.75 };
  const FAR_AWAY = { latitude: 37.386, longitude: -122.0838 };
  const SECOND = locality("estado-de-prueba", "pueblo-con-sede", { latitude: 21, longitude: -101 });

  // Scenario: the nearest is highlighted
  it("the list suggests the locality whose seat is nearest to the visitor", () => {
    const both = [HIDALGO_TIZAYUCA, SECOND];
    expect(rootDestination(both, { location: NEAR_TIZAYUCA })).toEqual({
      kind: "list",
      localities: both,
      suggested: HIDALGO_TIZAYUCA,
    });
    expect(rootDestination(both, { location: { latitude: 21.1, longitude: -101.1 } })).toEqual({
      kind: "list",
      localities: both,
      suggested: SECOND,
    });
  });

  // Scenario: a crawler gets the same list
  it("wherever the visitor is, the answer is the list, never a redirect", () => {
    const both = [HIDALGO_TIZAYUCA, SECOND];
    expect(rootDestination(both, { location: FAR_AWAY })).toMatchObject({ kind: "list" });
    // One active locality: the same 301 with or without a location.
    expect(rootDestination([SECOND], { location: NEAR_TIZAYUCA })).toEqual({
      kind: "locality",
      locality: SECOND,
    });
  });

  // Scenario: no location
  it("without a location no locality is suggested", () => {
    expect(rootDestination([HIDALGO_TIZAYUCA, SECOND], { location: null })).toMatchObject({
      suggested: null,
    });
  });

  // Scenario: a locality without coordinates
  it("a locality without coordinates is listed but never suggested", () => {
    // OTHER has no seat: even a visitor far from Tizayuca gets Tizayuca, the
    // only one placed, and with no placed locality there is no suggestion.
    expect(rootDestination([HIDALGO_TIZAYUCA, OTHER], { location: FAR_AWAY })).toEqual({
      kind: "list",
      localities: [HIDALGO_TIZAYUCA, OTHER],
      suggested: HIDALGO_TIZAYUCA,
    });
    expect(
      rootDestination([OTHER, locality("otro-estado", "otro")], { location: FAR_AWAY }),
    ).toEqual(expect.objectContaining({ kind: "list", suggested: null }));
  });

  it("the seat is read with the locality, null while it has no coordinates", async () => {
    const seatOf = async (municipality: string) =>
      (
        await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (tx) =>
          servedLocality(tx, STATE_SLUG, municipality),
        )
      )?.seat;
    expect(await seatOf("pueblo-uno")).toBeNull();
    await db((tx) =>
      tx
        .update(localities)
        .set({ latitude: 21, longitude: -101 })
        .where(eq(localities.code, f.localityA)),
    );
    try {
      expect(await seatOf("pueblo-uno")).toEqual({ latitude: 21, longitude: -101 });
    } finally {
      await db((tx) =>
        tx
          .update(localities)
          .set({ latitude: null, longitude: null })
          .where(eq(localities.code, f.localityA)),
      );
    }
  });
});

describe("The chosen locality is remembered in a cookie that holds only its slug (v2)", () => {
  const BOTH = [HIDALGO_TIZAYUCA, OTHER];
  const LIST = { kind: "list", localities: BOTH, suggested: null };

  it("choosing: `?elegir=` names the locality to store and go to", () => {
    expect(rootDestination(BOTH, { choose: "hidalgo/tizayuca" })).toEqual({
      kind: "choose",
      locality: HIDALGO_TIZAYUCA,
    });
    // A new choice wins over the cookie and over a request to change.
    expect(
      rootDestination(BOTH, { choose: "estado-de-prueba/pueblo-uno", chosen: "tizayuca" }),
    ).toEqual({
      kind: "choose",
      locality: OTHER,
    });
  });

  it("a choice that names no active locality chooses nothing", () => {
    for (const value of [
      "hidalgo/pachuca-de-soto",
      "jalisco/tizayuca",
      "tizayuca",
      "hidalgo/tizayuca/negocio",
      "/hidalgo/tizayuca",
      "Hidalgo/Tizayuca",
      "https://evil.example/x",
      "",
      null,
    ]) {
      expect(choiceTarget(BOTH, value), String(value)).toBeNull();
      expect(rootDestination(BOTH, { choose: value })).toEqual(LIST);
    }
  });

  it("coming back: the cookie redirects to the locality it names", () => {
    expect(rootDestination(BOTH, { chosen: "tizayuca" })).toEqual({
      kind: "chosen",
      locality: HIDALGO_TIZAYUCA,
    });
  });

  it("a stale cookie is ignored and the list shown", () => {
    for (const value of ["pachuca-de-soto", "Tizayuca", "hidalgo/tizayuca", "", "tizayuca;x=1"]) {
      expect(chosenLocality(BOTH, value), value).toBeNull();
      expect(rootDestination(BOTH, { chosen: value })).toEqual(LIST);
    }
    expect(chosenLocality(BOTH, undefined)).toBeNull();
  });

  it("a slug that two active localities share names neither", () => {
    expect(chosenLocality([HIDALGO_TIZAYUCA, TWIN, OTHER], "tizayuca")).toBeNull();
    // Choosing from the list still tells them apart, by their state.
    expect(choiceTarget([HIDALGO_TIZAYUCA, TWIN], "estado-de-prueba/tizayuca")).toBe(TWIN);
  });

  it("the cookie: only the slug, for the whole site, a year, no scripts, Lax, Secure on HTTPS", () => {
    expect(LOCALITY_COOKIE).toBe("locality");
    expect(localityCookieOptions(new URL("https://enmirumbo.com/"))).toEqual({
      path: "/",
      maxAge: 31_536_000,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
    expect(localityCookieOptions(new URL("http://localhost:4321/")).secure).toBe(false);
  });

  it("those redirects are a 302 that nothing keeps", async () => {
    const response = temporaryRedirect("/hidalgo/tizayuca");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/hidalgo/tizayuca");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});

describe("The pages of a locality offer to change municipality while two or more are active (v2)", () => {
  it("`?cambiar` shows the list even with a cookie", () => {
    expect(CHANGE_LOCALITY_PATH).toBe("/?cambiar");
    expect(
      rootDestination([HIDALGO_TIZAYUCA, OTHER], { chosen: "tizayuca", changing: true }),
    ).toEqual({ kind: "list", localities: [HIDALGO_TIZAYUCA, OTHER], suggested: null });
  });

  it("a served locality knows when another one is active", async () => {
    const find = (municipality: string) =>
      withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (tx) =>
        servedLocality(tx, STATE_SLUG, municipality),
      );
    await setActive(f.localityB, true);
    try {
      expect((await find("pueblo-uno"))?.othersActive).toBe(true);
      expect((await find("pueblo-dos"))?.othersActive).toBe(true);
      const all = await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, activeLocalities);
      expect(all.every((l) => l.othersActive)).toBe(true);
    } finally {
      await setActive(f.localityB, false);
    }
    // While pueblo-uno is the only active one of this file, the flag depends
    // on the other test files' fixtures; test/e2e/locality-routes.spec.ts
    // checks it with Tizayuca as the only active locality.
    expect(typeof (await find("pueblo-uno"))?.othersActive).toBe("boolean");
  });
});
