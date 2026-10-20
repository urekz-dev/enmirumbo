// Scenarios of docs/specs/data-model.md, "The slugs of the catalogues do not
// produce ambiguous URLs at the root of a locality (v2)", and of
// docs/specs/deployment.md, "Each environment is built and deployed by its own
// workflow (v2)": scripts/check-catalogue-urls.ts, which a deploy runs right
// before `vp run db:migrate`. Each test creates a database of its own on the
// PostgreSQL server of DATABASE_URL, so the database the other test files use
// is never touched.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BASE =
  process.env["DATABASE_URL"] ?? "postgres://enmirumbo:enmirumbo@localhost:5432/enmirumbo_test";

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let work: string;
let created: string[] = [];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "enmirumbo-catalogue-urls-"));
  created = [];
});

afterEach(async () => {
  for (const database of created) await dropDatabase(database);
  rmSync(work, { recursive: true, force: true });
});

/** The URL of another database of the same server as DATABASE_URL. */
function databaseUrl(database: string): string {
  const url = new URL(BASE);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withClient<T>(database: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function createDatabase(): Promise<string> {
  const database = `enmirumbo_urls_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await withClient("postgres", (client) => client.query(`CREATE DATABASE "${database}"`));
  created.push(database);
  return database;
}

async function dropDatabase(database: string): Promise<void> {
  await withClient("postgres", (client) =>
    client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`),
  );
}

/** Applies the real migration tree, as a deployed database has it. */
async function migrateDatabase(database: string): Promise<void> {
  await withClient(database, async (client) => {
    await migrate(drizzle({ client }), { migrationsFolder: join(ROOT, "drizzle") });
  });
}

/** A copy of the migration tree with one pending migration appended. */
function withPendingMigration(sql: string): string {
  const folder = join(work, "migrations");
  cpSync(join(ROOT, "drizzle"), folder, { recursive: true });
  const journalFile = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  const last = journal.entries[journal.entries.length - 1];
  journal.entries.push({
    idx: journal.entries.length,
    version: "7",
    when: (last?.when ?? 0) + 1,
    tag: "9999_pending",
    breakpoints: true,
  });
  writeFileSync(journalFile, JSON.stringify(journal));
  writeFileSync(join(folder, "9999_pending.sql"), sql);
  return folder;
}

function runCheck(database: string, migrationsFolder?: string): Run {
  const childEnv: NodeJS.ProcessEnv = Object.assign(Object.create(null) as NodeJS.ProcessEnv, {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: work,
    DATABASE_URL: databaseUrl(database),
  });
  const args = [join(ROOT, "scripts/check-catalogue-urls.ts")];
  if (migrationsFolder !== undefined) args.push(migrationsFolder);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: childEnv,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Runs the check with no DATABASE_URL at all. */
function runWithoutDatabaseUrl(): Run {
  const childEnv: NodeJS.ProcessEnv = Object.assign(Object.create(null) as NodeJS.ProcessEnv, {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: work,
  });
  const result = spawnSync(process.execPath, [join(ROOT, "scripts/check-catalogue-urls.ts")], {
    cwd: ROOT,
    encoding: "utf8",
    env: childEnv,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function scalar(database: string, sql: string): Promise<unknown> {
  return withClient(database, async (client) => {
    const result = await client.query<{ value: unknown }>(sql);
    return result.rows[0]?.value;
  });
}

describe("The slugs of the catalogues do not produce ambiguous URLs at the root of a locality (v2): the deploy check", () => {
  it("a clean database passes and keeps nothing of the pending migrations", async () => {
    const database = await createDatabase();

    const result = runCheck(database);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("1 locality(ies) checked, 0 conflicts");
    // The transaction rolled the whole migration tree back: no table, not even
    // the migrator's own schema, remains.
    expect(
      await scalar(
        database,
        "select count(*)::int as value from pg_tables where schemaname = 'public'",
      ),
    ).toBe(0);
    expect(await scalar(database, "select to_regnamespace('drizzle') is null as value")).toBe(true);
  });

  it("a conflicting zone the panel added fails the check and leaves the database unchanged", async () => {
    const database = await createDatabase();
    await migrateDatabase(database);
    await withClient(database, (client) =>
      client.query(
        `insert into zones (locality_code, type, name, slug, postal_code)
         values ('13069', 'Colonia', 'Talleres', 'talleres', '43800')`,
      ),
    );
    const before = {
      zones: await scalar(database, "select count(*)::int as value from zones"),
      migrations: await scalar(
        database,
        "select count(*)::int as value from drizzle.__drizzle_migrations",
      ),
    };

    const result = runCheck(database);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('segment "talleres" reads in 2 ways');
    expect(result.stderr).toContain("the migrations were not applied");
    expect(result.stderr).not.toContain("Talleres"); // the segment, never a name
    expect(
      await scalar(database, "select count(*)::int as value from zones where slug = 'talleres'"),
    ).toBe(1);
    expect({
      zones: await scalar(database, "select count(*)::int as value from zones"),
      migrations: await scalar(
        database,
        "select count(*)::int as value from drizzle.__drizzle_migrations",
      ),
    }).toEqual(before);
  });

  it("a pending migration that adds a conflicting trade fails the check and is rolled back", async () => {
    const database = await createDatabase();
    await migrateDatabase(database);
    // The pending migration alone makes the URL ambiguous, and it also leaves a
    // table behind to see the rollback.
    const folder = withPendingMigration(
      'CREATE TABLE "pending_marker" ("id" integer);--> statement-breakpoint\n' +
        `INSERT INTO "trades" ("name", "slug") VALUES ('Talleres', 'talleres');`,
    );
    const migrations = await scalar(
      database,
      "select count(*)::int as value from drizzle.__drizzle_migrations",
    );

    const result = runCheck(database, folder);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('segment "talleres" reads in 2 ways');
    expect(
      await scalar(database, "select to_regclass('public.pending_marker') is null as value"),
    ).toBe(true);
    expect(
      await scalar(database, "select count(*)::int as value from trades where slug = 'talleres'"),
    ).toBe(0);
    expect(
      await scalar(database, "select count(*)::int as value from drizzle.__drizzle_migrations"),
    ).toBe(migrations);
  });

  it("refuses to run without DATABASE_URL", () => {
    const result = runWithoutDatabaseUrl();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is not set");
  });

  it("refuses a remote database without certificate verification, before connecting", () => {
    const result = spawnSync(process.execPath, [join(ROOT, "scripts/check-catalogue-urls.ts")], {
      cwd: ROOT,
      encoding: "utf8",
      env: Object.assign(Object.create(null) as NodeJS.ProcessEnv, {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        HOME: work,
        DATABASE_URL: "postgres://user:secret@db.example.com:5432/enmirumbo",
      }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sslmode=verify-full");
    expect(result.stderr).not.toContain("secret");
  });
});

describe("Each environment is built and deployed by its own workflow (v2): the catalogue URL step", () => {
  it.for(["deploy-dev.yml", "deploy-stage.yml", "deploy-prod.yml"])(
    "%s runs the check right before the migrations, with the same DATABASE_URL",
    (file) => {
      const workflow = readFileSync(join(ROOT, ".github/workflows", file), "utf8");
      const check = workflow.indexOf("- name: Check the catalogue URLs");
      const migrations = workflow.indexOf("- name: Apply the migrations");
      expect(check).toBeGreaterThan(-1);
      expect(migrations).toBeGreaterThan(check);
      // Nothing but comments and the DATABASE_URL of its own env sits between them.
      const between = workflow.slice(check, migrations);
      expect(between).toContain("run: node scripts/check-catalogue-urls.ts");
      expect(between).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    },
  );
});
