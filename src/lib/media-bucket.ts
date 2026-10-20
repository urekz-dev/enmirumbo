// The public media bucket as the Worker stores and deletes photos in it
// (ADR 0011; docs/specs/deployment.md, "A deleted photo is purged from the
// cache of the media hostname, and a purge that fails is retried every hour
// (v2)"). Every action that stores or deletes a photo gets its bucket from
// mediaBucket, never env.MEDIA alone: the bucket it gives carries the cache
// of the media hostname, so deletePhoto and removePhoto
// (src/core/photos/upload.ts) purge both addresses of every photo they
// delete.
// Its photoFolder also limits writes, deletions, sweep listings and cache
// retries to this environment's photos (EMR-75). Dev still renders copied
// stage keys, but removing their rows leaves stage's objects and cache alone.
//
// - Locally (ENVIRONMENT `local`) the local Worker serves the bucket itself,
//   under /_media/, with no cache of Cloudflare's in front: nothing is
//   purged and no secret is needed.
// - A deployed environment purges on the zone of its media hostname, the
//   Worker secrets MEDIA_ZONE_ID and MEDIA_CACHE_PURGE_TOKEN (a token with
//   Zone, Cache Purge on that zone). Without them every purge fails, which is
//   logged once per isolate, and its addresses wait for the hourly retry
//   (src/scheduled.ts) until they are set.
// - A purge that fails keeps its addresses in `photo_cache_purges` through a
//   fresh connection of its own (HYPERDRIVE_FRESH), so a deletion whose rows
//   then fail to delete still leaves them for the retry.
//
// The token never reaches the log, an error or a page.
import { waitUntil } from "cloudflare:workers";
import { withDb } from "../core/db/client.ts";
import {
  deferCachePurge,
  type PurgeRequestOptions,
  type PurgeUrls,
  photoCache,
  purgeCachedUrls,
} from "../core/photos/cache.ts";
import type { MediaBucket } from "../core/photos/upload.ts";
import { photoFolder, photoKeyOfObject } from "../core/photos/photo.ts";
import { mediaPhotoFolder } from "./media-folder.ts";
import type { MediaVars } from "./media.ts";
import { parseOrigin } from "./site-url.ts";

/** The vars and the secrets of the cache of the media hostname. */
export interface MediaCacheVars extends MediaVars {
  /** The id of the zone of the media hostname (a Worker secret: the repository holds no zone ids). */
  MEDIA_ZONE_ID?: string | undefined;
  /** A Cloudflare API token with Zone, Cache Purge on that zone (a Worker secret). */
  MEDIA_CACHE_PURGE_TOKEN?: string | undefined;
}

const reported = new Set<string>();

function reportOnce(message: string): void {
  if (reported.has(message)) return;
  reported.add(message);
  console.error(message);
}

/**
 * The origin of the media hostname whose cache serves the photos, or null
 * where Cloudflare caches none: locally, and in a deployed environment
 * without an https MEDIA_URL, which shows no photo (src/lib/media.ts).
 */
export function cachedMediaOrigin(vars: MediaCacheVars): string | null {
  if (vars.ENVIRONMENT === "local") return null;
  return parseOrigin(vars.MEDIA_URL, ["https:"]);
}

/** How the environment asks Cloudflare to purge addresses of its media hostname. */
export function cachePurger(
  vars: MediaCacheVars,
  fetcher: PurgeRequestOptions["fetch"] = (url, init) => fetch(url, init),
): PurgeUrls {
  return (urls) => {
    const base = cachedMediaOrigin(vars);
    const folder = mediaPhotoFolder(vars);
    const owned = urls.filter((url) => {
      if (base === null || !url.startsWith(`${base}/`)) return false;
      const key = photoKeyOfObject(url.slice(base.length + 1));
      return key !== null && photoFolder(key) === folder;
    });
    if (owned.length === 0) return Promise.resolve({ ok: true });
    const zoneId = vars.MEDIA_ZONE_ID?.trim() ?? "";
    const token = vars.MEDIA_CACHE_PURGE_TOKEN?.trim() ?? "";
    if (zoneId === "" || token === "") {
      reportOnce(
        `photos: MEDIA_ZONE_ID or MEDIA_CACHE_PURGE_TOKEN is not set in the "${vars.ENVIRONMENT ?? "(none)"}" environment, so deleted photos stay in the media hostname's cache until both are set.`,
      );
    }
    return purgeCachedUrls(owned, { zoneId, token, fetch: fetcher });
  };
}

/** What mediaBucket needs of the environment. */
export type MediaBucketEnv = Pick<Env, "MEDIA" | "HYPERDRIVE" | "HYPERDRIVE_FRESH"> &
  MediaCacheVars;

/** The public media bucket with the cache of its media hostname, for storing and deleting photos. */
export function mediaBucket(
  env: MediaBucketEnv,
  fetcher?: PurgeRequestOptions["fetch"],
): MediaBucket {
  const bucket = env.MEDIA;
  return {
    photoFolder: mediaPhotoFolder(env),
    put: bucket.put.bind(bucket) as R2Bucket["put"],
    delete: (keys) => bucket.delete(keys),
    cache: photoCache({
      base: cachedMediaOrigin(env),
      purge: cachePurger(env, fetcher),
      defer: (urls) =>
        withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (db) => deferCachePurge(db, urls)),
    }),
  };
}
