// "Todos los negocios", the panel's entry to every card
// (docs/specs/admin-review.md, "'Todos los negocios' view with the status in
// sight and an entry to the detail", "The listing is filtered by status
// without leaving the view", "The listing is cut into pages and does not
// degrade when there are many records", "The listing inherits the panel's
// access, no-indexing and minimal data exposure" and "The listing searches by
// name or WhatsApp (v2)").
//
// - Every card of the localities the user sees, whatever its status, the
//   most recently registered first, then by identifier, so a card never
//   shows twice or goes missing between two pages. The list's clock is the
//   registration date (a resubmission restarts it), the date each row shows;
//   the queue has its own.
// - Only what recognizes a card and leads to it is read: name, zone,
//   registration date, status and whether it came back from an unpublishing.
//   No number, address, photo, reason or consent record.
// - 25 rows a page, cut by the database: the count is one query and the page
//   another, with LIMIT and OFFSET, so the page never grows with the
//   database.
// - The parameters never fail: an `estado`, `pagina` or `q` that cannot be
//   read, empty or repeated, is the default (`Todos`, page 1, no search). A
//   page past the last is no error: it has no rows.
//
// Binding: HYPERDRIVE_FRESH, as all of the panel. Nothing here is logged.
import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { nationalNumber } from "../business/contact.ts";
import type { ShowsZone } from "../catalogue/zone-names.ts";
import type { Db } from "../db/client.ts";
import { type BusinessStatus, businesses, localities, zones } from "../db/schema/index.ts";
import { displayedQuery } from "../search/display.ts";
import { MAX_QUERY_LENGTH, MAX_TERMS, normalizeText } from "../search/normalize.ts";
import { STATUS_PARAMS, type StatusFilter } from "./paths.ts";
import { cameFromUnpublishing } from "./queue.ts";

/** Rows a page of the list holds, by the specification. */
export const LIST_PAGE_SIZE = 25;

/**
 * The furthest page that can be asked for: 25 million cards nobody will
 * reach, and an offset that stays an integer PostgreSQL takes. A larger
 * number is read as this page, past the last, with no rows.
 */
export const MAX_LIST_PAGE = 1_000_000;

/** The status filter of `estado` values: one of its values, or "Todos". */
export function parseStatusFilter(values: readonly string[]): StatusFilter {
  if (values.length !== 1) return "all";
  const match = (Object.entries(STATUS_PARAMS) as [BusinessStatus, string][]).find(
    ([, param]) => param === values[0],
  );
  return match?.[0] ?? "all";
}

/** The page of `pagina` values: a positive whole number, or page 1 for anything else. */
export function parseListPage(values: readonly string[]): number {
  if (values.length !== 1) return 1;
  const [value = ""] = values;
  if (!/^[1-9][0-9]*$/.test(value)) return 1;
  return Math.min(value.length > 7 ? MAX_LIST_PAGE : Number(value), MAX_LIST_PAGE);
}

/**
 * What the admin searched, as the search box shows it again: the one `q`
 * value, without invisible characters and cut to 80 characters; empty for no
 * search or a repeated one.
 */
export function parseSearch(values: readonly string[]): string {
  if (values.length !== 1) return "";
  return displayedQuery(values[0] ?? "").field;
}

/**
 * The cards a search finds: those whose name has every word typed (up to
 * four), ignoring capitals, accents and punctuation as the directory's
 * search does, and the card whose WhatsApp is the number typed, read as the
 * registration reads it (ten digits, with or without the country code,
 * spaces or hyphens). A search with nothing to look for finds nothing.
 */
export function searchCondition(query: string): SQL {
  const words = normalizeText(query)
    .slice(0, MAX_QUERY_LENGTH)
    .split(" ")
    .filter((word) => word !== "")
    .slice(0, MAX_TERMS);
  const byName =
    words.length === 0
      ? undefined
      : and(...words.map((word) => like(businesses.nameNormalized, `%${word}%`)));
  const number = nationalNumber(query);
  const byWhatsapp = number === null ? undefined : eq(businesses.whatsapp, number);
  return or(byName, byWhatsapp) ?? sql`false`;
}

export interface ListRow extends ShowsZone {
  id: string;
  localityCode: string;
  timeZone: string;
  name: string;
  registeredAt: Date;
  status: BusinessStatus;
  /** In review because the admin unpublished it, as the queue says. */
  unpublished: boolean;
}

export interface ListQuery {
  /** The localities whose cards the user sees, already narrowed by the locality filter. */
  localityCodes: readonly string[];
  status: StatusFilter;
  /** What was searched; empty for no search. */
  query: string;
  page: number;
}

export interface ListPage {
  rows: ListRow[];
  /** The cards of the list being viewed: its filters and its search, every page. */
  total: number;
  /** The pages of the list, at least 1. */
  pages: number;
  /** The page asked for is past the last. */
  beyond: boolean;
}

/** One page of "Todos los negocios". */
export async function businessesPage(db: Db, list: ListQuery): Promise<ListPage> {
  if (list.localityCodes.length === 0)
    return { rows: [], total: 0, pages: 1, beyond: list.page > 1 };
  const where = and(
    inArray(businesses.localityCode, [...list.localityCodes]),
    list.status === "all" ? undefined : eq(businesses.status, list.status),
    list.query === "" ? undefined : searchCondition(list.query),
  );
  const [counted] = await db
    .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
    .from(businesses)
    .where(where);
  const total = counted?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  if (list.page > pages) return { rows: [], total, pages, beyond: true };

  const rows = await db
    .select({
      id: businesses.id,
      localityCode: businesses.localityCode,
      timeZone: localities.timeZone,
      name: businesses.name,
      registeredAt: businesses.registeredAt,
      unpublishedAt: businesses.unpublishedAt,
      status: businesses.status,
      zoneSlug: zones.slug,
      zoneName: sql<
        string | null
      >`coalesce(${zones.name}, nullif(btrim(${businesses.zoneOther}), ''))`,
    })
    .from(businesses)
    .innerJoin(localities, eq(localities.code, businesses.localityCode))
    .leftJoin(zones, eq(zones.id, businesses.zoneId))
    .where(where)
    .orderBy(desc(businesses.registeredAt), desc(businesses.id))
    .limit(LIST_PAGE_SIZE)
    .offset((list.page - 1) * LIST_PAGE_SIZE);
  return {
    rows: rows.map(({ unpublishedAt, ...row }) => ({
      ...row,
      unpublished:
        row.status === "in_review" && cameFromUnpublishing(row.registeredAt, unpublishedAt),
    })),
    total,
    pages,
    beyond: false,
  };
}
