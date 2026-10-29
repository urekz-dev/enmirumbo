// Scenarios of docs/specs/admin-review.md, requirements:
// - "Every admin request carries an Access token that the Worker verifies (v2)"
// - "A deployed environment without Access configuration does not open the panel (v2)"
// - "Locally, a fixed identity is injected only when the environment says `local` (v2)"
// - "The panel is not indexed nor linked from the public site" (headers)
// The tests sign their own tokens with a key pair generated here and verify
// them against a local JWKS, so they never touch the network.
import { ActionError } from "astro:actions";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { gateAdminRequest, isAdminRequest } from "../../src/lib/access/admin-gate.ts";
import { requireAdmin } from "../../src/lib/access/require-admin.ts";
import {
  ACCESS_JWT_HEADER,
  authorizeAdminRequest,
  LOCAL_ADMIN_EMAIL,
  remoteAccessKeys,
  type AccessConfig,
  type AccessKeys,
} from "../../src/lib/access/verify.ts";

const TEAM_DOMAIN = "enmirumbo-test.cloudflareaccess.com";
const ISSUER = `https://${TEAM_DOMAIN}`;
const AUD = "a1".repeat(32);
const OTHER_APP_AUD = "b2".repeat(32);
const ADMIN_EMAIL = "persona@enmirumbo.test";
const DEPLOYED_URL = "https://stage.enmirumbo.com";
const LOCAL_URL = "http://localhost:4321";

let teamKey: CryptoKey;
let strangerKey: CryptoKey;
let keys: AccessKeys;
let requestedDomains: string[];

beforeAll(async () => {
  const team = await generateKeyPair("RS256");
  const stranger = await generateKeyPair("RS256");
  teamKey = team.privateKey;
  strangerKey = stranger.privateKey;
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(team.publicKey)), kid: "team-key", alg: "RS256", use: "sig" }],
  });
  keys = (teamDomain) => {
    requestedDomains.push(teamDomain);
    return jwks;
  };
});

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  requestedDomains = [];
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function deployed(environment = "prod", overrides: Partial<AccessConfig> = {}): AccessConfig {
  return { environment, teamDomain: TEAM_DOMAIN, aud: AUD, ...overrides };
}

interface TokenOptions {
  key?: CryptoKey;
  kid?: string;
  issuer?: string;
  audience?: string[];
  expiresAt?: number;
  withoutExpiry?: boolean;
  claims?: JWTPayload;
}

async function token(options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({ email: ADMIN_EMAIL, type: "app", ...options.claims })
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "team-key", typ: "JWT" })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? [AUD])
    .setIssuedAt(now - 60);
  if (options.withoutExpiry !== true) jwt.setExpirationTime(options.expiresAt ?? now + 300);
  return jwt.sign(options.key ?? teamKey);
}

function request(path = "/admin", jwt?: string, origin = DEPLOYED_URL): Request {
  const headers = new Headers();
  if (jwt !== undefined) headers.set(ACCESS_JWT_HEADER, jwt);
  return new Request(`${origin}${path}`, { headers });
}

function base64url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decide(req: Request, config: AccessConfig = deployed()) {
  return authorizeAdminRequest(req, config, keys);
}

function invalidToken(code: string) {
  return { allowed: false, denial: { reason: "invalid-token", code } };
}

describe("Every admin request carries an Access token that the Worker verifies (v2)", () => {
  it("a valid token: the email claim is the identity", async () => {
    const decision = await decide(request("/admin", await token()));

    expect(decision).toEqual({ allowed: true, identity: { email: ADMIN_EMAIL, source: "access" } });
    // The key set is the one of the configured team.
    expect(requestedDomains).toEqual([TEAM_DOMAIN]);
  });

  it.for(["dev", "stage", "prod"])(
    "a valid token: accepted in %s with the team domain and AUD of that environment",
    async (environment) => {
      const decision = await decide(request("/admin", await token()), deployed(environment));
      expect(decision.allowed).toBe(true);
    },
  );

  it("a valid token: the team domain may carry Cloudflare's https:// prefix", async () => {
    const config = deployed("prod", { teamDomain: `${ISSUER}/` });
    expect((await decide(request("/admin", await token()), config)).allowed).toBe(true);
  });

  it("no token: a request without the header is denied", async () => {
    expect(await decide(request("/admin"))).toEqual({
      allowed: false,
      denial: { reason: "missing-token" },
    });
    expect(await decide(request("/admin", "   "))).toEqual({
      allowed: false,
      denial: { reason: "missing-token" },
    });
  });

  it("no token: a token in a cookie or in another header is not read", async () => {
    const jwt = await token();
    const req = new Request(`${DEPLOYED_URL}/admin`, {
      headers: { Cookie: `CF_Authorization=${jwt}`, Authorization: `Bearer ${jwt}` },
    });
    expect((await decide(req)).allowed).toBe(false);
  });

  it("a token that fails: altered signature", async () => {
    const [header, payload] = (await token()).split(".");
    const [, , otherSignature] = (await token({ claims: { email: "otra@enmirumbo.test" } })).split(
      ".",
    );
    const altered = `${header}.${payload}.${otherSignature}`;

    expect(await decide(request("/admin", altered))).toEqual(
      invalidToken("ERR_JWS_SIGNATURE_VERIFICATION_FAILED"),
    );
  });

  it("a token that fails: payload changed after signing", async () => {
    const [header, , signature] = (await token()).split(".");
    const forged = base64url(
      JSON.stringify({ email: "intruso@enmirumbo.test", iss: ISSUER, aud: [AUD], exp: 9e9 }),
    );

    expect(await decide(request("/admin", `${header}.${forged}.${signature}`))).toEqual(
      invalidToken("ERR_JWS_SIGNATURE_VERIFICATION_FAILED"),
    );
  });

  it("a token that fails: expired", async () => {
    const expired = await token({ expiresAt: Math.floor(Date.now() / 1000) - 1 });
    expect(await decide(request("/admin", expired))).toEqual(invalidToken("ERR_JWT_EXPIRED"));
  });

  it("a token that fails: without an expiry", async () => {
    const forever = await token({ withoutExpiry: true });
    expect(await decide(request("/admin", forever))).toEqual(
      invalidToken("ERR_JWT_CLAIM_VALIDATION_FAILED"),
    );
  });

  it("a token that fails: another issuer", async () => {
    const other = await token({ issuer: "https://otro-equipo.cloudflareaccess.com" });
    expect(await decide(request("/admin", other))).toEqual(
      invalidToken("ERR_JWT_CLAIM_VALIDATION_FAILED"),
    );
  });

  it("a token that fails: the AUD of another application", async () => {
    const other = await token({ audience: [OTHER_APP_AUD] });
    expect(await decide(request("/admin", other))).toEqual(
      invalidToken("ERR_JWT_CLAIM_VALIDATION_FAILED"),
    );
  });

  it("a token that fails: signed by a key that is not in the team's JWKS", async () => {
    const unknownKid = await token({ key: strangerKey, kid: "stranger-key" });
    expect(await decide(request("/admin", unknownKid))).toEqual(
      invalidToken("ERR_JWKS_NO_MATCHING_KEY"),
    );

    const stolenKid = await token({ key: strangerKey });
    expect(await decide(request("/admin", stolenKid))).toEqual(
      invalidToken("ERR_JWS_SIGNATURE_VERIFICATION_FAILED"),
    );
  });

  it("a token that fails: an algorithm other than RS256", async () => {
    const now = Math.floor(Date.now() / 1000);
    const hmac = await new SignJWT({ email: ADMIN_EMAIL })
      .setProtectedHeader({ alg: "HS256", kid: "team-key" })
      .setIssuer(ISSUER)
      .setAudience([AUD])
      .setExpirationTime(now + 300)
      .sign(new TextEncoder().encode("a-shared-secret-that-is-long-enough"));
    expect((await decide(request("/admin", hmac))).allowed).toBe(false);

    const unsigned = `${base64url('{"alg":"none","typ":"JWT"}')}.${base64url(
      JSON.stringify({ email: ADMIN_EMAIL, iss: ISSUER, aud: [AUD], exp: now + 300 }),
    )}.`;
    expect((await decide(request("/admin", unsigned))).allowed).toBe(false);
  });

  it("a token that fails: garbage instead of a JWT", async () => {
    expect(await decide(request("/admin", "not-a-jwt"))).toEqual(invalidToken("ERR_JWS_INVALID"));
  });

  it("a token without an email claim (a service token) is denied", async () => {
    const serviceToken = await token({ claims: { email: undefined, common_name: "x.access" } });
    expect(await decide(request("/admin", serviceToken))).toEqual({
      allowed: false,
      denial: { reason: "missing-email" },
    });
  });

  it("the log says why a token failed, but never the token or the email", async () => {
    const expired = await token({ expiresAt: Math.floor(Date.now() / 1000) - 1 });
    const next = vi.fn(async () => new Response("panel"));
    await gate(request("/admin", expired), next);

    const logged = [...warnLog.mock.calls, ...errorLog.mock.calls].flat().join("\n");
    expect(logged).toContain("ERR_JWT_EXPIRED");
    expect(logged).not.toContain(expired);
    expect(logged).not.toContain(ADMIN_EMAIL);
  });

  it("the remote key set is created once per team domain and reused", () => {
    expect(remoteAccessKeys(TEAM_DOMAIN)).toBe(remoteAccessKeys(TEAM_DOMAIN));
    expect(remoteAccessKeys(TEAM_DOMAIN)).not.toBe(
      remoteAccessKeys("otro-equipo.cloudflareaccess.com"),
    );
  });
});

describe("A deployed environment without Access configuration does not open the panel (v2)", () => {
  it("missing AUD: a valid token gets 403 and the log names the missing variable", async () => {
    const next = vi.fn(async () => new Response("panel"));
    const response = await gate(
      request("/admin", await token()),
      next,
      deployed("prod", { aud: "" }),
    );

    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("ACCESS_AUD"));
    expect(await response.text()).not.toContain("ACCESS_AUD");
  });

  it.for([
    ["missing", { teamDomain: undefined }, "ACCESS_TEAM_DOMAIN"],
    ["empty", { teamDomain: "" }, "ACCESS_TEAM_DOMAIN"],
    ["not an Access team domain", { teamDomain: "evil.example" }, "ACCESS_TEAM_DOMAIN"],
    ["with a path", { teamDomain: `${TEAM_DOMAIN}/certs` }, "ACCESS_TEAM_DOMAIN"],
    ["missing AUD", { aud: undefined }, "ACCESS_AUD"],
    ["blank AUD", { aud: "   " }, "ACCESS_AUD"],
  ] as const)("%s: every request is denied", async ([, overrides, variable]) => {
    for (const environment of ["dev", "stage", "prod"]) {
      const decision = await decide(
        request("/admin", await token()),
        deployed(environment, overrides),
      );
      expect(decision).toEqual({
        allowed: false,
        denial: { reason: "misconfigured", variables: [variable] },
      });
    }
  });

  it("both missing: the log names both variables", async () => {
    const config = { environment: "stage", teamDomain: undefined, aud: undefined };
    expect(await decide(request("/admin", await token()), config)).toEqual({
      allowed: false,
      denial: { reason: "misconfigured", variables: ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD"] },
    });
  });

  it.for([undefined, "", "production", "Prod", "LOCAL", " local", "development"])(
    "an ENVIRONMENT of %j is a misconfiguration, even with a valid token",
    async (environment) => {
      const decision = await decide(request("/admin", await token()), {
        ...deployed(),
        environment,
      });
      expect(decision).toEqual({
        allowed: false,
        denial: { reason: "misconfigured", variables: ["ENVIRONMENT"] },
      });
    },
  );

  it("no transitions: an admin action is refused before its handler runs", async () => {
    const handler = vi.fn(async () => {
      await requireAdmin(
        { request: request("/_actions/admin.approve", await token()) },
        { config: deployed("prod", { aud: "" }), keys },
      );
      return "approved";
    });

    await expect(handler()).rejects.toBeInstanceOf(ActionError);
  });
});

describe("Locally, a fixed identity is injected only when the environment says `local` (v2)", () => {
  const localConfig: AccessConfig = { environment: "local", teamDomain: undefined, aud: "" };

  it("local: the panel opens with the fixed identity", async () => {
    for (const origin of [LOCAL_URL, "http://127.0.0.1:4321", "http://[::1]:4321"]) {
      expect(await decide(request("/admin", undefined, origin), localConfig)).toEqual({
        allowed: true,
        identity: { email: LOCAL_ADMIN_EMAIL, source: "local" },
      });
    }
  });

  it.for(["dev", "stage", "prod"])(
    "deployed: %s rejects a request that relies on the fixed identity",
    async (environment) => {
      // Configured or not, a deployed environment never falls back to it.
      for (const config of [deployed(environment), { ...localConfig, environment }]) {
        for (const origin of [DEPLOYED_URL, LOCAL_URL]) {
          const decision = await decide(request("/admin", undefined, origin), config);
          expect(decision.allowed).toBe(false);
        }
      }
    },
  );

  it.for([undefined, "", "LOCAL", "Local", "local ", "dev,local"])(
    "deployed: an ENVIRONMENT of %j never accepts the fixed identity",
    async (environment) => {
      const decision = await decide(request("/admin", undefined, LOCAL_URL), {
        ...localConfig,
        environment,
      });
      expect(decision.allowed).toBe(false);
    },
  );

  it("deployed by mistake with the local vars: refused off a loopback host", async () => {
    const decision = await decide(
      request("/admin", undefined, "https://enmirumbo-local.urekz.workers.dev"),
      localConfig,
    );
    expect(decision).toEqual({ allowed: false, denial: { reason: "local-identity-off-loopback" } });
    expect(
      (await decide(request("/admin", undefined, "http://localhost.evil.example"), localConfig))
        .allowed,
    ).toBe(false);
  });
});

function gate(
  req: Request,
  next: () => Promise<Response>,
  config: AccessConfig = deployed(),
  routePattern = "/admin",
  locals: { admin?: { email: string; source: "access" | "local" } } = {},
) {
  return gateAdminRequest({ request: req, url: new URL(req.url), routePattern, locals }, next, {
    config,
    keys,
  });
}

describe("the /admin middleware", () => {
  it("no token: 403 with a generic body, the panel is never rendered", async () => {
    const next = vi.fn(async () => new Response("datos del panel"));
    const response = await gate(request("/admin/registros/abc123"), next, deployed(), "/404");

    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
    const body = await response.text();
    expect(body).toContain("No tienes acceso");
    expect(body).not.toContain("abc123");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("every refusal answers the same body, whatever the reason", async () => {
    const expired = await token({ expiresAt: Math.floor(Date.now() / 1000) - 1 });
    const next = vi.fn(async () => new Response("panel"));
    const bodies = await Promise.all(
      [
        gate(request("/admin"), next),
        gate(request("/admin", expired), next),
        gate(request("/admin", await token()), next, deployed("prod", { aud: "" })),
        gate(request("/admin", await token()), next, deployed("production")),
      ].map(async (response) => {
        const res = await response;
        expect(res.status).toBe(403);
        return res.text();
      }),
    );
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toMatch(/ACCESS_|ENVIRONMENT|ERR_|token|jwt/i);
  });

  it("a valid token: the page is served with the identity in locals and no-index headers", async () => {
    const locals: { admin?: { email: string; source: "access" | "local" } } = {};
    const next = vi.fn(async () => new Response("<h1>Panel</h1>", { status: 200 }));
    const response = await gate(
      request("/admin", await token()),
      next,
      deployed(),
      "/admin",
      locals,
    );

    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
    expect(locals.admin).toEqual({ email: ADMIN_EMAIL, source: "access" });
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a valid token: the headers are added even to a response with immutable headers", async () => {
    const immutable = Response.redirect(`${DEPLOYED_URL}/admin/`, 302);
    const response = await gate(request("/admin", await token()), async () => immutable);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Location")).toBe(`${DEPLOYED_URL}/admin/`);
  });

  it("the public site passes through untouched", async () => {
    for (const path of [
      "/",
      "/registro",
      "/administrador",
      "/adminx",
      "/_actions/registro.enviar",
    ]) {
      const next = vi.fn(async () => new Response("público"));
      const response = await gate(request(path), next, deployed(), "/");
      expect(response.status, path).toBe(200);
      expect(response.headers.get("X-Robots-Tag"), path).toBeNull();
      expect(next).toHaveBeenCalledOnce();
    }
  });
});

describe("which requests belong to the panel", () => {
  const url = (path: string) => new URL(`${DEPLOYED_URL}${path}`);

  it.for([
    "/admin",
    "/admin/",
    "/admin/negocios",
    "/admin/registros/abc123",
    "/ADMIN",
    "/Admin/negocios",
    "/%61dmin",
    "/%2561dmin",
    "//admin",
    "/admin%2Fregistros",
    "/%",
    "/_actions/admin.approve",
    "/_actions/Admin.approve",
    "/?_action=admin.approve",
    "/registro?_action=admin.reject",
  ])("%s is gated", (path) => {
    expect(isAdminRequest(url(path), "/")).toBe(true);
  });

  it("a request Astro routed to an admin page is gated whatever its URL", () => {
    expect(isAdminRequest(url("/cualquier-cosa"), "/admin")).toBe(true);
    expect(isAdminRequest(url("/cualquier-cosa"), "/admin/registros/[id]")).toBe(true);
  });

  it.for([
    "/",
    "/administrador",
    "/adminx",
    "/registro",
    "/_actions/registro.enviar",
    "/?_action=registro.enviar",
  ])("%s is public", (path) => {
    expect(isAdminRequest(url(path), "/")).toBe(false);
  });
});

describe("requireAdmin, the helper of admin Astro Actions", () => {
  async function forbidden(promise: Promise<unknown>) {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe("FORBIDDEN");
    expect((error as ActionError).status).toBe(403);
  }

  it("actions without a token: rejected with FORBIDDEN", async () => {
    await forbidden(
      requireAdmin({ request: request("/_actions/admin.approve") }, { config: deployed(), keys }),
    );
  });

  it("actions with a token that fails: rejected with FORBIDDEN", async () => {
    const other = await token({ audience: [OTHER_APP_AUD] });
    await forbidden(
      requireAdmin(
        { request: request("/_actions/admin.approve", other) },
        { config: deployed(), keys },
      ),
    );
  });

  it("it checks the request itself, not what locals says", async () => {
    const context = {
      request: request("/_actions/admin.approve"),
      locals: { admin: { email: ADMIN_EMAIL, source: "access" } },
    };
    await forbidden(requireAdmin(context, { config: deployed(), keys }));
  });

  it("a valid token: returns the identity of the token", async () => {
    const identity = await requireAdmin(
      { request: request("/_actions/admin.approve", await token()) },
      { config: deployed(), keys },
    );
    expect(identity).toEqual({ email: ADMIN_EMAIL, source: "access" });
  });

  it("by default it reads the Worker vars (local here, so only on loopback)", async () => {
    expect(
      await requireAdmin({ request: request("/_actions/admin.approve", undefined, LOCAL_URL) }),
    ).toEqual({ email: LOCAL_ADMIN_EMAIL, source: "local" });
    await forbidden(requireAdmin({ request: request("/_actions/admin.approve") }));
  });
});
