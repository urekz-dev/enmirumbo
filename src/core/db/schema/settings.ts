// The switches of the whole site (docs/specs/data-model.md, "The site's
// switches live in one row of the database (v2)"): one single row, one typed
// column per switch, each with the default it takes when the migration that
// adds it runs. A switch is changed in the database, never with a deploy:
// today with one SQL statement (README, Operations), later from the panel
// (epic F). The next switch is a new column with its default, in its own
// migration.
import { sql } from "drizzle-orm";
import { boolean, check, pgTable } from "drizzle-orm/pg-core";

/**
 * The site's settings, one row. `singleton` is always true, so a second row
 * cannot exist. The migration that creates the table inserts the row.
 */
export const siteSettings = pgTable(
  "site_settings",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    // Turnstile on the registration and edit forms (ADR 0012): on unless an
    // admin turns it off, for example when Cloudflare's challenge fails.
    turnstileEnabled: boolean("turnstile_enabled").notNull().default(true),
  },
  (t) => [check("site_settings_singleton_check", sql`${t.singleton}`)],
);
