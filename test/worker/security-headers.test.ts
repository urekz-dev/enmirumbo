// Scenarios of docs/specs/deployment.md, requirements "Every response carries
// the security headers and the content security policy (v2)", "The site
// declares where JavaScript may come from and where data may go", "Every site
// response carries the basic security headers" and "The content security
// policy allows Turnstile as well as Umami (v2)". src/worker.ts applies
// withSecurityHeaders to every Worker response; the static assets get the
// same headers from `_headers` (test/scripts/static-headers.test.ts), the
// deploy refuses a build without them (test/scripts/deploy-scripts.test.ts),
// and the end-to-end tests read them from the served site
// (test/e2e/security-headers.spec.ts).
import { describe, expect, it } from "vite-plus/test";
import { forbiddenResponse } from "../../src/lib/access/admin-gate.ts";
import {
  contentSecurityPolicy,
  PANEL_REFERRER_POLICY,
  REFERRER_POLICY,
  securityHeaders,
  withSecurityHeaders,
  type SecurityVars,
} from "../../src/lib/security-headers.ts";

const WEBSITE_ID = "94db1cb1-74f4-4a40-ad6c-962362670409";

const PROD: SecurityVars = {
  ENVIRONMENT: "prod",
  MEDIA_URL: "https://media-enmirumbo.urekz.com",
  ACCESS_TEAM_DOMAIN: "urekz.cloudflareaccess.com",
  UMAMI_WEBSITE_ID: "",
};
const MEASURED: SecurityVars = { ...PROD, UMAMI_WEBSITE_ID: WEBSITE_ID };

/** The directives of a policy, by name. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

function request(path: string): Request {
  return new Request(`https://enmirumbo.urekz.workers.dev${path}`);
}

function page(headers: Record<string, string> = {}, status = 200): Response {
  return new Response("<!doctype html><title>enmirumbo</title>", {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

describe("The site declares where JavaScript may come from and where data may go", () => {
  it("the whole policy, with the measurement off", () => {
    expect(contentSecurityPolicy({ analytics: false })).toBe(
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; " +
        "style-src 'self'; img-src 'self'; connect-src 'self'; " +
        "frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; " +
        "object-src 'none'; base-uri 'none'; form-action 'self'",
    );
  });

  // Scenario: analytics measurement works with the policy in place
  it("with the measurement on, Umami's script and its collectors are allowed", () => {
    const policy = directives(contentSecurityPolicy({ analytics: true }));
    expect(policy["script-src"]).toEqual([
      "'self'",
      "https://challenges.cloudflare.com",
      "https://cloud.umami.is",
    ]);
    expect(policy["connect-src"]).toEqual([
      "'self'",
      "https://gateway.umami.is",
      "https://cloud.umami.is",
    ]);
  });

  // Scenario: a script from another origin; nothing else
  it.for([
    ["local", { ENVIRONMENT: "local" }],
    ["dev", { ...PROD, ENVIRONMENT: "dev", UMAMI_WEBSITE_ID: WEBSITE_ID }],
    ["prod without a Website ID", PROD],
    ["prod with a Website ID", MEASURED],
  ] as const)("%s: no script origin but the site, Turnstile and Umami", ([, vars]) => {
    const policy = directives(securityHeaders(vars)["Content-Security-Policy"] ?? "");
    for (const source of policy["script-src"] ?? []) {
      expect(["'self'", "https://challenges.cloudflare.com", "https://cloud.umami.is"]).toContain(
        source,
      );
    }
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
    expect(policy["script-src"]).not.toContain("'unsafe-eval'");
    expect(policy["style-src"]).toEqual(["'self'"]);
    expect(policy["default-src"]).toEqual(["'self'"]);
  });

  it("Umami only in production with a Website ID", () => {
    const umami = (vars: SecurityVars) =>
      securityHeaders(vars)["Content-Security-Policy"]?.includes("umami") ?? false;
    expect(umami(MEASURED)).toBe(true);
    expect(umami(PROD)).toBe(false);
    expect(umami({ ...MEASURED, ENVIRONMENT: "stage" })).toBe(false);
    expect(umami({ ...MEASURED, UMAMI_WEBSITE_ID: "not-an-id" })).toBe(false);
  });

  // Scenario: Turnstile loads
  it("Turnstile's script and frame are allowed everywhere", () => {
    const policy = directives(contentSecurityPolicy({ analytics: false }));
    expect(policy["script-src"]).toContain("https://challenges.cloudflare.com");
    expect(policy["frame-src"]).toEqual(["https://challenges.cloudflare.com"]);
  });

  it("framing by another site, plugins and forms to another site are blocked", () => {
    const policy = directives(contentSecurityPolicy({ analytics: true }));
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'none'"]);
    expect(policy["form-action"]).toEqual(["'self'"]);
  });

  it("images come from the site and the media hostname of the environment (ADR 0011)", () => {
    expect(directives(securityHeaders(PROD)["Content-Security-Policy"] ?? "")["img-src"]).toEqual([
      "'self'",
      "https://media-enmirumbo.urekz.com",
    ]);
    for (const media of [
      "",
      "http://media-enmirumbo.urekz.com",
      "https://media-enmirumbo.urekz.com/photos",
    ]) {
      const policy = securityHeaders({ ...PROD, MEDIA_URL: media })["Content-Security-Policy"];
      expect(directives(policy ?? "")["img-src"], media).toEqual(["'self'"]);
    }
  });
});

describe("Every site response carries the basic security headers", () => {
  // Scenario: any page of the site
  it.for([
    ["a page", "/hidalgo/tizayuca", page()],
    ["a 404", "/no-existe", page({}, 404)],
    ["an error", "/hidalgo/tizayuca", new Response(null, { status: 500 })],
    ["robots.txt", "/robots.txt", new Response("User-agent: *\nDisallow: /\n")],
    ["a redirect", "/", Response.redirect("https://enmirumbo.urekz.workers.dev/hidalgo/tizayuca")],
  ] as const)("%s carries them", ([, path, response]) => {
    const result = withSecurityHeaders(response.clone(), request(path), PROD);
    expect(result.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
    expect(result.headers.get("Referrer-Policy")).toBe(REFERRER_POLICY);
    expect(result.status).toBe(response.status);
  });

  it("the referrer policy never sends a path to another site", () => {
    expect(REFERRER_POLICY).toBe("strict-origin-when-cross-origin");
  });

  it("no response announces the framework", () => {
    const result = withSecurityHeaders(page({ "X-Powered-By": "Astro" }), request("/"), PROD);
    expect(result.headers.has("X-Powered-By")).toBe(false);
  });

  // Scenario: the admin panel keeps its strict policy
  it.for(["/admin", "/admin/registros/1", "/admin/registros/1/loquesea", "/_actions/admin.x"])(
    "the panel (%s) gets the strict referrer policy and may send its forms to the Access login",
    (path) => {
      const result = withSecurityHeaders(forbiddenResponse(), request(path), PROD);
      expect(result.headers.get("Referrer-Policy")).toBe(PANEL_REFERRER_POLICY);
      expect(PANEL_REFERRER_POLICY).toBe("strict-origin");
      expect(
        directives(result.headers.get("Content-Security-Policy") ?? "")["form-action"],
      ).toEqual(["'self'", "https://urekz.cloudflareaccess.com"]);
      expect(result.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    },
  );

  it("a public page never lets its forms reach the Access login", () => {
    const result = withSecurityHeaders(page(), request("/hidalgo/tizayuca"), PROD);
    expect(result.headers.get("Content-Security-Policy")).not.toContain("cloudflareaccess");
  });

  it("a page that declares a stricter value keeps it", () => {
    const result = withSecurityHeaders(
      page({ "Referrer-Policy": "no-referrer" }),
      request("/hidalgo/tizayuca"),
      PROD,
    );
    expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("a response with immutable headers is copied with them", () => {
    const redirect = Response.redirect("https://enmirumbo.urekz.workers.dev/hidalgo/tizayuca", 301);
    expect(() => redirect.headers.set("X-Test", "1")).toThrow();

    const result = withSecurityHeaders(redirect, request("/"), PROD);

    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
    expect(result.status).toBe(301);
    expect(result.headers.get("Location")).toBe(
      "https://enmirumbo.urekz.workers.dev/hidalgo/tizayuca",
    );
  });

  it("the dev server leaves the policy out and keeps the rest", () => {
    const result = withSecurityHeaders(
      page(),
      request("/"),
      { ENVIRONMENT: "local" },
      { csp: false },
    );
    expect(result.headers.has("Content-Security-Policy")).toBe(false);
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
