// Reading the site's switches (docs/specs/data-model.md, "The site's switches
// live in one row of the database (v2)"; src/core/db/schema/settings.ts).
// Every switch reads its own column of the one row. When the row is missing,
// which no migrated database allows on purpose, each switch takes its safe
// default: Turnstile stays on.
//
// The caller chooses the binding: a page reads through the cached HYPERDRIVE,
// so a change reaches it within a minute; an action decides through
// HYPERDRIVE_FRESH, so a switch turned off lets submissions through at once.
import type { Db } from "../db/client.ts";
import { siteSettings } from "../db/schema/index.ts";

/** Whether the registration and edit forms ask for Turnstile (ADR 0012). */
export async function isTurnstileEnabled(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ turnstileEnabled: siteSettings.turnstileEnabled })
    .from(siteSettings)
    .limit(1);
  return row?.turnstileEnabled ?? true;
}
