// Unpublishing a card (docs/specs/admin-review.md, "Unpublish a published
// card, with a mandatory reason and conditioned on the status", "On
// unpublishing, an offer is made to notify the business by WhatsApp", "The
// destructive actions of the admin write to the audit log with the Access
// identity (v2)" and "Unpublishing, a new link and the permanent deletion are
// forms of the detail, and their actions check everything again (v2)";
// docs/specs/data-model.md, "The business stores the trace of its
// unpublishing" and "The audit log records the destructive actions of the
// admin (v2)"). The action of the detail's form (src/actions/index.ts) gives
// this the Access email, the identifier of the page's address and its
// connection. In this order:
//
// 1. The card, and the permission `businesses.unpublish` in its locality
//    (./decision.ts): not found, or forbidden.
// 2. A card that is not published: "Esta ficha ya no estaba publicada.", and
//    nothing is written.
// 3. The reason (./reason.ts): required, at most 500 characters, never
//    trimmed to fit, since it travels to the business. Errors, and nothing is
//    written; the page shows the reason again as it was typed.
// 4. One transaction: the card goes back to `in_review` with the moment and
//    the reason of this unpublishing, only while it is still published (a
//    conditional update, so of two unpublishings at once exactly one
//    applies), and the audit log gets its entry: the admin's Access email,
//    the locality, the card's identifier, `unpublish` and `published`, never
//    a copy of the card's data. If the entry cannot be written, nothing is.
//
// Unpublishing destroys nothing: the trades, the zone, the origin, the date
// of the last publication, the management link's fingerprint, the earlier
// rejection, the pending edit and the reports stay as they were. The card
// enters the queue at this moment, labelled "Ya estaba publicada, la
// despublicaste" (./queue.ts); its pending edit comes back once it is
// published again, which also gives it a new link (./approval.ts). The link
// it had opens nothing while it is not published.
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
export const UNPUBLISH_FIELD = "motivo";

export type UnpublishOutcome =
  | { kind: "unpublished" }
  /** The card is not published: "Esta ficha ya no estaba publicada." */
  | { kind: "not-published" }
  | { kind: "invalid"; error: ReasonError }
  | { kind: "not-found" }
  | { kind: "forbidden" };

const UNPUBLISHED: UnpublishOutcome = { kind: "unpublished" };
const NOT_PUBLISHED: UnpublishOutcome = { kind: "not-published" };
const NOT_FOUND: UnpublishOutcome = { kind: "not-found" };

/**
 * Unpublishes the card `businessId` with `reason`, if it is still published,
 * and writes its entry of the audit log with `email`, in one transaction.
 */
export function unpublishCard(
  db: Db,
  businessId: string,
  reason: string,
  email: string,
): Promise<UnpublishOutcome> {
  return db.transaction(async (tx) => {
    const [unpublished] = await tx
      .update(businesses)
      .set({ status: "in_review", unpublishedAt: sql`now()`, unpublishReason: reason })
      .where(and(eq(businesses.id, businessId), eq(businesses.status, "published")))
      .returning({ localityCode: businesses.localityCode });
    if (unpublished === undefined) {
      const [card] = await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(eq(businesses.id, businessId));
      return card === undefined ? NOT_FOUND : NOT_PUBLISHED;
    }
    await tx.insert(adminAuditLog).values({
      localityCode: unpublished.localityCode,
      businessId,
      actor: actorOf(email),
      action: "unpublish",
      previousStatus: "published",
    });
    return UNPUBLISHED;
  });
}

/** Where an unpublishing's connection comes from. */
export interface SubmitUnpublishDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
}

/** A submission of the unpublishing form of `target`, from what arrived to what the admin is told. */
export function submitUnpublish(
  form: FormData,
  target: DecisionTarget,
  deps: SubmitUnpublishDeps,
): Promise<UnpublishOutcome> {
  return deps.useDb(async (db) => {
    const access = await cardToDecide(db, target, "businesses.unpublish");
    if (access.kind !== "card") return access;
    if (access.card.status !== "published") return NOT_PUBLISHED;
    const reading = readReason(form, UNPUBLISH_FIELD);
    if (reading.kind === "invalid") return reading;
    return unpublishCard(db, access.card.id, reading.reason, target.email);
  });
}

/** What the confirmation of an unpublishing shows: the notice, with the reason stored. */
export interface UnpublishNotice {
  name: string;
  whatsapp: string;
  reason: string;
}

/**
 * The notice of the unpublishing of the card `target` names, for its
 * confirmation; or null when there is nothing to confirm, so the page goes
 * back to the detail: no card, a card the user may not unpublish, a card
 * that is not in review, that was never unpublished, or whose reason is
 * blank (a message with a blank reason is a wrong WhatsApp to a third
 * party). The reason is the one stored, never one an address carries.
 */
export async function unpublishNotice(
  db: Db,
  target: DecisionTarget,
): Promise<UnpublishNotice | null> {
  if (!isBusinessId(target.businessId)) return null;
  const [card] = await db
    .select({
      name: businesses.name,
      whatsapp: businesses.whatsapp,
      status: businesses.status,
      unpublishedAt: businesses.unpublishedAt,
      reason: businesses.unpublishReason,
      localityCode: businesses.localityCode,
    })
    .from(businesses)
    .where(eq(businesses.id, target.businessId));
  if (card === undefined || card.status !== "in_review") return null;
  if (card.unpublishedAt === null || !card.reason?.trim()) return null;
  const granted = await permissionsOf(db, target.email, card.localityCode);
  if (!opensCard(granted) || !granted.has("businesses.unpublish")) return null;
  return { name: card.name, whatsapp: card.whatsapp, reason: card.reason };
}
