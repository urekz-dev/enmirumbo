// The public origin of the site: the base of every absolute URL, that is the
// canonicals, the Open Graph URLs and the sitemap (docs/specs/base-layout.md,
// "Canonical URLs, share previews and the sitemap use the full locality path
// (v2)" and "The base of absolute URLs is SITE_URL, and only the local
// environment falls back to the local address (v2)"). It comes from SITE_URL
// in wrangler.jsonc, one per environment.
//
// Locally, without a usable SITE_URL, the base is the local address. Anywhere
// else, as with the robots policy, an unknown or missing ENVIRONMENT counts as
// deployed: without an https SITE_URL there is no base, the pages omit their
// absolute URLs instead of publishing a local address, and the Worker logs it
// once per isolate.

export const LOCAL_SITE_URL = "http://localhost:4321";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The origin of `value` when it is an origin with no path, query or credentials. */
export function parseOrigin(
  value: string | undefined,
  protocols: readonly string[],
): string | null {
  if (value === undefined) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  return bare && protocols.includes(url.protocol) ? url.origin : null;
}

const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.error(message);
}

export interface SiteVars {
  ENVIRONMENT?: string | undefined;
  SITE_URL?: string | undefined;
}

/**
 * The origin every absolute URL starts with, such as
 * `https://enmirumbo.com`, without a trailing slash; or null in
 * a deployed environment whose SITE_URL is missing, is not an https origin or
 * names this machine.
 */
export function siteOrigin(vars: SiteVars): string | null {
  if (vars.ENVIRONMENT === "local") {
    return parseOrigin(vars.SITE_URL, ["http:", "https:"]) ?? LOCAL_SITE_URL;
  }
  const origin = parseOrigin(vars.SITE_URL, ["https:"]);
  if (origin !== null && !LOOPBACK_HOSTS.has(new URL(origin).hostname)) return origin;
  warnOnce(
    `site-url: SITE_URL is missing or is not a public https origin in the ` +
      `"${vars.ENVIRONMENT ?? "(none)"}" environment, so pages omit their canonical ` +
      `and share-preview URLs.`,
  );
  return null;
}

/**
 * The absolute URL of a path of this site (`/hidalgo/tizayuca`), or null when
 * the environment has no base (see siteOrigin): the page then leaves out its
 * canonical and its Open Graph URL, and never fails because of it.
 */
export function absoluteUrl(vars: SiteVars, path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`absoluteUrl: "${path}" is not a path of this site`);
  }
  const origin = siteOrigin(vars);
  return origin === null ? null : `${origin}${path}`;
}
