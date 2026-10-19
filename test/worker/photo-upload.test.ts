// Scenarios of docs/specs/business-registration.md for the photo of the
// registration, below the page, with Turnstile's check on the local
// Worker's emulated test secret: "The server only accepts the photo if it is
// a real image of at most 5 MB", "Image work has a ceiling, and what does not
// fit is turned away with a message, not queued", "The photo is stored
// compressed, without metadata and with a server-generated reference",
// "Resubmission after a rejection allows changing or removing the photo",
// "Photos are stored as two WebP sizes in R2 under opaque keys (v2)" and
// "Photos are uploaded through the Images binding, within a ceiling of work
// (v2)"; and of docs/specs/public-directory.md, "Photo weight does not break
// the 4G budget". What is uploaded and stored goes through
// src/core/photos/upload.ts, and the registration through
// src/core/registration/submit.ts and save.ts. The field is rendered in
// test/astro/registration.test.ts and run end to end in
// test/e2e/registration-photo.spec.ts.
//
// The images are drawn in code (./images.ts) and go through the local Images
// binding, which Wrangler runs offline with sharp: it applies the sizes, the
// `cover` crop from the centre and the WebP format, but not the quality, so
// the qualities, the weights and Images' failures are tested with a fake
// binding. Every object this file writes to the local media bucket is
// removed after it; the businesses belong to the fixture localities of this
// file, which `cleanup` removes, and their numbers are of the 7719996xxx
// series.
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { businesses } from "../../src/core/db/schema/index.ts";
import { HONEYPOT_FIELD } from "../../src/core/forms/honeypot.ts";
import { NOTICE_VERSION } from "../../src/core/legal/version.ts";
import { NO_PHOTO_CACHE } from "../../src/core/photos/cache.ts";
import {
  ACTION_BODY_LIMIT,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_PIXELS,
} from "../../src/core/photos/limits.ts";
import {
  isPhotoKey,
  PHOTO_CACHE_CONTROL,
  PHOTO_VARIANTS,
  photoObjectKey,
  photoObjectKeys,
} from "../../src/core/photos/photo.ts";
import {
  deletePhoto,
  isAcceptedPhotoInfo,
  MAX_PHOTOS_OPENED_AT_ONCE,
  OPENING_LEASE_MS,
  PHOTO_QUALITIES,
  type PhotoServices,
  PhotoSlots,
  sniffPhotoFormat,
  storePhoto,
  variantOutput,
  variantTransform,
  WORKING_OUTPUT,
  WORKING_TRANSFORM,
} from "../../src/core/photos/upload.ts";
import { registrationCatalogue } from "../../src/core/registration/catalogue.ts";
import {
  REGISTRATION_FIELDS as F,
  registrationDraft,
  uploadedFile,
  validateRegistration,
} from "../../src/core/registration/submission.ts";
import {
  submitRegistration,
  type SubmitRegistrationDeps,
} from "../../src/core/registration/submit.ts";
import { TURNSTILE_DUMMY_TOKEN, TURNSTILE_RESPONSE_FIELD } from "../../src/core/turnstile/keys.ts";
import { registrationActionError, registrationPageFailure } from "../../src/lib/registration.ts";
import { turnstileVerifier } from "../../src/lib/turnstile.ts";
import { cleanup, createFixture, db, type Fixture, insertBusiness } from "./fixtures.ts";
import {
  BLUE,
  colourCounts,
  colourOf,
  containsText,
  convert,
  drawWebp,
  EXIF_MAKE,
  GREEN,
  headerOnlyPng,
  photoFile,
  readPixels,
  RED,
  webpChunks,
  withExif,
} from "./images.ts";

const STATE = "89";
let f: Fixture;
let localityA: { code: string; name: string };
let categorySlug: string;

beforeAll(async () => {
  f = await createFixture(STATE);
  localityA = { code: f.localityA, name: "Pueblo Uno" };
  const catalogue = await db((tx) => registrationCatalogue(tx, localityA));
  categorySlug = catalogue.categories.find(({ id }) => id === f.categoryId)?.slug ?? "";
});

/** Every object this file wrote to the local media bucket. */
const written = new Set<string>();

afterAll(async () => {
  await cleanup(STATE);
  await env.MEDIA.delete([...written]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// A few images, drawn once.
let webp: Uint8Array<ArrayBuffer>;
let jpeg: Uint8Array<ArrayBuffer>;
let png: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  webp = drawWebp(1600, 1200, BLUE, [{ x: 0, y: 0, width: 400, height: 300, rgb: GREEN }]);
  jpeg = await convert(webp, "image/jpeg");
  png = await convert(webp, "image/png");
});

/** The local Images binding, counting what it is asked. */
function recordedImages(base: ImagesBinding = env.IMAGES) {
  const calls = { info: 0, inputs: 0, transforms: [] as ImageTransform[] };
  const wrap = (transformer: ImageTransformer): ImageTransformer => ({
    transform: (options) => {
      calls.transforms.push(options);
      return wrap(transformer.transform(options));
    },
    draw: (image, options) => wrap(transformer.draw(image, options)),
    output: (options) => transformer.output(options),
  });
  const images: PhotoServices["images"] = {
    info: (stream, options) => {
      calls.info += 1;
      return base.info(stream, options);
    },
    input: (stream, options) => {
      calls.inputs += 1;
      return wrap(base.input(stream, options));
    },
  };
  return { calls, images };
}

/** The local media bucket, noting what is written to it so it is removed afterwards. */
function recordedBucket(options: { failOn?: string } = {}) {
  const calls = { puts: [] as string[], deletes: [] as string[] };
  const bucket: PhotoServices["bucket"] = {
    put: ((key: string, value: Uint8Array, putOptions: R2PutOptions) => {
      calls.puts.push(key);
      if (options.failOn !== undefined && key.endsWith(options.failOn)) {
        return Promise.reject(new Error("R2 put failed"));
      }
      written.add(key);
      return env.MEDIA.put(key, value, putOptions);
    }) as R2Bucket["put"],
    delete: (keys) => {
      calls.deletes.push(...[keys].flat());
      return env.MEDIA.delete(keys);
    },
    cache: NO_PHOTO_CACHE,
  };
  return { calls, bucket };
}

/** The services of a photo on the local binding and bucket, recorded. */
function services(options: { failOn?: string } = {}) {
  const images = recordedImages();
  const bucket = recordedBucket(options);
  return {
    images: images.calls,
    bucket: bucket.calls,
    using: { images: images.images, bucket: bucket.bucket } satisfies PhotoServices,
  };
}

/** The object keys under the photo key. */
async function objectsOf(photoKey: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix: `photos/${photoKey}/` });
  return listed.objects.map(({ key }) => key).toSorted();
}

/** The photo key of a stored outcome, or a failed test. */
function keyOf(outcome: Awaited<ReturnType<typeof storePhoto>>): string {
  if (outcome.kind !== "stored") throw new Error(`not stored: ${outcome.error}`);
  return outcome.key;
}

/** A fake Images error with its code, as the binding throws it. */
function imagesError(code: number): Error {
  return Object.assign(new Error(`IMAGES_TRANSFORM_ERROR ${code}`), { code });
}

/**
 * A fake Images binding, for what the local one does not do: the quality,
 * the weights and the failures. What it writes starts with "FAKE" and the
 * size it says; its `info` reads that back, and says `original` of anything
 * else.
 */
function fakeImages(options: {
  original?: ImageInfoResponse;
  /** How much a variant weighs at a quality. */
  weigh?: (width: number, quality: number) => number;
  /** The size a variant comes back at. */
  size?: (width: number, height: number) => [number, number];
  infoError?: number;
  transformError?: number;
}) {
  const calls = { outputs: [] as { transform: ImageTransform; quality: number | undefined }[] };
  const {
    original = { format: "image/png", fileSize: 200, width: 3000, height: 2000 },
    weigh = () => 1000,
    size = (width, height) => [width, height],
  } = options;
  const transformer = (transforms: ImageTransform[]): ImageTransformer => ({
    transform: (transform) => transformer([...transforms, transform]),
    draw: () => transformer(transforms),
    output: async (output) => {
      if (options.transformError !== undefined) throw imagesError(options.transformError);
      const transform = transforms.at(-1) ?? {};
      calls.outputs.push({ transform, quality: output.quality });
      const [width, height] =
        transform.fit === "cover"
          ? size(transform.width ?? 0, transform.height ?? 0)
          : [transform.width ?? 0, transform.height ?? 0];
      const header = new TextEncoder().encode(`FAKE ${width} ${height} `);
      const bytes = new Uint8Array(Math.max(header.length, weigh(width, output.quality ?? 0)));
      bytes.set(header);
      return {
        response: () => new Response(bytes),
        contentType: () => output.format,
        image: () => new Blob([bytes]).stream(),
      };
    },
  });
  const images: PhotoServices["images"] = {
    info: async (stream) => {
      if (options.infoError !== undefined) throw imagesError(options.infoError);
      const text = new TextDecoder().decode(
        new Uint8Array(await new Response(stream).arrayBuffer()).subarray(0, 32),
      );
      const fake = /^FAKE (\d+) (\d+) /.exec(text);
      if (fake === null) return original;
      return { format: "image/webp", fileSize: 1, width: Number(fake[1]), height: Number(fake[2]) };
    },
    input: () => transformer([]),
  };
  return { calls, images };
}

/** A file whose first bytes are a PNG's, for the fake binding. */
const pngLike = () => photoFile(new Uint8Array(headerOnlyPng(3000, 2000)), "foto.png");

describe("The server only accepts the photo if it is a real image of at most 5 MB", () => {
  it("the content decides the format, never the name or the declared type", () => {
    const head = (bytes: number[]) => new Uint8Array(bytes);
    const text = (value: string) => new TextEncoder().encode(value);
    expect(sniffPhotoFormat(jpeg.subarray(0, 12))).toBe("image/jpeg");
    expect(sniffPhotoFormat(png.subarray(0, 12))).toBe("image/png");
    expect(sniffPhotoFormat(webp.subarray(0, 12))).toBe("image/webp");
    for (const bytes of [
      text("<!doctype html><html>"),
      text("%PDF-1.7\n%"),
      head([0x4d, 0x5a, 0x90, 0x00]), // a Windows executable
      head([0x7f, 0x45, 0x4c, 0x46]), // an ELF executable
      text('<svg xmlns="http://www.w3.org/2000/svg">'),
      text('<?xml version="1.0"?><svg>'),
      text("GIF89a"),
      text("RIFF\0\0\0\0WAVE"),
      head([0xff, 0xd8]),
      head([]),
    ]) {
      expect(sniffPhotoFormat(bytes)).toBeNull();
    }
  });

  // Scenario: the photo is served compressed and in two sizes (a JPEG, a PNG
  // and a WebP of the phone)
  it.for([
    ["a JPEG", "image/jpeg"],
    ["a PNG", "image/png"],
    ["a WebP", "image/webp"],
  ] as const)("%s is stored as its two variants", async ([, type]) => {
    const bytes = { "image/jpeg": jpeg, "image/png": png, "image/webp": webp }[type];
    const s = services();
    const key = keyOf(await storePhoto(photoFile(bytes, "foto", type), s.using));
    expect(isPhotoKey(key)).toBe(true);
    expect(await objectsOf(key)).toEqual(photoObjectKeys(key).toSorted());
  });

  // Scenarios: file disguised as an image; SVG rejected
  it.for([
    ["HTML", "foto.jpg", "image/jpeg", "<!doctype html><html><body>hola</body></html>"],
    ["a PDF", "foto.jpg", "image/jpeg", "%PDF-1.7\n1 0 obj << >> endobj"],
    ["an executable", "foto.jpg", "image/jpeg", "MZ\x90\0\x03\0\0\0\x04\0\0\0"],
    ["an SVG", "foto.svg", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg"/>'],
  ] as const)(
    "%s named %s and declared %s is unreadable, never reaches Images and stores nothing",
    async ([, name, type, content]) => {
      const s = services();
      const outcome = await storePhoto(
        photoFile(new TextEncoder().encode(content), name, type),
        s.using,
      );
      expect(outcome).toEqual({ kind: "rejected", error: "unreadable" });
      expect(s.images.info + s.images.inputs).toBe(0);
      expect(s.bucket.puts).toEqual([]);
    },
  );

  it("a GIF, whose first bytes are no JPEG, PNG or WebP, is unreadable", async () => {
    const s = services();
    const gif = new TextEncoder().encode("GIF89a\x01\0\x01\0\0\0\0;");
    expect(await storePhoto(photoFile(gif, "foto.gif", "image/gif"), s.using)).toEqual({
      kind: "rejected",
      error: "unreadable",
    });
    expect(s.images.inputs).toBe(0);
  });

  it("the first bytes and the header must agree: a PNG that Images reads as a JPEG is unreadable", () => {
    expect(
      isAcceptedPhotoInfo("image/png", {
        format: "image/jpeg",
        fileSize: 1,
        width: 10,
        height: 10,
      }),
    ).toBe(false);
    expect(isAcceptedPhotoInfo("image/png", { format: "image/svg+xml" })).toBe(false);
    expect(
      isAcceptedPhotoInfo("image/png", { format: "image/png", fileSize: 1, width: 0, height: 10 }),
    ).toBe(false);
  });

  // Scenario: photo over 5 MB
  it("5 MB is the limit of its weight, counted as 5 MiB, checked by the form before anything is opened", async () => {
    expect(MAX_PHOTO_BYTES).toBe(5 * 1024 * 1024);
    const valid = (file: File) =>
      validateRegistration(form({ ...required(), [F.photo]: file }), {
        categories: [{ id: f.categoryId, name: "x", slug: categorySlug }],
        zones: [
          {
            id: f.zoneA,
            slug: "centro",
            name: "Centro",
            displayName: "Centro",
            postalCode: f.postalCodeA,
          },
        ],
      });
    const atLimit = valid(photoFile(new Uint8Array(MAX_PHOTO_BYTES)));
    expect(atLimit.kind).toBe("valid");
    const over = valid(photoFile(new Uint8Array(MAX_PHOTO_BYTES + 1)));
    expect(over).toEqual({ kind: "invalid", errors: { photo: "too-large" } });
    const six = valid(photoFile(new Uint8Array(6_000_000)));
    expect(six).toEqual({ kind: "invalid", errors: { photo: "too-large" } });
    // And the photo's own step checks it again.
    const s = services();
    expect(await storePhoto(photoFile(new Uint8Array(MAX_PHOTO_BYTES + 1)), s.using)).toEqual({
      kind: "rejected",
      error: "too-large",
    });
    expect(s.images.info).toBe(0);
    // The body an action reads leaves room for a photo somewhat over the limit.
    expect(ACTION_BODY_LIMIT).toBe(2 * MAX_PHOTO_BYTES);
  });

  // Scenario: huge image in pixels
  it("a PNG of a few bytes that says 100 megapixels is unreadable, and is never opened", async () => {
    for (const [width, height] of [
      [10_000, 10_000],
      [6500, 6500],
      [40_001, 1000],
    ] as const) {
      const s = services();
      const outcome = await storePhoto(
        photoFile(headerOnlyPng(width, height), "foto.png", "image/png"),
        s.using,
      );
      expect(outcome, `${width}x${height}`).toEqual({ kind: "rejected", error: "unreadable" });
      // Its header was read, for free; nothing was transformed.
      expect(s.images.info).toBe(1);
      expect(s.images.inputs).toBe(0);
      expect(s.bucket.puts).toEqual([]);
    }
  });

  it("40 megapixels is the ceiling, read from the header", () => {
    expect(MAX_PHOTO_PIXELS).toBe(40_000_000);
    const info = (width: number, height: number) =>
      isAcceptedPhotoInfo("image/png", { format: "image/png", fileSize: 1, width, height });
    expect(info(8000, 5000)).toBe(true);
    expect(info(8000, 5001)).toBe(false);
  });

  // Scenario: several files in the same submission
  it("of several files in the photo field, only the first is read", () => {
    const first = photoFile(webp, "uno.webp", "image/webp");
    const data = form({
      [F.photo]: [first, photoFile(jpeg, "dos.jpg"), photoFile(png, "tres.png")],
    });
    expect(uploadedFile(data, F.photo)).toBe(first);
    // A file field left empty sends an empty file, which is no photo.
    expect(uploadedFile(form({ [F.photo]: new File([], "") }), F.photo)).toBeNull();
    expect(uploadedFile(form({ [F.photo]: "foto.jpg" }), F.photo)).toBeNull();
    expect(uploadedFile(new FormData(), F.photo)).toBeNull();
  });
});

describe("Image work has a ceiling, and what does not fit is turned away with a message, not queued", () => {
  it("a slot is taken at once or not at all, and given back", () => {
    const slots = new PhotoSlots(2);
    const first = slots.take();
    const second = slots.take();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(slots.take()).toBeNull();
    first?.();
    const third = slots.take();
    expect(third).not.toBeNull();
    expect(slots.take()).toBeNull();
    expect(MAX_PHOTOS_OPENED_AT_ONCE).toBe(4);
  });

  it("a slot nobody gave back expires on its own", () => {
    let now = 1_000_000;
    const slots = new PhotoSlots(1, OPENING_LEASE_MS, () => now);
    expect(slots.take()).not.toBeNull();
    expect(slots.take()).toBeNull();
    now += OPENING_LEASE_MS - 1;
    expect(slots.take()).toBeNull();
    now += 1;
    expect(slots.take()).not.toBeNull();
  });

  // Scenarios: more photos arrive than fit at once; what the turned-away
  // person wrote is not lost (the form, in the registration below)
  it("when every slot is taken, the photo is turned away at once as busy, and nothing is opened or stored", async () => {
    const slots = new PhotoSlots(1);
    const taken = slots.take();
    const s = services();
    expect(await storePhoto(photoFile(jpeg), { ...s.using, slots })).toEqual({
      kind: "rejected",
      error: "busy",
    });
    expect(s.images.inputs).toBe(0);
    expect(s.bucket.puts).toEqual([]);
    taken?.();
    keyOf(await storePhoto(photoFile(jpeg), { ...s.using, slots }));
  });

  // Scenarios: the work per photo is not multiplied; hard-to-compress photos
  // do not block the form
  it("the original is opened once, into a working copy, and both variants come from that copy without holding a slot", async () => {
    const slots = new PhotoSlots(1);
    const base = recordedImages();
    const sources: string[] = [];
    const slotsDuringVariants: boolean[] = [];
    const images: PhotoServices["images"] = {
      info: base.images.info,
      input: (stream, options) => {
        const index = base.calls.inputs;
        if (index > 0) {
          // A variant: the slot of the original is free again.
          const slot = slots.take();
          slotsDuringVariants.push(slot !== null);
          slot?.();
        }
        sources.push(index === 0 ? "original" : "working copy");
        return base.images.input(stream, options);
      },
    };
    const s = recordedBucket();
    keyOf(await storePhoto(photoFile(jpeg), { images, bucket: s.bucket, slots }));
    expect(sources).toEqual(["original", "working copy", "working copy"]);
    expect(slotsDuringVariants).toEqual([true, true]);
    expect(base.calls.transforms).toEqual([
      WORKING_TRANSFORM,
      expect.objectContaining({ fit: "cover" }),
      expect.objectContaining({ fit: "cover" }),
    ]);
  });

  it("the working copy keeps the whole photo, scaled down into 2400×2400; each variant is cropped from the centre to its size", () => {
    expect(WORKING_TRANSFORM).toEqual({ width: 2400, height: 2400, fit: "scale-down" });
    expect(WORKING_OUTPUT).toEqual({ format: "image/webp", quality: 90, anim: false });
    expect(variantTransform("card")).toEqual({
      width: 400,
      height: 400,
      fit: "cover",
      gravity: "center",
    });
    expect(variantTransform("full")).toEqual({
      width: 1200,
      height: 900,
      fit: "cover",
      gravity: "center",
    });
    expect(variantOutput(75)).toEqual({ format: "image/webp", quality: 75, anim: false });
    expect(PHOTO_QUALITIES).toEqual([75, 60, 45, 30]);
  });
});

describe("The photo is stored compressed, without metadata and with a server-generated reference", () => {
  // Scenario: what is stored (v2); the photo is served compressed and in two
  // sizes
  it("both objects are WebP of their exact size and weight, with the year's caching, under the new key, and nothing else", async () => {
    const s = services();
    const key = keyOf(await storePhoto(photoFile(withExif(jpeg)), s.using));
    expect(s.bucket.puts).toEqual([photoObjectKey(key, "full"), photoObjectKey(key, "card")]);
    expect(await objectsOf(key)).toEqual(photoObjectKeys(key).toSorted());
    for (const variant of ["card", "full"] as const) {
      const object = await env.MEDIA.get(photoObjectKey(key, variant));
      if (object === null) throw new Error(`${variant} is missing`);
      expect(object.httpMetadata).toEqual({
        contentType: "image/webp",
        cacheControl: PHOTO_CACHE_CONTROL,
      });
      const bytes = new Uint8Array(await object.arrayBuffer());
      const { width, height, maxBytes } = PHOTO_VARIANTS[variant];
      expect(bytes.byteLength).toBeLessThanOrEqual(maxBytes);
      expect(await env.IMAGES.info(new Blob([bytes]).stream())).toMatchObject({
        format: "image/webp",
        width,
        height,
      });
    }
  });

  // Scenarios: the phone location is neither published nor stored; no
  // metadata (v2)
  it("a photo with EXIF (camera, GPS) is stored with no metadata at all", async () => {
    const original = withExif(jpeg);
    expect(containsText(original, "Exif")).toBe(true);
    expect(containsText(original, EXIF_MAKE)).toBe(true);
    const key = keyOf(await storePhoto(photoFile(original), services().using));
    for (const variant of ["card", "full"] as const) {
      const object = await env.MEDIA.get(photoObjectKey(key, variant));
      const bytes = new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0));
      expect(containsText(bytes, EXIF_MAKE)).toBe(false);
      expect(containsText(bytes, "Exif")).toBe(false);
      const chunks = webpChunks(bytes);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks).not.toContain("EXIF");
      expect(chunks).not.toContain("XMP ");
    }
  });

  // The crop of the product owner's decision (2026-10-18): each variant is
  // its exact box, filled, and cropped from the centre of the whole photo.
  it("a portrait photo: both variants keep its whole width and lose its top and bottom", async () => {
    // 900×1600: red bands at the top and bottom, green stripes at the left
    // and right edges, blue in the middle.
    const portrait = drawWebp(900, 1600, BLUE, [
      { x: 0, y: 0, width: 900, height: 300, rgb: RED },
      { x: 0, y: 1300, width: 900, height: 300, rgb: RED },
      { x: 0, y: 300, width: 60, height: 1000, rgb: GREEN },
      { x: 840, y: 300, width: 60, height: 1000, rgb: GREEN },
    ]);
    const key = keyOf(await storePhoto(photoFile(portrait, "foto.webp"), services().using));
    for (const variant of ["card", "full"] as const) {
      const object = await env.MEDIA.get(photoObjectKey(key, variant));
      const pixels = await readPixels(new Uint8Array((await object?.arrayBuffer()) ?? []));
      const { width, height } = PHOTO_VARIANTS[variant];
      expect([pixels.width, pixels.height]).toEqual([width, height]);
      expect(colourCounts(pixels).red, variant).toBe(0);
      expect(colourOf(pixels.at(Math.round(width * 0.02), height / 2)), variant).toBe("green");
      expect(colourOf(pixels.at(width - 1 - Math.round(width * 0.02), height / 2))).toBe("green");
      expect(colourOf(pixels.at(width / 2, height / 2)), variant).toBe("blue");
    }
  });

  it("a landscape photo: the card is its centre square, the full variant its centre 4:3", async () => {
    // 1600×900: red bands at the left and right edges, green stripes inside
    // the 4:3 centre but outside the square one, blue in the middle.
    const landscape = drawWebp(1600, 900, BLUE, [
      { x: 0, y: 0, width: 150, height: 900, rgb: RED },
      { x: 1450, y: 0, width: 150, height: 900, rgb: RED },
      { x: 220, y: 0, width: 80, height: 900, rgb: GREEN },
      { x: 1300, y: 0, width: 80, height: 900, rgb: GREEN },
    ]);
    const key = keyOf(await storePhoto(photoFile(landscape, "foto.webp"), services().using));
    const read = async (variant: "card" | "full") => {
      const object = await env.MEDIA.get(photoObjectKey(key, variant));
      return readPixels(new Uint8Array((await object?.arrayBuffer()) ?? []));
    };
    const card = await read("card");
    expect(colourCounts(card)).toMatchObject({ red: 0, green: 0 });
    const full = await read("full");
    expect(colourCounts(full).red).toBe(0);
    // The centre 4:3 of 1600×900 is x 200…1400, at its own size: the
    // stripes at x 220…300 and 1300…1380 are at 20…100 and 1100…1180.
    expect(colourOf(full.at(60, 450))).toBe("green");
    expect(colourOf(full.at(1140, 450))).toBe("green");
    expect(colourOf(full.at(600, 450))).toBe("blue");
  });

  // public-directory, "Photo weight does not break the 4G budget"
  it("a variant over its weight is compressed again, from the working copy, until it fits", async () => {
    // Heavy until the third quality for the full variant, the first for the card.
    const fake = fakeImages({
      weigh: (width, quality) =>
        width === 1200 ? (quality > 45 ? 300_000 : 200_000) : quality > 75 ? 70_000 : 50_000,
    });
    const bucket = recordedBucket();
    const outcome = await storePhoto(pngLike(), { images: fake.images, bucket: bucket.bucket });
    const key = keyOf(outcome);
    const qualities = (width: number) =>
      fake.calls.outputs.filter(({ transform }) => transform.width === width).map((o) => o.quality);
    expect(qualities(2400)).toEqual([90]);
    expect(qualities(1200)).toEqual([75, 60, 45]);
    expect(qualities(400)).toEqual([75]);
    const full = await env.MEDIA.head(photoObjectKey(key, "full"));
    expect(full?.size).toBe(200_000);
  });

  it("a variant that does not fit its weight even at the lowest quality fails, and nothing is stored", async () => {
    const fake = fakeImages({ weigh: (width) => (width === 400 ? 61 * 1024 : 1000) });
    const bucket = recordedBucket();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await storePhoto(pngLike(), { images: fake.images, bucket: bucket.bucket })).toEqual({
      kind: "rejected",
      error: "failed",
    });
    expect(bucket.calls.puts).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      "photos: a photo could not be prepared (the card variant does not fit its weight)",
    );
  });

  it("a variant that comes back at another size fails, and nothing is stored", async () => {
    const fake = fakeImages({ size: (width, height) => [width, height + 1] });
    const bucket = recordedBucket();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await storePhoto(pngLike(), { images: fake.images, bucket: bucket.bucket })).toEqual({
      kind: "rejected",
      error: "failed",
    });
    expect(bucket.calls.puts).toEqual([]);
  });

  // Scenario: a failure while transforming (v2). 9422 is the free monthly
  // allowance spent; 9523 a file Images cannot read; 9504 an outage.
  it.for([
    ["reading its header", { infoError: 9422 }],
    ["transforming it", { transformError: 9422 }],
    ["transforming a file Images cannot read", { transformError: 9523 }],
    ["an outage", { transformError: 9504 }],
  ] as const)(
    "when Images fails %s, the photo failed, nothing is stored and the log says only the code",
    async ([, failure]) => {
      const fake = fakeImages(failure);
      const bucket = recordedBucket();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await storePhoto(pngLike(), { images: fake.images, bucket: bucket.bucket })).toEqual({
        kind: "rejected",
        error: "failed",
      });
      expect(bucket.calls.puts).toEqual([]);
      const code = "infoError" in failure ? failure.infoError : failure.transformError;
      expect(log.mock.calls).toEqual([[`photos: a photo could not be prepared (Images ${code})`]]);
    },
  );

  it("if writing the second object fails, the first is deleted", async () => {
    const s = services({ failOn: "card.webp" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await storePhoto(photoFile(jpeg), s.using)).toEqual({
      kind: "rejected",
      error: "failed",
    });
    const [full, card] = s.bucket.puts;
    expect(full).toMatch(/^photos\/[a-z0-9]{24}\/full\.webp$/);
    expect(card).toMatch(/\/card\.webp$/);
    const key = full?.split("/")[1] ?? "";
    expect(s.bucket.deletes.toSorted()).toEqual(photoObjectKeys(key).toSorted());
    expect(await objectsOf(key)).toEqual([]);
  });

  it("deleting a photo deletes both objects; one that is not there is no failure", async () => {
    const s = services();
    const key = keyOf(await storePhoto(photoFile(jpeg), s.using));
    expect(await deletePhoto(s.using.bucket, key)).toBe(true);
    expect(await objectsOf(key)).toEqual([]);
    expect(await deletePhoto(s.using.bucket, key)).toBe(true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { ...s.using.bucket, delete: () => Promise.reject(new TypeError("R2 down")) };
    expect(await deletePhoto(failing, key)).toBe(false);
    expect(log).toHaveBeenCalledWith("photos: a photo could not be deleted (TypeError)");
  });
});

/** A form as a browser sends it; a list sends the field once per value. */
function form(fields: Record<string, string | Blob | (string | Blob)[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  }
  return data;
}

let phone = 0;
/** A fictitious number of this file, 7719996xxx. */
const newPhone = () => `771999${6000 + ++phone}`;

/** The required fields of a valid submission, with the token the local Turnstile accepts. */
function required(overrides: Record<string, string | Blob | (string | Blob)[]> = {}) {
  return {
    [HONEYPOT_FIELD]: "",
    [TURNSTILE_RESPONSE_FIELD]: TURNSTILE_DUMMY_TOKEN,
    [F.name]: "Fotos de Mentiras",
    [F.category]: categorySlug,
    [F.whatsapp]: newPhone(),
    [F.postalCode]: f.postalCodeA,
    [F.zone]: "centro",
    [F.noticeVersion]: NOTICE_VERSION,
    [F.consent]: "on",
    ...overrides,
  };
}

/** The local Worker's Turnstile check, which emulates the always-pass test secret. */
const verifyTurnstile = turnstileVerifier(env);

/**
 * Dependencies of the core whose quota lets everything through, with the
 * local Turnstile check and recorded photo services.
 */
function deps(
  options: { failOn?: string; allowed?: boolean; useDb?: SubmitRegistrationDeps["useDb"] } = {},
) {
  const s = services(options);
  const calls = { quota: 0 };
  const using: SubmitRegistrationDeps = {
    useDb: options.useDb ?? db,
    takeQuota: async () => {
      calls.quota += 1;
      return options.allowed === false
        ? { allowed: false, retryAfterSeconds: 60 }
        : { allowed: true };
    },
    verifyTurnstile,
    photos: s.using,
  };
  return { ...s, calls, using };
}

const submit = (data: FormData, using: SubmitRegistrationDeps) =>
  submitRegistration(data, localityA, using);

/** The business of `whatsapp` in locality A, or undefined. */
async function businessOf(whatsapp: string) {
  const [row] = await db((tx) =>
    tx
      .select()
      .from(businesses)
      .where(and(eq(businesses.localityCode, f.localityA), eq(businesses.whatsapp, whatsapp))),
  );
  return row;
}

describe("A registration with a photo", () => {
  // Scenario: choosing a photo from the phone; what is stored (v2)
  it("is saved with the photo key the server generated, whose two objects are in the bucket", async () => {
    const whatsapp = newPhone();
    const d = deps();
    const outcome = await submit(
      form(
        required({
          [F.whatsapp]: whatsapp,
          [F.photo]: photoFile(jpeg),
          // Scenario: the client cannot set the photo reference
          photoKey: "aaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      ),
      d.using,
    );
    expect(outcome).toEqual({ kind: "received" });
    const saved = await businessOf(whatsapp);
    expect(isPhotoKey(saved?.photoKey)).toBe(true);
    expect(saved?.photoKey).not.toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(await objectsOf(saved?.photoKey ?? "")).toEqual(
      photoObjectKeys(saved?.photoKey ?? "").toSorted(),
    );
  });

  // Scenario: registering without a photo; registration with required fields only
  it("without a photo, or with an empty file field, is saved without one and without touching Images", async () => {
    for (const photo of [undefined, new File([], "")]) {
      const whatsapp = newPhone();
      const d = deps();
      const fields = required({ [F.whatsapp]: whatsapp });
      const data = form(photo === undefined ? fields : { ...fields, [F.photo]: photo });
      expect(await submit(data, d.using)).toEqual({ kind: "received" });
      expect((await businessOf(whatsapp))?.photoKey).toBeNull();
      expect(d.images.info + d.images.inputs).toBe(0);
    }
  });

  // Scenarios: the photo has to be chosen again; photo over 5 MB
  it("with another field wrong, nothing is opened: a photo over 5 MB says so beside the other errors", async () => {
    const d = deps();
    const big = photoFile(new Uint8Array(6_000_000));
    expect(await submit(form(required({ [F.name]: "", [F.photo]: big })), d.using)).toEqual({
      kind: "invalid",
      errors: { name: "required", photo: "too-large" },
    });
    const fine = form(required({ [F.name]: "", [F.photo]: photoFile(jpeg) }));
    expect(await submit(fine, d.using)).toEqual({ kind: "invalid", errors: { name: "required" } });
    // The form says the photo has to be chosen again.
    expect(registrationDraft(fine).photo).toBe(true);
    expect(d.images.info + d.images.inputs).toBe(0);
    expect(d.calls.quota).toBe(0);
    expect(d.bucket.puts).toEqual([]);
  });

  // Scenario: the bot does not pay for processing
  it("caught by the trap field or over the quota, the photo is never opened and nothing is stored", async () => {
    const trapped = deps();
    const bot = form(required({ [HONEYPOT_FIELD]: "bot", [F.photo]: photoFile(jpeg) }));
    expect(await submit(bot, trapped.using)).toEqual({ kind: "received" });
    const over = deps({ allowed: false });
    const whatsapp = newPhone();
    const busyIp = form(required({ [F.whatsapp]: whatsapp, [F.photo]: photoFile(jpeg) }));
    expect(await submit(busyIp, over.using)).toEqual({ kind: "quota" });
    for (const d of [trapped, over]) {
      expect(d.images.info + d.images.inputs).toBe(0);
      expect(d.bucket.puts).toEqual([]);
    }
    expect(await businessOf(whatsapp)).toBeUndefined();
  });

  // Scenario: a photo Turnstile refused; the bot does not pay for processing
  it("refused by Turnstile, the photo is never opened, nothing is stored and no quota is spent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const token of [undefined, "", "a-forged-token"]) {
      const whatsapp = newPhone();
      const d = deps();
      const fields: Record<string, string | Blob> = required({
        [F.whatsapp]: whatsapp,
        [F.photo]: photoFile(jpeg),
      });
      if (token === undefined) delete fields[TURNSTILE_RESPONSE_FIELD];
      else fields[TURNSTILE_RESPONSE_FIELD] = token;
      expect(await submit(form(fields), d.using), String(token)).toEqual({ kind: "turnstile" });
      expect(d.images.info + d.images.inputs, String(token)).toBe(0);
      expect(d.bucket.puts, String(token)).toEqual([]);
      expect(d.calls.quota, String(token)).toBe(0);
      expect(await businessOf(whatsapp)).toBeUndefined();
    }
  });

  it("an unreadable photo comes back next to its field, after the quota, with nothing saved", async () => {
    const whatsapp = newPhone();
    const d = deps();
    const disguised = photoFile(new TextEncoder().encode("<html></html>"));
    expect(
      await submit(form(required({ [F.whatsapp]: whatsapp, [F.photo]: disguised })), d.using),
    ).toEqual({ kind: "invalid", errors: { photo: "unreadable" } });
    expect(d.calls.quota).toBe(1);
    expect(await businessOf(whatsapp)).toBeUndefined();
  });

  // Scenario: no orphan files when the registration fails
  it("for a number that already has a card, the photo just stored is deleted", async () => {
    const whatsapp = newPhone();
    await insertBusiness(f, { whatsapp, status: "published", publishedAt: new Date() });
    const before = await businessOf(whatsapp);
    const d = deps();
    expect(
      await submit(form(required({ [F.whatsapp]: whatsapp, [F.photo]: photoFile(jpeg) })), d.using),
    ).toEqual({ kind: "invalid", errors: { whatsapp: "duplicate" } });
    expect(d.bucket.puts).toHaveLength(2);
    expect(d.bucket.deletes.toSorted()).toEqual(d.bucket.puts.toSorted());
    expect(await objectsOf(d.bucket.puts[0]?.split("/")[1] ?? "")).toEqual([]);
    expect(await businessOf(whatsapp)).toEqual(before);
  });

  it("when the database fails to save, the photo just stored is deleted", async () => {
    const whatsapp = newPhone();
    // A connection whose inserts fail, after the catalogue was read.
    const failing: SubmitRegistrationDeps["useDb"] = (run) =>
      db((tx) =>
        run(
          new Proxy(tx, {
            get: (target, property, receiver) =>
              property === "insert"
                ? () => {
                    throw Object.assign(new Error("connection lost"), { code: "08006" });
                  }
                : Reflect.get(target, property, receiver),
          }),
        ),
      );
    const d = deps({ useDb: failing });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await submit(form(required({ [F.whatsapp]: whatsapp, [F.photo]: photoFile(jpeg) })), d.using),
    ).toEqual({ kind: "server" });
    expect(d.bucket.puts).toHaveLength(2);
    expect(d.bucket.deletes.toSorted()).toEqual(d.bucket.puts.toSorted());
    expect(log).toHaveBeenCalledWith(
      "registration: a registration could not be saved (PostgreSQL 08006)",
    );
    expect(await businessOf(whatsapp)).toBeUndefined();
  });

  // Scenarios: more photos arrive than fit at once; what the turned-away
  // person wrote is not lost (the form, in test/astro/registration.test.ts)
  it("busy or failed, the form comes back next to the photo with nothing saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const error of ["busy", "failed"] as const) {
      const whatsapp = newPhone();
      const d = deps();
      const photos: PhotoServices =
        error === "busy"
          ? { ...d.using.photos, slots: new PhotoSlots(0) }
          : { ...d.using.photos, images: fakeImages({ transformError: 9422 }).images };
      const file = error === "busy" ? photoFile(jpeg) : pngLike();
      const data = form(required({ [F.whatsapp]: whatsapp, [F.photo]: file }));
      expect(await submit(data, { ...d.using, photos }), error).toEqual({
        kind: "invalid",
        errors: { photo: error },
      });
      expect(await businessOf(whatsapp), error).toBeUndefined();
      expect(d.bucket.puts, error).toEqual([]);
    }
  });
});

describe("Resubmission after a rejection allows changing or removing the photo", () => {
  /** A rejected card of locality A with a stored photo. */
  async function rejectedWithPhoto() {
    const whatsapp = newPhone();
    const photoKey = keyOf(await storePhoto(photoFile(jpeg), services().using));
    await insertBusiness(f, {
      whatsapp,
      status: "rejected",
      rejectedAt: new Date("2026-09-01T12:00:00Z"),
      rejectionReason: "Sin foto clara",
      photoKey,
    });
    return { whatsapp, photoKey };
  }

  // Scenario: changing the photo on resubmission
  it("a new photo replaces the old one, whose objects are deleted after the card is saved", async () => {
    const { whatsapp, photoKey } = await rejectedWithPhoto();
    const d = deps();
    const data = form(required({ [F.whatsapp]: whatsapp, [F.photo]: photoFile(png, "f.png") }));
    expect(await submit(data, d.using)).toEqual({ kind: "received" });
    const after = await businessOf(whatsapp);
    expect(after?.status).toBe("in_review");
    expect(isPhotoKey(after?.photoKey)).toBe(true);
    expect(after?.photoKey).not.toBe(photoKey);
    expect(await objectsOf(after?.photoKey ?? "")).toHaveLength(2);
    expect(await objectsOf(photoKey)).toEqual([]);
    // Written first, deleted after.
    expect(d.bucket.deletes.toSorted()).toEqual(photoObjectKeys(photoKey).toSorted());
  });

  // Scenario: removing the photo on resubmission
  it('"Dejar mi ficha sin foto" leaves the card without its photo, whose objects are deleted', async () => {
    const { whatsapp, photoKey } = await rejectedWithPhoto();
    const d = deps();
    expect(
      await submit(form(required({ [F.whatsapp]: whatsapp, [F.removePhoto]: "on" })), d.using),
    ).toEqual({ kind: "received" });
    expect((await businessOf(whatsapp))?.photoKey).toBeNull();
    expect(await objectsOf(photoKey)).toEqual([]);
  });

  it("the checkbox wins over a file chosen with it, which is never opened", async () => {
    const { whatsapp, photoKey } = await rejectedWithPhoto();
    const d = deps();
    const data = form(
      required({ [F.whatsapp]: whatsapp, [F.removePhoto]: "on", [F.photo]: photoFile(jpeg) }),
    );
    expect(await submit(data, d.using)).toEqual({ kind: "received" });
    expect((await businessOf(whatsapp))?.photoKey).toBeNull();
    expect(await objectsOf(photoKey)).toEqual([]);
    expect(d.images.info + d.images.inputs).toBe(0);
    // Nor does the form say to choose it again.
    expect(registrationDraft(data)).toMatchObject({ photo: false, removePhoto: true });
  });

  // Scenario: resubmission that does not touch the photo
  it("without a file or the checkbox, the card keeps exactly its photo", async () => {
    const { whatsapp, photoKey } = await rejectedWithPhoto();
    const d = deps();
    const data = form(required({ [F.whatsapp]: whatsapp, [F.openingHours]: "Lunes a viernes" }));
    expect(await submit(data, d.using)).toEqual({ kind: "received" });
    expect(await businessOf(whatsapp)).toMatchObject({ photoKey, openingHours: "Lunes a viernes" });
    expect(await objectsOf(photoKey)).toHaveLength(2);
    expect(d.bucket.deletes).toEqual([]);
  });

  it("the checkbox counts only as a browser sends it", async () => {
    const { whatsapp, photoKey } = await rejectedWithPhoto();
    const data = form(required({ [F.whatsapp]: whatsapp, [F.removePhoto]: "true" }));
    expect(await submit(data, deps().using)).toEqual({ kind: "received" });
    expect((await businessOf(whatsapp))?.photoKey).toBe(photoKey);
  });

  // Scenario: the resubmission with a photo goes through the same defenses
  it("a 6 MB photo, the trap field or the quota leave the rejected card and its photo as they were", async () => {
    const { whatsapp, photoKey } = await rejectedWithPhoto();
    const before = await businessOf(whatsapp);
    const big = form(
      required({ [F.whatsapp]: whatsapp, [F.photo]: photoFile(new Uint8Array(6_000_000)) }),
    );
    expect(await submit(big, deps().using)).toEqual({
      kind: "invalid",
      errors: { photo: "too-large" },
    });
    const bot = form(
      required({ [F.whatsapp]: whatsapp, [HONEYPOT_FIELD]: "bot", [F.photo]: photoFile(jpeg) }),
    );
    expect(await submit(bot, deps().using)).toEqual({ kind: "received" });
    const over = deps({ allowed: false });
    const quota = form(required({ [F.whatsapp]: whatsapp, [F.removePhoto]: "on" }));
    expect(await submit(quota, over.using)).toEqual({ kind: "quota" });
    expect(await businessOf(whatsapp)).toEqual(before);
    expect(await objectsOf(photoKey)).toHaveLength(2);
  });

  it("a new card with the checkbox and no file is saved without a photo, as the checkbox changes nothing there", async () => {
    const whatsapp = newPhone();
    const data = form(required({ [F.whatsapp]: whatsapp, [F.removePhoto]: "on" }));
    expect(await submit(data, deps().using)).toEqual({ kind: "received" });
    expect((await businessOf(whatsapp))?.photoKey).toBeNull();
  });
});

describe("Photos are uploaded through the Images binding, within a ceiling of work (v2)", () => {
  it("each photo error is its answer: 400 for the photo, 503 when busy, 502 when Images failed", () => {
    const of = (photo: "too-large" | "unreadable" | "busy" | "failed") =>
      registrationActionError({ kind: "invalid", errors: { photo } });
    expect(of("too-large")?.status).toBe(400);
    expect(of("unreadable")?.status).toBe(400);
    expect(of("busy")?.status).toBe(503);
    expect(of("failed")?.status).toBe(502);
    for (const photo of ["too-large", "unreadable", "busy", "failed"] as const) {
      const error = of(photo);
      if (error === null) throw new Error("no error");
      expect(registrationPageFailure(error)).toEqual({
        errors: { photo },
        general: null,
        keepsDraft: true,
      });
    }
  });

  it("the draft says a photo was sent, so the form asks for it again, and keeps the checkbox", () => {
    expect(registrationDraft(form(required({ [F.photo]: photoFile(jpeg) })))).toMatchObject({
      photo: true,
      removePhoto: false,
    });
    expect(registrationDraft(form(required({ [F.photo]: new File([], "") })))).toMatchObject({
      photo: false,
      removePhoto: false,
    });
    expect(registrationDraft(form(required({ [F.removePhoto]: "on" })))).toMatchObject({
      photo: false,
      removePhoto: true,
    });
  });
});
