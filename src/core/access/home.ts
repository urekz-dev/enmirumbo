// The panel entry for an active user, including roles without queue permissions.
import { eq, and } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { users, roleAssignments } from "../db/schema/index.ts";
import { panelScope, queueLocalities } from "../review/scope.ts";
import { auditLogPath, businessesPath, queuePath } from "../review/paths.ts";
import { zonesPath } from "../zones/paths.ts";
import { zonesLocalities } from "../zones/scope.ts";
import { can } from "./queries.ts";
import { rolesPath, usersPath } from "./paths.ts";
export interface PanelLink {
  href: string;
  text: string;
}
export async function panelHome(
  db: Db,
  email: string,
): Promise<{ queue: boolean; links: PanelLink[] } | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roleAssignments, eq(roleAssignments.userId, users.id))
    .where(and(eq(users.email, email.trim().toLowerCase()), eq(users.active, true)))
    .limit(1);
  if (!user) return null;
  const scope = await panelScope(db, email);
  const queue = queueLocalities(scope).length > 0;
  const links: PanelLink[] = [];
  if (queue) links.push({ href: queuePath(), text: "Cola de revisión" });
  if (scope.cards.length) links.push({ href: businessesPath(), text: "Todos los negocios" });
  if (scope.log.length) links.push({ href: auditLogPath(), text: "Ver la bitácora" });
  if ((await zonesLocalities(db, email)).length)
    links.push({ href: zonesPath(), text: "Colonias" });
  if (await can(db, email, "users.manage", null))
    links.push({ href: usersPath(), text: "Usuarios" });
  if (await can(db, email, "roles.manage", null)) links.push({ href: rolesPath(), text: "Roles" });
  return { queue, links };
}
