// The image of the share preview (docs/specs/base-layout.md, "Each locality has
// its own share image, one static image per locality (v2)"): the picture
// WhatsApp, Facebook and other apps show next to a shared link.
//
// Each locality has one static 1200×630 PNG with the wordmark and
// "{municipio}, {estado}", at src/assets/share/{estado}/{municipio}.png, named
// by its slugs: adding a locality's image is adding that file, never code.
// A locality without one, and every page outside a locality, shares the
// generic image, src/assets/share/enmirumbo.png, which shows the wordmark
// alone and names no locality. The build serves them as hashed static
// assets under /_astro/; the README says how they were made.
import type { ImageMetadata } from "astro";
import type { LocalityRef } from "../core/locality/paths.ts";
import type { ServedLocality } from "../core/locality/served.ts";
import { SITE_NAME } from "./site.ts";

// Both imports go through import.meta.glob, typed with Astro's ImageMetadata:
// a plain `import x from "….png"` takes its type from the generated
// .astro/types.d.ts, which `vp check` in CI does not have.
const LOCALITY_IMAGES = import.meta.glob<ImageMetadata>("../assets/share/*/*.png", {
  eager: true,
  import: "default",
});
const GENERIC_IMAGES = import.meta.glob<ImageMetadata>("../assets/share/enmirumbo.png", {
  eager: true,
  import: "default",
});
const generic: ImageMetadata = requireImage(GENERIC_IMAGES, "../assets/share/enmirumbo.png");

function requireImage(images: Record<string, ImageMetadata>, key: string): ImageMetadata {
  const image = images[key];
  if (image === undefined) throw new Error(`share-image: ${key} is missing`);
  return image;
}

/** The key of a locality's image in LOCALITY_IMAGES. */
function imageKey(locality: LocalityRef): string {
  return `../assets/share/${locality.state.slug}/${locality.slug}.png`;
}

export interface ShareImage {
  /** The path the build serves it at; for a card's photo, its absolute address. */
  src: string;
  width: number;
  height: number;
  /** Its media type, such as `image/png`. */
  type: string;
  /** What it shows, for those who cannot see it. */
  alt: string;
}

type Shared = LocalityRef & Pick<ServedLocality, "name"> & { state: { name: string } };

function shareImageOf(image: ImageMetadata, alt: string): ShareImage {
  return {
    src: image.src,
    width: image.width,
    height: image.height,
    type: `image/${image.format}`,
    alt,
  };
}

/**
 * The share image of a page: its locality's, or the generic one. The alt text
 * names the brand alone, and the locality only as the descriptor, as the
 * image does.
 */
export function shareImage(locality: Shared | undefined): ShareImage {
  const own = locality === undefined ? undefined : LOCALITY_IMAGES[imageKey(locality)];
  if (locality === undefined || own === undefined) return shareImageOf(generic, SITE_NAME);
  return shareImageOf(
    own,
    `${SITE_NAME}, el directorio de negocios de ${locality.name}, ${locality.state.name}`,
  );
}
