// The panel user of the end-to-end tests. `astro preview` runs with the local
// vars of wrangler.jsonc, so every request to /admin on localhost carries the
// fixed local identity, admin@enmirumbo.test (docs/specs/admin-review.md,
// "Locally, a fixed identity is injected only when the environment says
// `local` (v2)"); what that identity may do comes from the database, like any
// panel user's ("Inside the panel, a user can do only what their roles allow
// (v2)"). The global setup makes it a super admin, the way the README says a
// developer does by hand, and test/e2e/admin.spec.ts narrows its roles for a
// while to see what another user sees, giving them back afterwards. Never in
// a migration or the seed: nothing about people lives there.
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../src/core/db/schema/index.ts";
import { LOCAL_ADMIN_EMAIL } from "../../src/lib/access/verify.ts";

type Database = NodePgDatabase<typeof schema>;

const { roleAssignments, roles, users } = schema;

/** The panel user of the local identity, created if missing. */
async function localAdmin(db: Database): Promise<string> {
  await db
    .insert(users)
    .values({ email: LOCAL_ADMIN_EMAIL, name: "Admin local de prueba" })
    .onConflictDoNothing();
  const [user] = await db.select().from(users).where(eq(users.email, LOCAL_ADMIN_EMAIL));
  if (user === undefined) throw new Error("e2e: the local admin could not be created");
  await db.update(users).set({ active: true }).where(eq(users.id, user.id));
  return user.id;
}

/**
 * Gives the local identity exactly these roles: `super_admin` everywhere, or
 * a locality role in each locality listed. An empty list leaves it with none.
 */
export async function setLocalAdminRoles(
  db: Database,
  assignments: readonly { role: string; locality: string | null }[],
): Promise<void> {
  const userId = await localAdmin(db);
  await db.delete(roleAssignments).where(eq(roleAssignments.userId, userId));
  for (const { role, locality } of assignments) {
    const [row] = await db.select().from(roles).where(eq(roles.key, role));
    if (row === undefined) throw new Error(`e2e: no role ${role}`);
    await db
      .insert(roleAssignments)
      .values({ userId, roleId: row.id, roleScope: row.scope, localityCode: locality })
      .onConflictDoNothing();
  }
}

/** The local identity as a super admin, which every test but those of roles expects. */
export function ensureLocalSuperAdmin(db: Database): Promise<void> {
  return setLocalAdminRoles(db, [{ role: "super_admin", locality: null }]);
}
