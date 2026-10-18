// docs/specs/deployment.md, requirement "The commands that write in bulk read
// the environment from `ENVIRONMENT` (v2)": scripts/db-seed.ts refuses a
// remote database without ENVIRONMENT, never writes in production, and on dev
// and stage needs the directory of its photos. Every case stops before
// connecting, so no database is needed.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REMOTE = "postgres://seed:seed@db.example.com/enmirumbo?sslmode=verify-full";

function seed(env: Record<string, string>) {
  // A clean environment. `wrangler types` declares the Worker vars as required
  // on ProcessEnv, hence Object.assign.
  const childEnv: NodeJS.ProcessEnv = Object.assign(Object.create(null) as NodeJS.ProcessEnv, {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    ...env,
  });
  return spawnSync(process.execPath, ["scripts/db-seed.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    env: childEnv,
    timeout: 30_000,
  });
}

describe("The commands that write in bulk read the environment from `ENVIRONMENT` (v2)", () => {
  it("the seed pointing to a remote database", () => {
    const run = seed({ DATABASE_URL: REMOTE });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("refused, DATABASE_URL is not a local database");
    expect(run.stderr).toContain("ENVIRONMENT=");
    expect(run.stdout).not.toContain("done");
  });

  // data-model, "The demo seed leaves cards with a photo to see the directory
  // as the resident will see it": on dev and stage the photos go to the
  // directory the next step of the deploy uploads, never nowhere.
  it.for(["dev", "stage"])("the seed of %s without a directory for its photos", (environment) => {
    const run = seed({ DATABASE_URL: REMOTE, ENVIRONMENT: environment });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`ENVIRONMENT=${environment} needs SEED_MEDIA_DIR`);
    expect(run.stdout).not.toContain("done");
  });

  it("the seed in production", () => {
    const run = seed({ DATABASE_URL: REMOTE, ENVIRONMENT: "prod" });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("seeds never run against prod");
    expect(run.stdout).not.toContain("done");
  });
});
