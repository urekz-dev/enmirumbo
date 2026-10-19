// End-to-end tests against the built site served by `astro preview`, which
// runs in workerd. Run them with `vp run e2e`, which builds first.
import { defineConfig, devices } from "@playwright/test";
import { LOCAL_DATABASE_URL } from "./src/core/db/url.ts";
import { TURNSTILE_TEST_SECRET_KEYS } from "./src/core/turnstile/keys.ts";

// E2E_PORT lets parallel worktrees run their end-to-end tests at once: outside
// CI, Playwright reuses a server already listening on its port, which would be
// another worktree's.
const port = Number(process.env["E2E_PORT"] ?? 4321);

// The preview reaches the database through the Hyperdrive bindings, and the
// global setup (test/e2e/global-setup.ts) migrates and seeds it: both use
// DATABASE_URL, or the local development database when it is unset.
const databaseUrl = process.env["DATABASE_URL"] ?? LOCAL_DATABASE_URL;
for (const binding of ["HYPERDRIVE", "HYPERDRIVE_FRESH"]) {
  process.env[`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${binding}`] = databaseUrl;
}
// The preview's Turnstile secret is Cloudflare's always-pass test secret,
// which the local Worker emulates without network; the browser side is a
// local fake of Turnstile's script (test/e2e/turnstile.ts). Wrangler reads it
// from the environment when there is no .dev.vars.
process.env["TURNSTILE_SECRET_KEY"] ??= TURNSTILE_TEST_SECRET_KEYS.alwaysPasses;

const PHONE = { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } };

export default defineConfig({
  testDir: "./test/e2e",
  globalSetup: "./test/e2e/global-setup.ts",
  forbidOnly: Boolean(process.env["CI"]),
  use: {
    baseURL: `http://localhost:${port}`,
  },
  projects: [
    {
      // The site is designed for a 390 px wide phone. The seed leaves one
      // active locality, Tizayuca.
      name: "phone",
      use: PHONE,
      testIgnore: [
        "two-localities/**",
        "many-cards/**",
        "search-pages/**",
        "registration.spec.ts",
        "edit.spec.ts",
        "admin.spec.ts",
        "admin-zones.spec.ts",
        "turnstile-real.spec.ts",
      ],
    },
    // A listing longer than a page (test/e2e/many-cards/): it publishes
    // fictitious cards in Tizayuca and removes them, so it runs after "phone",
    // whose tests see the seed alone, and before the second locality.
    {
      name: "phone, many cards",
      use: PHONE,
      testMatch: "many-cards/*.spec.ts",
      dependencies: ["phone"],
    },
    // A search with more results than a page shows (test/e2e/search-pages/):
    // the test adds fictitious published cards to Tizayuca and removes them,
    // and the sitemap would list them, so it runs alone, after "phone, many
    // cards" and before the second locality.
    {
      name: "phone, search pages",
      use: PHONE,
      testMatch: "search-pages/*.spec.ts",
      dependencies: ["phone, many cards"],
    },
    // The registration (test/e2e/registration.spec.ts): its flows without
    // JavaScript turn Turnstile's switch off for a while, which every page
    // with the form would see, so it runs alone, after "phone, search pages"
    // and before the second locality.
    {
      name: "phone, registration",
      use: PHONE,
      testMatch: "registration.spec.ts",
      dependencies: ["phone, search pages"],
    },
    // The edit mode of the management link (test/e2e/edit.spec.ts): its flows
    // without JavaScript turn Turnstile's switch off too, and it publishes
    // fictitious cards in Tizayuca that the sitemap would list, so it runs
    // alone, after "phone, registration" and before the second locality.
    {
      name: "phone, edit",
      use: PHONE,
      testMatch: "edit.spec.ts",
      dependencies: ["phone, registration"],
    },
    // The review screens of the panel (test/e2e/admin.spec.ts): it adds
    // fictitious cards to Tizayuca, one published, with reports and a pending
    // edit, approves and rejects some of them, and narrows the roles of the
    // local identity for a while, which the queue, the sitemap and the crawls
    // would see, so it runs alone, after "phone, edit" and before the second
    // locality.
    {
      name: "phone, admin",
      use: PHONE,
      testMatch: "admin.spec.ts",
      dependencies: ["phone, edit"],
    },
    // The zones screen of the panel (test/e2e/admin-zones.spec.ts): it hides,
    // renames and adds zones of Tizayuca, which the registration form, the
    // trade pages and the crawls would see, and narrows the roles of the
    // local identity for a while, which test/e2e/admin.spec.ts does too, so
    // it runs alone, after "phone, admin" and before the second locality.
    {
      name: "phone, admin zones",
      use: PHONE,
      testMatch: "admin-zones.spec.ts",
      dependencies: ["phone, admin"],
    },
    // The same site with a second, fictitious active locality
    // (test/e2e/two-localities/): the list of localities at the root, the
    // locality cookie and the link to change municipality, and the crawls
    // again, now through the list. It runs after "phone", "phone, many cards",
    // "phone, search pages", "phone, registration", "phone, edit", "phone,
    // admin" and "phone, admin zones", whose tests expect Tizayuca alone, and
    // its teardown removes the second locality.
    {
      name: "second locality",
      testMatch: "two-localities/second-locality.setup.ts",
      dependencies: ["phone, admin zones"],
      teardown: "no second locality",
    },
    {
      name: "no second locality",
      testMatch: "two-localities/second-locality.teardown.ts",
    },
    {
      name: "phone, two localities",
      use: PHONE,
      dependencies: ["second locality"],
      testMatch: [
        "two-localities/*.spec.ts",
        "surfaces.spec.ts",
        "internal-links.spec.ts",
        "seo.spec.ts",
      ],
    },
    // The real Turnstile script under the site's policy, which needs the
    // network: only by hand, with E2E_TURNSTILE_REAL=1 (README, Registration).
    {
      name: "phone, real Turnstile",
      use: PHONE,
      testMatch: "turnstile-real.spec.ts",
    },
  ],
  webServer: {
    // --ignore-lock keeps the server in the foreground, so Playwright owns it.
    // Without it, astro preview moves to the background when it detects a
    // coding agent, and Playwright reports that the server exited early.
    command: `astro preview --port ${port} --ignore-lock`,
    // Playwright starts the server before the global setup migrates the
    // database, so readiness is a page that needs no database: a prerendered
    // one, served as a static asset.
    url: `http://localhost:${port}/terminos`,
    reuseExistingServer: !process.env["CI"],
  },
});
