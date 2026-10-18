// Where a business is (ADR 0006): the INEGI catalogue of states and
// municipalities as reference data, the localities the directory serves, and
// the zones of each locality, loaded from the SEPOMEX postal catalogue.
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  doublePrecision,
  integer,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { coordinates, matches, PHONE_PATTERN, SLUG_PATTERN } from "./checks.ts";

/** INEGI states, keyed by their two-digit code (Hidalgo is `13`). */
export const states = pgTable(
  "states",
  {
    code: char("code", { length: 2 }).primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
  },
  (t) => [
    check("states_code_check", matches(t.code, "^[0-9]{2}$")),
    check("states_slug_check", matches(t.slug, SLUG_PATTERN)),
  ],
);

/**
 * INEGI municipalities, keyed by state code plus municipality code (Tizayuca
 * is `13069`). Names repeat across states, so the slug is unique within its
 * state: the public URL always carries both, `/{estado}/{municipio}`.
 */
export const municipalities = pgTable(
  "municipalities",
  {
    code: char("code", { length: 5 }).primaryKey(),
    stateCode: char("state_code", { length: 2 })
      .notNull()
      .references(() => states.code),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
  },
  (t) => [
    unique("municipalities_state_slug_unique").on(t.stateCode, t.slug),
    check(
      "municipalities_code_check",
      sql`${matches(t.code, "^[0-9]{5}$")} AND left(${t.code}, 2) = ${t.stateCode}`,
    ),
    check("municipalities_slug_check", matches(t.slug, SLUG_PATTERN)),
  ],
);

/**
 * A municipality the directory can serve. Its name, slug and state come from
 * its INEGI entry. Only an active locality is served; every other state and
 * municipality answers 404. The contact WhatsApp is the public number of the
 * locality's admins ("Perdí mi enlace", ARCO requests): a real number that a
 * super admin sets in the database, never in the repository. Who administers
 * a locality is in `role_assignments` (./access.ts). The coordinates are those
 * of its municipal seat in INEGI's catalogue of localities, loaded by a data
 * migration; the root highlights the active locality nearest to the visitor
 * among those that have them (src/core/locality/nearest.ts). The daily
 * registrations threshold is the number of registrations of one local day
 * past which the hourly job alerts the admin (src/core/registration/
 * threshold.ts); a super admin changes it with SQL until the panel does, and
 * none disables the alert. The day of the last alert keeps it to one a day.
 */
export const localities = pgTable(
  "localities",
  {
    code: char("code", { length: 5 })
      .primaryKey()
      .references(() => municipalities.code),
    timeZone: text("time_zone").notNull(),
    contactWhatsapp: text("contact_whatsapp"),
    dailyRegistrationThreshold: integer("daily_registration_threshold").default(20),
    dailyRegistrationAlertedOn: date("daily_registration_alerted_on", { mode: "string" }),
    active: boolean("active").notNull().default(false),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
  },
  (t) => [
    check("localities_time_zone_check", sql`btrim(${t.timeZone}) <> ''`),
    check("localities_contact_whatsapp_check", matches(t.contactWhatsapp, PHONE_PATTERN)),
    // A locality is served only with a number for "Perdí mi enlace".
    check(
      "localities_active_contact_check",
      sql`NOT ${t.active} OR ${t.contactWhatsapp} IS NOT NULL`,
    ),
    check("localities_coordinates_check", coordinates(t.latitude, t.longitude)),
    check(
      "localities_daily_registration_threshold_check",
      sql`${t.dailyRegistrationThreshold} IS NULL OR ${t.dailyRegistrationThreshold} > 0`,
    ),
  ],
);

/**
 * A settlement of a locality (colonia, fraccionamiento, pueblo, …) with its
 * SEPOMEX type. The slug is unique within the locality and never changes,
 * even when the admin renames the zone; a hidden zone is no longer offered to
 * new registrations.
 */
export const zones = pgTable(
  "zones",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    localityCode: char("locality_code", { length: 5 })
      .notNull()
      .references(() => localities.code),
    type: text("type").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    visible: boolean("visible").notNull().default(true),
  },
  (t) => [
    unique("zones_locality_slug_unique").on(t.localityCode, t.slug),
    // Target of the composite foreign keys that keep a business and its zone
    // in the same locality.
    unique("zones_id_locality_unique").on(t.id, t.localityCode),
    check("zones_type_check", sql`btrim(${t.type}) <> ''`),
    check("zones_name_check", sql`btrim(${t.name}) <> ''`),
    check("zones_slug_check", matches(t.slug, SLUG_PATTERN)),
  ],
);
