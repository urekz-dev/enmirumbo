// docs/specs/base-layout.md, "Deployed environments stay out of search engines
// until the cut-over (v2)", scenario "a prerendered page of a deployed
// environment", and docs/specs/deployment.md, "Every response carries the
// security headers and the content security policy (v2)", scenario "a static
// asset": Cloudflare serves the static assets without the Worker, so the build
// gives them their headers through `_headers`
// (src/integrations/static-headers.ts). The deploy refuses a build without
// them (test/scripts/deploy-scripts.test.ts), and the smoke test checks a
// legal page after each deploy.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addStaticHeaders,
  builtVars,
  STATIC_NOINDEX_RULE,
  staticSecurityRule,
} from "../../src/integrations/static-headers.ts";
import { securityHeaders } from "../../src/lib/security-headers.ts";

/** What the Cloudflare adapter writes before: the cache rule of /_astro/. */
const ADAPTER_RULES = "/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n";

const WEBSITE_ID = "94db1cb1-74f4-4a40-ad6c-962362670409";

let build: string;
let server: URL;
let client: URL;

beforeEach(() => {
  build = mkdtempSync(join(tmpdir(), "enmirumbo-build-"));
  mkdirSync(join(build, "server"));
  mkdirSync(join(build, "client"));
  server = pathToFileURL(join(build, "server/"));
  client = pathToFileURL(join(build, "client/"));
});

afterEach(() => {
  rmSync(build, { recursive: true, force: true });
});

function writeConfig(config: unknown): void {
  writeFileSync(join(build, "server/wrangler.json"), JSON.stringify(config));
}

const headers = () => readFileSync(join(build, "client/_headers"), "utf8");

/** The vars of a deployed build, as wrangler.jsonc declares them. */
function deployed(environment: string, extra: Record<string, string> = {}) {
  return {
    ENVIRONMENT: environment,
    MEDIA_URL: "https://media-enmirumbo.urekz.com",
    UMAMI_WEBSITE_ID: "",
    ...extra,
  };
}

describe("Deployed environments stay out of search engines until the cut-over (v2): static assets", () => {
  it("the rule gives every static asset X-Robots-Tag: noindex", () => {
    expect(STATIC_NOINDEX_RULE).toBe("/*\n  X-Robots-Tag: noindex\n");
  });

  it.for(["dev", "stage", "prod"])(
    "a build for %s adds the rules after the adapter's, keeping them",
    async (environment) => {
      writeConfig({ vars: deployed(environment) });
      writeFileSync(join(build, "client/_headers"), ADAPTER_RULES);

      const vars = await builtVars(server);
      expect(vars["ENVIRONMENT"]).toBe(environment);
      expect(await addStaticHeaders(client, vars)).toEqual({ security: true, noindex: true });
      expect(headers().startsWith(ADAPTER_RULES)).toBe(true);
      expect(headers()).toContain(staticSecurityRule(vars));
      expect(headers().endsWith(STATIC_NOINDEX_RULE)).toBe(true);
    },
  );

  it("adding them twice leaves a single copy of each rule", async () => {
    await addStaticHeaders(client, deployed("prod"));
    await addStaticHeaders(client, deployed("prod"));

    expect(headers().split(STATIC_NOINDEX_RULE)).toHaveLength(2);
    expect(headers().split(staticSecurityRule(deployed("prod")))).toHaveLength(2);
  });

  // Scenario: local
  it("a local build adds no noindex: the static pages stay indexable", async () => {
    writeConfig({ vars: { ENVIRONMENT: "local", MEDIA_URL: "", UMAMI_WEBSITE_ID: "" } });
    writeFileSync(join(build, "client/_headers"), ADAPTER_RULES);

    const vars = await builtVars(server);
    expect(await addStaticHeaders(client, vars)).toEqual({ security: true, noindex: false });
    expect(headers()).not.toContain("X-Robots-Tag");
  });

  // Scenario: an unknown environment
  it.for([
    ["no configuration", undefined],
    ["no ENVIRONMENT", { vars: {} }],
    ["an unknown ENVIRONMENT", { vars: { ENVIRONMENT: "production" } }],
  ] as const)("%s counts as deployed", async ([, config]) => {
    if (config !== undefined) writeConfig(config);

    expect((await addStaticHeaders(client, await builtVars(server))).noindex).toBe(true);
    expect(headers()).toContain(STATIC_NOINDEX_RULE);
  });
});

describe("Every response carries the security headers and the content security policy (v2): static assets", () => {
  // Scenario: a static asset
  it.for(["local", "dev", "stage", "prod"])(
    "a build for %s gives every static asset the headers a page of that environment gets",
    async (environment) => {
      const vars = environment === "local" ? { ENVIRONMENT: "local" } : deployed(environment);
      await addStaticHeaders(client, vars);

      const rule = staticSecurityRule(vars);
      expect(headers()).toContain(rule);
      expect(rule.startsWith("/*\n")).toBe(true);
      for (const [name, value] of Object.entries(securityHeaders(vars))) {
        expect(rule).toContain(`\n  ${name}: ${value}\n`);
      }
      expect(rule).toContain("frame-ancestors 'none'");
      expect(rule).toContain("X-Content-Type-Options: nosniff");
      expect(rule).toContain("X-Frame-Options: DENY");
      expect(rule).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    },
  );

  it("the static pages of production with a Website ID may load Umami, and only then", async () => {
    expect(staticSecurityRule(deployed("prod", { UMAMI_WEBSITE_ID: WEBSITE_ID }))).toContain(
      "https://cloud.umami.is",
    );
    for (const vars of [deployed("prod"), deployed("stage", { UMAMI_WEBSITE_ID: WEBSITE_ID })]) {
      expect(staticSecurityRule(vars)).not.toContain("umami");
    }
  });

  it("every line stays within Cloudflare's 2,000 characters", () => {
    const rule = staticSecurityRule(deployed("prod", { UMAMI_WEBSITE_ID: WEBSITE_ID }));
    for (const line of rule.split("\n")) expect(line.length).toBeLessThan(2000);
  });
});
