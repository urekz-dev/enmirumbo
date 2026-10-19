// The localities whose zones a user manages in the panel (ADR 0021;
// docs/specs/admin-review.md, "The admin can hide and rename the zones of a
// locality (v2)", "Inside the panel, a user can do only what their roles
// allow (v2)" and "The panel filters by locality, and the filter is hidden
// while there is one (v2)"). `zones.manage` decides, locality by locality: a
// global assignment grants it in every locality, active or not, and a
// locality assignment in its own. The zones screen shows one locality at a
// time; the filter offers the active ones, and only while there are two or
// more, but any locality of the user can be opened by its address, so a city
// that is not active yet can have its zones ready.
import { permittedLocalities } from "../access/queries.ts";
import type { Db } from "../db/client.ts";
import { panelLocalities, type PanelLocality } from "../review/localities.ts";

/** The localities where `email` may manage zones, by state and then municipality name. */
export async function zonesLocalities(db: Db, email: string): Promise<PanelLocality[]> {
  const granted = await permittedLocalities(db, email, ["zones.manage"]);
  return panelLocalities(db, [...(granted.get("zones.manage") ?? [])]);
}

/**
 * The locality the screen shows: the one a single `localidad` names among
 * `seen`; otherwise the first active one, or the first one. Null only when
 * `seen` is empty.
 */
export function chosenZonesLocality(
  values: readonly string[],
  seen: readonly PanelLocality[],
): PanelLocality | null {
  const named = values.length === 1 ? seen.find((locality) => locality.code === values[0]) : null;
  return named ?? seen.find((locality) => locality.active) ?? seen[0] ?? null;
}
