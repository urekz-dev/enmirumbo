// The Turnstile check of a form that needs it (ADR 0012; docs/specs/
// business-registration.md, "Turnstile is checked on the server, fails closed
// and has a switch in the database (v2)"): the registration and the edit form
// of the management link, each with its own action. With the switch off nothing is asked;
// with it on, the submission passes only with a token that ./verify.ts finds
// valid.
//
// The switch is read through the connection the action passes, which is
// HYPERDRIVE_FRESH: turning Turnstile off lets submissions through at once,
// even while the cached page still shows the widget for up to a minute.
//
// Nothing here logs the token or anything else of the submission: a refusal
// is logged by its form and its verdict alone.
import type { Db } from "../db/client.ts";
import { isTurnstileEnabled } from "../settings/settings.ts";
import { TURNSTILE_RESPONSE_FIELD, type TurnstileAction } from "./keys.ts";
import type { TurnstileVerdict } from "./verify.ts";

/** How a token is checked: src/lib/turnstile.ts gives the Worker's, tests their own. */
export type VerifyTurnstile = (
  token: string | null,
  action: TurnstileAction,
) => Promise<TurnstileVerdict>;

/** What the check decided: off, or the verdict on the token. */
export type TurnstileCheck = "off" | TurnstileVerdict;

/** The token of a submission: the first value of its field, when it is text that is not empty. */
export function turnstileToken(form: FormData): string | null {
  const value = form.get(TURNSTILE_RESPONSE_FIELD);
  return typeof value === "string" && value !== "" ? value : null;
}

/** Whether a submission with this check may go on. */
export function passesTurnstile(check: TurnstileCheck): boolean {
  return check === "off" || check === "valid";
}

/** Checks the submission `form` of the form `action`. */
export async function checkTurnstile(
  db: Db,
  form: FormData,
  action: TurnstileAction,
  verify: VerifyTurnstile,
): Promise<TurnstileCheck> {
  if (!(await isTurnstileEnabled(db))) return "off";
  const verdict = await verify(turnstileToken(form), action);
  if (verdict === "unavailable") {
    console.error(`turnstile: a ${action} was refused because its token could not be checked`);
  } else if (verdict !== "valid") {
    console.log(`turnstile: a ${action} was refused (${verdict} token)`);
  }
  return verdict;
}
