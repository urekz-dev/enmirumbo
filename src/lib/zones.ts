// The forms of the zones screen between Astro and the core
// (docs/specs/admin-review.md, "The admin can hide and rename the zones of a
// locality (v2)" and "The admin can add a zone to a locality (v2)"). The
// forms of src/pages/admin/colonias.astro post to the screen of their
// locality, `/admin/colonias?localidad=<code>&_action=admin.<name>`
// (zonesFormAction), with the actions under `admin` of src/actions/index.ts,
// which Astro runs before the page; the page then reads their result. So:
//
// - An action only takes submissions of that page, and the locality is the
//   one the page's address names, never a field of the submission. The zone
//   a rename or a hide is about is a field, and it must be a zone of that
//   locality. Anything else is not found, as is a locality where the user
//   may not manage zones.
// - A change saved answers the page with the zone it touched, and the page
//   sends a 303 to the screen with that zone's row confirming it, so a
//   reload never sends the form again. A form with errors comes back as the
//   action's data, not as an ActionError, because what is wrong names the
//   zone, the URL or the page it clashes with; the page renders the form
//   again from the same submission, with a 400.
import { ActionError } from "astro:actions";
import { formText } from "../core/forms/text.ts";
import type { ZoneWriteOutcome } from "../core/zones/manage.ts";
import { parseZoneId } from "../core/zones/paths.ts";
import { cleanZoneName, type ZoneFormErrors } from "../core/zones/rules.ts";

/** The route of the zones screen, the only page whose submissions the actions take. */
export const ZONES_ROUTE = "/admin/colonias";

/** The names of the fields of the zones forms. */
export const ZONE_FIELDS = {
  zone: "zone",
  visible: "visible",
  name: "name",
  type: "type",
  postalCode: "postalCode",
} as const;

/** What an action needs of its context. */
export interface ZonesActionContext {
  routePattern: string;
  url: URL;
}

/**
 * The locality a submission is about: the INEGI code in the address of the
 * zones screen, or null when the action was reached any other way, or the
 * address names no locality, or names it twice.
 */
export function zonesActionLocality(context: ZonesActionContext): string | null {
  if (context.routePattern !== ZONES_ROUTE) return null;
  const values = context.url.searchParams.getAll("localidad");
  if (values.length !== 1) return null;
  const [code = ""] = values;
  return /^[0-9]{5}$/.test(code) ? code : null;
}

/** The zone a hide, a show or a rename is about, or null. */
export function submittedZone(form: FormData): number | null {
  return parseZoneId(formText(form, ZONE_FIELDS.zone).trim());
}

/** Whether a submission asks to show (true) or hide (false) the zone; null for neither. */
export function submittedVisibility(form: FormData): boolean | null {
  const value = formText(form, ZONE_FIELDS.visible).trim();
  return value === "true" ? true : value === "false" ? false : null;
}

/** The name a submission typed, clean (cleanZoneName). */
export function submittedName(form: FormData): string {
  return cleanZoneName(formText(form, ZONE_FIELDS.name));
}

/** The settlement type a submission chose. */
export function submittedType(form: FormData): string {
  return formText(form, ZONE_FIELDS.type).trim();
}

/** The postal code a submission typed, trimmed. */
export function submittedPostalCode(form: FormData): string {
  return formText(form, ZONE_FIELDS.postalCode).trim();
}

/** What an action answers the page with, when it does not throw. */
export type ZoneActionData =
  | { kind: "done"; zoneId: number }
  | { kind: "invalid"; errors: ZoneFormErrors };

/** The answer of an action for an outcome of the core: not found throws. */
export function zoneActionData(outcome: ZoneWriteOutcome): ZoneActionData {
  if (outcome.kind === "not-found") throw new ActionError({ code: "NOT_FOUND" });
  return outcome;
}
