// Scenarios of docs/specs/admin-review.md on the decisions of the detail of a
// card, against the database: "Approving assigns trades, normalizes the zone,
// marks the origin and publishes the card", "Approving a registration
// generates its management link, unique and unrepeatable", "Rejecting
// requires a reason, stores it with its date and offers to notify by
// WhatsApp", "A transition is only applied to a registration that is still in
// review", "A rejection reason is never silently trimmed (v2)", "A failed
// approval repaints exactly the trades the admin selected (v2)", "The
// destructive actions of the admin write to the audit log with the Access
// identity (v2)", "Inside the panel, a user can do only what their roles
// allow (v2)", "The queue labels the resubmission of a rejected card, and its
// detail says why it was rejected before (v2)"; and of
// docs/specs/data-model.md, "The audit log records the destructive actions of
// the admin (v2)" and "The business keeps the rejection its resubmission
// answered (v2)". The forms are rendered in test/astro/review.test.ts and run
// end to end through Access in test/e2e/admin.spec.ts.
//
// Everything lives in the fictitious state 76 (test/worker/fixtures.ts).
// Users are of the domain decisions.enmirumbo.test and roles start with
// decisionstest_; all of it is removed before and after. Every token lives in
// memory for its test.
import { env } from "cloudflare:workers";
import { and, eq, like } from "drizzle-orm";
import { ActionError } from "astro:actions";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Permission } from "../../src/core/access/permissions.ts";
import { publishedCard } from "../../src/core/business/card.ts";
import { listedBusinesses } from "../../src/core/business/listing.ts";
import {
  adminAuditLog,
  businessTrades,
  businesses,
  roleAssignments,
  rolePermissions,
  roles,
  users,
  zones,
} from "../../src/core/db/schema/index.ts";
import { resolveManagementLink } from "../../src/core/management-link/link.ts";
import {
  MANAGEMENT_TOKEN_PATTERN,
  tokenFingerprint,
} from "../../src/core/management-link/token.ts";
import { saveRegistration } from "../../src/core/registration/save.ts";
import type { NewRegistration } from "../../src/core/registration/submission.ts";
import {
  APPROVAL_FIELDS,
  approvalCatalogue,
  approvalForm,
  type ApprovalOutcome,
  approveRegistration,
  MAX_TRADES,
  readApproval,
  submitApproval,
  validateApproval,
} from "../../src/core/review/approval.ts";
import {
  panelWhatsappLink,
  publishedMessage,
  rejectedMessage,
} from "../../src/core/review/notices.ts";
import { cameFromResubmission, reviewQueue } from "../../src/core/review/queue.ts";
import { characterCount, readReason, REASON_MAX_LENGTH } from "../../src/core/review/reason.ts";
import { registrationDetail } from "../../src/core/review/registration.ts";
import {
  REJECTION_FIELD,
  rejectionNotice,
  submitRejection,
} from "../../src/core/review/rejection.ts";
import {
  approvalActionError,
  approvalNotice,
  decisionFailure,
  REGISTRATION_ROUTE,
  rejectionActionError,
  reviewTarget,
} from "../../src/lib/review.ts";
import {
  cleanup,
  createFixture,
  db,
  type Fixture,
  insertBusiness,
  type NewBusiness,
} from "./fixtures.ts";

const STATE = "76";
const DOMAIN = "@decisions.enmirumbo.test";
const ROLE_PREFIX = "decisionstest_";
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);

let f: Fixture;
/** A zone of locality A that is hidden: the registration does not offer it, the approval does. */
let hiddenZone: { id: number; slug: string };
/** The trade slugs of the fixture, in its order. */
let tradeSlugs: [string, string, string];
let reviewer: string;

async function removeTestData(): Promise<void> {
  await db(async (tx) => {
    await tx.delete(users).where(like(users.email, `%${DOMAIN}`));
    await tx.delete(roles).where(like(roles.key, `${ROLE_PREFIX}%`));
  });
  await cleanup(STATE);
}

async function createUser(name: string): Promise<string> {
  const email = `${name}${DOMAIN}`;
  await db((tx) => tx.insert(users).values({ email, name }));
  return email;
}

async function assign(email: string, roleKey: string, localityCode: string | null): Promise<void> {
  await db(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.email, email));
    const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey));
    await tx.insert(roleAssignments).values({
      userId: user!.id,
      roleId: role!.id,
      roleScope: role!.scope,
      localityCode,
    });
  });
}

/** A locality role of this file holding exactly `granted`. */
async function role(key: string, granted: Permission[]): Promise<string> {
  const roleKey = `${ROLE_PREFIX}${key}`;
  await db(async (tx) => {
    const [row] = await tx
      .insert(roles)
      .values({ key: roleKey, name: `Rol de prueba ${key}`, scope: "locality" })
      .returning();
    for (const permissionKey of granted) {
      await tx.insert(rolePermissions).values({ roleId: row!.id, permissionKey });
    }
  });
  return roleKey;
}

beforeAll(async () => {
  await removeTestData();
  f = await createFixture(STATE);
  const [hidden] = await db((tx) =>
    tx
      .insert(zones)
      .values({
        localityCode: f.localityA,
        type: "Colonia",
        name: "Oculta",
        slug: "oculta",
        visible: false,
      })
      .returning({ id: zones.id, slug: zones.slug }),
  );
  hiddenZone = hidden!;
  tradeSlugs = [
    `giro-prueba-${STATE}-uno`,
    `giro-prueba-${STATE}-dos`,
    `giro-prueba-${STATE}-tres`,
  ];
  reviewer = await createUser("reviewer");
  await assign(reviewer, await role("review", ["businesses.review"]), f.localityA);
});

afterAll(removeTestData);

/** A card of locality A in review, registered an hour ago. */
function card(overrides: Partial<NewBusiness> = {}): Promise<string> {
  return insertBusiness(f, { registeredAt: hoursAgo(1), ...overrides });
}

async function row(id: string) {
  const [found] = await db((tx) => tx.select().from(businesses).where(eq(businesses.id, id)));
  return found;
}

async function tradesOf(id: string): Promise<number[]> {
  const rows = await db((tx) =>
    tx
      .select({ tradeId: businessTrades.tradeId })
      .from(businessTrades)
      .where(eq(businessTrades.businessId, id))
      .orderBy(businessTrades.tradeId),
  );
  return rows.map((r) => r.tradeId);
}

async function auditOf(id: string) {
  return db((tx) => tx.select().from(adminAuditLog).where(eq(adminAuditLog.businessId, id)));
}

/** The approval form as a browser sends it. */
function approvalFormData(
  values: { trades?: string[]; zone?: string; origin?: string } = {},
): FormData {
  const form = new FormData();
  for (const trade of values.trades ?? []) form.append(APPROVAL_FIELDS.trades, trade);
  if (values.zone !== undefined) form.set(APPROVAL_FIELDS.zone, values.zone);
  form.set(APPROVAL_FIELDS.origin, values.origin ?? "organic");
  return form;
}

function rejectionFormData(reason: string): FormData {
  const form = new FormData();
  form.set(REJECTION_FIELD, reason);
  return form;
}

function approve(
  businessId: string,
  values: Parameters<typeof approvalFormData>[0] = {},
  email = reviewer,
): Promise<ApprovalOutcome> {
  return submitApproval(approvalFormData(values), { email, businessId }, { useDb: db });
}

function reject(businessId: string, reason: string, email = reviewer) {
  return submitRejection(rejectionFormData(reason), { email, businessId }, { useDb: db });
}

/** The token of an approved outcome, failing otherwise. */
function tokenOf(outcome: ApprovalOutcome): string {
  if (outcome.kind !== "approved") throw new Error(`expected an approval, got ${outcome.kind}`);
  return outcome.token;
}

describe("Approving assigns trades, normalizes the zone, marks the origin and publishes the card", () => {
  it("complete approval: published now, with its two trades and origin organic, in its listing", async () => {
    const id = await card({ origin: "seeded" });
    const before = Date.now();

    const outcome = await approve(id, {
      trades: [tradeSlugs[0], tradeSlugs[2]],
      origin: "organic",
    });

    expect(outcome.kind).toBe("approved");
    const after = await row(id);
    expect(after).toMatchObject({ status: "published", origin: "organic", zoneId: f.zoneA });
    expect(after!.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(await tradesOf(id)).toEqual([f.tradeIds[0], f.tradeIds[2]].sort((a, b) => a - b));
    // The public reads of the directory find it (through HYPERDRIVE, up to a minute late).
    expect(await db((tx) => publishedCard(tx, f.localityA, id))).toMatchObject({ id });
    const listing = await db((tx) =>
      listedBusinesses(
        tx,
        { localityCode: f.localityA, categoryId: f.categoryId, zoneId: null },
        1,
      ),
    );
    expect(listing.businesses.map((b) => b.id)).toContain(id);
  });

  it("approval without trades: published anyway, with none", async () => {
    const id = await card();
    expect((await approve(id, { trades: [] })).kind).toBe("approved");
    expect((await row(id))?.status).toBe("published");
    expect(await tradesOf(id)).toEqual([]);
  });

  it("more than three trades, or one that is not of the catalogue: nothing is published", async () => {
    const id = await card();
    for (const trades of [
      [...tradeSlugs, "otro-giro"],
      [tradeSlugs[0], "giro-inventado"],
    ]) {
      expect(await approve(id, { trades })).toEqual({
        kind: "invalid",
        errors: { trades: "too-many" },
      });
    }
    expect(await row(id)).toMatchObject({
      status: "in_review",
      publishedAt: null,
      managementTokenHash: null,
    });
    expect(await tradesOf(id)).toEqual([]);
  });

  it("the same trade twice counts once", async () => {
    const id = await card();
    const trades = [tradeSlugs[0], tradeSlugs[0], tradeSlugs[1], tradeSlugs[1]];
    expect((await approve(id, { trades })).kind).toBe("approved");
    expect(await tradesOf(id)).toHaveLength(2);
  });

  it('"Otra": without a zone nothing is published; with a visible one, the card takes it and keeps its text', async () => {
    const id = await card({ zoneId: null, zoneOther: "Rinconada del Venado" });

    expect(await approve(id, {})).toEqual({ kind: "invalid", errors: { zone: "required" } });
    for (const zone of ["zona-inventada", "Centro", " "]) {
      expect(await approve(id, { zone })).toEqual({
        kind: "invalid",
        errors: { zone: "required" },
      });
    }
    expect((await row(id))?.status).toBe("in_review");

    expect((await approve(id, { zone: "centro" })).kind).toBe("approved");
    expect(await row(id)).toMatchObject({
      status: "published",
      zoneId: f.zoneA,
      zoneOther: "Rinconada del Venado",
    });
  });

  it('"Otra" may take a hidden zone of the locality, the one the business typed and was not offered', async () => {
    const id = await card({ zoneId: null, zoneOther: "Oculta" });
    expect((await approve(id, { zone: hiddenZone.slug })).kind).toBe("approved");
    expect(await row(id)).toMatchObject({ status: "published", zoneId: hiddenZone.id });
  });

  it("a zone of another locality is no choice: the slugs are the locality's own", async () => {
    const id = await card({ zoneId: null, zoneOther: "Por allá" });
    const [onlyInB] = await db((tx) =>
      tx
        .insert(zones)
        .values({
          localityCode: f.localityB,
          type: "Colonia",
          name: "Solo en B",
          slug: "solo-en-b",
        })
        .returning({ slug: zones.slug }),
    );
    expect(await approve(id, { zone: onlyInB!.slug })).toEqual({
      kind: "invalid",
      errors: { zone: "required" },
    });
  });

  it("both errors at once, and a catalogue zone needs no choice", async () => {
    const other = await card({ zoneId: null, zoneOther: "Por allá" });
    expect(await approve(other, { trades: [...tradeSlugs, "x"] })).toEqual({
      kind: "invalid",
      errors: { trades: "too-many", zone: "required" },
    });
    const catalogued = await card();
    // A zone sent for a card that has one changes nothing.
    expect((await approve(catalogued, { zone: "centro-b" })).kind).toBe("approved");
    expect((await row(catalogued))?.zoneId).toBe(f.zoneA);
  });

  it("the seeded origin", async () => {
    const id = await card();
    expect((await approve(id, { origin: "seeded" })).kind).toBe("approved");
    expect((await row(id))?.origin).toBe("seeded");
  });

  it("approving does not edit the business data", async () => {
    const id = await card({
      name: "Datos Que No Cambian",
      whatYouOffer: "Lo de siempre",
      landline: "7719990999",
      address: "Junto a la plaza",
      openingHours: "Diario",
      facebookUrl: "https://facebook.com/datos-que-no-cambian",
    });
    const before = await row(id);
    await approve(id, { trades: [tradeSlugs[1]] });
    const after = await row(id);
    for (const field of [
      "name",
      "whatsapp",
      "whatYouOffer",
      "landline",
      "address",
      "openingHours",
      "facebookUrl",
      "categoryId",
      "photoKey",
      "registeredAt",
      "consentedToNoticeAt",
    ] as const) {
      expect(after?.[field], field).toEqual(before?.[field]);
    }
  });

  it("republishing: the form arrives with its trades and origin, and the unpublishing trace stays", async () => {
    const unpublishedAt = hoursAgo(2);
    const id = await card({
      origin: "seeded",
      publishedAt: hoursAgo(24 * 30),
      unpublishedAt,
      unpublishReason: "Lo pidió el dueño",
      managementTokenHash: "a".repeat(64),
      managementTokenCreatedAt: hoursAgo(24 * 30),
    });
    await db((tx) =>
      tx.insert(businessTrades).values(f.tradeIds.map((tradeId) => ({ businessId: id, tradeId }))),
    );

    const form = await db((tx) =>
      approvalForm(tx, { id, localityCode: f.localityA, origin: "seeded" }),
    );
    expect(form.draft).toEqual({ trades: tradeSlugs, zone: "", origin: "seeded" });

    const token = tokenOf(await approve(id, { trades: [...form.draft.trades], origin: "seeded" }));
    const after = await row(id);
    expect(after).toMatchObject({
      status: "published",
      origin: "seeded",
      unpublishedAt,
      unpublishReason: "Lo pidió el dueño",
      managementTokenHash: await tokenFingerprint(token),
    });
    expect(after!.publishedAt!.getTime()).toBeGreaterThan(unpublishedAt.getTime());
    expect(await tradesOf(id)).toEqual([...f.tradeIds].sort((a, b) => a - b));
  });

  it("the catalogue of the form: every trade in its order, and every zone of the locality, hidden ones marked", async () => {
    const catalogue = await db((tx) => approvalCatalogue(tx, f.localityA));
    const own = catalogue.trades.filter((trade) => trade.slug.startsWith(`giro-prueba-${STATE}-`));
    expect(own.map((trade) => trade.slug)).toEqual(tradeSlugs);
    expect(catalogue.zones).toEqual([
      { id: f.zoneA, slug: "centro", displayName: "Centro", hidden: false },
      { id: hiddenZone.id, slug: "oculta", displayName: "Oculta", hidden: true },
    ]);
  });

  it("what a submission chose is read as it arrived, each trade once, any origin but seeded organic", () => {
    const form = approvalFormData({ trades: ["b", "a", "b"], zone: " centro ", origin: "otro" });
    form.append(APPROVAL_FIELDS.trades, new File(["x"], "x.txt"));
    expect(readApproval(form)).toEqual({ trades: ["b", "a"], zone: "centro", origin: "organic" });
    const catalogue = {
      trades: [
        { id: 1, slug: "a", name: "A" },
        { id: 2, slug: "b", name: "B" },
      ],
      zones: [],
    };
    // No trade ticked stays no trade ticked.
    expect(validateApproval({ trades: [], zone: "", origin: "seeded" }, catalogue, false)).toEqual({
      kind: "valid",
      approval: { tradeIds: [], zoneId: null, origin: "seeded" },
    });
    expect(MAX_TRADES).toBe(3);
  });
});

describe("Approving a registration generates its management link, unique and unrepeatable", () => {
  it("the token is 256 random bits, only its fingerprint is stored, and it opens the card's edit mode", async () => {
    const id = await card();
    const token = tokenOf(await approve(id));

    expect(token).toMatch(MANAGEMENT_TOKEN_PATTERN);
    const after = await row(id);
    expect(after?.managementTokenHash).toBe(await tokenFingerprint(token));
    expect(after?.managementTokenCreatedAt).not.toBeNull();
    expect(JSON.stringify(after)).not.toContain(token);
    expect(await db((tx) => resolveManagementLink(tx, f.localityA, token))).toMatchObject({
      businessId: id,
    });
  });

  it("two approvals give two different links", async () => {
    const [a, b] = [await card(), await card()];
    const [first, second] = [tokenOf(await approve(a)), tokenOf(await approve(b))];
    expect(first).not.toBe(second);
    expect((await row(a))?.managementTokenHash).not.toBe((await row(b))?.managementTokenHash);
  });

  it("approving twice does not change the link, the date, the trades or the origin", async () => {
    const id = await card();
    const token = tokenOf(await approve(id, { trades: [tradeSlugs[0]], origin: "seeded" }));
    const first = await row(id);

    expect(await approve(id, { trades: [tradeSlugs[1]], origin: "organic" })).toEqual({
      kind: "resolved",
    });
    const second = await row(id);
    expect(second?.managementTokenHash).toBe(await tokenFingerprint(token));
    expect(second?.publishedAt).toEqual(first?.publishedAt);
    expect(second?.origin).toBe("seeded");
    expect(await tradesOf(id)).toEqual([f.tradeIds[0]]);
  });

  it("an approval that fails leaves no link: the transaction is undone", async () => {
    const id = await card();
    const failing = () => {
      throw new Error("no randomness today");
    };
    await expect(
      db((tx) =>
        approveRegistration(
          tx,
          id,
          { tradeIds: [f.tradeIds[0]], zoneId: null, origin: "organic" },
          failing,
        ),
      ),
    ).rejects.toThrow();
    expect(await row(id)).toMatchObject({
      status: "in_review",
      publishedAt: null,
      managementTokenHash: null,
    });
    expect(await tradesOf(id)).toEqual([]);
  });
});

describe("A transition is only applied to a registration that is still in review", () => {
  it("two approvals at once: exactly one publishes, the other was already resolved", async () => {
    const id = await card();
    const outcomes = await Promise.all([
      approve(id, { trades: [tradeSlugs[0]] }),
      approve(id, { trades: [tradeSlugs[1]] }),
    ]);

    const kinds = outcomes.map((outcome) => outcome.kind).sort();
    expect(kinds).toEqual(["approved", "resolved"]);
    const winner = outcomes.find((outcome) => outcome.kind === "approved");
    expect((await row(id))?.managementTokenHash).toBe(await tokenFingerprint(tokenOf(winner!)));
    expect(await tradesOf(id)).toHaveLength(1);
  });

  it("an approval and a rejection at once: exactly one applies", async () => {
    const id = await card();
    const [approval, rejection] = await Promise.all([approve(id), reject(id, "Ya no existe")]);

    expect([approval.kind, rejection.kind].sort()).toEqual(
      (await row(id))?.status === "published" ? ["approved", "resolved"] : ["rejected", "resolved"],
    );
    const status = (await row(id))?.status;
    expect((await auditOf(id)).length).toBe(status === "rejected" ? 1 : 0);
  });

  it("rejecting something already published: it stays published, no reason, no entry", async () => {
    const id = await card({ status: "published", publishedAt: hoursAgo(5) });
    expect(await reject(id, "Tarde")).toEqual({ kind: "resolved" });
    expect(await row(id)).toMatchObject({ status: "published", rejectionReason: null });
    expect(await auditOf(id)).toEqual([]);
  });

  it("approving a rejected card, or rejecting one twice, was already resolved", async () => {
    const id = await card();
    expect(await reject(id, "Primero")).toEqual({ kind: "rejected" });
    expect(await approve(id)).toEqual({ kind: "resolved" });
    expect(await reject(id, "Segundo")).toEqual({ kind: "resolved" });
    expect((await row(id))?.rejectionReason).toBe("Primero");
    expect(await auditOf(id)).toHaveLength(1);
  });

  it("the card deleted halfway through an approval is not found, and nothing comes back", async () => {
    const id = await card();
    await db((tx) => tx.delete(businesses).where(eq(businesses.id, id)));
    expect(
      await db((tx) =>
        approveRegistration(tx, id, { tradeIds: [], zoneId: null, origin: "organic" }),
      ),
    ).toEqual({ kind: "not-found" });
    expect(await approve(id)).toEqual({ kind: "not-found" });
    expect(await reject(id, "No existe")).toEqual({ kind: "not-found" });
    expect(await row(id)).toBeUndefined();
  });
});

describe("Rejecting requires a reason, stores it with its date and offers to notify by WhatsApp", () => {
  it("rejection with a reason: rejected, with the reason and the date, out of the queue and the directory", async () => {
    const id = await card();
    const before = Date.now();
    const reason = "El número no contesta y no pudimos confirmar que el negocio exista";

    expect(await reject(id, `  ${reason}\r\n`)).toEqual({ kind: "rejected" });

    const after = await row(id);
    expect(after).toMatchObject({ status: "rejected", rejectionReason: reason });
    expect(after!.rejectedAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);
    const queue = await db((tx) =>
      reviewQueue(tx, { review: [f.localityA], edits: [] }, new Date()),
    );
    expect(queue.map((r) => r.businessId)).not.toContain(id);
    expect(await db((tx) => publishedCard(tx, f.localityA, id))).toBeNull();
  });

  it("rejection without a reason, or only spaces: nothing changes", async () => {
    const id = await card();
    for (const reason of ["", "   \n  "]) {
      expect(await reject(id, reason)).toEqual({ kind: "invalid", error: "required" });
    }
    expect(await row(id)).toMatchObject({
      status: "in_review",
      rejectedAt: null,
      rejectionReason: null,
    });
    expect(await auditOf(id)).toEqual([]);
  });

  it("501 characters are refused, 500 are saved whole, counted as a person sees them", async () => {
    const id = await card();
    expect(await reject(id, "a".repeat(REASON_MAX_LENGTH + 1))).toEqual({
      kind: "invalid",
      error: "too-long",
    });
    expect((await row(id))?.status).toBe("in_review");

    // 500 accented letters written as a letter and a combining accent.
    const accented = "é".repeat(REASON_MAX_LENGTH);
    expect(characterCount(accented)).toBe(REASON_MAX_LENGTH);
    expect(await reject(id, accented)).toEqual({ kind: "rejected" });
    expect((await row(id))?.rejectionReason).toBe(accented);
  });

  it("the reason is read as the browser shows it: CRLF is one line break, a NUL is dropped", () => {
    expect(readReason(rejectionFormData(" uno\r\ndos\u0000 "), REJECTION_FIELD)).toEqual({
      kind: "valid",
      reason: "uno\ndos",
    });
    const file = new FormData();
    file.set(REJECTION_FIELD, new File(["motivo"], "motivo.txt"));
    expect(readReason(file, REJECTION_FIELD)).toEqual({ kind: "invalid", error: "required" });
  });

  it("the confirmation shows the stored reason, only for a rejected card and who may review it", async () => {
    const id = await card({ name: "Préstamos Rápidos" });
    expect(await db((tx) => rejectionNotice(tx, { email: reviewer, businessId: id }))).toBeNull();
    await reject(id, "No publicamos préstamos informales");

    expect(await db((tx) => rejectionNotice(tx, { email: reviewer, businessId: id }))).toEqual({
      name: "Préstamos Rápidos",
      whatsapp: (await row(id))?.whatsapp,
      reason: "No publicamos préstamos informales",
      localityCode: f.localityA,
    });
    const reports = await createUser("notice-reports");
    await assign(reports, await role("notice_reports", ["reports.manage"]), f.localityA);
    for (const email of [reports, `nobody${DOMAIN}`]) {
      expect(await db((tx) => rejectionNotice(tx, { email, businessId: id }))).toBeNull();
    }
    expect(
      await db((tx) => rejectionNotice(tx, { email: reviewer, businessId: "nada" })),
    ).toBeNull();
  });
});

describe("The destructive actions of the admin write to the audit log with the Access identity (v2)", () => {
  it("a rejection writes one entry: the email, the locality, the card, reject and in_review, nothing else", async () => {
    const id = await card({ name: "Negocio Con Datos Personales" });
    await reject(id, "Motivo con datos que no van a la bitácora", reviewer.toUpperCase());

    const entries = await auditOf(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: reviewer,
      localityCode: f.localityA,
      businessId: id,
      action: "reject",
      previousStatus: "in_review",
    });
    expect(Object.keys(entries[0]!).sort()).toEqual(
      [
        "action",
        "actor",
        "businessId",
        "id",
        "localityCode",
        "occurredAt",
        "previousStatus",
      ].sort(),
    );
    expect(JSON.stringify(entries)).not.toMatch(/Datos Personales|bitácora|771999/);
  });

  it("an approval writes no entry", async () => {
    const id = await card();
    await approve(id);
    expect(await auditOf(id)).toEqual([]);
  });
});

describe("Inside the panel, a user can do only what their roles allow (v2)", () => {
  it("a locality admin of another locality is told the card does not exist, and nothing changes", async () => {
    const elsewhere = await createUser("elsewhere");
    await assign(elsewhere, "locality_admin", f.localityB);
    const id = await card();

    expect(await approve(id, {}, elsewhere)).toEqual({ kind: "not-found" });
    expect(await reject(id, "No es mío", elsewhere)).toEqual({ kind: "not-found" });
    expect((await row(id))?.status).toBe("in_review");
  });

  it("a user who sees the card but may not review it is forbidden; one with no role, not found", async () => {
    const reports = await createUser("reports-only");
    await assign(reports, await role("reports_only", ["reports.manage"]), f.localityA);
    const id = await card();

    expect(await approve(id, {}, reports)).toEqual({ kind: "forbidden" });
    expect(await reject(id, "No puedo", reports)).toEqual({ kind: "forbidden" });
    for (const email of [`nobody${DOMAIN}`, await createUser("unassigned")]) {
      expect(await approve(id, {}, email)).toEqual({ kind: "not-found" });
    }
    expect((await row(id))?.status).toBe("in_review");
  });

  it("businesses.review alone approves and rejects in its locality; a super admin anywhere", async () => {
    const admin = await createUser("super");
    await assign(admin, "super_admin", null);
    const inB = await insertBusiness(f, { localityCode: f.localityB, zoneId: f.zoneB });

    expect((await approve(await card())).kind).toBe("approved");
    expect(await approve(inB)).toEqual({ kind: "not-found" });
    expect((await approve(inB, {}, admin)).kind).toBe("approved");
  });
});

describe("The business keeps the rejection its resubmission answered (v2)", () => {
  const registration = (whatsapp: string): NewRegistration => ({
    name: "Reenvío Corregido",
    categoryId: f.categoryId,
    whatsapp,
    postalCode: f.postalCodeA,
    zoneId: f.zoneA,
    zoneOther: null,
    whatYouOffer: null,
    homeDelivery: false,
    landline: null,
    address: null,
    openingHours: null,
    facebookUrl: null,
  });

  it("a resubmission keeps the reason and its date, the queue says Reenvío and the detail shows it", async () => {
    const id = await card({ name: "Reenvío Original" });
    await reject(id, "La foto tenía personas");
    const rejected = await row(id);

    const outcome = await db((tx) =>
      saveRegistration(tx, f.localityA, registration(rejected!.whatsapp)),
    );
    expect(outcome.kind).toBe("resubmitted");
    const resubmitted = await row(id);
    expect(resubmitted).toMatchObject({
      status: "in_review",
      rejectedAt: null,
      rejectionReason: null,
      previousRejectedAt: rejected?.rejectedAt,
      previousRejectionReason: "La foto tenía personas",
    });

    const queue = await db((tx) =>
      reviewQueue(tx, { review: [f.localityA], edits: [] }, new Date()),
    );
    expect(queue.find((r) => r.businessId === id)).toMatchObject({
      resubmitted: true,
      unpublished: false,
    });
    const fresh = await card();
    const again = await db((tx) =>
      reviewQueue(tx, { review: [f.localityA], edits: [] }, new Date()),
    );
    expect(again.find((r) => r.businessId === fresh)).toMatchObject({ resubmitted: false });

    expect(await db((tx) => registrationDetail(tx, id))).toMatchObject({
      previousRejectedAt: rejected?.rejectedAt,
      previousRejectionReason: "La foto tenía personas",
    });
  });

  it("a second rejection and resubmission keep the latest; approving and unpublishing keep it, and then the card is not Reenvío", async () => {
    const id = await card();
    await reject(id, "Primera vez");
    const { whatsapp } = (await row(id))!;
    await db((tx) => saveRegistration(tx, f.localityA, registration(whatsapp)));
    await reject(id, "Segunda vez");
    await db((tx) => saveRegistration(tx, f.localityA, registration(whatsapp)));
    expect((await row(id))?.previousRejectionReason).toBe("Segunda vez");

    await approve(id);
    expect((await row(id))?.previousRejectionReason).toBe("Segunda vez");
    await db((tx) =>
      tx
        .update(businesses)
        .set({ status: "in_review", unpublishedAt: new Date(), unpublishReason: "Cerró" })
        .where(and(eq(businesses.id, id), eq(businesses.status, "published"))),
    );
    const queued = (
      await db((tx) => reviewQueue(tx, { review: [f.localityA], edits: [] }, new Date()))
    ).find((r) => r.businessId === id);
    expect(queued).toMatchObject({ resubmitted: false, unpublished: true });
  });

  it("which cards are Reenvío, by their dates", () => {
    const registered = hoursAgo(2);
    expect(cameFromResubmission(registered, null, hoursAgo(5))).toBe(true);
    expect(cameFromResubmission(registered, hoursAgo(1), hoursAgo(5))).toBe(false);
    expect(cameFromResubmission(registered, hoursAgo(3), hoursAgo(5))).toBe(true);
    expect(cameFromResubmission(registered, null, null)).toBe(false);
  });

  it("the previous rejection is written in pairs", async () => {
    await expect(
      card({ previousRejectedAt: new Date(), previousRejectionReason: null }),
    ).rejects.toThrow();
  });
});

describe("The WhatsApp notices of the decisions", () => {
  it("the publication notice carries both links, with the spec's text", () => {
    expect(
      publishedMessage(
        "Estética Lupita",
        "https://example.test/ficha",
        "https://example.test/editar/x",
      ),
    ).toBe(
      "¡Listo! Ya quedó publicado «Estética Lupita» en enmirumbo. Esta es tu ficha: https://example.test/ficha — compártela con tus clientes. Y este es tu enlace para editarla: https://example.test/editar/x — guarda este mensaje (puedes destacarlo con la estrella), con ese enlace actualizas tus datos cuando quieras.",
    );
  });

  it("the rejection notice carries the reason, with the spec's text", () => {
    expect(rejectedMessage("Préstamos Rápidos", "No publicamos préstamos informales")).toBe(
      "Hola, revisamos el registro de «Préstamos Rápidos» en enmirumbo y por ahora no lo pudimos publicar: No publicamos préstamos informales. Si lo corriges, lo puedes volver a enviar desde el mismo formulario con este mismo número.",
    );
  });

  it("each opens the conversation with the number, or nothing for one that is not ten digits", () => {
    expect(panelWhatsappLink("7719990101", "Hola y adiós")).toBe(
      "https://wa.me/527719990101?text=Hola%20y%20adi%C3%B3s",
    );
    expect(panelWhatsappLink("12345", "Hola")).toBeNull();
  });
});

describe("The decisions between Astro and the core (src/lib/review.ts)", () => {
  it("an action decides only from the detail's address, never from another page or /_actions/", () => {
    expect(reviewTarget({ routePattern: REGISTRATION_ROUTE, params: { id: "abc" } })).toBe("abc");
    for (const routePattern of [
      "/_actions/[...path]",
      "/admin",
      "/[state]/[municipality]/registro",
    ]) {
      expect(reviewTarget({ routePattern, params: { id: "abc" } })).toBeNull();
    }
  });

  it("each outcome travels as its status and comes back as what the page shows", () => {
    const cases: [ActionError | null, string, unknown][] = [
      [approvalActionError({ kind: "not-found" }), "approval", { kind: "not-found" }],
      [approvalActionError({ kind: "forbidden" }), "approval", { kind: "forbidden" }],
      [approvalActionError({ kind: "resolved" }), "approval", { kind: "resolved" }],
      [
        approvalActionError({ kind: "invalid", errors: { trades: "too-many", zone: "required" } }),
        "approval",
        { kind: "approval", errors: { trades: "too-many", zone: "required" } },
      ],
      [
        approvalActionError({ kind: "invalid", errors: { zone: "required" } }),
        "approval",
        { kind: "approval", errors: { zone: "required" } },
      ],
      [
        rejectionActionError({ kind: "invalid", error: "too-long" }),
        "rejection",
        { kind: "rejection", error: "too-long" },
      ],
      [rejectionActionError({ kind: "resolved" }), "rejection", { kind: "resolved" }],
    ];
    for (const [error, form, failure] of cases) {
      expect(error).toBeInstanceOf(ActionError);
      expect(decisionFailure(error!, form as "approval" | "rejection")).toEqual(failure);
    }
    expect(approvalActionError({ kind: "resolved" })?.status).toBe(409);
    expect(rejectionActionError({ kind: "invalid", error: "required" })?.status).toBe(400);
    expect(rejectionActionError({ kind: "rejected" })).toBeNull();
    // What the action did not throw is a failure to save, never an invented
    // error, and a body Astro refused unread is not read again.
    for (const error of [
      new ActionError({ code: "BAD_REQUEST", message: "trades,zone" }),
      new ActionError({ code: "BAD_REQUEST", message: "" }),
      new ActionError({ code: "CONTENT_TOO_LARGE" }),
      new ActionError({ code: "UNSUPPORTED_MEDIA_TYPE" }),
    ]) {
      expect(decisionFailure(error, "approval")).toEqual({ kind: "server", keepsDraft: false });
      expect(decisionFailure(error, "rejection")).toEqual({ kind: "server", keepsDraft: false });
    }
    // A failure while saving keeps what the admin sent.
    expect(decisionFailure(new ActionError({ code: "INTERNAL_SERVER_ERROR" }), "approval")).toEqual(
      {
        kind: "server",
        keepsDraft: true,
      },
    );
  });

  it("the notice of an approval: the card's public address and the management link, absolute", async () => {
    const id = await card({ name: "Plomería Güicho" });
    const outcome = await approve(id);
    if (outcome.kind !== "approved") throw new Error("not approved");

    const notice = approvalNotice(env, outcome);
    expect(notice.name).toBe("Plomería Güicho");
    expect(notice.cardUrl).toMatch(
      new RegExp(
        `^https?://[^/]+/estado-de-prueba-${STATE}/pueblo-uno/negocio/plomeria-guicho-${id}$`,
      ),
    );
    expect(notice.managementUrl).toBe(
      notice.cardUrl!.replace(/\/negocio\/.*$/, `/editar/${outcome.token}`),
    );
    expect(approvalNotice({ ENVIRONMENT: "prod" }, outcome)).toMatchObject({
      cardUrl: null,
      managementUrl: null,
    });
  });
});
