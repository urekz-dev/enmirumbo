// What the site knows about Cloudflare Turnstile's keys and tokens (ADR 0012;
// docs/specs/business-registration.md, "Turnstile is checked on the server,
// fails closed and has a switch in the database (v2)"; Cloudflare's
// "Testing" page: https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
// Pure.
//
// - The site key is public: it travels in the page, and each environment
//   names its own in TURNSTILE_SITE_KEY. The deployed environments use the
//   widgets `enmirumbo` (prod) and `enmirumbo-dev` (dev and stage); the local
//   Worker uses Cloudflare's always-pass test site key.
// - The secret key is a Worker secret, TURNSTILE_SECRET_KEY, uploaded by the
//   deploy workflows. Locally none is needed: the test secret keys are
//   emulated without network (./verify.ts).
// - A test site key always produces the dummy token below, which only a test
//   secret key accepts, and a test secret key counts only on the local Worker.
//   So a dummy token can never pass in a deployed environment.

/**
 * What a form says above it when Turnstile refused its submission, the same
 * on every form that needs it.
 */
export const TURNSTILE_FAILED_MESSAGE =
  "No pudimos comprobar que eres una persona. Vuelve a intentarlo.";

/** The field of the form where the widget leaves its token. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";

/** The token every test site key produces. */
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** Cloudflare's test site keys, each with its behaviour in the browser. */
export const TURNSTILE_TEST_SITE_KEYS = {
  alwaysPasses: "1x00000000000000000000AA",
  alwaysBlocks: "2x00000000000000000000AB",
  alwaysPassesInvisible: "1x00000000000000000000BB",
  alwaysBlocksInvisible: "2x00000000000000000000BB",
  forcesChallenge: "3x00000000000000000000FF",
} as const;

/** Cloudflare's test secret keys, each with its answer to a token. */
export const TURNSTILE_TEST_SECRET_KEYS = {
  alwaysPasses: "1x0000000000000000000000000000000AA",
  alwaysFails: "2x0000000000000000000000000000000AA",
  alreadySpent: "3x0000000000000000000000000000000AA",
} as const;

/**
 * The shape of every test key of Cloudflare, site or secret: a digit, `x`,
 * zeros and two capital letters. A future test key has it too.
 */
const TEST_KEY = /^[0-9]x0+[A-Z]{2}$/;

/** Whether `key` is one of Cloudflare's test keys, site or secret. */
export function isTurnstileTestKey(key: string): boolean {
  return TEST_KEY.test(key.trim());
}

/**
 * The shape of a real site key from Cloudflare's dashboard: `0x` and its
 * characters. A deployed environment needs one (scripts/deploy/
 * check-build.sh), so neither a placeholder nor a test key is ever deployed.
 */
export const TURNSTILE_SITE_KEY_PATTERN = /^0x[0-9A-Za-z_-]{10,}$/;

/**
 * Whether `key` may be the site key of the environment: a real one anywhere,
 * a test key only on the local Worker.
 */
export function isUsableSiteKey(key: string, local: boolean): boolean {
  return TURNSTILE_SITE_KEY_PATTERN.test(key) || (local && isTurnstileTestKey(key));
}

/**
 * The actions the widgets declare, one per form, which a real token carries
 * back and the server checks: a token from one form does not pass on another.
 */
export const TURNSTILE_ACTIONS = ["registration", "edit"] as const;
export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[number];
