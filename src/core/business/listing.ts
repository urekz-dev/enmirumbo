// What a listing card shows (docs/specs/public-directory.md, "The listing card
// brings the essentials and WhatsApp without extra taps"), and nothing else:
// the listings by category, by trade and by trade and zone, and the search
// results, all render src/components/ListingCard.astro from this shape.
//
// The listings read here (public-directory, "Category listing at a clean URL
// with the catalogue slug", "Only what is published is shown", "Zone filter in
// the listing, without client-side JavaScript", "Indexable trade page at the
// root, generated from the closed catalogue" and "Indexable trade and zone
// page"): only published cards of the locality, from `businesses` alone, so a
// pending edit never shows through, and nothing internal is selected.
//
// Binding: the listings and the sitemap run these on HYPERDRIVE, the cached
// binding of public reads, so a change can take up to a minute to show
// ("Public pages may show a change up to a minute late (v2)").
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { businesses, businessTrades, categories, trades, zones } from "../db/schema/index.ts";
import { PAGE_SIZE, pageSlice } from "../pagination.ts";

export interface ListingBusiness {
  id: string;
  name: string;
  /** The business's own category, for the placeholder and the analytics event. */
  categorySlug: string;
  /** The catalogue zone, or the free text of "Otra"; null when there is neither. */
  zoneName: string | null;
  /** Null when the zone is "Otra" pending normalization. */
  zoneSlug: string | null;
  homeDelivery: boolean;
  whatsapp: string;
  /**
   * The stored photo reference of a published card, uninterpreted. Only
   * src/lib/media.ts turns it into an address, and only when it is a key
   * the server generated (ADR 0011).
   */
  photoKey: string | null;
}

/**
 * The published cards a listing lists, in one locality: those of a category
 * or those the admin gave a trade, whatever their category.
 */
export type ListingScope = { localityCode: string } & (
  | { categoryId: number }
  | { tradeId: number }
);

/** What narrows a listing: the cards of its scope in one zone of the locality. */
export type ZonedScope = ListingScope & { zoneId: number | null };

/** The published cards of the scope, without the zone. */
function inScope(scope: ListingScope): SQL | undefined {
  const scoped =
    "categoryId" in scope
      ? eq(businesses.categoryId, scope.categoryId)
      : sql`exists (select 1 from ${businessTrades} where ${businessTrades.businessId} = ${businesses.id} and ${businessTrades.tradeId} = ${scope.tradeId})`;
  return and(
    eq(businesses.localityCode, scope.localityCode),
    eq(businesses.status, "published"),
    scoped,
  );
}

/** One page of a listing, and whether another page follows it. */
export interface ListingRows {
  businesses: ListingBusiness[];
  hasNext: boolean;
}

/**
 * Page `page` of the published cards of `scope`, in the listings' order: most
 * recently published first, then by name, then by identifier, so the order
 * never changes between two requests. One query, which reads one card more
 * than a page holds to tell whether a next page exists.
 */
export async function listedBusinesses(
  db: Db,
  scope: ZonedScope,
  page: number,
): Promise<ListingRows> {
  const { limit, offset } = pageSlice(page);
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      categorySlug: categories.slug,
      zoneName: sql<
        string | null
      >`coalesce(${zones.name}, nullif(btrim(${businesses.zoneOther}), ''))`,
      zoneSlug: zones.slug,
      homeDelivery: businesses.homeDelivery,
      whatsapp: businesses.whatsapp,
      photoKey: businesses.photoKey,
    })
    .from(businesses)
    .innerJoin(categories, eq(categories.id, businesses.categoryId))
    .leftJoin(zones, eq(zones.id, businesses.zoneId))
    .where(
      and(inScope(scope), scope.zoneId === null ? undefined : eq(businesses.zoneId, scope.zoneId)),
    )
    .orderBy(
      sql`${businesses.publishedAt} DESC NULLS LAST`,
      asc(businesses.name),
      asc(businesses.id),
    )
    .limit(limit)
    .offset(offset);
  return { businesses: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

/** Whether the scope has any published card: one query, which reads one row at most. */
export async function hasListedBusinesses(db: Db, scope: ListingScope): Promise<boolean> {
  const rows = await db
    .select({ one: sql`1` })
    .from(businesses)
    .where(inScope(scope))
    .limit(1);
  return rows.length > 0;
}

/** A catalogue zone of the locality that a listing can be narrowed to. */
export interface ListingZone {
  name: string;
  slug: string;
}

/**
 * The zones of the locality with at least one published card of the scope,
 * in catalogue order: the options of the zone filter and of the trades' zone
 * navigation, none of which leads to an empty page. A card of the zone
 * "Otra" brings no option, since no filter can name it.
 */
export async function listedZones(db: Db, scope: ListingScope): Promise<ListingZone[]> {
  const rows = await db
    .selectDistinct({ id: zones.id, name: zones.name, slug: zones.slug })
    .from(zones)
    .innerJoin(businesses, eq(businesses.zoneId, zones.id))
    .where(inScope(scope))
    .orderBy(asc(zones.id));
  return rows.map(({ name, slug }) => ({ name, slug }));
}

/** A trade page with published cards: the trade alone, or the trade in a zone. */
export interface TradePage {
  trade: string;
  /** The zone's slug, or null for the page of the whole trade. */
  zone: string | null;
}

/**
 * The trade pages and the trade and zone pages of the locality with at least
 * one published card, by trade slug and then zone: the ones the sitemap
 * lists. One query, whatever the size of the catalogues.
 */
export async function publishedTradePages(db: Db, localityCode: string): Promise<TradePage[]> {
  const rows = await db
    .selectDistinct({ trade: trades.slug, zone: zones.slug })
    .from(businessTrades)
    .innerJoin(trades, eq(trades.id, businessTrades.tradeId))
    .innerJoin(businesses, eq(businesses.id, businessTrades.businessId))
    .leftJoin(zones, eq(zones.id, businesses.zoneId))
    .where(and(eq(businesses.localityCode, localityCode), eq(businesses.status, "published")))
    .orderBy(asc(trades.slug), sql`${zones.slug} ASC NULLS FIRST`);
  const pages: TradePage[] = [];
  for (const { trade, zone } of rows) {
    if (pages.at(-1)?.trade !== trade) pages.push({ trade, zone: null });
    if (zone !== null) pages.push({ trade, zone });
  }
  return pages;
}
