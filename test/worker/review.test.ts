// Scenarios of docs/specs/admin-review.md on the data of the review screens,
// against the database: "Review queue with the pending registrations, oldest
// first", "Visible indicator for registrations waiting more than 48 hours",
// "The queue tells which businesses have unattended reports", "'Todos los
// negocios' view with the status in sight and an entry to the detail", "The
// listing is filtered by status without leaving the view", "The listing is
// cut into pages and does not degrade when there are many records", "The
// listing searches by name or WhatsApp (v2)", "Registration detail with all
// the captured data, only inside the panel", "The business detail lists its
// unattended reports", "The pending edit detail compares what is published
// with what is proposed", "The detail of a pending edit shows the photo it
// proposes (v2)", "Inside the panel, a user can do only what their roles
// allow (v2)" and "Each review screen checks its permission in the locality
// of what it shows (v2)". The screens are rendered in test/astro/review.test.ts
// and run end to end through Access in test/e2e/admin.spec.ts.
//
// Everything lives in the fictitious state 80 (test/worker/fixtures.ts):
// locality A for the queue and the details, locality B for the list. Users
// are of the domain review.enmirumbo.test and roles start with reviewtest_;
// all of it is removed before and after.
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { PERMISSIONS, type Permission } from "../../src/core/access/permissions.ts";
import { can, permittedLocalities } from "../../src/core/access/queries.ts";
import {
  businesses,
  pendingEdits,
  reports,
  roleAssignments,
  rolePermissions,
  roles,
  users,
} from "../../src/core/db/schema/index.ts";
import { issueManagementLink } from "../../src/core/management-link/link.ts";
import { newPhotoKey } from "../../src/core/photos/photo.ts";
import {
  businessesPage,
  LIST_PAGE_SIZE,
  MAX_LIST_PAGE,
  parseListPage,
  parseSearch,
  parseStatusFilter,
} from "../../src/core/review/businesses.ts";
import {
  changesWhatsapp,
  comparedFields,
  editDetail,
  parseEditId,
} from "../../src/core/review/edit.ts";
import {
  chosenLocality,
  localityFilterOptions,
  panelLocalities,
  withZoneNames,
  zoneNamesByLocality,
  zoneText,
} from "../../src/core/review/localities.ts";
import {
  overdueCount,
  reportedBusinesses,
  reviewQueue,
  type QueueRow,
} from "../../src/core/review/queue.ts";
import { pendingReports, registrationDetail } from "../../src/core/review/registration.ts";
import { CARD_PERMISSIONS, narrowScope, panelScope } from "../../src/core/review/scope.ts";
import {
  isOverdue,
  panelDate,
  panelDateTime,
  REVIEW_GOAL_HOURS,
  waitText,
} from "../../src/core/review/time.ts";
import { verificationLink, verificationMessage } from "../../src/core/review/verification.ts";
import {
  cleanup,
  createFixture,
  db,
  fakePhone,
  type Fixture,
  insertBusiness,
  type NewBusiness,
} from "./fixtures.ts";

const STATE = "80";
const DOMAIN = "@review.enmirumbo.test";
const ROLE_PREFIX = "reviewtest_";
const NOW = new Date();
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const daysAgo = (days: number) => hoursAgo(days * 24);

let f: Fixture;

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
});

afterAll(removeTestData);

/** A card of locality A unless told otherwise, in review unless told otherwise. */
function card(overrides: Partial<NewBusiness> = {}): Promise<string> {
  return insertBusiness(f, { registeredAt: hoursAgo(1), ...overrides });
}

function published(overrides: Partial<NewBusiness> = {}): Promise<string> {
  return card({
    status: "published",
    publishedAt: daysAgo(30),
    registeredAt: daysAgo(31),
    ...overrides,
  });
}

type NewEdit = typeof pendingEdits.$inferInsert;

async function edit(businessId: string, overrides: Partial<NewEdit> = {}): Promise<number> {
  const [row] = await db((tx) =>
    tx
      .insert(pendingEdits)
      .values({
        businessId,
        localityCode: f.localityA,
        name: "Nombre Propuesto de Prueba",
        categoryId: f.categoryId,
        whatsapp: fakePhone(),
        zoneId: f.zoneA,
        createdAt: hoursAgo(1),
        ...overrides,
      })
      .returning({ id: pendingEdits.id }),
  );
  return row!.id;
}

async function report(
  businessId: string,
  values: Partial<typeof reports.$inferInsert> = {},
  localityCode = f.localityA,
): Promise<void> {
  await db((tx) =>
    tx.insert(reports).values({ businessId, localityCode, reason: "closed", ...values }),
  );
}

async function removeCards(localityCode: string): Promise<void> {
  await db((tx) => tx.delete(businesses).where(eq(businesses.localityCode, localityCode)));
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
      .returning();
    for (const permissionKey of granted) {
      await tx.insert(rolePermissions).values({ roleId: row!.id, permissionKey });
    }
  });
  return roleKey;
}

const kinds = (rows: readonly QueueRow[]) =>
  rows.map((row) => [row.kind, row.businessId, row.editId]);

describe("Each review screen checks its permission in the locality of what it shows (v2)", () => {
  it("a locality admin sees every part of the review screens in its locality only", async () => {
    const email = await createUser("locality-admin");
    await assign(email, "locality_admin", f.localityA);

    const granted = await db((tx) => permittedLocalities(tx, email, [...CARD_PERMISSIONS]));
    for (const permission of CARD_PERMISSIONS) {
      expect([...(granted.get(permission) ?? [])]).toEqual([f.localityA]);
    }
    expect(await db((tx) => panelScope(tx, email))).toEqual({
      review: [f.localityA],
      edits: [f.localityA],
      reports: [f.localityA],
      cards: [f.localityA],
    });
  });

  it("a super admin sees every locality, active or not", async () => {
    const email = await createUser("super-admin");
    await assign(email, "super_admin", null);

    const scope = await db((tx) => panelScope(tx, email));
    for (const part of [scope.review, scope.edits, scope.reports, scope.cards]) {
      expect(part).toEqual(expect.arrayContaining([f.localityA, f.localityB, "13069"]));
    }
  });

  it("a role with some permissions sees only their parts: reports open a card, edits do not", async () => {
    const email = await createUser("reports-and-edits");
    await assign(email, await role("reports", ["reports.manage"]), f.localityB);
    await assign(email, await role("edits", ["edits.review"]), f.localityA);

    expect(await db((tx) => panelScope(tx, email))).toEqual({
      review: [],
      edits: [f.localityA],
      reports: [f.localityB],
      cards: [f.localityB],
    });
  });

  it("an unknown, inactive or unassigned user sees nothing anywhere", async () => {
    const inactive = await createUser("inactive", false);
    await assign(inactive, "locality_admin", f.localityA);
    const unassigned = await createUser("unassigned");
    const nobody = `nobody${DOMAIN}`;

    for (const email of [inactive, unassigned, nobody]) {
      expect(await db((tx) => panelScope(tx, email))).toEqual({
        review: [],
        edits: [],
        reports: [],
        cards: [],
      });
    }
  });

  it("the localities of a permission are exactly those where can() grants it", async () => {
    const email = await createUser("mixed");
    await assign(email, await role("mixed", ["businesses.review", "links.manage"]), f.localityA);
    await assign(email, "locality_admin", f.localityB);
    const all = Object.keys(PERMISSIONS) as Permission[];

    const granted = await db((tx) => permittedLocalities(tx, email.toUpperCase(), all));
    for (const permission of all) {
      for (const locality of [f.localityA, f.localityB]) {
        const allowed = await db((tx) => can(tx, email, permission, locality));
        expect(granted.get(permission)?.has(locality) ?? false, `${permission} ${locality}`).toBe(
          allowed,
        );
      }
    }
  });

  it("narrowing a scope by the locality filter keeps only that locality", () => {
    const scope = {
      review: [f.localityA, f.localityB],
      edits: [f.localityB],
      reports: [],
      cards: [f.localityA],
    };
    expect(narrowScope(scope, f.localityB)).toEqual({
      review: [f.localityB],
      edits: [f.localityB],
      reports: [],
      cards: [],
    });
    expect(narrowScope(scope, null)).toBe(scope);
  });
});

describe("The panel filters by locality, and the filter is hidden while there is one (v2)", () => {
  it("only active localities are options, and only with two or more", async () => {
    const seen = await db((tx) => panelLocalities(tx, [f.localityA, f.localityB]));
    expect(seen.map((locality) => [locality.code, locality.active])).toEqual([
      [f.localityB, false],
      [f.localityA, true],
    ]);
    expect(localityFilterOptions(seen)).toEqual([]);

    const twoActive = seen.map((locality) => ({ ...locality, active: true }));
    expect(localityFilterOptions(twoActive).map((locality) => locality.code)).toEqual([
      f.localityB,
      f.localityA,
    ]);
    expect(chosenLocality([f.localityA], twoActive)).toBe(f.localityA);
    for (const values of [[], [""], ["13069"], ["junk"], [f.localityA, f.localityB]]) {
      expect(chosenLocality(values, twoActive)).toBeNull();
    }
  });
});

describe("Review queue with the pending registrations, oldest first", () => {
  const scope = () => ({ review: [f.localityA], edits: [f.localityA] });

  it("two registrations and an edit that arrived on different days, oldest first whatever their type", async () => {
    await removeCards(f.localityA);
    const oldest = await card({ name: "Alta Más Vieja", registeredAt: daysAgo(3) });
    const edited = await published({ name: "Publicada Con Cambios" });
    const editId = await edit(edited, { createdAt: daysAgo(2) });
    const newest = await card({ name: "Alta Más Nueva", registeredAt: daysAgo(1) });

    const rows = await db((tx) => reviewQueue(tx, scope(), NOW));

    expect(kinds(rows)).toEqual([
      ["registration", oldest, null],
      ["edit", edited, editId],
      ["registration", newest, null],
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      "Alta Más Vieja",
      "Publicada Con Cambios",
      "Alta Más Nueva",
    ]);
    expect(rows.map((row) => row.zoneName)).toEqual(["Centro", "Centro", "Centro"]);
    expect(rows.every((row) => row.timeZone === "America/Mexico_City")).toBe(true);
  });

  it("only what is pending: no published or rejected card by itself, no resolved edit", async () => {
    await removeCards(f.localityA);
    const inReview = await card();
    const plain = await published();
    await card({ status: "rejected", rejectedAt: daysAgo(1), rejectionReason: "No existe" });
    const withResolved = await published();
    for (const status of ["applied", "discarded", "superseded"] as const) {
      await edit(withResolved, { status, resolvedAt: hoursAgo(1) });
    }
    const withPending = await published();
    const editId = await edit(withPending);

    const rows = await db((tx) => reviewQueue(tx, scope(), NOW));

    expect(rows.map((row) => row.businessId).sort()).toEqual([inReview, withPending].sort());
    expect(rows.find((row) => row.businessId === withPending)).toMatchObject({
      kind: "edit",
      editId,
    });
    expect(rows.some((row) => row.businessId === plain)).toBe(false);
  });

  it("a published card with a pending edit appears once, as Edición", async () => {
    await removeCards(f.localityA);
    const id = await published();
    const editId = await edit(id);

    expect(kinds(await db((tx) => reviewQueue(tx, scope(), NOW)))).toEqual([["edit", id, editId]]);
  });

  it("an unpublished card with a pending edit takes one row, as Alta nueva, and the edit comes back when it is published", async () => {
    await removeCards(f.localityA);
    const id = await card({
      registeredAt: daysAgo(240),
      publishedAt: daysAgo(200),
      unpublishedAt: hoursAgo(2),
      unpublishReason: "El negocio cerró",
    });
    const editId = await edit(id, { createdAt: hoursAgo(5) });

    expect(kinds(await db((tx) => reviewQueue(tx, scope(), NOW)))).toEqual([
      ["registration", id, null],
    ]);

    await db((tx) =>
      tx
        .update(businesses)
        .set({ status: "published", publishedAt: NOW })
        .where(eq(businesses.id, id)),
    );
    expect(kinds(await db((tx) => reviewQueue(tx, scope(), NOW)))).toEqual([["edit", id, editId]]);
  });

  it("an unpublished card waits since its unpublishing, carries its label and is ordered by it", async () => {
    await removeCards(f.localityA);
    const unpublished = await card({
      registeredAt: daysAgo(240),
      publishedAt: daysAgo(200),
      unpublishedAt: hoursAgo(1),
      unpublishReason: "El dueño la pidió",
    });
    const recent = await card({ registeredAt: hoursAgo(3) });

    const rows = await db((tx) => reviewQueue(tx, scope(), NOW));

    expect(rows.map((row) => row.businessId)).toEqual([recent, unpublished]);
    expect(rows[1]).toMatchObject({ since: hoursAgo(1), unpublished: true, overdue: false });
    expect(rows[0]).toMatchObject({ unpublished: false });
  });

  it("an unpublished card that is then resubmitted counts from the resubmission, without the label", async () => {
    await removeCards(f.localityA);
    const id = await card({
      registeredAt: hoursAgo(2),
      publishedAt: daysAgo(200),
      unpublishedAt: daysAgo(10),
      unpublishReason: "Se rechazó después",
    });

    const [row] = await db((tx) => reviewQueue(tx, scope(), NOW));

    expect(row).toMatchObject({ businessId: id, since: hoursAgo(2), unpublished: false });
  });

  it("an empty queue: no row", async () => {
    await removeCards(f.localityA);
    await published();

    expect(await db((tx) => reviewQueue(tx, scope(), NOW))).toEqual([]);
  });

  it("each kind of row needs its permission, in its locality", async () => {
    await removeCards(f.localityA);
    const registration = await card();
    const edited = await published();
    const editId = await edit(edited);

    const only = (review: string[], edits: string[]) =>
      db((tx) => reviewQueue(tx, { review, edits }, NOW));
    expect(kinds(await only([f.localityA], []))).toEqual([["registration", registration, null]]);
    expect(kinds(await only([], [f.localityA]))).toEqual([["edit", edited, editId]]);
    expect(await only([f.localityB], [f.localityB])).toEqual([]);
    expect(await only([], [])).toEqual([]);
  });
});

describe("Visible indicator for registrations waiting more than 48 hours", () => {
  const scope = () => ({ review: [f.localityA], edits: [f.localityA] });

  it("a registration and an edit of 50 hours are overdue and counted; one of 3 hours is not", async () => {
    await removeCards(f.localityA);
    const late = await card({ registeredAt: hoursAgo(50) });
    const lateEdit = await published();
    await edit(lateEdit, { createdAt: hoursAgo(50) });
    const onTime = await card({ registeredAt: hoursAgo(3) });

    const rows = await db((tx) => reviewQueue(tx, scope(), NOW));

    expect(Object.fromEntries(rows.map((row) => [row.businessId, row.overdue]))).toEqual({
      [late]: true,
      [lateEdit]: true,
      [onTime]: false,
    });
    expect(overdueCount(rows)).toBe(2);
  });

  it("the clock of an edit restarts when a newer one replaces it", async () => {
    await removeCards(f.localityA);
    const id = await published();
    await edit(id, { createdAt: hoursAgo(50), status: "superseded", resolvedAt: hoursAgo(1) });
    await edit(id, { createdAt: hoursAgo(1) });

    const rows = await db((tx) => reviewQueue(tx, scope(), NOW));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ overdue: false, since: hoursAgo(1) });
    expect(overdueCount(rows)).toBe(0);
  });

  it("a freshly unpublished card registered eight months ago is not born overdue", async () => {
    await removeCards(f.localityA);
    await card({
      registeredAt: daysAgo(240),
      publishedAt: daysAgo(230),
      unpublishedAt: hoursAgo(0.1),
      unpublishReason: "Cerró",
    });

    const rows = await db((tx) => reviewQueue(tx, scope(), NOW));

    expect(rows[0]?.overdue).toBe(false);
    expect(overdueCount(rows)).toBe(0);
  });
});

describe("The queue tells which businesses have unattended reports", () => {
  it("only cards with pending reports, the oldest unattended report first, with their counts", async () => {
    await removeCards(f.localityA);
    const three = await published({ name: "Tres Reportes" });
    for (const hours of [5, 4, 3]) await report(three, { createdAt: hoursAgo(hours) });
    const one = await published({ name: "Un Reporte" });
    await report(one, { createdAt: hoursAgo(10) });
    await report(one, { status: "attended", attendedAt: hoursAgo(1), createdAt: hoursAgo(20) });
    const attendedOnly = await published({ name: "Ya Atendido" });
    await report(attendedOnly, { status: "attended", attendedAt: hoursAgo(1) });

    const rows = await db((tx) => reportedBusinesses(tx, [f.localityA]));

    expect(rows).toEqual([
      { businessId: one, localityCode: f.localityA, name: "Un Reporte", pending: 1 },
      { businessId: three, localityCode: f.localityA, name: "Tres Reportes", pending: 3 },
    ]);
    expect(await db((tx) => reportedBusinesses(tx, [f.localityB]))).toEqual([]);
    expect(await db((tx) => reportedBusinesses(tx, []))).toEqual([]);
  });

  it("an unpublished card with reports is in both sections, and reports change nothing of the queue", async () => {
    await removeCards(f.localityA);
    const earlier = await card({ registeredAt: hoursAgo(5) });
    const unpublished = await card({
      registeredAt: daysAgo(100),
      publishedAt: daysAgo(90),
      unpublishedAt: hoursAgo(1),
      unpublishReason: "Lo reportaron",
    });
    await report(unpublished, { createdAt: daysAgo(3) });
    const reportedPublished = await published();
    await report(reportedPublished, { createdAt: daysAgo(4) });

    const queue = await db((tx) =>
      reviewQueue(tx, { review: [f.localityA], edits: [f.localityA] }, NOW),
    );
    const reported = await db((tx) => reportedBusinesses(tx, [f.localityA]));

    expect(queue.map((row) => row.businessId)).toEqual([earlier, unpublished]);
    expect(reported.map((row) => row.businessId)).toEqual([reportedPublished, unpublished]);
  });
});

describe("'Todos los negocios': its rows, its filter, its pages and its search", () => {
  const list = (overrides: Partial<Parameters<typeof businessesPage>[1]> = {}) =>
    db((tx) =>
      businessesPage(tx, {
        localityCodes: [f.localityB],
        status: "all",
        query: "",
        page: 1,
        ...overrides,
      }),
    );
  const inB = (overrides: Partial<NewBusiness> = {}) =>
    insertBusiness(f, { localityCode: f.localityB, zoneId: f.zoneB, ...overrides });

  it("the four cases, most recent first, with the status and the label of an unpublished card", async () => {
    await removeCards(f.localityB);
    const fresh = await inB({ name: "Recién Llegada", registeredAt: daysAgo(1) });
    const live = await inB({
      name: "Publicada",
      status: "published",
      publishedAt: daysAgo(2),
      registeredAt: daysAgo(3),
    });
    const rejected = await inB({
      name: "Rechazada",
      status: "rejected",
      rejectedAt: daysAgo(4),
      rejectionReason: "No pudimos confirmarla",
      registeredAt: daysAgo(5),
    });
    const unpublished = await inB({
      name: "Despublicada",
      registeredAt: daysAgo(200),
      publishedAt: daysAgo(190),
      unpublishedAt: daysAgo(1),
      unpublishReason: "Cerró",
    });

    const page = await list();

    expect(page).toMatchObject({ total: 4, pages: 1, beyond: false });
    expect(page.rows.map((row) => [row.id, row.status, row.unpublished])).toEqual([
      [fresh, "in_review", false],
      [live, "published", false],
      [rejected, "rejected", false],
      [unpublished, "in_review", true],
    ]);
    expect(Object.keys(page.rows[0]!).sort()).toEqual(
      [
        "id",
        "localityCode",
        "name",
        "registeredAt",
        "status",
        "timeZone",
        "unpublished",
        "zoneName",
        "zoneSlug",
      ].sort(),
    );
  });

  it("filtered by status, the count is the filter's, and a filter can leave nothing", async () => {
    await removeCards(f.localityB);
    await inB();
    await inB({ status: "published", publishedAt: daysAgo(1) });
    await inB({ status: "published", publishedAt: daysAgo(1) });

    expect((await list({ status: "published" })).total).toBe(2);
    expect((await list({ status: "in_review" })).total).toBe(1);
    expect(await list({ status: "rejected" })).toMatchObject({ total: 0, rows: [], pages: 1 });
  });

  it("25 rows a page, the next pages keep the filter, and a page past the last has no rows", async () => {
    await removeCards(f.localityB);
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      ids.push(
        await inB({ status: "published", publishedAt: daysAgo(1), registeredAt: hoursAgo(i + 1) }),
      );
    }
    await inB({ registeredAt: hoursAgo(0.5) });

    const first = await list({ status: "published" });
    const second = await list({ status: "published", page: 2 });
    const past = await list({ status: "published", page: 3 });

    expect(first).toMatchObject({ total: 30, pages: 2, beyond: false });
    expect(first.rows.map((row) => row.id)).toEqual(ids.slice(0, LIST_PAGE_SIZE));
    expect(second.rows.map((row) => row.id)).toEqual(ids.slice(LIST_PAGE_SIZE));
    expect(past).toMatchObject({ total: 30, pages: 2, beyond: true, rows: [] });
    expect(await list({ status: "published", page: MAX_LIST_PAGE })).toMatchObject({ rows: [] });
  });

  it("two cards registered at the same moment keep one order, so none repeats or goes missing", async () => {
    await removeCards(f.localityB);
    const at = daysAgo(1);
    const ids: string[] = [];
    for (let i = 0; i < LIST_PAGE_SIZE + 3; i++) ids.push(await inB({ registeredAt: at }));

    const pages = [await list(), await list({ page: 2 })];
    const seen = pages.flatMap((page) => page.rows.map((row) => row.id));

    expect(seen).toHaveLength(ids.length);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen).toEqual([...ids].sort().reverse());
  });

  it("a search by name ignores capitals and accents, and needs every word", async () => {
    await removeCards(f.localityB);
    const tacos = await inB({ name: "Tacos del Güero" });
    await inB({ name: "Tortillería La Güera" });

    for (const query of ["tacos guero", "TACOS", "Güero", "del"]) {
      expect(
        (await list({ query })).rows.map((row) => row.id),
        query,
      ).toEqual([tacos]);
    }
    expect((await list({ query: "tacos tortilleria" })).total).toBe(0);
    expect((await list({ query: "🎉" })).total).toBe(0);
  });

  it("a search by WhatsApp reads the number as the registration does", async () => {
    await removeCards(f.localityB);
    const id = await inB({ whatsapp: "7719998123" });
    await inB({ whatsapp: "7719998124" });

    for (const query of ["7719998123", "771 999 8123", "+52 771-999-8123", "5217719998123"]) {
      expect(
        (await list({ query })).rows.map((row) => row.id),
        query,
      ).toEqual([id]);
    }
    expect((await list({ query: "771999812" })).total).toBe(0);
  });

  it("a search keeps the status filter", async () => {
    await removeCards(f.localityB);
    await inB({ name: "Estética Ficticia" });
    const live = await inB({
      name: "Estética Ficticia Dos",
      status: "published",
      publishedAt: NOW,
    });

    expect(
      (await list({ query: "estetica", status: "published" })).rows.map((row) => row.id),
    ).toEqual([live]);
  });

  it("only the localities in scope are listed", async () => {
    await removeCards(f.localityB);
    await inB();

    expect(
      (await list({ localityCodes: [f.localityA] })).rows.some(
        (row) => row.localityCode === f.localityB,
      ),
    ).toBe(false);
    expect(await list({ localityCodes: [] })).toMatchObject({ total: 0, rows: [], pages: 1 });
  });

  it("the parameters never fail: anything that cannot be read is the default", () => {
    expect(parseStatusFilter(["publicados"])).toBe("published");
    expect(parseStatusFilter(["en-revision"])).toBe("in_review");
    expect(parseStatusFilter(["rechazados"])).toBe("rejected");
    for (const values of [[], [""], ["published"], ["inventado"], ["publicados", "rechazados"]]) {
      expect(parseStatusFilter(values), JSON.stringify(values)).toBe("all");
    }

    expect(parseListPage(["2"])).toBe(2);
    for (const values of [[], [""], ["0"], ["-3"], ["dos"], ["2.5"], ["02"], ["2", "3"], ["٣"]]) {
      expect(parseListPage(values), JSON.stringify(values)).toBe(1);
    }
    expect(parseListPage(["99999999999999999999"])).toBe(MAX_LIST_PAGE);

    expect(parseSearch(["  tacos‮  güero "])).toBe("tacos güero");
    expect(parseSearch(["x".repeat(200)])).toHaveLength(80);
    expect(parseSearch([])).toBe("");
    expect(parseSearch(["a", "b"])).toBe("");
  });
});

describe("Registration detail with all the captured data, only inside the panel", () => {
  it("everything captured, the internal data, the link's date and never its fingerprint", async () => {
    const photoKey = newPhotoKey();
    const id = await published({
      name: "Plomería Completa",
      whatsapp: "7719998201",
      whatYouOffer: "Destapes",
      homeDelivery: true,
      landline: "7719998202",
      address: "Junto a la primaria",
      openingHours: "Lunes a sábado",
      facebookUrl: "https://facebook.com/ficticia",
      photoKey,
      origin: "seeded",
      consentedToNoticeVersion: "1",
      reconsentedToNoticeAt: daysAgo(2),
      reconsentedToNoticeVersion: "2",
    });
    await db((tx) => issueManagementLink(tx, id));

    const detail = await db((tx) => registrationDetail(tx, id));

    expect(detail).toMatchObject({
      id,
      localityCode: f.localityA,
      localityName: "Pueblo Uno",
      timeZone: "America/Mexico_City",
      name: "Plomería Completa",
      categoryName: expect.stringMatching(/^Categoría de prueba/),
      whatsapp: "7719998201",
      zoneSlug: "centro",
      zoneName: "Centro",
      zoneOther: null,
      whatYouOffer: "Destapes",
      homeDelivery: true,
      landline: "7719998202",
      address: "Junto a la primaria",
      openingHours: "Lunes a sábado",
      facebookUrl: "https://facebook.com/ficticia",
      photoKey,
      status: "published",
      origin: "seeded",
      consentedToNoticeVersion: "1",
      reconsentedToNoticeVersion: "2",
      unpublishedAt: null,
      unpublishReason: null,
    });
    expect(detail?.managementLinkCreatedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(detail)).not.toMatch(/[0-9a-f]{64}/);
    expect(Object.keys(detail ?? {})).not.toContain("managementTokenHash");
  });

  it("only the required fields: the optional ones come back empty, and Otra as its free text", async () => {
    const id = await card({
      zoneId: null,
      zoneOther: "  Rinconada del Venado ",
      whatYouOffer: "  ",
    });

    const detail = await db((tx) => registrationDetail(tx, id));

    expect(detail).toMatchObject({
      zoneSlug: null,
      zoneOther: "Rinconada del Venado",
      whatYouOffer: null,
      landline: null,
      address: null,
      openingHours: null,
      facebookUrl: null,
      photoKey: null,
      managementLinkCreatedAt: null,
      reconsentedToNoticeAt: null,
    });
    expect(zoneText(detail!, undefined)).toBe(
      'Rinconada del Venado (escrita como "Otra", sin normalizar)',
    );
  });

  it("a card without a version, and an unpublished one with its trace", async () => {
    const id = await card({
      consentedToNoticeVersion: null,
      publishedAt: daysAgo(10),
      unpublishedAt: daysAgo(1),
      unpublishReason: "El negocio cerró",
    });

    expect(await db((tx) => registrationDetail(tx, id))).toMatchObject({
      consentedToNoticeVersion: null,
      unpublishedAt: daysAgo(1),
      unpublishReason: "El negocio cerró",
    });
  });

  it("an identifier no card has, or one that cannot be one, is no card", async () => {
    for (const id of ["zzzzzzzzzz", "", "abc", "a%00bcdefgh", "ABCDEFGHJK", "../../etc"]) {
      expect(await db((tx) => registrationDetail(tx, id)), id).toBeNull();
    }
  });

  it("the zone of a card is its display name, read from the zones of its locality", async () => {
    const seen = await db((tx) => panelLocalities(tx, [f.localityA]));
    const names = await db((tx) => zoneNamesByLocality(tx, seen));
    const id = await card();
    const detail = await db((tx) => registrationDetail(tx, id));

    expect(names.get(f.localityA)?.get("centro")).toBe("Centro");
    expect(zoneText(detail!, names.get(f.localityA))).toBe("Centro");
    // A name another zone of the locality shares is shown with its type.
    const shared = new Map([[f.localityA, new Map([["centro", "Centro (Colonia)"]])]]);
    expect(zoneText(detail!, shared.get(f.localityA))).toBe("Centro (Colonia)");
    expect(withZoneNames([detail!], shared)[0]?.zoneName).toBe("Centro (Colonia)");
  });
});

describe("The business detail lists its unattended reports", () => {
  it("its pending reports, oldest first, with the comment exactly as written and nothing about the sender", async () => {
    const id = await published();
    await report(id, { reason: "not_real", createdAt: hoursAgo(2) });
    await report(id, {
      reason: "incorrect_data",
      comment: "<b>cerró</b><script>alert(1)</script>",
      createdAt: hoursAgo(30),
    });
    await report(id, { status: "attended", attendedAt: hoursAgo(1), createdAt: hoursAgo(40) });

    const rows = await db((tx) => pendingReports(tx, id));

    expect(rows.map(({ reason, comment }) => ({ reason, comment }))).toEqual([
      { reason: "incorrect_data", comment: "<b>cerró</b><script>alert(1)</script>" },
      { reason: "not_real", comment: null },
    ]);
    expect(Object.keys(rows[0]!).sort()).toEqual(["comment", "createdAt", "id", "reason"]);
    const unreported = await card();
    expect(await db((tx) => pendingReports(tx, unreported))).toEqual([]);
  });
});

describe("The pending edit detail compares what is published with what is proposed", () => {
  it("field by field, marking only what changes, with the photo the edit proposes", async () => {
    const cardPhoto = newPhotoKey();
    const newPhoto = newPhotoKey();
    const id = await published({
      name: "Tacos de Prueba",
      whatsapp: "7719998301",
      openingHours: "De 9 a 5",
      address: "Calle Uno",
      photoKey: cardPhoto,
    });
    const editId = await edit(id, {
      name: "Tacos de Prueba",
      whatsapp: "7719998301",
      openingHours: "De 10 a 6",
      address: "Calle Dos",
      photoChange: "replace",
      newPhotoKey: newPhoto,
    });

    const detail = await db((tx) => editDetail(tx, editId));

    expect(detail).toMatchObject({
      id: editId,
      businessId: id,
      localityCode: f.localityA,
      localityName: "Pueblo Uno",
      status: "pending",
      publishedPhotoKey: cardPhoto,
      photoChange: "replace",
      newPhotoKey: newPhoto,
    });
    const fields = comparedFields(detail!, undefined);
    expect(fields.map((field) => field.label)).toEqual([
      "Nombre",
      "Categoría",
      "WhatsApp",
      "Colonia",
      "¿Qué ofreces?",
      "¿Hace entregas o va a domicilio?",
      "Teléfono fijo",
      "Dirección o referencias",
      "Horario",
      "Página que registró",
    ]);
    expect(fields.filter((field) => field.changed).map((field) => field.key)).toEqual([
      "address",
      "openingHours",
    ]);
    expect(fields.find((field) => field.key === "openingHours")).toMatchObject({
      published: "De 9 a 5",
      proposed: "De 10 a 6",
    });
    expect(fields.find((field) => field.key === "landline")).toMatchObject({
      published: "No capturado",
      proposed: "No capturado",
      changed: false,
    });
    expect(changesWhatsapp(detail!)).toBe(false);
  });

  it("a new WhatsApp and a zone written as Otra are compared as the admin reads them", async () => {
    const id = await published({ whatsapp: "7719998401" });
    const editId = await edit(id, {
      whatsapp: "7719998402",
      zoneId: null,
      zoneOther: "Colonia Nueva",
    });

    const detail = await db((tx) => editDetail(tx, editId));
    const fields = comparedFields(detail!, undefined);

    expect(changesWhatsapp(detail!)).toBe(true);
    expect(fields.find((field) => field.key === "whatsapp")).toMatchObject({
      published: "7719998401",
      proposed: "7719998402",
      changed: true,
    });
    expect(fields.find((field) => field.key === "zone")).toMatchObject({
      published: "Centro",
      proposed: 'Colonia Nueva (escrita como "Otra", sin normalizar)',
      changed: true,
    });
  });

  it("a resolved edit can still be read, with its status", async () => {
    const id = await published();
    const editId = await edit(id, { status: "superseded", resolvedAt: hoursAgo(1) });

    expect(await db((tx) => editDetail(tx, editId))).toMatchObject({ status: "superseded" });
  });

  it("an edit that does not exist, or a number that cannot be one, is none", async () => {
    expect(await db((tx) => editDetail(tx, 999_999_999_999))).toBeNull();
    for (const value of [undefined, "", "0", "-1", "abc", "1.5", "01", "99999999999999999999"]) {
      expect(parseEditId(value), String(value)).toBeNull();
    }
    expect(parseEditId("42")).toBe(42);
  });
});

// These run in workerd, the runtime of production, whose Intl writes the dates.
describe("Dates in the panel use the time zone of the locality (v2)", () => {
  it("near midnight: a registration at 23:30 in its locality is that local day, already the next in UTC", () => {
    const lateNight = new Date("2026-09-04T05:30:00Z");

    expect(panelDate(lateNight, "America/Mexico_City")).toBe("3 de septiembre de 2026");
    expect(panelDateTime(lateNight, "America/Mexico_City")).toBe("3 de septiembre de 2026, 23:30");
    expect(panelDate(lateNight, "UTC")).toBe("4 de septiembre de 2026");
    expect(panelDate(lateNight, "America/Tijuana")).toBe("3 de septiembre de 2026");
  });

  it("the wait reads in hours up to the goal and in days past it", () => {
    const at = (hours: number) => waitText(hoursAgo(hours), NOW);
    expect(at(0.5)).toBe("Hace menos de una hora");
    expect(at(1)).toBe("Hace 1 hora");
    expect(at(3)).toBe("Hace 3 horas");
    expect(at(47.9)).toBe("Hace 47 horas");
    expect(at(48)).toBe("Hace 2 días");
    expect(at(50)).toBe("Hace 2 días");
    expect(at(24 * 9)).toBe("Hace 9 días");
    expect(waitText(new Date(NOW.getTime() + HOUR), NOW)).toBe("Hace menos de una hora");
  });

  it("past the goal means more than 48 hours", () => {
    expect(REVIEW_GOAL_HOURS).toBe(48);
    expect(isOverdue(hoursAgo(48), NOW)).toBe(false);
    expect(isOverdue(new Date(hoursAgo(48).getTime() - 1000), NOW)).toBe(true);
    expect(isOverdue(hoursAgo(3), NOW)).toBe(false);
  });
});

describe("Verification button that opens WhatsApp with a prefilled message", () => {
  it("the first contact names the directory with its descriptor and the card's locality, from its record", () => {
    expect(verificationMessage("Tacos del Güero", "Tizayuca")).toBe(
      "Hola, te escribo de enmirumbo, el directorio de negocios de Tizayuca. Recibimos el registro de «Tacos del Güero». ¿Nos confirmas que el negocio es tuyo y que este es tu WhatsApp?",
    );
    expect(verificationMessage("Estética Lupita", "Pueblo Uno")).toContain(
      "el directorio de negocios de Pueblo Uno.",
    );
  });

  it("the conversation with the number's ten digits, the message written, and no link without them", () => {
    const link = verificationLink("771 999 0101", "Tacos del Güero", "Tizayuca");
    expect(link).toBe(
      `https://wa.me/527719990101?text=${encodeURIComponent(verificationMessage("Tacos del Güero", "Tizayuca"))}`,
    );
    expect(verificationLink("77199901", "Tacos", "Tizayuca")).toBeNull();
    expect(verificationLink("", "Tacos", "Tizayuca")).toBeNull();
  });
});
