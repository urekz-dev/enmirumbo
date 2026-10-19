// Panel users and role bundles (ADR 0021; admin-review, EMR-72). All writes
// recheck a global permission. The audit log describes cards only, so none
// of these operations writes an audit entry.
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { localities, roleAssignments, rolePermissions, roles, users } from "../db/schema/index.ts";
import { PERMISSIONS, type Permission } from "./permissions.ts";
import { can } from "./queries.ts";

export type PanelUser = typeof users.$inferSelect;
export type PanelRole = typeof roles.$inferSelect;
export type ManagementOutcome =
  | { kind: "done"; id: string | number }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "invalid"; errors: Record<string, string> }
  | { kind: "conflict"; message: string };
export const LAST_SUPER_ADMIN =
  "Debe quedar al menos un super admin activo. Activa a otra persona con ese rol antes de hacer este cambio.";

export function panelUsers(db: Db): Promise<PanelUser[]> {
  return db.select().from(users).orderBy(asc(users.name), asc(users.email));
}
export function panelRoles(db: Db): Promise<PanelRole[]> {
  return db.select().from(roles).orderBy(asc(roles.name), asc(roles.id));
}
export async function panelUser(db: Db, id: string): Promise<PanelUser | null> {
  return (await db.select().from(users).where(eq(users.id, id)))[0] ?? null;
}
export async function panelRole(db: Db, id: number): Promise<PanelRole | null> {
  return (await db.select().from(roles).where(eq(roles.id, id)))[0] ?? null;
}
export async function assignedRoles(db: Db, userId: string) {
  return db
    .select({
      id: roleAssignments.id,
      roleId: roles.id,
      name: roles.name,
      scope: roles.scope,
      localityCode: roleAssignments.localityCode,
    })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(eq(roleAssignments.userId, userId))
    .orderBy(asc(roles.name), asc(roleAssignments.id));
}
export async function rolePermissionKeys(db: Db, role: PanelRole): Promise<Permission[]> {
  if (role.allPermissions) return Object.keys(PERMISSIONS) as Permission[];
  return (await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id))).map(
    (row) => row.permissionKey as Permission,
  );
}

export async function createPanelUser(
  db: Db,
  email: string,
  input: { email: string; name: string },
): Promise<ManagementOutcome> {
  if (!(await can(db, email, "users.manage", null))) return { kind: "forbidden" };
  const normalized = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const errors: Record<string, string> = {};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) || normalized.length > 254)
    errors["email"] = "Escribe un correo válido.";
  if (!name || name.length > 120) errors["name"] = "Escribe un nombre de hasta 120 caracteres.";
  if (Object.keys(errors).length) return { kind: "invalid", errors };
  const [row] = await db
    .insert(users)
    .values({ email: normalized, name })
    .onConflictDoNothing()
    .returning({ id: users.id });
  return row
    ? { kind: "done", id: row.id }
    : {
        kind: "invalid",
        errors: { email: "Ese correo ya tiene un usuario. Búscalo en la lista." },
      };
}

// Lock the same permanent row before either way of losing an active super
// admin. Under READ COMMITTED the following conditional write sees a fresh
// snapshot after a competing transaction commits. The guard is part of the
// write, never a count read followed by an unconditional mutation.
async function lockSuperAdmin(db: Db): Promise<void> {
  await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "super_admin")).for("update");
}
const activeSuperAdmins = sql`(SELECT count(*) FROM role_assignments a
  JOIN users u ON u.id = a.user_id JOIN roles r ON r.id = a.role_id
  WHERE u.active AND r.key = 'super_admin')`;

export async function setUserActive(
  db: Db,
  email: string,
  userId: string,
  active: boolean,
): Promise<ManagementOutcome> {
  return db.transaction(
    async (tx) => {
      await lockSuperAdmin(tx);
      if (!(await can(tx, email, "users.manage", null))) return { kind: "forbidden" };
      const [row] = await tx
        .update(users)
        .set({ active })
        .where(
          and(
            eq(users.id, userId),
            ne(users.active, active),
            active
              ? undefined
              : sql`(NOT EXISTS (SELECT 1 FROM role_assignments a JOIN roles r ON r.id = a.role_id
        WHERE a.user_id = ${users.id} AND r.key = 'super_admin') OR ${activeSuperAdmins} > 1)`,
          ),
        )
        .returning({ id: users.id });
      if (row) return { kind: "done", id: row.id };
      const target = await panelUser(tx, userId);
      if (!target) return { kind: "not-found" };
      return {
        kind: "conflict",
        message:
          target.active === active
            ? "Este usuario ya había cambiado. Recarga la página."
            : LAST_SUPER_ADMIN,
      };
    },
    { isolationLevel: "read committed" },
  );
}

export async function assignRole(
  db: Db,
  email: string,
  userId: string,
  roleId: number,
  localityCode: string | null,
): Promise<ManagementOutcome> {
  return db.transaction(async (tx) => {
    if (!(await can(tx, email, "users.manage", null))) return { kind: "forbidden" };
    // This also serializes an assignment with a concurrent scope edit.
    const [role] = await tx.select().from(roles).where(eq(roles.id, roleId)).for("share");
    if (!role || !(await panelUser(tx, userId))) return { kind: "not-found" };
    if ((role.scope === "global") !== (localityCode === null))
      return {
        kind: "invalid",
        errors: {
          locality:
            role.scope === "global"
              ? "Un rol global se asigna sin municipio."
              : "Elige el municipio donde tendrá este rol.",
        },
      };
    if (
      localityCode !== null &&
      !(
        await tx
          .select({ code: localities.code })
          .from(localities)
          .where(eq(localities.code, localityCode))
      )[0]
    )
      return { kind: "invalid", errors: { locality: "Elige un municipio del catálogo." } };
    const [row] = await tx
      .insert(roleAssignments)
      .values({ userId, roleId, roleScope: role.scope, localityCode })
      .onConflictDoNothing()
      .returning({ id: roleAssignments.id });
    return row
      ? { kind: "done", id: row.id }
      : { kind: "invalid", errors: { role: "Este usuario ya tiene ese rol en ese lugar." } };
  });
}

export async function removeRoleAssignment(
  db: Db,
  email: string,
  userId: string,
  assignmentId: number,
): Promise<ManagementOutcome> {
  return db.transaction(
    async (tx) => {
      await lockSuperAdmin(tx);
      if (!(await can(tx, email, "users.manage", null))) return { kind: "forbidden" };
      const [row] = await tx
        .delete(roleAssignments)
        .where(
          and(
            eq(roleAssignments.id, assignmentId),
            eq(roleAssignments.userId, userId),
            sql`(NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id = ${roleAssignments.roleId}
        WHERE u.id = ${roleAssignments.userId} AND u.active AND r.key = 'super_admin') OR ${activeSuperAdmins} > 1)`,
          ),
        )
        .returning({ id: roleAssignments.id });
      if (row) return { kind: "done", id: row.id };
      const remaining = await tx
        .select()
        .from(roleAssignments)
        .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.userId, userId)));
      return remaining.length
        ? { kind: "conflict", message: LAST_SUPER_ADMIN }
        : { kind: "not-found" };
    },
    { isolationLevel: "read committed" },
  );
}

export interface RoleInput {
  name: string;
  description: string;
  scope: string;
  permissions: string[];
}
export async function saveRole(
  db: Db,
  email: string,
  id: number | null,
  input: RoleInput,
): Promise<ManagementOutcome> {
  return db.transaction(async (tx) => {
    if (!(await can(tx, email, "roles.manage", null))) return { kind: "forbidden" };
    const errors: Record<string, string> = {};
    const name = input.name.trim();
    if (!name || name.length > 120) errors["name"] = "Escribe un nombre de hasta 120 caracteres.";
    if (input.description.length > 500)
      errors["description"] = "Deja la descripción en 500 caracteres o menos.";
    if (input.scope !== "global" && input.scope !== "locality")
      errors["scope"] = "Elige si el rol es global o por municipio.";
    if (input.permissions.some((key) => !Object.hasOwn(PERMISSIONS, key)))
      errors["permissions"] = "Elige permisos del catálogo.";
    if (Object.keys(errors).length) return { kind: "invalid", errors };
    const values = {
      name,
      description: input.description.trim() || null,
      scope: input.scope as "global" | "locality",
    };
    let roleId: number;
    if (id === null) {
      const [row] = await tx
        .insert(roles)
        .values({ ...values, key: `panel_${crypto.randomUUID().replaceAll("-", "")}` })
        .returning({ id: roles.id });
      roleId = row!.id;
    } else {
      // Wait for assignments in flight before evaluating the scope condition
      // in the following statement's fresh snapshot.
      await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, id)).for("update");
      const [row] = await tx
        .update(roles)
        .set(values)
        .where(
          and(
            eq(roles.id, id),
            eq(roles.system, false),
            sql`(${roles.scope} = ${values.scope} OR NOT EXISTS (SELECT 1 FROM role_assignments a WHERE a.role_id = ${roles.id}))`,
          ),
        )
        .returning({ id: roles.id });
      if (!row) {
        const role = await panelRole(tx, id);
        if (!role) return { kind: "not-found" };
        return {
          kind: "conflict",
          message: role.system
            ? "El rol Super admin es del sistema y no se puede cambiar."
            : "Este rol ya está asignado. Quita sus asignaciones antes de cambiar su alcance.",
        };
      }
      roleId = row.id;
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    }
    const keys = [...new Set(input.permissions)];
    if (keys.length)
      await tx
        .insert(rolePermissions)
        .values(keys.map((permissionKey) => ({ roleId, permissionKey })));
    return { kind: "done", id: roleId };
  });
}
