// Scenarios of docs/specs/data-model.md, "Rejected registrations are
// permanently deleted after 90 days", "The scheduled purges report what they
// could not purge", "Applied, discarded and superseded pending edits are
// purged after 30 days (v2)" and "The audit log records the destructive
// actions of the admin (v2)" (a purge is logged); and of docs/specs/
// deployment.md, "Scheduled work runs from one hourly Cron Trigger per
// environment (v2)" and "Permanent deletion refuses to claim it deleted what
// it did not delete" (the scheduled purge facing the same state). The purges
// (src/core/review/purge.ts, purgeRejectedCard in src/core/review/
// deletion.ts) and the task of the hourly job that runs them
// (src/scheduled.ts), against the database and the local media bucket.
//
// The purges act on the whole database, so every run is in February or March
// 2026 and every item this file purges was rejected or resolved before it,
// months before any other file's: the rows of the files that run at the same
// time are never due. The task purges at 03:00 local time of a locality, so
// a run is at 09:00 UTC for A, which is in Mexico City's time zone (UTC-6, no
// daylight saving time), and at 18:00 UTC for B, which is in Tokyo's (UTC+9). The state is the
// fictitious 71 (test/worker/fixtures.ts); its photos are removed after.
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  adminAuditLog,
  businessTrades,
  businesses,
  localities,
  pendingEdits,
  reports,
  SCHEDULED_JOB_ACTOR,
} from "../../src/core/db/schema/index.ts";
import { type PhotoCache, type PurgeResult, photoCache } from "../../src/core/photos/cache.ts";
import { newPhotoKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import type { MediaBucket } from "../../src/core/photos/upload.ts";
import { purgeRejectedCard } from "../../src/core/review/deletion.ts";
import {
  MAX_CARDS_PER_RUN,
  retentionPurgeFailure,
  runRetentionPurge,
} from "../../src/core/review/purge.ts";
import {
  IncompleteTask,
  purgeExpiredRecords,
  runScheduledTasks,
  SCHEDULED_TASKS,
} from "../../src/scheduled.ts";
import {
  cleanup,
  createFixture,
  db,
  fakePhone,
  type Fixture,
  insertBusiness,
  type NewBusiness,
} from "./fixtures.ts";

const STATE = "71";
const MEDIA = "https://media-retention.enmirumbo.test";
let f: Fixture;

/** Every photo key whose objects this file wrote. */
const photos = new Set<string>();

beforeAll(async () => {
  f = await createFixture(STATE);
  await db((tx) =>
    tx.update(localities).set({ timeZone: "Asia/Tokyo" }).where(eq(localities.code, f.localityB)),
  );
});

beforeEach(async () => {
  await db((tx) =>
    tx.delete(businesses).where(inArray(businesses.localityCode, [f.localityA, f.localityB])),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanup(STATE);
  await env.MEDIA.delete([...photos].flatMap(photoObjectKeys));
});

const at = (iso: string) => new Date(iso);

/** A rejected card of locality A, rejected at `rejectedAt`. */
function rejected(rejectedAt: string, overrides: Partial<NewBusiness> = {}): Promise<string> {
  return insertBusiness(f, {
    status: "rejected",
    rejectedAt: at(rejectedAt),
    rejectionReason: "No es un negocio real",
    registeredAt: at("2025-11-01T12:00:00Z"),
    ...overrides,
  });
}

/** A rejected card of locality B. */
function rejectedInB(rejectedAt: string, overrides: Partial<NewBusiness> = {}): Promise<string> {
  return rejected(rejectedAt, { localityCode: f.localityB, zoneId: f.zoneB, ...overrides });
}

/** An edit of `businessId` in locality A resolved at `resolvedAt`, or one still waiting. */
async function edit(
  businessId: string,
  values: Partial<typeof pendingEdits.$inferInsert> & {
    status: "pending" | "applied" | "discarded" | "superseded";
  },
  localityCode = f.localityA,
): Promise<number> {
  const [inserted] = await db((tx) =>
    tx
      .insert(pendingEdits)
      .values({
        businessId,
        localityCode,
        name: "Nombre Propuesto de Prueba",
        categoryId: f.categoryId,
        whatsapp: fakePhone(),
        zoneId: localityCode === f.localityA ? f.zoneA : f.zoneB,
        createdAt: at("2025-12-01T12:00:00Z"),
        ...values,
      })
      .returning({ id: pendingEdits.id }),
  );
  return inserted!.id;
}

/** An edit resolved at `resolvedAt`, with the status it was resolved with. */
function resolved(
  businessId: string,
  resolvedAt: string,
  status: "applied" | "discarded" | "superseded" = "applied",
  values: Partial<typeof pendingEdits.$inferInsert> = {},
  localityCode = f.localityA,
) {
  return edit(businessId, { ...values, status, resolvedAt: at(resolvedAt) }, localityCode);
}

/** A published card of locality A. */
function published(overrides: Partial<NewBusiness> = {}): Promise<string> {
  return insertBusiness(f, {
    status: "published",
    publishedAt: at("2025-11-02T12:00:00Z"),
    registeredAt: at("2025-11-01T12:00:00Z"),
    ...overrides,
  });
}

async function exists(id: string): Promise<boolean> {
  const found = await db((tx) =>
    tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, id)),
  );
  return found.length === 1;
}

async function editExists(id: number): Promise<boolean> {
  const found = await db((tx) =>
    tx.select({ id: pendingEdits.id }).from(pendingEdits).where(eq(pendingEdits.id, id)),
  );
  return found.length === 1;
}

async function auditOf(id: string) {
  return db((tx) => tx.select().from(adminAuditLog).where(eq(adminAuditLog.businessId, id)));
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

/** The local media bucket with a cache that records what it is asked to purge. */
function testBucket(
  options: {
    remove?: R2Bucket["delete"];
    purge?: (urls: readonly string[]) => Promise<PurgeResult>;
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
    defer: async (urls) => {
      deferred.push(...urls);
    },
  });
  const bucket: MediaBucket = {
    put: env.MEDIA.put.bind(env.MEDIA) as R2Bucket["put"],
    delete: options.remove ?? ((keys) => env.MEDIA.delete(keys)),
    cache,
  };
  return { bucket, purged, deferred };
}

function run(now: string, bucket: MediaBucket = testBucket().bucket) {
  return db((tx) => runRetentionPurge(tx, at(now), bucket));
}

const NONE = { cardsPurged: 0, cardsNotPurged: 0, editsPurged: 0, editsNotPurged: 0 };

describe("Rejected registrations are permanently deleted after 90 days", () => {
  // Rejected at 23:30 of 19 December in Mexico City (05:30 UTC of the 20th):
  // 90 local days later is 19 March, so the first 03:00 local time that finds
  // it due is the one of the 19th, 09:00 UTC.
  const REJECTED = "2025-12-20T05:30:00Z";

  it("is due from the local day 90 days after the local day of the rejection, at 03:00", async () => {
    const id = await rejected(REJECTED);
    expect(await run("2026-03-18T09:00:00Z")).toEqual(NONE);
    expect(await exists(id)).toBe(true);

    expect(await run("2026-03-19T09:00:00Z")).toEqual({ ...NONE, cardsPurged: 1 });
    expect(await exists(id)).toBe(false);
  });

  it("counts the local day, not 90 times 24 hours and not the UTC day", async () => {
    // 90 times 24 hours after the rejection is 05:30 UTC of 20 March, and the
    // UTC day 90 days after the 20th is 20 March too: both a day later.
    const id = await rejected(REJECTED);
    await run("2026-03-19T09:00:00Z");
    expect(await exists(id)).toBe(false);
  });

  it("another locality counts by its own time zone and is purged at its own 03:00", async () => {
    // The same instant is 14:30 of 20 December in Tokyo: due on 20 March
    // there, whose 03:00 JST is 18:00 UTC of the 19th. A is due on the 19th.
    const inA = await rejected(REJECTED);
    const inB = await rejectedInB(REJECTED);
    // 03:00 JST of the 19th: B's hour, but not its day yet.
    expect(await run("2026-03-18T18:00:00Z")).toEqual(NONE);
    // 03:00 in Mexico City of the 19th: A's hour and day, and B's is 18:00.
    expect(await run("2026-03-19T09:00:00Z")).toEqual({ ...NONE, cardsPurged: 1 });
    expect(await exists(inA)).toBe(false);
    expect(await exists(inB)).toBe(true);

    expect(await run("2026-03-19T18:00:00Z")).toEqual({ ...NONE, cardsPurged: 1 });
    expect(await exists(inB)).toBe(false);
  });

  it("is purged at 03:00 local time and at no other local hour, edits too", async () => {
    const inA = await rejected("2025-12-01T12:00:00Z");
    const inB = await rejectedInB("2025-12-01T12:00:00Z");
    const publishedInB = await insertBusiness(f, {
      status: "published",
      publishedAt: at("2025-11-02T12:00:00Z"),
      localityCode: f.localityB,
      zoneId: f.zoneB,
    });
    const editInA = await resolved(await published(), "2026-01-01T12:00:00Z");
    const editInB = await resolved(
      publishedInB,
      "2026-01-01T12:00:00Z",
      "applied",
      {},
      f.localityB,
    );
    const reports = new Map<number, unknown>();
    for (let hour = 0; hour < 24; hour++) {
      const now = `2026-03-10T${String(hour).padStart(2, "0")}:00:00Z`;
      reports.set(hour, await run(now));
    }
    // 03:00 in Mexico City is 09:00 UTC, and 03:00 in Tokyo is 18:00 UTC of the day before.
    for (const [hour, report] of reports) {
      if (hour === 9) expect(report).toEqual({ ...NONE, cardsPurged: 1, editsPurged: 1 });
      else if (hour === 18) expect(report).toEqual({ ...NONE, cardsPurged: 1, editsPurged: 1 });
      else expect(report).toEqual(NONE);
    }
    expect(await exists(inA)).toBe(false);
    expect(await exists(inB)).toBe(false);
    expect(await editExists(editInA)).toBe(false);
    expect(await editExists(editInB)).toBe(false);
  });

  it("a card of 89 days stays and one of 91 days goes", async () => {
    const young = await rejected("2025-12-20T18:00:00Z");
    const old = await rejected("2025-12-17T18:00:00Z");
    expect(await run("2026-03-19T09:00:00Z")).toEqual({ ...NONE, cardsPurged: 1 });
    expect(await exists(young)).toBe(true);
    expect(await exists(old)).toBe(false);
  });

  it("deletes everything that hangs from the card, with its photos first and purged", async () => {
    const own = await storedPhoto();
    const edited = await storedPhoto();
    const id = await rejected("2025-12-01T12:00:00Z", { photoKey: own });
    await edit(id, {
      status: "pending",
      photoChange: "replace",
      newPhotoKey: edited,
    });
    await db((tx) => tx.insert(businessTrades).values({ businessId: id, tradeId: f.tradeIds[0] }));
    await db((tx) =>
      tx.insert(reports).values({ businessId: id, localityCode: f.localityA, reason: "closed" }),
    );

    const seen: boolean[] = [];
    const t = testBucket({
      remove: async (keys) => {
        seen.push(await exists(id));
        await env.MEDIA.delete(keys);
      },
    });
    expect(await run("2026-03-10T09:00:00Z", t.bucket)).toEqual({ ...NONE, cardsPurged: 1 });

    expect(seen).toEqual([true, true]);
    expect(await exists(id)).toBe(false);
    expect(await objectsOf(own)).toEqual([]);
    expect(await objectsOf(edited)).toEqual([]);
    expect(t.purged.toSorted()).toEqual(
      [own, edited]
        .flatMap((key) => [`${MEDIA}/photos/${key}/card.webp`, `${MEDIA}/photos/${key}/full.webp`])
        .toSorted(),
    );
    for (const table of [businessTrades, reports, pendingEdits]) {
      expect(await db((tx) => tx.select().from(table).where(eq(table.businessId, id)))).toEqual([]);
    }
  });

  it("writes an entry of the scheduled job and none of the card's data", async () => {
    const id = await rejected("2025-12-01T12:00:00Z", {
      name: "Nombre Secreto de Prueba",
      photoKey: await storedPhoto(),
    });
    await run("2026-03-10T09:00:00Z");
    const entries = await auditOf(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      localityCode: f.localityA,
      businessId: id,
      actor: SCHEDULED_JOB_ACTOR,
      action: "purge",
      previousStatus: "rejected",
    });
    expect(Object.keys(entries[0]!).toSorted()).toEqual([
      "action",
      "actor",
      "businessId",
      "id",
      "localityCode",
      "occurredAt",
      "previousStatus",
    ]);
    expect(JSON.stringify(entries)).not.toContain("Secreto");
  });

  it("touches nothing else: published, in review and recently rejected cards stay", async () => {
    const ids = [
      await published(),
      await insertBusiness(f, { registeredAt: at("2025-11-01T12:00:00Z") }),
      await rejected("2026-02-20T09:00:00Z"),
      await rejected("2026-03-09T12:00:00Z"),
    ];
    expect(await run("2026-03-10T09:00:00Z")).toEqual(NONE);
    for (const id of ids) expect(await exists(id)).toBe(true);
  });

  it("a card that was rejected, corrected and sent again is not purged", async () => {
    const id = await rejected("2025-12-01T12:00:00Z");
    await db((tx) =>
      tx
        .update(businesses)
        .set({
          status: "in_review",
          previousRejectedAt: at("2025-12-01T12:00:00Z"),
          previousRejectionReason: "No es un negocio real",
          rejectedAt: null,
          rejectionReason: null,
        })
        .where(eq(businesses.id, id)),
    );
    expect(await run("2026-03-10T09:00:00Z")).toEqual(NONE);
    expect(await exists(id)).toBe(true);
    expect(await auditOf(id)).toEqual([]);
  });

  it("a card resubmitted after it was chosen is not purged and keeps its photo", async () => {
    const photo = await storedPhoto();
    const id = await rejected("2025-12-01T12:00:00Z", { photoKey: photo });
    await db((tx) =>
      tx
        .update(businesses)
        .set({ status: "in_review", rejectedAt: null, rejectionReason: null })
        .where(eq(businesses.id, id)),
    );
    const t = testBucket();
    expect(
      await db((tx) => purgeRejectedCard(tx, id, at("2026-03-10T09:00:00Z"), t.bucket)),
    ).toEqual({ kind: "not-due" });
    expect(await exists(id)).toBe(true);
    expect(await objectsOf(photo)).toHaveLength(2);
    expect(t.purged).toEqual([]);
  });

  it("a resubmission that arrives while the photos go waits, and finds no card to change", async () => {
    const photo = await storedPhoto();
    const id = await rejected("2025-12-01T12:00:00Z", { photoKey: photo });
    let resubmission: Promise<unknown> = Promise.resolve();
    const t = testBucket({
      remove: async (keys) => {
        // Not awaited: it waits for the card's row until the purge is done.
        resubmission = db((tx) =>
          tx
            .update(businesses)
            .set({ status: "in_review", rejectedAt: null, rejectionReason: null })
            .where(and(eq(businesses.id, id), eq(businesses.status, "rejected")))
            .returning({ id: businesses.id }),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await env.MEDIA.delete(keys);
      },
    });
    expect(await run("2026-03-10T09:00:00Z", t.bucket)).toEqual({ ...NONE, cardsPurged: 1 });
    expect(await resubmission).toEqual([]);
    expect(await exists(id)).toBe(false);
  });

  it("is idempotent: the second run deletes nothing, fails nothing and says zero", async () => {
    const id = await rejected("2025-12-01T12:00:00Z");
    expect(await run("2026-03-10T09:00:00Z")).toEqual({ ...NONE, cardsPurged: 1 });
    expect(await run("2026-03-10T09:00:00Z")).toEqual(NONE);
    expect(await auditOf(id)).toHaveLength(1);
  });
});

describe("Applied, discarded and superseded pending edits are purged after 30 days (v2)", () => {
  // Resolved at 23:30 of 8 January in Mexico City (05:30 UTC of the 9th): due
  // on 7 February, so the first 03:00 local time that finds it due is the one
  // of the 7th, 09:00 UTC.
  const RESOLVED = "2026-01-09T05:30:00Z";

  it("purges applied, discarded and superseded edits from the local day 30 days later, at 03:00", async () => {
    const id = await published();
    const edits = [
      await resolved(id, RESOLVED, "applied"),
      await resolved(id, RESOLVED, "discarded"),
      await resolved(id, RESOLVED, "superseded"),
    ];
    expect(await run("2026-02-06T09:00:00Z")).toEqual(NONE);
    for (const edit_ of edits) expect(await editExists(edit_)).toBe(true);

    expect(await run("2026-02-07T09:00:00Z")).toEqual({ ...NONE, editsPurged: 3 });
    for (const edit_ of edits) expect(await editExists(edit_)).toBe(false);
    // The card is unchanged, and no entry says an edit was purged.
    expect(await exists(id)).toBe(true);
    expect(await auditOf(id)).toEqual([]);
  });

  it("another locality counts by its own time zone and is purged at its own 03:00", async () => {
    const inA = await published();
    const inB = await insertBusiness(f, {
      status: "published",
      publishedAt: at("2025-11-02T12:00:00Z"),
      localityCode: f.localityB,
      zoneId: f.zoneB,
    });
    // 23:30 of 8 January in Tokyo (08:30 in Mexico City): due on 7 February in both.
    const a = await resolved(inA, "2026-01-08T14:30:00Z");
    const b = await resolved(inB, "2026-01-08T14:30:00Z", "applied", {}, f.localityB);
    // 03:00 in Mexico City of the 6th: A's hour, not its day yet.
    expect(await run("2026-02-06T09:00:00Z")).toEqual(NONE);
    // 03:00 JST of the 7th: B's own, and A's is 12:00.
    expect(await run("2026-02-06T18:00:00Z")).toEqual({ ...NONE, editsPurged: 1 });
    expect(await editExists(b)).toBe(false);
    expect(await editExists(a)).toBe(true);
    expect(await run("2026-02-07T09:00:00Z")).toEqual({ ...NONE, editsPurged: 1 });
    expect(await editExists(a)).toBe(false);
  });

  it("leaves an edit that is still waiting and one resolved 29 days ago", async () => {
    const id = await published();
    const other = await published();
    const waiting = await edit(id, { status: "pending", createdAt: at("2025-12-20T12:00:00Z") });
    const recent = await resolved(other, "2026-01-12T12:00:00Z");
    expect(await run("2026-02-10T09:00:00Z")).toEqual(NONE);
    expect(await editExists(waiting)).toBe(true);
    expect(await editExists(recent)).toBe(true);
  });

  it("the photo of an applied edit that its card still names stays", async () => {
    const photo = await storedPhoto();
    const id = await published({ photoKey: photo });
    const applied = await resolved(id, RESOLVED, "applied", {
      photoChange: "replace",
      newPhotoKey: photo,
    });
    const t = testBucket();
    expect(await run("2026-02-20T09:00:00Z", t.bucket)).toEqual({ ...NONE, editsPurged: 1 });
    expect(await editExists(applied)).toBe(false);
    expect(await objectsOf(photo)).toHaveLength(2);
    expect(t.purged).toEqual([]);
  });

  it("a photo that an edit left behind and no card names is deleted first and purged", async () => {
    const left = await storedPhoto();
    const id = await published();
    await resolved(id, RESOLVED, "discarded", { photoChange: "replace", newPhotoKey: left });
    const seen: boolean[] = [];
    const t = testBucket({
      remove: async (keys) => {
        seen.push(
          (await db((tx) => tx.select().from(pendingEdits).where(eq(pendingEdits.businessId, id))))
            .length === 1,
        );
        await env.MEDIA.delete(keys);
      },
    });
    expect(await run("2026-02-20T09:00:00Z", t.bucket)).toEqual({ ...NONE, editsPurged: 1 });
    expect(seen).toEqual([true]);
    expect(await objectsOf(left)).toEqual([]);
    expect(t.purged.toSorted()).toEqual([
      `${MEDIA}/photos/${left}/card.webp`,
      `${MEDIA}/photos/${left}/full.webp`,
    ]);
  });

  it("the new photo of an edit that still waits is never touched", async () => {
    const waitingPhoto = await storedPhoto();
    const id = await published();
    const waiting = await edit(id, {
      status: "pending",
      photoChange: "replace",
      newPhotoKey: waitingPhoto,
      createdAt: at("2025-11-01T12:00:00Z"),
    });
    const other = await published();
    await resolved(other, RESOLVED);
    await run("2026-02-20T09:00:00Z");
    expect(await editExists(waiting)).toBe(true);
    expect(await objectsOf(waitingPhoto)).toHaveLength(2);
  });

  it("is idempotent", async () => {
    const id = await published();
    await resolved(id, RESOLVED);
    expect(await run("2026-02-20T09:00:00Z")).toEqual({ ...NONE, editsPurged: 1 });
    expect(await run("2026-02-20T09:00:00Z")).toEqual(NONE);
  });
});

describe("The scheduled purges report what they could not purge", () => {
  const down: R2Bucket["delete"] = () => Promise.reject(new TypeError("R2 down"));

  it("a card whose photo cannot be deleted stays whole, the others go, and it is counted", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const photo = await storedPhoto();
    const stuck = await rejected("2025-12-01T12:00:00Z", { photoKey: photo });
    await db((tx) =>
      tx.insert(reports).values({ businessId: stuck, localityCode: f.localityA, reason: "closed" }),
    );
    const noPhoto = await rejected("2025-12-02T12:00:00Z");
    const t = testBucket({ remove: down });

    const report = await run("2026-03-10T09:00:00Z", t.bucket);
    expect(report).toEqual({ ...NONE, cardsPurged: 1, cardsNotPurged: 1 });
    expect(retentionPurgeFailure(report)).toBe(
      "1 card(s) purged, 1 not purged, 0 edit(s) purged, 0 not purged",
    );
    expect(await exists(noPhoto)).toBe(false);
    expect(await exists(stuck)).toBe(true);
    expect(await auditOf(stuck)).toEqual([]);
    expect(
      await db((tx) => tx.select().from(reports).where(eq(reports.businessId, stuck))),
    ).toHaveLength(1);
    expect(await objectsOf(photo)).toHaveLength(2);

    // The next run, with the store back, purges it.
    expect(await run("2026-03-11T09:00:00Z")).toEqual({ ...NONE, cardsPurged: 1 });
    expect(await exists(stuck)).toBe(false);
    expect(await objectsOf(photo)).toEqual([]);
    for (const line of log.mock.calls.flat()) expect(String(line)).not.toContain(photo);
  });

  it("an edit whose photo cannot be deleted stays, the others go, and it is counted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const left = await storedPhoto();
    const id = await published();
    const stuck = await resolved(id, "2026-01-01T12:00:00Z", "discarded", {
      photoChange: "replace",
      newPhotoKey: left,
    });
    const other = await resolved(id, "2026-01-02T12:00:00Z");
    const report = await run("2026-02-20T09:00:00Z", testBucket({ remove: down }).bucket);
    expect(report).toEqual({ ...NONE, editsPurged: 1, editsNotPurged: 1 });
    expect(await editExists(stuck)).toBe(true);
    expect(await editExists(other)).toBe(false);
    expect(await run("2026-02-21T09:00:00Z")).toEqual({ ...NONE, editsPurged: 1 });
  });

  it("a purge of the cache that fails keeps the addresses for the retry and still deletes the card", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const photo = await storedPhoto();
    const id = await rejected("2025-12-01T12:00:00Z", { photoKey: photo });
    const t = testBucket({ purge: async () => ({ ok: false, failure: "HTTP 503" }) });
    expect(await run("2026-03-10T09:00:00Z", t.bucket)).toEqual({ ...NONE, cardsPurged: 1 });
    expect(await exists(id)).toBe(false);
    expect(t.deferred.toSorted()).toEqual([
      `${MEDIA}/photos/${photo}/card.webp`,
      `${MEDIA}/photos/${photo}/full.webp`,
    ]);
  });

  it("rows that cannot be deleted are counted, and the next run purges them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await rejected("2025-12-01T12:00:00Z");
    const lost = Object.assign(new Error("connection lost to 7719990001"), { code: "57P01" });
    const report = await db((tx) => {
      // The reads work and the transaction of the purge breaks.
      const broken = new Proxy(tx, {
        get(target, property) {
          if (property === "transaction") return () => Promise.reject(lost);
          const value = Reflect.get(target, property) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return runRetentionPurge(broken, at("2026-03-10T09:00:00Z"), testBucket().bucket);
    });
    expect(report).toEqual({ ...NONE, cardsNotPurged: 1 });
    expect(await exists(id)).toBe(true);
    expect(log.mock.calls.flat()).toEqual([
      "review: a rejected card could not be purged (PostgreSQL 57P01)",
    ]);

    expect(await run("2026-03-11T09:00:00Z")).toEqual({ ...NONE, cardsPurged: 1 });
  });

  it("the task fails the run with counts only, and reports them when it works", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const photo = await storedPhoto();
    await rejected("2025-12-01T12:00:00Z", { photoKey: photo, name: "Nombre Secreto de Prueba" });
    const now = at("2026-03-10T09:00:00Z");
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) };
    const controller = createScheduledController({ cron: "0 * * * *", scheduledTime: now });

    const failing = testBucket({ remove: down }).bucket;
    await expect(
      runScheduledTasks(controller, env, ctx as unknown as ExecutionContext, [
        { name: "retention-purge", run: (e, n, c) => purgeExpiredRecords(e, n, c, failing) },
      ]),
    ).rejects.toThrow("1 task(s) failed: retention-purge");
    expect(error.mock.calls.flat()).toContain(
      "scheduled: retention-purge failed (0 card(s) purged, 1 not purged, 0 edit(s) purged, 0 not purged)",
    );
    for (const line of error.mock.calls.flat()) {
      expect(String(line)).not.toMatch(/Secreto|771999|[0-9a-f]{32}/);
    }
    await expect(purgeExpiredRecords(env, now, ctx, failing)).rejects.toBeInstanceOf(
      IncompleteTask,
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runScheduledTasks(controller, env, ctx as unknown as ExecutionContext, [
      { name: "retention-purge", run: (e, n, c) => purgeExpiredRecords(e, n, c) },
    ]);
    expect(log.mock.calls.flat()).toContain(
      "scheduled: retention-purge done (1 cardsPurged, 0 cardsNotPurged, 0 editsPurged, 0 editsNotPurged)",
    );
    await Promise.all(pending);
  });

  it("the hourly job has the task, once", () => {
    expect(SCHEDULED_TASKS.filter(({ name }) => name === "retention-purge")).toHaveLength(1);
  });
});

describe("One run does a bounded amount of work", () => {
  it("purges the oldest cards first, up to the limit, and leaves the rest for the next run", async () => {
    const oldest = await rejected("2025-11-01T12:00:00Z");
    const middle = await rejected("2025-11-02T12:00:00Z");
    const newest = await rejected("2025-11-03T12:00:00Z");
    const limits = { cards: 2, edits: 2, photos: 100 };
    const bucket = testBucket().bucket;
    expect(
      await db((tx) => runRetentionPurge(tx, at("2026-03-10T09:00:00Z"), bucket, limits)),
    ).toEqual({ ...NONE, cardsPurged: 2 });
    expect(await exists(oldest)).toBe(false);
    expect(await exists(middle)).toBe(false);
    expect(await exists(newest)).toBe(true);
    expect(
      await db((tx) => runRetentionPurge(tx, at("2026-03-11T09:00:00Z"), bucket, limits)),
    ).toEqual({ ...NONE, cardsPurged: 1 });
  });

  it("purges the oldest edits first, up to the limit", async () => {
    const id = await published();
    const first = await resolved(id, "2026-01-01T12:00:00Z");
    const second = await resolved(id, "2026-01-02T12:00:00Z");
    const third = await resolved(id, "2026-01-03T12:00:00Z");
    const limits = { cards: 2, edits: 2, photos: 100 };
    const bucket = testBucket().bucket;
    expect(
      await db((tx) => runRetentionPurge(tx, at("2026-03-10T09:00:00Z"), bucket, limits)),
    ).toEqual({ ...NONE, editsPurged: 2 });
    expect(await editExists(first)).toBe(false);
    expect(await editExists(second)).toBe(false);
    expect(await editExists(third)).toBe(true);
  });

  it("starts no new item once the photos of the run are spent", async () => {
    const keys = [await storedPhoto(), await storedPhoto(), await storedPhoto()];
    const ids = [
      await rejected("2025-11-01T12:00:00Z", { photoKey: keys[0]! }),
      await rejected("2025-11-02T12:00:00Z", { photoKey: keys[1]! }),
      await rejected("2025-11-03T12:00:00Z", { photoKey: keys[2]! }),
    ];
    const limits = { cards: 20, edits: 20, photos: 2 };
    const bucket = testBucket().bucket;
    expect(
      await db((tx) => runRetentionPurge(tx, at("2026-03-10T09:00:00Z"), bucket, limits)),
    ).toEqual({ ...NONE, cardsPurged: 2 });
    expect(await exists(ids[2]!)).toBe(true);
  });

  it("the default limit is a number a Worker can take", () => {
    expect(MAX_CARDS_PER_RUN).toBeGreaterThan(0);
    expect(MAX_CARDS_PER_RUN).toBeLessThanOrEqual(25);
  });
});
