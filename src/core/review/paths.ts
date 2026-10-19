// The addresses of the panel's review screens (docs/specs/admin-review.md),
// built in one place so a link never names a screen that does not exist
// (test/scripts/internal-links.test.ts reads only literal links):
//
//   /admin                      the review queue, the panel's main screen
//   /admin/negocios             "Todos los negocios"
//   /admin/registros/<id>       the detail of a card, by its identifier, where
//                               its decisions are posted
//   /admin/registros/<id>/rechazado
//                               the confirmation of a rejection
//   /admin/ediciones/<id>       the detail of a pending edit, by its number
//
// The queue and the list carry their filters in the query: `localidad` (the
// INEGI code of a locality, only while the locality filter is shown),
// `estado`, `q` and `pagina`. Nothing else travels in their addresses. Pure.
import type { BusinessStatus } from "../db/schema/index.ts";

export const QUEUE_PATH = "/admin";
export const BUSINESSES_PATH = "/admin/negocios";

/** The detail of a card. */
export function registrationPath(businessId: string): string {
  return `/admin/registros/${encodeURIComponent(businessId)}`;
}

/** The confirmation of the rejection of a card, which a rejection answers with a 303. */
export function rejectedPath(businessId: string): string {
  return `${registrationPath(businessId)}/rechazado`;
}

/** The detail of a pending edit. */
export function editPath(editId: number): string {
  return `/admin/ediciones/${editId}`;
}

/** The status filter of the list: "Todos" or one status. */
export type StatusFilter = BusinessStatus | "all";

/** The value of `estado` for each filter but "Todos", which is the address without it. */
export const STATUS_PARAMS: Readonly<Record<BusinessStatus, string>> = {
  in_review: "en-revision",
  published: "publicados",
  rejected: "rechazados",
};

/** The queue, narrowed to one locality or not. */
export function queuePath(locality: string | null = null): string {
  return locality === null
    ? QUEUE_PATH
    : `${QUEUE_PATH}?${new URLSearchParams({ localidad: locality })}`;
}

export interface BusinessesView {
  status: StatusFilter;
  locality: string | null;
  /** What the admin searched, as the search box shows it; empty for no search. */
  query: string;
  page: number;
}

/**
 * The address of a view of the list. Values at their default are left out,
 * so "Todos", page 1 and no search are `/admin/negocios` itself.
 */
export function businessesPath(view: Partial<BusinessesView> = {}): string {
  const params = new URLSearchParams();
  if (view.locality) params.set("localidad", view.locality);
  if (view.status !== undefined && view.status !== "all") {
    params.set("estado", STATUS_PARAMS[view.status]);
  }
  if (view.query) params.set("q", view.query);
  if (view.page !== undefined && view.page > 1) params.set("pagina", String(view.page));
  const query = params.toString();
  return query === "" ? BUSINESSES_PATH : `${BUSINESSES_PATH}?${query}`;
}
