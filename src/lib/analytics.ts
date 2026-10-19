// Cookieless measurement with Umami Cloud (ADR 0014; docs/specs/base-layout.md,
// "Cookieless measurement is loaded only in production and only when
// configured (v2)" and "Three product events and the no-results tag are
// recorded, only in production (v2)").
//
// The only configuration is the Website ID of the site at Umami Cloud, the
// Worker var UMAMI_WEBSITE_ID. The script and the collector are Umami Cloud's,
// fixed by ADR 0014, so the content security policy lists exactly those
// origins (src/lib/security-headers.ts). The measurement is on only when the
// environment is `prod` and the Website ID is one: empty, as it is in every
// environment until the launch, nothing is loaded and no request leaves the
// site. A value that is not a Website ID, or a Website ID outside `prod`, is
// ignored and logged once per isolate.
//
// The admin panel and the edit mode of the management link stay out of the
// measurement by where their pages live (isMeasured), not by a list of pages.
import { localityPath, type LocalityRef } from "../core/locality/paths.ts";
import { isAdminRequest } from "./access/admin-gate.ts";
import { isEditModeRequest } from "./edit-mode.ts";

/** The script of Umami Cloud, loaded deferred from the head of each measured page. */
export const UMAMI_SCRIPT_URL = "https://cloud.umami.is/script.js";

/**
 * Where the script comes from and where it sends visits and events. They are
 * different origins: the collector of Umami Cloud is `gateway.umami.is` since
 * 2026-06-06; the script's own origin stays allowed as a collector too.
 */
export const UMAMI_SCRIPT_ORIGIN = "https://cloud.umami.is";
export const UMAMI_COLLECTOR_ORIGINS: readonly string[] = [
  "https://gateway.umami.is",
  UMAMI_SCRIPT_ORIGIN,
];

/** The environment where measurement may run: production only (ADR 0014). */
export const MEASURED_ENVIRONMENT = "prod";

/** A Website ID of Umami: a UUID. */
const WEBSITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnalyticsVars {
  ENVIRONMENT?: string | undefined;
  UMAMI_WEBSITE_ID?: string | undefined;
}

/** What the script tag needs. */
export interface Analytics {
  scriptUrl: string;
  websiteId: string;
}

const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.error(message);
}

/**
 * The measurement of this environment, or null when it is off: outside `prod`,
 * or without a Website ID. A value that is set but cannot be used is logged
 * once per isolate, never per request, and never stops a page.
 */
export function readAnalytics(vars: AnalyticsVars): Analytics | null {
  const websiteId = vars.UMAMI_WEBSITE_ID?.trim() ?? "";
  if (websiteId === "") return null;
  if (vars.ENVIRONMENT !== MEASURED_ENVIRONMENT) {
    warnOnce(
      `analytics: UMAMI_WEBSITE_ID is set in the "${vars.ENVIRONMENT ?? "(none)"}" environment ` +
        `and ignored: only ${MEASURED_ENVIRONMENT} is measured (ADR 0014).`,
    );
    return null;
  }
  if (!WEBSITE_ID.test(websiteId)) {
    warnOnce("analytics: UMAMI_WEBSITE_ID is not an Umami Website ID, so nothing is measured.");
    return null;
  }
  return { scriptUrl: UMAMI_SCRIPT_URL, websiteId: websiteId.toLowerCase() };
}

/**
 * Whether a page belongs to the measured trunk of the site. The admin panel
 * (`/admin` and below, its actions and any address under it, even one that
 * does not exist) and the edit mode of the management link
 * (`/{estado}/{municipio}/editar/...`, whose path is the card's credential)
 * never are: their routes point to a person's registration or carry the key
 * to a card. Every other page is, wherever it lives, so a new public page is
 * measured without touching a list. A path that cannot be decoded is not.
 */
export function isMeasured(url: URL, routePattern: string): boolean {
  if (isAdminRequest(url, routePattern)) return false;
  return !isEditModeRequest(url, routePattern);
}

/**
 * The measurement of a page: the environment's (readAnalytics), unless the
 * page is outside the measured trunk (isMeasured).
 */
export function pageAnalytics(
  vars: AnalyticsVars,
  url: URL,
  routePattern: string,
): Analytics | null {
  const analytics = readAnalytics(vars);
  return analytics !== null && isMeasured(url, routePattern) ? analytics : null;
}

/**
 * The three product events (PRD §6.4, ADR 0014, amended on 2026-10-15), the
 * only names any page may send: the WhatsApp button of a listing card and of
 * a card (D3), kept apart so that the card's clicks over its views stay a
 * metric of their own, and the registration submitted (E).
 */
export const ANALYTICS_EVENTS = {
  whatsappListing: "whatsapp-listing",
  whatsappCard: "whatsapp-card",
  registrationSubmitted: "registration-submitted",
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * The tags a page view may carry (ADR 0014, amended on 2026-10-15 by EMR-36),
 * the only values of the script's `data-tag`: the results page tags its view
 * when the search found nothing (D5). The server knows it when it renders the
 * page, so the tag needs no event and no JavaScript of the site, and the text
 * searched never travels: the tag is a fixed word, and the page's address
 * leaves without its query (`data-exclude-search`). Umami filters the views
 * by tag, to compare the searches with no results with all the searches.
 */
export const ANALYTICS_TAGS = {
  searchNoResults: "search-no-results",
} as const;

export type AnalyticsTag = (typeof ANALYTICS_TAGS)[keyof typeof ANALYTICS_TAGS];

export interface EventProperties {
  /** The locality of the page; its value is `{estado}/{municipio}`, its slugs. */
  locality: LocalityRef;
  /** The slug of the category, when the event has one. */
  category?: string | null | undefined;
}

/**
 * The attributes that declare an event on an element, for Umami to send when
 * it is clicked: the event name and its only two properties, the locality
 * (its slugs) and the category (its slug). Nothing typed by a person ever
 * goes in them. With the measurement off (null) there are none, so the event
 * exists only where the script does.
 */
export function eventAttributes(
  analytics: Analytics | null,
  event: AnalyticsEvent,
  { locality, category }: EventProperties,
): Record<string, string> {
  if (analytics === null) return {};
  return {
    "data-umami-event": event,
    "data-umami-event-locality": localityPath(locality).slice(1),
    ...(category ? { "data-umami-event-category": category } : {}),
  };
}
