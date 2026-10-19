// What the panel checks before it adds or renames a zone of a locality
// (docs/specs/admin-review.md, "The admin can hide and rename the zones of a
// locality (v2)" and "The admin can add a zone to a locality (v2)";
// docs/specs/data-model.md, "Catalogues of categories, zones and trades with
// stable slug (v2)", "The slugs of the catalogues do not produce ambiguous
// URLs at the root of a locality (v2)"; docs/specs/public-directory.md, "A
// zone whose name repeats in its locality is shown with its settlement type
// (v2)"). Pure: src/core/zones/manage.ts reads the catalogues and writes.
//
// - A name is what a person reads: trimmed, its spaces collapsed, at most 80
//   characters, with a letter or a digit.
// - A new zone takes its slug from its name with the catalogues' slug rule
//   (src/core/catalogue/slug.ts), unique within its locality, hidden zones
//   included, and the slug never changes afterwards, not even on a rename.
// - A new slug must not make a URL of the locality read in two ways: the same
//   check the tests run on the migrated catalogues (`rootUrlConflicts`, with
//   the reserved segments of `RESERVED_SEGMENTS`), run here on the
//   catalogues as they are plus the new zone.
// - After the change, no two zones of the locality may be shown with the same
//   name (`zoneDisplayNames`, compared as the site compares zone names), or
//   a resident could not tell them apart and the registration could not
//   choose between them.
import { MAX_SEGMENT_LENGTH } from "../catalogue/pages.ts";
import {
  type CatalogueEntry,
  type LocalityCatalogues,
  type RootReading,
  rootUrlConflicts,
} from "../catalogue/root-urls.ts";
import { slugOf } from "../catalogue/slug.ts";
import { type TypedZone, zoneDisplayNames } from "../catalogue/zone-names.ts";
import { normalizeText } from "../search/normalize.ts";

/** The longest name of a zone, as the registration bounds the zone a business types. */
export const MAX_ZONE_NAME_LENGTH = 80;

/** What else a URL of the new zone would read as. */
export type ConflictingPage =
  | { kind: "reserved" }
  | { kind: "category" | "trade" | "zone"; name: string }
  | { kind: "trade+zone"; trade: string; zone: string };

/** Why a name cannot be a zone's. */
export type NameProblem =
  | { kind: "required" | "too-long" | "no-letters" | "no-slug" }
  /** Another zone of the locality, hidden or renamed ones included, has its slug. */
  | { kind: "slug-taken"; slug: string; zone: string }
  /**
   * A URL of the locality would read in two ways: `segment`, the zone's own
   * (`trade` null) or that of a trade in the zone, would also be `other`.
   */
  | { kind: "url-conflict"; segment: string; trade: string | null; other: ConflictingPage }
  /** Two zones of the locality would be shown as `displayName`. */
  | { kind: "display-clash"; displayName: string };

/** The errors of a form of the zones screen, by field. */
export interface ZoneFormErrors {
  name?: NameProblem;
  /** The settlement type of a new zone: none, or one the locality does not use. */
  type?: { kind: "required" };
}

/** A zone as these checks see it. */
export interface ZoneRow extends TypedZone {
  id: number;
}

/**
 * A name as the panel stores it: control and format characters (a line
 * break, a right-to-left override) become spaces, and the spaces are
 * collapsed and trimmed, as the zones of SEPOMEX are.
 */
export function cleanZoneName(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What is wrong with a clean name on its own, or null. */
export function nameProblem(name: string): NameProblem | null {
  if (name === "") return { kind: "required" };
  if (name.length > MAX_ZONE_NAME_LENGTH) return { kind: "too-long" };
  if (normalizeText(name) === "") return { kind: "no-letters" };
  return null;
}

/** Equal display names, compared as the site compares zone names, with their slugs. */
function sharedDisplayNames(zones: readonly TypedZone[], localityName: string) {
  const names = zoneDisplayNames(zones, localityName);
  const bySameName = new Map<string, string[]>();
  for (const { slug } of zones) {
    const key = normalizeText(names.get(slug) ?? "");
    bySameName.set(key, [...(bySameName.get(key) ?? []), slug]);
  }
  return {
    names,
    shared: [...bySameName].filter(([, slugs]) => slugs.length > 1),
  };
}

/**
 * Whether the zones of a locality, once `changed` replaces the zone of its
 * slug or joins them, show two zones with the same name; null when they do
 * not. A pair the zones already shared before the change is not this
 * change's doing, so it does not stop it.
 */
export function displayClash(
  zones: readonly TypedZone[],
  localityName: string,
  changed: TypedZone,
): NameProblem | null {
  const before = sharedDisplayNames(zones, localityName).shared;
  const after = [...zones.filter(({ slug }) => slug !== changed.slug), changed];
  const { names, shared } = sharedDisplayNames(after, localityName);
  const existed = new Set(before.map(([key, slugs]) => `${key}\n${slugs.toSorted().join(" ")}`));
  const fresh = shared.filter(
    ([key, slugs]) => !existed.has(`${key}\n${slugs.toSorted().join(" ")}`),
  );
  if (fresh.length === 0) return null;
  const [, slugs = []] = fresh.find(([, s]) => s.includes(changed.slug)) ?? fresh[0] ?? [];
  const shown = slugs.includes(changed.slug) ? changed.slug : (slugs[0] ?? changed.slug);
  return { kind: "display-clash", displayName: names.get(shown) ?? changed.name };
}

/** The page a reading names, as the admin is told about it. */
function conflictingPage(
  reading: RootReading,
  names: ReadonlyMap<string, string>,
): ConflictingPage {
  switch (reading.kind) {
    case "reserved":
      return { kind: "reserved" };
    case "trade+zone":
      return {
        kind: "trade+zone",
        trade: reading.trade.name,
        zone: names.get(reading.zone.slug) ?? reading.zone.name,
      };
    case "zone":
      return { kind: "zone", name: names.get(reading.entry.slug) ?? reading.entry.name };
    default:
      return { kind: reading.kind, name: reading.entry.name };
  }
}

/**
 * Whether the new zone `zone` makes a URL of its locality read in two ways,
 * with the catalogues as they are (`catalogues`, the locality's zones hidden
 * ones included) plus the new zone; null when every URL still reads in one
 * way. Only the readings of the new zone count: the catalogues the
 * migrations leave pass the same check in the tests.
 */
export function urlConflict(
  catalogues: LocalityCatalogues,
  zone: CatalogueEntry,
  names: ReadonlyMap<string, string> = new Map(),
): NameProblem | null {
  const isNew = (reading: RootReading) =>
    (reading.kind === "zone" && reading.entry.slug === zone.slug) ||
    (reading.kind === "trade+zone" && reading.zone.slug === zone.slug);
  const conflict = rootUrlConflicts({
    ...catalogues,
    zones: [...catalogues.zones, zone],
  }).find(({ readings }) => readings.some(isNew));
  if (conflict === undefined) return null;
  const own = conflict.readings.find(isNew);
  const other = conflict.readings.find((reading) => !isNew(reading));
  return {
    kind: "url-conflict",
    segment: conflict.segment,
    trade: own?.kind === "trade+zone" ? own.trade.name : null,
    other: other === undefined ? { kind: "reserved" } : conflictingPage(other, names),
  };
}

/** The catalogues a new zone of a locality is checked against. */
export interface NewZoneContext {
  /** Every zone of the locality, hidden ones included. */
  zones: readonly ZoneRow[];
  /** The name of the locality, which a zone named like it is told apart from. */
  localityName: string;
  /** The global catalogues that share the URLs of the locality. */
  categories: readonly CatalogueEntry[];
  trades: readonly CatalogueEntry[];
  /** The settlement types a new zone may take: those the locality's zones have. */
  types: readonly string[];
}

/** A new zone that passed every check, or the errors of its form. */
export type NewZoneCheck =
  | { ok: true; zone: { name: string; type: string; slug: string } }
  | { ok: false; errors: ZoneFormErrors };

/** What is wrong with the name of a new zone, after its own rules. */
function newNameProblem(name: string, context: NewZoneContext, type: string | null) {
  const own = nameProblem(name);
  if (own !== null) return { problem: own };
  const slug = slugOf(name);
  if (slug === null) return { problem: { kind: "no-slug" } as const };
  const names = zoneDisplayNames(context.zones, context.localityName);
  const taken = context.zones.find((zone) => zone.slug === slug);
  if (taken !== undefined) {
    return {
      problem: {
        kind: "slug-taken",
        slug,
        zone: names.get(taken.slug) ?? taken.name,
      } as const,
    };
  }
  // A trade and the zone make one segment, which must stay one the route reads.
  const longestTrade = Math.max(0, ...context.trades.map((trade) => trade.slug.length));
  if (longestTrade + 1 + slug.length > MAX_SEGMENT_LENGTH) {
    return { problem: { kind: "too-long" } as const };
  }
  const conflict = urlConflict(
    { categories: context.categories, trades: context.trades, zones: context.zones },
    { name, slug },
    names,
  );
  if (conflict !== null) return { problem: conflict };
  // Without a valid type, the display name waits for one.
  const clash =
    type === null ? null : displayClash(context.zones, context.localityName, { slug, name, type });
  return clash === null ? { slug } : { problem: clash };
}

/** The checks of a new zone, named `name` with the settlement type `type`. */
export function checkNewZone(name: string, type: string, context: NewZoneContext): NewZoneCheck {
  const validType = context.types.includes(type) ? type : null;
  const named = newNameProblem(name, context, validType);
  const errors: ZoneFormErrors = {};
  if ("problem" in named) errors.name = named.problem;
  if (validType === null) errors.type = { kind: "required" };
  if ("slug" in named && validType !== null) {
    return { ok: true, zone: { name, type: validType, slug: named.slug } };
  }
  return { ok: false, errors };
}

/**
 * The checks of a rename of `zone` to `name`, among every zone of its
 * locality: the name on its own, then the display names. Its slug, and so
 * its URLs, stay as they are.
 */
export function checkRename(
  zone: TypedZone,
  name: string,
  zones: readonly TypedZone[],
  localityName: string,
): NameProblem | null {
  return nameProblem(name) ?? displayClash(zones, localityName, { ...zone, name });
}

/** A form of the zones screen that comes back with its errors, and what it had. */
export type ZonesFailure =
  | { form: "add"; errors: ZoneFormErrors; name: string; type: string }
  | { form: "rename"; zoneId: number; errors: ZoneFormErrors; name: string }
  /** A submission the screen could not save for a reason of its own. */
  | { form: "general" };
