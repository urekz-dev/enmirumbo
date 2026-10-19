// Attending a report of a card (docs/specs/admin-review.md, "Marking a report
// as attended, only once" and "Attending a report and resolving a pending
// edit are forms of their details, and their action checks everything again
// (v2)"; docs/specs/data-model.md, "The `Report` model stores a resident's
// notice about a card, with no data about the sender"). The action of the
// "Marcar como atendido" form of the detail of a card (src/actions/index.ts)
// gives this the Access email, the identifier of the page's address, the
// report the form names and its connection. In this order:
//
// 1. The card, and the permission `reports.manage` in its locality
//    (./decision.ts): not found, or forbidden.
// 2. The report the form names, which must be one of that card: a value that
//    is no report number, a report that does not exist and a report of
//    another card are all the same "not found", so the panel cannot tell
//    which reports exist on other cards.
// 3. One conditional write: the report becomes `attended`, with the moment,
//    only while it is still `pending` and of that card. Of two markings at
//    once, or a marking sent again, exactly one writes; the other keeps the
//    first date and is told "Este reporte ya lo habías atendido.".
//
// Attending changes nothing of the card: not its status, its data, its trades
// or its dates. It writes no entry of the audit log (data-model, "The audit
// log records the destructive actions of the admin (v2)"), and it changes
// nothing public, so its confirmation does not say that the site takes a
// minute to show it.
//
// Binding: HYPERDRIVE_FRESH. Nothing here is logged.
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { reports } from "../db/schema/index.ts";
import { formText } from "../forms/text.ts";
import { cardToDecide, type DecisionTarget } from "./decision.ts";

/** The name of the field that says which report the form attends. */
export const REPORT_FIELD = "reporte";

/** A report's number as a form sends it: a positive whole number, or null. */
export function parseReportId(value: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export type AttendOutcome =
  /** Marked now: "Reporte atendido." */
  | { kind: "attended" }
  /** It was attended before: "Este reporte ya lo habías atendido.", the first date kept. */
  | { kind: "already-attended" }
  | { kind: "not-found" }
  | { kind: "forbidden" };

const ATTENDED: AttendOutcome = { kind: "attended" };
const ALREADY_ATTENDED: AttendOutcome = { kind: "already-attended" };
const NOT_FOUND: AttendOutcome = { kind: "not-found" };

/** Marks the report `reportId` of the card `businessId` as attended, if it is still pending. */
export async function attendReport(
  db: Db,
  businessId: string,
  reportId: number,
): Promise<AttendOutcome> {
  const ofTheCard = and(eq(reports.id, reportId), eq(reports.businessId, businessId));
  const [attended] = await db
    .update(reports)
    .set({ status: "attended", attendedAt: sql`now()` })
    .where(and(ofTheCard, eq(reports.status, "pending")))
    .returning({ id: reports.id });
  if (attended !== undefined) return ATTENDED;
  const [report] = await db.select({ id: reports.id }).from(reports).where(ofTheCard);
  return report === undefined ? NOT_FOUND : ALREADY_ATTENDED;
}

/** Where a marking's connection comes from. */
export interface SubmitAttendDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
}

/** A submission of "Marcar como atendido" on the detail of `target`'s card. */
export function submitAttendReport(
  form: FormData,
  target: DecisionTarget,
  deps: SubmitAttendDeps,
): Promise<AttendOutcome> {
  return deps.useDb(async (db) => {
    const access = await cardToDecide(db, target, "reports.manage");
    if (access.kind !== "card") return access;
    const reportId = parseReportId(formText(form, REPORT_FIELD).trim());
    if (reportId === null) return NOT_FOUND;
    return attendReport(db, access.card.id, reportId);
  });
}
