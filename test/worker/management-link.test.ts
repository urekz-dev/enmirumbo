// Scenarios of the management link, below the pages: docs/specs/data-model.md,
// "The business stores its management link as a fingerprint, never in
// plain"; docs/specs/admin-review.md, "Approving a registration generates its
// management link, unique and unrepeatable" (the token) and "The admin can
// generate a new link, and the previous one stops working" (what the panel
// will call, epic F); and docs/specs/business-registration.md, "A token that
// is not exactly the current one opens nothing and gives nothing away" (how a
// token is resolved). The token is src/core/management-link/token.ts, and
// issuing and resolving src/core/management-link/link.ts. The edit page that
// resolves it is run end to end in test/e2e/edit.spec.ts.
//
// The businesses belong to the fixture localities of this file, which
// `cleanup` removes, and every number follows 771999xxxx. No test here
// writes a token anywhere: each lives in memory for its test.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { Db } from "../../src/core/db/client.ts";
import { businesses } from "../../src/core/db/schema/index.ts";
import { issueManagementLink, resolveManagementLink } from "../../src/core/management-link/link.ts";
import {
  MANAGEMENT_TOKEN_BYTES,
  MANAGEMENT_TOKEN_PATTERN,
  newManagementToken,
  sameFingerprint,
  TOKEN_FINGERPRINT_PATTERN,
  tokenFingerprint,
} from "../../src/core/management-link/token.ts";
import { cleanup, createFixture, db, type Fixture, insertBusiness } from "./fixtures.ts";

const STATE = "81";
let f: Fixture;

beforeAll(async () => {
  f = await createFixture(STATE);
});

afterAll(async () => {
  await cleanup(STATE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A published card of locality A, or of `localityCode`. */
function publishedCard(overrides: Parameters<typeof insertBusiness>[1] = {}): Promise<string> {
  return insertBusiness(f, { status: "published", publishedAt: new Date(), ...overrides });
}

async function cardRow(id: string) {
  const [row] = await db((tx) => tx.select().from(businesses).where(eq(businesses.id, id)));
  return row;
}

/** `token` with the character at `index` changed for another of its alphabet. */
function altered(token: string, index: number): string {
  const swap = token[index] === "A" ? "B" : "A";
  return `${token.slice(0, index)}${swap}${token.slice(index + 1)}`;
}

/** Bytes of a base64url text. */
function decoded(token: string): Uint8Array {
  const binary = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

describe("A management token", () => {
  // Scenario: the token cannot be guessed
  it("is 256 random bits in 43 characters of base64url, different on every generation", () => {
    const random = vi.spyOn(crypto, "getRandomValues");
    const tokens = Array.from({ length: 500 }, () => newManagementToken());
    expect(random).toHaveBeenCalledTimes(500);
    for (const token of tokens) {
      expect(token).toMatch(MANAGEMENT_TOKEN_PATTERN);
      expect(decoded(token)).toHaveLength(MANAGEMENT_TOKEN_BYTES);
    }
    expect(MANAGEMENT_TOKEN_BYTES * 8).toBe(256);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  // Scenario: the database does not store the token
  it("is kept as its SHA-256 fingerprint, in hexadecimal, from which it cannot be read", async () => {
    // A known vector of SHA-256.
    expect(await tokenFingerprint("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const token = newManagementToken();
    const fingerprint = await tokenFingerprint(token);
    expect(fingerprint).toMatch(TOKEN_FINGERPRINT_PATTERN);
    expect(fingerprint).not.toContain(token);
    expect(await tokenFingerprint(token)).toBe(fingerprint);
    expect(await tokenFingerprint(altered(token, 42))).not.toBe(fingerprint);
  });

  // Requirement: a token that is not exactly the current one opens nothing
  it("fingerprints are compared character by character to the end, wherever they differ", async () => {
    const a = await tokenFingerprint("uno");
    const b = await tokenFingerprint("dos");
    expect(sameFingerprint(a, a)).toBe(true);
    expect(sameFingerprint(a, b)).toBe(false);
    expect(sameFingerprint(a, `${a.slice(0, 63)}${a[63] === "0" ? "1" : "0"}`)).toBe(false);
    expect(sameFingerprint(a, a.slice(0, 63))).toBe(false);
    // The time does not depend on where the first difference is: every
    // character of both is read even when the first one differs.
    const reads = { a: 0, b: 0 };
    const counting = (text: string, key: "a" | "b") =>
      ({
        length: text.length,
        charCodeAt: (index: number) => {
          reads[key] += 1;
          return text.charCodeAt(index);
        },
      }) as unknown as string;
    expect(sameFingerprint(counting(a, "a"), counting(`x${a.slice(1)}`, "b"))).toBe(false);
    expect(reads).toEqual({ a: 64, b: 64 });
  });
});

describe("The business stores its management link as a fingerprint, never in plain", () => {
  // Scenarios: newly registered business; the database does not store the token
  it("a published card gets a link: its fingerprint and the moment it was generated, never the token", async () => {
    const id = await publishedCard();
    expect(await cardRow(id)).toMatchObject({
      managementTokenHash: null,
      managementTokenCreatedAt: null,
    });
    const before = Date.now();
    const token = await db((tx) => issueManagementLink(tx, id));
    expect(token).toMatch(MANAGEMENT_TOKEN_PATTERN);
    const row = await cardRow(id);
    expect(row?.managementTokenHash).toBe(await tokenFingerprint(token ?? ""));
    expect(row?.managementTokenCreatedAt?.getTime()).toBeGreaterThanOrEqual(before - 5000);
    // The token is in no column of the row.
    expect(JSON.stringify(row)).not.toContain(token);
  });

  // Data-model: both fields stay null as long as the card has not been approved
  it("a card that is not published, or that does not exist, gets no link and nothing changes", async () => {
    for (const status of ["in_review", "rejected"] as const) {
      const id = await insertBusiness(
        f,
        status === "rejected"
          ? { status, rejectedAt: new Date(), rejectionReason: "No es un negocio real" }
          : { status },
      );
      const before = await cardRow(id);
      expect(await db((tx) => issueManagementLink(tx, id)), status).toBeNull();
      expect(await cardRow(id), status).toEqual(before);
    }
    expect(await db((tx) => issueManagementLink(tx, "zzzzzzzzzz"))).toBeNull();
  });

  // Scenarios: each approval gets a new link; two businesses cannot share a fingerprint
  it("two cards get two different links", async () => {
    const [one, two] = [await publishedCard(), await publishedCard()];
    const tokens = await db(async (tx) => [
      await issueManagementLink(tx, one),
      await issueManagementLink(tx, two),
    ]);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect((await cardRow(one))?.managementTokenHash).not.toBe(
      (await cardRow(two))?.managementTokenHash,
    );
  });

  // Scenarios: regenerating replaces; regenerating invalidates the previous one
  it("a new link replaces the previous one, which stops opening the card at once", async () => {
    const id = await publishedCard();
    const first = (await db((tx) => issueManagementLink(tx, id))) ?? "";
    const firstRow = await cardRow(id);
    const second = (await db((tx) => issueManagementLink(tx, id))) ?? "";
    expect(second).not.toBe(first);
    const row = await cardRow(id);
    expect(row?.managementTokenHash).toBe(await tokenFingerprint(second));
    expect(row?.managementTokenCreatedAt?.getTime()).toBeGreaterThanOrEqual(
      firstRow?.managementTokenCreatedAt?.getTime() ?? 0,
    );
    expect(await db((tx) => resolveManagementLink(tx, f.localityA, first))).toBeNull();
    expect(await db((tx) => resolveManagementLink(tx, f.localityA, second))).toEqual({
      businessId: id,
      fingerprint: await tokenFingerprint(second),
    });
    // Nothing else of the card changed.
    const withoutLink = (card: typeof row) => ({
      ...card,
      managementTokenHash: undefined,
      managementTokenCreatedAt: undefined,
    });
    expect(withoutLink(row)).toEqual(withoutLink(firstRow));
  });

  it("issuing joins a transaction, so an approval that fails leaves no link", async () => {
    const id = await publishedCard();
    const rollback = new Error("rollback");
    await db(async (connection) => {
      await expect(
        connection.transaction(async (tx) => {
          expect(await issueManagementLink(tx, id)).toMatch(MANAGEMENT_TOKEN_PATTERN);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });
    expect((await cardRow(id))?.managementTokenHash).toBeNull();
  });
});

describe("A token that is not exactly the current one opens nothing and gives nothing away", () => {
  /**
   * What resolving `token` in `localityCode` did: its answer, how many queries
   * it made and whether it computed a fingerprint.
   */
  async function resolved(localityCode: string, token: string) {
    return db(async (tx) => {
      const select = vi.spyOn(tx, "select");
      const digest = vi.spyOn(crypto.subtle, "digest");
      const link = await resolveManagementLink(tx as Db, localityCode, token);
      const work = { queries: select.mock.calls.length, digests: digest.mock.calls.length };
      select.mockRestore();
      digest.mockRestore();
      return { link, work };
    });
  }

  // Scenarios: invented token; token invalidated by a regeneration; token of
  // a business that is not published; a token only edits its own card; the
  // link of a deleted business does not resolve
  it("every token that does not open a card takes the same single query by its fingerprint, and gives null", async () => {
    const open = await publishedCard();
    const token = (await db((tx) => issueManagementLink(tx, open))) ?? "";

    const invalidatedCard = await publishedCard();
    const invalidated = (await db((tx) => issueManagementLink(tx, invalidatedCard))) ?? "";
    await db((tx) => issueManagementLink(tx, invalidatedCard));

    const unpublishedCard = await publishedCard();
    const unpublished = (await db((tx) => issueManagementLink(tx, unpublishedCard))) ?? "";
    await db((tx) =>
      tx
        .update(businesses)
        .set({
          status: "in_review",
          unpublishedAt: new Date(),
          unpublishReason: "Cerró el local",
        })
        .where(eq(businesses.id, unpublishedCard)),
    );

    const otherLocalityCard = await publishedCard({ localityCode: f.localityB, zoneId: f.zoneB });
    const otherLocality = (await db((tx) => issueManagementLink(tx, otherLocalityCard))) ?? "";

    const deletedCard = await publishedCard();
    const deleted = (await db((tx) => issueManagementLink(tx, deletedCard))) ?? "";
    await db((tx) => tx.delete(businesses).where(eq(businesses.id, deletedCard)));

    const opened = await resolved(f.localityA, token);
    expect(opened.link?.businessId).toBe(open);
    expect(opened.work).toEqual({ queries: 1, digests: 1 });

    const closed: [string, string][] = [
      ["invented", newManagementToken()],
      ["altered at the start", altered(token, 0)],
      ["altered at the end", altered(token, 42)],
      ["invalidated", invalidated],
      ["not published", unpublished],
      ["of another locality", otherLocality],
      ["of a deleted card", deleted],
      ["empty", ""],
      ["of another shape", "../../admin"],
      ["very long", "x".repeat(4096)],
    ];
    for (const [what, closedToken] of closed) {
      const { link, work } = await resolved(f.localityA, closedToken);
      expect(link, what).toBeNull();
      expect(work, what).toEqual({ queries: 1, digests: 1 });
    }
    // The card of another locality opens in its own.
    expect((await resolved(f.localityB, otherLocality)).link?.businessId).toBe(otherLocalityCard);
  });

  // Scenario: the token does not appear in the log
  it("issuing and resolving write nothing to the log", async () => {
    const calls = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const id = await publishedCard();
    const token = (await db((tx) => issueManagementLink(tx, id))) ?? "";
    await db((tx) => resolveManagementLink(tx, f.localityA, token));
    await db((tx) => resolveManagementLink(tx, f.localityA, altered(token, 3)));
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });
});
