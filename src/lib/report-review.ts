// "Marcar como atendido" between Astro and the core
// (docs/specs/admin-review.md, "Marking a report as attended, only once" and
// "Attending a report and resolving a pending edit are forms of their
// details, and their action checks everything again (v2)"). Each pending
// report of the detail of a card, src/pages/admin/registros/[id].astro, has
// its form, which posts to that same address with the action
// `admin.attendReport` (src/actions/index.ts) and names its report in a
// field; Astro runs the action before the page, and the page reads its
// result. So:
//
// - The action decides only from that page: the card is the one of the
//   page's address (reviewTarget, ./review.ts), never a field, and the
//   report must be one of that card.
// - The outcome travels to the page as an ActionError, whose status Astro
//   gives the page: 404 for a card the user may not see, or a report that
//   does not exist or is of another card (the same answer for both); 403 for
//   a card the user sees but whose reports they may not attend; 409 for a
//   report attended before. A marking that saved answers the page itself,
//   which paints the detail again with "Reporte atendido.": the confirmation
//   is the answer to the marking's own submission, so a detail opened any
//   other way paints no notice, and sending it again, by reloading, finds
//   the report attended and says so, writing nothing.
import { ActionError } from "astro:actions";
import type { AttendOutcome } from "../core/review/attend.ts";

/** The error the marking throws for an outcome, or null when the report was attended now. */
export function attendActionError(outcome: AttendOutcome): ActionError | null {
  switch (outcome.kind) {
    case "attended":
      return null;
    case "already-attended":
      return new ActionError({ code: "CONFLICT", message: "attended" });
    case "forbidden":
      return new ActionError({ code: "FORBIDDEN", message: "No tienes acceso." });
    case "not-found":
      return new ActionError({ code: "NOT_FOUND" });
  }
}

/** What the page does with an error of a marking. */
export type AttendFailure =
  /** The site's 404, as for a card or report that does not exist. */
  | { kind: "not-found" }
  /** The panel's 403. */
  | { kind: "forbidden" }
  /** "Este reporte ya lo habías atendido." */
  | { kind: "already-attended" }
  /** The detail with "No se pudo guardar", nothing marked. */
  | { kind: "server" };

/** How the page answers an error of a marking. */
export function attendFailure(error: ActionError): AttendFailure {
  switch (error.code) {
    case "NOT_FOUND":
      return { kind: "not-found" };
    case "FORBIDDEN":
      return { kind: "forbidden" };
    case "CONFLICT":
      return error.message === "attended" ? { kind: "already-attended" } : { kind: "server" };
    default:
      return { kind: "server" };
  }
}
