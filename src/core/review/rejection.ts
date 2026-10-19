// Rejecting a registration (docs/specs/admin-review.md, "Rejecting requires a
// reason, stores it with its date and offers to notify by WhatsApp", "A
// transition is only applied to a registration that is still in review", "A
// rejection reason is never silently trimmed (v2)" and "The destructive
// actions of the admin write to the audit log with the Access identity (v2)";
// docs/specs/data-model.md, "Review status, origin and lifecycle timestamps"
// and "The audit log records the destructive actions of the admin (v2)"). The
// action of the detail's form (src/actions/index.ts) gives this the Access
// email, the identifier of the page's address and its connection. In this
// order:
//
// 1. The card, and the permission `businesses.review` in its locality
//    (./decision.ts): not found, or forbidden.
// 2. A card no longer in review was already resolved, and nothing is written.
// 3. The reason (./reason.ts): required, at most 500 characters, never
//    trimmed to fit. Errors, and nothing is written; the page shows the
//    reason again as it was typed.
// 4. One transaction: the card becomes `rejected`, with the moment (from
//    which the 90-day purge counts) and the reason, only while it is still in
//    review (a conditional update), and the audit log gets its entry: the
//    admin's Access email, the locality, the card's identifier, `reject` and
//    the previous status, `in_review`, never a copy of the card's data. If
//    the entry cannot be written, nothing is: the rejection is not reported
//    as done. Nothing of what the business captured changes, and a rejected
//    card shows on no public page.
//
// Binding: HYPERDRIVE_FRESH. Nothing here is logged.
import { and, eq, sql } from "drizzle-orm";
import { permissionsOf } from "../access/queries.ts";
import { isBusinessId } from "../business/id.ts";
import type { Db } from "../db/client.ts";
import { adminAuditLog, businesses } from "../db/schema/index.ts";
import { actorOf, cardToDecide, type DecisionTarget } from "./decision.ts";
import { type ReasonError, readReason } from "./reason.ts";
import { opensCard } from "./scope.ts";

/** The name of the field of the reason. */
export const REJECTION_FIELD = "motivo";

export type RejectionOutcome =
  | { kind: "rejected" }
  | { kind: "resolved" }
  | { kind: "invalid"; error: ReasonError }
  | { kind: "not-found" }
  | { kind: "forbidden" };

const REJECTED: RejectionOutcome = { kind: "rejected" };
const RESOLVED: RejectionOutcome = { kind: "resolved" };
const NOT_FOUND: RejectionOutcome = { kind: "not-found" };

/**
 * Rejects the card `businessId` with `reason`, if it is still in review, and
 * writes its entry of the audit log with `email`, in one transaction.
 */
export function rejectRegistration(
  db: Db,
  businessId: string,
  reason: string,
  email: string,
): Promise<RejectionOutcome> {
  return db.transaction(async (tx) => {
    const [rejected] = await tx
      .update(businesses)
      .set({ status: "rejected", rejectedAt: sql`now()`, rejectionReason: reason })
      .where(and(eq(businesses.id, businessId), eq(businesses.status, "in_review")))
      .returning({ localityCode: businesses.localityCode });
    if (rejected === undefined) {
      const [card] = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(eq(businesses.id, businessId));
      return card === undefined ? NOT_FOUND : RESOLVED;
    }
    await tx.insert(adminAuditLog).values({
      localityCode: rejected.localityCode,
      businessId,
      actor: actorOf(email),
      action: "reject",
      previousStatus: "in_review",
    });
    return REJECTED;
  });
}

/** Where a rejection's connection comes from. */
export interface SubmitRejectionDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
}

/** A submission of the rejection form of `target`, from what arrived to what the admin is told. */
export function submitRejection(
  form: FormData,
  target: DecisionTarget,
  deps: SubmitRejectionDeps,
): Promise<RejectionOutcome> {
  return deps.useDb(async (db) => {
    const access = await cardToDecide(db, target, "businesses.review");
    if (access.kind !== "card") return access;
    if (access.card.status !== "in_review") return RESOLVED;
    const reading = readReason(form, REJECTION_FIELD);
    if (reading.kind === "invalid") return reading;
    return rejectRegistration(db, access.card.id, reading.reason, target.email);
  });
}

/** What the confirmation of a rejection shows: the notice, with the reason stored. */
export interface RejectionNotice {
  name: string;
  whatsapp: string;
  reason: string;
  localityCode: string;
}

/**
 * The notice of the rejection of the card `target` names, for its
 * confirmation; or null when there is nothing to confirm, so the page goes
 * back to the detail: no card, a card the user may not review, a card that
 * is not rejected, or one with no reason (a message with a blank reason is a
 * wrong WhatsApp to a third party). The reason is the one stored, never one
 * an address carries.
 */
export async function rejectionNotice(
  db: Db,
  target: DecisionTarget,
): Promise<RejectionNotice | null> {
  if (!isBusinessId(target.businessId)) return null;
  const [card] = await db
    .select({
      name: businesses.name,
      whatsapp: businesses.whatsapp,
      status: businesses.status,
      reason: businesses.rejectionReason,
      localityCode: businesses.localityCode,
    })
    .from(businesses)
    .where(eq(businesses.id, target.businessId));
  if (card === undefined || card.status !== "rejected" || !card.reason?.trim()) return null;
  const granted = await permissionsOf(db, target.email, card.localityCode);
  if (!opensCard(granted) || !granted.has("businesses.review")) return null;
  return {
    name: card.name,
    whatsapp: card.whatsapp,
    reason: card.reason,
    localityCode: card.localityCode,
  };
}
