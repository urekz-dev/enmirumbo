// The limits of an uploaded photo (docs/specs/business-registration.md, "The
// server only accepts the photo if it is a real image of at most 5 MB" and
// "Photos are uploaded through the Images binding, within a ceiling of work
// (v2)"). Its own module, with no imports, because astro.config.mjs reads the
// body limit of the actions from here.

/** The formats a photo may be, as the Images binding and the browsers name them. */
export const PHOTO_FORMATS = ["image/jpeg", "image/png", "image/webp"] as const;

export type PhotoFormat = (typeof PHOTO_FORMATS)[number];

/** The most an uploaded photo may weigh: 5 MB, counted as 5 MiB, so a phone's "5 MB" fits. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * The most pixels an uploaded photo may have: 40 megapixels, what a phone
 * photo in its highest-resolution mode has while it still fits in 5 MB. It is
 * read from the image's header before any work is spent on it.
 */
export const MAX_PHOTO_PIXELS = 40_000_000;

/**
 * The largest body an action reads (`security.actionBodySizeLimit` in
 * astro.config.mjs; Astro's default is 1 MiB). Only the registration's photo
 * needs more than a few kilobytes. It is twice the photo's limit, so a photo
 * somewhat over 5 MB still reaches the action, which answers next to the
 * photo with everything else the owner wrote; a body above it is refused
 * before it is read, from its Content-Length when it has one, and the form
 * comes back with the photo's message and empty, since its fields were never
 * read.
 */
export const ACTION_BODY_LIMIT = 2 * MAX_PHOTO_BYTES;
