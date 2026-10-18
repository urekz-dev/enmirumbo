// The public card of a business (docs/specs/public-directory.md, "Business card
// at its own URL with the registered information and the verified seal",
// "Only what is published is shown" and "An edit awaiting review does not show
// through on any public surface").
//
// Only a published card of the locality of the page is ever read: a business
// in review, rejected, deleted, of another locality or that never existed is
// the same null, so the page answers the same 404 for all of them. The card
// is read from `businesses` alone, never from `pending_edits`, so a proposed
// change cannot show through. Nothing internal is selected: no status,
// origin, dates, consent record, management link or pin. The photo key is
// read only here, for a published card, and only src/lib/media.ts turns it
// into an address ("The photo of an unpublished business is referenced on no
// public surface (v2)").
//
// Binding: the card page and the sitemap run this on HYPERDRIVE, the cached
// binding of public reads, so a change can take up to a minute to show
// ("Public pages may show a change up to a minute late (v2)").
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { businesses, businessTrades, categories, trades, zones } from "../db/schema/index.ts";

/** A trade the admin assigned to the business. */
export interface CardTrade {
  name: string;
  slug: string;
}

/** What the card shows, and nothing else. */
export interface PublishedCard {
  id: string;
  name: string;
  category: { name: string; slug: string };
  /** The catalogue zone, or the free text of "Otra"; null when there is neither. */
  zoneName: string | null;
  /** The slug of the catalogue zone; null when the zone is "Otra". */
  zoneSlug: string | null;
  /** Ten digits, as the database stores it. */
  whatsapp: string;
  whatYouOffer: string | null;
  homeDelivery: boolean;
  /** As the business wrote it: it may not be a number one can dial. */
  landline: string | null;
  /** The address or references the business wrote. */
  address: string | null;
  openingHours: string | null;
  /** The page the business registered (the form's "Facebook" field), as written. */
  pageUrl: string | null;
  /** The trades the admin assigned, in catalogue order. */
  trades: CardTrade[];
  /** The stored photo reference, uninterpreted; null without a photo. */
  photoKey: string | null;
}

/** A text the business left blank is a field it did not register. */
function registered(text: string | null): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

const cardTrades: SQL<CardTrade[]> = sql<CardTrade[]>`coalesce((
  select json_agg(json_build_object('name', ${trades.name}, 'slug', ${trades.slug}) order by ${trades.id})
  from ${businessTrades}
  inner join ${trades} on ${trades.id} = ${businessTrades.tradeId}
  where ${businessTrades.businessId} = ${businesses.id}
), '[]'::json)`;

/**
 * The published card `id` of the locality `localityCode`, with its trades,
 * or null. One query.
 */
export async function publishedCard(
  db: Db,
  localityCode: string,
  id: string,
): Promise<PublishedCard | null> {
  const [row] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      categoryName: categories.name,
      categorySlug: categories.slug,
      zoneName: zones.name,
      zoneSlug: zones.slug,
      zoneOther: businesses.zoneOther,
      whatsapp: businesses.whatsapp,
      whatYouOffer: businesses.whatYouOffer,
      homeDelivery: businesses.homeDelivery,
      landline: businesses.landline,
      address: businesses.address,
      openingHours: businesses.openingHours,
      pageUrl: businesses.facebookUrl,
      trades: cardTrades,
      photoKey: businesses.photoKey,
    })
    .from(businesses)
    .innerJoin(categories, eq(categories.id, businesses.categoryId))
    .leftJoin(zones, eq(zones.id, businesses.zoneId))
    .where(
      and(
        eq(businesses.id, id),
        eq(businesses.localityCode, localityCode),
        eq(businesses.status, "published"),
      ),
    );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: { name: row.categoryName, slug: row.categorySlug },
    zoneName: row.zoneName ?? registered(row.zoneOther),
    zoneSlug: row.zoneSlug,
    whatsapp: row.whatsapp,
    whatYouOffer: registered(row.whatYouOffer),
    homeDelivery: row.homeDelivery,
    landline: registered(row.landline),
    address: registered(row.address),
    openingHours: registered(row.openingHours),
    pageUrl: registered(row.pageUrl),
    trades: row.trades,
    photoKey: row.photoKey,
  };
}

/** What the sitemap needs of a published card: its path, and when it was published. */
export interface PublishedCardEntry {
  id: string;
  name: string;
  publishedAt: Date | null;
}

/**
 * Every published card of the locality `localityCode`, most recently
 * published first, then by name and identifier.
 */
export function publishedCards(db: Db, localityCode: string): Promise<PublishedCardEntry[]> {
  return db
    .select({ id: businesses.id, name: businesses.name, publishedAt: businesses.publishedAt })
    .from(businesses)
    .where(and(eq(businesses.localityCode, localityCode), eq(businesses.status, "published")))
    .orderBy(
      sql`${businesses.publishedAt} DESC NULLS LAST`,
      asc(businesses.name),
      asc(businesses.id),
    );
}
