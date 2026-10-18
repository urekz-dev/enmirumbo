// The zone of a registration, from what the owner typed
// (docs/specs/business-registration.md, "The zone is typed with the
// locality's zones as suggestions, and a name that is none of them is kept as
// "Otra" (v2)"). The field is a text input whose suggestions are the visible
// zones of the locality by their display name (a `datalist`, with no
// JavaScript of the site), so typing "hacien" offers "Haciendas de Tizayuca".
// What arrives is text, never an identifier, so a submission can only ever
// name a zone of the page's locality. Pure.
import { normalizeText } from "../search/normalize.ts";

/** A zone the registration offers: a visible zone of the locality. */
export interface ZoneOption {
  id: number;
  /** Its name, as stored. */
  name: string;
  /** The name it is shown with (zoneDisplayNames): unique in the locality. */
  displayName: string;
}

/**
 * Where a registration is: a catalogue zone, or the free text of "Otra",
 * pending the admin's normalization. Never both: the free text of a
 * catalogue zone is not kept.
 */
export type ZoneChoice = { zoneId: number; zoneOther: null } | { zoneId: null; zoneOther: string };

/** The one zone whose `key`, normalized, is `typed`, or null for none or several. */
function only(
  zones: readonly ZoneOption[],
  typed: string,
  key: (zone: ZoneOption) => string,
): ZoneOption | null {
  const found = zones.filter((zone) => normalizeText(key(zone)) === typed);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * The zone `text` names among `zones`, compared as the site compares zone
 * names, ignoring case, accents and punctuation (normalizeText): first by
 * display name ("El Carmen (Fraccionamiento)"), then by name, when exactly
 * one zone has it, as when the zone that shares its name is hidden. A text
 * that names no zone, or several, is "Otra" with that text, trimmed, for the
 * admin to normalize. `text` is not empty.
 */
export function chooseZone(text: string, zones: readonly ZoneOption[]): ZoneChoice {
  const typed = normalizeText(text);
  const zone =
    typed === ""
      ? null
      : (only(zones, typed, (z) => z.displayName) ?? only(zones, typed, (z) => z.name));
  return zone === null
    ? { zoneId: null, zoneOther: text.trim() }
    : { zoneId: zone.id, zoneOther: null };
}
