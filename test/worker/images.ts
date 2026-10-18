// Images for the photo tests, made in code: no image file goes in the
// repository. Photos are drawn with the seed's lossless WebP encoder
// (src/core/db/seed/webp.ts) and turned into JPEG or PNG by the local Images
// binding; a PNG that only has a header says any size in a few bytes; EXIF is
// written into a JPEG by hand; and the variants are read back as PNG, decoded
// here, to look at their pixels.
import { env } from "cloudflare:workers";
import { type Bitmap, encodeLosslessWebp } from "../../src/core/db/seed/webp.ts";

export const RED = 0xff0000;
export const GREEN = 0x00c000;
export const BLUE = 0x0000ff;

/** A rectangle of a bitmap, painted. */
export interface Band {
  x: number;
  y: number;
  width: number;
  height: number;
  rgb: number;
}

/** A WebP of `width`×`height` in `background`, with `bands` painted over it in order. */
export function drawWebp(
  width: number,
  height: number,
  background: number,
  bands: readonly Band[] = [],
): Uint8Array<ArrayBuffer> {
  const bitmap: Bitmap = {
    width,
    height,
    pixels: new Uint32Array(width * height).fill(background),
  };
  for (const band of bands) {
    for (let row = band.y; row < band.y + band.height; row += 1) {
      bitmap.pixels.fill(band.rgb, row * width + band.x, row * width + band.x + band.width);
    }
  }
  return new Uint8Array(encodeLosslessWebp(bitmap));
}

export function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
  return new Blob([bytes]).stream();
}

/** `bytes` in another format, by the local Images binding. */
export async function convert(
  bytes: Uint8Array<ArrayBuffer>,
  format: "image/jpeg" | "image/png" | "image/webp",
): Promise<Uint8Array<ArrayBuffer>> {
  const result = await env.IMAGES.input(streamOf(bytes)).output({ format });
  return new Uint8Array(await result.response().arrayBuffer());
}

/** A file as a browser uploads it. */
export function photoFile(
  bytes: Uint8Array<ArrayBuffer>,
  name = "foto.jpg",
  type = "image/jpeg",
): File {
  return new File([bytes], name, { type });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A PNG whose header says `width`×`height` and whose pixels are a few bytes
 * that end at once: a valid header, so its size can be read, and a body that
 * no one can open. The cheap way to claim 100 megapixels in 62 bytes.
 */
export function headerOnlyPng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return concat([
    new Uint8Array(PNG_SIGNATURE),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00])),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/** What the EXIF written by withExif says, to look for it afterwards. */
export const EXIF_MAKE = "CamaraDeMentira";

/**
 * `jpeg` with an EXIF block (APP1) after its start: the camera make
 * EXIF_MAKE and a GPS latitude of 20° 5' N, as a phone writes them.
 */
export function withExif(jpeg: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const make = new TextEncoder().encode(`${EXIF_MAKE}\0`);
  // TIFF header (8), IFD0 with 2 entries (30), the GPS IFD with 2 (30), the
  // make, then three rationals.
  const makeAt = 8 + 30 + 30;
  const rationalsAt = makeAt + make.length + (make.length % 2);
  const tiff = new Uint8Array(rationalsAt + 24);
  const view = new DataView(tiff.buffer);
  tiff.set([0x4d, 0x4d, 0x00, 0x2a], 0);
  view.setUint32(4, 8);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(at, tag);
    view.setUint16(at + 2, type);
    view.setUint32(at + 4, count);
    view.setUint32(at + 8, value);
  };
  view.setUint16(8, 2);
  entry(10, 0x010f, 2, make.length, makeAt); // Make, ASCII
  entry(22, 0x8825, 4, 1, 38); // the GPS IFD
  view.setUint32(34, 0);
  view.setUint16(38, 2);
  entry(40, 0x0001, 2, 2, 0x4e000000); // GPSLatitudeRef "N"
  entry(52, 0x0002, 5, 3, rationalsAt); // GPSLatitude, three rationals
  view.setUint32(64, 0);
  tiff.set(make, makeAt);
  for (const [index, [numerator, denominator]] of [
    [20, 1],
    [5, 1],
    [0, 1],
  ].entries()) {
    view.setUint32(rationalsAt + index * 8, numerator ?? 0);
    view.setUint32(rationalsAt + index * 8 + 4, denominator ?? 1);
  }
  const body = concat([new TextEncoder().encode("Exif\0\0"), tiff]);
  const segment = new Uint8Array(4 + body.length);
  segment.set([0xff, 0xe1], 0);
  new DataView(segment.buffer).setUint16(2, body.length + 2);
  segment.set(body, 4);
  return concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/** Whether `bytes` contain `text`, as bytes. */
export function containsText(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** The chunk names of a WebP file (RIFF), in order: VP8, VP8L, VP8X, ALPH, EXIF, XMP … */
export function webpChunks(webp: Uint8Array): string[] {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const decoder = new TextDecoder();
  const names: string[] = [];
  for (let at = 12; at + 8 <= webp.length;) {
    names.push(decoder.decode(webp.subarray(at, at + 4)));
    const size = view.getUint32(at + 4, true);
    at += 8 + size + (size % 2);
  }
  return names;
}

/** An image read back to its pixels. */
export interface Pixels {
  width: number;
  height: number;
  /** The colour at (x, y) as [r, g, b]. */
  at(x: number, y: number): [number, number, number];
}

/** `image` (any format the binding reads) as pixels, through a PNG the binding writes. */
export async function readPixels(image: Uint8Array<ArrayBuffer>): Promise<Pixels> {
  const png = await convert(image, "image/png");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  let colorType = 0;
  const data: Uint8Array[] = [];
  for (let at = 8; at + 8 <= png.length;) {
    const size = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + size);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (body[8] !== 8 || body[12] !== 0)
        throw new Error("readPixels: only 8-bit, not interlaced");
      colorType = body[9] ?? 0;
    }
    if (type === "IDAT") data.push(body);
    at += 12 + size;
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`readPixels: colour type ${colorType}`);
  const inflated = new Uint8Array(
    await new Response(
      new Blob([concat(data)]).stream().pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[y * (stride + 1) + 1 + x] ?? 0;
      const a = x >= channels ? (out[y * stride + x - channels] ?? 0) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] ?? 0) : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const predicted = [0, a, b, Math.floor((a + b) / 2), paeth][filter] ?? 0;
      out[y * stride + x] = (raw + predicted) & 0xff;
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const at = y * stride + x * channels;
      return [out[at] ?? 0, out[at + 1] ?? 0, out[at + 2] ?? 0];
    },
  };
}

/** The closest of red, green, blue or "other" to a pixel. */
export function colourOf([r, g, b]: [number, number, number]): "red" | "green" | "blue" | "other" {
  if (r > 160 && g < 90 && b < 90) return "red";
  if (g > 120 && r < 90 && b < 90) return "green";
  if (b > 160 && r < 90 && g < 90) return "blue";
  return "other";
}

/** How many pixels of `pixels` are each colour. */
export function colourCounts(pixels: Pixels): Record<ReturnType<typeof colourOf>, number> {
  const counts = { red: 0, green: 0, blue: 0, other: 0 };
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) counts[colourOf(pixels.at(x, y))] += 1;
  }
  return counts;
}
