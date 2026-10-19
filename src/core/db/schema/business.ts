// The business and everything that hangs from it (docs/specs/data-model.md).
// Every relation that points to a business deletes with it: a permanent
// deletion (ARCO) must leave nothing behind, and test/worker/data-model.test.ts
// fails when a foreign key to `businesses` is not ON DELETE CASCADE.
import { type SQL, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { BUSINESS_ID_PATTERN } from "../../business/id.ts";
import { PHOTO_KEY_PATTERN as SERVER_PHOTO_KEY_PATTERN } from "../../photos/photo.ts";
import { coordinates, matches, oneOf, PHONE_PATTERN, together } from "./checks.ts";
import { categories, trades } from "./catalogue.ts";
import { localities, zones } from "./locality.ts";

export const BUSINESS_STATUSES = ["in_review", "published", "rejected"] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export const BUSINESS_ORIGINS = ["seeded", "organic"] as const;
export type BusinessOrigin = (typeof BUSINESS_ORIGINS)[number];

export const PENDING_EDIT_STATUSES = ["pending", "applied", "discarded", "superseded"] as const;
export type PendingEditStatus = (typeof PENDING_EDIT_STATUSES)[number];

/**
 * What a pending edit does to the card's photo once applied: leave it, put
 * the new photo the edit uploaded in its place, or leave the card without one.
 */
export const PENDING_EDIT_PHOTO_CHANGES = ["keep", "replace", "remove"] as const;
export type PendingEditPhotoChange = (typeof PENDING_EDIT_PHOTO_CHANGES)[number];

export const REPORT_REASONS = ["closed", "not_real", "incorrect_data", "inappropriate"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["pending", "attended"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** A photo key is opaque: never a URL, a scheme, `data:` or a file path. */
const PHOTO_KEY_PATTERN = "^[A-Za-z0-9_-]+$";

/** A management link is stored as the SHA-256 fingerprint of its token. */
const TOKEN_HASH_PATTERN = "^[0-9a-f]{64}$";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const businesses = pgTable(
  "businesses",
  {
    id: text("id").primaryKey(),
    localityCode: char("locality_code", { length: 5 })
      .notNull()
      .references(() => localities.code),

    // Required at registration.
    name: text("name").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    whatsapp: text("whatsapp").notNull(),
    // A catalogue zone, or "Otra" with free text: a business with no zone and
    // with free text is pending normalization by the admin.
    zoneId: integer("zone_id"),
    zoneOther: text("zone_other"),
    // The consent record (LFPDPPP): when, and against which notice version.
    // The version is null only on cards from before versioning.
    consentedToNoticeAt: timestamptz("consented_to_notice_at").notNull(),
    consentedToNoticeVersion: text("consented_to_notice_version"),
    // The last acceptance of a notice version later than the original one.
    reconsentedToNoticeAt: timestamptz("reconsented_to_notice_at"),
    reconsentedToNoticeVersion: text("reconsented_to_notice_version"),

    // Optional at registration.
    whatYouOffer: text("what_you_offer"),
    homeDelivery: boolean("home_delivery").notNull().default(false),
    landline: text("landline"),
    address: text("address"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    openingHours: text("opening_hours"),
    facebookUrl: text("facebook_url"),
    photoKey: text("photo_key").unique(),

    // Search only (docs/specs/data-model.md): the database derives them with
    // `search_normalize` (drizzle/0004_search_normalize.sql) on every write,
    // so no write path can leave them out of sync, and none may set them.
    // Never shown.
    nameNormalized: text("name_normalized")
      .notNull()
      .generatedAlwaysAs((): SQL => sql`search_normalize(${businesses.name})`),
    whatYouOfferNormalized: text("what_you_offer_normalized")
      .notNull()
      .generatedAlwaysAs(
        (): SQL => sql`search_normalize(coalesce(${businesses.whatYouOffer}, ''))`,
      ),

    // Lifecycle. Whether a card is shown depends on its status only;
    // `publishedAt` is the last publication and survives an unpublishing.
    status: text("status", { enum: BUSINESS_STATUSES }).notNull().default("in_review"),
    origin: text("origin", { enum: BUSINESS_ORIGINS }).notNull().default("organic"),
    registeredAt: timestamptz("registered_at").notNull().defaultNow(),
    publishedAt: timestamptz("published_at"),
    rejectedAt: timestamptz("rejected_at"),
    rejectionReason: text("rejection_reason"),
    // The rejection the last resubmission answered: a resubmission clears the
    // rejection above (the 90-day purge reads it) and keeps it here, so the
    // panel labels the card "Reenvío" and says why it was rejected before.
    // Overwritten by the next resubmission; never cleared otherwise.
    previousRejectedAt: timestamptz("previous_rejected_at"),
    previousRejectionReason: text("previous_rejection_reason"),
    // The last unpublishing; never cleared.
    unpublishedAt: timestamptz("unpublished_at"),
    unpublishReason: text("unpublish_reason"),

    // Management link: null until the card is approved, replaced on
    // regeneration, so there is never more than one valid link.
    managementTokenHash: text("management_token_hash").unique(),
    managementTokenCreatedAt: timestamptz("management_token_created_at"),
  },
  (t) => [
    // One card per WhatsApp number within a locality.
    unique("businesses_locality_whatsapp_unique").on(t.localityCode, t.whatsapp),
    // Target of the composite foreign keys of edits and reports.
    unique("businesses_id_locality_unique").on(t.id, t.localityCode),
    // The zone belongs to the same locality as the business.
    foreignKey({
      name: "businesses_zone_fk",
      columns: [t.zoneId, t.localityCode],
      foreignColumns: [zones.id, zones.localityCode],
    }),
    check("businesses_id_check", matches(t.id, BUSINESS_ID_PATTERN)),
    check("businesses_status_check", oneOf(t.status, BUSINESS_STATUSES)),
    check("businesses_origin_check", oneOf(t.origin, BUSINESS_ORIGINS)),
    check("businesses_whatsapp_check", matches(t.whatsapp, PHONE_PATTERN)),
    check("businesses_zone_check", sql`${t.zoneId} IS NOT NULL OR ${t.zoneOther} IS NOT NULL`),
    check(
      "businesses_reconsent_check",
      together(t.reconsentedToNoticeAt, t.reconsentedToNoticeVersion),
    ),
    check("businesses_pin_check", coordinates(t.latitude, t.longitude)),
    check("businesses_photo_key_check", matches(t.photoKey, PHOTO_KEY_PATTERN)),
    check(
      "businesses_rejection_check",
      sql`${together(t.rejectedAt, t.rejectionReason)} AND (${t.rejectedAt} IS NULL OR ${t.status} = 'rejected')`,
    ),
    check(
      "businesses_previous_rejection_check",
      together(t.previousRejectedAt, t.previousRejectionReason),
    ),
    check("businesses_unpublish_check", together(t.unpublishedAt, t.unpublishReason)),
    check(
      "businesses_management_token_check",
      sql`${together(t.managementTokenHash, t.managementTokenCreatedAt)} AND ${matches(t.managementTokenHash, TOKEN_HASH_PATTERN)}`,
    ),
    index("businesses_locality_status_idx").on(t.localityCode, t.status),
    index("businesses_category_idx").on(t.categoryId),
    index("businesses_zone_idx").on(t.zoneId),
    // Trigram indexes (pg_trgm) for the search's `LIKE '%stem%'` on the
    // normalized columns (src/core/search/query.ts).
    index("businesses_name_normalized_trgm_idx").using("gin", t.nameNormalized.op("gin_trgm_ops")),
    index("businesses_what_you_offer_normalized_trgm_idx").using(
      "gin",
      t.whatYouOfferNormalized.op("gin_trgm_ops"),
    ),
  ],
);

/** Trades the admin linked to a business. */
export const businessTrades = pgTable(
  "business_trades",
  {
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    tradeId: integer("trade_id")
      .notNull()
      .references(() => trades.id),
  },
  (t) => [
    primaryKey({ name: "business_trades_pk", columns: [t.businessId, t.tradeId] }),
    index("business_trades_trade_idx").on(t.tradeId),
  ],
);

/**
 * The full content a business sent from its management link, waiting for
 * review: the fields of the form, the change it asks of the photo, and
 * nothing else. Status, origin, trades, publication date, consent record and
 * link fingerprint are not editable and have no column here. A business has
 * at most one pending edit; a newer one supersedes it. A new photo is stored
 * under its own key (`new_photo_key`), which no public page names until the
 * admin applies the edit, and which one edit names at a time: a newer edit
 * that keeps it takes it over. The card's own photo key is never copied here.
 */
export const pendingEdits = pgTable(
  "pending_edits",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    businessId: text("business_id").notNull(),
    localityCode: char("locality_code", { length: 5 }).notNull(),

    name: text("name").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    whatsapp: text("whatsapp").notNull(),
    zoneId: integer("zone_id"),
    zoneOther: text("zone_other"),
    whatYouOffer: text("what_you_offer"),
    homeDelivery: boolean("home_delivery").notNull().default(false),
    landline: text("landline"),
    address: text("address"),
    openingHours: text("opening_hours"),
    facebookUrl: text("facebook_url"),
    photoChange: text("photo_change", { enum: PENDING_EDIT_PHOTO_CHANGES })
      .notNull()
      .default("keep"),
    newPhotoKey: text("new_photo_key").unique(),

    status: text("status", { enum: PENDING_EDIT_STATUSES }).notNull().default("pending"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    resolvedAt: timestamptz("resolved_at"),
    discardReason: text("discard_reason"),
  },
  (t) => [
    foreignKey({
      name: "pending_edits_business_fk",
      columns: [t.businessId, t.localityCode],
      foreignColumns: [businesses.id, businesses.localityCode],
    }).onDelete("cascade"),
    foreignKey({
      name: "pending_edits_zone_fk",
      columns: [t.zoneId, t.localityCode],
      foreignColumns: [zones.id, zones.localityCode],
    }),
    uniqueIndex("pending_edits_one_pending_idx")
      .on(t.businessId)
      .where(sql`${t.status} = 'pending'`),
    check("pending_edits_status_check", oneOf(t.status, PENDING_EDIT_STATUSES)),
    check("pending_edits_whatsapp_check", matches(t.whatsapp, PHONE_PATTERN)),
    check("pending_edits_zone_check", sql`${t.zoneId} IS NOT NULL OR ${t.zoneOther} IS NOT NULL`),
    check("pending_edits_photo_change_check", oneOf(t.photoChange, PENDING_EDIT_PHOTO_CHANGES)),
    // A new photo key only when the edit replaces the photo, always while it
    // waits, and only one the server generates. A superseded edit gives its
    // key up: its photo went to the newer edit, or was deleted.
    check(
      "pending_edits_new_photo_check",
      sql`(${t.newPhotoKey} IS NULL OR ${t.photoChange} = 'replace') AND (${t.status} <> 'pending' OR ${t.photoChange} <> 'replace' OR ${t.newPhotoKey} IS NOT NULL) AND ${matches(t.newPhotoKey, SERVER_PHOTO_KEY_PATTERN)}`,
    ),
    check(
      "pending_edits_resolution_check",
      sql`(${t.status} = 'pending') = (${t.resolvedAt} IS NULL) AND (${t.discardReason} IS NULL OR ${t.status} = 'discarded')`,
    ),
    index("pending_edits_status_created_idx").on(t.status, t.createdAt),
    index("pending_edits_business_status_idx").on(t.businessId, t.status),
  ],
);

/**
 * A resident's notice about a card. No column identifies who sent it: no IP,
 * name, contact or anything derived from them.
 */
export const reports = pgTable(
  "reports",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    businessId: text("business_id").notNull(),
    localityCode: char("locality_code", { length: 5 }).notNull(),
    reason: text("reason", { enum: REPORT_REASONS }).notNull(),
    // Optional; the 300-character bound lives in the form.
    comment: text("comment"),
    status: text("status", { enum: REPORT_STATUSES }).notNull().default("pending"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    attendedAt: timestamptz("attended_at"),
  },
  (t) => [
    foreignKey({
      name: "reports_business_fk",
      columns: [t.businessId, t.localityCode],
      foreignColumns: [businesses.id, businesses.localityCode],
    }).onDelete("cascade"),
    check("reports_reason_check", oneOf(t.reason, REPORT_REASONS)),
    check("reports_status_check", oneOf(t.status, REPORT_STATUSES)),
    check(
      "reports_attended_check",
      sql`(${t.status} = 'attended') = (${t.attendedAt} IS NOT NULL)`,
    ),
    index("reports_business_status_created_idx").on(t.businessId, t.status, t.createdAt),
  ],
);
