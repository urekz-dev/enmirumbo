// Turnstile between the Worker and the core (ADR 0012; docs/specs/
// business-registration.md, "Turnstile is checked on the server, fails closed
// and has a switch in the database (v2)"). A form that needs it renders
// src/components/TurnstileWidget.astro with `turnstileSiteKey(env)` while
// the switch is on, and its action gives its core `turnstileVerifier(env)`,
// which src/core/turnstile/check.ts calls with the token and the form's
// action. The registration and the edit form of the management link do both,
// each with its own action.
//
// The secret is TURNSTILE_SECRET_KEY, a Worker secret. Locally none is
// needed: with ENVIRONMENT `local` Cloudflare's test keys are emulated
// without network (src/core/turnstile/verify.ts), and nowhere else do they
// count. A configuration problem is logged once per isolate, never per
// request, and never with a token.
import type { VerifyTurnstile } from "../core/turnstile/check.ts";
import { isUsableSiteKey } from "../core/turnstile/keys.ts";
import { verifyTurnstileToken } from "../core/turnstile/verify.ts";

/** How long siteverify may take before the submission is refused. */
export const SITEVERIFY_TIMEOUT_MS = 3000;

/** The vars and the secret Turnstile reads. */
export interface TurnstileVars {
  ENVIRONMENT?: string | undefined;
  TURNSTILE_SITE_KEY?: string | undefined;
  TURNSTILE_SECRET_KEY?: string | undefined;
}

const reported = new Set<string>();

function reportOnce(message: string): void {
  if (reported.has(message)) return;
  reported.add(message);
  console.error(message);
}

/**
 * The site key the widget renders with, or null when the environment has
 * none it may use (a test key counts only locally), which is logged once:
 * the page then shows no widget and the form cannot be sent, since the
 * action still asks for a token.
 */
export function turnstileSiteKey(vars: TurnstileVars): string | null {
  const key = vars.TURNSTILE_SITE_KEY?.trim() ?? "";
  if (isUsableSiteKey(key, vars.ENVIRONMENT === "local")) return key;
  reportOnce(
    `turnstile: TURNSTILE_SITE_KEY is missing, or a test key outside the local Worker, in the "${vars.ENVIRONMENT ?? "(none)"}" environment, so the forms that need Turnstile cannot be sent.`,
  );
  return null;
}

/** How the actions check a token: siteverify with the environment's secret. */
export function turnstileVerifier(
  vars: TurnstileVars,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): VerifyTurnstile {
  return (token, action) =>
    verifyTurnstileToken(token, {
      secret: vars.TURNSTILE_SECRET_KEY,
      local: vars.ENVIRONMENT === "local",
      action,
      fetch: fetcher,
      timeoutMs: SITEVERIFY_TIMEOUT_MS,
      reportProblem: reportOnce,
    });
}
