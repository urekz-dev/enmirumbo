// The cached copies of a deleted photo (ADR 0011; docs/specs/deployment.md,
// "A deleted photo is purged from the cache of the media hostname, and a purge
// that fails is retried every hour (v2)"; docs/specs/data-model.md, "The
// photo addresses waiting for their purge are the only thing kept of a
// deleted photo (v2)"). Every object of a photo carries a year of caching
// (PHOTO_CACHE_CONTROL), so Cloudflare's cache of the media hostname keeps
// serving a photo after its objects are gone from R2. The privacy notice
// promises a real deletion, so whatever deletes a photo's objects also purges
// both of its addresses from that cache (deletePhoto, ./upload.ts):
//
// - photoCache gives the purge of one environment: nothing to purge where
//   there is no media hostname (locally, where the Worker serves the bucket
//   with no cache of Cloudflare's in front); otherwise both addresses, in one
//   request to Cloudflare's purge by URL (purgeCachedUrls). A purge that fails
//   is told by its kind only, and its addresses are kept for the hourly retry
//   (deferCachePurge): the addresses alone, nothing about the card, which may
//   no longer exist. When even that fails, the caller is told, so a permanent
//   deletion keeps the card, whose stored key is what a new attempt needs.
// - retryCachePurges is that retry, a task of the hourly job
//   (src/scheduled.ts): it purges what waits, at most MAX_PURGE_URLS
//   addresses a request, and forgets each address Cloudflare purged. It is
//   idempotent: purging an address twice, or one no longer cached, is no
//   failure.
//
// The token of the purge never reaches the log, an error or a page: the log
// says only an HTTP status, the error codes Cloudflare answers or a fixed
// reason. No address is logged either.
import { asc, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { photoCachePurges } from "../db/schema/index.ts";
import { PHOTO_VARIANT_NAMES, photoUrl, type PhotoFolder } from "./photo.ts";

/** Where Cloudflare's API answers. */
export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/**
 * The most addresses one purge request may name: Cloudflare's limit of
 * operations per request on every plan but Enterprise ("Purge cache",
 * availability and limits; read on 2026-10-18).
 */
export const MAX_PURGE_URLS = 100;

/** How long a purge request may take before it counts as failed. */
export const PURGE_TIMEOUT_MS = 5000;

/** What became of the cached copies of a photo whose objects were just deleted. */
export type CachePurge =
  /** Cloudflare's cache dropped both addresses. */
  | "purged"
  /** There was nothing to purge: no media hostname, as locally. */
  | "none"
  /** The purge failed, and both addresses wait for the hourly retry. */
  | "deferred"
  /** The purge failed, and its addresses could not be kept for the retry. */
  | "failed";

/** The cache of the media hostname, as whatever deletes a photo sees it. */
export interface PhotoCache {
  /** Purges both addresses of the photo `photoKey`, whose objects were just deleted. Never throws. */
  purge(photoKey: string): Promise<CachePurge>;
}

/** The cache where there is no media hostname: nothing is ever cached, so nothing is purged. */
export const NO_PHOTO_CACHE: PhotoCache = { purge: () => Promise.resolve("none") };

/** What one purge request did: Cloudflare purged every address, or why not, by its kind only. */
export type PurgeResult = { ok: true } | { ok: false; failure: string };

/** Asks Cloudflare to purge some addresses, at most MAX_PURGE_URLS. */
export type PurgeUrls = (urls: readonly string[]) => Promise<PurgeResult>;

/** The addresses of both variants of the photo `photoKey` on the media hostname `base`. */
export function photoCacheUrls(base: string, photoKey: string): string[] {
  return PHOTO_VARIANT_NAMES.flatMap((variant) => {
    const photo = photoUrl(base, photoKey, variant);
    return photo === null ? [] : [photo.src];
  });
}

/** What a purge request needs: the zone of the media hostname, a token that may purge it, and fetch. */
export interface PurgeRequestOptions {
  /** The id of the zone of the media hostname; empty when it is not configured. */
  zoneId: string;
  /** An API token with Zone, Cache Purge on that zone; empty when it is not configured. */
  token: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

const ZONE_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Purges `urls` from the cache of the zone, with Cloudflare's purge by URL
 * (`POST /zones/<zone id>/purge_cache` with `files`). Never throws: a failure
 * is told by its kind, which names no address and never the token.
 */
export async function purgeCachedUrls(
  urls: readonly string[],
  { zoneId, token, fetch, timeoutMs = PURGE_TIMEOUT_MS }: PurgeRequestOptions,
): Promise<PurgeResult> {
  if (urls.length === 0) return { ok: true };
  if (urls.length > MAX_PURGE_URLS) return { ok: false, failure: "too many addresses" };
  if (!ZONE_ID_PATTERN.test(zoneId) || token === "")
    return { ok: false, failure: "not configured" };
  let response: Response;
  try {
    response = await fetch(`${CLOUDFLARE_API}/zones/${zoneId}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: urls }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, failure: error instanceof Error ? error.name : "unknown" };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An answer that is not JSON is told by its status alone.
  }
  const answer = body as { success?: unknown; errors?: unknown } | null;
  if (response.ok && answer?.success === true) return { ok: true };
  const codes = Array.isArray(answer?.errors)
    ? answer.errors
        .map((error) => (error as { code?: unknown } | null)?.code)
        .filter((code): code is number => typeof code === "number")
    : [];
  return {
    ok: false,
    failure:
      codes.length > 0 ? `HTTP ${response.status}, ${codes.join(" ")}` : `HTTP ${response.status}`,
  };
}

/** What photoCache needs from its environment. */
export interface PhotoCacheOptions {
  /** The origin of the media hostname; null where there is none, and so nothing cached. */
  base: string | null;
  purge: PurgeUrls;
  /** Keeps addresses whose purge failed for the hourly retry (deferCachePurge). */
  defer: (urls: readonly string[]) => Promise<void>;
}

/** The cache of the media hostname of an environment. */
export function photoCache({ base, purge, defer }: PhotoCacheOptions): PhotoCache {
  if (base === null) return NO_PHOTO_CACHE;
  return {
    async purge(photoKey) {
      const urls = photoCacheUrls(base, photoKey);
      if (urls.length === 0) return "none";
      const result = await purge(urls);
      if (result.ok) return "purged";
      console.error(
        `photos: a deleted photo could not be purged from the cache (${result.failure})`,
      );
      try {
        await defer(urls);
        return "deferred";
      } catch (error) {
        console.error(
          `photos: a photo that could not be purged could not be kept for the retry (${error instanceof Error ? error.name : "unknown"})`,
        );
        return "failed";
      }
    },
  };
}

/** Keeps `urls` for the hourly retry; an address already waiting stays as it was. */
export async function deferCachePurge(db: Db, urls: readonly string[]): Promise<void> {
  if (urls.length === 0) return;
  await db
    .insert(photoCachePurges)
    .values(urls.map((url) => ({ url })))
    .onConflictDoNothing();
}

/** What a retry did, as counts. */
export interface CachePurgeRetry {
  /** Addresses Cloudflare purged, and the retry forgot. */
  purged: number;
  /** Addresses still waiting after this run: those whose purge failed, and those it did not reach. */
  waiting: number;
  /** Purge requests that failed. */
  failed: number;
}

/** How much one run of the retry does at most. */
export const MAX_PURGE_REQUESTS_PER_RUN = 10;

/**
 * Purges the addresses that wait, oldest first, MAX_PURGE_URLS a request and
 * at most MAX_PURGE_REQUESTS_PER_RUN requests, and forgets those purged. A
 * failed request leaves its addresses waiting for the next run.
 */
export async function retryCachePurges(
  db: Db,
  purge: PurgeUrls,
  {
    batch = MAX_PURGE_URLS,
    requests = MAX_PURGE_REQUESTS_PER_RUN,
    scope,
  }: {
    batch?: number;
    requests?: number;
    scope?: { base: string; folder: PhotoFolder };
  } = {},
): Promise<CachePurgeRetry> {
  const counts: CachePurgeRetry = { purged: 0, waiting: 0, failed: 0 };
  // A dev database reset copies stage's queue too. Foreign addresses neither
  // get purged nor consume a batch, and stay for their owning environment.
  const owned =
    scope === undefined
      ? undefined
      : sql`starts_with(${photoCachePurges.url}, ${`${scope.base}/${scope.folder}`})`;
  const waiting = await db
    .select({ url: photoCachePurges.url })
    .from(photoCachePurges)
    .where(owned)
    .orderBy(asc(photoCachePurges.recordedAt), asc(photoCachePurges.url))
    .limit(batch * requests);
  for (let start = 0; start < waiting.length; start += batch) {
    const urls = waiting.slice(start, start + batch).map(({ url }) => url);
    const result = await purge(urls);
    if (!result.ok) {
      counts.failed += 1;
      console.error(
        `photos: waiting photos could not be purged from the cache (${result.failure})`,
      );
      continue;
    }
    await db.delete(photoCachePurges).where(inArray(photoCachePurges.url, urls));
    counts.purged += urls.length;
  }
  const [left] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(photoCachePurges)
    .where(owned);
  counts.waiting = left?.count ?? 0;
  return counts;
}
