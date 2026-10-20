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
import { BUSINESS_ID_ALPHABET } from "../../business/id.ts";
import { PHOTO_KEY_LENGTH, PHOTO_VARIANTS } from "../../photos/photo.ts";
import { matches } from "./checks.ts";

const VARIANT_FILES = Object.values(PHOTO_VARIANTS)
  .map(({ file }) => file.replace(".", "\\."))
  .join("|");

/** An https address of one variant of a photo: `https://<host>/photos/<key>/<variant>.webp`. */
export const PURGE_URL_PATTERN = `^https://[a-z0-9.-]+/photos/[${BUSINESS_ID_ALPHABET}]{${PHOTO_KEY_LENGTH}}/(${VARIANT_FILES})$`;

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
  },
  (t) => [check("orphan_photo_sweep_state_singleton_check", sql`${t.singleton}`)],
);
