// What the registration form of a locality offers, and what its submissions
// are checked against (docs/specs/business-registration.md, "Required and
// optional form fields", "The zone options come from the active locality
// (v2)" and "The zone is chosen from the zones of the postal code the
// business types, or written when it does not appear (v2)"): the 8
// categories of the catalogue, in catalogue order, and the visible zones of
// the locality with their display names and postal codes, in alphabetical
// order, the order the form lists each postal code's zones in. A hidden zone
// is not offered; its name still counts for the display names of the others,
// so hiding a zone never renames another (zoneDisplayNames).
//
// Binding: the page reads it on HYPERDRIVE, the cached binding of public
// reads; the action reads it on HYPERDRIVE_FRESH, in the connection it saves
// with.
import { asc, eq } from "drizzle-orm";
import { zoneDisplayNames } from "../catalogue/zone-names.ts";
import type { Db } from "../db/client.ts";
import { categories, zones } from "../db/schema/index.ts";
import type { ServedLocality } from "../locality/served.ts";
import type { ZoneOption } from "./zone.ts";

/** A category of the form: its slug is what the form sends. */
export interface CategoryOption {
  id: number;
  name: string;
  slug: string;
}

export interface RegistrationCatalogue {
  categories: readonly CategoryOption[];
  zones: readonly ZoneOption[];
}

const collator = new Intl.Collator("es-MX", { sensitivity: "base", numeric: true });

/**
 * The visible zones of `all`, with their display names, in alphabetical
 * order; and the zones of `alsoZoneIds` even when hidden: the edit of a card
 * offers the zone the card already has, so a field left as it was keeps it.
 */
export function zoneOptions(
  all: readonly {
    id: number;
    slug: string;
    name: string;
    type: string;
    visible: boolean;
    postalCode: string | null;
  }[],
  localityName: string,
  alsoZoneIds: readonly (number | null)[] = [],
): ZoneOption[] {
  const names = zoneDisplayNames(all, localityName);
  return all
    .filter((zone) => zone.visible || alsoZoneIds.includes(zone.id))
    .map(({ id, slug, name, postalCode }) => ({
      id,
      slug,
      name: name.trim(),
      displayName: names.get(slug) ?? name,
      postalCode,
    }))
    .toSorted((a, b) => collator.compare(a.displayName, b.displayName));
}

/**
 * The categories and the visible zones of `locality`, and the zones of
 * `alsoZoneIds` among them even when hidden (zoneOptions). Two queries.
 */
export async function registrationCatalogue(
  db: Db,
  locality: Pick<ServedLocality, "code" | "name">,
  alsoZoneIds: readonly (number | null)[] = [],
): Promise<RegistrationCatalogue> {
  const [categoryRows, zoneRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories)
      .orderBy(asc(categories.id)),
    db
      .select({
        id: zones.id,
        slug: zones.slug,
        name: zones.name,
        type: zones.type,
        visible: zones.visible,
        postalCode: zones.postalCode,
      })
      .from(zones)
      .where(eq(zones.localityCode, locality.code)),
  ]);
  return { categories: categoryRows, zones: zoneOptions(zoneRows, locality.name, alsoZoneIds) };
}
