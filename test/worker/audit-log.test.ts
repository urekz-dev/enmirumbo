// Scenarios of docs/specs/admin-review.md, "The panel shows the audit log,
// read-only (v2)", on its data: the order, the pages, the permissions by
// locality, a deleted card shown by its identifier only, and the actor of the
// scheduled job. The screen is rendered in test/astro/review.test.ts and run
// end to end through Access in test/e2e/admin-removals.spec.ts.
//
// Everything lives in the fictitious state 91 (test/worker/fixtures.ts):
// locality A active and locality B inactive. Users are of the domain
// audit.enmirumbo.test and roles start with audittest_; all of it is removed
// before and after.
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Permission } from "../../src/core/access/permissions.ts";
import {
  adminAuditLog,
  businesses,
  roleAssignments,
  rolePermissions,
  roles,
  SCHEDULED_JOB_ACTOR,
  users,
} from "../../src/core/db/schema/index.ts";
import {
  AUDIT_PAGE_SIZE,
  auditLogPage,
  cardAuditEntries,
} from "../../src/core/review/audit-log.ts";
import { panelHome } from "../../src/core/access/home.ts";
import { opensCardIn, panelScope } from "../../src/core/review/scope.ts";
import { cleanup, createFixture, db, type Fixture, insertBusiness } from "./fixtures.ts";

const STATE = "91";
const DOMAIN = "@audit.enmirumbo.test";
const ROLE_PREFIX = "audittest_";
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-10T18:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

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

beforeEach(async () => {
  await db((tx) =>
    tx.delete(adminAuditLog).where(inArray(adminAuditLog.localityCode, [f.localityA, f.localityB])),
  );
});

interface Entry {
  businessId?: string;
  localityCode?: string;
  actor?: string;
  action?: (typeof adminAuditLog.$inferInsert)["action"];
  previousStatus?: (typeof adminAuditLog.$inferInsert)["previousStatus"];
  occurredAt?: Date;
}

async function entry(overrides: Entry = {}): Promise<string> {
  const businessId = overrides.businessId ?? "b5q68b2e72";
  await db((tx) =>
    tx.insert(adminAuditLog).values({
      localityCode: f.localityA,
      businessId,
      actor: "ana@audit.enmirumbo.test",
      action: "reject",
      previousStatus: "in_review",
      occurredAt: hoursAgo(1),
      ...overrides,
    }),
  );
  return businessId;
}

async function createUser(name: string, active = true): Promise<string> {
  const email = `${name}${DOMAIN}`;
  await db((tx) => tx.insert(users).values({ email, name, active }));
  return email;
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

async function assign(email: string, roleKey: string, localityCode: string | null): Promise<void> {
  await db(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.email, email));
    const [roleRow] = await tx.select().from(roles).where(eq(roles.key, roleKey));
    await tx.insert(roleAssignments).values({
      userId: user!.id,
      roleId: roleRow!.id,
      roleScope: roleRow!.scope,
      localityCode,
    });
  });
}

describe("The panel shows the audit log, read-only (v2)", () => {
  it("newest first, 25 a page, by the moment and then by the identifier", async () => {
    const cards: string[] = [];
    for (let index = 0; index < AUDIT_PAGE_SIZE + 5; index += 1) {
      const card = `card${String(index).padStart(8, "0")}`;
      cards.push(card);
      await entry({ businessId: card, occurredAt: hoursAgo(index + 1) });
    }
    // Two entries of the same moment: the newer identifier goes first.
    const same = hoursAgo(0);
    await entry({ businessId: "aaaaaaaaaa", occurredAt: same });
    await entry({ businessId: "bbbbbbbbbb", occurredAt: same });

    const first = await db((tx) => auditLogPage(tx, { localityCodes: [f.localityA], page: 1 }));
    expect(first.total).toBe(AUDIT_PAGE_SIZE + 7);
    expect(first.pages).toBe(2);
    expect(first.beyond).toBe(false);
    expect(first.rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.rows.slice(0, 3).map((row) => row.businessId)).toEqual([
      "bbbbbbbbbb",
      "aaaaaaaaaa",
      cards[0],
    ]);

    const second = await db((tx) => auditLogPage(tx, { localityCodes: [f.localityA], page: 2 }));
    expect(second.rows.map((row) => row.businessId)).toEqual(cards.slice(23));
    expect(second.beyond).toBe(false);

    const third = await db((tx) => auditLogPage(tx, { localityCodes: [f.localityA], page: 3 }));
    expect(third).toEqual({ rows: [], total: AUDIT_PAGE_SIZE + 7, pages: 2, beyond: true });
  });

  it("an empty log, and no locality to read, have no rows", async () => {
    expect(await db((tx) => auditLogPage(tx, { localityCodes: [f.localityA], page: 1 }))).toEqual({
      rows: [],
      total: 0,
      pages: 1,
      beyond: false,
    });
    await entry();
    expect(await db((tx) => auditLogPage(tx, { localityCodes: [], page: 1 }))).toEqual({
      rows: [],
      total: 0,
      pages: 1,
      beyond: false,
    });
  });

  it("a user sees the entries of the localities where they hold audit_log.view", async () => {
    const email = await createUser("locality-audit");
    await assign(email, await role("audit_a", ["audit_log.view"]), f.localityA);
    await entry({ localityCode: f.localityA, businessId: "aaaaaaaaaa" });
    await entry({ localityCode: f.localityB, businessId: "bbbbbbbbbb" });

    const scope = await db((tx) => panelScope(tx, email));
    expect(scope.log).toEqual([f.localityA]);
    const list = await db((tx) => auditLogPage(tx, { localityCodes: scope.log, page: 1 }));
    expect(list.rows.map((row) => row.businessId)).toEqual(["aaaaaaaaaa"]);
  });

  it("the card's identifier links by the detail page's own rule, not by the log permission", async () => {
    const auditOnly = await createUser("audit-only");
    await assign(auditOnly, await role("audit_only", ["audit_log.view"]), f.localityA);
    const both = await createUser("audit-and-review");
    await assign(
      both,
      await role("audit_and_review", ["audit_log.view", "businesses.review"]),
      f.localityA,
    );

    const only = await db((tx) => panelScope(tx, auditOnly));
    expect(only.log).toEqual([f.localityA]);
    expect(opensCardIn(only, f.localityA)).toBe(false);

    const granted = await db((tx) => panelScope(tx, both));
    expect(granted.log).toEqual([f.localityA]);
    expect(opensCardIn(granted, f.localityA)).toBe(true);
  });

  it("the panel home leads a user who only reads the log to the log", async () => {
    const email = await createUser("home-audit");
    await assign(email, await role("home_audit", ["audit_log.view"]), f.localityA);

    expect(await db((tx) => panelHome(tx, email))).toEqual({
      queue: false,
      links: [{ href: "/admin/bitacora", text: "Ver la bitácora" }],
    });
  });

  it("a user without audit_log.view, inactive or unknown, has no locality to read", async () => {
    const reviewer = await createUser("reviewer");
    await assign(reviewer, await role("review", ["businesses.review"]), f.localityA);
    const inactive = await createUser("inactive-audit", false);
    await assign(inactive, await role("audit_b", ["audit_log.view"]), f.localityB);

    for (const email of [reviewer, inactive, `nobody${DOMAIN}`]) {
      expect((await db((tx) => panelScope(tx, email))).log).toEqual([]);
    }
  });

  it("a deleted card keeps its entry and is only its identifier", async () => {
    const id = await insertBusiness(f, { name: "Ficha Borrada de Prueba" });
    await entry({ businessId: id, action: "delete", previousStatus: "published" });
    await db((tx) => tx.delete(businesses).where(eq(businesses.id, id)));

    const list = await db((tx) => auditLogPage(tx, { localityCodes: [f.localityA], page: 1 }));
    expect(list.rows).toHaveLength(1);
    const [row] = list.rows;
    expect(row).toMatchObject({
      businessId: id,
      action: "delete",
      previousStatus: "published",
      cardExists: false,
    });
    expect(row).not.toHaveProperty("name");
    expect(row).not.toHaveProperty("whatsapp");
  });

  it("a card that still exists says so, and its entry says the scheduled job", async () => {
    const id = await insertBusiness(f);
    await entry({
      businessId: id,
      action: "purge",
      previousStatus: "rejected",
      actor: SCHEDULED_JOB_ACTOR,
    });

    const list = await db((tx) => auditLogPage(tx, { localityCodes: [f.localityA], page: 1 }));
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      businessId: id,
      actor: SCHEDULED_JOB_ACTOR,
      action: "purge",
      previousStatus: "rejected",
      cardExists: true,
    });
  });

  it("the section of a detail reads one card's entries only, newest first", async () => {
    const card = await entry({ businessId: "aaaaaaaaaa", occurredAt: hoursAgo(3) });
    await entry({ businessId: "bbbbbbbbbb", occurredAt: hoursAgo(1) });
    await entry({ businessId: card, occurredAt: hoursAgo(2), action: "unpublish" });

    const rows = await db((tx) => cardAuditEntries(tx, card));
    expect(rows.map((row) => [row.businessId, row.action])).toEqual([
      [card, "unpublish"],
      [card, "reject"],
    ]);
  });

  it("the audit log of one locality ignores the entries of another", async () => {
    await entry({ localityCode: f.localityA, businessId: "aaaaaaaaaa" });
    await entry({ localityCode: f.localityB, businessId: "bbbbbbbbbb" });

    const list = await db((tx) => auditLogPage(tx, { localityCodes: [f.localityB], page: 1 }));
    expect(list.rows.map((row) => [row.localityCode, row.businessId])).toEqual([
      [f.localityB, "bbbbbbbbbb"],
    ]);
    expect(
      await db((tx) =>
        tx
          .select({ id: adminAuditLog.id })
          .from(adminAuditLog)
          .where(
            and(
              eq(adminAuditLog.localityCode, f.localityB),
              eq(adminAuditLog.businessId, "bbbbbbbbbb"),
            ),
          ),
      ),
    ).toHaveLength(1);
  });
});
