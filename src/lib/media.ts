// Where the business photos of this environment are seen (ADR 0011;
// docs/specs/deployment.md, "Public media live in R2, in one bucket for
// production and one for dev and stage (v2)"; docs/specs/public-directory.md,
// "The photo of an unpublished business is referenced on no public surface
// (v2)").
//
// A deployed environment serves its public media bucket on its media
// hostname, MEDIA_URL, which Cloudflare answers from R2 and its cache without
// invoking the Worker, and which never lists the bucket. Locally MEDIA_URL is
// empty: the local Worker serves the local bucket (Miniflare's, in
// .wrangler/state) on its own origin under /_media/, so `vp run dev`,
// `vp run preview` and the end-to-end tests show the photos the fictitious
// seed writes. That route answers only with ENVIRONMENT `local` and on a
// loopback host, the same gate as the panel's local identity, so in a
// deployed Worker it does not exist.
//
// Pages never build a photo address themselves: they get it from here, from
// the stored key of a published card (src/core/photos/photo.ts).
import {
  PHOTO_CONTENT_TYPE,
  PHOTO_VARIANTS,
  photoUrl,
  type PhotoSource,
  type PhotoVariant,
} from "../core/photos/photo.ts";
import type { ShareImage } from "./share-image.ts";
import { absoluteUrl, parseOrigin, type SiteVars } from "./site-url.ts";

/** The path under which the local Worker serves the local media bucket. */
export const LOCAL_MEDIA_PATH = "/_media";

export interface MediaVars extends SiteVars {
  /** The https origin of the media hostname of the environment; empty locally. */
  MEDIA_URL?: string | undefined;
}

const warned = new Set<string>();

/**
 * The base of every media address: the media hostname of a deployed
 * environment, the local path locally, or null (no photos) in a deployed
 * environment whose MEDIA_URL is not an https origin, which is logged once
 * per isolate.
 */
export function mediaBase(vars: MediaVars): string | null {
  const origin = parseOrigin(vars.MEDIA_URL, ["https:"]);
  if (origin !== null) return origin;
  if (vars.ENVIRONMENT === "local") return LOCAL_MEDIA_PATH;
  const message =
    `photos: MEDIA_URL is missing or is not an https origin in the ` +
    `"${vars.ENVIRONMENT ?? "(none)"}" environment, so pages show no photos.`;
  if (!warned.has(message)) {
    warned.add(message);
    console.error(message);
  }
  return null;
}

/** One variant of a published card's photo, as an `<img>` renders it, or null. */
export function businessPhoto(
  vars: MediaVars,
  photoKey: string | null | undefined,
  variant: PhotoVariant,
): PhotoSource | null {
  return photoUrl(mediaBase(vars), photoKey, variant);
}

/**
 * The absolute address of one variant of a published card's photo, for the
 * share preview and the structured data, or null.
 */
export function absolutePhotoUrl(
  vars: MediaVars,
  photoKey: string | null | undefined,
  variant: PhotoVariant,
): string | null {
  const photo = businessPhoto(vars, photoKey, variant);
  if (photo === null) return null;
  return photo.src.startsWith("/") ? absoluteUrl(vars, photo.src) : photo.src;
}

/**
 * The share image of a published card with a photo: its `full` variant, with
 * its size and "Foto de <nombre>"; null without a photo, and the page then
 * shares its locality's image (public-directory, "The card looks good when
 * shared over WhatsApp or Facebook").
 */
export function photoShareImage(
  vars: MediaVars,
  card: { name: string; photoKey: string | null },
): ShareImage | null {
  const url = absolutePhotoUrl(vars, card.photoKey, "full");
  if (url === null) return null;
  const { width, height } = PHOTO_VARIANTS.full;
  return { src: url, width, height, type: PHOTO_CONTENT_TYPE, alt: `Foto de ${card.name}` };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface LocalMediaEnv {
  ENVIRONMENT?: string | undefined;
  MEDIA: R2Bucket;
}

/**
 * The local Worker's answer to a request for an object of the local media
 * bucket, `/_media/<object key>`, as the media hostname would give it; or
 * null when the request is not one: outside the local environment, off a
 * loopback host, or not under /_media/. An object that does not exist, and
 * the bare prefix or any other "folder" (there is no listing), answer 404.
 */
export async function serveLocalMedia(
  request: Request,
  env: LocalMediaEnv,
): Promise<Response | null> {
  if (env.ENVIRONMENT !== "local") return null;
  const url = new URL(request.url);
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.pathname !== LOCAL_MEDIA_PATH && !url.pathname.startsWith(`${LOCAL_MEDIA_PATH}/`)) {
    return null;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(LOCAL_MEDIA_PATH.length + 1));
  } catch {
    return notFound();
  }
  if (key === "" || key.endsWith("/")) return notFound();
  const head = request.method === "HEAD";
  const object = head ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  if (object === null) return notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Content-Length", String(object.size));
  const body = !head && "body" in object ? (object as R2ObjectBody).body : null;
  return new Response(body, { headers });
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
