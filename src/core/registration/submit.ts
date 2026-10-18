// A submission of the registration form, from what arrived to what the owner
// is told (docs/specs/business-registration.md, "The server validates every
// field and returns per-field errors in Spanish", "One card per WhatsApp
// number", "A successful submission queues the business and shows the
// thank-you screen", "The registration's honeypot and per-IP quota are
// those of the public forms (v2)" and "Turnstile is checked on the server,
// fails closed and has a switch in the database (v2)"). The action of the
// form (src/actions/index.ts) only finds the locality of the page and gives
// this its connection, its quota and its Turnstile check. In this order:
//
// 1. The trap field: a bot is told the registration was received, and
//    nothing else happens, not even a connection to the database.
// 2. Turnstile (../turnstile/check.ts), unless its switch is off: without a
//    valid token the form comes back, and nothing else happens.
// 3. Every field, against the catalogue of the locality: errors, and
//    nothing else happens, so a typo spends no quota.
// 4. The per-IP quota, checked and taken in one step by its counter. It
//    comes before the number is looked up, so finding out which numbers
//    have a card takes one valid submission each, three an hour.
// 5. The registration: a new card, the resubmission of a rejected one (told
//    the same as a new one, so the form never says a card was rejected), or
//    the duplicate of a card in review or published (./save.ts).
//
// The photo (EMR-40) is opened after step 4 and before step 5, so nothing
// the defenses stop costs any image work.
//
// Nothing here writes what the owner typed, the address or anything about a
// card to the log: a failure is logged by its kind alone.
import type { Db } from "../db/client.ts";
import { failureKind } from "../db/failure.ts";
import { isHoneypotFilled } from "../forms/honeypot.ts";
import type { ServedLocality } from "../locality/served.ts";
import type { QuotaDecision } from "../quota/window.ts";
import { checkTurnstile, passesTurnstile, type VerifyTurnstile } from "../turnstile/check.ts";
import { registrationCatalogue } from "./catalogue.ts";
import { saveRegistration } from "./save.ts";
import { type RegistrationErrors, validateRegistration } from "./submission.ts";

export interface SubmitRegistrationDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
  /** Counts this submission in the per-IP quota of the registrations, and says whether it may go on. */
  takeQuota: () => Promise<QuotaDecision>;
  /** Checks a Turnstile token with Cloudflare (src/lib/turnstile.ts), when the switch is on. */
  verifyTurnstile: VerifyTurnstile;
}

/**
 * What the owner is told: the registration was received (a new card, a
 * resubmission or a bot caught by the trap, which must look the same); the
 * form comes back with errors next to its fields (a duplicate number among
 * them); or it comes back refused by Turnstile, over the quota, or after a
 * failure to save.
 */
export type SubmitRegistrationOutcome =
  | { kind: "received" }
  | { kind: "invalid"; errors: RegistrationErrors }
  | { kind: "turnstile" }
  | { kind: "quota" }
  | { kind: "server" };

const RECEIVED: SubmitRegistrationOutcome = { kind: "received" };

export async function submitRegistration(
  form: FormData,
  locality: Pick<ServedLocality, "code" | "name">,
  deps: SubmitRegistrationDeps,
): Promise<SubmitRegistrationOutcome> {
  if (isHoneypotFilled(form)) return RECEIVED;
  try {
    return await deps.useDb(async (db) => {
      const turnstile = await checkTurnstile(db, form, "registration", deps.verifyTurnstile);
      if (!passesTurnstile(turnstile)) return { kind: "turnstile" };
      const validation = validateRegistration(form, await registrationCatalogue(db, locality));
      if (validation.kind === "invalid") return validation;
      const quota = await deps.takeQuota();
      if (!quota.allowed) return { kind: "quota" };
      const saved = await saveRegistration(db, locality.code, validation.registration);
      return saved === "duplicate"
        ? { kind: "invalid", errors: { whatsapp: "duplicate" } }
        : RECEIVED;
    });
  } catch (error) {
    console.error(`registration: a registration could not be saved (${failureKind(error)})`);
    return { kind: "server" };
  }
}
