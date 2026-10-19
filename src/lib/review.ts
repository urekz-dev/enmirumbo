// The decisions of the detail of a card between Astro and the core
// (docs/specs/admin-review.md, "Approving assigns trades, normalizes the
// zone, marks the origin and publishes the card", "On approving, an offer is
// made to notify the business by WhatsApp with its card link and its
// management link", "Rejecting requires a reason, stores it with its date and
// offers to notify by WhatsApp" and "A transition is only applied to a
// registration that is still in review"). The forms of
// src/pages/admin/registros/[id].astro post to that same address with the
// actions `admin.approve` and `admin.reject` (src/actions/index.ts), which
// Astro runs before the page; the page then reads their results. So:
//
// - Each action decides only from that page: the card is the one of the
//   page's address (`context.params`), never a field. Any other way to reach
//   it (another page, `/_actions/admin.approve`) is not found, before
//   anything is read; an action reached by `/_actions/` would answer its
//   result as JSON, and an approval's carries the management link.
// - The outcome of the core travels to the page as an ActionError, whose
//   status Astro gives the page: 404 for a card that does not exist or the
//   user may not see, 403 for one the user sees but may not decide on, 409
//   when it was already resolved, 400 for the form's errors, named in the
//   message (never anything the admin wrote), and 500 when it could not be
//   saved.
// - An approval answers the page with the notice of its confirmation: the
//   card's public address and its management link, both absolute, which the
//   page shows in that one answer and nowhere else. The address of that
//   answer carries no token (`/admin/registros/<id>?_action=admin.approve`),
//   it is never stored by a cache (every answer under /admin is `no-store`)
//   and its referrer policy sends no path to WhatsApp. Sending the form
//   again, by reloading or going back, finds the card already resolved: it
//   issues no new link and shows none.
import { ActionError } from "astro:actions";
import { cardPath } from "../core/business/card-path.ts";
import { editPath as managementLinkPath } from "../core/edit/paths.ts";
import type { ApprovalErrors, ApprovalOutcome } from "../core/review/approval.ts";
import type { ReasonError } from "../core/review/reason.ts";
import type { RejectionOutcome } from "../core/review/rejection.ts";
import { absoluteUrl, type SiteVars } from "./site-url.ts";

/** The route of the detail of a card, the only page whose submissions the decisions take. */
export const REGISTRATION_ROUTE = "/admin/registros/[id]";

/** What an action needs of its context. */
export interface ReviewActionContext {
  routePattern: string;
  params: Record<string, string | undefined>;
}

/**
 * The identifier of the card a submission decides on: the one of the
 * detail's address, or null when the action was reached any other way.
 */
export function reviewTarget(context: ReviewActionContext): string | null {
  if (context.routePattern !== REGISTRATION_ROUTE) return null;
  return context.params["id"] ?? null;
}

/** What the confirmation of an approval shows: the notice to the business. */
export interface ApprovalNotice {
  name: string;
  whatsapp: string;
  /** The card's public address; null when the site has no public origin (NO_SITE_URL). */
  cardUrl: string | null;
  /** The management link; null with no public origin either. */
  managementUrl: string | null;
}

/** The notice of an approved card, its addresses absolute from SITE_URL. */
export function approvalNotice(
  vars: SiteVars,
  approved: Extract<ApprovalOutcome, { kind: "approved" }>,
): ApprovalNotice {
  const { card, token } = approved;
  return {
    name: card.name,
    whatsapp: card.whatsapp,
    cardUrl: absoluteUrl(vars, cardPath(card.locality, card)),
    managementUrl: absoluteUrl(vars, managementLinkPath(card.locality, token)),
  };
}

/** The errors of the approval form as the message of an ActionError: `trades zone`. */
function encodeApprovalErrors(errors: ApprovalErrors): string {
  return (["trades", "zone"] as const).filter((field) => errors[field] !== undefined).join(" ");
}

/** The errors an approval's message names, or null when it is not one encodeApprovalErrors wrote. */
function decodeApprovalErrors(message: string): ApprovalErrors | null {
  const fields = message.split(" ");
  const errors: ApprovalErrors = {};
  for (const field of fields) {
    if (field === "trades" && errors.trades === undefined) errors.trades = "too-many";
    else if (field === "zone" && errors.zone === undefined) errors.zone = "required";
    else return null;
  }
  return errors;
}

const REASON_ERRORS: ReadonlySet<string> = new Set<ReasonError>(["required", "too-long"]);

/** The error an action throws for what is common to every decision, or null. */
function decisionError(outcome: { kind: string }): ActionError | null {
  switch (outcome.kind) {
    case "not-found":
      return new ActionError({ code: "NOT_FOUND" });
    case "forbidden":
      return new ActionError({ code: "FORBIDDEN", message: "No tienes acceso." });
    case "resolved":
      return new ActionError({ code: "CONFLICT", message: "resolved" });
    default:
      return null;
  }
}

/** The error the approval throws for an outcome, or null when the card was published. */
export function approvalActionError(outcome: ApprovalOutcome): ActionError | null {
  if (outcome.kind === "approved") return null;
  if (outcome.kind === "invalid") {
    return new ActionError({ code: "BAD_REQUEST", message: encodeApprovalErrors(outcome.errors) });
  }
  return decisionError(outcome);
}

/** The error the rejection throws for an outcome, or null when the card was rejected. */
export function rejectionActionError(outcome: RejectionOutcome): ActionError | null {
  if (outcome.kind === "rejected") return null;
  if (outcome.kind === "invalid") {
    return new ActionError({ code: "BAD_REQUEST", message: outcome.error });
  }
  return decisionError(outcome);
}

/** What the page does with an error of a decision. */
export type DecisionFailure =
  /** The site's 404, as for a card that does not exist. */
  | { kind: "not-found" }
  /** The panel's 403. */
  | { kind: "forbidden" }
  /** "Este registro ya lo habías resuelto." */
  | { kind: "resolved" }
  /** The form again, with its errors and what the admin chose, read from the submission. */
  | { kind: "approval"; errors: ApprovalErrors }
  | { kind: "rejection"; error: ReasonError }
  /**
   * The detail with "No se pudo guardar", nothing decided. `keepsDraft` says
   * whether the action read the submission, so the page may read it again
   * for what the admin sent: not when Astro refused its body unread.
   */
  | { kind: "server"; keepsDraft: boolean };

const SERVER: DecisionFailure = { kind: "server", keepsDraft: false };

/** How the page answers an error of a decision, `form` being the one that was sent. */
export function decisionFailure(
  error: ActionError,
  form: "approval" | "rejection",
): DecisionFailure {
  switch (error.code) {
    case "NOT_FOUND":
      return { kind: "not-found" };
    case "FORBIDDEN":
      return { kind: "forbidden" };
    case "CONFLICT":
      return error.message === "resolved" ? { kind: "resolved" } : SERVER;
    case "BAD_REQUEST": {
      if (form === "approval") {
        const errors = decodeApprovalErrors(error.message);
        return errors === null ? SERVER : { kind: "approval", errors };
      }
      return REASON_ERRORS.has(error.message)
        ? { kind: "rejection", error: error.message as ReasonError }
        : SERVER;
    }
    case "INTERNAL_SERVER_ERROR":
      // The decision failed while saving, after its body was read.
      return { kind: "server", keepsDraft: true };
    default:
      return SERVER;
  }
}
