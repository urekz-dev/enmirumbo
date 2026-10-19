// An uploaded photo, from the file that arrived to the two objects of a
// business photo (ADR 0011; docs/specs/business-registration.md, "The server
// only accepts the photo if it is a real image of at most 5 MB", "Image work
// has a ceiling, and what does not fit is turned away with a message, not
// queued", "The photo is stored compressed, without metadata and with a
// server-generated reference", "Photos are stored as two WebP sizes in R2
// under opaque keys (v2)" and "Photos are uploaded through the Images
// binding, within a ceiling of work (v2)"; docs/specs/public-directory.md,
// "Photo weight does not break the 4G budget"). In this order, each step only
// when the one before let it through:
//
// 1. Its weight, at most 5 MB (the form's validation has already said so;
//    this checks again).
// 2. Its first bytes: a JPEG, PNG or WebP by its content, whatever its name
//    or the type the browser declared. An SVG, an HTML page, a PDF or an
//    executable named foto.jpg stop here, without reaching Images.
// 3. Its header, read by the Images binding for free (`info`): the same
//    format, and at most 40 megapixels.
// 4. The only step that opens the original: Images scales it, whole, into a
//    working copy of at most 2400×2400 pixels. At most
//    MAX_PHOTOS_OPENED_AT_ONCE of these run at once in a Worker instance; one
//    more is turned away at once ("busy"), never queued.
// 5. From that working copy, never from the original again, each variant:
//    cropped to its exact size from the centre (`cover`), as WebP, at the
//    first quality of PHOTO_QUALITIES that fits its weight. WebP keeps no
//    metadata (no EXIF, no GPS, no camera); Images applies the EXIF rotation
//    first. Each variant's size is checked with a free `info`.
// 6. Both objects under a new photo key, full first, then card, with their
//    media type and PHOTO_CACHE_CONTROL; if either write fails, both keys are
//    deleted. The original is never stored.
//
// When Images throws (the free monthly allowance is spent, error 9422; an
// outage; a file it cannot read) the photo is "failed". The log says only the
// kind of the failure (an Images error code, an error's name or a fixed
// reason), never anything about the file or who sent it.
//
// Deleting a photo goes through deletePhoto or removePhoto alone, whoever
// deletes it: both objects, and then both of its addresses from the cache of
// the media hostname (./cache.ts), since a deleted photo must stop being
// served. The bucket they take carries that cache (MediaBucket), so no
// deletion can leave it out; the Worker builds it with mediaBucket
// (src/lib/media-bucket.ts).
import type { CachePurge, PhotoCache } from "./cache.ts";
import { MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS, type PhotoFormat } from "./limits.ts";
import {
  newPhotoKey,
  PHOTO_CACHE_CONTROL,
  PHOTO_CONTENT_TYPE,
  PHOTO_VARIANTS,
  photoObjectKey,
  photoObjectKeys,
  type PhotoVariant,
} from "./photo.ts";

/** How many first bytes sniffPhotoFormat reads. */
export const SNIFF_BYTES = 12;

/**
 * The format the first bytes of a file say it is, or null when they are none
 * of a JPEG, a PNG or a WebP.
 */
export function sniffPhotoFormat(head: Uint8Array): PhotoFormat | null {
  const starts = (offset: number, bytes: readonly number[]) =>
    bytes.every((byte, index) => head[offset + index] === byte);
  if (starts(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // "RIFF", four bytes of length, "WEBP".
  if (starts(0, [0x52, 0x49, 0x46, 0x46]) && starts(8, [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  return null;
}

/**
 * Whether the header Images read is a photo the site takes: the format the
 * first bytes said, with a width and a height, and at most MAX_PHOTO_PIXELS.
 */
export function isAcceptedPhotoInfo(format: PhotoFormat, info: ImageInfoResponse): boolean {
  if (info.format !== format || !("width" in info)) return false;
  const { width, height } = info;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return false;
  }
  return width * height <= MAX_PHOTO_PIXELS;
}

/**
 * The working copy: the photo whole, scaled down (never up) into a
 * 2400×2400 box, so both centre crops come out of it at their size without
 * enlarging, for any photo between 1:2 and 2:1, whatever its orientation.
 * Every later step works on at most 5.76 megapixels.
 */
export const WORKING_TRANSFORM: ImageTransform = { width: 2400, height: 2400, fit: "scale-down" };

/** The working copy is only read by the next step, so it loses as little as it can. */
export const WORKING_OUTPUT: ImageOutputOptions = {
  format: "image/webp",
  quality: 90,
  anim: false,
};

/**
 * A variant, cut from the working copy: scaled to fill exactly its width and
 * height and cropped from the centre, so the page always reserves the same
 * box (400×400 and 1200×900) and nothing moves while it loads.
 */
export function variantTransform(variant: PhotoVariant): ImageTransform {
  const { width, height } = PHOTO_VARIANTS[variant];
  return { width, height, fit: "cover", gravity: "center" };
}

/**
 * The qualities a variant is tried at, in order, until it fits its weight
 * (60 KB and 250 KB): most photos fit at the first. Each try is one more
 * transformation of the working copy.
 */
export const PHOTO_QUALITIES = [75, 60, 45, 30] as const;

/** A variant as stored: WebP, a still image, which keeps no metadata. */
export function variantOutput(quality: number): ImageOutputOptions {
  return { format: PHOTO_CONTENT_TYPE, quality, anim: false };
}

/** How many originals a Worker instance opens at once (step 4); the rest are "busy". */
export const MAX_PHOTOS_OPENED_AT_ONCE = 4;

/**
 * How long a slot counts as taken at most. A request the client abandons may
 * never reach the code that gives its slot back, so a slot expires on its own
 * and can never stay taken for good.
 */
export const OPENING_LEASE_MS = 30_000;

/**
 * The slots of step 4 of one Worker instance, whose memory they protect. A
 * slot is taken without waiting, or not at all.
 */
export class PhotoSlots {
  private readonly taken = new Set<{ since: number }>();

  constructor(
    private readonly size: number = MAX_PHOTOS_OPENED_AT_ONCE,
    private readonly leaseMs: number = OPENING_LEASE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Takes a slot and gives the function that frees it, or null when none is free. */
  take(): (() => void) | null {
    const now = this.now();
    for (const slot of this.taken) {
      if (now - slot.since >= this.leaseMs) this.taken.delete(slot);
    }
    if (this.taken.size >= this.size) return null;
    const slot = { since: now };
    this.taken.add(slot);
    return () => {
      this.taken.delete(slot);
    };
  }
}

/** The slots of this Worker instance. */
const OPENING_SLOTS = new PhotoSlots();

/**
 * The public media bucket (env.MEDIA) with the cache of the media hostname
 * that serves it: what storing and deleting a photo need of it.
 */
export interface MediaBucket extends Pick<R2Bucket, "put" | "delete"> {
  /** Purges the cached copies of a photo once its objects are deleted. */
  readonly cache: PhotoCache;
}

/** What the photo needs: the Images binding and the public media bucket (env.IMAGES, mediaBucket). */
export interface PhotoServices {
  images: Pick<ImagesBinding, "info" | "input">;
  bucket: MediaBucket;
  /** The slots of step 4: this Worker instance's, unless a test gives its own. */
  slots?: PhotoSlots;
}

/** Why a photo is turned away, each with its message next to the photo field. */
export type PhotoError = "too-large" | "unreadable" | "busy" | "failed";

export type StorePhotoOutcome =
  | { kind: "stored"; key: string }
  | { kind: "rejected"; error: PhotoError };

export interface StorePhotoOptions {
  /** Where photo keys come from (newPhotoKey); tests pass their own. */
  newKey?: () => string;
}

/** A failure of the photo's work, by a fixed reason the log may say. */
class PhotoWorkError extends Error {
  override readonly name = "PhotoWorkError";
}

/** The kind of a failure, for the log: an Images error code, a fixed reason or the error's name. */
function photoFailure(error: unknown): string {
  if (error instanceof PhotoWorkError) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "number") return `Images ${code}`;
  return error instanceof Error ? error.name : "unknown";
}

function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
  return new Blob([bytes]).stream();
}

/** The bytes of one transformation. */
async function transform(
  images: PhotoServices["images"],
  source: ReadableStream<Uint8Array>,
  options: ImageTransform,
  output: ImageOutputOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const result = await images.input(source).transform(options).output(output);
  return new Uint8Array(await result.response().arrayBuffer());
}

/** One variant of the working copy, at the first quality that fits its weight, with its size checked. */
async function compressVariant(
  images: PhotoServices["images"],
  working: Uint8Array<ArrayBuffer>,
  variant: PhotoVariant,
): Promise<Uint8Array<ArrayBuffer>> {
  const { width, height, maxBytes } = PHOTO_VARIANTS[variant];
  for (const quality of PHOTO_QUALITIES) {
    const bytes = await transform(
      images,
      streamOf(working),
      variantTransform(variant),
      variantOutput(quality),
    );
    if (bytes.byteLength > maxBytes) continue;
    const info = await images.info(streamOf(bytes));
    if (info.format !== PHOTO_CONTENT_TYPE || !("width" in info)) {
      throw new PhotoWorkError(`the ${variant} variant is not WebP`);
    }
    if (info.width !== width || info.height !== height) {
      throw new PhotoWorkError(`the ${variant} variant is not ${width}x${height}`);
    }
    return bytes;
  }
  throw new PhotoWorkError(`the ${variant} variant does not fit its weight`);
}

/**
 * Checks, transforms and stores an uploaded photo, and gives its new key; or
 * why it was turned away, having stored nothing.
 */
export async function storePhoto(
  file: Blob,
  services: PhotoServices,
  { newKey = newPhotoKey }: StorePhotoOptions = {},
): Promise<StorePhotoOutcome> {
  const { slots = OPENING_SLOTS } = services;
  if (file.size > MAX_PHOTO_BYTES) return { kind: "rejected", error: "too-large" };
  const format = sniffPhotoFormat(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  if (format === null) return { kind: "rejected", error: "unreadable" };

  let variants: Record<PhotoVariant, Uint8Array<ArrayBuffer>>;
  try {
    const info = await services.images.info(file.stream());
    if (!isAcceptedPhotoInfo(format, info)) return { kind: "rejected", error: "unreadable" };
    const release = slots.take();
    if (release === null) return { kind: "rejected", error: "busy" };
    let working: Uint8Array<ArrayBuffer>;
    try {
      working = await transform(services.images, file.stream(), WORKING_TRANSFORM, WORKING_OUTPUT);
    } finally {
      release();
    }
    const [card, full] = await Promise.all([
      compressVariant(services.images, working, "card"),
      compressVariant(services.images, working, "full"),
    ]);
    variants = { card, full };
  } catch (error) {
    console.error(`photos: a photo could not be prepared (${photoFailure(error)})`);
    return { kind: "rejected", error: "failed" };
  }

  const key = newKey();
  try {
    for (const variant of ["full", "card"] as const satisfies readonly PhotoVariant[]) {
      await services.bucket.put(photoObjectKey(key, variant), variants[variant], {
        httpMetadata: { contentType: PHOTO_CONTENT_TYPE, cacheControl: PHOTO_CACHE_CONTROL },
      });
    }
  } catch (error) {
    console.error(`photos: a photo could not be stored (${photoFailure(error)})`);
    // A photo that was never stored whole was never served, so no cache holds it.
    await deleteObjects(services.bucket, key);
    return { kind: "rejected", error: "failed" };
  }
  return { kind: "stored", key };
}

/** Deletes both objects of a photo; an object that is not there is no failure. Whether it could. */
async function deleteObjects(bucket: Pick<R2Bucket, "delete">, photoKey: string): Promise<boolean> {
  try {
    await bucket.delete(photoObjectKeys(photoKey));
    return true;
  } catch (error) {
    console.error(`photos: a photo could not be deleted (${photoFailure(error)})`);
    return false;
  }
}

/** What deleting a photo did. */
export type PhotoRemoval =
  /** The bucket could not be reached: both objects may still be there, and nothing was purged. */
  | { kind: "kept" }
  /** Both objects are gone, and `cache` says what became of their cached copies. */
  | { kind: "removed"; cache: CachePurge };

/**
 * Deletes both objects of a photo, then purges both of its addresses from the
 * cache of the media hostname (./cache.ts). An object that is not there is no
 * failure. A failure is logged by its kind: objects the bucket kept are left
 * to the orphan sweep, and a purge that failed waits for the hourly retry.
 */
export async function removePhoto(bucket: MediaBucket, photoKey: string): Promise<PhotoRemoval> {
  if (!(await deleteObjects(bucket, photoKey))) return { kind: "kept" };
  return { kind: "removed", cache: await bucket.cache.purge(photoKey) };
}

/**
 * Deletes a photo as removePhoto does, and says whether its objects are gone:
 * for whatever stops naming a photo and only logs what it could not do.
 */
export async function deletePhoto(bucket: MediaBucket, photoKey: string): Promise<boolean> {
  return (await removePhoto(bucket, photoKey)).kind === "removed";
}
