// A small lossless WebP (VP8L) encoder for the images of the fictitious seed
// (docs/specs/data-model.md, "The demo seed leaves cards with a photo to see
// the directory as the resident will see it"): the seed draws its images when
// it runs, so no image file goes in the repository, and plain TypeScript keeps
// it free of native dependencies. It is not a general encoder. It writes no
// transforms and no color cache, one group of prefix codes for the whole
// image, and backward references only to the pixel on the left and the pixel
// above, which is all the flat drawings of the seed need to stay a few
// kilobytes. The format is RFC 9649, "WebP Image Format".

/** An opaque image: one 0xRRGGBB value per pixel, row by row. */
export interface Bitmap {
  width: number;
  height: number;
  pixels: Uint32Array;
}

/** VP8L takes up to 16384 pixels a side. */
const MAX_SIDE = 16384;

/** The longest backward reference VP8L encodes. */
const MAX_COPY = 4096;

/** The shortest copy worth a backward reference over literals. */
const MIN_COPY = 3;

/** The distance codes of the pixel above, (0, 1), and of the pixel on the left, (1, 0). */
const ABOVE = 1;
const LEFT = 2;

/** The order in which the lengths of the code-length code are written. */
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const GREEN_ALPHABET = 256 + 24;
const COLOR_ALPHABET = 256;
const DISTANCE_ALPHABET = 40;

function zeros(length: number): number[] {
  return Array.from({ length }, () => 0);
}

/** Writes bits least significant first, as VP8L reads them. */
class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private used = 0;

  write(value: number, bits: number): void {
    for (let bit = 0; bit < bits; bit += 1) {
      this.current |= ((value >>> bit) & 1) << this.used;
      this.used += 1;
      if (this.used === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.used = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.used > 0) this.bytes.push(this.current);
    return Uint8Array.from(this.bytes);
  }
}

/** A value of a length or a distance as VP8L codes it: a prefix code and extra bits. */
interface Prefixed {
  code: number;
  bits: number;
  extra: number;
}

function prefixed(value: number): Prefixed {
  const offset = value - 1;
  if (offset < 4) return { code: offset, bits: 0, extra: 0 };
  const high = 31 - Math.clz32(offset);
  const second = (offset >>> (high - 1)) & 1;
  const bits = high - 1;
  return { code: 2 * high + second, bits, extra: offset & ((1 << bits) - 1) };
}

type Token = { literal: number } | { length: number; distance: number };

function matchLength(pixels: Uint32Array, at: number, back: number): number {
  let length = 0;
  while (
    at + length < pixels.length &&
    length < MAX_COPY &&
    pixels[at + length] === pixels[at + length - back]
  ) {
    length += 1;
  }
  return length;
}

/** The image as literals and copies of the pixel above or on the left. */
function tokenize({ width, pixels }: Bitmap): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < pixels.length) {
    const above = at >= width ? matchLength(pixels, at, width) : 0;
    const left = at >= 1 ? matchLength(pixels, at, 1) : 0;
    const length = Math.max(above, left);
    if (length >= MIN_COPY) {
      tokens.push({ length, distance: above >= left ? ABOVE : LEFT });
      at += length;
    } else {
      tokens.push({ literal: pixels[at] ?? 0 });
      at += 1;
    }
  }
  return tokens;
}

/** Huffman code lengths of `counts`, none longer than `limit`. */
function codeLengths(counts: readonly number[], limit: number): number[] {
  for (let floor = 1; ; floor *= 2) {
    const lengths = huffman(counts.map((count) => (count === 0 ? 0 : Math.max(count, floor))));
    if (Math.max(...lengths) <= limit) return lengths;
  }
}

function huffman(counts: readonly number[]): number[] {
  const lengths = counts.map(() => 0);
  type Node = { weight: number; symbols: number[] };
  let nodes: Node[] = counts.flatMap((weight, symbol) =>
    weight > 0 ? [{ weight, symbols: [symbol] }] : [],
  );
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.weight - b.weight);
    const [first, second, ...rest] = nodes as [Node, Node, ...Node[]];
    for (const symbol of [...first.symbols, ...second.symbols]) {
      lengths[symbol] = (lengths[symbol] ?? 0) + 1;
    }
    nodes = [
      ...rest,
      { weight: first.weight + second.weight, symbols: [...first.symbols, ...second.symbols] },
    ];
  }
  return lengths;
}

/** The canonical codes of `lengths`, bit-reversed so they can be written least significant first. */
function canonicalCodes(lengths: readonly number[]): number[] {
  const longest = Math.max(0, ...lengths);
  const perLength = zeros(longest + 1);
  for (const length of lengths) if (length > 0) perLength[length] = (perLength[length] ?? 0) + 1;
  const next = zeros(longest + 1);
  let code = 0;
  for (let length = 1; length <= longest; length += 1) {
    code = (code + (perLength[length - 1] ?? 0)) << 1;
    next[length] = code;
  }
  return lengths.map((length) => {
    if (length === 0) return 0;
    const canonical = next[length] ?? 0;
    next[length] = canonical + 1;
    let reversed = 0;
    for (let bit = 0; bit < length; bit += 1)
      reversed |= ((canonical >>> bit) & 1) << (length - 1 - bit);
    return reversed;
  });
}

/** A prefix code ready to write symbols with. */
interface PrefixCode {
  lengths: number[];
  codes: number[];
}

function writeSymbol(writer: BitWriter, code: PrefixCode, symbol: number): void {
  writer.write(code.codes[symbol] ?? 0, code.lengths[symbol] ?? 0);
}

/**
 * A complete prefix code for `counts`: at least two symbols get a length, so
 * the decoder never meets a one-symbol normal code.
 */
function completeCode(counts: readonly number[], limit: number): PrefixCode {
  const padded = [...counts];
  let used = padded.filter((count) => count > 0).length;
  for (let symbol = 0; used < 2 && symbol < padded.length; symbol += 1) {
    if (padded[symbol] === 0) {
      padded[symbol] = 1;
      used += 1;
    }
  }
  const lengths = codeLengths(padded, limit);
  return { lengths, codes: canonicalCodes(lengths) };
}

/** Writes the prefix code of an alphabet whose symbols occur `counts` times, and returns it. */
function writePrefixCode(writer: BitWriter, counts: readonly number[]): PrefixCode {
  const used = counts.flatMap((count, symbol) => (count > 0 ? [symbol] : []));
  if (used.length <= 2 && used.every((symbol) => symbol < 256)) {
    // A simple code: one symbol takes no bits, two take one bit each.
    const [first = 0, second] = used;
    writer.write(1, 1);
    writer.write(second === undefined ? 0 : 1, 1);
    if (first <= 1) {
      writer.write(0, 1);
      writer.write(first, 1);
    } else {
      writer.write(1, 1);
      writer.write(first, 8);
    }
    if (second !== undefined) writer.write(second, 8);
    const lengths = counts.map(() => 0);
    if (second !== undefined) {
      lengths[first] = 1;
      lengths[second] = 1;
    }
    return { lengths, codes: canonicalCodes(lengths) };
  }

  const code = completeCode(counts, 15);
  // The lengths, with runs of zeros as 17 (3 to 10) and 18 (11 to 138).
  const tokens: { symbol: number; bits: number; extra: number }[] = [];
  for (let symbol = 0; symbol < code.lengths.length;) {
    const length = code.lengths[symbol] ?? 0;
    let run = 0;
    while (length === 0 && run < 138 && code.lengths[symbol + run] === 0) run += 1;
    if (run >= 11) {
      tokens.push({ symbol: 18, bits: 7, extra: run - 11 });
      symbol += run;
    } else if (run >= 3) {
      tokens.push({ symbol: 17, bits: 3, extra: run - 3 });
      symbol += run;
    } else {
      tokens.push({ symbol: length, bits: 0, extra: 0 });
      symbol += 1;
    }
  }
  const lengthCounts = zeros(19);
  for (const { symbol } of tokens) lengthCounts[symbol] = (lengthCounts[symbol] ?? 0) + 1;
  const lengthCode = completeCode(lengthCounts, 7);

  writer.write(0, 1);
  writer.write(CODE_LENGTH_ORDER.length - 4, 4);
  for (const symbol of CODE_LENGTH_ORDER) writer.write(lengthCode.lengths[symbol] ?? 0, 3);
  // Every symbol of the alphabet is given, so no max_symbol.
  writer.write(0, 1);
  for (const { symbol, bits, extra } of tokens) {
    writeSymbol(writer, lengthCode, symbol);
    writer.write(extra, bits);
  }
  return code;
}

function ascii(text: string): number[] {
  return text.split("").map((character) => character.charCodeAt(0));
}

function uint32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** The bitmap as a lossless WebP file. */
export function encodeLosslessWebp(bitmap: Bitmap): Uint8Array {
  const { width, height, pixels } = bitmap;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_SIDE ||
    height > MAX_SIDE ||
    pixels.length !== width * height
  ) {
    throw new Error("encodeLosslessWebp: the bitmap does not have the size it says");
  }

  const tokens = tokenize(bitmap);
  const green = zeros(GREEN_ALPHABET);
  const red = zeros(COLOR_ALPHABET);
  const blue = zeros(COLOR_ALPHABET);
  const alpha = zeros(COLOR_ALPHABET);
  const distance = zeros(DISTANCE_ALPHABET);
  for (const token of tokens) {
    if ("literal" in token) {
      const rgb = token.literal;
      green[(rgb >>> 8) & 0xff] = (green[(rgb >>> 8) & 0xff] ?? 0) + 1;
      red[(rgb >>> 16) & 0xff] = (red[(rgb >>> 16) & 0xff] ?? 0) + 1;
      blue[rgb & 0xff] = (blue[rgb & 0xff] ?? 0) + 1;
      alpha[0xff] = (alpha[0xff] ?? 0) + 1;
    } else {
      const length = 256 + prefixed(token.length).code;
      green[length] = (green[length] ?? 0) + 1;
      const code = prefixed(token.distance).code;
      distance[code] = (distance[code] ?? 0) + 1;
    }
  }

  const writer = new BitWriter();
  writer.write(0x2f, 8);
  writer.write(width - 1, 14);
  writer.write(height - 1, 14);
  // Opaque, version 0, no transform, no color cache, one group of codes.
  writer.write(0, 1);
  writer.write(0, 3);
  writer.write(0, 1);
  writer.write(0, 1);
  writer.write(0, 1);
  const codes = [green, red, blue, alpha, distance].map((counts) =>
    writePrefixCode(writer, counts),
  ) as [PrefixCode, PrefixCode, PrefixCode, PrefixCode, PrefixCode];
  const [greenCode, redCode, blueCode, alphaCode, distanceCode] = codes;
  for (const token of tokens) {
    if ("literal" in token) {
      const rgb = token.literal;
      writeSymbol(writer, greenCode, (rgb >>> 8) & 0xff);
      writeSymbol(writer, redCode, (rgb >>> 16) & 0xff);
      writeSymbol(writer, blueCode, rgb & 0xff);
      writeSymbol(writer, alphaCode, 0xff);
    } else {
      const length = prefixed(token.length);
      writeSymbol(writer, greenCode, 256 + length.code);
      writer.write(length.extra, length.bits);
      const back = prefixed(token.distance);
      writeSymbol(writer, distanceCode, back.code);
      writer.write(back.extra, back.bits);
    }
  }

  const data = writer.finish();
  const padding = data.length % 2;
  return Uint8Array.from([
    ...ascii("RIFF"),
    ...uint32le(4 + 8 + data.length + padding),
    ...ascii("WEBP"),
    ...ascii("VP8L"),
    ...uint32le(data.length),
    ...data,
    ...(padding ? [0] : []),
  ]);
}
