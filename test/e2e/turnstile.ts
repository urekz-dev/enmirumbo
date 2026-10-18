// Turnstile in the end-to-end tests, without Cloudflare (docs/specs/
// business-registration.md, "The registration and edit forms are protected
// by quotas, honeypot and Turnstile (v2)", scenario "test keys"). The local
// Worker of `astro preview` has Cloudflare's always-pass test site key and
// checks tokens by emulating the always-pass test secret, without network
// (src/core/turnstile/verify.ts). In the browser, every request to
// challenges.cloudflare.com is answered here: api.js by a local fake
// (./turnstile-fake.js) that produces the same dummy token, and anything else
// is refused. The real script is checked by hand (./turnstile-real.spec.ts).
//
// A spec that opens a page with the Turnstile widget imports `test` and
// `expect` from here, whose `context` already has the fake; a context a test
// creates itself gets it with `stubTurnstile`. Turnstile's switch is on in
// every run (the global setup turns it on); `setTurnstileSwitch` turns it off
// only in a project that runs alone (playwright.config.ts).
import { readFileSync } from "node:fs";
import { test as base, type BrowserContext } from "@playwright/test";
import { siteSettings } from "../../src/core/db/schema/index.ts";
import { withDatabase } from "./database.ts";

/** The origin of Turnstile's script and frames. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

const FAKE = readFileSync(new URL("./turnstile-fake.js", import.meta.url), "utf8");

/** How the fake solves its widgets: on its own, or when a test says so. */
export type TurnstileSolve = "auto" | "manual";

/** Answers every request of `context` to Turnstile's origin locally. */
export async function stubTurnstile(
  context: BrowserContext,
  solve: TurnstileSolve = "auto",
): Promise<void> {
  await context.route(`${TURNSTILE_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/turnstile/v0/api.js") return route.abort();
    return route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: FAKE.replace('"__SOLVE__"', JSON.stringify(solve)),
    });
  });
}

/** Turns Turnstile's switch on or off in the database the preview reads. */
export async function setTurnstileSwitch(enabled: boolean): Promise<void> {
  await withDatabase(async (db) => {
    await db.update(siteSettings).set({ turnstileEnabled: enabled });
  });
}

export const test = base.extend<{ turnstileSolve: TurnstileSolve }>({
  turnstileSolve: ["auto", { option: true }],
  context: async ({ context, turnstileSolve }, use) => {
    await stubTurnstile(context, turnstileSolve);
    await use(context);
  },
});

export { expect } from "@playwright/test";
