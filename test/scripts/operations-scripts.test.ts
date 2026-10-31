// Scenarios of docs/specs/deployment.md, requirements "Production is checked
// every 30 minutes (v2)" and "Production is backed up every night to a private
// bucket (v2)": scripts/monitor/check-site.sh and scripts/backup/dump-to-r2.sh.
// Each script runs in bash with a clean environment and stand-ins instead of
// the network, Neon and R2 (test/scripts/fake-curl.sh, fake-backup-tools.sh).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_readConfig } from "wrangler";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "enmirumbo-operations-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[], env: Record<string, string> = {}): Run {
  // A clean environment. `wrangler types` declares the Worker vars as required
  // on ProcessEnv, which a child process does not need, hence Object.assign.
  const childEnv: NodeJS.ProcessEnv = Object.assign(Object.create(null) as NodeJS.ProcessEnv, {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: work,
    ...env,
  });
  const result = spawnSync("bash", [join(ROOT, script), ...args], {
    cwd: work,
    encoding: "utf8",
    env: childEnv,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function bin(): string {
  const dir = join(work, "bin");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// check-site.sh

type Answer = { status: number; headers?: Record<string, string>; body?: unknown };

interface CurlCall {
  argv: string[];
  method: string;
  url: string;
}

function fakeNetwork(routes: Record<string, Answer[]>) {
  const dir = bin();
  copyFileSync(join(ROOT, "test/scripts/fake-curl.sh"), join(dir, "curl"));
  chmodSync(join(dir, "curl"), 0o755);
  const routesFile = join(work, "routes.json");
  const logFile = join(work, "curl.log");
  writeFileSync(routesFile, JSON.stringify(routes));
  writeFileSync(logFile, "");
  return {
    env: {
      PATH: `${dir}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
      FAKE_CURL_ROUTES: routesFile,
      FAKE_CURL_LOG: logFile,
      MONITOR_DELAY: "0",
    },
    calls: (): CurlCall[] =>
      readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as CurlCall),
  };
}

const SITE = "https://enmirumbo.com";
const checkSite = (env: Record<string, string>, origin = SITE) =>
  run("scripts/monitor/check-site.sh", [origin], env);

describe("Production is checked every 30 minutes (v2): the workflow", () => {
  it("checks the SITE_URL of prod every 30 minutes", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/monitor.yml"), "utf8");
    const prod = unstable_readConfig({ config: join(ROOT, "wrangler.jsonc"), env: "prod" }) as {
      vars: Record<string, unknown>;
    };

    expect(workflow).toMatch(/^ {4}- cron: "7,37 \* \* \* \*"$/m);
    expect(workflow).toContain(`SITE_URL: ${String(prod.vars["SITE_URL"])}\n`);
  });
});

describe("Production is checked every 30 minutes (v2): the check", () => {
  it("passes when the home answers 200 and /health answers ok", () => {
    const net = fakeNetwork({
      [`GET ${SITE}/`]: [{ status: 200, body: "<!doctype html>" }],
      [`GET ${SITE}/health`]: [{ status: 200, body: "ok" }],
    });

    const result = checkSite(net.env);

    expect(result.status).toBe(0);
    const [home, health] = net.calls();
    // The home follows its redirects, only to https.
    expect(home?.argv).toEqual(expect.arrayContaining(["--location", "--proto-redir", "=https"]));
    expect(health?.url).toBe(`${SITE}/health`);
    expect(health?.argv).not.toContain("--location");
  });

  it("retries a check before it counts as failed", () => {
    const net = fakeNetwork({
      [`GET ${SITE}/`]: [{ status: 0 }, { status: 503 }, { status: 200 }],
      [`GET ${SITE}/health`]: [{ status: 200, body: "ok" }],
    });

    const result = checkSite(net.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("attempt 2 of 3");
    expect(net.calls().filter((call) => call.url === `${SITE}/`)).toHaveLength(3);
  });

  it("fails naming both problems when the home and /health fail", () => {
    const net = fakeNetwork({
      [`GET ${SITE}/`]: [{ status: 500 }],
      [`GET ${SITE}/health`]: [{ status: 503, body: "unavailable" }],
    });

    const result = checkSite(net.env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GET / answered 500, expected 200 (after 3 attempts)");
    expect(result.stderr).toContain("GET /health answered 503, expected 200 (after 3 attempts)");
  });

  it.for([
    [
      "a 200 without ok",
      { status: 200, body: "unavailable" },
      "GET /health answered 200 without 'ok'",
    ],
    ["a connection error", { status: 0 }, "GET /health answered 000, expected 200"],
  ] as const)("fails on %s from /health", ([, answer, message]) => {
    const net = fakeNetwork({
      [`GET ${SITE}/`]: [{ status: 200 }],
      [`GET ${SITE}/health`]: [answer],
    });

    const result = checkSite({ ...net.env, MONITOR_ATTEMPTS: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it.for(["http://enmirumbo.com", `${SITE}/`, "enmirumbo.com"])(
    "refuses %s as the origin before any request",
    (origin) => {
      const net = fakeNetwork({});
      const result = checkSite(net.env, origin);
      expect(result.status).toBe(1);
      expect(net.calls()).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// dump-to-r2.sh

interface ToolCall {
  tool: "pg_dump" | "pg_restore" | "aws";
  argv: string[];
  env: Record<string, string>;
}

const PASSWORD = "p@ss-word/123";
const ENCODED_PASSWORD = "p%40ss-word%2F123";
const HOST = "ep-fictional-host-000000.c-1.us-east-1.aws.neon.tech";
const ACCOUNT = "f".repeat(32);
const SECRET_KEY = "fictional-r2-secret-access-key";
const BACKUP_ENV = {
  DATABASE_URL: `postgresql://enmirumbo_backup:${ENCODED_PASSWORD}@${HOST}/enmirumbodb?sslmode=verify-full`,
  R2_ACCESS_KEY_ID: "fictional-r2-access-key-id",
  R2_SECRET_ACCESS_KEY: SECRET_KEY,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  BACKUP_BUCKET: "enmirumbo-backups",
};

function fakeTools() {
  const dir = bin();
  for (const tool of ["pg_dump", "pg_restore", "aws"]) {
    copyFileSync(join(ROOT, "test/scripts/fake-backup-tools.sh"), join(dir, tool));
    chmodSync(join(dir, tool), 0o755);
  }
  const store = join(work, "bucket");
  const logFile = join(work, "tools.log");
  const summary = join(work, "summary.md");
  mkdirSync(store);
  writeFileSync(logFile, "");
  return {
    env: {
      PATH: `${dir}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
      FAKE_TOOLS_LOG: logFile,
      FAKE_STORE: store,
      GITHUB_STEP_SUMMARY: summary,
    },
    calls: (): ToolCall[] =>
      readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as ToolCall),
    stored: (): string[] => {
      const prefix = join(store, "prod");
      try {
        return readdirSync(prefix).map((name) => `prod/${name}`);
      } catch {
        return [];
      }
    },
    read: (key: string) => readFileSync(join(store, key)),
    summary: () => readFileSync(summary, "utf8"),
  };
}

const backup = (env: Record<string, string>) => run("scripts/backup/dump-to-r2.sh", [], env);

function argAfter(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

describe("Production is backed up every night to a private bucket (v2): the dump", () => {
  it("dumps in the custom format and uploads it under prod/ with its checksum", () => {
    const tools = fakeTools();

    const result = backup({ ...tools.env, ...BACKUP_ENV });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const [key, ...others] = tools.stored();
    expect(others).toEqual([]);
    expect(key).toMatch(/^prod\/enmirumbo-\d{8}T\d{6}Z\.dump$/);

    const calls = tools.calls();
    const dump = calls.find((call) => call.tool === "pg_dump" && call.argv[0] !== "--version");
    expect(dump?.argv).toContain("--format=custom");
    expect(argAfter(dump?.argv ?? [], "--dbname")).toBe(
      `postgresql://enmirumbo_backup@${HOST}/enmirumbodb?sslmode=verify-full&sslrootcert=system`,
    );
    expect(dump?.env["PGPASSWORD"]).toBe(PASSWORD);

    const put = calls.find((call) => call.tool === "aws" && call.argv[1] === "put-object");
    expect(argAfter(put?.argv ?? [], "--endpoint-url")).toBe(
      `https://${ACCOUNT}.r2.cloudflarestorage.com`,
    );
    expect(argAfter(put?.argv ?? [], "--bucket")).toBe("enmirumbo-backups");
    const sha256 = createHash("sha256")
      .update(tools.read(key ?? ""))
      .digest("hex");
    expect(argAfter(put?.argv ?? [], "--metadata")).toBe(`sha256=${sha256}`);
    expect(put?.env).toMatchObject({
      AWS_ACCESS_KEY_ID: "fictional-r2-access-key-id",
      AWS_SECRET_ACCESS_KEY: SECRET_KEY,
      AWS_DEFAULT_REGION: "auto",
      AWS_REQUEST_CHECKSUM_CALCULATION: "when_required",
    });
    expect(tools.summary()).toContain(`enmirumbo-backups/${key}`);
    expect(tools.summary()).toContain(sha256);
  });

  it("keeps the password and the R2 secret off every command line and out of the log", () => {
    const tools = fakeTools();

    const result = backup({ ...tools.env, ...BACKUP_ENV });

    expect(result.status).toBe(0);
    for (const secret of [PASSWORD, ENCODED_PASSWORD, SECRET_KEY]) {
      for (const call of tools.calls()) expect(call.argv.join(" ")).not.toContain(secret);
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
    // Only pg_dump receives the password.
    for (const call of tools.calls().filter((call) => call.tool !== "pg_dump")) {
      expect(call.env["PGPASSWORD"]).toBe("");
    }
  });

  it("masks the database host on GitHub Actions and never prints it otherwise", () => {
    const tools = fakeTools();

    const result = backup({ ...tools.env, ...BACKUP_ENV, GITHUB_ACTIONS: "true" });

    expect(result.status).toBe(0);
    const lines = (result.stdout + result.stderr).split("\n");
    expect(lines).toContain(`::add-mask::${HOST}`);
    expect(lines.filter((line) => line.includes(HOST))).toHaveLength(1);
  });

  it("keeps an sslrootcert the connection string already sets", () => {
    const tools = fakeTools();
    const url = `${BACKUP_ENV.DATABASE_URL}&sslrootcert=/etc/ssl/certs/ca.pem`;

    expect(backup({ ...tools.env, ...BACKUP_ENV, DATABASE_URL: url }).status).toBe(0);

    const dump = tools.calls().find((call) => call.argv.includes("--dbname"));
    expect(argAfter(dump?.argv ?? [], "--dbname")).toBe(
      `postgresql://enmirumbo_backup@${HOST}/enmirumbodb?sslmode=verify-full&sslrootcert=/etc/ssl/certs/ca.pem`,
    );
  });
});

describe("Production is backed up every night to a private bucket (v2): what stops it", () => {
  const url = (rest: string) => `postgresql://enmirumbo_backup:${ENCODED_PASSWORD}@${rest}`;

  it.for([
    ["no DATABASE_URL", { DATABASE_URL: "" }, "DATABASE_URL is not set"],
    ["no R2 secret", { R2_SECRET_ACCESS_KEY: "" }, "R2_SECRET_ACCESS_KEY is not set"],
    [
      "sslmode=require",
      { DATABASE_URL: url(`${HOST}/enmirumbodb?sslmode=require`) },
      "sslmode=verify-full",
    ],
    ["no parameters", { DATABASE_URL: url(`${HOST}/enmirumbodb`) }, "must look like"],
    [
      "no password",
      { DATABASE_URL: `postgresql://enmirumbo_backup@${HOST}/enmirumbodb?sslmode=verify-full` },
      "must look like",
    ],
    [
      "the pooled host",
      {
        DATABASE_URL: url(
          "ep-fictional-host-000000-pooler.c-1.us-east-1.aws.neon.tech/enmirumbodb?sslmode=verify-full",
        ),
      },
      "direct host",
    ],
    [
      "a bad account id",
      { CLOUDFLARE_ACCOUNT_ID: "not-an-account" },
      "not a Cloudflare account id",
    ],
    ["a bad bucket", { BACKUP_BUCKET: "Backups_Bucket" }, "not an R2 bucket name"],
    ["a bad prefix", { BACKUP_PREFIX: "prod" }, "end with a slash"],
    ["pg_dump 17", { FAKE_PG_DUMP_VERSION: "pg_dump (PostgreSQL) 17.6" }, "pg_dump 18 or later"],
  ] as const)("refuses %s before dumping anything", ([, override, message]) => {
    const tools = fakeTools();

    const result = backup({ ...tools.env, ...BACKUP_ENV, ...override });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stderr).not.toContain(ENCODED_PASSWORD);
    expect(tools.calls().filter((call) => call.argv[0] !== "--version")).toEqual([]);
  });

  it.for([
    ["pg_dump fails", { FAKE_PG_DUMP_FAIL: "1" }, "pg_dump failed"],
    ["the dump does not read back", { FAKE_PG_RESTORE_FAIL: "1" }, "does not read back"],
    [
      "the dump holds no table data",
      { FAKE_PG_RESTORE_LIST: "3340; 2615 16390 SCHEMA - drizzle enmirumbodb_owner" },
      "holds no table data",
    ],
  ] as const)("uploads nothing when %s", ([, override, message]) => {
    const tools = fakeTools();

    const result = backup({ ...tools.env, ...BACKUP_ENV, ...override });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(tools.calls().filter((call) => call.tool === "aws")).toEqual([]);
    expect(tools.stored()).toEqual([]);
  });

  it.for([
    ["the upload fails", { FAKE_AWS_PUT_FAIL: "1" }, "the upload to R2 failed"],
    ["R2 holds another size", { FAKE_AWS_HEAD_SIZE: "1" }, "R2 holds 1 bytes"],
  ] as const)("fails when %s", ([, override, message]) => {
    const tools = fakeTools();

    const result = backup({ ...tools.env, ...BACKUP_ENV, ...override });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
