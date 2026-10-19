// The actions on a card between Astro and the core (docs/specs/
// admin-review.md, "Approving assigns trades, normalizes the zone, marks the
// origin and publishes the card", "On approving, an offer is made to notify
// the business by WhatsApp with its card link and its management link",
// "Rejecting requires a reason, stores it with its date and offers to notify
// by WhatsApp", "A transition is only applied to a registration that is
// still in review", "Unpublish a published card, with a mandatory reason and
// conditioned on the status", "The admin can generate a new link, and the
// previous one stops working", "Permanent deletion is confirmed in two steps,
// by typing a word" and "Unpublishing, a new link and the permanent deletion
// are forms of the detail, and their actions check everything again (v2)").
// The forms of src/pages/admin/registros/[id].astro post to that same
// address with the actions `admin.approve`, `admin.reject`,
// `admin.unpublish` and `admin.newLink`, and the deletion form of
// src/pages/admin/registros/[id]/borrar.astro to that address with
// `admin.deleteCard` (src/actions/index.ts); Astro runs each before its page,
// which then reads its result. So:
//
// - Each action decides only from its page: the card is the one of the
//   page's address (`context.params`), never a field. Any other way to reach
//   it (another page, `/_actions/admin.approve`) is not found, before
//   anything is read; an action reached by `/_actions/` would answer its
//   result as JSON, and an approval's or a new link's carries the management
//   link.
// - The outcome of the core travels to the page as an ActionError, whose
//   status Astro gives the page: 404 for a card that does not exist or the
//   user may not see, 403 for one the user sees but may not decide on, 409
//   when it was already resolved or is no longer published, 400 for the
//   form's errors, named in the message (never anything the admin wrote), 503
//   when something the action needs cannot be reached, and 500 when it could
//   not be saved.
// - An approval and a new link answer the page with the notice of their
//   confirmation, which carries the management link, absolute: the page
//   shows it in that one answer and nowhere else. The address of that answer
//   carries no token (`/admin/registros/<id>?_action=admin.approve`), it is
//   never stored by a cache (every answer under /admin is `no-store`) and its
//   referrer policy sends no path to WhatsApp. Sending the form again, by
//   reloading or going back, finds the card already resolved, or its link
//   already replaced: it issues no new link and shows none.
import { ActionError } from "astro:actions";
import { cardPath } from "../core/business/card-path.ts";
import { editPath as managementLinkPath } from "../core/edit/paths.ts";
import type { ApprovalErrors, ApprovalOutcome } from "../core/review/approval.ts";
import type { DeletionOutcome } from "../core/review/deletion.ts";
import type { NewLinkOutcome } from "../core/review/new-link.ts";
import type { ReasonError } from "../core/review/reason.ts";
import type { RejectionOutcome } from "../core/review/rejection.ts";
import type { UnpublishOutcome } from "../core/review/unpublish.ts";
import { absoluteUrl, type SiteVars } from "./site-url.ts";

/** The route of the detail of a card, the only page whose submissions the decisions take. */
export const REGISTRATION_ROUTE = "/admin/registros/[id]";

/** The route of the confirmation of a deletion, the only page whose submissions the deletion takes. */
export const DELETION_ROUTE = "/admin/registros/[id]/borrar";

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

/**
 * The identifier of the card a deletion deletes: the one of the address of
 * its confirmation, or null when the action was reached any other way.
 */
export function deletionTarget(context: ReviewActionContext): string | null {
  if (context.routePattern !== DELETION_ROUTE) return null;
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

/** What the confirmation of a new link shows: the notice to the business. */
export interface NewLinkNotice {
  name: string;
  whatsapp: string;
  /** The new management link, absolute. */
  managementUrl: string;
}

/**
 * The notice of a new link, absolute from SITE_URL; null without a public
 * origin, which the core already refused before issuing anything.
 */
export function newLinkNotice(
  vars: SiteVars,
  issued: Extract<NewLinkOutcome, { kind: "issued" }>,
): NewLinkNotice | null {
  const managementUrl = absoluteUrl(vars, managementLinkPath(issued.card.locality, issued.token));
  if (managementUrl === null) return null;
  return { name: issued.card.name, whatsapp: issued.card.whatsapp, managementUrl };
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

/** The error the unpublishing throws for an outcome, or null when the card was unpublished. */
export function unpublishActionError(outcome: UnpublishOutcome): ActionError | null {
  switch (outcome.kind) {
    case "unpublished":
      return null;
    case "invalid":
      return new ActionError({ code: "BAD_REQUEST", message: outcome.error });
    case "not-published":
      return new ActionError({ code: "CONFLICT", message: "not-published" });
    default:
      return decisionError(outcome);
  }
}

/** The error a new link throws for an outcome, or null when it was issued. */
export function newLinkActionError(outcome: NewLinkOutcome): ActionError | null {
  switch (outcome.kind) {
    case "issued":
      return null;
    case "not-published":
      return new ActionError({ code: "CONFLICT", message: "not-published" });
    case "replaced":
      return new ActionError({ code: "CONFLICT", message: "replaced" });
    case "no-site-url":
      return new ActionError({ code: "SERVICE_UNAVAILABLE", message: "no-site-url" });
    default:
      return decisionError(outcome);
  }
}

/** The error the deletion throws for an outcome, or null when the card was deleted. */
export function deletionActionError(outcome: DeletionOutcome): ActionError | null {
  switch (outcome.kind) {
    case "deleted":
      return null;
    case "gone":
      return new ActionError({ code: "NOT_FOUND", message: "gone" });
    case "invalid":
      return new ActionError({ code: "BAD_REQUEST", message: "word" });
    case "storage":
      return new ActionError({ code: "SERVICE_UNAVAILABLE", message: "storage" });
    case "failed":
      return new ActionError({
        code: "INTERNAL_SERVER_ERROR",
        message: outcome.photoRemoved ? "photo-removed" : "not-deleted",
      });
    case "forbidden":
      return new ActionError({ code: "FORBIDDEN", message: "No tienes acceso." });
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
  | { kind: "unpublish"; error: ReasonError }
  /** "Esta ficha ya no estaba publicada." */
  | { kind: "not-published" }
  /** The link the form was shown with was already replaced: no other was issued. */
  | { kind: "replaced" }
  /** No public origin to build a new link with: none was issued. */
  | { kind: "no-site-url" }
  /**
   * The detail with "No se pudo guardar", nothing decided. `keepsDraft` says
   * whether the action read the submission, so the page may read it again
   * for what the admin sent: not when Astro refused its body unread.
   */
  | { kind: "server"; keepsDraft: boolean };

const SERVER: DecisionFailure = { kind: "server", keepsDraft: false };

/** The forms of the detail of a card. */
export type DetailForm = "approval" | "rejection" | "unpublish" | "new-link";

/** How the page answers an error of a decision, `form` being the one that was sent. */
export function decisionFailure(error: ActionError, form: DetailForm): DecisionFailure {
  switch (error.code) {
    case "NOT_FOUND":
      return { kind: "not-found" };
    case "FORBIDDEN":
      return { kind: "forbidden" };
    case "CONFLICT":
      if (error.message === "resolved") return { kind: "resolved" };
      if (error.message === "not-published") return { kind: "not-published" };
      if (error.message === "replaced") return { kind: "replaced" };
      return SERVER;
    case "SERVICE_UNAVAILABLE":
      return error.message === "no-site-url" ? { kind: "no-site-url" } : SERVER;
    case "BAD_REQUEST": {
      if (form === "approval") {
        const errors = decodeApprovalErrors(error.message);
        return errors === null ? SERVER : { kind: "approval", errors };
      }
      if (form === "new-link" || !REASON_ERRORS.has(error.message)) return SERVER;
      return { kind: form, error: error.message as ReasonError };
    }
    case "INTERNAL_SERVER_ERROR":
      // The decision failed while saving, after its body was read.
      return { kind: "server", keepsDraft: true };
    default:
      return SERVER;
  }
}

/** What the confirmation of a deletion does with an error of the deletion. */
export type DeletionFailure =
  /** "Esta ficha ya no existe.": the card was deleted, or never was one the user sees. */
  | { kind: "gone" }
  /** The panel's 403. */
  | { kind: "forbidden" }
  /** The confirmation again, with "Para borrar, escribe BORRAR en el campo." */
  | { kind: "word" }
  /** "La ficha no se borró: no pude alcanzar el almacén de fotos. …" */
  | { kind: "storage" }
  /** The rows could not be deleted; `photoRemoved` when the photos already were. */
  | { kind: "failed"; photoRemoved: boolean };

/** How the confirmation of a deletion answers an error of the deletion. */
export function deletionFailure(error: ActionError): DeletionFailure {
  switch (error.code) {
    case "NOT_FOUND":
      return { kind: "gone" };
    case "FORBIDDEN":
      return { kind: "forbidden" };
    case "BAD_REQUEST":
      return error.message === "word" ? { kind: "word" } : { kind: "failed", photoRemoved: false };
    case "SERVICE_UNAVAILABLE":
      return error.message === "storage"
        ? { kind: "storage" }
        : { kind: "failed", photoRemoved: false };
    default:
      return { kind: "failed", photoRemoved: error.message === "photo-removed" };
  }
}
