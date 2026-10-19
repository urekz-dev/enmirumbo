// Applying and discarding a pending edit between Astro and the core
// (docs/specs/admin-review.md, "Applying the pending edit updates the
// published card and only that", "Discarding the pending edit requires a
// reason, does not touch the card and offers to notify by WhatsApp", "A
// pending edit is resolved only once and only if it is still the latest"
// and "Attending a report and resolving a pending edit are forms of their
// details, and their action checks everything again (v2)"). The forms of
// src/pages/admin/ediciones/[id].astro post to that same address with the
// actions `admin.applyEdit` and `admin.discardEdit` (src/actions/index.ts),
// which Astro runs before the page; the page then reads their results. So:
//
// - Each action decides only from that page: the edit is the one of the
//   page's address (`context.params`), never a field. Any other way to reach
//   it (another page, `/_actions/admin.applyEdit`) is not found, before
//   anything is read.
// - The outcome of the core travels to the page as an ActionError, whose
//   status Astro gives the page: 404 for an edit that does not exist or the
//   user may not see, 403 for a user who resolves edits nowhere, 409 when the
//   edit is no longer pending (resolved or superseded), when its card is no
//   longer published, or when another card has the number it proposes, 400
//   for the form's errors, named in the message (never anything the admin
//   wrote), and 500 when it could not be saved.
// - A resolution that saved answers a 303 to its own confirmation,
//   `/admin/ediciones/<n>/aplicada` or `/descartada`, which reads what was
//   stored, so a reload never resolves again.
import { ActionError } from "astro:actions";
import { cardPath } from "../core/business/card-path.ts";
import type { ApplyErrors, AppliedNotice, SubmitApplyOutcome } from "../core/review/apply.ts";
import type { SubmitDiscardOutcome } from "../core/review/discard.ts";
import type { ReasonError } from "../core/review/reason.ts";
import { absoluteUrl, type SiteVars } from "./site-url.ts";

/** The route of the detail of a pending edit, the only page whose submissions its resolutions take. */
export const EDIT_ROUTE = "/admin/ediciones/[id]";

/** What an action needs of its context. */
export interface EditActionContext {
  routePattern: string;
  params: Record<string, string | undefined>;
}

/**
 * The number of the edit a submission resolves, as the detail's address
 * writes it, or null when the action was reached any other way.
 */
export function editReviewTarget(context: EditActionContext): string | null {
  if (context.routePattern !== EDIT_ROUTE) return null;
  return context.params["id"] ?? null;
}

/** The error a resolution throws for what is common to both, or null. */
function resolutionError(outcome: { kind: string }): ActionError | null {
  switch (outcome.kind) {
    case "not-found":
      return new ActionError({ code: "NOT_FOUND" });
    case "forbidden":
      return new ActionError({ code: "FORBIDDEN", message: "No tienes acceso." });
    case "resolved":
    case "superseded":
    case "unpublished":
    case "taken":
      return new ActionError({ code: "CONFLICT", message: outcome.kind });
    default:
      return null;
  }
}

/** The error the apply throws for an outcome, or null when the edit was applied. */
export function applyActionError(outcome: SubmitApplyOutcome): ActionError | null {
  if (outcome.kind === "applied") return null;
  if (outcome.kind === "invalid") {
    return new ActionError({ code: "BAD_REQUEST", message: outcome.errors.zone ? "zone" : "" });
  }
  return resolutionError(outcome);
}

/** The error the discard throws for an outcome, or null when the edit was discarded. */
export function discardActionError(outcome: SubmitDiscardOutcome): ActionError | null {
  if (outcome.kind === "discarded") return null;
  if (outcome.kind === "invalid") {
    return new ActionError({ code: "BAD_REQUEST", message: outcome.error });
  }
  return resolutionError(outcome);
}

/** What the page does with an error of a resolution. */
export type EditFailure =
  /** The site's 404, as for an edit that does not exist. */
  | { kind: "not-found" }
  /** The panel's 403. */
  | { kind: "forbidden" }
  /**
   * The edit is no longer pending: the detail says, from its status, whether
   * it was resolved before or a newer one replaced it.
   */
  | { kind: "resolved" }
  | { kind: "superseded" }
  /** "No se aplicó nada: esta ficha ya no está publicada. …", the edit still pending. */
  | { kind: "unpublished" }
  /** "Ese número ya está en otra ficha: no se pudieron aplicar los cambios." */
  | { kind: "taken" }
  /** A form again, with its errors and what the admin chose or wrote, read from the submission. */
  | { kind: "apply"; errors: ApplyErrors }
  | { kind: "discard"; error: ReasonError }
  /**
   * The detail with "No se pudo guardar", nothing resolved. `keepsDraft` says
   * whether the action read the submission, so the page may read it again
   * for what the admin sent: not when Astro refused its body unread.
   */
  | { kind: "server"; keepsDraft: boolean };

const SERVER: EditFailure = { kind: "server", keepsDraft: false };
const CONFLICTS = new Set(["resolved", "superseded", "unpublished", "taken"]);
const REASON_ERRORS: ReadonlySet<string> = new Set<ReasonError>(["required", "too-long"]);

/** How the page answers an error of a resolution, `form` being the one that was sent. */
export function editFailure(error: ActionError, form: "apply" | "discard"): EditFailure {
  switch (error.code) {
    case "NOT_FOUND":
      return { kind: "not-found" };
    case "FORBIDDEN":
      return { kind: "forbidden" };
    case "CONFLICT":
      return CONFLICTS.has(error.message) ? ({ kind: error.message } as EditFailure) : SERVER;
    case "BAD_REQUEST":
      if (form === "apply") {
        return error.message === "zone" ? { kind: "apply", errors: { zone: "required" } } : SERVER;
      }
      return REASON_ERRORS.has(error.message)
        ? { kind: "discard", error: error.message as ReasonError }
        : SERVER;
    case "INTERNAL_SERVER_ERROR":
      // The resolution failed while saving, after its body was read.
      return { kind: "server", keepsDraft: true };
    default:
      return SERVER;
  }
}

/**
 * The card's public address for the notice of an applied edit, absolute
 * from SITE_URL; null when the site has no public origin (NO_SITE_URL).
 */
export function appliedCardUrl(vars: SiteVars, notice: AppliedNotice): string | null {
  return absoluteUrl(vars, cardPath(notice.locality, notice));
}
