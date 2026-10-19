// The slug rule of the catalogues (docs/specs/data-model.md, "The database
// holds only the reference data of the localities it serves (v2)" and
// "Catalogues of categories, zones and trades with stable slug (v2)"): a name
// becomes the segment of its public URLs as lowercase ASCII words joined by
// hyphens, without accents (`ñ` becomes `n`) and without punctuation. The data
// migrations hold the slugs of the reference data, and the tests check them
// against this rule; the panel derives with it the slug of a zone an admin
// adds (src/core/zones/), which never changes afterwards. Pure.
import { SLUG_PATTERN } from "../db/schema/checks.ts";

const SLUG = new RegExp(SLUG_PATTERN);

/**
 * The slug of `name`, or null when a letter of it cannot be written in ASCII
 * ("ß", "ø") or nothing of it is left: such a letter is never dropped
 * silently.
 */
export function slugOf(name: string): string | null {
  const slug = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\p{Pd}/gu, " ")
    .replace(/[\p{P}\p{S}]/gu, "")
    .trim()
    .split(/\s+/)
    .join("-");
  return SLUG.test(slug) ? slug : null;
}

/** The slug of `name`; throws where `slugOf` gives null, naming it. */
export function slugify(name: string): string {
  const slug = slugOf(name);
  if (slug === null) throw new Error(`no slug for "${name}"`);
  return slug;
}
