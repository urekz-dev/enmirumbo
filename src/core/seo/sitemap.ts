// What `/sitemap.xml` lists (docs/specs/base-layout.md, "The sitemap lists the
// pages that exist, from the database (v2)"): the indexable pages of every
// active locality, under its `/{estado}/{municipio}/`, and the indexable pages
// that belong to no locality. It is read from the database on every request,
// so activating a locality or publishing a card needs no other change. Pure
// apart from the database: src/pages/sitemap.xml.ts turns the paths into
// absolute URLs with SITE_URL.
import { publishedCards } from "../business/card.ts";
import { cardPath } from "../business/card-path.ts";
import { publishedTradePages } from "../business/listing.ts";
import { allCategories } from "../catalogue/pages.ts";
import type { Db } from "../db/client.ts";
import { PRIVACY_NOTICE_PATH, TERMS_PATH } from "../legal/document.ts";
import { localityPath } from "../locality/paths.ts";
import { activeLocalities, type ServedLocality } from "../locality/served.ts";
import { registrationPath } from "../registration/paths.ts";

export interface SitemapEntry {
  /** A path of this site, such as `/hidalgo/tizayuca`. */
  path: string;
  /** When the page last changed, if it is known (a card: its publication date). */
  lastModified?: Date | undefined;
}

/** The pages of one active locality that the sitemap lists. */
export type LocalityPages = (
  locality: ServedLocality,
  db: Db,
) => SitemapEntry[] | Promise<SitemapEntry[]>;

/**
 * Every indexable page of a locality, by kind. A page of a locality that
 * search engines may index adds its kind here when it lands, and nowhere
 * else. Never the search results, the report form, the thank-you pages, the
 * edit mode, a trade page without published cards, a page of a list after
 * the first, or anything unpublished.
 */
export const LOCALITY_PAGES: readonly LocalityPages[] = [
  // The home of the locality.
  (locality) => [{ path: localityPath(locality) }],
  // The registration form (not its thank-you page).
  (locality) => [{ path: registrationPath(locality) }],
  // The listings of the categories, even when empty.
  async (locality, db) =>
    (await allCategories(db)).map((category) => ({ path: localityPath(locality, category.slug) })),
  // The trade pages and trade and zone pages with at least one published card.
  async (locality, db) =>
    (await publishedTradePages(db, locality.code)).map(({ trade, zone }) => ({
      path: localityPath(locality, zone === null ? trade : `${trade}-${zone}`),
    })),
  // The published cards, at their current URL, each with its publication date.
  async (locality, db) =>
    (await publishedCards(db, locality.code)).map((card) => ({
      path: cardPath(locality, card),
      lastModified: card.publishedAt ?? undefined,
    })),
];

/** The indexable pages that belong to no locality: the two legal pages. */
export const SITE_PAGES: readonly SitemapEntry[] = [
  { path: PRIVACY_NOTICE_PATH },
  { path: TERMS_PATH },
];

/** Every entry of the sitemap: the pages of each active locality, then the site's own. */
export async function sitemapEntries(db: Db): Promise<SitemapEntry[]> {
  const localities = await activeLocalities(db);
  const perLocality = await Promise.all(
    localities.map(async (locality) =>
      (await Promise.all(LOCALITY_PAGES.map(async (pages) => pages(locality, db)))).flat(),
    ),
  );
  return [...perLocality.flat(), ...SITE_PAGES];
}

/** Text escaped for an XML element. */
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** A date as the sitemap writes it (W3C date, UTC). */
function sitemapDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The XML of the sitemap. Without an origin (a deployed environment whose
 * SITE_URL gives no base) it is a valid, empty sitemap: never a local
 * address.
 */
export function sitemapXml(origin: string | null, entries: readonly SitemapEntry[]): string {
  const urls =
    origin === null
      ? []
      : entries.map(({ path, lastModified }) => {
          const lastmod =
            lastModified === undefined ? "" : `<lastmod>${sitemapDate(lastModified)}</lastmod>`;
          return `  <url><loc>${escapeXml(`${origin}${path}`)}</loc>${lastmod}</url>\n`;
        });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join("") +
    "</urlset>\n"
  );
}
