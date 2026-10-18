// The addresses of the registration (docs/specs/business-registration.md,
// "The registration page of a locality lives under it, and lands on its
// thank-you page (v2)"): the form of a locality is `/{estado}/{municipio}/registro`
// and its thank-you page `/{estado}/{municipio}/registro/gracias`, both
// without a query, so nothing a person wrote can ever travel in them.
// `registro` is a reserved segment (src/core/catalogue/root-urls.ts), and
// robots.txt keeps the thank-you page out of search engines
// (LOCALITY_DISALLOW, src/lib/robots.ts); the form itself is indexable and in
// the sitemap (src/core/seo/sitemap.ts).
import { localityPath, type LocalityRef } from "../locality/paths.ts";

/** The segment of the registration form, and the first of its thank-you page. */
export const REGISTRATION_SEGMENT = "registro";

/** The segment of the thank-you page, under REGISTRATION_SEGMENT. */
export const REGISTRATION_THANKS_SEGMENT = "gracias";

/** The registration form of `locality`. */
export function registrationPath(locality: LocalityRef): string {
  return localityPath(locality, REGISTRATION_SEGMENT);
}

/** The thank-you page after a registration in `locality`. */
export function registrationThanksPath(locality: LocalityRef): string {
  return localityPath(locality, REGISTRATION_SEGMENT, REGISTRATION_THANKS_SEGMENT);
}
