// The addresses of deleted photos that wait for their purge from the cache of
// the media hostname (docs/specs/data-model.md, "The photo addresses waiting
// for their purge are the only thing kept of a deleted photo (v2)";
// src/core/photos/cache.ts). A photo's objects are gone from R2 once its row
// is here; only a cached copy may remain, and the hourly job purges it and
// forgets the row. Nothing else of the photo or of its card is kept: no key
// of a card, no identifier, no name, and the CHECK lets in nothing but the
// address of a variant of a photo, so the table can never hold anything
// about a business. It points to no other table, so deleting a card never
// waits on it and it outlives the card.
import { sql } from "drizzle-orm";
import { boolean, check, date, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
  DEV_PHOTO_KEY_MARKER,
  DEV_PHOTOS_PREFIX,
  PHOTOS_PREFIX,
  PHOTO_RANDOM_KEY_PATTERN,
  PHOTO_VARIANTS,
} from "../../photos/photo.ts";
import { matches, oneOf } from "./checks.ts";

const VARIANT_FILES = Object.values(PHOTO_VARIANTS)
  .map(({ file }) => file.replace(".", "\\."))
  .join("|");

/** An https photo-variant address with the folder matching its stored key. */
export const PURGE_URL_PATTERN = `^https://[a-z0-9.-]+/(${PHOTOS_PREFIX}${PHOTO_RANDOM_KEY_PATTERN}|${DEV_PHOTOS_PREFIX}${DEV_PHOTO_KEY_MARKER}${PHOTO_RANDOM_KEY_PATTERN})/(${VARIANT_FILES})$`;

export const photoCachePurges = pgTable(
  "photo_cache_purges",
  {
    url: text("url").primaryKey(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("photo_cache_purges_url_check", matches(t.url, PURGE_URL_PATTERN))],
);

/** The bounded hourly continuation of the orphan-photo sweep. */
export const orphanPhotoSweepState = pgTable(
  "orphan_photo_sweep_state",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    // The opaque continuation token R2 returns; it is never logged.
    cursor: text("cursor"),
    // The UTC day on which the last complete pass finished.
    completedOn: date("completed_on", { mode: "string" }),
    // When the current pass first started, kept across bounded and failed runs.
    startedAt: timestamp("started_at", { withTimezone: true }),
    // Null denotes the legacy photos/ scan, so its existing cursor stays valid.
    photoFolder: text("photo_folder"),
  },
  (t) => [
    check("orphan_photo_sweep_state_singleton_check", sql`${t.singleton}`),
    check(
      "orphan_photo_sweep_state_folder_check",
      oneOf(t.photoFolder, [PHOTOS_PREFIX, DEV_PHOTOS_PREFIX]),
    ),
  ],
);
