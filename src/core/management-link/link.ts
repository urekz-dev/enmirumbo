// The management link of a card (PRD §6.4; docs/specs/data-model.md, "The
// business stores its management link as a fingerprint, never in plain";
// docs/specs/admin-review.md, "Approving a registration generates its
// management link, unique and unrepeatable" and "The admin can generate a new
// link, and the previous one stops working"; docs/specs/business-registration.md,
// "A token that is not exactly the current one opens nothing and gives nothing
// away"). The token itself is ./token.ts.
//
// - issueManagementLink gives a published card a new link: it writes the
//   fingerprint of a new token and the moment it was generated, which
//   replaces any earlier link at once, and returns the token, the only time
//   it exists in plain. The panel calls it (epic F: on approving, in the same
//   transaction that publishes the card, and on "Generar un enlace nuevo");
//   nothing else in the repository issues a link, and it never runs for a
//   card that is not published, so a card that was never approved has no
//   link. The caller shows the token once and keeps it nowhere.
// - resolveManagementLink finds the card a token opens: always by the
//   fingerprint of whatever arrived, in one query that asks for a published
//   card of the page's locality with that fingerprint, and compares the
//   fingerprint found with the one computed, in constant time. An invented
//   token, one altered in a character, one a regeneration invalidated, one of
//   a card that is no longer published, of a card of another locality or of
//   a deleted card all take that same single query and give null, which the
//   caller answers with the site's 404.
//
// Nothing here writes to the log: no token, no fingerprint, no card.
//
// Binding: HYPERDRIVE_FRESH, always. Issuing is a write; resolving is a
// verification that must see a regeneration or an unpublishing at once.
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema/index.ts";
import { businesses } from "../db/schema/index.ts";
import { newManagementToken, sameFingerprint, tokenFingerprint } from "./token.ts";

/** A database or a transaction: issuing a link joins the transaction of an approval. */
export type LinkDb = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/**
 * Gives the published card `businessId` a new management link, replacing the
 * one it had, and returns its token; or null when no published card has that
 * identifier, and nothing changes. The token is shown once and kept nowhere:
 * the card keeps its fingerprint and the moment it was generated.
 */
export async function issueManagementLink(
  db: LinkDb,
  businessId: string,
  newToken: () => string = newManagementToken,
): Promise<string | null> {
  const token = newToken();
  const fingerprint = await tokenFingerprint(token);
  const issued = await db
    .update(businesses)
    .set({ managementTokenHash: fingerprint, managementTokenCreatedAt: sql`now()` })
    .where(and(eq(businesses.id, businessId), eq(businesses.status, "published")))
    .returning({ id: businesses.id });
  return issued.length > 0 ? token : null;
}

/** The card a token opens, and the fingerprint it was found by. */
export interface OpenLink {
  businessId: string;
  /** The fingerprint of the token, which the save checks again (openLinkCondition). */
  fingerprint: string;
}

/**
 * The condition of a link that opens a card: the published card of the
 * locality `localityCode` whose fingerprint is `fingerprint`, and, when given,
 * whose identifier is `businessId`.
 */
export function openLinkCondition(
  localityCode: string,
  fingerprint: string,
  businessId?: string,
): SQL {
  const conditions = [
    eq(businesses.managementTokenHash, fingerprint),
    eq(businesses.localityCode, localityCode),
    eq(businesses.status, "published"),
  ];
  if (businessId !== undefined) conditions.push(eq(businesses.id, businessId));
  return and(...conditions) as SQL;
}

/**
 * The published card of the locality `localityCode` that `token` opens, or
 * null for every token that does not open one: one query by its fingerprint,
 * whatever arrived, and a constant-time comparison of what it found.
 */
export async function resolveManagementLink(
  db: LinkDb,
  localityCode: string,
  token: string,
): Promise<OpenLink | null> {
  const fingerprint = await tokenFingerprint(token);
  const [card] = await db
    .select({ id: businesses.id, fingerprint: businesses.managementTokenHash })
    .from(businesses)
    .where(openLinkCondition(localityCode, fingerprint))
    .limit(1);
  if (card === undefined || card.fingerprint === null) return null;
  if (!sameFingerprint(card.fingerprint, fingerprint)) return null;
  return { businessId: card.id, fingerprint };
}
