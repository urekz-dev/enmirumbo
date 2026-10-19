// Approving a registration (docs/specs/admin-review.md, "Approving assigns
// trades, normalizes the zone, marks the origin and publishes the card",
// "Approving a registration generates its management link, unique and
// unrepeatable", "A transition is only applied to a registration that is
// still in review" and "A failed approval repaints exactly the trades the
// admin selected (v2)"; docs/specs/data-model.md, "Trades assignable to the
// business by the admin", "Review status, origin and lifecycle timestamps",
// "The zone allows "Otra" with free text pending normalization" and "The
// management link is issued by the panel alone and resolved by its
// fingerprint (v2)"). The action of the detail's form (src/actions/index.ts)
// gives this the Access email, the identifier of the page's address and its
// connection. In this order:
//
// 1. The card, and the permission `businesses.review` in its locality
//    (./decision.ts): not found, or forbidden.
// 2. A card no longer in review was already resolved: "Este registro ya lo
//    habías resuelto.", and nothing is written.
// 3. The form, against the catalogue: 0 to 3 trades of the catalogue, or
//    "Elige máximo 3 giros"; a zone of the card's locality, hidden ones
//    included, when the card's zone is the free text of "Otra", or "Elige
//    la colonia de este negocio"; and the origin, `seeded` or else
//    `organic`. Errors, and nothing is written; the page repaints what the
//    admin chose.
// 4. One transaction: the card is published only while it is still in
//    review (a conditional update, not a check and a write, so of two
//    approvals at once exactly one wins and the other was already resolved),
//    with its publication date, its origin and, for "Otra", the chosen zone;
//    its trades become exactly the chosen ones; and it gets its management
//    link (../management-link/link.ts), whose token is returned once, for
//    the confirmation to show. An approval that fails leaves no link. A card
//    deleted halfway is not found, and nothing comes back to life.
//
// Approving is also how an unpublished card is published again: its trades
// arrive checked (approvalForm), its publication date becomes this one, its
// unpublishing trace stays, and it gets a new link, since the panel cannot
// show the one it had and a notice without a link is no notice; the old one
// already opened nothing while the card was unpublished.
//
// Approving never edits what the business captured: name, WhatsApp, "¿Qué
// ofreces?", phone, address, hours, page and the free text of "Otra" stay.
//
// Binding: HYPERDRIVE_FRESH. Nothing here is logged, the token least of all.
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { zoneDisplayNames } from "../catalogue/zone-names.ts";
import type { Db } from "../db/client.ts";
import {
  type BusinessOrigin,
  businessTrades,
  businesses,
  municipalities,
  states,
  trades,
  zones,
} from "../db/schema/index.ts";
import { formText } from "../forms/text.ts";
import type { LocalityRef } from "../locality/paths.ts";
import { issueManagementLink } from "../management-link/link.ts";
import { newManagementToken } from "../management-link/token.ts";
import { cardToDecide, type DecisionTarget } from "./decision.ts";

/** The most trades a card gets; none is allowed when none fits (Appendix B). */
export const MAX_TRADES = 3;

/** The names of the fields of the approval form. */
export const APPROVAL_FIELDS = { trades: "giro", zone: "colonia", origin: "origen" } as const;

/** A trade of the catalogue, as the form offers it: its slug is what the form sends. */
export interface TradeOption {
  id: number;
  slug: string;
  name: string;
}

/** A zone of the card's locality, by the name it is shown with. */
export interface ApprovalZone {
  id: number;
  slug: string;
  displayName: string;
  /** Hidden by the admin: the registration no longer offers it, the approval does, marked. */
  hidden: boolean;
}

export interface ApprovalCatalogue {
  /** Every trade, in the catalogue's order. */
  trades: readonly TradeOption[];
  /** Every zone of the card's locality, hidden ones included, alphabetically by display name. */
  zones: readonly ApprovalZone[];
}

/** What the admin chose, as it arrived: what the form shows again after an error. */
export interface ApprovalDraft {
  /** The slugs of the checked trades, each once. */
  trades: readonly string[];
  /** The slug of the chosen zone; empty for none. */
  zone: string;
  origin: BusinessOrigin;
}

export type ApprovalErrors = { trades?: "too-many"; zone?: "required" };

/** A valid approval, in the catalogue's terms. */
export interface Approval {
  tradeIds: readonly number[];
  /** The chosen zone, for a card whose zone is "Otra"; null otherwise. */
  zoneId: number | null;
  origin: BusinessOrigin;
}

const collator = new Intl.Collator("es-MX", { sensitivity: "base", numeric: true });

/**
 * Every zone of `localityCode`, hidden ones included, alphabetically by
 * display name: what the admin gives a card whose zone is "Otra", on
 * approving it and on applying an owner's edit (./apply.ts).
 */
export async function localityZoneChoices(db: Db, localityCode: string): Promise<ApprovalZone[]> {
  const [zoneRows, [municipality]] = await Promise.all([
    db
      .select({
        id: zones.id,
        slug: zones.slug,
        name: zones.name,
        type: zones.type,
        visible: zones.visible,
      })
      .from(zones)
      .where(eq(zones.localityCode, localityCode)),
    db
      .select({ name: municipalities.name })
      .from(municipalities)
      .where(eq(municipalities.code, localityCode)),
  ]);
  // Hidden zones are offered too, marked (decision of the product owner,
  // 2026-10-18, EMR-52): a business that typed the name of a hidden zone
  // arrived as "Otra", since the registration no longer offers it, and the
  // admin gives it the zone that really applies.
  const names = zoneDisplayNames(zoneRows, municipality?.name ?? "");
  return zoneRows
    .map(({ id, slug, name, visible }) => ({
      id,
      slug,
      displayName: names.get(slug) ?? name.trim(),
      hidden: !visible,
    }))
    .toSorted((a, b) => collator.compare(a.displayName, b.displayName));
}

/** The trades and every zone of `localityCode`, for the form and its check. */
export async function approvalCatalogue(db: Db, localityCode: string): Promise<ApprovalCatalogue> {
  const [tradeRows, zoneChoices] = await Promise.all([
    db
      .select({ id: trades.id, slug: trades.slug, name: trades.name })
      .from(trades)
      .orderBy(asc(trades.id)),
    localityZoneChoices(db, localityCode),
  ]);
  return { trades: tradeRows, zones: zoneChoices };
}

/** What the approval form of a card in review needs: the catalogue and what it starts with. */
export interface ApprovalForm {
  catalogue: ApprovalCatalogue;
  /** The form as it opens: the card's trades checked and its origin. */
  draft: ApprovalDraft;
}

/**
 * The approval form of the card `businessId` of `localityCode`. It opens with
 * the trades the card already has checked, so publishing an unpublished card
 * again does not drop them unnoticed, and with the card's origin.
 */
export async function approvalForm(
  db: Db,
  card: { id: string; localityCode: string; origin: BusinessOrigin },
): Promise<ApprovalForm> {
  const [catalogue, assigned] = await Promise.all([
    approvalCatalogue(db, card.localityCode),
    db
      .select({ slug: trades.slug })
      .from(businessTrades)
      .innerJoin(trades, eq(trades.id, businessTrades.tradeId))
      .where(eq(businessTrades.businessId, card.id))
      .orderBy(asc(trades.id)),
  ]);
  return {
    catalogue,
    draft: { trades: assigned.map((row) => row.slug), zone: "", origin: card.origin },
  };
}

/** What a submission of the approval form chose. Nothing about its shape is trusted. */
export function readApproval(form: FormData): ApprovalDraft {
  const trades = form
    .getAll(APPROVAL_FIELDS.trades)
    .filter((value): value is string => typeof value === "string");
  return {
    trades: [...new Set(trades)],
    zone: formText(form, APPROVAL_FIELDS.zone).trim(),
    origin: formText(form, APPROVAL_FIELDS.origin) === "seeded" ? "seeded" : "organic",
  };
}

export type ApprovalValidation =
  | { kind: "valid"; approval: Approval }
  | { kind: "invalid"; errors: ApprovalErrors };

/**
 * Checks `draft` against `catalogue`: at most three trades, every one of the
 * catalogue (a submission that names another is refused like one with too
 * many, since only a forged form can send it), and, when `needsZone`, one of
 * the zones of the card's locality, hidden ones included.
 */
export function validateApproval(
  draft: ApprovalDraft,
  catalogue: ApprovalCatalogue,
  needsZone: boolean,
): ApprovalValidation {
  const errors: ApprovalErrors = {};
  const bySlug = new Map(catalogue.trades.map((trade) => [trade.slug, trade.id]));
  const tradeIds = draft.trades.flatMap((slug) => {
    const id = bySlug.get(slug);
    return id === undefined ? [] : [id];
  });
  if (draft.trades.length > MAX_TRADES || tradeIds.length !== draft.trades.length) {
    errors.trades = "too-many";
  }
  let zoneId: number | null = null;
  if (needsZone) {
    const zone = catalogue.zones.find((option) => option.slug === draft.zone);
    if (zone === undefined) errors.zone = "required";
    else zoneId = zone.id;
  }
  if (errors.trades !== undefined || errors.zone !== undefined) return { kind: "invalid", errors };
  return { kind: "valid", approval: { tradeIds, zoneId, origin: draft.origin } };
}

/** The card just published, for the notice of the confirmation. */
export interface ApprovedCard {
  id: string;
  name: string;
  whatsapp: string;
  locality: LocalityRef;
}

export type ApprovalOutcome =
  /** Published: `token` is its management link, shown once and kept nowhere. */
  | { kind: "approved"; token: string; card: ApprovedCard }
  | { kind: "resolved" }
  | { kind: "invalid"; errors: ApprovalErrors }
  | { kind: "not-found" }
  | { kind: "forbidden" };

const RESOLVED: ApprovalOutcome = { kind: "resolved" };
const NOT_FOUND: ApprovalOutcome = { kind: "not-found" };

/**
 * Publishes the card `businessId` with `approval`, if it is still in review,
 * and issues its management link, in one transaction (step 4 above).
 */
export function approveRegistration(
  db: Db,
  businessId: string,
  approval: Approval,
  newToken: () => string = newManagementToken,
): Promise<ApprovalOutcome> {
  return db.transaction(async (tx) => {
    const [published] = await tx
      .update(businesses)
      .set({
        status: "published",
        publishedAt: sql`now()`,
        origin: approval.origin,
        // The chosen zone only replaces "Otra": a catalogue zone stays.
        ...(approval.zoneId === null
          ? {}
          : { zoneId: sql`coalesce(${businesses.zoneId}, ${approval.zoneId})` }),
      })
      .where(
        and(
          eq(businesses.id, businessId),
          eq(businesses.status, "in_review"),
          // A published card always has a catalogue zone.
          approval.zoneId === null ? isNotNull(businesses.zoneId) : undefined,
        ),
      )
      .returning({
        id: businesses.id,
        name: businesses.name,
        whatsapp: businesses.whatsapp,
        localityCode: businesses.localityCode,
      });
    if (published === undefined) {
      const [card] = await tx
        .select({ status: businesses.status })
        .from(businesses)
        .where(eq(businesses.id, businessId));
      if (card === undefined) return NOT_FOUND;
      if (card.status !== "in_review") return RESOLVED;
      // Still in review but with no zone to keep: "Otra" without a choice.
      return { kind: "invalid", errors: { zone: "required" } };
    }

    await tx.delete(businessTrades).where(eq(businessTrades.businessId, businessId));
    if (approval.tradeIds.length > 0) {
      await tx
        .insert(businessTrades)
        .values(approval.tradeIds.map((tradeId) => ({ businessId, tradeId })));
    }

    const token = await issueManagementLink(tx, businessId, newToken);
    // The card was published by this transaction: no link means it is broken.
    if (token === null) throw new Error("approval: the published card got no management link");

    const [locality] = await tx
      .select({ slug: municipalities.slug, stateSlug: states.slug })
      .from(municipalities)
      .innerJoin(states, eq(states.code, municipalities.stateCode))
      .where(eq(municipalities.code, published.localityCode));
    if (locality === undefined) throw new Error("approval: the card's locality has no address");

    return {
      kind: "approved",
      token,
      card: {
        id: published.id,
        name: published.name,
        whatsapp: published.whatsapp,
        locality: { slug: locality.slug, state: { slug: locality.stateSlug } },
      },
    };
  });
}

/** Where an approval's connection comes from. */
export interface SubmitApprovalDeps {
  /** Runs `run` on a fresh connection to the database (withDb, HYPERDRIVE_FRESH). */
  useDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>;
}

/** A submission of the approval form of `target`, from what arrived to what the admin is told. */
export function submitApproval(
  form: FormData,
  target: DecisionTarget,
  deps: SubmitApprovalDeps,
): Promise<ApprovalOutcome> {
  return deps.useDb(async (db) => {
    const access = await cardToDecide(db, target, "businesses.review");
    if (access.kind !== "card") return access;
    const { card } = access;
    if (card.status !== "in_review") return RESOLVED;
    const catalogue = await approvalCatalogue(db, card.localityCode);
    const validation = validateApproval(readApproval(form), catalogue, card.zoneId === null);
    if (validation.kind === "invalid") return validation;
    return approveRegistration(db, card.id, validation.approval);
  });
}
