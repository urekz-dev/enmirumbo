// Whether a Turnstile token is valid (ADR 0012; docs/specs/
// business-registration.md, "Turnstile is checked on the server, fails closed
// and has a switch in the database (v2)"). The network is passed in, so this
// is pure and every answer of Cloudflare can be tested.
//
// - A real secret key asks Cloudflare's siteverify, once, with a short
//   timeout. Only the secret and the token are sent: never the visitor's
//   address (`remoteip` is optional), which the privacy notice keeps in the
//   memory of the quota counter alone. A valid answer must also carry the
//   action of the form's widget. Anything else is not valid: an error code
//   (expired, already spent, invented), an answer that is not Cloudflare's,
//   a timeout or no answer at all, which is "unavailable". There is no retry:
//   the form fails closed, and the admin turns Turnstile off if Cloudflare's
//   check is down.
// - A test secret key, or no secret, counts only on the local Worker, where
//   it is emulated without network, the way Cloudflare answers it: the
//   always-pass key accepts the dummy token and nothing else, the other two
//   accept nothing. Anywhere else it accepts nothing, and the configuration
//   problem is reported, never the token. A real secret never accepts the
//   dummy token either, so no deployed environment can.
import {
  isTurnstileTestKey,
  TURNSTILE_DUMMY_TOKEN,
  TURNSTILE_TEST_SECRET_KEYS,
  type TurnstileAction,
} from "./keys.ts";

/** Cloudflare's endpoint that validates a token. */
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The longest token Cloudflare issues. */
export const MAX_TOKEN_LENGTH = 2048;

/**
 * What the check says of a token: valid; missing; not valid (expired, spent,
 * invented, of another form); or not checked because Cloudflare did not
 * answer or the secret is not set.
 */
export type TurnstileVerdict = "valid" | "missing" | "invalid" | "unavailable";

export interface VerifyTurnstileOptions {
  /** The secret key of the widget (TURNSTILE_SECRET_KEY), if any. */
  secret: string | undefined;
  /** Whether this is the local Worker (ENVIRONMENT `local`), the only place test keys count. */
  local: boolean;
  /** The action the widget of the form declares. */
  action: TurnstileAction;
  /** How siteverify is reached: the Worker's fetch, or a test's. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** How long siteverify may take before the token counts as unchecked. */
  timeoutMs: number;
  /** Where a configuration problem is reported. It never receives the token. */
  reportProblem: (message: string) => void;
}

/** The emulated answer of a test secret key, without network. */
function emulate(secret: string, token: string): TurnstileVerdict {
  return secret === TURNSTILE_TEST_SECRET_KEYS.alwaysPasses && token === TURNSTILE_DUMMY_TOKEN
    ? "valid"
    : "invalid";
}

/** The error codes of siteverify that mean the secret, not the token, is wrong. */
const SECRET_ERRORS = new Set(["missing-input-secret", "invalid-input-secret"]);

interface SiteverifyAnswer {
  success?: unknown;
  action?: unknown;
  "error-codes"?: unknown;
}

/** What `token`, read from a submission, is worth. */
export async function verifyTurnstileToken(
  token: string | null,
  options: VerifyTurnstileOptions,
): Promise<TurnstileVerdict> {
  if (token === null || token === "") return "missing";
  if (token.length > MAX_TOKEN_LENGTH) return "invalid";

  const secret = options.secret?.trim() ?? "";
  if (secret === "" || isTurnstileTestKey(secret)) {
    if (options.local) return emulate(secret || TURNSTILE_TEST_SECRET_KEYS.alwaysPasses, token);
    options.reportProblem(
      secret === ""
        ? "turnstile: TURNSTILE_SECRET_KEY is not set, so every submission that needs Turnstile is refused."
        : "turnstile: TURNSTILE_SECRET_KEY is a test key outside the local Worker, so every submission that needs Turnstile is refused.",
    );
    return secret === "" ? "unavailable" : "invalid";
  }
  if (token === TURNSTILE_DUMMY_TOKEN) return "invalid";

  let answer: SiteverifyAnswer;
  try {
    const response = await options.fetch(SITEVERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) return "unavailable";
    answer = (await response.json()) as SiteverifyAnswer;
  } catch {
    // A timeout, no connection or an answer that is not JSON.
    return "unavailable";
  }
  if (answer === null || typeof answer !== "object") return "unavailable";
  if (answer.success === true) return answer.action === options.action ? "valid" : "invalid";
  const codes = Array.isArray(answer["error-codes"]) ? answer["error-codes"] : [];
  if (codes.some((code) => SECRET_ERRORS.has(code as string))) {
    options.reportProblem(
      "turnstile: Cloudflare refused TURNSTILE_SECRET_KEY, so every submission that needs Turnstile is refused.",
    );
    return "unavailable";
  }
  return codes.includes("internal-error") ? "unavailable" : "invalid";
}
