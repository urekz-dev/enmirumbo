// Scenarios of docs/specs/deployment.md, requirement "Each environment is
// built and deployed by its own workflow (v2)", and of docs/specs/
// data-model.md, "The demo seed leaves cards with a photo to see the
// directory as the resident will see it": the scripts in scripts/deploy/
// that the deploy workflows run. Each script runs in bash with a clean
// environment (never the GitHub Actions variables of the CI run itself) and,
// where it calls the network, with test/scripts/fake-curl.sh as curl.
import { spawnSync } from "node:child_process";
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
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { FAKE_BUSINESSES } from "../../src/core/db/seed/businesses.ts";
import { seedPhotoObjects } from "../../src/core/db/seed/photos.ts";
import { PHOTO_CACHE_CONTROL, PHOTO_CONTENT_TYPE } from "../../src/core/photos/photo.ts";
import { writeSeedMediaDirectory } from "../../scripts/seed-media.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const script = (name: string) => join(ROOT, "scripts/deploy", name);

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "enmirumbo-deploy-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(name: string, args: string[], env: Record<string, string> = {}): Run {
  // A clean environment. `wrangler types` declares the Worker vars as required
  // on ProcessEnv, which a child process does not need, hence Object.assign.
  const childEnv: NodeJS.ProcessEnv = Object.assign(Object.create(null) as NodeJS.ProcessEnv, {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: work,
    ...env,
  });
  const result = spawnSync("bash", [script(name), ...args], {
    cwd: work,
    encoding: "utf8",
    env: childEnv,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// The fake network.

type Answer = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** The responses before this one, which curl follows with --location. */
  redirects?: { status: number; headers?: Record<string, string> }[];
};

interface FakeCall {
  argv: string[];
  method: string;
  url: string;
  data: string;
  headerFiles: string[];
}

function fakeNetwork(routes: Record<string, Answer[]>) {
  const bin = join(work, "bin");
  mkdirSync(bin, { recursive: true });
  copyFileSync(join(ROOT, "test/scripts/fake-curl.sh"), join(bin, "curl"));
  chmodSync(join(bin, "curl"), 0o755);
  const routesFile = join(work, "routes.json");
  const logFile = join(work, "calls.log");
  writeFileSync(routesFile, JSON.stringify(routes));
  writeFileSync(logFile, "");
  return {
    env: {
      PATH: `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
      FAKE_CURL_ROUTES: routesFile,
      FAKE_CURL_LOG: logFile,
    },
    calls: (): FakeCall[] =>
      readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as FakeCall),
  };
}

// ---------------------------------------------------------------------------
// check-ref.sh

const BRANCH = (name: string) => ({
  GITHUB_REF: `refs/heads/${name}`,
  GITHUB_REF_TYPE: "branch",
  GITHUB_REF_NAME: name,
});
const TAG = (name: string) => ({
  GITHUB_REF: `refs/tags/${name}`,
  GITHUB_REF_TYPE: "tag",
  GITHUB_REF_NAME: name,
});

describe("Each environment is built and deployed by its own workflow (v2): the ref", () => {
  it.for([
    ["dev", BRANCH("EMR-15-environments-deploys")],
    ["dev", BRANCH("main")],
    ["stage", BRANCH("main")],
    ["prod", TAG("v0.1.0")],
    ["prod", TAG("v1.20.300")],
  ] as const)("accepted: %s from %j", ([environment, ref]) => {
    expect(run("check-ref.sh", [environment], ref).status).toBe(0);
  });

  it.for([
    ["dev", TAG("v0.1.0")],
    ["stage", BRANCH("EMR-15-environments-deploys")],
    ["stage", TAG("v0.1.0")],
    ["prod", BRANCH("main")],
    ["prod", TAG("v1.2.3-rc1")],
    ["prod", TAG("vfoo.bar.baz")],
    ["prod", TAG("v01.2.3")],
    ["prod", TAG("1.2.3")],
    ["prod", { ...TAG("v1.2.3"), GITHUB_REF: "refs/heads/v1.2.3" }],
  ] as const)("the wrong ref: %s from %j is refused", ([environment, ref]) => {
    const result = run("check-ref.sh", [environment], ref);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^::error::check-ref: /);
  });

  it("refused outside GitHub Actions and for an unknown environment", () => {
    expect(run("check-ref.sh", ["dev"]).status).toBe(1);
    expect(run("check-ref.sh", ["production"], TAG("v1.0.0")).stderr).toContain(
      "must be dev, stage or prod",
    );
  });
});

// ---------------------------------------------------------------------------
// check-build.sh

const WORKERS = { dev: "dev-enmirumbo", stage: "stage-enmirumbo", prod: "enmirumbo" } as const;
type Environment = keyof typeof WORKERS;

// The public media of each environment (ADR 0011): production alone, dev and
// stage together.
const MEDIA = {
  dev: { bucket: "enmirumbo-media-dev", url: "https://media-dev-enmirumbo.urekz.com" },
  stage: { bucket: "enmirumbo-media-dev", url: "https://media-dev-enmirumbo.urekz.com" },
  prod: { bucket: "enmirumbo-media", url: "https://media-enmirumbo.urekz.com" },
} as const;

// The site key of each environment's Turnstile widget (ADR 0012): public, and
// shared by dev and stage.
const SITE_KEYS = {
  dev: "0x4AAAAAAFaqXxFK2fa7EiS4",
  stage: "0x4AAAAAAFaqXxFK2fa7EiS4",
  prod: "0x4AAAAAAFaqP_qD38iv_oZ6",
} as const;

// What `CLOUDFLARE_ENV=<env> vp run build` writes to dist/server/wrangler.json,
// with real-looking Hyperdrive ids.
function build(environment: Environment, overrides: Record<string, unknown> = {}) {
  return {
    name: WORKERS[environment],
    targetEnvironment: environment,
    topLevelName: "enmirumbo-local",
    workers_dev: true,
    preview_urls: false,
    triggers: { crons: environment === "dev" ? [] : ["0 * * * *"] },
    hyperdrive: [
      { binding: "HYPERDRIVE", id: "0123456789abcdef0123456789abcdef" },
      { binding: "HYPERDRIVE_FRESH", id: "fedcba9876543210fedcba9876543210" },
    ],
    vars: {
      ENVIRONMENT: environment,
      ACCESS_TEAM_DOMAIN: "urekz.cloudflareaccess.com",
      ACCESS_AUD: "a1".repeat(32),
      SITE_URL: `https://${WORKERS[environment]}.urekz.workers.dev`,
      MEDIA_URL: MEDIA[environment].url,
      TURNSTILE_SITE_KEY: SITE_KEYS[environment],
    },
    secrets: { required: ["TURNSTILE_SECRET_KEY"] },
    assets: { binding: "ASSETS", directory: "../client" },
    durable_objects: { bindings: [{ name: "QUOTA_COUNTER", class_name: "QuotaCounter" }] },
    exports: { QuotaCounter: { type: "durable-object", storage: "sqlite" } },
    migrations: [],
    r2_buckets: [{ binding: "MEDIA", bucket_name: MEDIA[environment].bucket }],
    ...overrides,
  };
}

// What the build of a deployed environment writes to dist/client/_headers: the
// adapter's cache rule, and the security and noindex rules of
// src/integrations/static-headers.ts.
const CSP =
  "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; " +
  "img-src 'self' https://media-enmirumbo.urekz.com; connect-src 'self'; " +
  "frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'self'";
const SECURITY_RULE = [
  "/*",
  `  Content-Security-Policy: ${CSP}`,
  "  X-Content-Type-Options: nosniff",
  "  X-Frame-Options: DENY",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "",
].join("\n");
const HEADERS_OK = [
  "/_astro/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
  "# The security headers of every response, also on the static assets (docs/specs/deployment.md).",
  SECURITY_RULE,
  "# Deployed environments stay out of search engines until the cut-over (ADR 0008).",
  "/*",
  "  X-Robots-Tag: noindex",
  "",
].join("\n");

/** Writes the build as dist/ holds it (server/wrangler.json, client/_headers) and checks it. */
function checkBuild(
  environment: string,
  config: unknown,
  env: Record<string, string> = {},
  headers: string | null = HEADERS_OK,
) {
  mkdirSync(join(work, "server"), { recursive: true });
  mkdirSync(join(work, "client"), { recursive: true });
  const file = join(work, "server", "wrangler.json");
  writeFileSync(file, JSON.stringify(config));
  if (headers !== null) writeFileSync(join(work, "client", "_headers"), headers);
  return run("check-build.sh", [environment, file], env);
}

const errors = (result: Run) =>
  result.stderr.split("\n").filter((line) => line.startsWith("::error::"));

describe("Each environment is built and deployed by its own workflow (v2): the build", () => {
  it.for(["dev", "stage", "prod"] as const)(
    "a complete build for %s passes and gives the site URL to the workflow",
    (environment) => {
      const output = join(work, "github-output");
      writeFileSync(output, "");
      const result = checkBuild(environment, build(environment), { GITHUB_OUTPUT: output });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(readFileSync(output, "utf8")).toBe(
        `site-url=https://${WORKERS[environment]}.urekz.workers.dev\n`,
      );
    },
  );

  it("a placeholder Hyperdrive id: refused, naming each binding and the environment", () => {
    const result = checkBuild(
      "stage",
      build("stage", {
        hyperdrive: [
          { binding: "HYPERDRIVE", id: "placeholder-enmirumbo-stage" },
          { binding: "HYPERDRIVE_FRESH", id: "00000000000000000000000000000000" },
        ],
      }),
    );
    expect(result.status).toBe(1);
    expect(errors(result)).toEqual([
      expect.stringMatching(
        /HYPERDRIVE still has the placeholder id 'placeholder-enmirumbo-stage'.*env\.stage\.hyperdrive/,
      ),
      expect.stringMatching(/HYPERDRIVE_FRESH still has the placeholder id '0{32}'/),
    ]);
    expect(result.stderr).toContain("nothing was deployed");
  });

  it("the placeholders committed in wrangler.jsonc are refused", () => {
    for (const environment of ["dev", "stage", "prod"] as const) {
      const config = build(environment, {
        hyperdrive: [
          { binding: "HYPERDRIVE", id: `placeholder-enmirumbo-${environment}` },
          { binding: "HYPERDRIVE_FRESH", id: `placeholder-enmirumbo-${environment}-fresh` },
        ],
      });
      expect(checkBuild(environment, config).status).toBe(1);
    }
  });

  it("a missing, duplicated or shared Hyperdrive binding is refused", () => {
    const missing = build("prod", { hyperdrive: [build("prod").hyperdrive[0]] });
    expect(errors(checkBuild("prod", missing))).toEqual([
      expect.stringContaining("expected one HYPERDRIVE_FRESH binding, found 0"),
    ]);
    const shared = build("prod", {
      hyperdrive: [
        { binding: "HYPERDRIVE", id: "0123456789abcdef0123456789abcdef" },
        { binding: "HYPERDRIVE_FRESH", id: "0123456789abcdef0123456789abcdef" },
      ],
    });
    expect(errors(checkBuild("prod", shared))).toEqual([expect.stringContaining("share the id")]);
  });

  it("a build for another environment is refused", () => {
    const result = checkBuild("stage", build("dev"));
    expect(result.status).toBe(1);
    const problems = errors(result).join("\n");
    expect(problems).toContain('the build targets "dev", not "stage"');
    expect(problems).toContain('the Worker name is "dev-enmirumbo", expected "stage-enmirumbo"');
    expect(problems).toContain('ENVIRONMENT is "dev", expected "stage"');
    expect(problems).toContain('the Cron Triggers are [], expected ["0 * * * *"]');
  });

  it("Version URLs on, workers.dev off, a cron on dev or a bad SITE_URL are refused", () => {
    expect(errors(checkBuild("prod", build("prod", { preview_urls: true })))).toEqual([
      expect.stringContaining("preview_urls is true"),
    ]);
    expect(errors(checkBuild("prod", build("prod", { workers_dev: false })))).toEqual([
      expect.stringContaining("workers_dev is false"),
    ]);
    expect(errors(checkBuild("prod", build("prod", { preview_urls: undefined })))).toEqual([
      expect.stringContaining("preview_urls is null"),
    ]);
    expect(errors(checkBuild("dev", build("dev", { triggers: { crons: ["0 * * * *"] } })))).toEqual(
      [expect.stringContaining("the Cron Triggers are")],
    );
    for (const url of [
      "http://enmirumbo.urekz.workers.dev",
      "https://enmirumbo.urekz.workers.dev/",
      "",
    ]) {
      const config = build("prod");
      const result = checkBuild("prod", { ...config, vars: { ...config.vars, SITE_URL: url } });
      expect(errors(result)).toEqual([expect.stringContaining("SITE_URL is")]);
    }
  });

  // deployment, "Anti-abuse counters live in a Durable Object and never in
  // PostgreSQL (v2)": without the counter the quotas would not count.
  it("a build without the quota counter, or with a counter that is not declared, is refused", () => {
    expect(errors(checkBuild("stage", build("stage", { durable_objects: undefined })))).toEqual([
      expect.stringMatching(
        /expected QUOTA_COUNTER bound to the QuotaCounter Durable Object.*env\.stage\.durable_objects/,
      ),
    ]);
    expect(
      errors(
        checkBuild(
          "prod",
          build("prod", {
            durable_objects: { bindings: [{ name: "QUOTA_COUNTER", class_name: "Other" }] },
          }),
        ),
      ),
    ).toEqual([expect.stringContaining("expected QUOTA_COUNTER bound to the QuotaCounter")]);
    expect(errors(checkBuild("dev", build("dev", { exports: {} })))).toEqual([
      expect.stringMatching(/exports\.QuotaCounter is null.*env\.dev\.exports/),
    ]);
  });

  // deployment, "Public media live in R2, in one bucket for production and
  // one for dev and stage (v2)": a build never reaches another bucket.
  it("a build without its media bucket, or with another one, is refused", () => {
    expect(errors(checkBuild("prod", build("prod", { r2_buckets: undefined })))).toEqual([
      expect.stringMatching(
        /expected MEDIA bound to the R2 bucket enmirumbo-media, found \[\].*env\.prod\.r2_buckets/,
      ),
    ]);
    // dev never reaches the bucket of production.
    expect(
      errors(
        checkBuild(
          "dev",
          build("dev", { r2_buckets: [{ binding: "MEDIA", bucket_name: "enmirumbo-media" }] }),
        ),
      ),
    ).toEqual([
      expect.stringContaining("expected MEDIA bound to the R2 bucket enmirumbo-media-dev"),
    ]);
    // stage shares the bucket of dev.
    expect(checkBuild("stage", build("stage")).status).toBe(0);
  });

  it("a MEDIA_URL that is not an https origin is refused", () => {
    for (const url of [
      "",
      "http://media-enmirumbo.urekz.com",
      "https://media-enmirumbo.urekz.com/",
    ]) {
      const config = build("prod");
      const result = checkBuild("prod", { ...config, vars: { ...config.vars, MEDIA_URL: url } });
      expect(errors(result), url).toEqual([expect.stringContaining("MEDIA_URL is")]);
    }
  });

  // business-registration, "Turnstile is checked on the server, fails closed
  // and has a switch in the database (v2)"
  it.for([
    [
      "a test site key",
      "1x00000000000000000000AA",
      "is Cloudflare's test key '1x00000000000000000000AA'",
    ],
    ["another test site key", "3x00000000000000000000FF", "is Cloudflare's test key"],
    [
      "a placeholder",
      "REPLACE_WITH_SITE_KEY",
      "is 'REPLACE_WITH_SITE_KEY', not a Turnstile site key",
    ],
    ["no site key", "", "is '', not a Turnstile site key"],
  ] as const)("a build whose Turnstile site key is %s is refused", ([, key, message]) => {
    const config = build("prod");
    const result = checkBuild("prod", {
      ...config,
      vars: { ...config.vars, TURNSTILE_SITE_KEY: key },
    });
    expect(result.status).toBe(1);
    expect(errors(result)).toEqual([expect.stringContaining(`TURNSTILE_SITE_KEY ${message}`)]);
    expect(errors(result)[0]).toContain("in env.prod.vars of wrangler.jsonc");
  });

  it("a build that does not require the Turnstile secret is refused", () => {
    for (const secrets of [undefined, { required: [] }, { required: ["OTHER_SECRET"] }]) {
      const result = checkBuild("stage", build("stage", { secrets }));
      expect(result.status, JSON.stringify(secrets)).toBe(1);
      expect(errors(result)).toEqual([
        expect.stringContaining(
          "secrets.required does not name TURNSTILE_SECRET_KEY; declare it in env.stage.secrets",
        ),
      ]);
    }
  });

  it("an empty ACCESS_AUD is only a warning: the panel stays closed", () => {
    const config = build("prod");
    const result = checkBuild("prod", { ...config, vars: { ...config.vars, ACCESS_AUD: "" } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::check-build (prod): ACCESS_AUD is empty");
  });

  // base-layout, "Deployed environments stay out of search engines until the
  // cut-over (v2)": the static assets skip the Worker that adds the header.
  it.for([
    [
      "only the adapter's cache rule and the security rule",
      HEADERS_OK.split("\n# Deployed")[0] ?? "",
    ],
    [
      "the rule for another path",
      `${SECURITY_RULE}\n/aviso-de-privacidad\n  X-Robots-Tag: noindex\n`,
    ],
    ["a rule that does not ask for noindex", `${SECURITY_RULE}\n/*\n  X-Robots-Tag: nofollow\n`],
  ] as const)("a build whose static assets would be indexable is refused: %s", ([, headers]) => {
    const result = checkBuild("prod", build("prod"), {}, headers);
    expect(result.status).toBe(1);
    expect(errors(result)).toEqual([
      expect.stringMatching(
        /client\/_headers does not give every static asset X-Robots-Tag: noindex/,
      ),
    ]);
  });

  // deployment, "Every response carries the security headers and the content
  // security policy (v2)", scenario "a build whose static assets lack them"
  it("a build without a _headers file is refused for both reasons", () => {
    const result = checkBuild("prod", build("prod"), {}, null);
    expect(result.status).toBe(1);
    expect(errors(result)).toEqual([
      expect.stringContaining("does not give every static asset X-Robots-Tag: noindex"),
      expect.stringContaining("does not give every static asset its security headers"),
    ]);
  });

  it.for([
    [
      "no security rule",
      "Content-Security-Policy,Content-Security-Policy with frame-ancestors 'none',Content-Security-Policy with object-src 'none',Content-Security-Policy with form-action 'self',X-Content-Type-Options: nosniff,X-Frame-Options: DENY,Referrer-Policy: strict-origin…",
      HEADERS_OK.replace(SECURITY_RULE, ""),
    ],
    [
      "a policy that lets other sites frame the pages",
      "Content-Security-Policy with frame-ancestors 'none'",
      HEADERS_OK.replace("frame-ancestors 'none'", "frame-ancestors *"),
    ],
    [
      "no nosniff",
      "X-Content-Type-Options: nosniff",
      HEADERS_OK.replace("  X-Content-Type-Options: nosniff\n", ""),
    ],
    [
      "framing allowed",
      "X-Frame-Options: DENY",
      HEADERS_OK.replace("X-Frame-Options: DENY", "X-Frame-Options: SAMEORIGIN"),
    ],
    [
      "a referrer policy that sends paths",
      "Referrer-Policy: strict-origin…",
      HEADERS_OK.replace("strict-origin-when-cross-origin", "unsafe-url"),
    ],
    [
      "the headers only for one page",
      "X-Content-Type-Options: nosniff,X-Frame-Options: DENY,Referrer-Policy: strict-origin…",
      HEADERS_OK.replace(
        "  X-Content-Type-Options: nosniff\n",
        "\n/terminos\n  X-Content-Type-Options: nosniff\n",
      ),
    ],
  ] as const)(
    "a build whose static assets lack a security header is refused: %s",
    ([, missing, headers]) => {
      const result = checkBuild("prod", build("prod"), {}, headers);
      expect(result.status).toBe(1);
      expect(errors(result)).toEqual([
        expect.stringContaining(
          `does not give every static asset its security headers; missing: ${missing} (`,
        ),
      ]);
    },
  );

  it("a build without a static assets directory is refused", () => {
    const result = checkBuild("prod", build("prod", { assets: undefined }));
    expect(errors(result)).toEqual([expect.stringContaining("no static assets directory")]);
  });

  it("no build: refused with how to build", () => {
    const result = run("check-build.sh", ["dev", join(work, "missing.json")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CLOUDFLARE_ENV=dev vp run build");
  });
});

// ---------------------------------------------------------------------------
// deploy-worker.sh

/**
 * Deploys a build with a fake Wrangler, which records its arguments, the
 * secrets file it was given (its mode and content, while it exists) and the
 * secrets left in its environment.
 */
function deployWorker(
  environment: string,
  config: unknown,
  env: Record<string, string> = {},
  args: string[] = [],
) {
  mkdirSync(join(work, "server"), { recursive: true });
  writeFileSync(join(work, "server", "wrangler.json"), JSON.stringify(config));
  const temp = join(work, "runner-temp");
  mkdirSync(temp, { recursive: true });
  const log = join(work, "wrangler.log");
  const fake = join(work, "fake-wrangler");
  writeFileSync(
    fake,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `log=${JSON.stringify(log)}`,
      'printf "args:%s\\n" "$*" >>"$log"',
      'printf "env:%s\\n" "${TURNSTILE_SECRET_KEY:-}" >>"$log"',
      "while [ $# -gt 0 ]; do",
      '  if [ "$1" = "--secrets-file" ]; then',
      '    printf "mode:%s\\n" "$(stat -c %a "$2" 2>/dev/null || stat -f %Lp "$2")" >>"$log"',
      '    printf "file:%s\\n" "$(cat "$2")" >>"$log"',
      "  fi",
      "  shift",
      "done",
      'exit "${FAKE_WRANGLER_STATUS:-0}"',
      "",
    ].join("\n"),
  );
  chmodSync(fake, 0o755);
  const result = run("deploy-worker.sh", [environment, ...args], {
    BUILD_CONFIG: join(work, "server", "wrangler.json"),
    WRANGLER: fake,
    RUNNER_TEMP: temp,
    ...env,
  });
  let lines: string[] = [];
  try {
    lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {
    // Wrangler never ran.
  }
  const left = readdirSync(temp);
  return { ...result, lines, left };
}

const TURNSTILE_SECRET = "0x4AAAAAAAfictitious-turnstile-secret";

describe("Each environment is built and deployed by its own workflow (v2): the Worker secrets", () => {
  it.for(["dev", "stage", "prod"] as const)(
    "%s deploys with its secrets in a file only its owner reads, removed afterwards, and never in the arguments",
    (environment) => {
      const result = deployWorker(environment, build(environment), {
        TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const [args = "", env = "", mode = "", file = ""] = result.lines;
      expect(args).toMatch(/^args:deploy --secrets-file \S+\/runner-temp\/worker-secrets\.\w+$/);
      expect(args).not.toContain(TURNSTILE_SECRET);
      // Wrangler reads the secret from the file, not from its environment.
      expect(env).toBe("env:");
      expect(mode).toBe("mode:600");
      expect(JSON.parse(file.replace(/^file:/, ""))).toEqual({
        TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
      });
      expect(result.left).toEqual([]);
      expect(result.stdout + result.stderr).not.toContain(TURNSTILE_SECRET);
    },
  );

  it("dev passes its own arguments on to Wrangler", () => {
    const result = deployWorker("dev", build("dev"), { TURNSTILE_SECRET_KEY: TURNSTILE_SECRET }, [
      "--var",
      "DEPLOY_BRANCH:EMR-42-turnstile",
      "--var",
      "DEPLOY_COMMIT:abc1234",
    ]);
    expect(result.status).toBe(0);
    expect(result.lines[0]).toMatch(
      /--secrets-file \S+ --var DEPLOY_BRANCH:EMR-42-turnstile --var DEPLOY_COMMIT:abc1234$/,
    );
  });

  it("a failed deploy fails the step and still removes the file", () => {
    const result = deployWorker("stage", build("stage"), {
      TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
      FAKE_WRANGLER_STATUS: "1",
    });
    expect(result.status).toBe(1);
    expect(result.left).toEqual([]);
  });

  it("a missing or empty secret, or a build of another environment, deploys nothing", () => {
    for (const env of [{}, { TURNSTILE_SECRET_KEY: "" }]) {
      const result = deployWorker("prod", build("prod"), env);
      expect(result.status).toBe(1);
      expect(result.lines).toEqual([]);
      expect(errors(result)).toEqual([
        expect.stringContaining(
          "missing Worker secret(s) TURNSTILE_SECRET_KEY: add each to the GitHub Environment prod",
        ),
      ]);
    }
    const other = deployWorker("prod", build("stage"), { TURNSTILE_SECRET_KEY: TURNSTILE_SECRET });
    expect(other.status).toBe(1);
    expect(other.lines).toEqual([]);
    expect(errors(other)).toEqual([
      expect.stringContaining("the build targets 'stage', not 'prod'"),
    ]);
  });

  it("a build without secrets deploys without a secrets file", () => {
    const result = deployWorker("stage", build("stage", { secrets: undefined }));
    expect(result.status).toBe(0);
    expect(result.lines[0]).toBe("args:deploy");
  });
});

// ---------------------------------------------------------------------------
// reset-neon-dev.sh

const API = "https://console.neon.tech/api/v2/projects/proj-test-123";
const NEON = { NEON_API_KEY: "napi_test_key_not_real", NEON_PROJECT_ID: "proj-test-123" };
const BRANCHES = [
  { id: "br-prod-1", name: "prod", default: true },
  { id: "br-stage-2", name: "stage", parent_id: "br-prod-1", default: false },
  { id: "br-dev-3", name: "dev", parent_id: "br-stage-2", default: false },
];

function neonRoutes(branches: unknown[], extra: Record<string, Answer[]> = {}) {
  return {
    [`GET ${API}/branches`]: [{ status: 200, body: { branches } }],
    [`POST ${API}/branches/br-dev-3/restore`]: [
      {
        status: 200,
        body: { branch: { id: "br-dev-3" }, operations: [{ id: "op-1" }, { id: "op-2" }] },
      },
    ],
    [`GET ${API}/operations/op-1`]: [
      { status: 200, body: { operation: { status: "running" } } },
      { status: 200, body: { operation: { status: "finished" } } },
    ],
    [`GET ${API}/operations/op-2`]: [{ status: 200, body: { operation: { status: "finished" } } }],
    ...extra,
  };
}

function resetDev(routes: Record<string, Answer[]>, env: Record<string, string> = NEON) {
  const network = fakeNetwork(routes);
  const result = run("reset-neon-dev.sh", [], {
    ...network.env,
    NEON_POLL_INTERVAL: "0",
    ...env,
  });
  return { ...result, calls: network.calls() };
}

const writes = (calls: FakeCall[]) => calls.filter((call) => call.method !== "GET");

describe("Each environment is built and deployed by its own workflow (v2): resetting dev", () => {
  it("resets the branch named dev from stage and waits for Neon", () => {
    const result = resetDev(neonRoutes(BRANCHES));

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(writes(result.calls)).toEqual([
      expect.objectContaining({
        url: `${API}/branches/br-dev-3/restore`,
        data: '{"source_branch_id":"br-stage-2"}',
      }),
    ]);
    // Polled op-1 until it finished, then op-2.
    expect(result.calls.map((call) => `${call.method} ${call.url.replace(API, "")}`)).toEqual([
      "GET /branches",
      "POST /branches/br-dev-3/restore",
      "GET /operations/op-1",
      "GET /operations/op-1",
      "GET /operations/op-2",
    ]);
  });

  it("the API key travels in a header file, never in the arguments", () => {
    const result = resetDev(neonRoutes(BRANCHES));
    for (const call of result.calls) {
      expect(call.headerFiles).toEqual([`Authorization: Bearer ${NEON.NEON_API_KEY}`]);
      expect(call.argv.join(" ")).not.toContain(NEON.NEON_API_KEY);
    }
    expect(result.stdout + result.stderr).not.toContain(NEON.NEON_API_KEY);
  });

  it.for([
    [
      "dev's parent is not stage",
      BRANCHES.map((b) => (b.name === "dev" ? { ...b, parent_id: "br-prod-1" } : b)),
      "parent of 'dev' is not 'stage'",
    ],
    [
      "dev is the default branch",
      BRANCHES.map((b) => (b.name === "dev" ? { ...b, default: true } : b)),
      "default branch",
    ],
    [
      "dev has a child",
      [...BRANCHES, { id: "br-x-4", name: "x", parent_id: "br-dev-3" }],
      "child branch",
    ],
    [
      "two branches named dev",
      [...BRANCHES, { id: "br-dev-5", name: "dev", parent_id: "br-stage-2" }],
      "exactly one branch named 'dev'",
    ],
    [
      "no branch named dev",
      BRANCHES.filter((b) => b.name !== "dev"),
      "exactly one branch named 'dev'",
    ],
    [
      "no branch named stage",
      BRANCHES.filter((b) => b.name !== "stage"),
      "exactly one branch named 'stage'",
    ],
  ] as const)("refused without writing: %s", ([, branches, message]) => {
    const result = resetDev(neonRoutes([...branches]));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(writes(result.calls)).toEqual([]);
  });

  it("Neon refuses the reset: the run fails with Neon's message", () => {
    const result = resetDev(
      neonRoutes(BRANCHES, {
        [`POST ${API}/branches/br-dev-3/restore`]: [
          { status: 423, body: { message: "project already has running operations" } },
        ],
      }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Neon refused the reset: project already has running operations",
    );
  });

  it("an operation that fails or never finishes fails the run", () => {
    const failed = resetDev(
      neonRoutes(BRANCHES, {
        [`GET ${API}/operations/op-1`]: [
          { status: 200, body: { operation: { status: "failed" } } },
        ],
      }),
    );
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("operation op-1 failed");

    const stuck = resetDev(
      neonRoutes(BRANCHES, {
        [`GET ${API}/operations/op-1`]: [
          { status: 200, body: { operation: { status: "running" } } },
        ],
      }),
      { ...NEON, NEON_RESET_TIMEOUT: "0" },
    );
    expect(stuck.status).toBe(1);
    expect(stuck.stderr).toContain("still running after 0 seconds");
  });

  it("refused without credentials, before any call", () => {
    for (const env of [
      { NEON_PROJECT_ID: "proj-test-123" },
      { NEON_API_KEY: "k" },
      { ...NEON, NEON_PROJECT_ID: "../evil" },
    ]) {
      const result = resetDev(neonRoutes(BRANCHES), env);
      expect(result.status).toBe(1);
      expect(result.calls).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// smoke-test.sh

const ORIGIN = "https://enmirumbo.urekz.workers.dev";
const SECURITY_HEADERS = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};
const HOME_OK: Answer = {
  status: 200,
  headers: { "content-type": "text/html", "x-robots-tag": "noindex", ...SECURITY_HEADERS },
  body: "<!doctype html>",
};
const ROBOTS_OK: Answer = { status: 200, body: "User-agent: *\nDisallow: /" };
// The privacy notice, which Cloudflare serves without the Worker.
const STATIC_OK: Answer = HOME_OK;
const STATIC_PAGE = `GET ${ORIGIN}/aviso-de-privacidad`;

function smoke(routes: Record<string, Answer[]>) {
  const network = fakeNetwork({ [STATIC_PAGE]: [STATIC_OK], ...routes });
  return run("smoke-test.sh", [ORIGIN], { ...network.env, SMOKE_ATTEMPTS: "3", SMOKE_DELAY: "0" });
}

describe("Each environment is built and deployed by its own workflow (v2): the smoke test", () => {
  it("passes when the home answers 200 with noindex and robots.txt is closed", () => {
    const result = smoke({
      [`GET ${ORIGIN}/`]: [HOME_OK],
      [`GET ${ORIGIN}/robots.txt`]: [ROBOTS_OK],
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("follows the redirect of the root to the home of the only active locality, within https", () => {
    const redirect = {
      status: 301,
      headers: { location: "/hidalgo/tizayuca", "x-robots-tag": "noindex" },
    };
    const network = fakeNetwork({
      [`GET ${ORIGIN}/`]: [{ ...HOME_OK, redirects: [redirect] }],
      [STATIC_PAGE]: [STATIC_OK],
      [`GET ${ORIGIN}/robots.txt`]: [ROBOTS_OK],
    });
    const result = run("smoke-test.sh", [ORIGIN], { ...network.env, SMOKE_ATTEMPTS: "1" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const [home, legal, robots] = network.calls();
    expect(home?.argv).toEqual(
      expect.arrayContaining(["--location", "--max-redirs", "5", "--proto-redir", "=https"]),
    );
    expect(legal?.url).toBe(`${ORIGIN}/aviso-de-privacidad`);
    expect(legal?.argv).not.toContain("--location");
    expect(robots?.argv).not.toContain("--location");
  });

  it("the noindex header counts only on the page the redirects end at", () => {
    const redirect = { status: 301, headers: { "x-robots-tag": "noindex" } };
    const result = smoke({
      [`GET ${ORIGIN}/`]: [{ ...HOME_OK, headers: {}, redirects: [redirect] }],
      [`GET ${ORIGIN}/robots.txt`]: [ROBOTS_OK],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no X-Robots-Tag: noindex");
  });

  it("retries while the new version is not answering yet", () => {
    const result = smoke({
      [`GET ${ORIGIN}/`]: [{ status: 0 }, { status: 404, body: "" }, HOME_OK],
      [`GET ${ORIGIN}/robots.txt`]: [ROBOTS_OK],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("retrying");
  });

  // base-layout, "Deployed environments stay out of search engines until the
  // cut-over (v2)", scenario "a prerendered page of a deployed environment"
  it.for([
    [
      { ...STATIC_OK, headers: { "content-type": "text/html", ...SECURITY_HEADERS } },
      "/aviso-de-privacidad has no X-Robots-Tag: noindex",
    ],
    [{ ...STATIC_OK, status: 404 }, "GET /aviso-de-privacidad answered 404"],
  ] as const)("fails when the prerendered privacy notice fails: %#", ([legal, message]) => {
    const result = smoke({
      [`GET ${ORIGIN}/`]: [HOME_OK],
      [STATIC_PAGE]: [legal],
      [`GET ${ORIGIN}/robots.txt`]: [ROBOTS_OK],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it.for([
    ["the home does not answer 200", { ...HOME_OK, status: 500 }, ROBOTS_OK, "answered 500"],
    [
      "the home has no noindex header",
      { ...HOME_OK, headers: SECURITY_HEADERS },
      ROBOTS_OK,
      "no X-Robots-Tag: noindex",
    ],
    [
      "robots.txt is open",
      HOME_OK,
      { status: 200, body: "User-agent: *\nDisallow: /admin" },
      "does not close the site",
    ],
  ] as const)("fails when %s", ([, home, robots, message]) => {
    const result = smoke({ [`GET ${ORIGIN}/`]: [home], [`GET ${ORIGIN}/robots.txt`]: [robots] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain("after 3 attempts");
  });

  // deployment, "Every response carries the security headers and the content
  // security policy (v2)", scenario "the smoke test"
  it.for([
    ["the policy", "content-security-policy", "Content-Security-Policy"],
    ["nosniff", "x-content-type-options", "X-Content-Type-Options: nosniff"],
    ["the framing header", "x-frame-options", "X-Frame-Options: DENY"],
    ["the referrer policy", "referrer-policy", "Referrer-Policy"],
  ] as const)("fails when the home or the privacy notice lacks %s", ([, header, name]) => {
    const headers = Object.entries(HOME_OK.headers ?? {}).filter(([name]) => name !== header);
    const lacking = { ...HOME_OK, headers: Object.fromEntries(headers) };
    for (const routes of [
      { [`GET ${ORIGIN}/`]: [lacking], [`GET ${ORIGIN}/robots.txt`]: [ROBOTS_OK] },
      {
        [`GET ${ORIGIN}/`]: [HOME_OK],
        [STATIC_PAGE]: [lacking],
        [`GET ${ORIGIN}/robots.txt`]: [ROBOTS_OK],
      },
    ]) {
      const result = smoke(routes);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`lacks security headers: ${name}`);
    }
  });

  it("the security headers count only on the page the redirects end at", () => {
    const redirect = {
      status: 301,
      headers: { location: "/hidalgo/tizayuca", ...SECURITY_HEADERS },
    };
    const result = smoke({
      [`GET ${ORIGIN}/`]: [
        { ...HOME_OK, headers: { "x-robots-tag": "noindex" }, redirects: [redirect] },
      ],
      [`GET ${ORIGIN}/robots.txt`]: [ROBOTS_OK],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GET / lacks security headers: Content-Security-Policy,");
  });

  it("refuses anything but an https origin", () => {
    for (const origin of [
      "http://enmirumbo.urekz.workers.dev",
      `${ORIGIN}/`,
      "enmirumbo.urekz.workers.dev",
    ]) {
      expect(run("smoke-test.sh", [origin]).status).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// upload-seed-media.sh: data-model, "The demo seed leaves cards with a photo
// to see the directory as the resident will see it", on the deploys to dev
// and stage, with test/scripts/fake-backup-tools.sh as aws.

const ACCOUNT = "f".repeat(32);
const R2_SECRET = "fictional-r2-secret-access-key";
const R2_ENV = {
  MEDIA_R2_ACCESS_KEY_ID: "fictional-r2-access-key-id",
  MEDIA_R2_SECRET_ACCESS_KEY: R2_SECRET,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
};

interface ToolCall {
  tool: string;
  argv: string[];
  env: Record<string, string>;
}

/** The build of `environment` in dist/server/wrangler.json, and the seed's photos in a directory. */
async function seededMedia(environment: Environment, config = build(environment)) {
  mkdirSync(join(work, "server"), { recursive: true });
  const configFile = join(work, "server", "wrangler.json");
  writeFileSync(configFile, JSON.stringify(config));
  const directory = join(work, "seed-media");
  const objects = seedPhotoObjects(
    FAKE_BUSINESSES.flatMap(({ name, photoKey }, shade) =>
      photoKey === undefined ? [] : [{ name, photoKey, shade }],
    ),
  );
  await writeSeedMediaDirectory(directory, objects);
  const bin = join(work, "bin");
  mkdirSync(bin, { recursive: true });
  copyFileSync(join(ROOT, "test/scripts/fake-backup-tools.sh"), join(bin, "aws"));
  chmodSync(join(bin, "aws"), 0o755);
  const store = join(work, "bucket");
  const log = join(work, "tools.log");
  mkdirSync(store, { recursive: true });
  writeFileSync(log, "");
  return {
    objects,
    args: [environment, directory, configFile],
    env: {
      PATH: `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
      FAKE_TOOLS_LOG: log,
      FAKE_STORE: store,
    },
    calls: (): ToolCall[] =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as ToolCall),
    stored: (key: string) => readFileSync(join(store, key)),
  };
}

function argAfter(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

describe("The demo seed leaves cards with a photo to see the directory as the resident will see it: the upload", () => {
  it.for(["dev", "stage"] as const)(
    "uploads every photo of the seed to the media bucket of %s, with its type and caching",
    async (environment) => {
      const media = await seededMedia(environment);

      const result = run("upload-seed-media.sh", media.args, { ...media.env, ...R2_ENV });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(media.objects.length).toBeGreaterThan(0);
      const puts = media.calls().filter((call) => call.argv[1] === "put-object");
      expect(puts.map((call) => argAfter(call.argv, "--key"))).toEqual(
        media.objects.map(({ key }) => key),
      );
      for (const put of puts) {
        expect(argAfter(put.argv, "--bucket")).toBe("enmirumbo-media-dev");
        expect(argAfter(put.argv, "--endpoint-url")).toBe(
          `https://${ACCOUNT}.r2.cloudflarestorage.com`,
        );
        expect(argAfter(put.argv, "--content-type")).toBe(PHOTO_CONTENT_TYPE);
        expect(argAfter(put.argv, "--cache-control")).toBe(PHOTO_CACHE_CONTROL);
        expect(put.env).toMatchObject({
          AWS_ACCESS_KEY_ID: "fictional-r2-access-key-id",
          AWS_SECRET_ACCESS_KEY: R2_SECRET,
          AWS_DEFAULT_REGION: "auto",
        });
        expect(put.argv.join(" ")).not.toContain(R2_SECRET);
      }
      for (const { key, body } of media.objects) {
        expect(new Uint8Array(media.stored(key))).toEqual(body);
      }
      expect(result.stdout).toContain(`${media.objects.length} objects`);
    },
  );

  it("running it again writes the same objects at the same keys", async () => {
    const media = await seededMedia("stage");
    run("upload-seed-media.sh", media.args, { ...media.env, ...R2_ENV });
    const first = media.objects.map(({ key }) => media.stored(key));

    const again = run("upload-seed-media.sh", media.args, { ...media.env, ...R2_ENV });

    expect(again.status).toBe(0);
    expect(media.objects.map(({ key }) => media.stored(key))).toEqual(first);
  });

  it("never production", async () => {
    const media = await seededMedia("prod");

    const result = run("upload-seed-media.sh", media.args, { ...media.env, ...R2_ENV });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dev or stage only");
    expect(media.calls()).toEqual([]);
  });

  it("refused without the R2 token, or for a build of another environment or without the bucket", async () => {
    const media = await seededMedia("dev");
    const missing = run("upload-seed-media.sh", media.args, {
      ...media.env,
      ...R2_ENV,
      MEDIA_R2_SECRET_ACCESS_KEY: "",
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("MEDIA_R2_SECRET_ACCESS_KEY is not set");

    const other = run("upload-seed-media.sh", ["stage", ...media.args.slice(1)], {
      ...media.env,
      ...R2_ENV,
    });
    expect(other.status).toBe(1);
    expect(other.stderr).toContain("is not a build for stage");

    const unbound = await seededMedia("dev", build("dev", { r2_buckets: [] }));
    const result = run("upload-seed-media.sh", unbound.args, { ...unbound.env, ...R2_ENV });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("binds no MEDIA bucket");
    expect([...media.calls(), ...unbound.calls()]).toEqual([]);
  });

  it("an upload R2 refuses fails the run", async () => {
    const media = await seededMedia("dev");

    const result = run("upload-seed-media.sh", media.args, {
      ...media.env,
      ...R2_ENV,
      FAKE_AWS_PUT_FAIL: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the upload of photos/");
  });
});
