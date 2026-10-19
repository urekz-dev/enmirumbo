// The card an action of the panel decides on (ADR 0021;
// docs/specs/admin-review.md, "Inside the panel, a user can do only what
// their roles allow (v2)" and "Each review screen checks its permission in
// the locality of what it shows (v2)"). An action finds its card by the
// identifier of its page's address, never by a field, and checks its own
// permission again in the card's locality, whatever the page showed:
//
// - no card has that identifier, or the user holds no permission that opens
//   a card's detail in its locality: not found, the same 404 as a card that
//   does not exist, so the panel never tells a user that it exists;
// - the user sees the card but lacks the action's permission there:
//   forbidden, the panel's 403, which names nothing.
//
// Binding: HYPERDRIVE_FRESH, as all of the panel. Nothing here is logged.
import { eq } from "drizzle-orm";
import type { Permission } from "../access/permissions.ts";
import { permissionsOf } from "../access/queries.ts";
import { isBusinessId } from "../business/id.ts";
import type { Db } from "../db/client.ts";
import { type BusinessStatus, businesses } from "../db/schema/index.ts";
import { opensCard } from "./scope.ts";

/** Who decides, and on which card: the Access email and the identifier of the page's address. */
export interface DecisionTarget {
  email: string;
  businessId: string;
}

/** The Access email as the audit log keeps it, the way `users` keeps emails. */
export function actorOf(email: string): string {
  return email.trim().toLowerCase();
}

/** What an action needs to know of its card before deciding. */
export interface CardToDecide {
  id: string;
  localityCode: string;
  status: BusinessStatus;
  /** Null while its zone is the free text of "Otra", pending normalization. */
  zoneId: number | null;
}

export type CardAccess =
  | { kind: "card"; card: CardToDecide }
  | { kind: "not-found" }
  | { kind: "forbidden" };

const NOT_FOUND: CardAccess = { kind: "not-found" };
const FORBIDDEN: CardAccess = { kind: "forbidden" };

/** The card of `target`, if its user may do `permission` on it. */
export async function cardToDecide(
  db: Db,
  target: DecisionTarget,
  permission: Permission,
): Promise<CardAccess> {
  if (!isBusinessId(target.businessId)) return NOT_FOUND;
  const [card] = await db
    .select({
      id: businesses.id,
      localityCode: businesses.localityCode,
      status: businesses.status,
      zoneId: businesses.zoneId,
    })
    .from(businesses)
    .where(eq(businesses.id, target.businessId));
  if (card === undefined) return NOT_FOUND;
  const granted = await permissionsOf(db, target.email, card.localityCode);
  if (!opensCard(granted)) return NOT_FOUND;
  if (!granted.has(permission)) return FORBIDDEN;
  return { kind: "card", card };
}
