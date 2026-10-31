// Scenarios of docs/specs/base-layout.md, requirements "Cookieless measurement
// is loaded only in production and only when configured (v2)", "The admin
// panel and edit mode stay out of the measurement" and "Two product events
// and the no-results tag are recorded, only in production (v2)": the
// decisions of src/lib/analytics.ts. The script tag in the layout, with its
// tag, is tested with the Container API (test/astro/layout.test.ts and
// test/astro/search-page.test.ts), and the served site with the
// measurement off, as every environment is today, end to end
// (test/e2e/surfaces.spec.ts: no request leaves the site).
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ANALYTICS_EVENTS,
  ANALYTICS_TAGS,
  eventAttributes,
  isMeasured,
  pageAnalytics,
  readAnalytics,
  UMAMI_SCRIPT_URL,
} from "../../src/lib/analytics.ts";

const WEBSITE_ID = "94db1cb1-74f4-4a40-ad6c-962362670409";
const TIZAYUCA = { slug: "tizayuca", state: { slug: "hidalgo" } };

afterEach(() => {
  vi.restoreAllMocks();
});

const url = (path: string) => new URL(`https://enmirumbo.com${path}`);

describe("Cookieless measurement is loaded only in production and only when configured (v2)", () => {
  // Scenario: with both variables the provider's script is loaded (v2: the
  // Website ID, in production)
  it("in production with a Website ID, Umami Cloud's script with that ID", () => {
    expect(readAnalytics({ ENVIRONMENT: "prod", UMAMI_WEBSITE_ID: ` ${WEBSITE_ID} ` })).toEqual({
      scriptUrl: "https://cloud.umami.is/script.js",
      websiteId: WEBSITE_ID,
    });
    expect(UMAMI_SCRIPT_URL).toBe("https://cloud.umami.is/script.js");
  });

  // Scenario: with no variables configured nothing is loaded
  it.for(["", "   ", undefined])("without a Website ID (%j), nothing, silently", (id) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(readAnalytics({ ENVIRONMENT: "prod", UMAMI_WEBSITE_ID: id })).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  // Scenario: other environments and excluded screens
  it.for(["local", "dev", "stage", undefined, "production"])(
    "outside prod (%j), nothing even with a Website ID",
    (environment) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(readAnalytics({ ENVIRONMENT: environment, UMAMI_WEBSITE_ID: WEBSITE_ID })).toBeNull();
    },
  );

  // Scenario: half-set configuration (v2: a value that is not a Website ID)
  it("a value that is not a Website ID loads nothing and is logged once", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      expect(readAnalytics({ ENVIRONMENT: "prod", UMAMI_WEBSITE_ID: "abc123" })).toBeNull();
    }
    expect(log.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("The admin panel and edit mode stay out of the measurement", () => {
  // Scenarios: the panel does not load the script; edit mode does not load
  // the script either
  it.for([
    ["/admin", "/admin"],
    ["/admin/registros/1", "/admin/registros/[id]"],
    ["/admin/registros/1/loquesea", "/404"],
    ["/ADMIN", "/404"],
    ["/%61dmin/x", "/404"],
    ["/hidalgo/tizayuca/editar/abc", "/[state]/[municipality]/editar/[token]"],
    ["/hidalgo/tizayuca/editar/gracias", "/[state]/[municipality]/editar/gracias"],
    ["/hidalgo/tizayuca/editar", "/[state]/[municipality]/[segment]"],
    ["/hidalgo/tizayuca/editar/abc/nada", "/404"],
    ["/hidalgo/tizayuca/%65ditar/abc", "/404"],
  ] as const)("%s is not measured", ([path, route]) => {
    expect(isMeasured(url(path), route)).toBe(false);
    expect(
      pageAnalytics({ ENVIRONMENT: "prod", UMAMI_WEBSITE_ID: WEBSITE_ID }, url(path), route),
    ).toBeNull();
  });

  // Scenario: a new public page is measured
  it.for([
    ["/", "/"],
    ["/hidalgo/tizayuca", "/[state]/[municipality]"],
    ["/hidalgo/tizayuca/plomeria", "/[state]/[municipality]/[segment]"],
    ["/hidalgo/tizayuca/registro/gracias", "/[state]/[municipality]/registro/gracias"],
    ["/aviso-de-privacidad", "/aviso-de-privacidad"],
    ["/no-existe", "/404"],
  ] as const)("%s is measured", ([path, route]) => {
    expect(isMeasured(url(path), route)).toBe(true);
    expect(
      pageAnalytics({ ENVIRONMENT: "prod", UMAMI_WEBSITE_ID: WEBSITE_ID }, url(path), route),
    ).not.toBeNull();
  });
});

describe("Two product events and the no-results tag are recorded, only in production (v2)", () => {
  // Scenario: a registration is measured by its page views: it has no event
  // (ADR 0014, amended on 2026-10-18 by EMR-45).
  it("two event names and one tag, read from one place", () => {
    expect(Object.values(ANALYTICS_EVENTS)).toEqual(["whatsapp-listing", "whatsapp-card"]);
    // Scenario: search with no results. A tag of the page view, not an event.
    expect(Object.values(ANALYTICS_TAGS)).toEqual(["search-no-results"]);
  });

  // Scenario: WhatsApp click (the properties)
  it("an event carries the locality and the category, and nothing else", () => {
    const analytics = readAnalytics({ ENVIRONMENT: "prod", UMAMI_WEBSITE_ID: WEBSITE_ID });
    expect(
      eventAttributes(analytics, ANALYTICS_EVENTS.whatsappCard, {
        locality: TIZAYUCA,
        category: "servicios-del-hogar",
      }),
    ).toEqual({
      "data-umami-event": "whatsapp-card",
      "data-umami-event-locality": "hidalgo/tizayuca",
      "data-umami-event-category": "servicios-del-hogar",
    });
  });

  // Scenario: other environments and excluded screens
  it("with the measurement off, there are no event attributes", () => {
    expect(
      eventAttributes(null, ANALYTICS_EVENTS.whatsappListing, {
        locality: TIZAYUCA,
        category: "servicios-del-hogar",
      }),
    ).toEqual({});
  });
});
