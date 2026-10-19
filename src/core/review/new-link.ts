// "Generar un enlace nuevo" (PRD §6.4; docs/specs/admin-review.md, "The admin
// can generate a new link, and the previous one stops working" and
// "Unpublishing, a new link and the permanent deletion are forms of the
// detail, and their actions check everything again (v2)"; docs/specs/
// data-model.md, "The management link is issued by the panel alone and
// resolved by its fingerprint (v2)"). The action of the detail's form
// (src/actions/index.ts) gives this the Access email, the identifier of the
// page's address, whether the site has a public origin and its connection.
// In this order:
//
// 1. The card, and the permission `links.manage` in its locality
//    (./decision.ts): not found, or forbidden.
// 2. A card that is not published: "Esta ficha ya no estaba publicada.";
//    only a published card has a link that opens anything.
// 3. The link the form was shown with (its version, the moment it was
//    generated, LINK_VERSION_FIELD) must still be the card's: a form sent
//    again, by reloading the confirmation or from a tab left open, issues no
//    other link, so the link the admin was just shown, and maybe already
//    sent, keeps working. The version only narrows what the form may do; the
//    card is still the one of the page's address.
// 4. Without a public origin to build the link with, nothing is issued: the
//    owner keeps the link they have.
// 5. One transaction, with the card's row locked so two of them at once
//    issue one link: issueManagementLink (../management-link/link.ts)
//    replaces the fingerprint, so the previous link answers the same 404 as
//    an invented one at once, and returns the token once, for the
//    confirmation to show. Nothing else of the card changes, and its pending
//    edit keeps waiting.
//
// A new link changes nothing public and writes no entry of the audit log.
//
// Binding: HYPERDRIVE_FRESH. Nothing here is logged, the token least of all.
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { businesses, municipalities, states } from "../db/schema/index.ts";
import { formText } from "../forms/text.ts";
import type { LocalityRef } from "../locality/paths.ts";
import { issueManagementLink } from "../management-link/link.ts";
import { newManagementToken } from "../management-link/token.ts";
import { cardToDecide, type DecisionTarget } from "./decision.ts";

/** The field of the form that carries the version of the link it was shown with. */
export const LINK_VERSION_FIELD = "enlace";

/**
 * The version of a card's link: the moment it was generated, to the
 * millisecond, or empty for a card without one. It names no token and no
 * fingerprint.
 */
export function linkVersion(createdAt: Date | null): string {
  return createdAt === null ? "" : createdAt.toISOString();
}

/** The card that got a new link, for the notice of the confirmation. */
export interface NewLinkCard {
  id: string;
  name: string;
  whatsapp: string;
  locality: LocalityRef;
}

export type NewLinkOutcome =
  /** Issued: `token` is the new link, shown once and kept nowhere. */
  | { kind: "issued"; token: string; card: NewLinkCard }
  /** The card is not published: "Esta ficha ya no estaba publicada." */
  | { kind: "not-published" }
  /** The link the form was shown with was already replaced: no other is issued. */
  | { kind: "replaced" }
  /** No public origin to build the link with: nothing was issued. */
  | { kind: "no-site-url" }
  | { kind: "not-found" }
  | { kind: "forbidden" };

const NOT_PUBLISHED: NewLinkOutcome = { kind: "not-published" };
const REPLACED: NewLinkOutcome = { kind: "replaced" };
const NOT_FOUND: NewLinkOutcome = { kind: "not-found" };

/**
 * Gives the published card `businessId` a new management link, if its link
 * is still the one of `version`, in one transaction (step 5 above).
 */
export function issueNewLink(
  db: Db,
  businessId: string,
  version: string,
  newToken: () => string = newManagementToken,
): Promise<NewLinkOutcome> {
  return db.transaction(async (tx) => {
    const [card] = await tx
      .select({
        name: businesses.name,
        whatsapp: businesses.whatsapp,
        status: businesses.status,
        linkCreatedAt: businesses.managementTokenCreatedAt,
        localitySlug: municipalities.slug,
        stateSlug: states.slug,
      })
      .from(businesses)
      .innerJoin(municipalities, eq(municipalities.code, businesses.localityCode))
      .innerJoin(states, eq(states.code, municipalities.stateCode))
      .where(eq(businesses.id, businessId))
      .for("update", { of: businesses });
    if (card === undefined) return NOT_FOUND;
    if (card.status !== "published") return NOT_PUBLISHED;
    if (linkVersion(card.linkCreatedAt) !== version) return REPLACED;
    const token = await issueManagementLink(tx, businessId, newToken);
    // The row is locked and published: no link means something is broken.
    if (token === null) throw new Error("new link: the published card got no management link");
    return {
      kind: "issued",
      token,
      card: {
        id: businessId,
        name: card.name,
        whatsapp: card.whatsapp,
        locality: { slug: card.localitySlug, state: { slug: card.stateSlug } },
      },
    };
  });
}

/** What a new link needs from the action. */
export interface SubmitNewLinkDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
  /** Whether the site has a public origin to build the link with (SITE_URL). */
  hasPublicOrigin: boolean;
}

/** A submission of "Generar un enlace nuevo" of `target`, from what arrived to what the admin is told. */
export function submitNewLink(
  form: FormData,
  target: DecisionTarget,
  deps: SubmitNewLinkDeps,
): Promise<NewLinkOutcome> {
  return deps.useDb(async (db) => {
    const access = await cardToDecide(db, target, "links.manage");
    if (access.kind !== "card") return access;
    if (access.card.status !== "published") return NOT_PUBLISHED;
    if (!deps.hasPublicOrigin) return { kind: "no-site-url" };
    return issueNewLink(db, access.card.id, formText(form, LINK_VERSION_FIELD).trim());
  });
}
