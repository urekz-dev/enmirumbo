// The panel form posts only from its own page, with its card in the address.
import { ActionError } from "astro:actions";
import type { RectificationOutcome } from "../core/review/rectification.ts";
import { registrationActionError } from "./registration.ts";

export const RECTIFICATION_ROUTE = "/admin/registros/[id]/editar";
export function rectificationTarget(context: {
  routePattern: string;
  params: Record<string, string | undefined>;
}): string | null {
  return context.routePattern === RECTIFICATION_ROUTE ? (context.params["id"] ?? null) : null;
}

export function rectificationActionError(outcome: RectificationOutcome): ActionError | null {
  if (outcome.kind === "saved") return null;
  if (outcome.kind === "not-found") return new ActionError({ code: "NOT_FOUND" });
  if (outcome.kind === "forbidden") return new ActionError({ code: "FORBIDDEN" });
  return registrationActionError(outcome);
}
