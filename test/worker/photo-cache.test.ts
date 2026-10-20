// Scenarios of docs/specs/deployment.md, "A deleted photo is purged from the
// cache of the media hostname, and a purge that fails is retried every hour
// (v2)", and of docs/specs/data-model.md, "The photo addresses waiting for
// their purge are the only thing kept of a deleted photo (v2)": the purge of
// both addresses of a deleted photo through Cloudflare's purge by URL
// (src/core/photos/cache.ts), with a fake fetch, never the network; what
// deletePhoto and removePhoto do with it (src/core/photos/upload.ts); the
// media bucket of the Worker, locally and as a deployed environment builds it
// (src/lib/media-bucket.ts); the table of the addresses that wait; and the
// task of the hourly job that retries them (src/scheduled.ts).
//
// This is the only test file that writes to `photo_cache_purges`, so its
// counts are its own; it empties the table before and after. The photos it
// stores are drawn in code and removed from the local media bucket after it.
// No token here is real.
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { photoCachePurges } from "../../src/core/db/schema/index.ts";
import {
  type CachePurge,
  CLOUDFLARE_API,
  deferCachePurge,
  MAX_PURGE_URLS,
  NO_PHOTO_CACHE,
  type PhotoCache,
  photoCache,
  photoCacheUrls,
  type PurgeResult,
  purgeCachedUrls,
  retryCachePurges,
} from "../../src/core/photos/cache.ts";
import { DEV_PHOTOS_PREFIX, newPhotoKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import { deletePhoto, type MediaBucket, removePhoto } from "../../src/core/photos/upload.ts";
import { cachedMediaOrigin, mediaBucket } from "../../src/lib/media-bucket.ts";
import { IncompleteTask, purgeWaitingPhotos, runScheduledTasks } from "../../src/scheduled.ts";
import { db, pgErrorCode, PG } from "./fixtures.ts";

const BASE = "https://media-test.enmirumbo.test";
const ZONE = "0123456789abcdef0123456789abcdef";
const TOKEN = "fictitious-cache-purge-token";

/** The addresses that wait for their purge, sorted. */
async function waiting(): Promise<string[]> {
  const rows = await db((tx) => tx.select({ url: photoCachePurges.url }).from(photoCachePurges));
  return rows.map(({ url }) => url).toSorted();
}

async function emptyTable(): Promise<void> {
  await db((tx) => tx.delete(photoCachePurges));
}

beforeAll(emptyTable);
afterAll(emptyTable);
afterEach(async () => {
  vi.restoreAllMocks();
  await emptyTable();
});

/** A fake of Cloudflare's API: each call recorded, each answer from `answer`. */
function fakeApi(answer: () => Response | Promise<Response> = () => apiAnswer(200, true)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  };
  return { calls, fetch };
}

function apiAnswer(status: number, success: boolean, codes: number[] = []): Response {
  return Response.json(
    {
      success,
      errors: codes.map((code) => ({ code, message: "fictitious" })),
      messages: [],
      result: success ? { id: "a".repeat(32) } : null,
    },
    { status },
  );
}

/** The files a recorded call asked to purge. */
function filesOf(call: { init: RequestInit }): string[] {
  return (JSON.parse(call.init.body as string) as { files: string[] }).files;
}

/** Two objects of a photo in the local media bucket, under a new key. */
async function storedPhoto(): Promise<string> {
  const key = newPhotoKey();
  for (const object of photoObjectKeys(key)) {
    await env.MEDIA.put(object, new Uint8Array([1, 2, 3]));
  }
  return key;
}

async function objectsOf(photoKey: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix: `photos/${photoKey}/` });
  return listed.objects.map(({ key }) => key);
}

/** The local media bucket with `cache`. */
function bucketWith(
  cache: PhotoCache,
  remove: R2Bucket["delete"] = (keys) => env.MEDIA.delete(keys),
) {
  return {
    photoFolder: "photos/" as const,
    put: env.MEDIA.put.bind(env.MEDIA) as R2Bucket["put"],
    delete: remove,
    cache,
  } satisfies MediaBucket;
}

/** A cache of BASE that records what it purges and keeps what failed in the table. */
function testCache(purge: (urls: readonly string[]) => Promise<PurgeResult>) {
  return photoCache({
    base: BASE,
    purge,
    defer: (urls) => db((tx) => deferCachePurge(tx, urls)),
  });
}

describe("The addresses of a photo", () => {
  it("dev addresses pass the CHECK, while folder/key mismatches do not", async () => {
    const key = newPhotoKey(DEV_PHOTOS_PREFIX);
    const urls = photoCacheUrls(BASE, key);
    await db((tx) => deferCachePurge(tx, urls));
    expect(await waiting()).toEqual(urls);
    for (const invalid of [
      urls[0]!.replace("dev/photos/", "photos/"),
      urls[0]!.replace("dev_", ""),
      urls[0]!.replace("dev/photos/", "stage/photos/"),
    ]) {
      expect(await pgErrorCode(() => db((tx) => deferCachePurge(tx, [invalid])))).toBe(PG.check);
    }
  });

  it("are both variants under the media hostname", () => {
    const key = newPhotoKey();
    expect(photoCacheUrls(BASE, key)).toEqual([
      `${BASE}/photos/${key}/card.webp`,
      `${BASE}/photos/${key}/full.webp`,
    ]);
  });
});

describe("A purge by URL asks Cloudflare for exactly those addresses", () => {
  it("posts the files to the zone's purge_cache with the token as a bearer, and succeeds", async () => {
    const api = fakeApi();
    const urls = photoCacheUrls(BASE, newPhotoKey());
    expect(await purgeCachedUrls(urls, { zoneId: ZONE, token: TOKEN, fetch: api.fetch })).toEqual({
      ok: true,
    });
    expect(api.calls).toHaveLength(1);
    const [call] = api.calls;
    expect(call?.url).toBe(`${CLOUDFLARE_API}/zones/${ZONE}/purge_cache`);
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(new Headers(call?.init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(call?.init.body as string)).toEqual({ files: urls });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a refusal is told by its status and Cloudflare's codes, never the token or an address", async () => {
    const urls = photoCacheUrls(BASE, newPhotoKey());
    for (const [answer, failure] of [
      [() => apiAnswer(429, false, [1134]), "HTTP 429, 1134"],
      [() => apiAnswer(403, false, [10000, 9109]), "HTTP 403, 10000 9109"],
      [() => new Response("<html>", { status: 502 }), "HTTP 502"],
      [() => apiAnswer(200, false), "HTTP 200"],
    ] as const) {
      const result = await purgeCachedUrls(urls, {
        zoneId: ZONE,
        token: TOKEN,
        fetch: fakeApi(answer).fetch,
      });
      expect(result).toEqual({ ok: false, failure });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain(BASE);
    }
  });

  it("a request that fails or times out is told by the error's name", async () => {
    const result = await purgeCachedUrls([`${BASE}/photos/${newPhotoKey()}/card.webp`], {
      zoneId: ZONE,
      token: TOKEN,
      fetch: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    });
    expect(result).toEqual({ ok: false, failure: "TimeoutError" });
  });

  it("without a zone id or a token nothing is asked, and it says it is not configured", async () => {
    const urls = photoCacheUrls(BASE, newPhotoKey());
    for (const [zoneId, token] of [
      ["", TOKEN],
      [ZONE, ""],
      ["not-a-zone-id", TOKEN],
    ] as const) {
      const api = fakeApi();
      expect(await purgeCachedUrls(urls, { zoneId, token, fetch: api.fetch })).toEqual({
        ok: false,
        failure: "not configured",
      });
      expect(api.calls).toEqual([]);
    }
  });

  it(`never more than ${MAX_PURGE_URLS} addresses in one request, and none is no request`, async () => {
    const api = fakeApi();
    const many = Array.from(
      { length: MAX_PURGE_URLS + 1 },
      () => `${BASE}/photos/${newPhotoKey()}/card.webp`,
    );
    expect(await purgeCachedUrls(many, { zoneId: ZONE, token: TOKEN, fetch: api.fetch })).toEqual({
      ok: false,
      failure: "too many addresses",
    });
    expect(await purgeCachedUrls([], { zoneId: ZONE, token: TOKEN, fetch: api.fetch })).toEqual({
      ok: true,
    });
    expect(api.calls).toEqual([]);
  });
});

describe("Deleting a photo purges both of its addresses", () => {
  it("both objects go first, then both addresses are purged", async () => {
    const order: string[] = [];
    const key = await storedPhoto();
    const purged: string[][] = [];
    const bucket = bucketWith(
      testCache(async (urls) => {
        order.push("purge");
        purged.push([...urls]);
        return { ok: true };
      }),
      async (keys) => {
        order.push("delete");
        await env.MEDIA.delete(keys);
      },
    );
    expect(await removePhoto(bucket, key)).toEqual({ kind: "removed", cache: "purged" });
    expect(order).toEqual(["delete", "purge"]);
    expect(purged).toEqual([photoCacheUrls(BASE, key)]);
    expect(await objectsOf(key)).toEqual([]);
    expect(await waiting()).toEqual([]);
  });

  it("an object already gone is no failure, and the purge still runs", async () => {
    const purge = vi.fn(async (): Promise<PurgeResult> => ({ ok: true }));
    const bucket = bucketWith(testCache(purge));
    expect(await deletePhoto(bucket, newPhotoKey())).toBe(true);
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("when the bucket cannot be reached, the photo is kept and nothing is purged", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const purge = vi.fn(async (): Promise<PurgeResult> => ({ ok: true }));
    const key = await storedPhoto();
    const bucket = bucketWith(testCache(purge), () => Promise.reject(new TypeError("R2 down")));
    expect(await removePhoto(bucket, key)).toEqual({ kind: "kept" });
    expect(await deletePhoto(bucket, key)).toBe(false);
    expect(purge).not.toHaveBeenCalled();
    await env.MEDIA.delete(photoObjectKeys(key));
  });

  it("a purge that fails keeps both addresses, and only them, for the hourly retry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const key = await storedPhoto();
    const bucket = bucketWith(testCache(async () => ({ ok: false, failure: "HTTP 503" })));
    expect(await removePhoto(bucket, key)).toEqual({ kind: "removed", cache: "deferred" });
    expect(await objectsOf(key)).toEqual([]);
    expect(await waiting()).toEqual(photoCacheUrls(BASE, key));
    const rows = await db((tx) => tx.select().from(photoCachePurges));
    for (const row of rows) expect(Object.keys(row).toSorted()).toEqual(["recordedAt", "url"]);
    expect(log.mock.calls).toEqual([
      ["photos: a deleted photo could not be purged from the cache (HTTP 503)"],
    ]);
    // Deleting it again keeps the same two addresses, once.
    expect(await deletePhoto(bucket, key)).toBe(true);
    expect(await waiting()).toEqual(photoCacheUrls(BASE, key));
  });

  it("when even keeping them fails, the caller is told, so it can keep what a retry needs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = photoCache({
      base: BASE,
      purge: async () => ({ ok: false, failure: "HTTP 500" }),
      defer: () => Promise.reject(new TypeError("database down")),
    });
    expect(await cache.purge(newPhotoKey())).toBe<CachePurge>("failed");
    expect(log.mock.calls.flat()).toEqual([
      "photos: a deleted photo could not be purged from the cache (HTTP 500)",
      "photos: a photo that could not be purged could not be kept for the retry (TypeError)",
    ]);
  });

  it("where there is no media hostname nothing is purged", async () => {
    const purge = vi.fn(async (): Promise<PurgeResult> => ({ ok: true }));
    const cache = photoCache({ base: null, purge, defer: async () => {} });
    expect(cache).toBe(NO_PHOTO_CACHE);
    expect(await cache.purge(newPhotoKey())).toBe("none");
    expect(purge).not.toHaveBeenCalled();
  });
});

describe("The media bucket of the Worker", () => {
  it("a failed purge of an owned dev photo keeps its dev addresses for retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const key = newPhotoKey(DEV_PHOTOS_PREFIX);
    for (const object of photoObjectKeys(key))
      await env.MEDIA.put(object, new Uint8Array([1, 2, 3]));
    const api = fakeApi(() => apiAnswer(503, false));
    const bucket = mediaBucket(
      {
        ...env,
        ENVIRONMENT: "dev",
        MEDIA_URL: BASE,
        MEDIA_ZONE_ID: ZONE,
        MEDIA_CACHE_PURGE_TOKEN: crypto.randomUUID(),
      },
      api.fetch,
    );
    expect(await removePhoto(bucket, key)).toEqual({ kind: "removed", cache: "deferred" });
    expect(await waiting()).toEqual(photoCacheUrls(BASE, key));
    expect(filesOf(api.calls[0]!)).toEqual(photoCacheUrls(BASE, key));
  });

  it("locally purges nothing and needs no secret", async () => {
    expect(env.ENVIRONMENT).toBe("local");
    expect(cachedMediaOrigin(env)).toBeNull();
    const api = fakeApi();
    const key = await storedPhoto();
    expect(await removePhoto(mediaBucket(env, api.fetch), key)).toEqual({
      kind: "removed",
      cache: "none",
    });
    expect(api.calls).toEqual([]);
    expect(await objectsOf(key)).toEqual([]);
  });

  it("a deployed environment purges on the zone of its media hostname with its token", async () => {
    const api = fakeApi();
    const deployed = {
      ...env,
      ENVIRONMENT: "prod",
      MEDIA_URL: BASE,
      MEDIA_ZONE_ID: ZONE,
      MEDIA_CACHE_PURGE_TOKEN: TOKEN,
    } as unknown as Env;
    const key = await storedPhoto();
    expect(await removePhoto(mediaBucket(deployed, api.fetch), key)).toEqual({
      kind: "removed",
      cache: "purged",
    });
    expect(api.calls.map(filesOf)).toEqual([photoCacheUrls(BASE, key)]);
    expect(api.calls[0]?.url).toBe(`${CLOUDFLARE_API}/zones/${ZONE}/purge_cache`);
  });

  it("without its secrets it says so once, and every photo it deletes waits for the retry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const api = fakeApi();
    const unconfigured = {
      ...env,
      ENVIRONMENT: "stage",
      MEDIA_URL: BASE,
      MEDIA_ZONE_ID: "",
      MEDIA_CACHE_PURGE_TOKEN: "",
    } as unknown as Env;
    const keys = [await storedPhoto(), await storedPhoto()];
    for (const key of keys) {
      expect(await removePhoto(mediaBucket(unconfigured, api.fetch), key)).toEqual({
        kind: "removed",
        cache: "deferred",
      });
    }
    expect(api.calls).toEqual([]);
    expect(await waiting()).toEqual(keys.flatMap((key) => photoCacheUrls(BASE, key)).toSorted());
    const configuration = log.mock.calls
      .flat()
      .filter((line) => String(line).includes("MEDIA_ZONE_ID or MEDIA_CACHE_PURGE_TOKEN"));
    expect(configuration).toEqual([
      'photos: MEDIA_ZONE_ID or MEDIA_CACHE_PURGE_TOKEN is not set in the "stage" environment, so deleted photos stay in the media hostname\'s cache until both are set.',
    ]);
  });
});

describe("The photo addresses waiting for their purge are the only thing kept of a deleted photo (v2)", () => {
  it("the table takes only the address of a variant of a photo", async () => {
    const key = newPhotoKey();
    await db((tx) => deferCachePurge(tx, photoCacheUrls(BASE, key)));
    for (const url of [
      "Tacos del Güero",
      "7719990101",
      `http://media-test.enmirumbo.test/photos/${key}/card.webp`,
      `${BASE}/photos/${key}/original.jpg`,
      `${BASE}/photos/not-a-photo-key/card.webp`,
      `${BASE}/other/${key}/card.webp`,
    ]) {
      expect(
        await pgErrorCode(() => db((tx) => tx.insert(photoCachePurges).values({ url }))),
        url,
      ).toBe(PG.check);
    }
    expect(await waiting()).toEqual(photoCacheUrls(BASE, key));
  });
});

describe("The hourly job retries the purges that failed", () => {
  it("a reset dev database purges only dev URLs, without foreign URLs consuming a batch", async () => {
    const stageUrls = photoCacheUrls(BASE, newPhotoKey());
    const devUrls = photoCacheUrls(BASE, newPhotoKey(DEV_PHOTOS_PREFIX));
    await db((tx) => deferCachePurge(tx, [...stageUrls, ...devUrls]));
    const purge = vi.fn(async (_urls: readonly string[]): Promise<PurgeResult> => ({ ok: true }));
    expect(
      await db((tx) =>
        retryCachePurges(tx, purge, {
          batch: 1,
          requests: 2,
          scope: { base: BASE, folder: DEV_PHOTOS_PREFIX },
        }),
      ),
    ).toEqual({ purged: 2, waiting: 0, failed: 0 });
    expect(purge.mock.calls.flat(2).toSorted()).toEqual(devUrls);
    expect(await waiting()).toEqual(stageUrls);

    await db((tx) => deferCachePurge(tx, devUrls));
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => apiAnswer(200, true));
    const deployed = {
      ...env,
      ENVIRONMENT: "dev",
      MEDIA_URL: BASE,
      MEDIA_ZONE_ID: ZONE,
      MEDIA_CACHE_PURGE_TOKEN: crypto.randomUUID(),
    };
    expect(await purgeWaitingPhotos(deployed, { waitUntil: () => {} })).toEqual({
      purged: 2,
      waiting: 0,
    });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ files: devUrls });
    expect(await waiting()).toEqual(stageUrls);

    await db((tx) => deferCachePurge(tx, devUrls));
    expect(
      await purgeWaitingPhotos(
        { ...deployed, ENVIRONMENT: "stage" },
        {
          waitUntil: () => {},
        },
      ),
    ).toEqual({ purged: 2, waiting: 0 });
    expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({ files: stageUrls });
    expect(await waiting()).toEqual(devUrls);
  });

  it("purges what waits, at most 100 addresses a request, and forgets what it purged", async () => {
    const urls = Array.from({ length: 150 }, () => photoCacheUrls(BASE, newPhotoKey())).flat();
    await db((tx) => deferCachePurge(tx, urls));
    const api = fakeApi();
    const purge = (batch: readonly string[]) =>
      purgeCachedUrls(batch, { zoneId: ZONE, token: TOKEN, fetch: api.fetch });
    expect(await db((tx) => retryCachePurges(tx, purge))).toEqual({
      purged: 300,
      waiting: 0,
      failed: 0,
    });
    expect(api.calls.map((call) => filesOf(call).length)).toEqual([100, 100, 100]);
    expect(api.calls.flatMap(filesOf).toSorted()).toEqual(urls.toSorted());
    expect(await waiting()).toEqual([]);
    // Idempotent: nothing waits, nothing is asked.
    expect(await db((tx) => retryCachePurges(tx, purge))).toEqual({
      purged: 0,
      waiting: 0,
      failed: 0,
    });
    expect(api.calls).toHaveLength(3);
  });

  it("a request that fails leaves its addresses waiting for the next run, the others are forgotten", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const older = photoCacheUrls(BASE, newPhotoKey());
    await db((tx) => deferCachePurge(tx, older));
    await db((tx) =>
      tx.execute(sql`update photo_cache_purges set recorded_at = now() - interval '1 hour'`),
    );
    const newer = photoCacheUrls(BASE, newPhotoKey());
    await db((tx) => deferCachePurge(tx, newer));
    let calls = 0;
    const purge = async (): Promise<PurgeResult> =>
      ++calls === 1 ? { ok: false, failure: "HTTP 429, 1134" } : { ok: true };
    expect(await db((tx) => retryCachePurges(tx, purge, { batch: 2 }))).toEqual({
      purged: 2,
      waiting: 2,
      failed: 1,
    });
    // The oldest went first, and failed.
    expect(await waiting()).toEqual(older.toSorted());
  });

  it("at most ten requests a run: what is left waits for the next one", async () => {
    const urls = Array.from({ length: 12 }, () => photoCacheUrls(BASE, newPhotoKey())).flat();
    await db((tx) => deferCachePurge(tx, urls));
    const purge = vi.fn(async (): Promise<PurgeResult> => ({ ok: true }));
    expect(await db((tx) => retryCachePurges(tx, purge, { batch: 2 }))).toEqual({
      purged: 20,
      waiting: 4,
      failed: 0,
    });
    expect(purge).toHaveBeenCalledTimes(10);
  });

  it("the task purges with the environment's secrets, and a run that cannot fails with counts only", async () => {
    const urls = photoCacheUrls(BASE, newPhotoKey());
    await db((tx) => deferCachePurge(tx, urls));
    const ctx = { waitUntil: () => {} };
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => apiAnswer(200, true));
    const deployed = {
      ...env,
      ENVIRONMENT: "prod",
      MEDIA_URL: BASE,
      MEDIA_ZONE_ID: ZONE,
      MEDIA_CACHE_PURGE_TOKEN: TOKEN,
    } as unknown as Env;
    expect(await purgeWaitingPhotos(deployed, ctx)).toEqual({ purged: 2, waiting: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await waiting()).toEqual([]);

    await db((tx) => deferCachePurge(tx, urls));
    fetch.mockImplementation(async () => apiAnswer(429, false, [1134]));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(purgeWaitingPhotos(deployed, ctx)).rejects.toThrow(IncompleteTask);
    const controller = { cron: "0 * * * *", scheduledTime: Date.now(), noRetry: () => {} };
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      runScheduledTasks(controller, deployed, ctx as unknown as ExecutionContext, [
        { name: "photo-cache-purge", run: (e, _now, c) => purgeWaitingPhotos(e, c) },
      ]),
    ).rejects.toThrow("1 task(s) failed: photo-cache-purge");
    expect(log.mock.calls.flat()).toContain(
      "scheduled: photo-cache-purge failed (0 purged, 2 waiting, 1 failed purge(s))",
    );
    for (const line of log.mock.calls.flat()) {
      expect(String(line)).not.toContain(TOKEN);
      expect(String(line)).not.toContain(BASE);
    }
    expect(await waiting()).toEqual(urls);
  });

  it("locally the task does nothing: the local Worker has no cache of Cloudflare's", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(await purgeWaitingPhotos(env, { waitUntil: () => {} })).toEqual({
      purged: 0,
      waiting: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
