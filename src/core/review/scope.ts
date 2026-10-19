// What each review screen of the panel shows a user, by permission
// (ADR 0021; docs/specs/admin-review.md, "Inside the panel, a user can do only
// what their roles allow (v2)" and "Each review screen checks its permission
// in the locality of what it shows (v2)"). Access proves the email; the roles
// decide, locality by locality:
//
// - `businesses.review`: the "Alta nueva" rows of the queue.
// - `edits.review`: the "Edición" rows of the queue and the detail of a
//   pending edit.
// - `reports.manage`: "Negocios reportados" in the queue and the unattended
//   reports in the detail of a card.
// - Any of CARD_PERMISSIONS: the detail of a card, and so its row in "Todos
//   los negocios", the entry to every card. They are the permissions that act
//   on a card, whose actions live in its detail.
// - `audit_log.view`: the audit log and the section of entries of a card's
//   detail.
//
// A screen with nothing a user may see answers the panel's 403.
import type { Permission } from "../access/permissions.ts";
import { permittedLocalities } from "../access/queries.ts";
import type { Db } from "../db/client.ts";

/** The permissions that open the detail of a card, and list it in "Todos los negocios". */
export const CARD_PERMISSIONS = [
  "businesses.review",
  "businesses.edit",
  "businesses.unpublish",
  "businesses.delete",
  "reports.manage",
  "links.manage",
] as const satisfies readonly Permission[];

/** Whether the permissions a user holds in a card's locality open its detail. */
export function opensCard(granted: ReadonlySet<Permission>): boolean {
  return CARD_PERMISSIONS.some((permission) => granted.has(permission));
}

/** The localities, by INEGI code, where a user sees each part of the review screens. */
export interface PanelScope {
  /** The "Alta nueva" rows of the queue. */
  review: readonly string[];
  /** The "Edición" rows of the queue. */
  edits: readonly string[];
  /** "Negocios reportados". */
  reports: readonly string[];
  /** "Todos los negocios", and the detail of a card. */
  cards: readonly string[];
  /** The audit log, and the section of a card's detail that shows its entries. */
  log: readonly string[];
}

/** What `email` sees in the review screens, in one query. */
export async function panelScope(db: Db, email: string): Promise<PanelScope> {
  const granted = await permittedLocalities(db, email, [
    ...CARD_PERMISSIONS,
    "edits.review",
    "audit_log.view",
  ]);
  const where = (...wanted: Permission[]) =>
    [...new Set(wanted.flatMap((permission) => [...(granted.get(permission) ?? [])]))].sort();
  return {
    review: where("businesses.review"),
    edits: where("edits.review"),
    reports: where("reports.manage"),
    cards: where(...CARD_PERMISSIONS),
    log: where("audit_log.view"),
  };
}

/** Every locality where the queue shows the user something. */
export function queueLocalities(scope: PanelScope): string[] {
  return [...new Set([...scope.review, ...scope.edits, ...scope.reports])].sort();
}

/**
 * Whether the user may open the detail of a card in `locality`: the same rule
 * the detail page applies, read from the scope `panelScope` built, so no
 * screen copies it. A user who holds only `audit_log.view` there may not.
 */
export function opensCardIn(scope: PanelScope, locality: string): boolean {
  return scope.cards.includes(locality);
}

/** The scope narrowed to one locality, or the whole scope for none. */
export function narrowScope(scope: PanelScope, locality: string | null): PanelScope {
  if (locality === null) return scope;
  const only = (codes: readonly string[]) => codes.filter((code) => code === locality);
  return {
    review: only(scope.review),
    edits: only(scope.edits),
    reports: only(scope.reports),
    cards: only(scope.cards),
    log: only(scope.log),
  };
}
