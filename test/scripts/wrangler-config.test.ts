// Scenarios of docs/specs/deployment.md, requirements "Three deployed
// environments, each with its own Worker, bindings and variables (v2)",
// "Public media live in R2, in one bucket for production and one for dev and
// stage (v2)" and "Scheduled work runs from one hourly Cron Trigger per
// environment (v2)" (scenario "one trigger"). Reads wrangler.jsonc the way Wrangler resolves it
// for each environment, so a binding or variable that an environment only
// inherits, or forgets, fails here instead of in a deploy.
import { experimental_readRawConfig, unstable_readConfig } from "wrangler";
import { describe, expect, it } from "vite-plus/test";

const DEV_MEDIA = { bucket: "enmirumbo-media-dev", url: "https://media-dev-enmirumbo.urekz.com" };
const PROD_MEDIA = { bucket: "enmirumbo-media", url: "https://media-enmirumbo.urekz.com" };

const ENVIRONMENTS = [
  { env: "dev", name: "dev-enmirumbo", crons: [], media: DEV_MEDIA },
  { env: "stage", name: "stage-enmirumbo", crons: ["0 * * * *"], media: DEV_MEDIA },
  { env: "prod", name: "enmirumbo", crons: ["0 * * * *"], media: PROD_MEDIA },
] as const;

const VARIABLES = [
  "ENVIRONMENT",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_AUD",
  "SITE_URL",
  "MEDIA_URL",
  "UMAMI_WEBSITE_ID",
];
const HYPERDRIVE_BINDINGS = ["HYPERDRIVE", "HYPERDRIVE_FRESH"];

// The fields these tests read. Wrangler's own Config type comes from a package
// it bundles without its types, so it is narrowed here.
interface ResolvedConfig {
  name?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  route?: unknown;
  routes?: unknown[];
  triggers: { crons?: string[] };
  vars: Record<string, unknown>;
  hyperdrive: { binding: string; id: string; localConnectionString?: string }[];
  durable_objects: { bindings: { name: string; class_name: string; script_name?: string }[] };
  exports?: Record<string, unknown>;
  migrations: unknown[];
  r2_buckets: { binding: string; bucket_name?: string }[];
}

function read(env?: string): ResolvedConfig {
  const args = { config: "wrangler.jsonc", ...(env === undefined ? {} : { env }) };
  return unstable_readConfig(args) as ResolvedConfig;
}

describe("Three deployed environments, each with its own Worker, bindings and variables (v2)", () => {
  it.for(ENVIRONMENTS)(
    "per environment: $env has its Worker, workers.dev on and Version URLs off",
    ({ env, name }) => {
      const config = read(env);
      expect(config.name).toBe(name);
      expect(config.workers_dev).toBe(true);
      expect(config.preview_urls).toBe(false);
      // Custom Domains and routes arrive with EMR-63.
      expect(config.routes ?? []).toEqual([]);
      expect(config.route).toBeUndefined();
    },
  );

  it.for(ENVIRONMENTS)(
    "per environment: $env declares its own variables and SITE_URL",
    ({ env, name }) => {
      const config = read(env);
      expect(Object.keys(config.vars)).toEqual(expect.arrayContaining(VARIABLES));
      expect(config.vars["ENVIRONMENT"]).toBe(env);
      expect(config.vars["ACCESS_TEAM_DOMAIN"]).toBe("urekz.cloudflareaccess.com");
      expect(config.vars["SITE_URL"]).toBe(`https://${name}.urekz.workers.dev`);
    },
  );

  it.for(ENVIRONMENTS)(
    "per environment: $env binds its public media bucket and names its media hostname",
    ({ env, media }) => {
      const config = read(env);
      expect(config.r2_buckets).toEqual([{ binding: "MEDIA", bucket_name: media.bucket }]);
      expect(config.vars["MEDIA_URL"]).toBe(media.url);
      // Wrangler would let an environment inherit the binding; each declares it.
      const raw = experimental_readRawConfig({ config: "wrangler.jsonc" }).rawConfig as {
        env: Record<string, Record<string, unknown>>;
      };
      expect(raw.env[env]).toHaveProperty("r2_buckets");
    },
  );

  // base-layout, "Cookieless measurement is loaded only in production and only
  // when configured (v2)": only prod may carry a Website ID, which the launch
  // sets; until then it is empty too.
  it("only prod may carry an Umami Website ID", () => {
    for (const env of [undefined, "dev", "stage"]) {
      expect(read(env).vars["UMAMI_WEBSITE_ID"], env ?? "local").toBe("");
    }
    expect(read("prod").vars["UMAMI_WEBSITE_ID"]).toMatch(
      /^(|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
    );
  });

  it.for(ENVIRONMENTS)(
    "per environment: $env has both Hyperdrive bindings, with ids of its own",
    ({ env }) => {
      const config = read(env);
      expect(config.hyperdrive.map((h) => h.binding).sort()).toEqual(HYPERDRIVE_BINDINGS);
      const ids = config.hyperdrive.map((h) => h.id);
      // Two configs: cached and fresh.
      expect(new Set(ids).size).toBe(2);
      // Never the local placeholder, and never another environment's id.
      expect(ids).not.toContain("00000000000000000000000000000000");
      for (const other of ENVIRONMENTS.filter((e) => e.env !== env)) {
        for (const id of read(other.env).hyperdrive.map((h) => h.id)) {
          expect(ids).not.toContain(id);
        }
      }
      // A deployed binding never points at a local database.
      for (const binding of config.hyperdrive) {
        expect(binding.localConnectionString).toBeUndefined();
      }
    },
  );

  // deployment, "Anti-abuse counters live in a Durable Object and never in
  // PostgreSQL (v2)"
  it.for(ENVIRONMENTS)(
    "per environment: $env binds its own quota counter, declared with SQLite storage",
    ({ env }) => {
      const config = read(env);
      expect(config.durable_objects.bindings).toEqual([
        { name: "QUOTA_COUNTER", class_name: "QuotaCounter" },
      ]);
      expect(config.exports).toEqual({
        QuotaCounter: { type: "durable-object", storage: "sqlite" },
      });
      // `exports` and the legacy `migrations` cannot be used together.
      expect(config.migrations).toEqual([]);
      // Wrangler would let an environment inherit `exports`; each declares it.
      const raw = experimental_readRawConfig({ config: "wrangler.jsonc" }).rawConfig as {
        env: Record<string, Record<string, unknown>>;
      };
      expect(raw.env[env]).toHaveProperty("exports");
      expect(raw.env[env]).toHaveProperty("durable_objects");
    },
  );

  it("nothing inherited: every top-level binding and variable is declared again in each environment", () => {
    const top = read();
    for (const { env } of ENVIRONMENTS) {
      const config = read(env);
      for (const variable of Object.keys(top.vars)) {
        expect(config.vars, `${env} declares ${variable}`).toHaveProperty(variable);
      }
      expect(config.hyperdrive.map((h) => h.binding).sort()).toEqual(
        top.hyperdrive.map((h) => h.binding).sort(),
      );
      expect(config.durable_objects.bindings).toEqual(top.durable_objects.bindings);
      expect(config.exports).toEqual(top.exports);
      expect(config.r2_buckets.map((r2) => r2.binding)).toEqual(
        top.r2_buckets.map((r2) => r2.binding),
      );
      expect(config.vars["ENVIRONMENT"]).not.toBe("local");
    }
  });

  it("the local Worker: enmirumbo-local, ENVIRONMENT local, no public URL and no trigger", () => {
    const config = read();
    expect(config.name).toBe("enmirumbo-local");
    expect(config.vars["ENVIRONMENT"]).toBe("local");
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.triggers.crons ?? []).toEqual([]);
  });
});

describe("Public media live in R2, in one bucket for production and one for dev and stage (v2)", () => {
  // Scenario: per environment
  it("production has a bucket and a hostname of its own; dev and stage share theirs", () => {
    const [dev, stage, prod] = ["dev", "stage", "prod"].map((env) => read(env));
    expect(stage?.r2_buckets).toEqual(dev?.r2_buckets);
    expect(stage?.vars["MEDIA_URL"]).toBe(dev?.vars["MEDIA_URL"]);
    expect(prod?.r2_buckets[0]?.bucket_name).not.toBe(dev?.r2_buckets[0]?.bucket_name);
    expect(prod?.vars["MEDIA_URL"]).not.toBe(dev?.vars["MEDIA_URL"]);
  });

  it("the local Worker binds a bucket of its own, and has no media hostname", () => {
    const config = read();
    expect(config.r2_buckets).toEqual([{ binding: "MEDIA", bucket_name: "enmirumbo-media-local" }]);
    expect(config.vars["MEDIA_URL"]).toBe("");
  });

  // The naming rule of AGENTS.md: one level below the zone, so Universal SSL
  // covers it.
  it.for(ENVIRONMENTS)("the media hostname of $env is one level below urekz.com", ({ media }) => {
    expect(new URL(media.url).hostname).toMatch(/^[a-z0-9-]+\.urekz\.com$/);
  });
});

describe("Scheduled work runs from one hourly Cron Trigger per environment (v2)", () => {
  it.for(ENVIRONMENTS)("one trigger: $env has $crons", ({ env, crons }) => {
    // dev declares an empty list, which removes any trigger left on its Worker.
    expect(read(env).triggers.crons).toEqual(crons);
  });
});
