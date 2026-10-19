// Scenario "Turnstile loads" of docs/specs/deployment.md, "The content
// security policy allows Turnstile as well as Umami (v2)", with Cloudflare's
// real script: the registration page of the preview, with the site's policy
// and the always-pass test site key, loads Turnstile's api.js and its frame
// from challenges.cloudflare.com without a violation, gets the dummy token,
// and the registration lands on the thank-you page, the preview checking the
// token without network. It needs the network, so it runs only by hand:
//
//   E2E_TURNSTILE_REAL=1 vp run e2e --project "phone, real Turnstile"
//
// Every other end-to-end test uses the local fake of ./turnstile.ts instead.
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { businesses } from "../../src/core/db/schema/index.ts";
import { NOTICE_VERSION } from "../../src/core/legal/version.ts";
import { TURNSTILE_DUMMY_TOKEN } from "../../src/core/turnstile/keys.ts";
import { withDatabase } from "./database.ts";

const FORM = "/hidalgo/tizayuca/registro";
const WHATSAPP = "7719994090";

async function remove(): Promise<void> {
  await withDatabase(async (db) => {
    await db
      .delete(businesses)
      .where(and(eq(businesses.localityCode, "13069"), eq(businesses.whatsapp, WHATSAPP)));
  });
}

test.skip(!process.env["E2E_TURNSTILE_REAL"], "needs the network: E2E_TURNSTILE_REAL=1");
test.beforeAll(remove);
test.afterAll(remove);

test("Cloudflare's real Turnstile script loads under the policy, gets its token and the registration is received", async ({
  page,
}) => {
  // Every violation the browser reports, from the page or its frames.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const response = await page.goto(FORM);
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("script-src 'self' https://challenges.cloudflare.com");
  expect(policy).toContain("frame-src https://challenges.cloudflare.com");
  expect(policy).toContain("style-src 'self'");

  // The widget's frame comes from Cloudflare. Turnstile keeps it in a closed
  // shadow root, so it is looked for among the page's frames.
  await expect
    .poll(
      () =>
        page.frames().some((frame) => frame.url().startsWith("https://challenges.cloudflare.com/")),
      { timeout: 20_000 },
    )
    .toBe(true);
  const token = page.locator('input[name="cf-turnstile-response"]');
  await expect(token).toHaveValue(TURNSTILE_DUMMY_TOKEN, { timeout: 20_000 });
  const button = page.getByRole("button", { name: "Registrar mi negocio", exact: true });
  await expect(button).toBeEnabled();
  // Read before the page is left, which takes its listener with it.
  const violations = await page.evaluate(
    () => (window as unknown as { cspViolations?: string[] }).cspViolations ?? [],
  );
  expect(violations).toEqual([]);

  await page
    .getByLabel("¿Cómo se llama tu negocio?", { exact: true })
    .fill("Taller Real de Mentiras");
  await page.getByLabel("¿A qué se dedica?", { exact: true }).selectOption({ label: "Talleres" });
  await page.getByLabel("Tu WhatsApp (10 dígitos)", { exact: true }).fill(WHATSAPP);
  await page.getByLabel("Código postal", { exact: true }).fill("43808");
  await page
    .getByLabel("¿En qué colonia estás?", { exact: true })
    .selectOption({ label: "Huicalco" });
  await page
    .getByLabel(
      "Acepto el aviso de privacidad y confirmo que este negocio es mío o que tengo permiso para registrarlo.",
      { exact: true },
    )
    .check();
  await button.click();
  await expect(page).toHaveURL(`${FORM}/gracias`);

  expect(consoleErrors.filter((text) => /Content Security Policy/i.test(text))).toEqual([]);

  let saved: { version: string | null }[] = [];
  await withDatabase(async (db) => {
    saved = await db
      .select({ version: businesses.consentedToNoticeVersion })
      .from(businesses)
      .where(and(eq(businesses.localityCode, "13069"), eq(businesses.whatsapp, WHATSAPP)));
  });
  expect(saved).toEqual([{ version: NOTICE_VERSION }]);
});
