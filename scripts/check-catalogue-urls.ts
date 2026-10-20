// The catalogue URL check of a deploy (docs/specs/data-model.md, "The slugs of
// the catalogues do not produce ambiguous URLs at the root of a locality (v2)";
// docs/specs/deployment.md, "Each environment is built and deployed by its own
// workflow (v2)"). Since EMR-52 an admin can add zones to a locality from the
// panel, so a target database may hold a zone no migration created. Before the
// workflow applies the migrations, this script applies the pending ones inside
// a transaction on that same database, runs `rootUrlConflicts` — the rule the
// routes, the tests and the panel share, never a copy — on every locality with
// zones, and rolls the transaction back. The real migration runs only when the
// check passed, so the script never leaves the database changed: an error, a
// conflict or a dead connection aborts the transaction.
//
// It prints the conflicting segments and counts only, never a card's data or a
// secret. A migration that cannot run inside a transaction (such as CREATE
// INDEX CONCURRENTLY) fails the check and stops the deploy.
//
// Usage: DATABASE_URL=<direct connection string> node scripts/check-catalogue-urls.ts [migrations folder]
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { PgDialect, PgSession } from "drizzle-orm/pg-core";
import pg from "pg";
import {
  type CatalogueEntry,
  type LocalityCatalogues,
  rootUrlConflicts,
} from "../src/core/catalogue/root-urls.ts";
import { categories, trades, zones } from "../src/core/db/schema/index.ts";
import { assertSafeConnectionString } from "../src/core/db/url.ts";

/** One conflicting segment, as the deploy is told about it. */
export interface CatalogueUrlConflict {
  /** The INEGI code of the locality, or `global` when it has no zones. */
  locality: string;
  /** The path segment under `/{estado}/{municipio}/`. */
  segment: string;
  /** How many ways the segment reads: two or more. */
  readings: number;
}

export interface CatalogueUrlCheck {
  /** How many localities with zones were checked. */
  localities: number;
  conflicts: CatalogueUrlConflict[];
}

/**
 * The database session for the migrator: its own `transaction` would begin and
 * commit on this client, and that commit would take ours with it. Run its
 * callback in the transaction the caller already opened instead.
 */
function inOuterTransaction(session: PgSession): PgSession {
  return new Proxy(session, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return (run: (tx: PgSession) => Promise<unknown>) => run(target);
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The conflicts of every locality with zones, or one global check without any. */
function conflictsOf(
  categoryRows: readonly CatalogueEntry[],
  tradeRows: readonly CatalogueEntry[],
  zoneRows: readonly { locality: string; name: string; slug: string }[],
): CatalogueUrlCheck {
  const byLocality = Map.groupBy(zoneRows, ({ locality }) => locality);
  const catalogues: { locality: string; entries: LocalityCatalogues }[] =
    byLocality.size === 0
      ? [
          {
            locality: "global",
            entries: { categories: categoryRows, trades: tradeRows, zones: [] },
          },
        ]
      : [...byLocality].map(([locality, entries]) => ({
          locality,
          entries: {
            categories: categoryRows,
            trades: tradeRows,
            zones: entries.map(({ name, slug }) => ({ name, slug })),
          },
        }));
  const conflicts = catalogues.flatMap(({ locality, entries }) =>
    rootUrlConflicts(entries).map(({ segment, readings }) => ({
      locality,
      segment,
      readings: readings.length,
    })),
  );
  return { localities: byLocality.size, conflicts };
}

/**
 * Applies the pending migrations in a transaction on `connectionString`, checks
 * the catalogue URLs of the result with `rootUrlConflicts`, and rolls the
 * transaction back however it ends. It never reads or prints a card.
 */
export async function checkCatalogueUrls(
  connectionString: string,
  migrationsFolder = "drizzle",
): Promise<CatalogueUrlCheck> {
  assertSafeConnectionString(connectionString);
  const client = new pg.Client({ connectionString });
  await client.connect();
  const db = drizzle({ client });
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    // `drizzle()` keeps its dialect and session at runtime but leaves them out
    // of the public type; the migrator needs them to run in our transaction.
    const { dialect, session } = db as unknown as { dialect: PgDialect; session: PgSession };
    const migrations = readMigrationFiles({ migrationsFolder });
    await dialect.migrate(migrations, inOuterTransaction(session), { migrationsFolder });
    // One query at a time: a `pg` client runs them in order, and pg 9 forbids
    // overlapping ones.
    const categoryRows = await db
      .select({ name: categories.name, slug: categories.slug })
      .from(categories);
    const tradeRows = await db.select({ name: trades.name, slug: trades.slug }).from(trades);
    const zoneRows = await db
      .select({ locality: zones.localityCode, name: zones.name, slug: zones.slug })
      .from(zones);
    return conflictsOf(categoryRows, tradeRows, zoneRows);
  } finally {
    // An aborted transaction rolls back on its own, but say it: the database
    // must never keep what the check applied.
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    console.error("::error::catalogue-urls: DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const migrationsFolder = process.argv[2] ?? "drizzle";
  const result = await checkCatalogueUrls(url, migrationsFolder);
  for (const { locality, segment, readings } of result.conflicts) {
    console.error(
      `::error::catalogue-urls: locality ${locality}: segment "${segment}" reads in ` +
        `${readings} ways.`,
    );
  }
  if (result.conflicts.length > 0) {
    console.error(
      `catalogue-urls: ${result.conflicts.length} conflicting segment(s) in ` +
        `${result.localities} locality(ies); the migrations were not applied. ` +
        "Fix the catalogue or the pending migrations before deploying.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `catalogue-urls: ${result.localities} locality(ies) checked, 0 conflicts; ` +
      "the pending migrations were rolled back.",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(
      `::error::catalogue-urls: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
