// Users, assignments, role bundles and the non-queue panel home (EMR-72).
// Guard races use their own access tables in an isolated schema: other files
// legitimately create super admins concurrently in the shared test database.
import { eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { panelHome } from "../../src/core/access/home.ts";
import {
  assignRole,
  assignedRoles,
  createPanelUser,
  LAST_SUPER_ADMIN,
  panelRole,
  panelUser,
  removeRoleAssignment,
  rolePermissionKeys,
  saveRole,
  setUserActive,
  type RoleInput,
} from "../../src/core/access/manage.ts";
import { can } from "../../src/core/access/queries.ts";
import type { Db } from "../../src/core/db/client.ts";
import {
  adminAuditLog,
  roleAssignments,
  rolePermissions,
  roles,
  users,
} from "../../src/core/db/schema/index.ts";
import { managedRole, managedUser, managementRoute } from "../../src/lib/panel-management.ts";
import { cleanup, createFixture, db, type Fixture } from "./fixtures.ts";

const STATE = "70";
const DOMAIN = "@management.enmirumbo.test";
const MANAGER = `manager${DOMAIN}`;
let f: Fixture;
let managerId: string;
let globalRole: number;
let localityRole: number;
const roleInput: RoleInput = {
  name: "Rol de prueba",
  description: "Prueba",
  scope: "locality",
  permissions: ["businesses.review"],
};
async function clean(): Promise<void> {
  await db(async (tx) => {
    await tx.delete(users).where(like(users.email, `%${DOMAIN}`));
    await tx.delete(roles).where(like(roles.key, "managementtest_%"));
    // Created through the core; remember their keys only in this file's rows.
    await tx.delete(roles).where(like(roles.description, "EMR72 test%"));
  });
  await cleanup(STATE);
}
beforeAll(async () => {
  await clean();
  f = await createFixture(STATE);
  await db(async (tx) => {
    const [manager] = await tx
      .insert(users)
      .values({ email: MANAGER, name: "Gestión de prueba" })
      .returning();
    managerId = manager!.id;
    const [global] = await tx
      .insert(roles)
      .values({ key: "managementtest_global", name: "Gestión global", scope: "global" })
      .returning();
    globalRole = global!.id;
    const [locality] = await tx
      .insert(roles)
      .values({ key: "managementtest_locality", name: "Gestión municipal", scope: "locality" })
      .returning();
    localityRole = locality!.id;
    for (const roleId of [globalRole, localityRole])
      await tx
        .insert(rolePermissions)
        .values(
          ["users.manage", "roles.manage"].map((permissionKey) => ({ roleId, permissionKey })),
        );
    await tx
      .insert(roleAssignments)
      .values({ userId: managerId, roleId: globalRole, roleScope: "global" });
  });
});
afterAll(clean);
async function newUser(part: string): Promise<string> {
  const outcome = await db((tx) =>
    createPanelUser(tx, MANAGER, { email: `${part}${DOMAIN}`, name: `Prueba ${part}` }),
  );
  if (outcome.kind !== "done") throw new Error("test user not created");
  return String(outcome.id);
}

describe("Panel users and roles from the panel (v2)", () => {
  it("creates a lowercase unique email with a name and no assignments", async () => {
    const result = await db((tx) =>
      createPanelUser(tx, MANAGER, {
        email: `  Mixed${DOMAIN.toUpperCase()}  `,
        name: " Persona de prueba ",
      }),
    );
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(await db((tx) => panelUser(tx, String(result.id)))).toMatchObject({
      email: `mixed${DOMAIN}`,
      name: "Persona de prueba",
      active: true,
    });
    expect(await db((tx) => panelHome(tx, `mixed${DOMAIN}`))).toBeNull();
    expect(
      await db((tx) => createPanelUser(tx, MANAGER, { email: `MIXED${DOMAIN}`, name: "Otra" })),
    ).toMatchObject({ kind: "invalid", errors: { email: expect.any(String) } });
  });
  it("validates email and name on the server", async () => {
    expect(
      await db((tx) => createPanelUser(tx, MANAGER, { email: "invalid", name: " " })),
    ).toMatchObject({
      kind: "invalid",
      errors: { email: expect.any(String), name: expect.any(String) },
    });
  });
  it("deactivates and reactivates a user, preserving assignments", async () => {
    const id = await newUser("active");
    expect((await db((tx) => assignRole(tx, MANAGER, id, localityRole, f.localityA))).kind).toBe(
      "done",
    );
    expect(await db((tx) => can(tx, `active${DOMAIN}`, "users.manage", f.localityA))).toBe(true);
    expect((await db((tx) => setUserActive(tx, MANAGER, id, false))).kind).toBe("done");
    expect(await db((tx) => can(tx, `active${DOMAIN}`, "users.manage", f.localityA))).toBe(false);
    expect(await db((tx) => assignedRoles(tx, id))).toHaveLength(1);
    expect((await db((tx) => setUserActive(tx, MANAGER, id, true))).kind).toBe("done");
    expect(await db((tx) => can(tx, `active${DOMAIN}`, "users.manage", f.localityA))).toBe(true);
    expect((await db((tx) => setUserActive(tx, MANAGER, id, true))).kind).toBe("conflict");
  });
  it("requires a locality for locality roles and none for global roles; refuses duplicates", async () => {
    const id = await newUser("scopes");
    expect((await db((tx) => assignRole(tx, MANAGER, id, localityRole, null))).kind).toBe(
      "invalid",
    );
    expect((await db((tx) => assignRole(tx, MANAGER, id, globalRole, f.localityA))).kind).toBe(
      "invalid",
    );
    expect((await db((tx) => assignRole(tx, MANAGER, id, localityRole, "99999"))).kind).toBe(
      "invalid",
    );
    expect((await db((tx) => assignRole(tx, MANAGER, id, localityRole, f.localityA))).kind).toBe(
      "done",
    );
    expect((await db((tx) => assignRole(tx, MANAGER, id, localityRole, f.localityA))).kind).toBe(
      "invalid",
    );
    expect(await db((tx) => can(tx, `scopes${DOMAIN}`, "users.manage", f.localityB))).toBe(false);
    expect(await db((tx) => can(tx, `scopes${DOMAIN}`, "users.manage", null))).toBe(false);
    expect((await db((tx) => assignRole(tx, MANAGER, id, localityRole, f.localityB))).kind).toBe(
      "done",
    );
    expect((await db((tx) => assignRole(tx, MANAGER, id, globalRole, null))).kind).toBe("done");
    expect((await db((tx) => assignRole(tx, MANAGER, id, globalRole, null))).kind).toBe("invalid");
  });
  it("removes only the addressed user's assignment, once", async () => {
    const id = await newUser("remove");
    const other = await newUser("other");
    const result = await db((tx) => assignRole(tx, MANAGER, id, localityRole, f.localityA));
    if (result.kind !== "done") throw new Error("assignment not created");
    expect(
      (await db((tx) => removeRoleAssignment(tx, MANAGER, other, Number(result.id)))).kind,
    ).toBe("not-found");
    expect((await db((tx) => removeRoleAssignment(tx, MANAGER, id, Number(result.id)))).kind).toBe(
      "done",
    );
    expect((await db((tx) => removeRoleAssignment(tx, MANAGER, id, Number(result.id)))).kind).toBe(
      "not-found",
    );
    expect(await db((tx) => assignedRoles(tx, id))).toHaveLength(0);
  });
  it("creates and edits a role with only catalogue permissions, atomically replacing its bundle", async () => {
    const result = await db((tx) =>
      saveRole(tx, MANAGER, null, { ...roleInput, description: "EMR72 test role" }),
    );
    if (result.kind !== "done") throw new Error("role not created");
    const id = Number(result.id);
    const target = await newUser("role-user");
    await db((tx) => assignRole(tx, MANAGER, target, id, f.localityA));
    expect(await db((tx) => can(tx, `role-user${DOMAIN}`, "businesses.review", f.localityA))).toBe(
      true,
    );
    expect(
      await db((tx) =>
        saveRole(tx, MANAGER, id, {
          ...roleInput,
          description: "EMR72 test edited",
          permissions: ["zones.manage"],
        }),
      ),
    ).toMatchObject({ kind: "done" });
    expect(await db((tx) => can(tx, `role-user${DOMAIN}`, "businesses.review", f.localityA))).toBe(
      false,
    );
    expect(await db((tx) => can(tx, `role-user${DOMAIN}`, "zones.manage", f.localityA))).toBe(true);
    expect(
      (await db((tx) => saveRole(tx, MANAGER, id, { ...roleInput, scope: "global" }))).kind,
    ).toBe("conflict");
    const role = await db((tx) => panelRole(tx, id));
    expect(role).toMatchObject({ scope: "locality", description: "EMR72 test edited" });
    expect(await db((tx) => rolePermissionKeys(tx, role!))).toEqual(["zones.manage"]);
    await db((tx) => tx.delete(roleAssignments).where(eq(roleAssignments.roleId, id)));
    expect(
      (
        await db((tx) =>
          saveRole(tx, MANAGER, id, {
            ...roleInput,
            description: "EMR72 test global",
            scope: "global",
            permissions: [],
          }),
        )
      ).kind,
    ).toBe("done");
  });
  it("refuses system role edits and unknown permissions without changing anything", async () => {
    const system = (
      await db((tx) => tx.select().from(roles).where(eq(roles.key, "super_admin")))
    )[0]!;
    expect(await db((tx) => saveRole(tx, MANAGER, system.id, roleInput))).toMatchObject({
      kind: "conflict",
      message: expect.stringContaining("sistema"),
    });
    expect(await db((tx) => panelRole(tx, system.id))).toEqual(system);
    expect(
      (
        await db((tx) =>
          saveRole(tx, MANAGER, null, { ...roleInput, permissions: ["invented.permission"] }),
        )
      ).kind,
    ).toBe("invalid");
    expect(
      (await db((tx) => saveRole(tx, MANAGER, null, { ...roleInput, name: "", scope: "invented" })))
        .kind,
    ).toBe("invalid");
  });
  it("requires global users.manage and roles.manage separately for every mutation", async () => {
    const id = await newUser("municipal-manager");
    await db((tx) => assignRole(tx, MANAGER, id, localityRole, f.localityA));
    const email = `municipal-manager${DOMAIN}`;
    const assignment = (await db((tx) => assignedRoles(tx, id)))[0]!;
    for (const run of [
      (tx: Db) => createPanelUser(tx, email, { email: `denied${DOMAIN}`, name: "No" }),
      (tx: Db) => setUserActive(tx, email, managerId, false),
      (tx: Db) => assignRole(tx, email, id, globalRole, null),
      (tx: Db) => removeRoleAssignment(tx, email, id, assignment.id),
      (tx: Db) => saveRole(tx, email, null, roleInput),
      (tx: Db) => saveRole(tx, email, globalRole, roleInput),
    ])
      expect(await db(run)).toEqual({ kind: "forbidden" });
    for (const [key, permission] of [
      ["users_only", "users.manage"],
      ["roles_only", "roles.manage"],
    ] as const) {
      const [role] = await db((tx) =>
        tx
          .insert(roles)
          .values({ key: `managementtest_${key}`, name: key, scope: "global" })
          .returning(),
      );
      await db((tx) =>
        tx.insert(rolePermissions).values({ roleId: role!.id, permissionKey: permission }),
      );
      const only = await newUser(key);
      await db((tx) => assignRole(tx, MANAGER, only, role!.id, null));
      expect(await db((tx) => can(tx, `${key}${DOMAIN}`, permission, null))).toBe(true);
      const denied =
        permission === "users.manage"
          ? await db((tx) => saveRole(tx, `${key}${DOMAIN}`, null, roleInput))
          : await db((tx) => setUserActive(tx, `${key}${DOMAIN}`, id, false));
      expect(denied).toEqual({ kind: "forbidden" });
    }
  });
  it("home offers the permitted sections without queue permissions and rejects inactive or unassigned users", async () => {
    expect(await db((tx) => panelHome(tx, MANAGER))).toEqual({
      queue: false,
      links: [
        { href: "/admin/usuarios", text: "Usuarios" },
        { href: "/admin/roles", text: "Roles" },
      ],
    });
    expect(await db((tx) => panelHome(tx, `unknown${DOMAIN}`))).toBeNull();
    const id = await newUser("home");
    const [role] = await db((tx) =>
      tx
        .insert(roles)
        .values({ key: "managementtest_delete", name: "Solo borrar", scope: "locality" })
        .returning(),
    );
    await db((tx) =>
      tx.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "businesses.delete" }),
    );
    await db((tx) => assignRole(tx, MANAGER, id, role!.id, f.localityA));
    expect(await db((tx) => panelHome(tx, `home${DOMAIN}`))).toEqual({
      queue: false,
      links: [{ href: "/admin/negocios", text: "Todos los negocios" }],
    });
    await db((tx) => setUserActive(tx, MANAGER, id, false));
    expect(await db((tx) => panelHome(tx, `home${DOMAIN}`))).toBeNull();
  });
  it("user and role changes do not write the card-only audit log", async () => {
    expect(
      await db((tx) =>
        tx
          .select()
          .from(adminAuditLog)
          .where(like(adminAuditLog.actor, `%${DOMAIN}`)),
      ),
    ).toEqual([]);
  });
  it("takes user, assignment and role targets only from their own page routes", () => {
    const id = crypto.randomUUID();
    expect(managedUser({ routePattern: "/admin/usuarios/[id]", params: { id } })).toBe(id);
    expect(managedRole({ routePattern: "/admin/roles/[id]", params: { id: "42" } })).toBe(42);
    for (const routePattern of [
      "/_actions/admin.deactivateUser",
      "/admin",
      "/admin/roles",
      "/[state]/[municipality]",
    ]) {
      expect(() => managedUser({ routePattern, params: { id } })).toThrow();
      expect(() => managedRole({ routePattern, params: { id: "42" } })).toThrow();
    }
    expect(() => managementRoute({ routePattern: "", params: {} }, "/admin/usuarios")).toThrow();
  });
});

const GUARD_SCHEMA = "emr72_guard";
const OPERATOR = "operator@guard.enmirumbo.test";
function guardDb<T>(run: (tx: Db) => Promise<T>): Promise<T> {
  return db(async (tx) => {
    await tx.execute(sql`SET search_path TO emr72_guard, public`);
    return run(tx);
  });
}
async function guardSetup(): Promise<void> {
  await db(async (tx) => {
    await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS ${GUARD_SCHEMA} CASCADE`));
    await tx.execute(sql.raw(`CREATE SCHEMA ${GUARD_SCHEMA}`));
    for (const table of ["users", "roles", "permissions", "role_permissions", "role_assignments"])
      await tx.execute(
        sql.raw(`CREATE TABLE ${GUARD_SCHEMA}.${table} (LIKE public.${table} INCLUDING ALL)`),
      );
    await tx.execute(
      sql`INSERT INTO emr72_guard.roles OVERRIDING SYSTEM VALUE SELECT * FROM public.roles WHERE key = 'super_admin'`,
    );
    await tx.execute(sql`INSERT INTO emr72_guard.permissions SELECT * FROM public.permissions`);
    await tx.execute(
      sql`SELECT setval(pg_get_serial_sequence('emr72_guard.roles', 'id'), (SELECT max(id) FROM emr72_guard.roles))`,
    );
  });
  await guardDb(async (tx) => {
    const [operator] = await tx
      .insert(users)
      .values({ email: OPERATOR, name: "Operador de prueba" })
      .returning();
    const [role] = await tx
      .insert(roles)
      .values({ key: "operator", name: "Gestión", scope: "global" })
      .returning();
    // The copied system id may be 1, so use the next free identity explicitly.
    await tx.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "users.manage" });
    await tx
      .insert(roleAssignments)
      .values({ userId: operator!.id, roleId: role!.id, roleScope: "global" });
  });
}
async function guardPair() {
  return guardDb(async (tx) => {
    await tx.delete(users).where(like(users.email, "super%@guard.enmirumbo.test"));
    const [role] = await tx.select().from(roles).where(eq(roles.key, "super_admin"));
    const pair = await tx
      .insert(users)
      .values(
        [1, 2].map((n) => ({
          email: `super${n}@guard.enmirumbo.test`,
          name: `Super de prueba ${n}`,
        })),
      )
      .returning();
    const assignments = await tx
      .insert(roleAssignments)
      .values(pair.map((u) => ({ userId: u.id, roleId: role!.id, roleScope: "global" as const })))
      .returning();
    return pair.map((u, i) => ({ ...u, assignment: assignments[i]!.id }));
  });
}
describe("The last active super admin (isolated access schema)", () => {
  beforeAll(guardSetup);
  afterAll(() => db((tx) => tx.execute(sql`DROP SCHEMA IF EXISTS emr72_guard CASCADE`)));
  it.each(["deactivate", "remove", "mixed"] as const)(
    "serializes two concurrent %s attempts and keeps exactly one active super admin",
    async (mode) => {
      const pair = await guardPair();
      const outcomes = await Promise.all(
        pair.map((u, index) =>
          guardDb((tx) =>
            mode === "deactivate" || (mode === "mixed" && index === 0)
              ? setUserActive(tx, OPERATOR, u.id, false)
              : removeRoleAssignment(tx, OPERATOR, u.id, u.assignment),
          ),
        ),
      );
      expect(outcomes.map((o) => o.kind).sort()).toEqual(["conflict", "done"]);
      expect(outcomes.find((o) => o.kind === "conflict")).toEqual({
        kind: "conflict",
        message: LAST_SUPER_ADMIN,
      });
      const result = await guardDb((tx) =>
        tx.execute(
          sql`SELECT count(*)::int AS n FROM users u JOIN role_assignments a ON a.user_id=u.id JOIN roles r ON r.id=a.role_id WHERE u.active AND r.key='super_admin'`,
        ),
      );
      expect(result.rows[0]).toEqual({ n: 1 });
    },
  );
  it("an inactive super admin does not allow the last active one to lose access", async () => {
    const [first, second] = await guardPair();
    await guardDb((tx) => setUserActive(tx, OPERATOR, first!.id, false));
    expect(await guardDb((tx) => setUserActive(tx, OPERATOR, second!.id, false))).toEqual({
      kind: "conflict",
      message: LAST_SUPER_ADMIN,
    });
    expect(
      await guardDb((tx) => removeRoleAssignment(tx, OPERATOR, second!.id, second!.assignment)),
    ).toEqual({ kind: "conflict", message: LAST_SUPER_ADMIN });
    expect(
      (await guardDb((tx) => removeRoleAssignment(tx, OPERATOR, first!.id, first!.assignment)))
        .kind,
    ).toBe("done");
    await guardDb((tx) => assignRole(tx, OPERATOR, first!.id, 1, null));
    await guardDb((tx) => setUserActive(tx, OPERATOR, first!.id, true));
    expect((await guardDb((tx) => setUserActive(tx, OPERATOR, second!.id, false))).kind).toBe(
      "done",
    );
  });
});
