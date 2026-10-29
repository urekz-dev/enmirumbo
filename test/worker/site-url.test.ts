// Scenarios of docs/specs/base-layout.md, requirements:
// - "Canonical URLs, share previews and the sitemap use the full locality path (v2)"
// - "The base of absolute URLs is SITE_URL, and only the local environment falls back to the local address (v2)"
// - "Server Component with a document in es-MX and base metadata" (base URL scenarios)
// against src/lib/site-url.ts. The canonical of a page is checked end to end
// in test/e2e/locality-routes.spec.ts.
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { localityPath } from "../../src/core/locality/paths.ts";
import { absoluteUrl, LOCAL_SITE_URL, siteOrigin } from "../../src/lib/site-url.ts";

const TIZAYUCA = { slug: "tizayuca", state: { slug: "hidalgo" } };
const PROD = { ENVIRONMENT: "prod", SITE_URL: "https://enmirumbo.urekz.workers.dev" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Canonical URLs, share previews and the sitemap use the full locality path (v2)", () => {
  it("canonical of a card: the site URL followed by the locality path", () => {
    expect(
      absoluteUrl(PROD, localityPath(TIZAYUCA, "negocio", "plomeria-de-prueba-a1b2c3d4")),
    ).toBe(
      "https://enmirumbo.urekz.workers.dev/hidalgo/tizayuca/negocio/plomeria-de-prueba-a1b2c3d4",
    );
  });

  it("each environment uses its own site URL", () => {
    for (const [environment, url] of [
      ["dev", "https://dev.enmirumbo.com"],
      ["stage", "https://stage.enmirumbo.com"],
      ["prod", "https://enmirumbo.urekz.workers.dev"],
    ] as const) {
      expect(absoluteUrl({ ENVIRONMENT: environment, SITE_URL: url }, "/hidalgo/tizayuca")).toBe(
        `${url}/hidalgo/tizayuca`,
      );
    }
  });

  it("a trailing slash in SITE_URL does not double the slash", () => {
    expect(siteOrigin({ ...PROD, SITE_URL: `${PROD.SITE_URL}/` })).toBe(PROD.SITE_URL);
  });

  it("only paths of this site", () => {
    for (const path of ["hidalgo/tizayuca", "https://example.com/x", "//example.com/x"]) {
      expect(() => absoluteUrl(PROD, path), path).toThrow(/not a path/);
    }
  });
});

describe("The base of absolute URLs is SITE_URL, and only the local environment falls back to the local address (v2)", () => {
  it("base URL declared: the local Worker of wrangler.jsonc", () => {
    expect(env.ENVIRONMENT).toBe("local");
    expect(absoluteUrl(env, "/hidalgo/tizayuca")).toBe(`${env.SITE_URL}/hidalgo/tizayuca`);
  });

  it("local without SITE_URL, or with one that cannot be read: the local address", () => {
    for (const SITE_URL of [undefined, "", "localhost", "https://example.com/path"]) {
      expect(siteOrigin({ ENVIRONMENT: "local", SITE_URL }), String(SITE_URL)).toBe(LOCAL_SITE_URL);
    }
    expect(LOCAL_SITE_URL).toBe("http://localhost:4321");
  });

  it("a deployed environment without a public https SITE_URL publishes no absolute URL, logged once", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const unusable = [
      undefined,
      "",
      "not a url",
      "http://enmirumbo.urekz.workers.dev",
      "https://localhost:4321",
      "http://localhost:4321",
      "https://127.0.0.1",
      "https://enmirumbo.urekz.workers.dev/hidalgo",
      "https://enmirumbo.urekz.workers.dev/?x=1",
      "https://user:pass@enmirumbo.urekz.workers.dev",
    ];
    for (const SITE_URL of unusable) {
      expect(absoluteUrl({ ENVIRONMENT: "prod", SITE_URL }, "/"), String(SITE_URL)).toBeNull();
    }
    // Once per isolate, never per request; it names the environment.
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toContain('"prod"');
    for (const SITE_URL of unusable) absoluteUrl({ ENVIRONMENT: "prod", SITE_URL }, "/");
    expect(log).toHaveBeenCalledOnce();
  });

  it("a missing or unknown ENVIRONMENT counts as deployed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const ENVIRONMENT of [undefined, "", "production", "LOCAL"]) {
      expect(siteOrigin({ ENVIRONMENT }), String(ENVIRONMENT)).toBeNull();
      expect(siteOrigin({ ENVIRONMENT, SITE_URL: "http://localhost:4321" })).toBeNull();
      expect(siteOrigin({ ENVIRONMENT, SITE_URL: PROD.SITE_URL })).toBe(PROD.SITE_URL);
    }
  });
});
