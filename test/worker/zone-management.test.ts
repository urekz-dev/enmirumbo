// Scenarios of docs/specs/admin-review.md, "The admin can hide and rename the
// zones of a locality (v2)" and "The admin can add a zone to a locality
// (v2)", and of docs/specs/data-model.md, "Catalogues of categories, zones and
// trades with stable slug (v2)" and "The slugs of the catalogues do not
// produce ambiguous URLs at the root of a locality (v2)", against the
// database: the three writes of the zones screen (src/core/zones/), what the
// registration and the edit offer afterwards, the checks of a new or renamed
// zone, and who may do it. The screen is rendered in test/astro/zones.test.ts
// and walked end to end, through Access, in test/e2e/admin-zones.spec.ts.
//
// Everything happens in the fixture localities of state 78, never in
// Tizayuca, whose 105 zones other files count: users are of the domain
// zones.enmirumbo.test, roles start with zonestest_, and the extra trades
// with giro-prueba-78-; all of it is removed before and after.
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { PERMISSIONS, type Permission } from "../../src/core/access/permissions.ts";
import { can } from "../../src/core/access/queries.ts";
import { localitySegment } from "../../src/core/catalogue/pages.ts";
import { RESERVED_SEGMENTS } from "../../src/core/catalogue/root-urls.ts";
import { slugOf } from "../../src/core/catalogue/slug.ts";
import {
  businesses,
  roleAssignments,
  rolePermissions,
  roles,
  trades,
  users,
  zones,
} from "../../src/core/db/schema/index.ts";
import { editForm } from "../../src/core/edit/card.ts";
import { registrationCatalogue } from "../../src/core/registration/catalogue.ts";
import { chooseZone } from "../../src/core/registration/zone.ts";
import type { PanelLocality } from "../../src/core/review/localities.ts";
import {
  addZone,
  panelZones,
  renameZone,
  setZoneVisibility,
  zoneTypes,
} from "../../src/core/zones/manage.ts";
import { parseZoneId, zoneAnchor, zonesFormAction, zonesPath } from "../../src/core/zones/paths.ts";
import { cleanZoneName, MAX_ZONE_NAME_LENGTH, nameProblem } from "../../src/core/zones/rules.ts";
import { chosenZonesLocality, zonesLocalities } from "../../src/core/zones/scope.ts";
import { PUBLIC_DELAY } from "../../src/core/review/texts.ts";
import { nameProblemText, zonesCountText, zonesHeading } from "../../src/core/zones/texts.ts";
import {
  submittedName,
  submittedType,
  submittedVisibility,
  submittedZone,
  zonesActionLocality,
  ZONES_ROUTE,
} from "../../src/lib/zones.ts";
import { cleanup, createFixture, db, type Fixture, insertBusiness } from "./fixtures.ts";

const STATE = "78";
const DOMAIN = "@zones.enmirumbo.test";
const ROLE_PREFIX = "zonestest_";
const LOCALITY_NAME = "Pueblo Uno";
let f: Fixture;
/** The zones of locality A this file adds, by name, with their ids. */
const zone: Record<string, number> = {};
/** The first trade of the fixture, "Giro de prueba 78 uno". */
const TRADE = `giro-prueba-${STATE}-uno`;

async function removeTestData(): Promise<void> {
  await db(async (tx) => {
    await tx.delete(users).where(like(users.email, `%${DOMAIN}`));
    await tx.delete(roles).where(like(roles.key, `${ROLE_PREFIX}%`));
  });
  await cleanup(STATE);
}

beforeAll(async () => {
  await removeTestData();
  f = await createFixture(STATE);
  const rows = await db((tx) =>
    tx
      .insert(zones)
      .values(
        [
          ["Colonia", "El Carmen", "colonia-el-carmen"],
          ["Fraccionamiento", "El Carmen", "fraccionamiento-el-carmen"],
          ["Pueblo", "Huertas", "huertas"],
          ["Barrio", "Zeta", "z"],
        ].map(([type, name, slug]) => ({
          localityCode: f.localityA,
          type: type!,
          name: name!,
          slug: slug!,
        })),
      )
      .returning({ id: zones.id, slug: zones.slug }),
  );
  for (const row of rows) zone[row.slug] = row.id;
  // Two trades whose slugs nest, to see a URL read in two ways.
  await db((tx) =>
    tx.insert(trades).values([
      { name: `Giro de prueba ${STATE} x`, slug: `giro-prueba-${STATE}-x` },
      { name: `Giro de prueba ${STATE} x y`, slug: `giro-prueba-${STATE}-x-y` },
    ]),
  );
});

afterAll(removeTestData);

const localityA = () => ({ code: f.localityA, name: LOCALITY_NAME });

/** The zones the registration of locality A offers, by display name. */
async function offered(): Promise<string[]> {
  const catalogue = await db((tx) => registrationCatalogue(tx, localityA()));
  return catalogue.zones.map(({ displayName }) => displayName);
}

/** The stored row of a zone. */
async function stored(id: number) {
  const [row] = await db((tx) => tx.select().from(zones).where(eq(zones.id, id)));
  return row!;
}

async function createUser(name: string, active = true): Promise<string> {
  const email = `${name}${DOMAIN}`;
  await db((tx) => tx.insert(users).values({ email, name, active }));
  return email;
}

async function assign(email: string, roleKey: string, localityCode: string | null): Promise<void> {
  await db(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.email, email));
    const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey));
    await tx.insert(roleAssignments).values({
      userId: user!.id,
      roleId: role!.id,
      roleScope: role!.scope,
      localityCode,
    });
  });
}

/** A locality role of this file holding exactly `granted`. */
async function role(key: string, granted: Permission[]): Promise<string> {
  const roleKey = `${ROLE_PREFIX}${key}`;
  await db(async (tx) => {
    const [row] = await tx
      .insert(roles)
      .values({ key: roleKey, name: `Rol de prueba ${key}`, scope: "locality" })
      .returning({ id: roles.id });
    for (const permissionKey of granted) {
      await tx.insert(rolePermissions).values({ roleId: row!.id, permissionKey });
    }
  });
  return roleKey;
}

describe("The admin can hide and rename the zones of a locality (v2)", () => {
  // Scenario: hide
  it("a hidden zone is no longer offered in the registration form, and showing it offers it again", async () => {
    expect(await offered()).toContain("Huertas");

    expect(await db((tx) => setZoneVisibility(tx, f.localityA, zone["huertas"]!, false))).toEqual({
      kind: "done",
      zoneId: zone["huertas"],
    });
    expect((await stored(zone["huertas"]!)).visible).toBe(false);
    expect(await offered()).not.toContain("Huertas");
    // Typed by hand, it is kept as the free text of "Otra".
    const catalogue = await db((tx) => registrationCatalogue(tx, localityA()));
    expect(chooseZone("Huertas", catalogue.zones)).toEqual({ zoneId: null, zoneOther: "Huertas" });

    // Hiding is idempotent, and showing undoes it.
    await db((tx) => setZoneVisibility(tx, f.localityA, zone["huertas"]!, false));
    await db((tx) => setZoneVisibility(tx, f.localityA, zone["huertas"]!, true));
    expect(await offered()).toContain("Huertas");
  });

  it("a hidden zone is no longer offered in the edit form, but a card that has it keeps it", async () => {
    const inHuertas = await insertBusiness(f, {
      zoneId: zone["huertas"]!,
      status: "published",
      publishedAt: new Date(),
    });
    const elsewhere = await insertBusiness(f, { status: "published", publishedAt: new Date() });
    await db((tx) => setZoneVisibility(tx, f.localityA, zone["huertas"]!, false));
    try {
      const other = await db((tx) => editForm(tx, localityA(), elsewhere));
      expect(other?.catalogue.zones.map(({ id }) => id)).not.toContain(zone["huertas"]);
      // The card's own zone is still offered, so a field left as it was keeps it.
      const own = await db((tx) => editForm(tx, localityA(), inHuertas));
      expect(own?.catalogue.zones.map(({ id }) => id)).toContain(zone["huertas"]);
      const [card] = await db((tx) =>
        tx.select().from(businesses).where(eq(businesses.id, inHuertas)),
      );
      expect(card?.zoneId).toBe(zone["huertas"]);
      // Its trade and zone page still reads, since a slug never changes.
      expect(await db((tx) => localitySegment(tx, f.localityA, `${TRADE}-huertas`))).toMatchObject({
        kind: "trade+zone",
        zone: { slug: "huertas" },
      });
    } finally {
      await db((tx) => setZoneVisibility(tx, f.localityA, zone["huertas"]!, true));
      await db((tx) => tx.delete(businesses).where(eq(businesses.localityCode, f.localityA)));
    }
  });

  it("hiding or showing a zone that is not of the locality is not found", async () => {
    expect(await db((tx) => setZoneVisibility(tx, f.localityA, f.zoneB, false))).toEqual({
      kind: "not-found",
    });
    expect(await db((tx) => setZoneVisibility(tx, f.localityA, 2_000_000_000, false))).toEqual({
      kind: "not-found",
    });
    expect((await stored(f.zoneB)).visible).toBe(true);
  });

  // Scenario: rename
  it("a renamed zone shows its new name everywhere, and its slug and URLs do not change", async () => {
    try {
      expect(
        await db((tx) => renameZone(tx, f.localityA, zone["huertas"]!, "Las Huertas")),
      ).toEqual({ kind: "done", zoneId: zone["huertas"] });
      expect(await stored(zone["huertas"]!)).toMatchObject({
        name: "Las Huertas",
        slug: "huertas",
      });
      expect(await offered()).toContain("Las Huertas");
      expect(await offered()).not.toContain("Huertas");
      expect(await db((tx) => localitySegment(tx, f.localityA, `${TRADE}-huertas`))).toMatchObject({
        kind: "trade+zone",
        zone: { slug: "huertas", name: "Las Huertas" },
      });
      const screen = await db((tx) => panelZones(tx, f.localityA, LOCALITY_NAME));
      expect(screen.zones.find(({ id }) => id === zone["huertas"])).toMatchObject({
        name: "Las Huertas",
        displayName: "Las Huertas",
        slug: "huertas",
      });
    } finally {
      await db((tx) => renameZone(tx, f.localityA, zone["huertas"]!, "Huertas"));
    }
  });

  it("a rename may repeat a name only while the display names still tell the zones apart", async () => {
    try {
      // Scenario of public-directory: a renamed zone takes the name of another.
      expect(
        await db((tx) => renameZone(tx, f.localityA, zone["huertas"]!, "El Carmen")),
      ).toMatchObject({ kind: "done" });
      const names = (await db((tx) => panelZones(tx, f.localityA, LOCALITY_NAME))).zones.map(
        ({ displayName }) => displayName,
      );
      expect(names).toEqual(
        expect.arrayContaining([
          "El Carmen (Colonia)",
          "El Carmen (Fraccionamiento)",
          "El Carmen (Pueblo)",
        ]),
      );
      expect(await offered()).toContain("El Carmen (Pueblo)");

      // A colonia named "El Carmen" would read like the one there is.
      for (const name of [
        "El Carmen",
        "el carmen",
        "El Carmen (Fraccionamiento)",
        "El Carmen colonia",
      ]) {
        const outcome = await db((tx) => renameZone(tx, f.localityA, f.zoneA, name));
        expect({ name, outcome }).toMatchObject({ name, outcome: { kind: "invalid" } });
        if (outcome.kind === "invalid") expect(outcome.errors.name?.kind).toBe("display-clash");
      }
      const clash = await db((tx) => renameZone(tx, f.localityA, f.zoneA, "El Carmen"));
      expect(clash).toEqual({
        kind: "invalid",
        errors: { name: { kind: "display-clash", displayName: "El Carmen (Colonia)" } },
      });
      expect((await stored(f.zoneA)).name).toBe("Centro");
    } finally {
      await db((tx) => renameZone(tx, f.localityA, zone["huertas"]!, "Huertas"));
    }
  });

  it("a rename checks the name on its own: required, at most 80 characters, with letters", async () => {
    const cases: [string, string][] = [
      ["", "required"],
      ["   ", "required"],
      ["a".repeat(MAX_ZONE_NAME_LENGTH + 1), "too-long"],
      ["¡¡¡ !!!", "no-letters"],
      ["🎉", "no-letters"],
    ];
    for (const [typed, kind] of cases) {
      const outcome = await db((tx) => renameZone(tx, f.localityA, f.zoneA, cleanZoneName(typed)));
      expect({ typed, outcome }).toEqual({
        typed,
        outcome: { kind: "invalid", errors: { name: { kind } } },
      });
    }
    // The name as it is is no change at all.
    expect(await db((tx) => renameZone(tx, f.localityA, f.zoneA, "Centro"))).toEqual({
      kind: "done",
      zoneId: f.zoneA,
    });
    // A zone of another locality, or none, is not found.
    expect(await db((tx) => renameZone(tx, f.localityA, f.zoneB, "Otro Centro"))).toEqual({
      kind: "not-found",
    });
    expect((await stored(f.zoneB)).name).toBe("Centro");
  });
});

describe("The admin can add a zone to a locality (v2)", () => {
  /** Removes the zones of locality A this test added. */
  const removeAdded = (...slugs: string[]) =>
    db(async (tx) => {
      for (const slug of slugs) {
        await tx
          .delete(zones)
          .where(and(eq(zones.localityCode, f.localityA), eq(zones.slug, slug)));
      }
    });

  it("a new zone takes its slug from its name, is offered at once and can be a card's zone", async () => {
    try {
      const outcome = await db((tx) => addZone(tx, f.localityA, "Real Toledo", "Fraccionamiento"));
      expect(outcome).toMatchObject({ kind: "done" });
      const id = outcome.kind === "done" ? outcome.zoneId : 0;
      expect(await stored(id)).toMatchObject({
        localityCode: f.localityA,
        name: "Real Toledo",
        type: "Fraccionamiento",
        slug: "real-toledo",
        visible: true,
      });
      expect(await offered()).toContain("Real Toledo");
      const catalogue = await db((tx) => registrationCatalogue(tx, localityA()));
      expect(chooseZone("real toledo", catalogue.zones)).toEqual({ zoneId: id, zoneOther: null });
      // Usable on approving: a published card can have it, with its pages.
      await insertBusiness(f, { zoneId: id, status: "published", publishedAt: new Date() });
      expect(
        await db((tx) => localitySegment(tx, f.localityA, `${TRADE}-real-toledo`)),
      ).toMatchObject({ kind: "trade+zone", zone: { id, name: "Real Toledo" } });

      // Accents, the ñ and punctuation, as the slug rule of the catalogues says.
      const accented = await db((tx) =>
        addZone(tx, f.localityA, "Privada Ñandú (2a. sección)", "Fraccionamiento"),
      );
      expect(accented).toMatchObject({ kind: "done" });
      const accentedId = accented.kind === "done" ? accented.zoneId : 0;
      expect((await stored(accentedId)).slug).toBe("privada-nandu-2a-seccion");
    } finally {
      await db((tx) => tx.delete(businesses).where(eq(businesses.localityCode, f.localityA)));
      await removeAdded("real-toledo", "privada-nandu-2a-seccion");
    }
  });

  it("a slug that another zone of the locality has is refused, hidden or renamed ones included", async () => {
    expect(await db((tx) => addZone(tx, f.localityA, "Centro", "Fraccionamiento"))).toEqual({
      kind: "invalid",
      errors: { name: { kind: "slug-taken", slug: "centro", zone: "Centro" } },
    });
    await db((tx) => renameZone(tx, f.localityA, zone["huertas"]!, "Las Huertas"));
    await db((tx) => setZoneVisibility(tx, f.localityA, zone["huertas"]!, false));
    try {
      expect(await db((tx) => addZone(tx, f.localityA, "Huertas", "Colonia"))).toEqual({
        kind: "invalid",
        errors: { name: { kind: "slug-taken", slug: "huertas", zone: "Las Huertas" } },
      });
    } finally {
      await db((tx) => renameZone(tx, f.localityA, zone["huertas"]!, "Huertas"));
      await db((tx) => setZoneVisibility(tx, f.localityA, zone["huertas"]!, true));
    }
    // The same slug in another locality is another zone.
    const elsewhere = await db((tx) => addZone(tx, f.localityB, "Huertas", "Colonia"));
    expect(elsewhere).toMatchObject({ kind: "done" });
  });

  it("a name whose slug is a reserved segment is refused", async () => {
    for (const segment of RESERVED_SEGMENTS) {
      const name = segment.replaceAll("-", " ");
      const outcome = await db((tx) => addZone(tx, f.localityA, name, "Colonia"));
      expect({ segment, outcome }).toEqual({
        segment,
        outcome: {
          kind: "invalid",
          errors: {
            name: { kind: "url-conflict", segment, trade: null, other: { kind: "reserved" } },
          },
        },
      });
    }
  });

  it("a name that would make a URL of the locality read in two ways is refused", async () => {
    // Its slug is a category's.
    expect(
      await db((tx) => addZone(tx, f.localityA, `Categoría prueba ${STATE}`, "Colonia")),
    ).toEqual({
      kind: "invalid",
      errors: {
        name: {
          kind: "url-conflict",
          segment: `categoria-prueba-${STATE}`,
          trade: null,
          other: { kind: "category", name: `Categoría de prueba ${STATE}` },
        },
      },
    });
    // A trade and the zone would compose another trade's slug.
    expect(await db((tx) => addZone(tx, f.localityA, "Y", "Colonia"))).toEqual({
      kind: "invalid",
      errors: {
        name: {
          kind: "url-conflict",
          segment: `giro-prueba-${STATE}-x-y`,
          trade: `Giro de prueba ${STATE} x`,
          other: { kind: "trade", name: `Giro de prueba ${STATE} x y` },
        },
      },
    });
    // Two trade and zone pairs would compose the same segment.
    expect(await db((tx) => addZone(tx, f.localityA, "Y Z", "Colonia"))).toEqual({
      kind: "invalid",
      errors: {
        name: {
          kind: "url-conflict",
          segment: `giro-prueba-${STATE}-x-y-z`,
          trade: `Giro de prueba ${STATE} x`,
          other: { kind: "trade+zone", trade: `Giro de prueba ${STATE} x y`, zone: "Zeta" },
        },
      },
    });
    expect((await db((tx) => panelZones(tx, f.localityA, LOCALITY_NAME))).zones).toHaveLength(5);
  });

  it("a zone named like a trade is no conflict: a zone alone is no page", async () => {
    try {
      expect(
        await db((tx) => addZone(tx, f.localityA, `Giro prueba ${STATE} dos`, "Colonia")),
      ).toMatchObject({ kind: "done" });
    } finally {
      await removeAdded(`giro-prueba-${STATE}-dos`);
    }
  });

  it("a new zone keeps the display names unambiguous", async () => {
    expect(await db((tx) => addZone(tx, f.localityA, "El Carmen", "Colonia"))).toEqual({
      kind: "invalid",
      errors: { name: { kind: "display-clash", displayName: "El Carmen (Colonia)" } },
    });
    try {
      // Another type tells it apart; and a zone named like the locality shows its type.
      expect(await db((tx) => addZone(tx, f.localityA, "El Carmen", "Barrio"))).toMatchObject({
        kind: "done",
      });
      expect(await db((tx) => addZone(tx, f.localityA, LOCALITY_NAME, "Colonia"))).toMatchObject({
        kind: "done",
      });
      expect(await offered()).toEqual(
        expect.arrayContaining(["El Carmen (Barrio)", `${LOCALITY_NAME} (Colonia)`]),
      );
    } finally {
      await removeAdded("el-carmen", "pueblo-uno");
    }
  });

  it("a new zone takes one of the settlement types the locality's zones have", async () => {
    const types = (await db((tx) => panelZones(tx, f.localityA, LOCALITY_NAME))).types;
    expect(types).toEqual(["Barrio", "Colonia", "Fraccionamiento", "Pueblo"]);
    for (const type of ["", "Galaxia", "colonia "]) {
      expect(await db((tx) => addZone(tx, f.localityA, "Real Toledo", type))).toEqual({
        kind: "invalid",
        errors: { type: { kind: "required" } },
      });
    }
    // Both fields come back with their errors at once.
    expect(await db((tx) => addZone(tx, f.localityA, "", ""))).toEqual({
      kind: "invalid",
      errors: { name: { kind: "required" }, type: { kind: "required" } },
    });
  });

  it("a new zone checks the name on its own, and that it has a slug", async () => {
    const cases: [string, string][] = [
      ["", "required"],
      ["a".repeat(MAX_ZONE_NAME_LENGTH + 1), "too-long"],
      ["¡¡¡", "no-letters"],
      ["Straße", "no-slug"],
    ];
    for (const [name, kind] of cases) {
      expect({
        name,
        outcome: await db((tx) => addZone(tx, f.localityA, name, "Colonia")),
      }).toEqual({
        name,
        outcome: { kind: "invalid", errors: { name: { kind } } },
      });
    }
    expect(await db((tx) => addZone(tx, "77001", "Real Toledo", "Colonia"))).toEqual({
      kind: "not-found",
    });
  });
});

describe("Inside the panel, a user can do only what their roles allow (v2): the zones", () => {
  it("only who holds zones.manage in a locality manages its zones there", async () => {
    const founder = await createUser("founder");
    await assign(founder, "super_admin", null);
    const admin = await createUser("locality-admin");
    await assign(admin, "locality_admin", f.localityA);
    const reviewer = await createUser("reviewer");
    await assign(reviewer, await role("reviewer", ["businesses.review"]), f.localityA);
    const zonesOnly = await createUser("zones-only");
    await assign(zonesOnly, await role("zones", ["zones.manage"]), f.localityB);
    const inactive = await createUser("inactive", false);
    await assign(inactive, "locality_admin", f.localityA);

    const codes = async (email: string) =>
      (await db((tx) => zonesLocalities(tx, email))).map(({ code }) => code);
    expect(await codes(founder)).toEqual(expect.arrayContaining([f.localityA, f.localityB]));
    expect(await codes(admin)).toEqual([f.localityA]);
    expect(await codes(reviewer)).toEqual([]);
    expect(await codes(zonesOnly)).toEqual([f.localityB]);
    expect(await codes(inactive)).toEqual([]);

    expect(await db((tx) => can(tx, admin, "zones.manage", f.localityA))).toBe(true);
    expect(await db((tx) => can(tx, admin, "zones.manage", f.localityB))).toBe(false);
    expect(await db((tx) => can(tx, zonesOnly, "zones.manage", f.localityA))).toBe(false);
  });

  it("the permission says it adds, hides and renames zones", () => {
    expect(PERMISSIONS["zones.manage"]).toBe("Agregar, ocultar y renombrar colonias");
  });
});

describe("The zones screen: its locality, its address and its forms", () => {
  const locality = (code: string, active: boolean): PanelLocality => ({
    code,
    name: `Pueblo ${code}`,
    stateName: "Estado de prueba",
    timeZone: "America/Mexico_City",
    active,
  });
  const seen = [locality("78001", false), locality("78002", true), locality("78003", true)];

  it("shows the locality its address names, or the first active one", () => {
    expect(chosenZonesLocality([], seen)?.code).toBe("78002");
    expect(chosenZonesLocality(["78003"], seen)?.code).toBe("78003");
    // An inactive locality of the user opens by its address, to have its zones ready.
    expect(chosenZonesLocality(["78001"], seen)?.code).toBe("78001");
    for (const values of [["13069"], ["78003", "78003"], [""], ["junk"]]) {
      expect(chosenZonesLocality(values, seen)?.code).toBe("78002");
    }
    expect(chosenZonesLocality([], [locality("78001", false)])?.code).toBe("78001");
    expect(chosenZonesLocality([], [])).toBeNull();
  });

  it("its address carries only the locality and the zone just saved", () => {
    expect(zonesPath()).toBe("/admin/colonias");
    expect(zonesPath("13069")).toBe("/admin/colonias?localidad=13069");
    expect(zonesPath("13069", 42)).toBe("/admin/colonias?localidad=13069&listo=42#colonia-42");
    expect(zoneAnchor(42)).toBe("colonia-42");
    expect(zonesFormAction("13069", "?_action=admin.renameZone")).toBe(
      "/admin/colonias?localidad=13069&_action=admin.renameZone",
    );
    expect(parseZoneId("42")).toBe(42);
    for (const value of [null, "", "0", "-1", "4.2", "042", "1e3", "99999999999", " 42"]) {
      expect(parseZoneId(value)).toBeNull();
    }
  });

  it("an action takes only submissions of the screen, about the locality of its address", () => {
    const url = (query: string) => new URL(`http://localhost/admin/colonias${query}`);
    expect(zonesActionLocality({ routePattern: ZONES_ROUTE, url: url("?localidad=13069") })).toBe(
      "13069",
    );
    for (const query of [
      "",
      "?localidad=",
      "?localidad=1306",
      "?localidad=13069&localidad=13069",
    ]) {
      expect(zonesActionLocality({ routePattern: ZONES_ROUTE, url: url(query) })).toBeNull();
    }
    expect(
      zonesActionLocality({ routePattern: "/admin/negocios", url: url("?localidad=13069") }),
    ).toBeNull();
  });

  it("reads its fields without trusting their shape", () => {
    const form = new FormData();
    form.set("zone", "42");
    form.set("visible", "false");
    form.set("name", "  Real‮   Toledo\n ");
    form.set("type", " Fraccionamiento ");
    expect(submittedZone(form)).toBe(42);
    expect(submittedVisibility(form)).toBe(false);
    expect(submittedName(form)).toBe("Real Toledo");
    expect(submittedType(form)).toBe("Fraccionamiento");
    const empty = new FormData();
    empty.set("visible", "si");
    empty.set("zone", new File(["x"], "x.txt"));
    expect(submittedZone(empty)).toBeNull();
    expect(submittedVisibility(empty)).toBeNull();
    expect(submittedName(empty)).toBe("");
  });

  it("names and slugs follow the rules of the catalogues", () => {
    expect(cleanZoneName("  Los   Pinos\t")).toBe("Los Pinos");
    expect(nameProblem("Los Pinos")).toBeNull();
    expect(slugOf("Haciendas de Tizayuca")).toBe("haciendas-de-tizayuca");
    expect(slugOf("Privada Ñandú")).toBe("privada-nandu");
    expect(slugOf("Straße")).toBeNull();
    expect(zoneTypes([{ type: "Pueblo" }, { type: "Barrio" }, { type: "Pueblo" }])).toEqual([
      "Barrio",
      "Pueblo",
    ]);
  });

  it("its copy", () => {
    expect(PUBLIC_DELAY).toBe(
      "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.",
    );
    expect(zonesHeading("Tizayuca")).toBe("Colonias de Tizayuca");
    expect(zonesCountText(105, 0)).toBe("105 colonias");
    expect(zonesCountText(105, 2)).toBe("105 colonias, 2 ocultas");
    expect(zonesCountText(1, 1)).toBe("1 colonia, 1 oculta");
    expect(
      nameProblemText(
        {
          kind: "url-conflict",
          segment: "salud",
          trade: null,
          other: { kind: "category", name: "Salud" },
        },
        "Salud",
        "Colonia",
      ),
    ).toBe(
      "Con ese nombre, la URL «salud» se confundiría con la categoría «Salud». Ponle otro nombre; por ejemplo, con su tipo adelante: «Colonia Salud».",
    );
    expect(
      nameProblemText(
        { kind: "slug-taken", slug: "huertas", zone: "Las Huertas" },
        "Huertas",
        null,
      ),
    ).toBe(
      "Ya hay una colonia con esa misma URL (huertas): «Las Huertas». Si es la misma, búscala en la lista para mostrarla o cambiarle el nombre; si es otra, ponle un nombre distinto.",
    );
    expect(
      nameProblemText({ kind: "display-clash", displayName: "El Carmen (Colonia)" }, "x", null),
    ).toBe(
      "Ya hay otra colonia que se vería igual: «El Carmen (Colonia)». Ponle un nombre distinto.",
    );
  });
});
