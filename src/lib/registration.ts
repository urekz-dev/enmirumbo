// The registration form between Astro and the core
// (docs/specs/business-registration.md, "The registration page of a locality
// lives under it, and lands on its thank-you page (v2)"). The form of
// src/pages/[state]/[municipality]/registro.astro posts to its own address
// with the action `register` (src/actions/index.ts), which Astro runs before
// the page; the page then reads its result. So:
//
// - The action only registers in the locality of that page, which the
//   middleware resolved from the address; any other way to reach it (another
//   page, `/_actions/register`) is not found.
// - The outcome of the core (src/core/registration/submit.ts) travels to the
//   page as an ActionError, whose status Astro gives the page: 400 for the
//   fields (a duplicate number among them), 403 when Turnstile refused it,
//   429 over the quota and 500 when it could not be saved. Its message names the field errors, never
//   anything the owner wrote, so the page can show each one next to its
//   field and read what was written from the same submission.
import { ActionError } from "astro:actions";
import type { ServedLocality } from "../core/locality/served.ts";
import {
  ERROR_CODES,
  type ErrorField,
  type GeneralError,
  type RegistrationErrors,
} from "../core/registration/submission.ts";
import type { SubmitRegistrationOutcome } from "../core/registration/submit.ts";

/** The route of the registration form, the only page whose submissions the action takes. */
export const REGISTRATION_ROUTE = "/[state]/[municipality]/registro";

/** What the action needs of its context. */
export interface RegistrationActionContext {
  routePattern: string;
  locals: { locality?: ServedLocality | undefined };
}

/**
 * The locality a submission registers in: the one of the registration page,
 * or null when the action was reached any other way.
 */
export function registrationLocality(context: RegistrationActionContext): ServedLocality | null {
  const { locality } = context.locals;
  return context.routePattern === REGISTRATION_ROUTE && locality !== undefined ? locality : null;
}

/** The field errors as the message of an ActionError: `name:required whatsapp:invalid`. */
export function encodeErrors(errors: RegistrationErrors): string {
  return Object.entries(errors)
    .map(([field, code]) => `${field}:${code}`)
    .join(" ");
}

/** The field errors a message names, or null when it is not one encodeErrors wrote. */
export function decodeErrors(message: string): RegistrationErrors | null {
  if (message === "") return null;
  const errors: Record<string, string> = {};
  for (const pair of message.split(" ")) {
    const [field = "", code = "", ...rest] = pair.split(":");
    if (rest.length > 0 || !Object.hasOwn(ERROR_CODES, field) || Object.hasOwn(errors, field)) {
      return null;
    }
    if (!(ERROR_CODES[field as ErrorField] as readonly string[]).includes(code)) return null;
    errors[field] = code;
  }
  return errors as RegistrationErrors;
}

/** The message of the errors above the form. */
const GENERAL: Readonly<Record<GeneralError, { code: ActionError["code"]; message: string }>> = {
  turnstile: { code: "FORBIDDEN", message: "turnstile" },
  quota: { code: "TOO_MANY_REQUESTS", message: "quota" },
  server: { code: "INTERNAL_SERVER_ERROR", message: "server" },
};

/** The error the action throws for an outcome, or null when the registration was received. */
export function registrationActionError(outcome: SubmitRegistrationOutcome): ActionError | null {
  switch (outcome.kind) {
    case "received":
      return null;
    case "invalid":
      return new ActionError({ code: "BAD_REQUEST", message: encodeErrors(outcome.errors) });
    case "turnstile":
    case "quota":
    case "server":
      return new ActionError(GENERAL[outcome.kind]);
  }
}

/** What the page does with an error of the action. */
export interface RegistrationPageFailure {
  /** The error next to each field. */
  errors: RegistrationErrors;
  /** The error above the form, if any. */
  general: GeneralError | null;
  /**
   * Whether the submission reached the action, so its body is a form of a
   * bounded size that the page can read again for the draft.
   */
  keepsDraft: boolean;
}

/**
 * How the page answers an error of the action. An error the action did not
 * throw (Astro refused a body too large or of another type) comes back as
 * the failure to save, without the draft.
 */
export function registrationPageFailure(error: ActionError): RegistrationPageFailure {
  for (const [general, { code, message }] of Object.entries(GENERAL)) {
    if (error.code === code && error.message === message) {
      return { errors: {}, general: general as GeneralError, keepsDraft: true };
    }
  }
  const errors = error.code === "BAD_REQUEST" ? decodeErrors(error.message) : null;
  if (errors !== null) return { errors, general: null, keepsDraft: true };
  return { errors: {}, general: "server", keepsDraft: false };
}
