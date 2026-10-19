// The address of the zones screen of the panel (docs/specs/admin-review.md,
// "The admin can hide and rename the zones of a locality (v2)"):
//
//   /admin/colonias                       the zones of the default locality
//   /admin/colonias?localidad=<code>      the zones of one locality
//   …&listo=<zone id>#colonia-<zone id>   after a change to that zone
//
// `localidad` is the INEGI code of a locality where the user manages zones;
// `listo` names the zone a change just saved, whose row says so, and the
// fragment takes the admin back to it. Nothing a person typed travels in it.
// Pure.

export const ZONES_PATH = "/admin/colonias";

/** The id of the row of a zone, the fragment that leads to it. */
export function zoneAnchor(zoneId: number): string {
  return `colonia-${zoneId}`;
}

/** The screen, for one locality or the default one, after a change to `done` or not. */
export function zonesPath(locality: string | null = null, done: number | null = null): string {
  const params = new URLSearchParams();
  if (locality !== null) params.set("localidad", locality);
  if (done !== null) params.set("listo", String(done));
  const query = params.toString();
  const path = query === "" ? ZONES_PATH : `${ZONES_PATH}?${query}`;
  return done === null ? path : `${path}#${zoneAnchor(done)}`;
}

/**
 * Where a form of the screen posts: the screen of its locality, with the
 * query of the action (`?_action=admin.renameZone`, Astro's
 * `actions.admin.<name>.queryString`), so the page that renders the result
 * shows the same locality, and the action reads the locality from there.
 */
export function zonesFormAction(locality: string, actionQuery: string): string {
  const action = new URLSearchParams(actionQuery.replace(/^\?/, ""));
  const params = new URLSearchParams({ localidad: locality });
  for (const [key, value] of action) params.append(key, value);
  return `${ZONES_PATH}?${params}`;
}

/** A positive whole number written plainly, as a zone id is; null otherwise. */
export function parseZoneId(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= 2_147_483_647 ? id : null;
}
