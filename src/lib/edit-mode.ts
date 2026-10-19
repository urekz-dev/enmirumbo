// The edit mode of the management link, by where it lives
// (docs/specs/business-registration.md, "A token that is not exactly the
// current one opens nothing and gives nothing away" and "The edit mode of a
// locality lives under it, and lands on its confirmation (v2)";
// docs/specs/base-layout.md, "The measurement carries no personal data or
// text typed by people" and "The admin panel and the edit mode stay out of
// the measurement by where they live (v2)"). Its address carries the token,
// the key to a card, so everything at `/{estado}/{municipio}/editar/` and
// below, whatever its case or URL encoding and also an address there that
// does not exist, is the edit mode, and every response of it:
//
// - lets no path leave as a referrer: `Referrer-Policy: strict-origin`, the
//   panel's, which sends at most the site's origin, even to the site's own
//   pages (the privacy notice, the home), and keeps the `Origin` of the form's
//   submission, which the form needs without JavaScript (src/lib/
//   security-headers.ts); the layout declares the same in a `<meta>`;
// - asks not to be indexed nor followed: `X-Robots-Tag: noindex, nofollow`,
//   and the same `<meta name="robots">` in the layout;
// - is never stored by a cache: `Cache-Control: no-store`, since the page
//   shows a card's data and what its owner wrote;
// - is never measured (src/lib/analytics.ts).
//
// The same headers on every response of the edit mode, a page, its
// confirmation, a redirect or a 404, so an address that does not open a card
// answers exactly as any other there. robots.txt never names the edit mode.
import { EDIT_SEGMENT } from "../core/edit/paths.ts";
import { LOCALITY_ROUTE } from "./locality.ts";

/** The referrer policy of the edit mode, the same as the panel's. */
export const EDIT_MODE_REFERRER_POLICY = "strict-origin";

/** What every response of the edit mode carries besides the security headers. */
export const EDIT_MODE_HEADERS: Readonly<Record<string, string>> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

/** The segments of a path decoded until stable and lowercased, or undefined when it cannot be decoded. */
export function decodedSegments(pathname: string): string[] | undefined {
  let current = pathname;
  for (let round = 0; round < 10; round++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return undefined;
    }
    if (decoded === current) {
      return current.toLowerCase().replaceAll("\\", "/").split("/").filter(Boolean);
    }
    current = decoded;
  }
  return undefined;
}

/**
 * Whether a request belongs to the edit mode: Astro routed it to a page under
 * `/[state]/[municipality]/editar`, or its path, decoded and lowercased, has
 * `editar` as its third segment. A path that cannot be decoded counts as the
 * edit mode, so it fails closed.
 */
export function isEditModeRequest(url: URL, routePattern = ""): boolean {
  if (routePattern.startsWith(`${LOCALITY_ROUTE}/${EDIT_SEGMENT}`)) return true;
  const segments = decodedSegments(url.pathname);
  return segments === undefined || segments[2] === EDIT_SEGMENT;
}

/** Adds the headers of the edit mode to a response of the edit mode; any other is left as it is. */
export function withEditModeHeaders(response: Response, request: Request): Response {
  if (!isEditModeRequest(new URL(request.url))) return response;
  const apply = (target: Headers) => {
    for (const [name, value] of Object.entries(EDIT_MODE_HEADERS)) target.set(name, value);
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    // The headers of some responses are immutable; copy it instead.
    const copy = new Response(response.body, response);
    apply(copy.headers);
    return copy;
  }
}
