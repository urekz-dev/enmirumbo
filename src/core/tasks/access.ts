import { asc } from "drizzle-orm";
import { can } from "../access/queries.ts";
import type { Db } from "../db/client.ts";
import { localities } from "../db/schema/index.ts";

export function manualTasksEnabled(environment: string): boolean {
  return environment === "local" || environment === "dev";
}

/** Permission is checked before even reading the available time zones. */
export async function taskTimeZones(db: Db, email: string): Promise<string[] | null> {
  if (!(await can(db, email, "tasks.run", null))) return null;
  const rows = await db
    .selectDistinct({ zone: localities.timeZone })
    .from(localities)
    .orderBy(asc(localities.timeZone));
  return rows.map((row) => row.zone);
}
