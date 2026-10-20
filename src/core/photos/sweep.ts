// The orphan-photo sweep (ADR 0011; docs/specs/deployment.md, "The orphan-
// photo sweep is a task of the hourly job and a sweep that cannot finish is an
// error (v2)"). R2 is authoritative for stored objects; fresh database reads
// protect the card's photo and every pending edit's new photo, in every edit
// status. A private R2 cursor lets the bounded daily scan resume next hour.
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { businesses, orphanPhotoSweepState, pendingEdits } from "../db/schema/index.ts";
import { removePhoto, type MediaBucket } from "./upload.ts";
import {
  isPhotoKey,
  photoKeyOfObject,
  photoFolder,
  photoObjectKeys,
  PHOTOS_PREFIX,
} from "./photo.ts";

/** One R2 page, and the maximum total objects this task lists in one run. */
export const ORPHAN_SWEEP_PAGE_SIZE = 100;
export const MAX_ORPHAN_SWEEP_OBJECTS_PER_RUN = 500;

/** The maximum number of photos this task attempts to delete in one run. */
export const MAX_ORPHAN_SWEEP_PHOTOS_PER_RUN = 15;

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_PERIOD_MS = 7 * DAY_MS;

/** Counts suitable for the Worker log and the future daily email. */
export interface OrphanPhotoSweepCounts extends Record<string, number> {
  listedObjects: number;
  deletedPhotos: number;
  deletedObjects: number;
  referencedPhotos: number;
  youngPhotos: number;
  purgeDeferredPhotos: number;
  failed: number;
  invalidObjects: number;
  /** 1 when a failure kept this run from finishing its page; the next run retries it. */
  incomplete: number;
  /** 1 when the run stopped at a bound with more of the pass to do next hour. */
  continued: number;
  skipped: number;
}

/** Testable caps; production uses the named constants above. */
export interface OrphanPhotoSweepLimits {
  pageSize?: number;
  objectsPerRun?: number;
  photosPerRun?: number;
}

const emptyCounts = (): OrphanPhotoSweepCounts => ({
  listedObjects: 0,
  deletedPhotos: 0,
  deletedObjects: 0,
  referencedPhotos: 0,
  youngPhotos: 0,
  purgeDeferredPhotos: 0,
  failed: 0,
  invalidObjects: 0,
  incomplete: 0,
  continued: 0,
  skipped: 0,
});

/** Photo keys named by a card or any pending edit, regardless of its status. */
async function referencedPhotoKeys(
  db: Pick<Db, "select">,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const cards = await db
    .select({ key: businesses.photoKey })
    .from(businesses)
    .where(inArray(businesses.photoKey, [...keys]));
  const edits = await db
    .select({ key: pendingEdits.newPhotoKey })
    .from(pendingEdits)
    .where(inArray(pendingEdits.newPhotoKey, [...keys]));
  return new Set([...cards, ...edits].flatMap(({ key }) => (isPhotoKey(key) ? [key] : [])));
}

/**
 * Sweeps at most the configured number of R2 objects and photo deletions.
 * A pass starts once per UTC day and continues each following hour until it
 * reaches the end of the listing; stopping at a bound is `continued`, not a
 * failure. A failed page keeps its cursor so the next run retries it
 * (`incomplete`). An object under the owned folder that is not a photo's variant is
 * counted and never touched, and does not hold the cursor back. A completed
 * pass is idempotently skipped for the rest of that UTC day.
 */
export async function sweepOrphanPhotos(
  db: Db,
  media: Pick<R2Bucket, "list" | "head">,
  deletionBucket: MediaBucket,
  now: Date,
  limits: OrphanPhotoSweepLimits = {},
): Promise<OrphanPhotoSweepCounts> {
  const pageSize = limits.pageSize ?? ORPHAN_SWEEP_PAGE_SIZE;
  const objectsPerRun = limits.objectsPerRun ?? MAX_ORPHAN_SWEEP_OBJECTS_PER_RUN;
  const photosPerRun = limits.photosPerRun ?? MAX_ORPHAN_SWEEP_PHOTOS_PER_RUN;
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    !Number.isInteger(objectsPerRun) ||
    objectsPerRun < 1 ||
    !Number.isInteger(photosPerRun) ||
    photosPerRun < 1
  ) {
    throw new Error("orphan sweep: invalid limits");
  }

  const counts = emptyCounts();
  const utcDay = now.toISOString().slice(0, 10);
  const cutoff = now.getTime() - GRACE_PERIOD_MS;
  let finished = false;

  await db.transaction(async (tx) => {
    const [state] = await tx
      .select()
      .from(orphanPhotoSweepState)
      .where(eq(orphanPhotoSweepState.singleton, true))
      .for("update");
    if (state === undefined) throw new Error("orphan sweep: state row missing");
    const folder = deletionBucket.photoFolder;
    const sameFolder = (state.photoFolder ?? PHOTOS_PREFIX) === folder;
    const completedOn = sameFolder ? state.completedOn : null;
    let cursor = sameFolder ? (state.cursor ?? undefined) : undefined;
    if (!sameFolder) {
      // A reset copies stage's cursor and day into dev. Neither belongs to
      // this listing; persist the new ownership even if its first page fails.
      await tx
        .update(orphanPhotoSweepState)
        .set({ photoFolder: folder, cursor: null, completedOn: null });
    }
    if (cursor === undefined && completedOn === utcDay) {
      counts.skipped = 1;
      return;
    }

    const seenKeys = new Set<string>();
    while (counts.listedObjects < objectsPerRun && counts.deletedPhotos < photosPerRun) {
      const limit = Math.min(pageSize, objectsPerRun - counts.listedObjects);
      let page: R2Objects;
      try {
        page = await media.list({
          prefix: deletionBucket.photoFolder,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
        });
      } catch {
        counts.failed += 1;
        counts.incomplete = 1;
        break;
      }
      counts.listedObjects += page.objects.length;
      if (page.objects.length === 0 && page.truncated) {
        counts.failed += 1;
        counts.incomplete = 1;
        break;
      }

      const pageKeys: string[] = [];
      const pageObjects = new Map<string, R2Object[]>();
      for (const object of page.objects) {
        const key = photoKeyOfObject(object.key);
        if (key === null || photoFolder(key) !== deletionBucket.photoFolder) {
          counts.invalidObjects += 1;
          continue;
        }
        const objects = pageObjects.get(key) ?? [];
        objects.push(object);
        pageObjects.set(key, objects);
        if (!seenKeys.has(key) && objects.length === 1) pageKeys.push(key);
      }

      const referenced = await referencedPhotoKeys(tx, pageKeys);

      let pageIncomplete = false;
      let pageBounded = false;
      for (const key of pageKeys) {
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        if (referenced.has(key)) {
          counts.referencedPhotos += 1;
          continue;
        }
        if (pageObjects.get(key)?.some(({ uploaded }) => uploaded.getTime() >= cutoff)) {
          counts.youngPhotos += 1;
          continue;
        }

        let variants: (R2Object | null)[];
        try {
          variants = await Promise.all(
            photoObjectKeys(key).map((objectKey) => media.head(objectKey)),
          );
        } catch {
          counts.failed += 1;
          pageIncomplete = true;
          continue;
        }
        if (variants.some((object) => object !== null && object.uploaded.getTime() >= cutoff)) {
          counts.youngPhotos += 1;
          continue;
        }
        const existingObjects = variants.filter((object): object is R2Object => object !== null);
        if (existingObjects.length === 0) continue;
        if (counts.deletedPhotos >= photosPerRun) {
          pageBounded = true;
          break;
        }

        const removal = await removePhoto(deletionBucket, key);
        if (removal.kind === "foreign") continue;
        if (removal.kind === "kept") {
          counts.failed += 1;
          pageIncomplete = true;
          continue;
        }
        counts.deletedPhotos += 1;
        counts.deletedObjects += existingObjects.length;
        if (removal.cache === "deferred") counts.purgeDeferredPhotos += 1;
        if (removal.cache === "failed") {
          counts.failed += 1;
          pageIncomplete = true;
        }
      }

      if (pageIncomplete) {
        counts.incomplete = 1;
        break;
      }
      if (pageBounded) {
        // The page stays the next one to list: what was deleted is gone from it.
        counts.continued = 1;
        break;
      }

      if (page.truncated && (page.cursor === undefined || page.cursor === "")) {
        counts.failed += 1;
        counts.incomplete = 1;
        break;
      }
      cursor = page.truncated ? page.cursor : undefined;
      await tx.update(orphanPhotoSweepState).set({
        photoFolder: folder,
        cursor: cursor ?? null,
        completedOn: cursor === undefined ? utcDay : completedOn,
      });

      if (cursor === undefined) {
        finished = true;
        break;
      }
    }

    if (!finished && counts.incomplete === 0) counts.continued = 1;
  });

  return counts;
}
