// The security headers of every response of the site (docs/specs/deployment.md,
// "Every response carries the security headers and the content security policy
// (v2)"): the content security policy, `X-Content-Type-Options: nosniff`,
// `X-Frame-Options: DENY` and a referrer policy that never sends a path to
// another site.
//
// src/worker.ts adds them to every Worker response: pages, redirects, errors,
// /robots.txt, the sitemap. Cloudflare serves the static assets (the
// prerendered legal pages, the CSS, the share images) without the Worker, so
// the build writes the same headers for them in `_headers`
// (src/integrations/static-headers.ts), from the same functions.
//
// The policy allows scripts only from the site itself, Turnstile
// (challenges.cloudflare.com, ADR 0012) and, where the measurement is on (in
// production, with a Website ID), Umami Cloud (ADR 0014). No inline script or
// style, no plugin, no framing of the site by another one, and no form
// posting to another site; the panel also lets its forms reach the Access
// login, where Access sends a submission whose session expired. Images come
// from the site and from the environment's media hostname, MEDIA_URL, where
// the business photos are (ADR 0011).
import { isAdminRequest } from "./access/admin-gate.ts";
import { parseTeamDomain } from "./access/verify.ts";
import {
  readAnalytics,
  UMAMI_COLLECTOR_ORIGINS,
  UMAMI_SCRIPT_ORIGIN,
  type AnalyticsVars,
} from "./analytics.ts";
import { parseOrigin } from "./site-url.ts";

/** Turnstile's widget: its script and its frame (ADR 0012). */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * The referrer policy of the site: another site gets the origin at most,
 * never the path. The site's own pages still see the path, which the
 * measurement counts as navigation.
 */
export const REFERRER_POLICY = "strict-origin-when-cross-origin";

/**
 * The stricter policy of the admin panel (base-layout, "The measurement
 * carries no personal data or text typed by people"): not even the site's
 * own pages see a panel path, which can point to a person's registration.
 * It keeps the `Origin` of form submissions, which the panel needs.
 */
export const PANEL_REFERRER_POLICY = "strict-origin";

export interface PolicyOptions {
  /** Whether Umami Cloud may load and collect (production, configured). */
  analytics: boolean;
  /** The https origin of the media hostname, where the business photos are served from (ADR 0011), if any. */
  mediaOrigin?: string | null | undefined;
  /** Origins forms may post to besides the site: the Access login, on the panel. */
  formOrigins?: readonly string[] | undefined;
}

/** The value of `Content-Security-Policy`. */
export function contentSecurityPolicy({
  analytics,
  mediaOrigin,
  formOrigins = [],
}: PolicyOptions): string {
  const directives: [string, readonly string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", TURNSTILE_ORIGIN, ...(analytics ? [UMAMI_SCRIPT_ORIGIN] : [])]],
    ["style-src", ["'self'"]],
    ["img-src", ["'self'", ...(mediaOrigin ? [mediaOrigin] : [])]],
    ["connect-src", ["'self'", ...(analytics ? UMAMI_COLLECTOR_ORIGINS : [])]],
    ["frame-src", [TURNSTILE_ORIGIN]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'", ...formOrigins]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

export interface SecurityVars extends AnalyticsVars {
  /** The https origin of the media hostname of the environment (ADR 0011). */
  MEDIA_URL?: string | undefined;
  /** The Access team domain, where the panel's forms may be sent to sign in again. */
  ACCESS_TEAM_DOMAIN?: string | undefined;
}

/** What `vars` and the kind of page decide about the policy. */
export function policyOptions(vars: SecurityVars, panel: boolean): PolicyOptions {
  const teamDomain = panel ? parseTeamDomain(vars.ACCESS_TEAM_DOMAIN) : undefined;
  return {
    analytics: readAnalytics(vars) !== null,
    mediaOrigin: parseOrigin(vars.MEDIA_URL, ["https:"]),
    formOrigins: teamDomain === undefined ? [] : [`https://${teamDomain}`],
  };
}

/**
 * The security headers of a response. `panel` for the admin panel, which gets
 * the stricter referrer policy and may send its forms to the Access login.
 * Without `csp`, the policy is left out: only the dev server does that, whose
 * pages need Vite's inline styles and scripts.
 */
export function securityHeaders(
  vars: SecurityVars,
  { panel = false, csp = true }: { panel?: boolean; csp?: boolean } = {},
): Record<string, string> {
  return {
    ...(csp
      ? { "Content-Security-Policy": contentSecurityPolicy(policyOptions(vars, panel)) }
      : {}),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": panel ? PANEL_REFERRER_POLICY : REFERRER_POLICY,
  };
}

/** Headers that announce the framework or the server software; never sent. */
export const BANNER_HEADERS: readonly string[] = ["X-Powered-By"];

/**
 * Adds the security headers to a Worker response. A header the response
 * already carries keeps its value, so a page that declares something
 * stricter keeps it. Any framework banner is removed.
 */
export function withSecurityHeaders(
  response: Response,
  request: Request,
  vars: SecurityVars,
  { csp = true }: { csp?: boolean } = {},
): Response {
  const panel = isAdminRequest(new URL(request.url), "");
  const headers = securityHeaders(vars, { panel, csp });
  const apply = (target: Headers) => {
    for (const [name, value] of Object.entries(headers)) {
      if (!target.has(name)) target.set(name, value);
    }
    for (const name of BANNER_HEADERS) target.delete(name);
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
