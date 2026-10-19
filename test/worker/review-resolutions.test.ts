// Scenarios of docs/specs/admin-review.md on attending reports and resolving
// pending edits, against the database: "Marking a report as attended, only
// once", "Applying the pending edit updates the published card and only
// that", "Discarding the pending edit requires a reason, does not touch the
// card and offers to notify by WhatsApp", "A pending edit is resolved only
// once and only if it is still the latest", "Applying or discarding a
// pending edit carries out what it asks of the photo (v2)", "Inside the
// panel, a user can do only what their roles allow (v2)" and "Attending a
// report and resolving a pending edit are forms of their details, and their
// action checks everything again (v2)"; and of docs/specs/data-model.md, "The
// audit log records the destructive actions of the admin (v2)" and "A
// pending edit may change the photo of its card (v2)". The forms are
// rendered in test/astro/review.test.ts and run end to end through Access in
// test/e2e/admin-resolutions.spec.ts.
//
// Everything lives in the fictitious state 74 (test/worker/fixtures.ts).
// Users are of the domain resolutions.enmirumbo.test and roles start with
// resolutionstest_; all of it is removed before and after, and so are the
// photo objects this file writes to the local media bucket.
import { env } from "cloudflare:workers";
import { ActionError } from "astro:actions";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Permission } from "../../src/core/access/permissions.ts";
import { publishedCard } from "../../src/core/business/card.ts";
import {
  adminAuditLog,
  businessTrades,
  businesses,
  categories,
  pendingEdits,
  reports,
  roleAssignments,
  rolePermissions,
  roles,
  users,
  zones,
} from "../../src/core/db/schema/index.ts";
import { savePendingEdit } from "../../src/core/edit/save.ts";
import { resolveManagementLink } from "../../src/core/management-link/link.ts";
import { newManagementToken, tokenFingerprint } from "../../src/core/management-link/token.ts";
import { newPhotoKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import {
  APPLY_FIELDS,
  applyEdit,
  applyForm,
  appliedNotice,
  readApply,
  submitApplyEdit,
  validateApply,
} from "../../src/core/review/apply.ts";
import {
  attendReport,
  parseReportId,
  REPORT_FIELD,
  submitAttendReport,
} from "../../src/core/review/attend.ts";
import {
  DISCARD_FIELD,
  discardedNotice,
  discardEdit,
  submitDiscardEdit,
} from "../../src/core/review/discard.ts";
import { discardedMessage, updatedMessage } from "../../src/core/review/notices.ts";
import { appliedPath, discardedPath, editPath } from "../../src/core/review/paths.ts";
import { reportedBusinesses, reviewQueue } from "../../src/core/review/queue.ts";
import { pendingReports } from "../../src/core/review/registration.ts";
import { searchPublishedBusinesses } from "../../src/core/search/query.ts";
import {
  applyActionError,
  appliedCardUrl,
  discardActionError,
  EDIT_ROUTE,
  editFailure,
  editReviewTarget,
} from "../../src/lib/edit-review.ts";
import { attendActionError, attendFailure } from "../../src/lib/report-review.ts";
import { REGISTRATION_ROUTE, reviewTarget } from "../../src/lib/review.ts";
import {
  cleanup,
  createFixture,
  db,
  type Fixture,
  fakePhone,
  insertBusiness,
  type NewBusiness,
} from "./fixtures.ts";

const STATE = "74";
const DOMAIN = "@resolutions.enmirumbo.test";
const ROLE_PREFIX = "resolutionstest_";
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);

let f: Fixture;
/** A zone of locality A that is hidden: the edit does not offer it, applying does. */
let hiddenZone: { id: number; slug: string };
/** A zone of locality B alone: no choice for a card of A. */
let zoneOnlyInB: { id: number; slug: string };
/** A second category of the fixture, for edits that change it. */
let otherCategoryId: number;
let editor: string;
let attender: string;
let reviewerOnly: string;
let editorOfB: string;
let nobody: string;
let superAdmin: string;
/** Every photo key this file writes objects for, removed afterwards. */
const writtenPhotos = new Set<string>();

async function removeTestData(): Promise<void> {
  await db(async (tx) => {
    await tx.delete(users).where(like(users.email, `%${DOMAIN}`));
    await tx.delete(roles).where(like(roles.key, `${ROLE_PREFIX}%`));
  });
  await cleanup(STATE);
  if (writtenPhotos.size > 0) await env.MEDIA.delete([...writtenPhotos].flatMap(photoObjectKeys));
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
  await db(async (tx) => {
    const [hidden] = await tx
      .insert(zones)
      .values({
        localityCode: f.localityA,
        type: "Colonia",
        name: "Oculta",
        slug: "oculta",
        visible: false,
      })
      .returning({ id: zones.id, slug: zones.slug });
    const [onlyInB] = await tx
      .insert(zones)
      .values({ localityCode: f.localityB, type: "Colonia", name: "Solo en B", slug: "solo-en-b" })
      .returning({ id: zones.id, slug: zones.slug });
    const [category] = await tx
      .insert(categories)
      .values({ name: `Categoría de prueba ${STATE} dos`, slug: `categoria-prueba-${STATE}-dos` })
      .returning({ id: categories.id });
    hiddenZone = hidden!;
    zoneOnlyInB = onlyInB!;
    otherCategoryId = category!.id;
  });
  editor = await createUser("editor");
  await assign(editor, await role("edits", ["edits.review"]), f.localityA);
  attender = await createUser("attender");
  await assign(attender, await role("reports", ["reports.manage"]), f.localityA);
  reviewerOnly = await createUser("reviewer");
  await assign(reviewerOnly, await role("review", ["businesses.review"]), f.localityA);
  editorOfB = await createUser("editor-b");
  await assign(
    editorOfB,
    await role("edits_and_reports", ["edits.review", "reports.manage"]),
    f.localityB,
  );
  nobody = await createUser("nobody");
  superAdmin = await createUser("super");
  await assign(superAdmin, "super_admin", null);
});

afterAll(removeTestData);

/** A published card of locality A, with a management link, a trade and a photo of its own. */
async function card(overrides: Partial<NewBusiness> = {}): Promise<string> {
  const id = await insertBusiness(f, {
    status: "published",
    origin: "seeded",
    registeredAt: hoursAgo(300),
    publishedAt: hoursAgo(200),
    consentedToNoticeAt: hoursAgo(300),
    managementTokenHash: await tokenFingerprint(newManagementToken()),
    managementTokenCreatedAt: hoursAgo(200),
    openingHours: "De 9 a 5",
    address: "Calle Uno",
    ...overrides,
  });
  await db((tx) => tx.insert(businessTrades).values({ businessId: id, tradeId: f.tradeIds[1] }));
  return id;
}

async function row(id: string) {
  const [found] = await db((tx) => tx.select().from(businesses).where(eq(businesses.id, id)));
  return found!;
}

type NewEdit = typeof pendingEdits.$inferInsert;

/** A pending edit of `businessId` that proposes the card as it is, with `overrides`. */
async function edit(businessId: string, overrides: Partial<NewEdit> = {}): Promise<number> {
  const current = await row(businessId);
  const [inserted] = await db((tx) =>
    tx
      .insert(pendingEdits)
      .values({
        businessId,
        localityCode: current.localityCode,
        name: current.name,
        categoryId: current.categoryId,
        whatsapp: current.whatsapp,
        zoneId: current.zoneId,
        zoneOther: current.zoneOther,
        whatYouOffer: current.whatYouOffer,
        homeDelivery: current.homeDelivery,
        landline: current.landline,
        address: current.address,
        openingHours: current.openingHours,
        facebookUrl: current.facebookUrl,
        createdAt: hoursAgo(2),
        ...overrides,
      })
      .returning({ id: pendingEdits.id }),
  );
  return inserted!.id;
}

async function editRow(id: number) {
  const [found] = await db((tx) => tx.select().from(pendingEdits).where(eq(pendingEdits.id, id)));
  return found!;
}

async function report(businessId: string, overrides: Partial<typeof reports.$inferInsert> = {}) {
  const [inserted] = await db((tx) =>
    tx
      .insert(reports)
      .values({ businessId, localityCode: f.localityA, reason: "closed", ...overrides })
      .returning({ id: reports.id }),
  );
  return inserted!.id;
}

async function reportRow(id: number) {
  const [found] = await db((tx) => tx.select().from(reports).where(eq(reports.id, id)));
  return found!;
}

async function auditOf(id: string) {
  return db((tx) => tx.select().from(adminAuditLog).where(eq(adminAuditLog.businessId, id)));
}

async function tradesOf(id: string): Promise<number[]> {
  const rows = await db((tx) =>
    tx
      .select({ tradeId: businessTrades.tradeId })
      .from(businessTrades)
      .where(eq(businessTrades.businessId, id)),
  );
  return rows.map((r) => r.tradeId).sort((a, b) => a - b);
}

/** A photo key with both of its objects in the local media bucket. */
async function storedPhoto(): Promise<string> {
  const key = newPhotoKey();
  writtenPhotos.add(key);
  for (const objectKey of photoObjectKeys(key)) {
    await env.MEDIA.put(objectKey, new Uint8Array([1, 2, 3]));
  }
  return key;
}

/** How many of the two objects of a photo are in the bucket. */
async function objectsOf(key: string): Promise<number> {
  const found = await Promise.all(
    photoObjectKeys(key).map((objectKey) => env.MEDIA.head(objectKey)),
  );
  return found.filter((object) => object !== null).length;
}

/** The photos deleted through the dependency, in order. */
function photoDeleter() {
  const deleted: string[] = [];
  return {
    deleted,
    deletePhoto: async (key: string) => {
      deleted.push(key);
      await env.MEDIA.delete(photoObjectKeys(key));
      return true;
    },
  };
}

function applyFormData(zone?: string): FormData {
  const form = new FormData();
  if (zone !== undefined) form.set(APPLY_FIELDS.zone, zone);
  return form;
}

function apply(
  editId: number | string,
  options: {
    zone?: string | undefined;
    email?: string;
    deleter?: ReturnType<typeof photoDeleter>;
  } = {},
) {
  const deleter = options.deleter ?? photoDeleter();
  return submitApplyEdit(
    applyFormData(options.zone),
    { email: options.email ?? editor, editId: String(editId) },
    { useDb: db, deletePhoto: deleter.deletePhoto },
  );
}

function discard(
  editId: number | string,
  reason: string,
  options: { email?: string; deleter?: ReturnType<typeof photoDeleter> } = {},
) {
  const form = new FormData();
  form.set(DISCARD_FIELD, reason);
  const deleter = options.deleter ?? photoDeleter();
  return submitDiscardEdit(
    form,
    { email: options.email ?? editor, editId: String(editId) },
    { useDb: db, deletePhoto: deleter.deletePhoto },
  );
}

function attend(businessId: string, reportId: number | string, email = attender) {
  const form = new FormData();
  form.set(REPORT_FIELD, String(reportId));
  return submitAttendReport(form, { email, businessId }, { useDb: db });
}

/** What applying never touches: everything of the card but the fields of the form and the photo. */
function untouchable(card: Awaited<ReturnType<typeof row>>) {
  return {
    status: card.status,
    origin: card.origin,
    registeredAt: card.registeredAt,
    publishedAt: card.publishedAt,
    consentedToNoticeAt: card.consentedToNoticeAt,
    consentedToNoticeVersion: card.consentedToNoticeVersion,
    reconsentedToNoticeAt: card.reconsentedToNoticeAt,
    managementTokenHash: card.managementTokenHash,
    managementTokenCreatedAt: card.managementTokenCreatedAt,
    latitude: card.latitude,
    longitude: card.longitude,
    unpublishedAt: card.unpublishedAt,
    previousRejectedAt: card.previousRejectedAt,
  };
}

describe("Marking a report as attended, only once", () => {
  it("attend a report: it is attended with its date, leaves the pending list and the queue counts one fewer", async () => {
    const id = await card();
    const first = await report(id, { createdAt: hoursAgo(30) });
    const second = await report(id, { reason: "not_real", createdAt: hoursAgo(2) });
    const before = Date.now();

    expect(await attend(id, first)).toEqual({ kind: "attended" });

    const attended = await reportRow(first);
    expect(attended.status).toBe("attended");
    expect(attended.attendedAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect((await db((tx) => pendingReports(tx, id))).map((r) => r.id)).toEqual([second]);
    const reported = await db((tx) => reportedBusinesses(tx, [f.localityA]));
    expect(reported.find((r) => r.businessId === id)?.pending).toBe(1);
  });

  it("the last one: the card leaves Negocios reportados, and sending it again keeps the first date", async () => {
    const id = await card();
    const only = await report(id);

    expect(await attend(id, only)).toEqual({ kind: "attended" });
    const firstDate = (await reportRow(only)).attendedAt;
    const reported = await db((tx) => reportedBusinesses(tx, [f.localityA]));
    expect(reported.map((r) => r.businessId)).not.toContain(id);

    expect(await attend(id, only)).toEqual({ kind: "already-attended" });
    expect((await reportRow(only)).attendedAt).toEqual(firstDate);
  });

  it("attending changes nothing of the business, and writes no entry of the audit log", async () => {
    const id = await card();
    const reportId = await report(id);
    const before = await row(id);

    await attend(id, reportId);

    expect(await row(id)).toEqual(before);
    expect(await tradesOf(id)).toEqual([f.tradeIds[1]]);
    expect(await auditOf(id)).toEqual([]);
  });

  it("two markings at once: exactly one writes", async () => {
    const id = await card();
    const reportId = await report(id);

    const outcomes = await Promise.all([attend(id, reportId), attend(id, reportId)]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["already-attended", "attended"]);
  });

  it("a report that does not exist, of another card or of no shape: the same not found, nothing changes", async () => {
    const id = await card();
    const other = await card();
    const othersReport = await report(other);

    for (const reportId of [othersReport, 999_999_999_999, "abc", "0", "", "1e3"]) {
      expect(await attend(id, reportId), String(reportId)).toEqual({ kind: "not-found" });
    }
    expect((await reportRow(othersReport)).status).toBe("pending");
    expect(parseReportId("42")).toBe(42);
    expect(parseReportId("-1")).toBeNull();
  });

  it("reports.manage in the card's locality: who sees the card without it is forbidden, any other not found", async () => {
    const id = await card();
    const reportId = await report(id);

    expect(await attend(id, reportId, reviewerOnly)).toEqual({ kind: "forbidden" });
    expect(await attend(id, reportId, editorOfB)).toEqual({ kind: "not-found" });
    expect(await attend(id, reportId, nobody)).toEqual({ kind: "not-found" });
    expect(await attend(id, reportId, editor)).toEqual({ kind: "not-found" });
    expect((await reportRow(reportId)).status).toBe("pending");
    expect(await attend(id, reportId, superAdmin)).toEqual({ kind: "attended" });
  });

  it("attending works whatever the card's status", async () => {
    const id = await card({
      status: "in_review",
      unpublishedAt: hoursAgo(1),
      unpublishReason: "x",
    });
    const reportId = await report(id);
    expect(await db((tx) => attendReport(tx, id, reportId))).toEqual({ kind: "attended" });
    expect((await row(id)).status).toBe("in_review");
  });
});

describe("Applying the pending edit updates the published card and only that", () => {
  it("apply the changes: exactly the fields of the form reach the card, nothing else changes", async () => {
    const id = await card({ name: "Tacos del Güero de Mentiras", landline: "7719990777" });
    const before = await row(id);
    const newNumber = fakePhone();
    const editId = await edit(id, {
      name: "Tacos del Güero Renovados de Mentiras",
      categoryId: otherCategoryId,
      whatsapp: newNumber,
      whatYouOffer: "Tacos al pastor y de suadero",
      homeDelivery: true,
      landline: null,
      address: "Calle Dos",
      openingHours: "De 10 a 6",
      facebookUrl: "https://facebook.com/tacos-de-mentiras",
    });

    expect(await apply(editId)).toEqual({ kind: "applied" });

    const after = await row(id);
    expect(after).toMatchObject({
      name: "Tacos del Güero Renovados de Mentiras",
      categoryId: otherCategoryId,
      whatsapp: newNumber,
      zoneId: f.zoneA,
      zoneOther: null,
      whatYouOffer: "Tacos al pastor y de suadero",
      homeDelivery: true,
      landline: null,
      address: "Calle Dos",
      openingHours: "De 10 a 6",
      facebookUrl: "https://facebook.com/tacos-de-mentiras",
      photoKey: before.photoKey,
    });
    expect(untouchable(after)).toEqual(untouchable(before));
    expect(await tradesOf(id)).toEqual([f.tradeIds[1]]);
    const resolved = await editRow(editId);
    expect(resolved.status).toBe("applied");
    expect(resolved.resolvedAt).not.toBeNull();
    // The public read of the card sees it (through HYPERDRIVE, up to a minute late).
    expect(await db((tx) => publishedCard(tx, f.localityA, id))).toMatchObject({
      name: "Tacos del Güero Renovados de Mentiras",
      openingHours: "De 10 a 6",
    });
    // Out of the queue.
    const queue = await db((tx) =>
      reviewQueue(tx, { review: [], edits: [f.localityA] }, new Date()),
    );
    expect(queue.map((r) => r.editId)).not.toContain(editId);
  });

  it("the edited card can still be found: the database derives its search columns again", async () => {
    const id = await card({ name: "Herrería de Mentiras" });
    const editId = await edit(id, {
      name: "Plomería Güicho de Mentiras",
      whatYouOffer: "Destape de drenajes",
    });

    expect(await apply(editId)).toEqual({ kind: "applied" });

    const after = await row(id);
    expect(after.nameNormalized).toBe("plomeria guicho de mentiras");
    expect(after.whatYouOfferNormalized).toBe("destape de drenajes");
    const found = await db((tx) =>
      searchPublishedBusinesses(tx, { code: f.localityA, name: "Pueblo Uno" }, "plomeria", {
        limit: 50,
        offset: 0,
      }),
    );
    expect(found?.map((b) => b.id)).toContain(id);
  });

  it("the proposed number is another card's: nothing is applied and the edit keeps waiting", async () => {
    const taker = await card();
    const takenNumber = (await row(taker)).whatsapp;
    const id = await card();
    const before = await row(id);
    const editId = await edit(id, { whatsapp: takenNumber, openingHours: "Nunca" });

    expect(await apply(editId)).toEqual({ kind: "taken" });
    expect(await row(id)).toEqual(before);
    expect((await editRow(editId)).status).toBe("pending");

    // A rejected card holds its number too; a card of another locality does not.
    const rejected = await insertBusiness(f, {
      status: "rejected",
      rejectedAt: hoursAgo(1),
      rejectionReason: "x",
    });
    const rejectedNumber = (await row(rejected)).whatsapp;
    const second = await edit(await card(), { whatsapp: rejectedNumber });
    expect(await apply(second)).toEqual({ kind: "taken" });
    const elsewhere = await insertBusiness(f, { localityCode: f.localityB, zoneId: f.zoneB });
    const third = await edit(await card(), { whatsapp: (await row(elsewhere)).whatsapp });
    expect(await apply(third)).toEqual({ kind: "applied" });
  });

  it("the card stopped being published: nothing is applied, and once published again the same changes apply", async () => {
    const id = await card();
    const editId = await edit(id, { openingHours: "De 7 a 3" });
    await db((tx) =>
      tx
        .update(businesses)
        .set({ status: "in_review", unpublishedAt: new Date(), unpublishReason: "De mentiras" })
        .where(eq(businesses.id, id)),
    );
    const before = await row(id);

    expect(await apply(editId)).toEqual({ kind: "unpublished" });
    expect(await row(id)).toEqual(before);
    expect((await editRow(editId)).status).toBe("pending");
    expect(await db((tx) => applyEdit(tx, editId, null))).toEqual({ kind: "unpublished" });

    await db((tx) =>
      tx.update(businesses).set({ status: "published" }).where(eq(businesses.id, id)),
    );
    expect(await apply(editId)).toEqual({ kind: "applied" });
    expect((await row(id)).openingHours).toBe("De 7 a 3");
  });

  it('"Otra": without a zone nothing is applied; with a hidden zone of the locality the card takes it and keeps the text', async () => {
    const id = await card();
    const before = await row(id);
    const editId = await edit(id, {
      zoneId: null,
      zoneOther: "Colonia Inventada de Mentiras",
      openingHours: "De 8 a 4",
    });

    for (const zone of [undefined, "", "no-existe", zoneOnlyInB.slug]) {
      expect(await apply(editId, { zone }), String(zone)).toEqual({
        kind: "invalid",
        errors: { zone: "required" },
      });
    }
    expect(await row(id)).toEqual(before);
    expect((await editRow(editId)).status).toBe("pending");

    expect(await apply(editId, { zone: hiddenZone.slug })).toEqual({ kind: "applied" });
    expect(await row(id)).toMatchObject({
      zoneId: hiddenZone.id,
      zoneOther: "Colonia Inventada de Mentiras",
      openingHours: "De 8 a 4",
    });
  });

  it("a catalogue zone stands: the choice of a zone is ignored", async () => {
    const id = await card({ zoneId: hiddenZone.id });
    const editId = await edit(id, { zoneId: f.zoneA, zoneOther: null });

    expect(await apply(editId, { zone: hiddenZone.slug })).toEqual({ kind: "applied" });
    expect((await row(id)).zoneId).toBe(f.zoneA);
  });

  it("the form: the zones only for an Otra, every zone of the locality, the hidden ones marked", async () => {
    const needs = await db((tx) =>
      applyForm(tx, { localityCode: f.localityA, needsZone: true, zoneOther: "Por ahí" }),
    );
    expect(needs.needsZone).toBe(true);
    expect(needs.zoneOther).toBe("Por ahí");
    expect(needs.zones.map((z) => [z.slug, z.hidden])).toEqual([
      ["centro", false],
      ["oculta", true],
    ]);
    const stands = await db((tx) =>
      applyForm(tx, { localityCode: f.localityA, needsZone: false, zoneOther: null }),
    );
    expect(stands).toEqual({ needsZone: false, zoneOther: null, zones: [] });

    expect(readApply(applyFormData(" oculta "))).toEqual({ zone: "oculta" });
    expect(validateApply({ zone: "oculta" }, needs.zones, true)).toEqual({
      kind: "valid",
      zoneId: hiddenZone.id,
    });
    expect(validateApply({ zone: "" }, [], false)).toEqual({ kind: "valid", zoneId: null });
  });
});

describe("Applying or discarding a pending edit carries out what it asks of the photo (v2)", () => {
  it("replace: the card shows the new photo, the old one's objects are gone, the applied edit names the new one", async () => {
    const old = await storedPhoto();
    const fresh = await storedPhoto();
    const id = await card({ photoKey: old });
    const editId = await edit(id, { photoChange: "replace", newPhotoKey: fresh });
    const deleter = photoDeleter();

    expect(await apply(editId, { deleter })).toEqual({ kind: "applied" });

    expect((await row(id)).photoKey).toBe(fresh);
    expect(deleter.deleted).toEqual([old]);
    expect(await objectsOf(old)).toBe(0);
    expect(await objectsOf(fresh)).toBe(2);
    expect(await editRow(editId)).toMatchObject({ photoChange: "replace", newPhotoKey: fresh });
  });

  it("remove: the card has no photo, and the objects of the one it had are gone", async () => {
    const old = await storedPhoto();
    const id = await card({ photoKey: old });
    const editId = await edit(id, { photoChange: "remove" });
    const deleter = photoDeleter();

    expect(await apply(editId, { deleter })).toEqual({ kind: "applied" });

    expect((await row(id)).photoKey).toBeNull();
    expect(deleter.deleted).toEqual([old]);
    expect(await objectsOf(old)).toBe(0);
  });

  it("keep: the card's photo stays and nothing is deleted; a new photo on a card without one deletes nothing", async () => {
    const old = await storedPhoto();
    const id = await card({ photoKey: old });
    const keeper = photoDeleter();
    expect(await apply(await edit(id, { openingHours: "Siempre" }), { deleter: keeper })).toEqual({
      kind: "applied",
    });
    expect((await row(id)).photoKey).toBe(old);
    expect(keeper.deleted).toEqual([]);
    expect(await objectsOf(old)).toBe(2);

    const fresh = await storedPhoto();
    const bare = await card();
    const first = photoDeleter();
    const editId = await edit(bare, { photoChange: "replace", newPhotoKey: fresh });
    expect(await apply(editId, { deleter: first })).toEqual({ kind: "applied" });
    expect((await row(bare)).photoKey).toBe(fresh);
    expect(first.deleted).toEqual([]);
  });

  it("an edit that is not applied changes nothing of the photo, and its new photo stays with it", async () => {
    const old = await storedPhoto();
    const fresh = await storedPhoto();
    const taker = await card();
    const id = await card({ photoKey: old });
    const editId = await edit(id, {
      photoChange: "replace",
      newPhotoKey: fresh,
      whatsapp: (await row(taker)).whatsapp,
    });
    const deleter = photoDeleter();

    expect(await apply(editId, { deleter })).toEqual({ kind: "taken" });

    expect((await row(id)).photoKey).toBe(old);
    expect(deleter.deleted).toEqual([]);
    expect(await objectsOf(old)).toBe(2);
    expect(await objectsOf(fresh)).toBe(2);
    expect((await editRow(editId)).newPhotoKey).toBe(fresh);
  });

  it("discarding a new photo: its objects are gone, the edit names none and still says replace, the card keeps its own", async () => {
    const old = await storedPhoto();
    const fresh = await storedPhoto();
    const id = await card({ photoKey: old });
    const editId = await edit(id, { photoChange: "replace", newPhotoKey: fresh });
    const deleter = photoDeleter();

    expect(await discard(editId, "La foto tiene personas", { deleter })).toEqual({
      kind: "discarded",
    });

    expect((await row(id)).photoKey).toBe(old);
    expect(deleter.deleted).toEqual([fresh]);
    expect(await objectsOf(fresh)).toBe(0);
    expect(await objectsOf(old)).toBe(2);
    expect(await editRow(editId)).toMatchObject({
      status: "discarded",
      photoChange: "replace",
      newPhotoKey: null,
    });
  });

  it("a discard without a new photo deletes nothing", async () => {
    const old = await storedPhoto();
    const id = await card({ photoKey: old });
    const deleter = photoDeleter();
    expect(await discard(await edit(id, { photoChange: "remove" }), "No", { deleter })).toEqual({
      kind: "discarded",
    });
    expect(deleter.deleted).toEqual([]);
    expect(await objectsOf(old)).toBe(2);
  });
});

describe("Discarding the pending edit requires a reason, does not touch the card and offers to notify by WhatsApp", () => {
  it("discard with a reason: discarded with it and its date, out of the queue, and the card identical", async () => {
    const id = await card();
    const before = await row(id);
    const editId = await edit(id, { name: "Préstamos Rápidos de Mentiras" });
    const reason = "El texto que pusiste en «¿Qué ofreces?» no lo podemos publicar";
    const start = Date.now();

    expect(await discard(editId, reason)).toEqual({ kind: "discarded" });

    const discarded = await editRow(editId);
    expect(discarded.status).toBe("discarded");
    expect(discarded.discardReason).toBe(reason);
    expect(discarded.resolvedAt!.getTime()).toBeGreaterThanOrEqual(start - 5000);
    expect(await row(id)).toEqual(before);
    const queue = await db((tx) =>
      reviewQueue(tx, { review: [], edits: [f.localityA] }, new Date()),
    );
    expect(queue.map((r) => r.editId)).not.toContain(editId);
  });

  it("without a reason, or only spaces: nothing changes", async () => {
    const id = await card();
    const editId = await edit(id, { openingHours: "Otra vez" });

    for (const reason of ["", "   \n  "]) {
      expect(await discard(editId, reason)).toEqual({ kind: "invalid", error: "required" });
    }
    expect((await editRow(editId)).status).toBe("pending");
  });

  it("501 characters are refused, 500 are saved whole, counted as a person sees them", async () => {
    const editId = await edit(await card());
    expect(await discard(editId, "é".repeat(501))).toEqual({ kind: "invalid", error: "too-long" });
    expect((await editRow(editId)).status).toBe("pending");

    const limit = `${"👍🏽".repeat(10)}${"a".repeat(490)}`;
    expect(await discard(editId, limit)).toEqual({ kind: "discarded" });
    expect((await editRow(editId)).discardReason).toBe(limit);
  });

  it("the link keeps working after a discard", async () => {
    const token = newManagementToken();
    const id = await card({ managementTokenHash: await tokenFingerprint(token) });
    await discard(await edit(id), "No por ahora");

    expect(await db((tx) => resolveManagementLink(tx, f.localityA, token))).toMatchObject({
      businessId: id,
    });
  });

  it("the confirmation reads the stored reason, the card's published name and number, only for who may resolve it", async () => {
    const id = await card({ name: "Préstamos Rápidos de Mentiras" });
    const published = await row(id);
    const editId = await edit(id, { name: "Otro Nombre", whatsapp: fakePhone() });
    const target = { email: editor, editId: String(editId) };

    expect(await db((tx) => discardedNotice(tx, target))).toBeNull();
    await discard(editId, "No publicamos préstamos informales");

    expect(await db((tx) => discardedNotice(tx, target))).toEqual({
      name: "Préstamos Rápidos de Mentiras",
      whatsapp: published.whatsapp,
      reason: "No publicamos préstamos informales",
    });
    for (const email of [editorOfB, attender, nobody]) {
      expect(await db((tx) => discardedNotice(tx, { email, editId: String(editId) }))).toBeNull();
    }
    expect(await db((tx) => discardedNotice(tx, { email: editor, editId: "nada" }))).toBeNull();
    // An applied edit has no discard to confirm, nor a discarded one an apply.
    expect(await db((tx) => appliedNotice(tx, target))).toBeNull();
  });
});

describe("The confirmation of an applied edit", () => {
  it("reads the card as it is now, only for an applied edit of a published card the user may resolve", async () => {
    const id = await card({ name: "Estética Lupita de Mentiras" });
    const newNumber = fakePhone();
    const editId = await edit(id, { whatsapp: newNumber });
    const target = { email: editor, editId: String(editId) };

    expect(await db((tx) => appliedNotice(tx, target))).toBeNull();
    await apply(editId);

    const notice = await db((tx) => appliedNotice(tx, target));
    expect(notice).toEqual({
      id,
      name: "Estética Lupita de Mentiras",
      whatsapp: newNumber,
      locality: { slug: "pueblo-uno", state: { slug: `estado-de-prueba-${STATE}` } },
    });
    expect(appliedCardUrl(env, notice!)).toMatch(
      new RegExp(
        `^https?://[^/]+/estado-de-prueba-${STATE}/pueblo-uno/negocio/estetica-lupita-de-mentiras-${id}$`,
      ),
    );
    expect(appliedCardUrl({ ENVIRONMENT: "prod" }, notice!)).toBeNull();
    expect(await db((tx) => appliedNotice(tx, { email: editorOfB, editId: String(editId) }))).toBe(
      null,
    );
    expect(await db((tx) => discardedNotice(tx, target))).toBeNull();

    await db((tx) =>
      tx
        .update(businesses)
        .set({ status: "in_review", unpublishedAt: new Date(), unpublishReason: "x" })
        .where(eq(businesses.id, id)),
    );
    expect(await db((tx) => appliedNotice(tx, target))).toBeNull();
  });
});

describe("A pending edit is resolved only once and only if it is still the latest", () => {
  it("double apply: the card keeps what was applied the first time", async () => {
    const id = await card();
    const editId = await edit(id, { openingHours: "Primera vez" });

    expect(await apply(editId)).toEqual({ kind: "applied" });
    await db((tx) =>
      tx.update(businesses).set({ openingHours: "Cambió después" }).where(eq(businesses.id, id)),
    );
    expect(await apply(editId)).toEqual({ kind: "resolved" });
    expect(await discard(editId, "Tarde")).toEqual({ kind: "resolved" });
    expect((await row(id)).openingHours).toBe("Cambió después");
    expect((await editRow(editId)).discardReason).toBeNull();
  });

  it("two applies at once, and an apply and a discard at once: exactly one wins", async () => {
    const id = await card();
    const editId = await edit(id, { openingHours: "A la vez" });
    const applies = await Promise.all([apply(editId), apply(editId)]);
    expect(applies.map((o) => o.kind).sort()).toEqual(["applied", "resolved"]);

    const other = await card();
    const otherEdit = await edit(other, { openingHours: "Una de dos" });
    const [applied, discarded] = await Promise.all([
      apply(otherEdit),
      discard(otherEdit, "Una de dos"),
    ]);
    const status = (await editRow(otherEdit)).status;
    expect([applied.kind, discarded.kind].sort()).toEqual(
      status === "applied" ? ["applied", "resolved"] : ["discarded", "resolved"],
    );
    expect((await row(other)).openingHours).toBe(status === "applied" ? "Una de dos" : "De 9 a 5");
  });

  it("the business sent others in the meantime: neither the old nor the new changes reach the card", async () => {
    const id = await card();
    const before = await row(id);
    const old = await edit(id, { openingHours: "Viejo" });
    await db((tx) =>
      tx
        .update(pendingEdits)
        .set({ status: "superseded", resolvedAt: new Date() })
        .where(eq(pendingEdits.id, old)),
    );
    const newer = await edit(id, { openingHours: "Nuevo" });

    expect(await apply(old)).toEqual({ kind: "superseded" });
    expect(await discard(old, "Viejo")).toEqual({ kind: "superseded" });
    expect(await db((tx) => applyEdit(tx, old, null))).toEqual({ kind: "superseded" });
    expect(await db((tx) => discardEdit(tx, old, "Viejo"))).toEqual({ kind: "superseded" });
    expect(await row(id)).toEqual(before);
    expect((await editRow(newer)).status).toBe("pending");
    const queue = await db((tx) =>
      reviewQueue(tx, { review: [], edits: [f.localityA] }, new Date()),
    );
    expect(queue.map((r) => r.editId)).toContain(newer);
  });

  it("an apply while the owner sends new changes: they wait for each other, and exactly one stays pending", async () => {
    const token = newManagementToken();
    const fingerprint = await tokenFingerprint(token);
    const id = await card({ managementTokenHash: fingerprint });
    const current = await row(id);
    const editId = await edit(id, { openingHours: "Del admin" });

    const [applied, saved] = await Promise.all([
      apply(editId),
      db((tx) =>
        savePendingEdit(
          tx,
          f.localityA,
          { businessId: id, fingerprint },
          {
            name: current.name,
            categoryId: current.categoryId,
            whatsapp: current.whatsapp,
            zoneId: current.zoneId,
            zoneOther: null,
            whatYouOffer: null,
            homeDelivery: false,
            landline: null,
            address: null,
            openingHours: "Del dueño",
            facebookUrl: null,
          },
          { kind: "keep" },
        ),
      ),
    ]);

    expect(saved.kind).toBe("saved");
    expect(["applied", "superseded"]).toContain(applied.kind);
    const pending = await db((tx) =>
      tx
        .select()
        .from(pendingEdits)
        .where(and(eq(pendingEdits.businessId, id), eq(pendingEdits.status, "pending"))),
    );
    expect(pending.map((p) => p.openingHours)).toEqual(["Del dueño"]);
    expect((await row(id)).openingHours).toBe(
      applied.kind === "applied" ? "Del admin" : "De 9 a 5",
    );
  });

  it("the card deleted halfway: not found, and nothing comes back", async () => {
    const id = await card();
    const editId = await edit(id);
    await db((tx) => tx.delete(businesses).where(eq(businesses.id, id)));

    expect(await apply(editId)).toEqual({ kind: "not-found" });
    expect(await discard(editId, "No existe")).toEqual({ kind: "not-found" });
    expect(await db((tx) => applyEdit(tx, editId, null))).toEqual({ kind: "not-found" });
    expect(await db((tx) => discardEdit(tx, editId, "No"))).toEqual({ kind: "not-found" });
  });
});

describe("Inside the panel, a user can do only what their roles allow (v2)", () => {
  it("edits.review in the edit's locality, and nothing else, resolves it; a super admin anywhere", async () => {
    const id = await card();
    const editId = await edit(id, { openingHours: "Con permiso" });

    // A user who resolves edits in another locality is told the edit does not exist.
    expect(await apply(editId, { email: editorOfB })).toEqual({ kind: "not-found" });
    expect(await discard(editId, "No", { email: editorOfB })).toEqual({ kind: "not-found" });
    // One who resolves edits nowhere, or holds no role, is forbidden before anything is read.
    for (const email of [attender, reviewerOnly, nobody, `nadie${DOMAIN}`]) {
      expect(await apply(editId, { email }), email).toEqual({ kind: "forbidden" });
      expect(await discard(editId, "No", { email }), email).toEqual({ kind: "forbidden" });
    }
    expect((await editRow(editId)).status).toBe("pending");
    expect(await apply("999999999999")).toEqual({ kind: "not-found" });
    expect(await apply("nada")).toEqual({ kind: "not-found" });

    expect(await apply(editId, { email: editor })).toEqual({ kind: "applied" });
    const elsewhere = await insertBusiness(f, {
      localityCode: f.localityB,
      zoneId: f.zoneB,
      status: "published",
      publishedAt: hoursAgo(10),
    });
    const editOfB = await edit(elsewhere, { openingHours: "En B" });
    expect(await apply(editOfB, { email: superAdmin })).toEqual({ kind: "applied" });
  });
});

describe("The audit log records the destructive actions of the admin (v2)", () => {
  it("attending a report, applying and discarding an owner's edit write no entry", async () => {
    const id = await card();
    await attend(id, await report(id));
    await apply(await edit(id, { openingHours: "Sin bitácora" }));
    await discard(await edit(id, { openingHours: "Tampoco" }), "Sin bitácora");

    expect(await auditOf(id)).toEqual([]);
  });
});

describe("The WhatsApp notices of the resolutions", () => {
  it("the notice of an applied edit, with the spec's text", () => {
    expect(updatedMessage("Estética Lupita", "https://enmirumbo.test/x")).toBe(
      "¡Listo! Ya actualizamos la ficha de «Estética Lupita» en enmirumbo. Así quedó: https://enmirumbo.test/x",
    );
  });

  it("the notice of a discarded edit carries the reason, with the spec's text", () => {
    expect(discardedMessage("Préstamos Rápidos", "No publicamos préstamos informales")).toBe(
      "Hola, revisamos los cambios que mandaste para «Préstamos Rápidos» en enmirumbo y por ahora no los pudimos aplicar: No publicamos préstamos informales. Tu ficha sigue publicada como estaba y puedes mandarlos otra vez con tu mismo enlace.",
    );
  });
});

describe("The resolutions between Astro and the core (src/lib/edit-review.ts, src/lib/report-review.ts)", () => {
  it("each action decides only from its detail's address, never from another page or /_actions/", () => {
    expect(editReviewTarget({ routePattern: EDIT_ROUTE, params: { id: "42" } })).toBe("42");
    expect(reviewTarget({ routePattern: REGISTRATION_ROUTE, params: { id: "abc" } })).toBe("abc");
    for (const routePattern of [
      "/_actions/[...path]",
      "/admin",
      REGISTRATION_ROUTE,
      "/admin/ediciones/[id]/aplicada",
    ]) {
      expect(editReviewTarget({ routePattern, params: { id: "42" } })).toBeNull();
    }
    expect(reviewTarget({ routePattern: EDIT_ROUTE, params: { id: "abc" } })).toBeNull();
  });

  it("the addresses of the confirmations", () => {
    expect(editPath(42)).toBe("/admin/ediciones/42");
    expect(appliedPath(42)).toBe("/admin/ediciones/42/aplicada");
    expect(discardedPath("42")).toBe("/admin/ediciones/42/descartada");
  });

  it("each outcome of a resolution travels as its status and comes back as what the page shows", () => {
    const cases: [ActionError | null, "apply" | "discard", unknown, number][] = [
      [applyActionError({ kind: "not-found" }), "apply", { kind: "not-found" }, 404],
      [applyActionError({ kind: "forbidden" }), "apply", { kind: "forbidden" }, 403],
      [applyActionError({ kind: "resolved" }), "apply", { kind: "resolved" }, 409],
      [applyActionError({ kind: "superseded" }), "apply", { kind: "superseded" }, 409],
      [applyActionError({ kind: "unpublished" }), "apply", { kind: "unpublished" }, 409],
      [applyActionError({ kind: "taken" }), "apply", { kind: "taken" }, 409],
      [
        applyActionError({ kind: "invalid", errors: { zone: "required" } }),
        "apply",
        { kind: "apply", errors: { zone: "required" } },
        400,
      ],
      [
        discardActionError({ kind: "invalid", error: "too-long" }),
        "discard",
        { kind: "discard", error: "too-long" },
        400,
      ],
      [
        discardActionError({ kind: "invalid", error: "required" }),
        "discard",
        { kind: "discard", error: "required" },
        400,
      ],
      [discardActionError({ kind: "superseded" }), "discard", { kind: "superseded" }, 409],
    ];
    for (const [error, form, failure, status] of cases) {
      expect(error).toBeInstanceOf(ActionError);
      expect(error!.status).toBe(status);
      expect(editFailure(error!, form)).toEqual(failure);
    }
    expect(applyActionError({ kind: "applied" })).toBeNull();
    expect(discardActionError({ kind: "discarded" })).toBeNull();
    // What the action did not throw is a failure to save, never an invented error.
    for (const error of [
      new ActionError({ code: "BAD_REQUEST", message: "trades" }),
      new ActionError({ code: "CONFLICT", message: "attended" }),
      new ActionError({ code: "CONTENT_TOO_LARGE" }),
    ]) {
      expect(editFailure(error, "apply")).toEqual({ kind: "server", keepsDraft: false });
      expect(editFailure(error, "discard")).toEqual({ kind: "server", keepsDraft: false });
    }
    expect(editFailure(new ActionError({ code: "INTERNAL_SERVER_ERROR" }), "discard")).toEqual({
      kind: "server",
      keepsDraft: true,
    });
  });

  it("each outcome of a marking travels as its status and comes back as what the page shows", () => {
    expect(attendActionError({ kind: "attended" })).toBeNull();
    const cases: [ActionError | null, unknown, number][] = [
      [attendActionError({ kind: "already-attended" }), { kind: "already-attended" }, 409],
      [attendActionError({ kind: "not-found" }), { kind: "not-found" }, 404],
      [attendActionError({ kind: "forbidden" }), { kind: "forbidden" }, 403],
    ];
    for (const [error, failure, status] of cases) {
      expect(error!.status).toBe(status);
      expect(attendFailure(error!)).toEqual(failure);
    }
    expect(attendFailure(new ActionError({ code: "CONFLICT", message: "resolved" }))).toEqual({
      kind: "server",
    });
    expect(attendFailure(new ActionError({ code: "INTERNAL_SERVER_ERROR" }))).toEqual({
      kind: "server",
    });
  });
});
