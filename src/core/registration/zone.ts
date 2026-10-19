// The postal code and the zone of a registration
// (docs/specs/business-registration.md, "The zone is chosen from the zones of
// the postal code the business types, or written when it does not appear
// (v2)"). The form asks for the postal code first, then offers the visible
// zones of the locality in a select, grouped by postal code, which its
// script narrows to the postal code typed; the select ends with "Mi colonia
// no aparece", which keeps the name the business writes as the free text of
// "Otra", pending the admin's normalization. A submission names a zone by its
// slug, and only a zone the form offers counts, so no submission can link a
// business to a zone of another locality or to a hidden zone. Pure.

/** A zone the registration offers: a visible zone of the locality (or the edit's own). */
export interface ZoneOption {
  id: number;
  /** What the select sends: unique in the locality, and it never changes. */
  slug: string;
  /** Its name, as stored. */
  name: string;
  /** The name it is shown with (zoneDisplayNames): unique in the locality. */
  displayName: string;
  /** Its postal code, or null for a zone the admin added before zones had one. */
  postalCode: string | null;
}

/**
 * What the select sends for "Mi colonia no aparece". It cannot be a slug
 * (SLUG_PATTERN has no underscore), so no zone can take it.
 */
export const OTHER_ZONE = "_otra";

/** The zones of one postal code, as the select groups them; null for those without one. */
export interface PostalCodeGroup {
  postalCode: string | null;
  zones: ZoneOption[];
}

/**
 * The zones grouped by postal code, in the order of the codes, each group in
 * the order the zones came in (alphabetical, from registrationCatalogue);
 * the zones without a postal code go last.
 */
export function postalCodeGroups(zones: readonly ZoneOption[]): PostalCodeGroup[] {
  const groups = [...Map.groupBy(zones, (zone) => zone.postalCode)].map(([postalCode, list]) => ({
    postalCode,
    zones: list,
  }));
  return groups.toSorted((a, b) =>
    a.postalCode === null ? 1 : b.postalCode === null ? -1 : a.postalCode < b.postalCode ? -1 : 1,
  );
}

/**
 * Whether `zone` is one of `postalCode`'s. A zone without a postal code
 * cannot be checked, so it belongs to any.
 */
export function zoneHasPostalCode(zone: ZoneOption, postalCode: string): boolean {
  return zone.postalCode === null || zone.postalCode === postalCode;
}

/**
 * Where a registration is: a catalogue zone, or the free text of "Otra",
 * pending the admin's normalization. Never both: the free text of a
 * catalogue zone is not kept.
 */
export type ZoneChoice = { zoneId: number; zoneOther: null } | { zoneId: null; zoneOther: string };

/** Why the zone of a submission is not one. */
export type ZoneProblem =
  /** No zone chosen, or one the form does not offer. */
  | { field: "zone"; code: "required" }
  /** A zone of another postal code than the one typed. */
  | { field: "zone"; code: "postal-code" }
  /** "Mi colonia no aparece" without its name, or with one past its limit. */
  | { field: "zoneOther"; code: "required" | "length" };

/**
 * The zone a submission chose among `zones`: `value` is what the select
 * sent, a slug or OTHER_ZONE; `other` the name written for "Mi colonia no
 * aparece", trimmed; `postalCode` the postal code typed, when it is one, or
 * null. A zone of another postal code is refused only once the postal code
 * is one; the postal code's own error is the caller's.
 */
export function chooseZone(
  value: string,
  other: string,
  postalCode: string | null,
  zones: readonly ZoneOption[],
  maxOtherLength: number,
): ZoneChoice | ZoneProblem {
  if (value === OTHER_ZONE) {
    if (other === "") return { field: "zoneOther", code: "required" };
    if (other.length > maxOtherLength) return { field: "zoneOther", code: "length" };
    return { zoneId: null, zoneOther: other };
  }
  const zone = value === "" ? undefined : zones.find(({ slug }) => slug === value);
  if (zone === undefined) return { field: "zone", code: "required" };
  if (postalCode !== null && !zoneHasPostalCode(zone, postalCode)) {
    return { field: "zone", code: "postal-code" };
  }
  return { zoneId: zone.id, zoneOther: null };
}
