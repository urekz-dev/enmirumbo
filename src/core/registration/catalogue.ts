// What the registration form of a locality offers, and what its submissions
// are checked against (docs/specs/business-registration.md, "Required and
// optional form fields" and "The zone options come from the active locality
// (v2)"): the 8 categories of the catalogue, in catalogue order, and the
// visible zones of the locality with their display names, in alphabetical
// order, the order the browser suggests them in. A hidden zone is not
// offered; its name still counts for the display names of the others, so
// hiding a zone never renames another (zoneDisplayNames).
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

/** The visible zones of `all`, with their display names, in alphabetical order. */
export function zoneOptions(
  all: readonly { id: number; slug: string; name: string; type: string; visible: boolean }[],
  localityName: string,
): ZoneOption[] {
  const names = zoneDisplayNames(all, localityName);
  return all
    .filter((zone) => zone.visible)
    .map(({ id, slug, name }) => ({ id, name: name.trim(), displayName: names.get(slug) ?? name }))
    .toSorted((a, b) => collator.compare(a.displayName, b.displayName));
}

/** The categories and the visible zones of `locality`. Two queries. */
export async function registrationCatalogue(
  db: Db,
  locality: Pick<ServedLocality, "code" | "name">,
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
      })
      .from(zones)
      .where(eq(zones.localityCode, locality.code)),
  ]);
  return { categories: categoryRows, zones: zoneOptions(zoneRows, locality.name) };
}
