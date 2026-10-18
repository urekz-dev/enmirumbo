// A submission of the report form, from what arrived to what the resident is
// told (docs/specs/public-directory.md, "The server validates the report's
// reason and comment, and keeps the draft without a cookie (v2)", "The
// report submission confirms in plain Spanish and gives nothing away",
// "Report anti-abuse without captcha: honeypot, per-IP quota and pending cap
// per business", "The report's per-IP quota is counted in the quota counter
// (v2)" and "No data is requested or stored about the reporter"). The action
// of the form (src/actions/report.ts) only finds the card the page names and
// gives this its connection and its quota. In this order:
//
// 1. The trap field: a bot is told the report was received, and nothing
//    else happens, not even a connection to the database.
// 2. The reason and the comment: an error, and nothing else happens.
// 3. The card must be a published card of the locality; otherwise the same
//    "not found" as for an identifier that never existed. It comes before
//    the quota, so asking about cards that do not exist spends no quota.
// 4. The per-IP quota, checked and taken in one step by its counter.
// 5. The report, saved unless its card is at the cap (./save.ts). A card at
//    the cap is told the same as a saved report.
//
// Nothing here writes the comment, the address or anything about the card to
// the log: a failure is logged by its kind alone.
import type { Db } from "../db/client.ts";
import { failureKind } from "../db/failure.ts";
import type { QuotaDecision } from "../quota/window.ts";
import { saveReport, reportableCard } from "./save.ts";
import { readReportSubmission, type ReportFormError } from "./submission.ts";

/** The card a submission reports, as the page's address names it. */
export interface ReportTarget {
  localityCode: string;
  businessId: string;
}

export interface SubmitReportDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
  /** Counts this submission in the per-IP quota of the reports, and says whether it may go on. */
  takeQuota: () => Promise<QuotaDecision>;
}

/**
 * What the resident is told: the report was received (saved, caught by the
 * trap or past the cap, which must look the same); the card is not one that
 * can be reported; or the form comes back with an error.
 */
export type SubmitReportOutcome =
  | { kind: "received" }
  | { kind: "not-found" }
  | { kind: "error"; error: ReportFormError };

const RECEIVED: SubmitReportOutcome = { kind: "received" };
const NOT_FOUND: SubmitReportOutcome = { kind: "not-found" };

/** The kind of a failure, for the log (src/core/db/failure.ts), shared with the registration. */
export { failureKind };

export async function submitReport(
  form: FormData,
  target: ReportTarget,
  deps: SubmitReportDeps,
): Promise<SubmitReportOutcome> {
  const submission = readReportSubmission(form);
  if (submission.kind === "trap") return RECEIVED;
  if (submission.kind === "invalid") return { kind: "error", error: submission.error };
  try {
    return await deps.useDb(async (db) => {
      const card = await reportableCard(db, target.localityCode, target.businessId);
      if (card === null) return NOT_FOUND;
      const quota = await deps.takeQuota();
      if (!quota.allowed) return { kind: "error", error: "quota" };
      const saved = await saveReport(db, {
        localityCode: target.localityCode,
        businessId: target.businessId,
        reason: submission.reason,
        comment: submission.comment,
      });
      return saved === "not-found" ? NOT_FOUND : RECEIVED;
    });
  } catch (error) {
    console.error(`report: a report could not be saved (${failureKind(error)})`);
    return { kind: "error", error: "server" };
  }
}
