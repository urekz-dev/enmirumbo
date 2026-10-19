// SQL fragments for CHECK constraints. Drizzle Kit writes them into the
// migrations, and test/worker/data-model.test.ts verifies that the full
// migration tree leaves every one of them in force.
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/** URL slug: lowercase ASCII letters and digits in hyphen-separated words. */
export const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

/** A Mexican phone number as the server stores it: exactly ten digits. */
export const PHONE_PATTERN = "^[0-9]{10}$";

/** A Mexican postal code (SEPOMEX's `d_codigo`): exactly five digits. */
export const POSTAL_CODE_PATTERN = "^[0-9]{5}$";

/** `column IN ('a', 'b', …)` over a closed set of literals. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
  return sql`${column} IN (${sql.raw(list)})`;
}

/** `column ~ 'pattern'`, a POSIX regular expression match. */
export function matches(column: AnyPgColumn, pattern: string): SQL {
  return sql`${column} ~ ${sql.raw(`'${pattern.replaceAll("'", "''")}'`)}`;
}

/** Both columns are null, or both are set: they are written together. */
export function together(a: AnyPgColumn, b: AnyPgColumn): SQL {
  return sql`(${a} IS NULL) = (${b} IS NULL)`;
}

/**
 * A point on the Earth in two columns: both null, or both set, the latitude
 * within ±90 and the longitude within ±180 decimal degrees.
 */
export function coordinates(latitude: AnyPgColumn, longitude: AnyPgColumn): SQL {
  return sql`${together(latitude, longitude)} AND (${latitude} IS NULL OR (${latitude} BETWEEN -90 AND 90 AND ${longitude} BETWEEN -180 AND 180))`;
}
