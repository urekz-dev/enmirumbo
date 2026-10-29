// Vite+ configuration: tests, lint, format, staged files and tasks.
// Astro has its own configuration in astro.config.mjs and ignores this file,
// so `vp dev`, `vp build` and `vp preview` do not run Astro: use the
// `vp run dev`, `vp run build` and `vp run preview` tasks below.
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
import { LOCAL_TEST_DATABASE_URL } from "./src/core/db/url.ts";
import { TURNSTILE_TEST_SECRET_KEYS } from "./src/core/turnstile/keys.ts";

// Tests use their own database, never the development one. The Hyperdrive
// bindings of the workers project and the global setup (test/global-setup.ts)
// must reach the same database: DATABASE_URL, or enmirumbo_test locally.
const testDatabaseUrl = process.env["DATABASE_URL"] ?? LOCAL_TEST_DATABASE_URL;
for (const binding of ["HYPERDRIVE", "HYPERDRIVE_FRESH"]) {
  process.env[`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${binding}`] = testDatabaseUrl;
}
// The Worker secret of Turnstile is Cloudflare's always-pass test secret,
// which the local Worker emulates without network (src/core/turnstile/).
// Wrangler reads it from the environment when there is no .dev.vars.
process.env["TURNSTILE_SECRET_KEY"] ??= TURNSTILE_TEST_SECRET_KEYS.alwaysPasses;
// The secrets of the purge of the media hostname's cache are empty: the local
// Worker has no such cache and purges nothing (src/lib/media-bucket.ts).
process.env["MEDIA_ZONE_ID"] ??= "";
process.env["MEDIA_CACHE_PURGE_TOKEN"] ??= "";
// Daily email is a counts-only local preview without an API key.
process.env["RESEND_API_KEY"] ??= "";

const generated = ["dist/**", ".astro/**", "worker-configuration.d.ts"];

export default defineConfig({
  test: {
    projects: [
      // Astro components rendered with the Container API, in Node.
      "./test/astro/vitest.config.ts",
      {
        // Plain Node tests for the scripts (migration guard, ...).
        test: {
          name: "scripts",
          environment: "node",
          include: ["test/scripts/**/*.test.ts"],
        },
      },
      {
        // Runs inside workerd with the bindings from wrangler.jsonc.
        plugins: [
          cloudflareTest({
            main: "./test/worker/entry.ts",
            wrangler: { configPath: "./wrangler.jsonc" },
          }),
        ],
        resolve: {
          alias: {
            // `astro:actions` is a virtual module that only Astro's build
            // resolves. Its ActionError class lives in this file, which needs
            // no other virtual module, so tests get the real class.
            "astro:actions": fileURLToPath(
              new URL("./node_modules/astro/dist/actions/runtime/client.js", import.meta.url),
            ),
          },
        },
        test: {
          name: "workers",
          // pg is CommonJS and its require() calls cannot be loaded one by one
          // inside workerd, so Vite bundles it ahead of time. Node built-ins and
          // cloudflare:* stay external and come from workerd (nodejs_compat).
          deps: {
            optimizer: {
              ssr: {
                enabled: true,
                include: ["pg"],
                rolldownOptions: {
                  platform: "node",
                  external: [/^cloudflare:/, /^node:/, ...builtinModules],
                },
              },
            },
          },
          include: ["test/worker/**/*.test.ts"],
          // Applies the migrations (Node side) before the tests run in workerd.
          globalSetup: ["./test/global-setup.ts"],
        },
      },
    ],
  },
  lint: {
    ignorePatterns: generated,
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // ADR 0019: business rules and data access never depend on Astro.
        files: ["src/core/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [{ name: "astro", message: "src/core must not import Astro." }],
              patterns: [{ group: ["astro:*"], message: "src/core must not import Astro." }],
            },
          ],
        },
      },
    ],
  },
  fmt: {
    // Prettier formats .astro files (prettier.config.mjs). Drizzle Kit owns drizzle/.
    ignorePatterns: [...generated, "**/*.astro", "pnpm-lock.yaml", "drizzle/**"],
  },
  staged: {
    "!(*.astro)": "vp check --fix --no-error-on-unmatched-pattern",
    "*.astro": ["vp lint --fix", "prettier --write"],
  },
  run: {
    tasks: {
      dev: { command: "astro dev", cache: false },
      build: { command: "astro build", cache: false },
      preview: { command: "astro preview", cache: false },
      // Regenerates worker-configuration.d.ts after a change to wrangler.jsonc.
      types: { command: "wrangler types", cache: false },
      // `vp check` cannot run astro check or Prettier, so this task adds them.
      "check:all": {
        command: [
          "vp check",
          'prettier --check "**/*.astro"',
          "astro check",
          "wrangler types --check",
          "node scripts/check-migrations.ts",
        ],
        cache: false,
      },
      "fmt:astro": { command: 'prettier --write "**/*.astro"', cache: false },
      // Database (ADR 0005). Local PostgreSQL 18 in Docker; see README.
      "db:up": { command: "docker compose up -d --wait", cache: false },
      "db:down": { command: "docker compose down", cache: false },
      "db:generate": { command: "drizzle-kit generate", cache: false },
      "db:migrate": { command: "drizzle-kit migrate", cache: false },
      "db:seed": { command: "node scripts/db-seed.ts", cache: false },
      // Recomputes the normalized search columns of every business (idempotent).
      // Fails on destructive statements without a `-- destructive-ok: <reason>` marker.
      "db:check": { command: "node scripts/check-migrations.ts", cache: false },
      // End-to-end tests against `astro preview` (workerd); builds first.
      e2e: { command: "playwright test", dependsOn: ["build"], cache: false },
    },
  },
});
