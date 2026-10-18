// The fictitious seed of `vp run db:seed` (docs/specs/data-model.md, "Seed of
// fictitious businesses for development (v2)"). Reference data (categories,
// trades, states, municipalities, localities and zones) ships in the
// migrations; the seed only adds fake businesses to Tizayuca, and activates
// it with a fake contact WhatsApp while it has none. It runs on every deploy
// to dev and stage (never prod), so it only inserts what is missing and never
// changes a row that is already there: running it again changes nothing.
//
// It also says which seeded photos the database names (`photos`): the fake
// businesses with a photo whose row carries their photo key, inserted now or
// before. The caller draws and writes those (./photos.ts) to the media bucket
// of the environment, at the same keys every time, so the bucket ends up with
// exactly one photo per seeded business that has one, and never an object
// that no row names.
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { NOTICE_VERSION } from "../../legal/version.ts";
import type * as schema from "../schema/index.ts";
import {
  businesses,
  businessTrades,
  categories,
  localities,
  municipalities,
  trades,
  zones,
} from "../schema/index.ts";
import { FAKE_BUSINESSES, type FakeBusiness } from "./businesses.ts";
import type { SeededPhoto } from "./photos.ts";

/** Tizayuca, Hidalgo: the only locality the seed fills. */
export const SEED_LOCALITY_CODE = "13069";

/** The fake contact WhatsApp of the locality, while nobody has set a real one. */
export const SEED_CONTACT_WHATSAPP = "7719990100";

/**
 * The notice version the fake consent records name: the current one, read
 * from the single module that declares it (docs/specs/legal-pages.md, "The
 * privacy notice has a stable version declared in a single place"). The card
 * that accepted it on a resubmission first consented to a fictitious earlier
 * version, which must stay below the current one.
 */
export const SEED_NOTICE_VERSION = NOTICE_VERSION;
export const SEED_EARLIER_NOTICE_VERSION = "1";

/** A database or a transaction, with the schema of `withDb`. */
export type SeedDb = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export interface SeedReport {
  /** The name of the seeded locality, from its record. */
  locality: string;
  inserted: number;
  /** Fake businesses left out: their identifier or WhatsApp was already taken. */
  alreadyThere: number;
  /** Whether the seed set the fake contact WhatsApp and turned the locality on. */
  activated: boolean;
  /** The seeded photos the database names, to write to the media bucket. */
  photos: SeededPhoto[];
}

const DAY = 24 * 60 * 60 * 1000;

/** The value of `key` in `map`, or an error that says what is missing. */
function need(map: ReadonlyMap<string, number>, kind: string, key: string): number {
  const id = map.get(key);
  if (id === undefined) {
    throw new Error(
      `db:seed: no ${kind} "${key}" in the database; apply the migrations first (vp run db:migrate)`,
    );
  }
  return id;
}

interface Ids {
  categories: ReadonlyMap<string, number>;
  zones: ReadonlyMap<string, number>;
}

type NewBusiness = typeof businesses.$inferInsert;

function consentRecord(
  fake: FakeBusiness,
  daysAgo: (days: number) => Date,
): Pick<
  NewBusiness,
  | "consentedToNoticeAt"
  | "consentedToNoticeVersion"
  | "reconsentedToNoticeAt"
  | "reconsentedToNoticeVersion"
> {
  const registeredAt = daysAgo(fake.registeredDaysAgo);
  switch (fake.consent) {
    case "before-versioning":
      return { consentedToNoticeAt: registeredAt, consentedToNoticeVersion: null };
    case "reconsented":
      // It first registered against the earlier version, a month before.
      return {
        consentedToNoticeAt: daysAgo(fake.registeredDaysAgo + 30),
        consentedToNoticeVersion: SEED_EARLIER_NOTICE_VERSION,
        reconsentedToNoticeAt: registeredAt,
        reconsentedToNoticeVersion: SEED_NOTICE_VERSION,
      };
    default:
      return { consentedToNoticeAt: registeredAt, consentedToNoticeVersion: SEED_NOTICE_VERSION };
  }
}

function businessRow(fake: FakeBusiness, ids: Ids, now: Date): NewBusiness {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
  return {
    id: fake.id,
    localityCode: SEED_LOCALITY_CODE,
    name: fake.name,
    categoryId: need(ids.categories, "category", fake.category),
    whatsapp: fake.whatsapp,
    zoneId: typeof fake.zone === "string" ? need(ids.zones, "zone", fake.zone) : null,
    zoneOther: typeof fake.zone === "string" ? null : fake.zone.other,
    ...consentRecord(fake, daysAgo),
    whatYouOffer: fake.whatYouOffer ?? null,
    homeDelivery: fake.homeDelivery ?? false,
    landline: fake.landline ?? null,
    address: fake.address ?? null,
    latitude: fake.pin?.latitude ?? null,
    longitude: fake.pin?.longitude ?? null,
    openingHours: fake.openingHours ?? null,
    facebookUrl: fake.facebookUrl ?? null,
    status: fake.status,
    origin: fake.origin ?? "organic",
    registeredAt: daysAgo(fake.registeredDaysAgo),
    publishedAt: fake.publishedDaysAgo === undefined ? null : daysAgo(fake.publishedDaysAgo),
    rejectedAt: fake.rejected ? daysAgo(fake.rejected.daysAgo) : null,
    rejectionReason: fake.rejected?.reason ?? null,
    photoKey: fake.photoKey ?? null,
  };
}

const bySlug = (rows: readonly { slug: string; id: number }[]) =>
  new Map(rows.map(({ slug, id }) => [slug, id]));

/**
 * Inserts the fake businesses that are missing from Tizayuca, with their
 * trades, and gives Tizayuca the fake contact WhatsApp and turns it on only
 * when it has no contact WhatsApp yet: a number someone set, and its active
 * flag, are never touched. A business is missing when its identifier is free
 * and its WhatsApp has no card in the locality; one that is there keeps its
 * data and its trades. All or nothing, in one transaction. `now` anchors the
 * dates.
 */
export async function seed(db: SeedDb, now: Date = new Date()): Promise<SeedReport> {
  return db.transaction(async (tx) => {
    const [locality] = await tx
      .select({ name: municipalities.name })
      .from(localities)
      .innerJoin(municipalities, eq(municipalities.code, localities.code))
      .where(eq(localities.code, SEED_LOCALITY_CODE));
    if (!locality) {
      throw new Error(
        `db:seed: no locality ${SEED_LOCALITY_CODE}; apply the migrations first (vp run db:migrate)`,
      );
    }
    const ids: Ids = {
      categories: bySlug(
        await tx.select({ slug: categories.slug, id: categories.id }).from(categories),
      ),
      zones: bySlug(
        await tx
          .select({ slug: zones.slug, id: zones.id })
          .from(zones)
          .where(eq(zones.localityCode, SEED_LOCALITY_CODE)),
      ),
    };
    const tradeIds = bySlug(await tx.select({ slug: trades.slug, id: trades.id }).from(trades));
    const links = FAKE_BUSINESSES.flatMap((fake) =>
      (fake.trades ?? []).map((slug) => ({
        businessId: fake.id,
        tradeId: need(tradeIds, "trade", slug),
      })),
    );

    const inserted = await tx
      .insert(businesses)
      .values(FAKE_BUSINESSES.map((fake) => businessRow(fake, ids, now)))
      .onConflictDoNothing()
      .returning({ id: businesses.id });
    // Trades only for the businesses inserted now: the seed changes nothing
    // that was already there.
    const insertedIds = new Set(inserted.map(({ id }) => id));
    const newLinks = links.filter(({ businessId }) => insertedIds.has(businessId));
    if (newLinks.length > 0) await tx.insert(businessTrades).values(newLinks).onConflictDoNothing();

    // The fake businesses with a photo whose row still carries their key: a
    // row the seed did not insert (a business that took the WhatsApp first)
    // names no seeded photo, so none is written for it.
    const withPhoto = FAKE_BUSINESSES.flatMap((fake, shade) =>
      fake.photoKey === undefined ? [] : [{ name: fake.name, photoKey: fake.photoKey, shade }],
    );
    const named =
      withPhoto.length === 0
        ? []
        : await tx
            .select({ photoKey: businesses.photoKey })
            .from(businesses)
            .where(
              inArray(
                businesses.photoKey,
                withPhoto.map(({ photoKey }) => photoKey),
              ),
            );
    const namedKeys = new Set(named.map(({ photoKey }) => photoKey));
    const photos = withPhoto.filter(({ photoKey }) => namedKeys.has(photoKey));

    const activated = await tx
      .update(localities)
      .set({ contactWhatsapp: SEED_CONTACT_WHATSAPP, active: true })
      .where(and(eq(localities.code, SEED_LOCALITY_CODE), isNull(localities.contactWhatsapp)))
      .returning({ code: localities.code });

    return {
      locality: locality.name,
      inserted: inserted.length,
      alreadyThere: FAKE_BUSINESSES.length - inserted.length,
      activated: activated.length > 0,
      photos,
    };
  });
}

/** What `vp run db:seed` prints: what it did, and that the data is fake. */
export function seedSummary(report: SeedReport): string[] {
  return [
    `db:seed: ${report.inserted} fictitious businesses inserted in ${report.locality}, ` +
      `${report.alreadyThere} already there.`,
    report.activated
      ? `db:seed: ${report.locality} activated with the fictitious contact WhatsApp ${SEED_CONTACT_WHATSAPP}.`
      : `db:seed: ${report.locality} keeps its contact WhatsApp and its active flag.`,
    "db:seed: FAKE DATA. Made-up names, references and 771999xxxx numbers: " +
      "none is a real business, and none must be shown as one.",
  ];
}
