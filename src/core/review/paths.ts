// The addresses of the panel's review screens (docs/specs/admin-review.md),
// built in one place so a link never names a screen that does not exist
// (test/scripts/internal-links.test.ts reads only literal links):
//
//   /admin                      the review queue, the panel's main screen
//   /admin/negocios             "Todos los negocios"
//   /admin/bitacora             the audit log, newest first
//   /admin/registros/<id>       the detail of a card, by its identifier, where
//                               its decisions are posted
//   /admin/registros/<id>/editar
//                               direct rectification in any status
//   /admin/registros/<id>/editado
//                               its confirmation after the save
//   /admin/registros/<id>/rechazado
//                               the confirmation of a rejection
//   /admin/registros/<id>/despublicado
//                               the confirmation of an unpublishing
//   /admin/registros/<id>/borrar
//                               the confirmation of a permanent deletion,
//                               where the deletion is posted
//   /admin/borrado              what a permanent deletion did, under no
//                               card's address: nothing of what it deleted
//                               travels in it
//   /admin/ediciones/<id>       the detail of a pending edit, by its number,
//                               where its resolutions are posted
//   /admin/ediciones/<id>/aplicada
//                               the confirmation of an applied edit
//   /admin/ediciones/<id>/descartada
//                               the confirmation of a discarded edit
//
// The queue and the list carry their filters in the query: `localidad` (the
// INEGI code of a locality, only while the locality filter is shown),
// `estado`, `q` and `pagina`; the screen of a deletion, only whether the
// photo still waits for its purge (`foto=pendiente`). Nothing else travels in
// their addresses. Pure.
import type { BusinessStatus } from "../db/schema/index.ts";

export const QUEUE_PATH = "/admin";
export const BUSINESSES_PATH = "/admin/negocios";
export const AUDIT_LOG_PATH = "/admin/bitacora";
export const TASKS_PATH = "/admin/tareas";

/** The detail of a card. */
export function registrationPath(businessId: string): string {
  return `/admin/registros/${encodeURIComponent(businessId)}`;
}

/** The confirmation of the rejection of a card, which a rejection answers with a 303. */
export function rejectedPath(businessId: string): string {
  return `${registrationPath(businessId)}/rechazado`;
}

/** The confirmation of the unpublishing of a card, which an unpublishing answers with a 303. */
export function unpublishedPath(businessId: string): string {
  return `${registrationPath(businessId)}/despublicado`;
}

/** The confirmation of the permanent deletion of a card, where the deletion is posted. */
export function deletionPath(businessId: string): string {
  return `${registrationPath(businessId)}/borrar`;
}

export const DELETED_PATH = "/admin/borrado";

/** The value of `foto` on the screen of a deletion whose photo still waits for its purge. */
export const PHOTO_CACHED_PARAM = "pendiente";

/**
 * What a deletion did, which it answers with a 303: no identifier or anything
 * else of the deleted card, only whether its photo may still be cached.
 */
export function deletedPath(photoCached: boolean): string {
  return photoCached
    ? `${DELETED_PATH}?${new URLSearchParams({ foto: PHOTO_CACHED_PARAM })}`
    : DELETED_PATH;
}

/** The detail of a pending edit. */
export function editPath(editId: number | string): string {
  return `/admin/ediciones/${encodeURIComponent(editId)}`;
}

/** The confirmation of an applied edit, which an apply answers with a 303. */
export function appliedPath(editId: number | string): string {
  return `${editPath(editId)}/aplicada`;
}

/** The confirmation of a discarded edit, which a discard answers with a 303. */
export function discardedPath(editId: number | string): string {
  return `${editPath(editId)}/descartada`;
}

/** The audit log's view: its locality filter and its page. */
export interface AuditLogView {
  locality: string | null;
  page: number;
}

/**
 * The address of a view of the audit log. Values at their default are left
 * out, so "Todos" and page 1 are `/admin/bitacora` itself.
 */
export function auditLogPath(view: Partial<AuditLogView> = {}): string {
  const params = new URLSearchParams();
  if (view.locality) params.set("localidad", view.locality);
  if (view.page !== undefined && view.page > 1) params.set("pagina", String(view.page));
  const query = params.toString();
  return query === "" ? AUDIT_LOG_PATH : `${AUDIT_LOG_PATH}?${query}`;
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

/** The direct rectification form and its confirmation. */
export function rectificationPath(businessId: string): string {
  return `${registrationPath(businessId)}/editar`;
}
export function rectifiedPath(businessId: string): string {
  return `${registrationPath(businessId)}/editado`;
}
