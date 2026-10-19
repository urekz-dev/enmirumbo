// The localities of the panel's review screens (ADR 0006; docs/specs/
// admin-review.md, "The panel filters by locality, and the filter is hidden
// while there is one (v2)" and "Dates in the panel use the time zone of the
// locality (v2)"): the name and time zone of each locality a user sees, the
// options of the locality filter, and the display names of their zones.
//
// There is one panel for every locality. The queue and the list accept a
// locality filter, `?localidad=<INEGI code>`, whose options are the active
// localities the user sees in that screen; it is shown only with two or more
// of them, so while one locality is active nobody sees it. A value that is
// not one of its options, empty or repeated, is no filter at all.
import { asc, eq, inArray } from "drizzle-orm";
import {
  type ShowsZone,
  type ZoneNames,
  withZoneName,
  zoneDisplayNames,
} from "../catalogue/zone-names.ts";
import type { Db } from "../db/client.ts";
import { localities, municipalities, states, zones } from "../db/schema/index.ts";
import { otherZoneText } from "./texts.ts";

export interface PanelLocality {
  /** INEGI code of the municipality. */
  code: string;
  name: string;
  stateName: string;
  /** IANA time zone, in which the panel writes the dates of its cards. */
  timeZone: string;
  active: boolean;
}

/** The localities of `codes`, by state and then municipality name. */
export async function panelLocalities(db: Db, codes: readonly string[]): Promise<PanelLocality[]> {
  if (codes.length === 0) return [];
  return db
    .select({
      code: localities.code,
      name: municipalities.name,
      stateName: states.name,
      timeZone: localities.timeZone,
      active: localities.active,
    })
    .from(localities)
    .innerJoin(municipalities, eq(municipalities.code, localities.code))
    .innerJoin(states, eq(states.code, municipalities.stateCode))
    .where(inArray(localities.code, [...codes]))
    .orderBy(asc(states.name), asc(municipalities.name), asc(localities.code));
}

/** The options of the locality filter: the active ones, shown only with two or more. */
export function localityFilterOptions(seen: readonly PanelLocality[]): PanelLocality[] {
  const active = seen.filter((locality) => locality.active);
  return active.length >= 2 ? active : [];
}

/**
 * The locality a `localidad` value chooses among the filter's options, or
 * null for every locality: no value, a repeated or empty one, or one that is
 * not an option (another user's locality, an inactive one, junk).
 */
export function chosenLocality(
  values: readonly string[],
  options: readonly PanelLocality[],
): string | null {
  if (values.length !== 1) return null;
  const [value] = values;
  return options.some((locality) => locality.code === value) ? (value ?? null) : null;
}

/**
 * The display name of every zone of each of `seen`, by locality code and
 * slug, as the public pages show them (public-directory, "A zone whose name
 * repeats in its locality is shown with its settlement type (v2)"), so the
 * admin tells apart the two "El Carmen" as residents do. One query.
 */
export async function zoneNamesByLocality(
  db: Db,
  seen: readonly PanelLocality[],
): Promise<ReadonlyMap<string, ZoneNames>> {
  if (seen.length === 0) return new Map();
  const rows = await db
    .select({
      localityCode: zones.localityCode,
      slug: zones.slug,
      name: zones.name,
      type: zones.type,
    })
    .from(zones)
    .where(
      inArray(
        zones.localityCode,
        seen.map((locality) => locality.code),
      ),
    );
  return new Map(
    seen.map((locality) => [
      locality.code,
      zoneDisplayNames(
        rows.filter((row) => row.localityCode === locality.code),
        locality.name,
      ),
    ]),
  );
}

/** `rows` with the display name of each catalogue zone, read from the zones of its locality. */
export function withZoneNames<Row extends ShowsZone & { localityCode: string }>(
  rows: readonly Row[],
  byLocality: ReadonlyMap<string, ZoneNames>,
): Row[] {
  return rows.map((row) => {
    const names = byLocality.get(row.localityCode);
    return names === undefined ? row : withZoneName(row, names);
  });
}

/** What says where a card or an edit is: its catalogue zone, or the free text of "Otra". */
export interface ZoneOfCard {
  zoneSlug: string | null;
  zoneName: string | null;
  zoneOther: string | null;
}

/**
 * The zone of a detail as the admin reads it: the catalogue zone by its
 * display name, or the free text of "Otra", exactly as the business wrote
 * it, marked as pending normalization; null when there is neither.
 */
export function zoneText(card: ZoneOfCard, names: ZoneNames | undefined): string | null {
  if (card.zoneSlug !== null) return names?.get(card.zoneSlug) ?? card.zoneName;
  const other = card.zoneOther?.trim() ?? "";
  return other === "" ? null : otherZoneText(other);
}
