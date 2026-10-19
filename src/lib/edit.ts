// The edit form of a management link between Astro and the core
// (docs/specs/business-registration.md, "The edit mode of a locality lives
// under it, and lands on its confirmation (v2)"). The form of
// src/pages/[state]/[municipality]/editar/[token].astro posts to its own
// address with the action `edit` (src/actions/index.ts), which Astro runs
// before the page; the page then reads its result. So:
//
// - The action only edits from that page: the locality the middleware
//   resolved and the token of the address (`context.params`), never a field.
//   Any other way to reach it (another page, `/_actions/edit`) is not found,
//   and so is a token that opens no card (src/core/edit/submit.ts).
// - The outcome of the core travels to the page as an ActionError, as the
//   registration's does (src/lib/registration.ts), with the same statuses
//   and the same encoding of the field errors: 400 for the fields (another
//   card's WhatsApp and a photo too large or unreadable among them), 403 when
//   Turnstile refused it, 429 over the quota, 503 when the server is busy with
//   other photos, 502 when Images could not process the photo, 500 when it
//   could not be saved, 404 when the link opens nothing. The page reads them
//   with registrationPageFailure. The token never goes in a message.
import { ActionError } from "astro:actions";
import type { ServedLocality } from "../core/locality/served.ts";
import type { EditTarget, SubmitEditOutcome } from "../core/edit/submit.ts";
import { registrationActionError } from "./registration.ts";

/** The route of the edit page, the only page whose submissions the action takes. */
export const EDIT_ROUTE = "/[state]/[municipality]/editar/[token]";

/** What the action needs of its context. */
export interface EditActionContext {
  routePattern: string;
  params: Record<string, string | undefined>;
  locals: { locality?: ServedLocality | undefined };
}

/**
 * The locality and the token a submission edits with: those of the edit
 * page's address, or null when the action was reached any other way.
 */
export function editTarget(context: EditActionContext): EditTarget | null {
  const { locality } = context.locals;
  const token = context.params["token"];
  if (context.routePattern !== EDIT_ROUTE || locality === undefined || token === undefined) {
    return null;
  }
  return { locality, token };
}

/** The error the action throws for an outcome, or null when the changes were received. */
export function editActionError(outcome: SubmitEditOutcome): ActionError | null {
  return outcome.kind === "not-found"
    ? new ActionError({ code: "NOT_FOUND" })
    : registrationActionError(outcome);
}
