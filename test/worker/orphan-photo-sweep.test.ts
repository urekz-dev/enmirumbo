// The orphan-photo sweep (ADR 0011; docs/specs/deployment.md, "The orphan-
// photo sweep is a task of the hourly job and a sweep that cannot finish is an
// error (v2)"). It runs against the local R2 bucket and the test database:
// card and edit references come from PostgreSQL, while R2's listing and object
// metadata decide what is stored and old enough to delete.
// The bucket is shared with the files that run at the same time, so the sweep
// is handed a listing of this file's own objects (localMediaWithAges).
import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
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
import { businesses, orphanPhotoSweepState, pendingEdits } from "../../src/core/db/schema/index.ts";
import {
  PHOTO_CACHE_CONTROL,
  PHOTO_CONTENT_TYPE,
  newPhotoKey,
  photoObjectKeys,
  DEV_PHOTOS_PREFIX,
} from "../../src/core/photos/photo.ts";
import { mediaBucket } from "../../src/lib/media-bucket.ts";
import { sweepOrphanPhotos, type OrphanPhotoSweepLimits } from "../../src/core/photos/sweep.ts";
import { IncompleteTask, runOrphanPhotoSweepTask } from "../../src/scheduled.ts";
import { deletePhoto, type MediaBucket } from "../../src/core/photos/upload.ts";
import { cleanup, createFixture, db, fakePhone, insertBusiness, type Fixture } from "./fixtures.ts";

const STATE = "64";
const DAY_MS = 24 * 60 * 60 * 1000;
const listingCalls: { cursor?: string; limit: number; prefix?: string }[] = [];
const photos = new Set<string>();
// Under photos/, but no photo's variant: the sweep counts it and never touches it.
const STRAY = "photos/stray-file.txt";
let fixture: Fixture;

function withUploaded<T extends R2Object>(object: T, uploaded: Date): T {
  const copy = Object.create(
    Object.getPrototypeOf(object),
    Object.getOwnPropertyDescriptors(object),
  ) as T;
  Object.defineProperty(copy, "uploaded", { value: uploaded, configurable: true });
  return copy;
}

/** The keys of the objects this file writes, deleted or not: all it lets the sweep see. */
function ownObjectKeys(): string[] {
  return [...new Set([...photos].flatMap(photoObjectKeys).concat(STRAY))].toSorted();
}

/** The objects of this file that are in the bucket now. */
async function storedOwnObjects(): Promise<string[]> {
  const found = await Promise.all(ownObjectKeys().map((key) => env.MEDIA.head(key)));
  return found.filter((object) => object !== null).map(({ key }) => key);
}

/**
 * The listing and the heads of the sweep: only the objects this file wrote,
 * because the local bucket is shared with the test files that run at the same
 * time and the sweep's counts must be this file's alone. Listing is what R2's
 * is: by key under the prefix, `limit` objects a page, and a cursor (here the
 * last key listed) that resumes after it. The real objects are served, with
 * the ages the test gives them.
 */
function localMediaWithAges(
  ages: ReadonlyMap<string, Date> = new Map<string, Date>(),
): Pick<R2Bucket, "list" | "head"> {
  const aged = (object: R2Object) => {
    const uploaded = ages.get(object.key);
    return uploaded === undefined ? object : withUploaded(object, uploaded);
  };
  return {
    async list(options?: R2ListOptions) {
      const call: { cursor?: string; limit: number; prefix?: string } = {
        limit: options?.limit ?? 1000,
      };
      if (options?.cursor !== undefined) call.cursor = options.cursor;
      if (options?.prefix !== undefined) call.prefix = options.prefix;
      listingCalls.push({
        ...call,
      });
      const objects: R2Object[] = [];
      for (const key of ownObjectKeys()) {
        if (options?.prefix !== undefined && !key.startsWith(options.prefix)) continue;
        if (options?.cursor !== undefined && key <= options.cursor) continue;
        const object = await env.MEDIA.head(key);
        if (object !== null) objects.push(aged(object));
      }
      const page = objects.slice(0, call.limit);
      const truncated = objects.length > call.limit;
      return {
        objects: page,
        delimitedPrefixes: [],
        truncated,
        ...(truncated ? { cursor: page.at(-1)!.key } : {}),
      } as R2Objects;
    },
    async head(key) {
      const object = await env.MEDIA.head(key);
      return object === null ? null : aged(object);
    },
  };
}

function localDeletionBucket(purge = vi.fn(async () => "purged" as const)): MediaBucket {
  return {
    photoFolder: "photos/" as const,
    put: env.MEDIA.put.bind(env.MEDIA) as R2Bucket["put"],
    delete: (keys) => env.MEDIA.delete(keys),
    cache: { purge },
  };
}

async function writePhoto(key = newPhotoKey()): Promise<string> {
  photos.add(key);
  for (const objectKey of photoObjectKeys(key)) {
    await env.MEDIA.put(objectKey, new Uint8Array([82, 73, 70, 70]), {
      httpMetadata: { cacheControl: PHOTO_CACHE_CONTROL, contentType: PHOTO_CONTENT_TYPE },
    });
  }
  return key;
}

async function markOld(key: string): Promise<Map<string, Date>> {
  const old = new Date(Date.now() - 8 * DAY_MS);
  return new Map(photoObjectKeys(key).map((objectKey) => [objectKey, old]));
}

async function sweep(
  now = new Date(),
  ages: ReadonlyMap<string, Date> = new Map(),
  limits: OrphanPhotoSweepLimits = {},
  deletionBucket = localDeletionBucket(),
) {
  return db((tx) => sweepOrphanPhotos(tx, localMediaWithAges(ages), deletionBucket, now, limits));
}

async function insertEdit(businessId: string, newPhotoKey: string, status: "pending" | "applied") {
  await db((tx) =>
    tx.insert(pendingEdits).values({
      businessId,
      localityCode: fixture.localityA,
      name: "Plomería de Prueba",
      categoryId: fixture.categoryId,
      whatsapp: fakePhone(),
      zoneId: fixture.zoneA,
      photoChange: "replace",
      newPhotoKey,
      status,
      resolvedAt: status === "pending" ? null : new Date(),
    }),
  );
}

beforeAll(async () => {
  fixture = await createFixture(STATE);
});

beforeEach(async () => {
  listingCalls.length = 0;
  const bucket = localDeletionBucket();
  for (const key of photos) await deletePhoto(bucket, key);
  photos.clear();
  await db(async (tx) => {
    await tx
      .delete(businesses)
      .where(inArray(businesses.localityCode, [fixture.localityA, fixture.localityB]));
    await tx
      .update(orphanPhotoSweepState)
      .set({ cursor: null, completedOn: null, photoFolder: null, startedAt: null })
      .where(eq(orphanPhotoSweepState.singleton, true));
  });
  await env.MEDIA.delete(["outside/photos/not-a-business-photo.webp", STRAY]);
});

afterAll(async () => {
  const bucket = localDeletionBucket();
  for (const key of photos) await deletePhoto(bucket, key);
  await env.MEDIA.delete(["outside/photos/not-a-business-photo.webp", STRAY]);
  await cleanup(STATE);
});

describe("The orphan-photo sweep is bounded, age-gated and reference-aware (v2)", () => {
  it.for([true, false])(
    "dev starts its own pass after copying stage state (completed=%s)",
    async (completed) => {
      const now = new Date();
      const key = await writePhoto(newPhotoKey(DEV_PHOTOS_PREFIX));
      await db((tx) =>
        tx.update(orphanPhotoSweepState).set({
          photoFolder: "photos/",
          cursor: completed ? null : "stage-cursor",
          completedOn: now.toISOString().slice(0, 10),
        }),
      );
      const fetch = vi.fn(async () => Response.json({ success: true }));
      const bucket = mediaBucket(
        {
          ...env,
          ENVIRONMENT: "dev",
          MEDIA_URL: "https://sweep.enmirumbo.test",
          MEDIA_ZONE_ID: "a".repeat(32),
          MEDIA_CACHE_PURGE_TOKEN: crypto.randomUUID(),
        },
        fetch,
      );

      expect(await sweep(now, await markOld(key), {}, bucket)).toMatchObject({
        deletedPhotos: 1,
        skipped: 0,
        failed: 0,
      });
      expect(listingCalls[0]).toMatchObject({ prefix: "dev/photos/" });
      expect(listingCalls[0]?.cursor).toBeUndefined();
      expect((await db((tx) => tx.select().from(orphanPhotoSweepState)))[0]).toMatchObject({
        photoFolder: "dev/photos/",
        cursor: null,
        completedOn: now.toISOString().slice(0, 10),
      });
      expect(await sweep(now, await markOld(key), {}, bucket)).toMatchObject({ skipped: 1 });
    },
  );

  it("a legacy photos/ cursor stays valid, while dev continuations keep their folder", async () => {
    const first = await writePhoto();
    const second = await writePhoto();
    const keys = [first, second].toSorted();
    const cursor = photoObjectKeys(keys[0]!)[1]!;
    await db((tx) => tx.update(orphanPhotoSweepState).set({ photoFolder: null, cursor }));
    const ages = new Map([...(await markOld(first)), ...(await markOld(second))]);
    expect(await sweep(new Date(), ages)).toMatchObject({ deletedPhotos: 1 });
    expect(listingCalls[0]?.cursor).toBe(cursor);

    const devKey = await writePhoto(newPhotoKey(DEV_PHOTOS_PREFIX));
    const devKey2 = await writePhoto(newPhotoKey(DEV_PHOTOS_PREFIX));
    const bucket: MediaBucket = { ...localDeletionBucket(), photoFolder: DEV_PHOTOS_PREFIX };
    const devAges = new Map([...(await markOld(devKey)), ...(await markOld(devKey2))]);
    expect(
      await sweep(new Date(), devAges, { pageSize: 1, objectsPerRun: 1 }, bucket),
    ).toMatchObject({ continued: 1, deletedPhotos: 1 });
    const [state] = await db((tx) => tx.select().from(orphanPhotoSweepState));
    expect(state?.photoFolder).toBe(DEV_PHOTOS_PREFIX);
    const calls = listingCalls.length;
    expect(await sweep(new Date(), devAges, {}, bucket)).toMatchObject({
      deletedPhotos: 1,
      continued: 0,
    });
    expect(listingCalls[calls]?.cursor).toBe(state?.cursor);
  });

  it.for(["dev", "stage"])(
    "%s lists only its own folder in the shared bucket",
    async (environment) => {
      const stageKey = await writePhoto();
      const devKey = await writePhoto(newPhotoKey(DEV_PHOTOS_PREFIX));
      const ages = new Map([...(await markOld(stageKey)), ...(await markOld(devKey))]);
      const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
        Response.json({ success: true }),
      );
      const bucket = mediaBucket(
        {
          ...env,
          ENVIRONMENT: environment,
          MEDIA_URL: "https://sweep.enmirumbo.test",
          MEDIA_ZONE_ID: "a".repeat(32),
          MEDIA_CACHE_PURGE_TOKEN: crypto.randomUUID(),
        },
        fetch,
      );

      const counts = await sweep(new Date(), ages, {}, bucket);

      expect(counts).toMatchObject({
        listedObjects: 2,
        deletedPhotos: 1,
        deletedObjects: 2,
        failed: 0,
      });
      expect(listingCalls.every(({ prefix }) => prefix === bucket.photoFolder)).toBe(true);
      for (const key of photoObjectKeys(environment === "dev" ? stageKey : devKey))
        expect(await env.MEDIA.head(key)).not.toBeNull();
      for (const key of photoObjectKeys(environment === "dev" ? devKey : stageKey))
        expect(await env.MEDIA.head(key)).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("deletes an orphan older than seven days through the photo cache purge path", async () => {
    const key = await writePhoto();
    const purge = vi.fn(async () => "purged" as const);
    const ages = await markOld(key);

    const counts = await sweep(new Date(), ages, {}, localDeletionBucket(purge));

    expect(counts).toMatchObject({
      listedObjects: 2,
      deletedPhotos: 1,
      deletedObjects: 2,
      incomplete: 0,
    });
    expect(
      await Promise.all(photoObjectKeys(key).map((objectKey) => env.MEDIA.head(objectKey))),
    ).toEqual([null, null]);
    expect(purge).toHaveBeenCalledExactlyOnceWith(key);
    expect(await sweep(new Date(), ages)).toMatchObject({
      listedObjects: 0,
      deletedPhotos: 0,
      skipped: 1,
      incomplete: 0,
    });
  });

  it("keeps a photo younger than seven days", async () => {
    const key = await writePhoto();

    const counts = await sweep(new Date());

    expect(counts).toMatchObject({ deletedPhotos: 0, youngPhotos: 1, incomplete: 0 });
    expect(
      await Promise.all(photoObjectKeys(key).map((objectKey) => env.MEDIA.head(objectKey))),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ key: photoObjectKeys(key)[0] })]));
  });

  it("keeps a card photo and a pending edit photo, including a resolved edit's key", async () => {
    const cardKey = await writePhoto();
    const pendingKey = await writePhoto();
    const resolvedKey = await writePhoto();
    const cardId = await insertBusiness(fixture, { photoKey: cardKey });
    const pendingEditCardId = await insertBusiness(fixture);
    const resolvedEditCardId = await insertBusiness(fixture);
    await insertEdit(pendingEditCardId, pendingKey, "pending");
    await insertEdit(resolvedEditCardId, resolvedKey, "applied");
    const ages = new Map([
      ...(await markOld(cardKey)),
      ...(await markOld(pendingKey)),
      ...(await markOld(resolvedKey)),
    ]);

    const counts = await sweep(new Date(), ages);

    expect(counts).toMatchObject({ deletedPhotos: 0, referencedPhotos: 3, incomplete: 0 });
    expect(
      await db((tx) =>
        tx
          .select({ id: businesses.id })
          .from(businesses)
          .where(inArray(businesses.id, [cardId, pendingEditCardId, resolvedEditCardId])),
      ),
    ).toHaveLength(3);
    for (const key of [cardKey, pendingKey, resolvedKey]) {
      expect(
        await Promise.all(photoObjectKeys(key).map((objectKey) => env.MEDIA.head(objectKey))),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: photoObjectKeys(key)[0] })]),
      );
    }
  });

  it("lists multiple R2 pages and never touches objects outside photos/", async () => {
    const keys = await Promise.all(Array.from({ length: 3 }, () => writePhoto()));
    const orphan = await writePhoto("z".repeat(24));
    const businessIds = await Promise.all(
      keys.map((photoKey) => insertBusiness(fixture, { photoKey })),
    );
    const outside = "outside/photos/not-a-business-photo.webp";
    await env.MEDIA.put(outside, new Uint8Array([1]));
    const ages = new Map<string, Date>();
    for (const key of [...keys, orphan])
      for (const [objectKey, date] of await markOld(key)) ages.set(objectKey, date);

    const counts = await sweep(new Date(), ages, { pageSize: 3, objectsPerRun: 20 });

    expect(counts).toMatchObject({ deletedPhotos: 1, referencedPhotos: 3, incomplete: 0 });
    expect(listingCalls.length).toBeGreaterThan(1);
    expect(listingCalls.every(({ prefix }) => prefix === "photos/")).toBe(true);
    expect(new Set(listingCalls.map(({ cursor }) => cursor).filter(Boolean)).size).toBeGreaterThan(
      0,
    );
    expect(await env.MEDIA.head(outside)).not.toBeNull();
    expect(
      (
        await db((tx) =>
          tx
            .select({ id: businesses.id })
            .from(businesses)
            .where(inArray(businesses.id, businessIds)),
        )
      ).length,
    ).toBe(3);
  });

  it("stops at the per-run object bound, resumes next run, and completes only once per UTC day", async () => {
    const keys = await Promise.all(Array.from({ length: 3 }, () => writePhoto()));
    await Promise.all(keys.map((photoKey) => insertBusiness(fixture, { photoKey })));
    const now = new Date();
    const limits = { pageSize: 2, objectsPerRun: 2 };

    const first = await sweep(now, new Map(), limits);
    const stateAfterFirst = await db(
      async (tx) =>
        (
          await tx
            .select()
            .from(orphanPhotoSweepState)
            .where(eq(orphanPhotoSweepState.singleton, true))
        )[0],
    );
    const second = await sweep(now, new Map(), limits);
    const third = await sweep(now, new Map(), limits);
    const skipped = await sweep(now, new Map(), limits);

    expect(first).toMatchObject({ listedObjects: 2, continued: 1, incomplete: 0 });
    expect(stateAfterFirst?.cursor).toBeTruthy();
    expect(stateAfterFirst?.startedAt).toEqual(now);
    expect(second).toMatchObject({ listedObjects: 2, continued: 1, incomplete: 0 });
    expect(third).toMatchObject({ listedObjects: 2, continued: 0, incomplete: 0 });
    expect(skipped).toMatchObject({ listedObjects: 0, skipped: 1, continued: 0, incomplete: 0 });
    expect(listingCalls[1]?.cursor).toBe(stateAfterFirst?.cursor);
  });

  it("reports a failed deletion without keys and retries it on the next hourly run", async () => {
    const key = await writePhoto();
    const ages = await markOld(key);
    let failOnce = true;
    const base = localDeletionBucket();
    const failingBucket: MediaBucket = {
      ...base,
      delete: async (keys) => {
        if (failOnce) {
          failOnce = false;
          throw new TypeError("R2 unavailable");
        }
        return base.delete(keys);
      },
    };

    const startedAt = new Date();
    const first = await sweep(startedAt, ages, {}, failingBucket);
    expect((await db((tx) => tx.select().from(orphanPhotoSweepState)))[0]?.startedAt).toEqual(
      startedAt,
    );
    const failureLog = JSON.stringify(first);
    const retried = await sweep(new Date(Date.now() + 60 * 60 * 1000), ages, {}, failingBucket);

    expect(first).toMatchObject({ deletedPhotos: 0, failed: 1, incomplete: 1 });
    expect(failureLog).not.toContain(key);
    expect(retried).toMatchObject({ deletedPhotos: 1, incomplete: 0 });
    expect((await db((tx) => tx.select().from(orphanPhotoSweepState)))[0]?.startedAt).toBeNull();
    expect(
      await Promise.all(photoObjectKeys(key).map((objectKey) => env.MEDIA.head(objectKey))),
    ).toEqual([null, null]);
  });

  it("keeps the second variant when it is younger than the grace period", async () => {
    const key = await writePhoto();
    const ages = await markOld(key);
    ages.set(photoObjectKeys(key)[1]!, new Date());

    const counts = await sweep(new Date(), ages);

    expect(counts).toMatchObject({ deletedPhotos: 0, youngPhotos: 1, incomplete: 0 });
    expect(
      await Promise.all(photoObjectKeys(key).map((objectKey) => env.MEDIA.head(objectKey))),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ key: photoObjectKeys(key)[0] })]));
  });
  it("stops at the per-run bound of deleted photos and deletes the rest next hour", async () => {
    const keys = await Promise.all(Array.from({ length: 3 }, () => writePhoto()));
    const ages = new Map<string, Date>();
    for (const key of keys)
      for (const [objectKey, date] of await markOld(key)) ages.set(objectKey, date);

    const first = await sweep(new Date(), ages, { photosPerRun: 2 });
    const second = await sweep(new Date(), ages, { photosPerRun: 2 });

    expect(first).toMatchObject({
      deletedPhotos: 2,
      deletedObjects: 4,
      continued: 1,
      incomplete: 0,
    });
    expect(second).toMatchObject({
      deletedPhotos: 1,
      deletedObjects: 2,
      continued: 0,
      incomplete: 0,
    });
    expect(await storedOwnObjects()).toEqual([]);
  });

  it("counts an object under photos/ that is no photo, keeps it, and still finishes the pass", async () => {
    const key = await writePhoto();
    await env.MEDIA.put(STRAY, new Uint8Array([1]));
    const ages = await markOld(key);

    const counts = await sweep(new Date(), ages, { pageSize: 1 });

    expect(counts).toMatchObject({
      deletedPhotos: 1,
      invalidObjects: 1,
      continued: 0,
      incomplete: 0,
    });
    expect(await env.MEDIA.head(STRAY)).not.toBeNull();
    expect(
      await db(async (tx) => (await tx.select().from(orphanPhotoSweepState))[0]),
    ).toMatchObject({ cursor: null, completedOn: new Date().toISOString().slice(0, 10) });
  });
});

describe("The orphan-photo sweep task fails visibly with counts only (v2)", () => {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
  afterEach(async () => {
    await Promise.all(pending.splice(0));
  });

  it("reports an unsweepable object as a failed run without naming it, and a clean run as counts", async () => {
    const clean = await runOrphanPhotoSweepTask(env, new Date(), ctx);
    expect(clean).toMatchObject({ invalidObjects: 0, incomplete: 0 });

    await db((tx) => tx.update(orphanPhotoSweepState).set({ cursor: null, completedOn: null }));
    await env.MEDIA.put(STRAY, new Uint8Array([1]));
    const failure = await runOrphanPhotoSweepTask(env, new Date(), ctx).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(IncompleteTask);
    expect((failure as Error).message).toContain("1 invalidObjects");
    expect((failure as Error).message).not.toContain("stray");
  });
});
