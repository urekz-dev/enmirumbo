// The audit log of the panel, read-only (docs/specs/admin-review.md, "The
// panel shows the audit log, read-only (v2)"; docs/specs/data-model.md, "The
// audit log records the destructive actions of the admin (v2)").
//
// - `/admin/bitacora` lists the entries of the localities where the user holds
//   `audit_log.view`, newest first, 25 a page, cut by the database with LIMIT
//   and OFFSET. The order is the moment of the action and, for two entries of
//   the same moment, the identifier, so an entry never shows twice or goes
//   missing between two pages.
// - The detail of a card shows its own entries, newest first.
// - Each entry carries only what the table holds: who, when, the locality, the
//   card's identifier, the action and the previous status. Nothing else is
//   read from the card, and a deleted card is only its identifier: the join
//   asks whether it still exists, never for a field of it.
//
// The parameters never fail: a page that cannot be read is page 1, and one
// past the last is no error; it has no rows.
//
// Binding: HYPERDRIVE_FRESH, as all of the panel. Nothing here is logged.
import { desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  type AuditAction,
  adminAuditLog,
  type BusinessStatus,
  businesses,
  localities,
} from "../db/schema/index.ts";
import { LIST_PAGE_SIZE } from "./businesses.ts";

/** Rows a page of the audit log holds, like "Todos los negocios". */
export const AUDIT_PAGE_SIZE = LIST_PAGE_SIZE;

export interface AuditRow {
  id: number;
  occurredAt: Date;
  localityCode: string;
  /** IANA time zone of the entry's locality, in which the screen writes its moment. */
  timeZone: string;
  actor: string;
  action: AuditAction;
  previousStatus: BusinessStatus;
  businessId: string;
  /** Whether the card still exists: a deleted card is shown by its identifier only. */
  cardExists: boolean;
}

export interface AuditQuery {
  /** The localities whose entries the user sees, already narrowed by the locality filter. */
  localityCodes: readonly string[];
  page: number;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  /** The pages of the log, at least 1. */
  pages: number;
  /** The page asked for is past the last. */
  beyond: boolean;
}

const columns = {
  id: adminAuditLog.id,
  occurredAt: adminAuditLog.occurredAt,
  localityCode: adminAuditLog.localityCode,
  timeZone: localities.timeZone,
  actor: adminAuditLog.actor,
  action: adminAuditLog.action,
  previousStatus: adminAuditLog.previousStatus,
  businessId: adminAuditLog.businessId,
  cardExists: sql<boolean>`${businesses.id} is not null`,
};

/** The entries that match `where`, newest first, of a page that starts at `offset`. */
function entryRows(
  db: Db,
  where: SQL | undefined,
  limit: number | null = null,
  offset = 0,
): Promise<AuditRow[]> {
  const query = db
    .select(columns)
    .from(adminAuditLog)
    .innerJoin(localities, eq(localities.code, adminAuditLog.localityCode))
    .leftJoin(businesses, eq(businesses.id, adminAuditLog.businessId))
    .where(where)
    .orderBy(desc(adminAuditLog.occurredAt), desc(adminAuditLog.id));
  return limit === null ? query.offset(offset) : query.limit(limit).offset(offset);
}

/** One page of the audit log of `localityCodes`, newest first. */
export async function auditLogPage(db: Db, query: AuditQuery): Promise<AuditPage> {
  if (query.localityCodes.length === 0)
    return { rows: [], total: 0, pages: 1, beyond: query.page > 1 };
  const where = inArray(adminAuditLog.localityCode, [...query.localityCodes]);
  const [counted] = await db
    .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
    .from(adminAuditLog)
    .where(where);
  const total = counted?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  if (query.page > pages) return { rows: [], total, pages, beyond: true };

  const rows = await entryRows(db, where, AUDIT_PAGE_SIZE, (query.page - 1) * AUDIT_PAGE_SIZE);
  return { rows, total, pages, beyond: false };
}

/** Every entry of the card `businessId`, newest first, for the section of its detail. */
export function cardAuditEntries(db: Db, businessId: string): Promise<AuditRow[]> {
  return entryRows(db, eq(adminAuditLog.businessId, businessId));
}
