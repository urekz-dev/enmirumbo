// The addresses of the edit mode (docs/specs/business-registration.md, "The
// management link opens the card in edit mode with the same prefilled form"
// and "The edit mode of a locality lives under it, and lands on its
// confirmation (v2)"; docs/specs/base-layout.md, "The admin panel and the edit
// mode stay out of the measurement by where they live (v2)"). The management
// link of a card is `/{estado}/{municipio}/editar/<token>`, and the
// confirmation after its changes are received
// `/{estado}/{municipio}/editar/gracias`, which carries no token. `editar` is
// a reserved segment (src/core/catalogue/root-urls.ts). Everything at
// `/{estado}/{municipio}/editar/` and below is the edit mode, wherever it
// leads: it is never measured, never indexed and lets no path leave as a
// referrer (src/lib/edit-mode.ts); robots.txt never names it.
import { localityPath, type LocalityRef } from "../locality/paths.ts";

/** The segment of the edit mode under a locality. */
export const EDIT_SEGMENT = "editar";

/** The segment of the confirmation, under EDIT_SEGMENT. No token is ever `gracias`. */
export const EDIT_THANKS_SEGMENT = "gracias";

/**
 * The management link of a card of `locality`, as a path:
 * `/{estado}/{municipio}/editar/<token>`. Only the confirmation of an issued
 * link in the panel (epic F) and the edit page's own form build it; no public
 * page links to it.
 */
export function editPath(locality: LocalityRef, token: string): string {
  return localityPath(locality, EDIT_SEGMENT, token);
}

/** The confirmation after the changes of a card of `locality` were received. */
export function editThanksPath(locality: LocalityRef): string {
  return localityPath(locality, EDIT_SEGMENT, EDIT_THANKS_SEGMENT);
}
