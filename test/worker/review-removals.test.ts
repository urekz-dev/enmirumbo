// Scenarios of docs/specs/admin-review.md on the actions of F3, against the
// database: "Unpublish a published card, with a mandatory reason and
// conditioned on the status", "On unpublishing, an offer is made to notify
// the business by WhatsApp", "The admin can generate a new link, and the
// previous one stops working", "Permanent deletion is confirmed in two steps,
// by typing a word", "Permanent deletion takes everything and leaves no trace
// of personal data", "The destructive actions of the admin write to the audit
// log with the Access identity (v2)", "Inside the panel, a user can do only
// what their roles allow (v2)" and "Unpublishing, a new link and the
// permanent deletion are forms of the detail, and their actions check
// everything again (v2)"; of docs/specs/data-model.md, "The business stores
// the trace of its unpublishing", "Permanent deletion of a business (ARCO
// operation)" and "The audit log records the destructive actions of the admin
// (v2)"; and of docs/specs/deployment.md, "Permanent deletion refuses to
// claim it deleted what it did not delete". The purge of the cache itself is
// tested in test/worker/photo-cache.test.ts, the only file that writes to
// its table: here a deletion's cache records what it is asked in memory. The
// forms are rendered in test/astro/review-removals.test.ts and run end to end
// through Access in test/e2e/admin-removals.spec.ts.
//
// Everything lives in the fictitious state 72 (test/worker/fixtures.ts).
// Users are of the domain removals.enmirumbo.test and roles start with
// removalstest_; all of it is removed before and after, and so is every
// photo object this file writes to the local media bucket. Every token lives
// in memory for its test.
import { env } from "cloudflare:workers";
import { and, eq, inArray, like } from "drizzle-orm";
import { ActionError } from "astro:actions";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { Permission } from "../../src/core/access/permissions.ts";
import { publishedCard } from "../../src/core/business/card.ts";
import {
  adminAuditLog,
  businessTrades,
  businesses,
  pendingEdits,
  reports,
  roleAssignments,
  rolePermissions,
  roles,
  users,
} from "../../src/core/db/schema/index.ts";
import { issueManagementLink, resolveManagementLink } from "../../src/core/management-link/link.ts";
import {
  MANAGEMENT_TOKEN_PATTERN,
  tokenFingerprint,
} from "../../src/core/management-link/token.ts";
import { type PhotoCache, type PurgeResult, photoCache } from "../../src/core/photos/cache.ts";
import { newPhotoKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import type { MediaBucket } from "../../src/core/photos/upload.ts";
import {
  DELETE_WORD_FIELD,
  deleteCard,
  type DeletionOutcome,
  deletionScreen,
  isDeleteWord,
  submitDeletion,
} from "../../src/core/review/deletion.ts";
import {
  issueNewLink,
  LINK_VERSION_FIELD,
  linkVersion,
  type NewLinkOutcome,
  submitNewLink,
} from "../../src/core/review/new-link.ts";
import { newLinkMessage, unpublishedMessage } from "../../src/core/review/notices.ts";
import { reviewQueue } from "../../src/core/review/queue.ts";
import {
  submitUnpublish,
  UNPUBLISH_FIELD,
  unpublishCard,
  unpublishNotice,
} from "../../src/core/review/unpublish.ts";
import {
  decisionFailure,
  DELETION_ROUTE,
  deletionActionError,
  deletionFailure,
  deletionTarget,
  newLinkActionError,
  newLinkNotice,
  REGISTRATION_ROUTE,
  reviewTarget,
  unpublishActionError,
} from "../../src/lib/review.ts";
import {
  cleanup,
  createFixture,
  db,
  fakePhone,
  type Fixture,
  insertBusiness,
  type NewBusiness,
} from "./fixtures.ts";

const STATE = "72";
const DOMAIN = "@removals.enmirumbo.test";
const ROLE_PREFIX = "removalstest_";
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);
const MEDIA = "https://media-removals.enmirumbo.test";

let f: Fixture;
/** Holds businesses.unpublish, links.manage and businesses.delete in locality A. */
let operator: string;

/** Every photo key whose objects this file wrote. */
const photos = new Set<string>();

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

/** A user of this file with a locality role holding exactly `granted` in locality A. */
async function userWith(name: string, granted: Permission[]): Promise<string> {
  const email = await createUser(name);
  await assign(email, await role(name.replaceAll("-", "_"), granted), f.localityA);
  return email;
}

beforeAll(async () => {
  await removeTestData();
  f = await createFixture(STATE);
  operator = await userWith("operator", [
    "businesses.unpublish",
    "links.manage",
    "businesses.delete",
  ]);
});

afterAll(async () => {
  await removeTestData();
  await env.MEDIA.delete([...photos].flatMap(photoObjectKeys));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A card of locality A, published a day ago, registered a month ago. */
function published(overrides: Partial<NewBusiness> = {}): Promise<string> {
  return insertBusiness(f, {
    status: "published",
    registeredAt: hoursAgo(24 * 30),
    publishedAt: hoursAgo(24),
    ...overrides,
  });
}

/** A published card with a management link, and its token. */
async function publishedWithLink(overrides: Partial<NewBusiness> = {}) {
  const id = await published(overrides);
  const token = await db((tx) => issueManagementLink(tx, id));
  if (token === null) throw new Error("no link");
  return { id, token };
}

async function row(id: string) {
  const [found] = await db((tx) => tx.select().from(businesses).where(eq(businesses.id, id)));
  return found;
}

async function auditOf(id: string) {
  return db((tx) => tx.select().from(adminAuditLog).where(eq(adminAuditLog.businessId, id)));
}

async function edit(businessId: string, values: Partial<typeof pendingEdits.$inferInsert> = {}) {
  const [inserted] = await db((tx) =>
    tx
      .insert(pendingEdits)
      .values({
        businessId,
        localityCode: f.localityA,
        name: "Nombre Propuesto de Prueba",
        categoryId: f.categoryId,
        whatsapp: fakePhone(),
        zoneId: f.zoneA,
        createdAt: hoursAgo(2),
        ...values,
      })
      .returning({ id: pendingEdits.id }),
  );
  return inserted!.id;
}

async function report(businessId: string, values: Partial<typeof reports.$inferInsert> = {}) {
  await db((tx) =>
    tx
      .insert(reports)
      .values({ businessId, localityCode: f.localityA, reason: "closed", ...values }),
  );
}

/** A photo whose two objects are in the local media bucket. */
async function storedPhoto(): Promise<string> {
  const key = newPhotoKey();
  photos.add(key);
  for (const object of photoObjectKeys(key)) {
    await env.MEDIA.put(object, new Uint8Array([7, 7, 7]));
  }
  return key;
}

async function objectsOf(photoKey: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix: `photos/${photoKey}/` });
  return listed.objects.map(({ key }) => key);
}

/**
 * The local media bucket with a cache of MEDIA that records what it is asked
 * to purge and keeps what fails in memory, as the table would.
 */
function testBucket(
  options: {
    purge?: (urls: readonly string[]) => Promise<PurgeResult>;
    defer?: (urls: readonly string[]) => Promise<void>;
    remove?: R2Bucket["delete"];
  } = {},
) {
  const purged: string[] = [];
  const deferred: string[] = [];
  const cache: PhotoCache = photoCache({
    base: MEDIA,
    purge:
      options.purge ??
      (async (urls) => {
        purged.push(...urls);
        return { ok: true };
      }),
    defer:
      options.defer ??
      (async (urls) => {
        deferred.push(...urls);
      }),
  });
  const bucket: MediaBucket = {
    photoFolder: "photos/" as const,
    put: env.MEDIA.put.bind(env.MEDIA) as R2Bucket["put"],
    delete: options.remove ?? ((keys) => env.MEDIA.delete(keys)),
    cache,
  };
  return { bucket, purged, deferred };
}

function reasonForm(reason: string): FormData {
  const form = new FormData();
  form.set(UNPUBLISH_FIELD, reason);
  return form;
}

function unpublish(businessId: string, reason: string, email = operator) {
  return submitUnpublish(reasonForm(reason), { email, businessId }, { useDb: db });
}

function versionForm(version: string): FormData {
  const form = new FormData();
  form.set(LINK_VERSION_FIELD, version);
  return form;
}

/** The version of the card's link as its detail shows it. */
async function versionOf(id: string): Promise<string> {
  return linkVersion((await row(id))?.managementTokenCreatedAt ?? null);
}

function newLink(
  businessId: string,
  version: string,
  email = operator,
  hasPublicOrigin = true,
): Promise<NewLinkOutcome> {
  return submitNewLink(versionForm(version), { email, businessId }, { useDb: db, hasPublicOrigin });
}

/** The token of an issued outcome, failing otherwise. */
function tokenOf(outcome: NewLinkOutcome): string {
  if (outcome.kind !== "issued") throw new Error(`expected a new link, got ${outcome.kind}`);
  return outcome.token;
}

function wordForm(word: string): FormData {
  const form = new FormData();
  form.set(DELETE_WORD_FIELD, word);
  return form;
}

function remove(
  businessId: string,
  word = "BORRAR",
  email = operator,
  bucket: MediaBucket = testBucket().bucket,
): Promise<DeletionOutcome> {
  return submitDeletion(wordForm(word), { email, businessId }, { useDb: db, bucket });
}

describe("Unpublish a published card, with a mandatory reason and conditioned on the status", () => {
  it("unpublish with a reason: back in review with its date and reason, out of the directory", async () => {
    const id = await published();
    expect(await db((tx) => publishedCard(tx, f.localityA, id))).not.toBeNull();
    const before = Date.now();

    expect(await unpublish(id, "El dueño nos pidió por WhatsApp que la bajáramos")).toEqual({
      kind: "unpublished",
    });

    const after = await row(id);
    expect(after).toMatchObject({
      status: "in_review",
      unpublishReason: "El dueño nos pidió por WhatsApp que la bajáramos",
    });
    expect(after!.unpublishedAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(await db((tx) => publishedCard(tx, f.localityA, id))).toBeNull();
  });

  it("without a reason, or only spaces: nothing changes and it stays published", async () => {
    const id = await published();
    for (const reason of ["", "   \n  "]) {
      expect(await unpublish(id, reason)).toEqual({ kind: "invalid", error: "required" });
    }
    expect(await row(id)).toMatchObject({
      status: "published",
      unpublishedAt: null,
      unpublishReason: null,
    });
    expect(await auditOf(id)).toEqual([]);
  });

  it("501 characters are refused and nothing is saved; 500 are saved whole", async () => {
    const id = await published();
    expect(await unpublish(id, "é".repeat(501))).toEqual({ kind: "invalid", error: "too-long" });
    expect((await row(id))?.status).toBe("published");
    const whole = `${"x".repeat(499)}🌮`;
    expect(await unpublish(id, whole)).toEqual({ kind: "unpublished" });
    expect((await row(id))?.unpublishReason).toBe(whole);
  });

  it("unpublishing something that was no longer published: nothing is saved", async () => {
    const inReview = await insertBusiness(f);
    const rejected = await insertBusiness(f, {
      status: "rejected",
      rejectedAt: hoursAgo(3),
      rejectionReason: "Motivo de prueba",
    });
    for (const id of [inReview, rejected]) {
      expect(await unpublish(id, "Tarde")).toEqual({ kind: "not-published" });
      expect(await row(id)).toMatchObject({ unpublishedAt: null, unpublishReason: null });
      expect(await auditOf(id)).toEqual([]);
    }
    expect((await row(rejected))?.status).toBe("rejected");
  });

  it("double unpublication: the first date and reason stay, and one entry of the audit log", async () => {
    const id = await published();
    expect(await unpublish(id, "Primero")).toEqual({ kind: "unpublished" });
    const first = await row(id);
    expect(await unpublish(id, "Segundo")).toEqual({ kind: "not-published" });
    const second = await row(id);
    expect(second?.unpublishReason).toBe("Primero");
    expect(second?.unpublishedAt).toEqual(first?.unpublishedAt);
    expect(await auditOf(id)).toHaveLength(1);
  });

  it("two unpublishings at once: exactly one applies", async () => {
    const id = await published();
    const outcomes = await Promise.all([unpublish(id, "Uno"), unpublish(id, "Dos")]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      "not-published",
      "unpublished",
    ]);
    expect(await auditOf(id)).toHaveLength(1);
  });

  it("unpublishing does not erase the work done, the pending edit, the reports or the earlier rejection", async () => {
    const { id, token } = await publishedWithLink({
      origin: "seeded",
      previousRejectedAt: hoursAgo(24 * 60),
      previousRejectionReason: "Motivo anterior",
    });
    await db((tx) =>
      tx.insert(businessTrades).values(f.tradeIds.map((tradeId) => ({ businessId: id, tradeId }))),
    );
    const editId = await edit(id);
    await report(id);
    const before = await row(id);

    expect(await unpublish(id, "El negocio cerró")).toEqual({ kind: "unpublished" });

    const after = await row(id);
    for (const field of [
      "name",
      "whatsapp",
      "zoneId",
      "origin",
      "publishedAt",
      "registeredAt",
      "photoKey",
      "previousRejectedAt",
      "previousRejectionReason",
      "managementTokenHash",
      "consentedToNoticeAt",
    ] as const) {
      expect(after?.[field], field).toEqual(before?.[field]);
    }
    const trades = await db((tx) =>
      tx.select().from(businessTrades).where(eq(businessTrades.businessId, id)),
    );
    expect(trades).toHaveLength(3);
    const [pending] = await db((tx) =>
      tx.select().from(pendingEdits).where(eq(pendingEdits.id, editId)),
    );
    expect(pending?.status).toBe("pending");
    expect(
      await db((tx) => tx.select().from(reports).where(eq(reports.businessId, id))),
    ).toHaveLength(1);
    // The link it had opens nothing while it is not published.
    expect(await db((tx) => resolveManagementLink(tx, f.localityA, token))).toBeNull();
  });

  it("back in the queue as an Alta nueva marked unpublished, waiting since now, in one row", async () => {
    const id = await published({ registeredAt: hoursAgo(24 * 240) });
    await edit(id);
    await unpublish(id, "Lo pidió el dueño");
    const rows = (
      await db((tx) => reviewQueue(tx, { review: [f.localityA], edits: [f.localityA] }, new Date()))
    ).filter((queued) => queued.businessId === id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "registration", unpublished: true, overdue: false });
    expect(rows[0]!.since).toEqual((await row(id))?.unpublishedAt);
  });

  it("the confirmation shows the stored reason, only for an unpublishing that happened", async () => {
    const id = await published({ name: "Tacos del Güero" });
    await unpublish(id, "El negocio cerró");
    expect(await db((tx) => unpublishNotice(tx, { email: operator, businessId: id }))).toEqual({
      name: "Tacos del Güero",
      whatsapp: (await row(id))?.whatsapp,
      reason: "El negocio cerró",
    });

    const neverPublished = await insertBusiness(f);
    const stillPublished = await published();
    const blank = await insertBusiness(f, { unpublishedAt: hoursAgo(1), unpublishReason: "  " });
    const rejectedAfter = await insertBusiness(f, {
      status: "rejected",
      rejectedAt: hoursAgo(1),
      rejectionReason: "Motivo",
      unpublishedAt: hoursAgo(2),
      unpublishReason: "Antes",
    });
    for (const businessId of [neverPublished, stillPublished, blank, rejectedAfter, "nada"]) {
      expect(await db((tx) => unpublishNotice(tx, { email: operator, businessId }))).toBeNull();
    }
    // Only for who may unpublish in the card's locality.
    const reviewer = await userWith("notice-reviewer", ["businesses.review"]);
    expect(await db((tx) => unpublishNotice(tx, { email: reviewer, businessId: id }))).toBeNull();
  });

  it("when its entry of the audit log cannot be written, the card stays published", async () => {
    const id = await published();
    // An Access email of only spaces breaks the entry's CHECK, so its transaction fails.
    await expect(db((tx) => unpublishCard(tx, id, "Motivo", "   "))).rejects.toThrow();
    expect(await row(id)).toMatchObject({ status: "published", unpublishedAt: null });
    expect(await auditOf(id)).toEqual([]);
  });
});

describe("The admin can generate a new link, and the previous one stops working", () => {
  it("the old link answers like an invented one and the new one opens the same card", async () => {
    const { id, token: old } = await publishedWithLink();
    const before = await row(id);
    const token = tokenOf(await newLink(id, await versionOf(id)));

    expect(token).toMatch(MANAGEMENT_TOKEN_PATTERN);
    expect(token).not.toBe(old);
    expect(await db((tx) => resolveManagementLink(tx, f.localityA, old))).toBeNull();
    expect(await db((tx) => resolveManagementLink(tx, f.localityA, token))).toMatchObject({
      businessId: id,
    });
    const after = await row(id);
    expect(after?.managementTokenHash).toBe(await tokenFingerprint(token));
    expect(JSON.stringify(after)).not.toContain(token);
    expect(after!.managementTokenCreatedAt!.getTime()).toBeGreaterThanOrEqual(
      before!.managementTokenCreatedAt!.getTime(),
    );
  });

  it("regenerating does not touch the card or its pending edit, and writes no entry of the audit log", async () => {
    const { id } = await publishedWithLink({ name: "Datos Que No Cambian" });
    const editId = await edit(id);
    const before = await row(id);
    tokenOf(await newLink(id, await versionOf(id)));
    const after = await row(id);
    for (const field of [
      "name",
      "whatsapp",
      "status",
      "publishedAt",
      "zoneId",
      "origin",
    ] as const) {
      expect(after?.[field], field).toEqual(before?.[field]);
    }
    const [pending] = await db((tx) =>
      tx.select().from(pendingEdits).where(eq(pendingEdits.id, editId)),
    );
    expect(pending?.status).toBe("pending");
    expect(await auditOf(id)).toEqual([]);
  });

  it("the form sent again issues no other link: the one just shown keeps working", async () => {
    const { id } = await publishedWithLink();
    const version = await versionOf(id);
    const token = tokenOf(await newLink(id, version));
    expect(await newLink(id, version)).toEqual({ kind: "replaced" });
    expect(await db((tx) => resolveManagementLink(tx, f.localityA, token))).toMatchObject({
      businessId: id,
    });
    for (const forged of ["", "2020-01-01T00:00:00.000Z", "cualquier cosa"]) {
      expect(await newLink(id, forged)).toEqual({ kind: "replaced" });
    }
    expect((await row(id))?.managementTokenHash).toBe(await tokenFingerprint(token));
  });

  it("two at once from the same form: exactly one link is issued", async () => {
    const { id } = await publishedWithLink();
    const version = await versionOf(id);
    const outcomes = await Promise.all([newLink(id, version), newLink(id, version)]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["issued", "replaced"]);
    const winner = outcomes.find((outcome) => outcome.kind === "issued");
    expect((await row(id))?.managementTokenHash).toBe(await tokenFingerprint(tokenOf(winner!)));
  });

  it("a published card without a link yet gets one; a card that is not published gets none", async () => {
    const id = await published();
    expect(await versionOf(id)).toBe("");
    tokenOf(await newLink(id, ""));
    for (const other of [
      await insertBusiness(f),
      await insertBusiness(f, { unpublishedAt: hoursAgo(1), unpublishReason: "Despublicada" }),
    ]) {
      expect(await newLink(other, "")).toEqual({ kind: "not-published" });
      expect((await row(other))?.managementTokenHash).toBeNull();
    }
    expect(await db((tx) => issueNewLink(tx, "nada000000", ""))).toEqual({ kind: "not-found" });
  });

  it("without a public origin nothing is issued, so the owner keeps the link they have", async () => {
    const { id, token } = await publishedWithLink();
    expect(await newLink(id, await versionOf(id), operator, false)).toEqual({
      kind: "no-site-url",
    });
    expect(await db((tx) => resolveManagementLink(tx, f.localityA, token))).toMatchObject({
      businessId: id,
    });
  });

  it("the notice: the spec's message with the new link, absolute; none without a public origin", async () => {
    const { id } = await publishedWithLink({ name: "Tacos del Güero" });
    const outcome = await newLink(id, await versionOf(id));
    if (outcome.kind !== "issued") throw new Error("not issued");
    const notice = newLinkNotice(env, outcome);
    expect(notice?.name).toBe("Tacos del Güero");
    expect(notice?.managementUrl).toMatch(
      new RegExp(`^https?://[^/]+/estado-de-prueba-${STATE}/pueblo-uno/editar/${outcome.token}$`),
    );
    expect(newLinkNotice({ ENVIRONMENT: "prod" }, outcome)).toBeNull();
    expect(newLinkMessage("Tacos del Güero", "https://x.test/e/abc")).toBe(
      "Hola, te mandamos un enlace nuevo para editar tu ficha de «Tacos del Güero» en enmirumbo: https://x.test/e/abc. El anterior ya no sirve. Guarda este mensaje (puedes destacarlo con la estrella), con ese enlace actualizas tus datos cuando quieras.",
    );
  });
});

describe("Permanent deletion is confirmed in two steps, by typing a word", () => {
  it("the first step reads the card and changes nothing", async () => {
    const id = await published({ name: "Ficha Por Borrar" });
    const before = await row(id);
    expect(await db((tx) => deletionScreen(tx, { email: operator, businessId: id }))).toEqual({
      kind: "card",
      name: "Ficha Por Borrar",
    });
    expect(await row(id)).toEqual(before);
  });

  it("only BORRAR deletes, whatever its case and the spaces around it", async () => {
    expect([" borrar ", "BORRAR", "Borrar", "\tborrar\n"].every(isDeleteWord)).toBe(true);
    expect(["borra", "", "BORRAR!", "B O R R A R", "borrar ya", "SI"].some(isDeleteWord)).toBe(
      false,
    );
    const id = await published();
    for (const word of ["borra", ""]) {
      expect(await remove(id, word)).toEqual({ kind: "invalid" });
    }
    expect(await row(id)).toBeDefined();
    expect(await auditOf(id)).toEqual([]);
    expect(await remove(id, " borrar ")).toEqual({ kind: "deleted", photoCached: false });
    expect(await row(id)).toBeUndefined();
  });
});

describe("Permanent deletion takes everything and leaves no trace of personal data", () => {
  it("a published card with trades, reports, edits, a photo and a link: all of it goes", async () => {
    const photo = await storedPhoto();
    const newPhoto = await storedPhoto();
    const discardedPhoto = await storedPhoto();
    const { id, token } = await publishedWithLink({ photoKey: photo, name: "Negocio Borrado" });
    await db((tx) =>
      tx.insert(businessTrades).values(f.tradeIds.map((tradeId) => ({ businessId: id, tradeId }))),
    );
    await report(id);
    await report(id, { status: "attended", attendedAt: hoursAgo(1) });
    await edit(id, { photoChange: "replace", newPhotoKey: newPhoto });
    await edit(id, {
      status: "discarded",
      resolvedAt: hoursAgo(5),
      photoChange: "replace",
      newPhotoKey: discardedPhoto,
      createdAt: hoursAgo(10),
    });
    await edit(id, { status: "applied", resolvedAt: hoursAgo(20), createdAt: hoursAgo(30) });
    const t = testBucket();

    expect(await remove(id, "BORRAR", operator, t.bucket)).toEqual({
      kind: "deleted",
      photoCached: false,
    });

    expect(await row(id)).toBeUndefined();
    for (const table of [businessTrades, reports, pendingEdits]) {
      expect(await db((tx) => tx.select().from(table).where(eq(table.businessId, id)))).toEqual([]);
    }
    expect(await db((tx) => resolveManagementLink(tx, f.localityA, token))).toBeNull();
    expect(await db((tx) => publishedCard(tx, f.localityA, id))).toBeNull();
    for (const key of [photo, newPhoto, discardedPhoto]) {
      expect(await objectsOf(key)).toEqual([]);
      expect(t.purged).toEqual(
        expect.arrayContaining([
          `${MEDIA}/photos/${key}/card.webp`,
          `${MEDIA}/photos/${key}/full.webp`,
        ]),
      );
    }
    expect(t.purged).toHaveLength(6);
  });

  it("the entry of the audit log survives the card and holds none of its data", async () => {
    const id = await published({ name: "Negocio Con Datos Personales", address: "Calle 1" });
    await remove(id, "BORRAR", operator.toUpperCase());
    const entries = await auditOf(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: operator,
      localityCode: f.localityA,
      businessId: id,
      action: "delete",
      previousStatus: "published",
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
    expect(JSON.stringify(entries)).not.toMatch(/Datos Personales|Calle 1|771999/);
  });

  it("a card in review and a rejected one go the same way, each with its status in the log", async () => {
    const inReview = await insertBusiness(f);
    const rejected = await insertBusiness(f, {
      status: "rejected",
      rejectedAt: hoursAgo(2),
      rejectionReason: "Motivo",
    });
    for (const [id, status] of [
      [inReview, "in_review"],
      [rejected, "rejected"],
    ] as const) {
      expect((await remove(id)).kind).toBe("deleted");
      expect(await row(id)).toBeUndefined();
      expect((await auditOf(id))[0]?.previousStatus).toBe(status);
    }
  });

  it("deleting twice: no error, nothing else, and it says the card no longer exists", async () => {
    const id = await published();
    expect((await remove(id)).kind).toBe("deleted");
    expect(await remove(id)).toEqual({ kind: "gone" });
    expect(await auditOf(id)).toHaveLength(1);
    // The rows of an identifier no card has are already gone too.
    expect(await db((tx) => deleteCard(tx, id, operator, testBucket().bucket))).toEqual({
      kind: "gone",
    });
  });

  it("the photo goes first: the card still exists while its objects are deleted", async () => {
    const photo = await storedPhoto();
    const id = await published({ photoKey: photo });
    const seen: (string | undefined)[] = [];
    const t = testBucket({
      remove: async (keys) => {
        seen.push((await row(id))?.id);
        await env.MEDIA.delete(keys);
      },
    });
    expect((await remove(id, "BORRAR", operator, t.bucket)).kind).toBe("deleted");
    expect(seen).toEqual([id]);
    expect(await objectsOf(photo)).toEqual([]);
  });

  it("a photo another card names is not touched, and a stored value that is no key is no photo", async () => {
    const own = await storedPhoto();
    const other = await storedPhoto();
    await published({ photoKey: other });
    const id = await published({ photoKey: own });
    const odd = await published({ photoKey: "foto-subida-a-mano" });
    expect((await remove(id)).kind).toBe("deleted");
    expect((await remove(odd)).kind).toBe("deleted");
    expect(await objectsOf(other)).toHaveLength(2);
  });

  it("a photo the card got between the photos and the rows is deleted after them", async () => {
    const own = await storedPhoto();
    const late = await storedPhoto();
    const id = await published({ photoKey: own });
    let first = true;
    const t = testBucket();
    const bucket: MediaBucket = {
      ...t.bucket,
      // While the card's own photo is deleted, an edit with a new photo arrives.
      delete: async (keys) => {
        if (first) {
          first = false;
          await edit(id, { photoChange: "replace", newPhotoKey: late });
        }
        await env.MEDIA.delete(keys);
      },
    };
    expect((await remove(id, "BORRAR", operator, bucket)).kind).toBe("deleted");
    expect(await objectsOf(own)).toEqual([]);
    expect(await objectsOf(late)).toEqual([]);
    expect(t.purged.toSorted()).toEqual(
      [own, late]
        .flatMap((key) => [`${MEDIA}/photos/${key}/card.webp`, `${MEDIA}/photos/${key}/full.webp`])
        .toSorted(),
    );
  });
});

describe("Permanent deletion refuses to claim it deleted what it did not delete", () => {
  it("the card has a photo and the storage does not respond: the card stays in full", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const photo = await storedPhoto();
    const id = await published({ photoKey: photo });
    await report(id);
    await edit(id);
    const before = await row(id);
    const t = testBucket({ remove: () => Promise.reject(new TypeError("R2 down")) });

    expect(await remove(id, "BORRAR", operator, t.bucket)).toEqual({ kind: "storage" });

    expect(await row(id)).toEqual(before);
    expect(
      await db((tx) => tx.select().from(reports).where(eq(reports.businessId, id))),
    ).toHaveLength(1);
    expect(
      await db((tx) => tx.select().from(pendingEdits).where(eq(pendingEdits.businessId, id))),
    ).toHaveLength(1);
    expect(await auditOf(id)).toEqual([]);
    expect(await objectsOf(photo)).toHaveLength(2);
    expect(t.purged).toEqual([]);
  });

  it("the card has no photo: it is deleted even with the storage down", async () => {
    const remove_ = vi.fn(() => Promise.reject(new TypeError("R2 down")));
    const id = await published();
    const t = testBucket({ remove: remove_ });
    expect(await remove(id, "BORRAR", operator, t.bucket)).toEqual({
      kind: "deleted",
      photoCached: false,
    });
    expect(remove_).not.toHaveBeenCalled();
  });

  it("a purge that fails: the card is deleted, and it says its photo may still be seen a while", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const photo = await storedPhoto();
    const id = await published({ photoKey: photo });
    const t = testBucket({ purge: async () => ({ ok: false, failure: "HTTP 503" }) });
    expect(await remove(id, "BORRAR", operator, t.bucket)).toEqual({
      kind: "deleted",
      photoCached: true,
    });
    expect(await row(id)).toBeUndefined();
    expect(await objectsOf(photo)).toEqual([]);
    // Only the photo's addresses wait for the retry: nothing of the card.
    expect(t.deferred.toSorted()).toEqual([
      `${MEDIA}/photos/${photo}/card.webp`,
      `${MEDIA}/photos/${photo}/full.webp`,
    ]);
  });

  it("a purge that fails and cannot be kept for the retry: the card stays, since only it knows the key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const photo = await storedPhoto();
    const id = await published({ photoKey: photo });
    const t = testBucket({
      purge: async () => ({ ok: false, failure: "HTTP 503" }),
      defer: () => Promise.reject(new TypeError("database down")),
    });
    expect(await remove(id, "BORRAR", operator, t.bucket)).toEqual({ kind: "storage" });
    expect((await row(id))?.photoKey).toBe(photo);
    expect(await auditOf(id)).toEqual([]);
    // A new attempt, with the cache back, deletes it.
    expect((await remove(id)).kind).toBe("deleted");
  });

  it("when the rows cannot be deleted, nothing of them is, and it says whether the photo already went", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const photo = await storedPhoto();
    const withPhoto = await published({ photoKey: photo });
    const withoutPhoto = await published();
    // An Access email of only spaces breaks the entry's CHECK, so the transaction fails.
    for (const [id, photoRemoved] of [
      [withPhoto, true],
      [withoutPhoto, false],
    ] as const) {
      expect(await db((tx) => deleteCard(tx, id, "   ", testBucket().bucket))).toEqual({
        kind: "failed",
        photoRemoved,
      });
      expect(await row(id)).toBeDefined();
      expect(await auditOf(id)).toEqual([]);
    }
    expect(await objectsOf(photo)).toEqual([]);
    expect(log.mock.calls.flat()).toEqual([
      "review: a card could not be deleted (PostgreSQL 23514)",
      "review: a card could not be deleted (PostgreSQL 23514)",
    ]);
    // Trying again deletes it: the photo already gone is no failure.
    expect((await remove(withPhoto)).kind).toBe("deleted");
  });
});

describe("Inside the panel, a user can do only what their roles allow (v2)", () => {
  it("each action needs its own permission in the card's locality", async () => {
    const reviewer = await userWith("reviewer", ["businesses.review"]);
    const { id } = await publishedWithLink();
    expect(await unpublish(id, "No puedo", reviewer)).toEqual({ kind: "forbidden" });
    expect(await newLink(id, await versionOf(id), reviewer)).toEqual({ kind: "forbidden" });
    expect(await remove(id, "BORRAR", reviewer)).toEqual({ kind: "forbidden" });
    expect(await db((tx) => deletionScreen(tx, { email: reviewer, businessId: id }))).toEqual({
      kind: "forbidden",
    });
    expect((await row(id))?.status).toBe("published");

    const unpublisher = await userWith("unpublisher", ["businesses.unpublish"]);
    const linker = await userWith("linker", ["links.manage"]);
    const deleter = await userWith("deleter", ["businesses.delete"]);
    expect(await newLink(id, await versionOf(id), unpublisher)).toEqual({ kind: "forbidden" });
    tokenOf(await newLink(id, await versionOf(id), linker));
    expect(await unpublish(id, "Sí puedo", unpublisher)).toEqual({ kind: "unpublished" });
    expect((await remove(id, "BORRAR", deleter)).kind).toBe("deleted");
  });

  it("a card of another locality, or a user with no role, is a card that does not exist", async () => {
    const elsewhere = await createUser("elsewhere");
    await assign(elsewhere, "locality_admin", f.localityB);
    const unassigned = await createUser("unassigned");
    const id = await published();
    for (const email of [elsewhere, unassigned, `nobody${DOMAIN}`]) {
      expect(await unpublish(id, "No es mío", email)).toEqual({ kind: "not-found" });
      expect(await newLink(id, "", email)).toEqual({ kind: "not-found" });
      expect(await remove(id, "BORRAR", email)).toEqual({ kind: "gone" });
      expect(await db((tx) => deletionScreen(tx, { email, businessId: id }))).toEqual({
        kind: "not-found",
      });
    }
    expect((await row(id))?.status).toBe("published");
  });

  it("a super admin acts anywhere", async () => {
    const admin = await createUser("super");
    await assign(admin, "super_admin", null);
    const inB = await insertBusiness(f, {
      localityCode: f.localityB,
      zoneId: f.zoneB,
      status: "published",
      publishedAt: hoursAgo(3),
    });
    expect(await unpublish(inB, "Desde arriba", operator)).toEqual({ kind: "not-found" });
    expect(await unpublish(inB, "Desde arriba", admin)).toEqual({ kind: "unpublished" });
    expect((await remove(inB, "BORRAR", admin)).kind).toBe("deleted");
  });
});

describe("The audit log records the destructive actions of the admin (v2)", () => {
  it("an unpublishing writes one entry: the email, the locality, the card, unpublish and published", async () => {
    const id = await published({ name: "Negocio Con Datos Personales" });
    await unpublish(id, "Motivo con datos que no van a la bitácora", operator.toUpperCase());
    const entries = await auditOf(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: operator,
      localityCode: f.localityA,
      businessId: id,
      action: "unpublish",
      previousStatus: "published",
    });
    expect(JSON.stringify(entries)).not.toMatch(/Datos Personales|bitácora|771999/);
  });

  it("the entries of a card outlive its deletion", async () => {
    const id = await published();
    await unpublish(id, "Primero despublicada");
    await remove(id);
    const entries = await db((tx) =>
      tx
        .select({ action: adminAuditLog.action })
        .from(adminAuditLog)
        .where(
          and(
            eq(adminAuditLog.businessId, id),
            inArray(adminAuditLog.action, ["unpublish", "delete"]),
          ),
        ),
    );
    expect(entries.map(({ action }) => action).sort()).toEqual(["delete", "unpublish"]);
  });
});

describe("The WhatsApp notice of an unpublishing", () => {
  it("carries the reason, with the spec's text", () => {
    expect(unpublishedMessage("Tacos del Güero", "El negocio cerró")).toBe(
      "Hola, te escribo de enmirumbo. Bajamos del directorio la ficha de «Tacos del Güero»: El negocio cerró. Si quieres que la volvamos a publicar o tienes alguna duda, contéstame por aquí.",
    );
  });
});

describe("The actions of F3 between Astro and the core (src/lib/review.ts)", () => {
  it("each action decides only from its page's address", () => {
    expect(reviewTarget({ routePattern: REGISTRATION_ROUTE, params: { id: "abc" } })).toBe("abc");
    expect(deletionTarget({ routePattern: DELETION_ROUTE, params: { id: "abc" } })).toBe("abc");
    for (const routePattern of ["/_actions/[...path]", "/admin", REGISTRATION_ROUTE]) {
      expect(deletionTarget({ routePattern, params: { id: "abc" } })).toBeNull();
    }
    expect(reviewTarget({ routePattern: DELETION_ROUTE, params: { id: "abc" } })).toBeNull();
  });

  it("each outcome travels as its status and comes back as what the page shows", () => {
    const cases: [ActionError | null, "unpublish" | "new-link", unknown, number][] = [
      [
        unpublishActionError({ kind: "invalid", error: "required" }),
        "unpublish",
        { kind: "unpublish", error: "required" },
        400,
      ],
      [
        unpublishActionError({ kind: "invalid", error: "too-long" }),
        "unpublish",
        { kind: "unpublish", error: "too-long" },
        400,
      ],
      [
        unpublishActionError({ kind: "not-published" }),
        "unpublish",
        { kind: "not-published" },
        409,
      ],
      [unpublishActionError({ kind: "not-found" }), "unpublish", { kind: "not-found" }, 404],
      [unpublishActionError({ kind: "forbidden" }), "unpublish", { kind: "forbidden" }, 403],
      [newLinkActionError({ kind: "not-published" }), "new-link", { kind: "not-published" }, 409],
      [newLinkActionError({ kind: "replaced" }), "new-link", { kind: "replaced" }, 409],
      [newLinkActionError({ kind: "no-site-url" }), "new-link", { kind: "no-site-url" }, 503],
      [newLinkActionError({ kind: "forbidden" }), "new-link", { kind: "forbidden" }, 403],
    ];
    for (const [error, form, failure, status] of cases) {
      expect(error).toBeInstanceOf(ActionError);
      expect(error?.status).toBe(status);
      expect(decisionFailure(error!, form)).toEqual(failure);
    }
    expect(unpublishActionError({ kind: "unpublished" })).toBeNull();
    expect(
      decisionFailure(new ActionError({ code: "BAD_REQUEST", message: "required" }), "new-link"),
    ).toEqual({ kind: "server", keepsDraft: false });
  });

  it("a deletion's outcome comes back as what its confirmation shows, never with the card", () => {
    const cases: [DeletionOutcome, unknown, number][] = [
      [{ kind: "gone" }, { kind: "gone" }, 404],
      [{ kind: "forbidden" }, { kind: "forbidden" }, 403],
      [{ kind: "invalid" }, { kind: "word" }, 400],
      [{ kind: "storage" }, { kind: "storage" }, 503],
      [{ kind: "failed", photoRemoved: true }, { kind: "failed", photoRemoved: true }, 500],
      [{ kind: "failed", photoRemoved: false }, { kind: "failed", photoRemoved: false }, 500],
    ];
    for (const [outcome, failure, status] of cases) {
      const error = deletionActionError(outcome);
      expect(error?.status).toBe(status);
      expect(deletionFailure(error!)).toEqual(failure);
    }
    expect(deletionActionError({ kind: "deleted", photoCached: true })).toBeNull();
    // Whatever else the action did not throw is a deletion that did not happen.
    expect(deletionFailure(new ActionError({ code: "INTERNAL_SERVER_ERROR" }))).toEqual({
      kind: "failed",
      photoRemoved: false,
    });
    expect(deletionFailure(new ActionError({ code: "CONTENT_TOO_LARGE" }))).toEqual({
      kind: "failed",
      photoRemoved: false,
    });
  });
});
