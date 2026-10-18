// The photos of the fictitious seed (docs/specs/data-model.md, "The demo seed
// leaves cards with a photo to see the directory as the resident will see
// it"). The seed draws them when it runs, so no image file goes in the
// repository: a coloured rectangle with the fictitious name of the business
// and "FOTO DE MENTIRA" in a band below, in the two sizes of every photo
// (src/core/photos/photo.ts), as lossless WebP (./webp.ts). Each fake business
// with a photo has a fixed photo key, so the seed writes the same objects
// every time: running it again overwrites them and leaves nothing behind.
import {
  PHOTO_CACHE_CONTROL,
  PHOTO_CONTENT_TYPE,
  PHOTO_VARIANT_NAMES,
  PHOTO_VARIANTS,
  photoObjectKey,
  type PhotoVariant,
} from "../../photos/photo.ts";
import { encodeLosslessWebp, type Bitmap } from "./webp.ts";

/** A 5×7 pixel font, one string of five bits per row, for the letters a name has once its accents go. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "10001", "01010", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
/** A glyph and the column after it; a line and the three rows after it. */
const CELL_WIDTH = GLYPH_WIDTH + 1;
const LINE_HEIGHT = GLYPH_HEIGHT + 3;

const WHITE = 0xffffff;

/**
 * The backgrounds, in 0xRRGGBB, dark enough for white text: a deep green, a
 * terracotta, a slate blue and a plum. They are pixels of a made-up image,
 * not colours of the site, which only uses the tokens of global.css.
 */
const BACKGROUNDS = [0x2f6f5e, 0x8a4b2e, 0x3d5a80, 0x6b4e71] as const;

/** What the band at the bottom says, so nobody takes the image for a real photo. */
export const DEMO_PHOTO_CAPTION = "FOTO DE MENTIRA";

/** The text in the letters of the font: capitals, no accents, unknown characters as spaces. */
function printable(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9.\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words of `text` in lines of at most `columns` characters, or null if a word is longer. */
function wrap(text: string, columns: number): string[] | null {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    if (word.length > columns) return null;
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= columns) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

function darker(rgb: number): number {
  const channel = (shift: number) => Math.round(((rgb >>> shift) & 0xff) * 0.7) << shift;
  return channel(16) | channel(8) | channel(0);
}

function fill(bitmap: Bitmap, x: number, y: number, width: number, height: number, rgb: number) {
  for (let row = Math.max(0, y); row < Math.min(bitmap.height, y + height); row += 1) {
    bitmap.pixels.fill(
      rgb,
      row * bitmap.width + Math.max(0, x),
      row * bitmap.width + Math.min(bitmap.width, x + width),
    );
  }
}

/** Draws `lines` centred on `centerY`, `scale` pixels per font pixel. */
function drawLines(bitmap: Bitmap, lines: readonly string[], scale: number, centerY: number) {
  const top = Math.round(
    centerY - ((lines.length * LINE_HEIGHT - (LINE_HEIGHT - GLYPH_HEIGHT)) * scale) / 2,
  );
  lines.forEach((line, index) => {
    const left = Math.round((bitmap.width - (line.length * CELL_WIDTH - 1) * scale) / 2);
    const y = top + index * LINE_HEIGHT * scale;
    line.split("").forEach((character, column) => {
      const glyph = GLYPHS[character];
      if (glyph === undefined) return;
      const x = left + column * CELL_WIDTH * scale;
      glyph.forEach((bits, row) => {
        bits.split("").forEach((bit, dot) => {
          if (bit === "1") fill(bitmap, x + dot * scale, y + row * scale, scale, scale, WHITE);
        });
      });
    });
  });
}

/** The largest scale at which `text` fits in the box, wrapped, and its lines. */
function fit(text: string, width: number, height: number): { scale: number; lines: string[] } {
  for (let scale = Math.floor(width / (CELL_WIDTH * 4)); scale > 1; scale -= 1) {
    const lines = wrap(text, Math.floor((width / scale + 1) / CELL_WIDTH));
    if (lines !== null && lines.length * LINE_HEIGHT * scale <= height) return { scale, lines };
  }
  return { scale: 1, lines: wrap(text, Math.floor((width + 1) / CELL_WIDTH)) ?? [text] };
}

/** The demo image of a business, at the size of `variant`, on background number `shade`. */
export function demoPhoto(name: string, variant: PhotoVariant, shade: number): Bitmap {
  const { width, height } = PHOTO_VARIANTS[variant];
  const background = BACKGROUNDS[Math.abs(shade) % BACKGROUNDS.length] ?? BACKGROUNDS[0];
  const bitmap: Bitmap = {
    width,
    height,
    pixels: new Uint32Array(width * height).fill(background),
  };
  const margin = Math.round(width * 0.08);
  const band = Math.round(height * 0.18);
  fill(bitmap, 0, height - band, width, band, darker(background));
  const title = fit(printable(name), width - 2 * margin, height - band - 2 * margin);
  drawLines(bitmap, title.lines, title.scale, (height - band) / 2);
  const caption = fit(DEMO_PHOTO_CAPTION, width - 2 * margin, Math.round(band * 0.6));
  drawLines(bitmap, caption.lines, caption.scale, height - band / 2);
  return bitmap;
}

/** An object the seed writes to the media bucket. */
export interface SeedPhotoObject {
  key: string;
  body: Uint8Array;
  contentType: string;
  cacheControl: string;
}

/** A fake business whose row carries its seeded photo key. */
export interface SeededPhoto {
  name: string;
  photoKey: string;
  /** Its place among the seeded photos, which picks its background. */
  shade: number;
}

/** Both variants of each seeded photo, as the objects to write. */
export function seedPhotoObjects(photos: readonly SeededPhoto[]): SeedPhotoObject[] {
  return photos.flatMap(({ name, photoKey, shade }) =>
    PHOTO_VARIANT_NAMES.map((variant) => ({
      key: photoObjectKey(photoKey, variant),
      body: encodeLosslessWebp(demoPhoto(name, variant, shade)),
      contentType: PHOTO_CONTENT_TYPE,
      cacheControl: PHOTO_CACHE_CONTROL,
    })),
  );
}

/** What the seed needs of a bucket: R2's `put`, which the binding and Miniflare's local one have. */
export interface SeedPhotoBucket {
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: string; cacheControl: string } },
  ): Promise<unknown>;
}

/** Writes the objects to the bucket, overwriting what is there under the same keys. */
export async function writeSeedPhotos(
  bucket: SeedPhotoBucket,
  objects: readonly SeedPhotoObject[],
): Promise<void> {
  for (const { key, body, contentType, cacheControl } of objects) {
    await bucket.put(key, body, { httpMetadata: { contentType, cacheControl } });
  }
}
