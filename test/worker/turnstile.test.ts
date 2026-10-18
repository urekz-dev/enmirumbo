// Scenarios of docs/specs/business-registration.md, "The registration and edit
// forms are protected by quotas, honeypot and Turnstile (v2)" (a valid
// Turnstile token; a missing or invalid token; the kill switch; test keys)
// and "Turnstile is checked on the server, fails closed and has a switch in
// the database (v2)"; and of docs/specs/data-model.md, "The site's switches
// live in one row of the database (v2)". Below the page: the keys
// (src/core/turnstile/keys.ts), the check of a token with siteverify, which
// a fake fetch answers (src/core/turnstile/verify.ts), the switch
// (src/core/settings/settings.ts), the check of a submission
// (src/core/turnstile/check.ts), the Worker's verifier and site key
// (src/lib/turnstile.ts), and the registration with all of it
// (src/core/registration/submit.ts, src/lib/registration.ts). The widget is
// rendered in test/astro/registration.test.ts and runs end to end in
// test/e2e/registration.spec.ts.
//
// No test reaches Cloudflare. The switch is turned off only inside a
// transaction that is rolled back, so the files that run at the same time
// always see it on. The businesses belong to the fixture localities of this
// file, which `cleanup` removes; every address is from 198.51.100.0/24 and
// every number follows 771999xxxx.
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { Db } from "../../src/core/db/client.ts";
import { businesses, siteSettings } from "../../src/core/db/schema/index.ts";
import { HONEYPOT_FIELD } from "../../src/core/forms/honeypot.ts";
import { NOTICE_VERSION } from "../../src/core/legal/version.ts";
import {
  GENERAL_ERROR_MESSAGES,
  REGISTRATION_FIELDS as F,
} from "../../src/core/registration/submission.ts";
import {
  submitRegistration,
  type SubmitRegistrationDeps,
} from "../../src/core/registration/submit.ts";
import { isTurnstileEnabled } from "../../src/core/settings/settings.ts";
import {
  checkTurnstile,
  passesTurnstile,
  turnstileToken,
  type VerifyTurnstile,
} from "../../src/core/turnstile/check.ts";
import {
  isTurnstileTestKey,
  isUsableSiteKey,
  TURNSTILE_DUMMY_TOKEN,
  TURNSTILE_FAILED_MESSAGE,
  TURNSTILE_RESPONSE_FIELD,
  TURNSTILE_SITE_KEY_PATTERN,
  TURNSTILE_TEST_SECRET_KEYS,
  TURNSTILE_TEST_SITE_KEYS,
} from "../../src/core/turnstile/keys.ts";
import {
  MAX_TOKEN_LENGTH,
  SITEVERIFY_URL,
  type VerifyTurnstileOptions,
  verifyTurnstileToken,
} from "../../src/core/turnstile/verify.ts";
import { CLIENT_IP_HEADER, takeQuota } from "../../src/lib/quota/quota.ts";
import { registrationActionError, registrationPageFailure } from "../../src/lib/registration.ts";
import {
  SITEVERIFY_TIMEOUT_MS,
  turnstileSiteKey,
  turnstileVerifier,
} from "../../src/lib/turnstile.ts";
import { cleanup, createFixture, db, type Fixture } from "./fixtures.ts";

const STATE = "87";
let f: Fixture;
let locality: { code: string; name: string };
let categorySlug: string;

beforeAll(async () => {
  f = await createFixture(STATE);
  locality = { code: f.localityA, name: "Pueblo Uno" };
  categorySlug = `categoria-prueba-${STATE}`;
});

afterAll(async () => {
  await cleanup(STATE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A fake siteverify.

interface FakeCall {
  url: string;
  init: RequestInit;
}

/** A fetch that answers every request with `answer`, and records them. */
function fakeFetch(answer: () => Promise<Response> | Response) {
  const calls: FakeCall[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  };
  return { calls, fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SECRET = "0x4AAAAAAAfictitious-secret-key-for-tests";

function options(overrides: Partial<VerifyTurnstileOptions> = {}): VerifyTurnstileOptions {
  return {
    secret: SECRET,
    local: false,
    action: "registration",
    fetch: () => Promise.reject(new Error("no network in this test")),
    timeoutMs: 1000,
    reportProblem: () => {},
    ...overrides,
  };
}

describe("Turnstile's keys", () => {
  it("the test keys are Cloudflare's, and a real site key has another shape", () => {
    expect(TURNSTILE_TEST_SITE_KEYS.alwaysPasses).toBe("1x00000000000000000000AA");
    expect(TURNSTILE_TEST_SECRET_KEYS).toEqual({
      alwaysPasses: "1x0000000000000000000000000000000AA",
      alwaysFails: "2x0000000000000000000000000000000AA",
      alreadySpent: "3x0000000000000000000000000000000AA",
    });
    expect(TURNSTILE_DUMMY_TOKEN).toBe("XXXX.DUMMY.TOKEN.XXXX");
    expect(TURNSTILE_RESPONSE_FIELD).toBe("cf-turnstile-response");
    for (const key of [
      ...Object.values(TURNSTILE_TEST_SITE_KEYS),
      ...Object.values(TURNSTILE_TEST_SECRET_KEYS),
    ]) {
      expect(isTurnstileTestKey(key), key).toBe(true);
      expect(TURNSTILE_SITE_KEY_PATTERN.test(key), key).toBe(false);
    }
    expect(isTurnstileTestKey("0x4AAAAAAFaqP_qD38iv_oZ6")).toBe(false);
    expect(TURNSTILE_SITE_KEY_PATTERN.test("0x4AAAAAAFaqP_qD38iv_oZ6")).toBe(true);
  });

  it("a test site key may be used only on the local Worker, a real one anywhere", () => {
    const test = TURNSTILE_TEST_SITE_KEYS.alwaysPasses;
    expect(isUsableSiteKey(test, true)).toBe(true);
    expect(isUsableSiteKey(test, false)).toBe(false);
    expect(isUsableSiteKey("0x4AAAAAAFaqXxFK2fa7EiS4", false)).toBe(true);
    for (const key of ["", "REPLACE_WITH_SITE_KEY", "0x"]) {
      expect(isUsableSiteKey(key, false), key).toBe(false);
      expect(isUsableSiteKey(key, true), key).toBe(false);
    }
  });
});

describe("Turnstile is checked on the server, fails closed and has a switch in the database (v2): the token", () => {
  // Scenario: a missing or invalid token
  it("no token, or one longer than Cloudflare issues, is refused without asking Cloudflare", async () => {
    const { calls, fetch } = fakeFetch(() => json({ success: true, action: "registration" }));
    expect(await verifyTurnstileToken(null, options({ fetch }))).toBe("missing");
    expect(await verifyTurnstileToken("", options({ fetch }))).toBe("missing");
    expect(await verifyTurnstileToken("x".repeat(MAX_TOKEN_LENGTH + 1), options({ fetch }))).toBe(
      "invalid",
    );
    expect(calls).toEqual([]);
  });

  // Scenario: a valid Turnstile token
  it("a real secret asks siteverify once, with the secret and the token and never the address", async () => {
    const { calls, fetch } = fakeFetch(() =>
      json({ success: true, action: "registration", hostname: "enmirumbo.urekz.workers.dev" }),
    );
    expect(await verifyTurnstileToken("real-token", options({ fetch }))).toBe("valid");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(SITEVERIFY_URL);
    expect(call?.url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(call?.init.body).toBeInstanceOf(URLSearchParams);
    const body = call?.init.body as URLSearchParams;
    expect([...body.keys()].sort()).toEqual(["response", "secret"]);
    expect(body.get("secret")).toBe(SECRET);
    expect(body.get("response")).toBe("real-token");
  });

  // Scenario: a missing or invalid token
  it("every answer that is not a success of this form's action is refused", async () => {
    const cases: [unknown, number, string][] = [
      [{ success: true, action: "edit" }, 200, "invalid"],
      [{ success: true }, 200, "invalid"],
      [{ success: false, "error-codes": ["timeout-or-duplicate"] }, 200, "invalid"],
      [{ success: false, "error-codes": ["invalid-input-response"] }, 200, "invalid"],
      [{ success: false, "error-codes": [] }, 200, "invalid"],
      [{ success: false, "error-codes": ["internal-error"] }, 200, "unavailable"],
      [{ success: true, action: "registration" }, 500, "unavailable"],
      ["not an object", 200, "unavailable"],
      [null, 200, "unavailable"],
    ];
    for (const [body, status, verdict] of cases) {
      const { fetch } = fakeFetch(() => json(body, status));
      expect(await verifyTurnstileToken("a-token", options({ fetch })), JSON.stringify(body)).toBe(
        verdict,
      );
    }
    const html = fakeFetch(() => new Response("<html>", { status: 200 }));
    expect(await verifyTurnstileToken("a-token", options({ fetch: html.fetch }))).toBe(
      "unavailable",
    );
  });

  it("siteverify unreachable, or slower than the timeout, refuses the token", async () => {
    const down = fakeFetch(() => Promise.reject(new TypeError("Network connection lost")));
    expect(await verifyTurnstileToken("a-token", options({ fetch: down.fetch }))).toBe(
      "unavailable",
    );

    // A siteverify that answers only when the request is given up.
    const slow = async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const started = Date.now();
    expect(await verifyTurnstileToken("a-token", options({ fetch: slow, timeoutMs: 50 }))).toBe(
      "unavailable",
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(SITEVERIFY_TIMEOUT_MS).toBe(3000);
  });

  it("a secret Cloudflare refuses is reported, never with the token", async () => {
    const report = vi.fn();
    const { fetch } = fakeFetch(() =>
      json({ success: false, "error-codes": ["invalid-input-secret"] }),
    );
    expect(
      await verifyTurnstileToken("token-of-a-person", options({ fetch, reportProblem: report })),
    ).toBe("unavailable");
    expect(report).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report.mock.calls)).not.toContain("token-of-a-person");
    expect(JSON.stringify(report.mock.calls)).not.toContain(SECRET);
  });

  // Scenario: test keys
  it("locally, the test secrets are emulated without network, as Cloudflare answers them", async () => {
    const { calls, fetch } = fakeFetch(() => json({ success: true, action: "registration" }));
    const local = (secret: string | undefined, token: string) =>
      verifyTurnstileToken(token, options({ secret, local: true, fetch }));
    // No secret is the always-pass test secret.
    expect(await local(undefined, TURNSTILE_DUMMY_TOKEN)).toBe("valid");
    expect(await local("", TURNSTILE_DUMMY_TOKEN)).toBe("valid");
    expect(await local(undefined, "a-real-token")).toBe("invalid");
    expect(await local(TURNSTILE_TEST_SECRET_KEYS.alwaysPasses, TURNSTILE_DUMMY_TOKEN)).toBe(
      "valid",
    );
    expect(await local(TURNSTILE_TEST_SECRET_KEYS.alwaysPasses, "a-real-token")).toBe("invalid");
    expect(await local(TURNSTILE_TEST_SECRET_KEYS.alwaysFails, TURNSTILE_DUMMY_TOKEN)).toBe(
      "invalid",
    );
    expect(await local(TURNSTILE_TEST_SECRET_KEYS.alreadySpent, TURNSTILE_DUMMY_TOKEN)).toBe(
      "invalid",
    );
    expect(await local(undefined, "")).toBe("missing");
    expect(calls).toEqual([]);
  });

  it("outside the local Worker no dummy token passes: a test secret or none refuses everything, and a real secret the dummy token", async () => {
    const report = vi.fn();
    const { calls, fetch } = fakeFetch(() => json({ success: true, action: "registration" }));
    const deployed = (secret: string | undefined, token = TURNSTILE_DUMMY_TOKEN) =>
      verifyTurnstileToken(token, options({ secret, fetch, reportProblem: report }));
    for (const secret of Object.values(TURNSTILE_TEST_SECRET_KEYS)) {
      expect(await deployed(secret), secret).toBe("invalid");
      expect(await deployed(secret, "a-real-token"), secret).toBe("invalid");
    }
    expect(await deployed(undefined)).toBe("unavailable");
    expect(await deployed("  ")).toBe("unavailable");
    expect(await deployed(SECRET)).toBe("invalid");
    expect(calls).toEqual([]);
    expect(report.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("TURNSTILE_SECRET_KEY is a test key outside the local Worker"),
        expect.stringContaining("TURNSTILE_SECRET_KEY is not set"),
      ]),
    );
  });

  it("the Worker's verifier: the local Worker emulates, a deployed one asks siteverify with its secret", async () => {
    const local = turnstileVerifier({ ENVIRONMENT: "local" }, () => {
      throw new Error("no network locally");
    });
    expect(await local(TURNSTILE_DUMMY_TOKEN, "registration")).toBe("valid");
    expect(env.ENVIRONMENT).toBe("local");
    expect(await turnstileVerifier(env)(TURNSTILE_DUMMY_TOKEN, "registration")).toBe("valid");

    const { calls, fetch } = fakeFetch(() => json({ success: true, action: "registration" }));
    const prod = turnstileVerifier({ ENVIRONMENT: "prod", TURNSTILE_SECRET_KEY: SECRET }, fetch);
    expect(await prod("a-real-token", "registration")).toBe("valid");
    expect(await prod(TURNSTILE_DUMMY_TOKEN, "registration")).toBe("invalid");
    expect(calls).toHaveLength(1);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const misconfigured = turnstileVerifier({
      ENVIRONMENT: "stage",
      TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEYS.alwaysPasses,
    });
    expect(await misconfigured(TURNSTILE_DUMMY_TOKEN, "registration")).toBe("invalid");
    expect(await misconfigured(TURNSTILE_DUMMY_TOKEN, "registration")).toBe("invalid");
    // Once per isolate, never per request.
    expect(
      error.mock.calls.flat().filter((line) => String(line).includes("test key")),
    ).toHaveLength(1);
  });

  it("the site key of the widget: the environment's, and a test key only on the local Worker", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(turnstileSiteKey(env)).toBe(TURNSTILE_TEST_SITE_KEYS.alwaysPasses);
    expect(
      turnstileSiteKey({ ENVIRONMENT: "prod", TURNSTILE_SITE_KEY: "0x4AAAAAAFaqP_qD38iv_oZ6" }),
    ).toBe("0x4AAAAAAFaqP_qD38iv_oZ6");
    expect(
      turnstileSiteKey({
        ENVIRONMENT: "dev",
        TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEYS.alwaysPasses,
      }),
    ).toBeNull();
    expect(turnstileSiteKey({ ENVIRONMENT: "dev", TURNSTILE_SITE_KEY: "" })).toBeNull();
    expect(turnstileSiteKey({ ENVIRONMENT: "dev", TURNSTILE_SITE_KEY: "" })).toBeNull();
    expect(error.mock.calls.flat()).toEqual([
      expect.stringContaining('"dev" environment, so the forms that need Turnstile cannot be sent'),
    ]);
  });
});

// ---------------------------------------------------------------------------
// The switch, inside transactions that are rolled back.

const ROLLBACK = new Error("rollback");

/**
 * Runs `run` with a connection where the switch is `enabled`, inside a
 * transaction that is rolled back afterwards, so nothing it writes stays and
 * no other test file sees the switch change.
 */
async function withSwitch<T>(enabled: boolean | null, run: (db: Db) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await db(async (connection) => {
    try {
      await connection.transaction(async (tx) => {
        if (enabled === null) await tx.delete(siteSettings);
        else await tx.update(siteSettings).set({ turnstileEnabled: enabled });
        result = await run(tx as unknown as Db);
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  });
  return result as T;
}

describe("The site's switches live in one row of the database (v2)", () => {
  it("the migrations leave one row, with Turnstile on", async () => {
    const rows = await db((tx) => tx.select().from(siteSettings));
    expect(rows).toEqual([{ singleton: true, turnstileEnabled: true }]);
    expect(await db(isTurnstileEnabled)).toBe(true);
  });

  it("the switch reads what the row says, and on when the row is missing", async () => {
    expect(await withSwitch(false, isTurnstileEnabled)).toBe(false);
    expect(await withSwitch(true, isTurnstileEnabled)).toBe(true);
    expect(await withSwitch(null, isTurnstileEnabled)).toBe(true);
    // Nothing stayed.
    expect(await db(isTurnstileEnabled)).toBe(true);
  });

  it("a second row cannot exist", async () => {
    await expect(
      db((tx) => tx.insert(siteSettings).values({ singleton: false, turnstileEnabled: false })),
    ).rejects.toThrow();
    await expect(db((tx) => tx.insert(siteSettings).values({ singleton: true }))).rejects.toThrow();
  });
});

describe("Turnstile is checked on the server, fails closed and has a switch in the database (v2): a submission", () => {
  const withToken = (token?: string | Blob) => {
    const data = new FormData();
    if (token !== undefined) data.append(TURNSTILE_RESPONSE_FIELD, token);
    return data;
  };

  it("the token is the first value of its field, when it is text", () => {
    expect(turnstileToken(withToken("abc"))).toBe("abc");
    expect(turnstileToken(withToken(""))).toBeNull();
    expect(turnstileToken(withToken())).toBeNull();
    expect(turnstileToken(withToken(new Blob(["abc"])))).toBeNull();
    expect(passesTurnstile("off")).toBe(true);
    expect(passesTurnstile("valid")).toBe(true);
    for (const verdict of ["missing", "invalid", "unavailable"] as const) {
      expect(passesTurnstile(verdict)).toBe(false);
    }
  });

  // Scenario: the kill switch
  it("with the switch off nothing is asked; with it on the token is checked, and a refusal is logged without it", async () => {
    const verify = vi.fn<VerifyTurnstile>(async () => "invalid");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      await withSwitch(false, (tx) => checkTurnstile(tx, withToken(), "registration", verify)),
    ).toBe("off");
    expect(verify).not.toHaveBeenCalled();

    const token = "token-of-a-person";
    expect(await db((tx) => checkTurnstile(tx, withToken(token), "registration", verify))).toBe(
      "invalid",
    );
    expect(verify).toHaveBeenCalledWith(token, "registration");
    expect(log).toHaveBeenCalledWith("turnstile: a registration was refused (invalid token)");
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------
// The registration with Turnstile.

let phone = 0;
const newPhone = () => `771999${6000 + ++phone}`;
let lastAddress = 150;
const newAddress = () => `198.51.100.${++lastAddress}`;

/** A valid submission of locality A, with `token` (none when undefined). */
function submission(token?: string, overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [HONEYPOT_FIELD]: "",
    [F.name]: "Cerrajería de Mentiras",
    [F.category]: categorySlug,
    [F.whatsapp]: newPhone(),
    [F.zone]: "Centro",
    [F.noticeVersion]: NOTICE_VERSION,
    [F.consent]: "on",
    ...(token === undefined ? {} : { [TURNSTILE_RESPONSE_FIELD]: token }),
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

/** The number a submission of `submission` carries. */
const whatsappOf = (data: FormData) => data.get(F.whatsapp) as string;

/** Dependencies that count the quota and use `verify`, on `useDb`. */
function counted(
  verify: VerifyTurnstile,
  useDb: SubmitRegistrationDeps["useDb"] = db,
  address = newAddress(),
) {
  const calls = { quota: 0, turnstile: 0 };
  const headers = new Headers({ [CLIENT_IP_HEADER]: address });
  const deps: SubmitRegistrationDeps = {
    useDb,
    takeQuota: () => {
      calls.quota += 1;
      return takeQuota(env, headers, "registration");
    },
    verifyTurnstile: (token, action) => {
      calls.turnstile += 1;
      return verify(token, action);
    },
    // The local Images binding and media bucket; these submissions carry no photo.
    photos: { images: env.IMAGES, bucket: env.MEDIA },
  };
  return { calls, deps };
}

async function savedWith(whatsapp: string, tx: Db) {
  return tx
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.localityCode, f.localityA), eq(businesses.whatsapp, whatsapp)));
}

const local = turnstileVerifier(env);

describe("The registration and edit forms are protected by quotas, honeypot and Turnstile (v2): the registration", () => {
  // Scenario: a valid Turnstile token
  it("a valid token lets a valid registration through", async () => {
    const data = submission(TURNSTILE_DUMMY_TOKEN);
    const { calls, deps } = counted(local);
    expect(await submitRegistration(data, locality, deps)).toEqual({ kind: "received" });
    expect(calls).toEqual({ quota: 1, turnstile: 1 });
    expect(await db((tx) => savedWith(whatsappOf(data), tx))).toHaveLength(1);
  });

  // Scenario: a missing or invalid token
  it("no token, an invalid one or no answer from Cloudflare: refused, nothing saved and no quota spent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const verdicts: [string | undefined, VerifyTurnstile][] = [
      [undefined, local],
      ["a-forged-token", local],
      [TURNSTILE_DUMMY_TOKEN, async () => "invalid"],
      [TURNSTILE_DUMMY_TOKEN, async () => "unavailable"],
    ];
    for (const [token, verify] of verdicts) {
      const data = submission(token);
      const { calls, deps } = counted(verify);
      expect(await submitRegistration(data, locality, deps), String(token)).toEqual({
        kind: "turnstile",
      });
      expect(calls.quota, String(token)).toBe(0);
      expect(await db((tx) => savedWith(whatsappOf(data), tx))).toEqual([]);
    }
  });

  it("the trap field comes first, and Turnstile before the fields", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const trapped = counted(local);
    expect(
      await submitRegistration(
        submission(undefined, { [HONEYPOT_FIELD]: "https://spam.example" }),
        locality,
        trapped.deps,
      ),
    ).toEqual({ kind: "received" });
    expect(trapped.calls).toEqual({ quota: 0, turnstile: 0 });

    // Fields wrong and no token: the form says Turnstile, not the fields.
    const wrong = counted(local);
    expect(
      await submitRegistration(submission(undefined, { [F.name]: "" }), locality, wrong.deps),
    ).toEqual({ kind: "turnstile" });
    // With a token, the fields.
    expect(
      await submitRegistration(
        submission(TURNSTILE_DUMMY_TOKEN, { [F.name]: "" }),
        locality,
        wrong.deps,
      ),
    ).toEqual({ kind: "invalid", errors: { name: "required" } });
    expect(wrong.calls.quota).toBe(0);
  });

  // Scenario: the kill switch
  it("with the switch off a registration without a token is saved, and the trap field and the quota still work", async () => {
    const never: VerifyTurnstile = () => {
      throw new Error("the switch is off: nothing is asked");
    };
    const address = newAddress();
    const outcome = await withSwitch(false, async (tx) => {
      const { calls, deps } = counted(never, (run) => run(tx), address);
      const data = submission();
      const first = await submitRegistration(data, locality, deps);
      const saved = await savedWith(whatsappOf(data), tx);
      const trap = await submitRegistration(
        submission(undefined, { [HONEYPOT_FIELD]: "bot" }),
        locality,
        deps,
      );
      await submitRegistration(submission(), locality, deps);
      await submitRegistration(submission(), locality, deps);
      const fourth = await submitRegistration(submission(), locality, deps);
      return { first, saved: saved.length, trap, fourth, calls };
    });
    expect(outcome).toEqual({
      first: { kind: "received" },
      saved: 1,
      trap: { kind: "received" },
      fourth: { kind: "quota" },
      calls: { quota: 4, turnstile: 0 },
    });
  });

  it("a refusal is a 403 whose form comes back with the draft and the literal message", () => {
    const error = registrationActionError({ kind: "turnstile" });
    expect(error?.status).toBe(403);
    expect(error?.code).toBe("FORBIDDEN");
    expect(error?.message).toBe("turnstile");
    expect(registrationPageFailure(error!)).toEqual({
      errors: {},
      general: "turnstile",
      keepsDraft: true,
    });
    expect(GENERAL_ERROR_MESSAGES.turnstile).toBe(
      "No pudimos comprobar que eres una persona. Vuelve a intentarlo.",
    );
    expect(TURNSTILE_FAILED_MESSAGE).toBe(GENERAL_ERROR_MESSAGES.turnstile);
  });
});
