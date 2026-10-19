// The copy of the admin panel's review screens (docs/specs/admin-review.md):
// the queue, "Todos los negocios", the detail of a registration and the
// detail of a pending edit. The literals the specification quotes are written
// here exactly as it quotes them, and the tests compare them character by
// character; the rest is the prototype's copy, one to one. Colloquial Mexican
// Spanish, the brand always "enmirumbo". Pure.
import type { BusinessOrigin, BusinessStatus } from "../db/schema/index.ts";
import type { StatusFilter } from "./paths.ts";

// The queue ("Review queue with the pending registrations, oldest first",
// "Visible indicator for registrations waiting more than 48 hours", "The
// queue tells which businesses have unattended reports").
export const QUEUE_HEADING = "Registros por revisar";
export const QUEUE_EMPTY = "No hay registros esperando. Todo al día.";
export const NEW_REGISTRATION_TAG = "Alta nueva";
export const EDIT_TAG = "Edición";
export const UNPUBLISHED_TAG = "Ya estaba publicada, la despublicaste";
export const OVERDUE_TAG = "Lleva más de 48 horas";
export const REVIEW_LINK = "Revisar";
export const SEE_ALL_BUSINESSES = "Ver todos los negocios";
export const REPORTED_HEADING = "Negocios reportados";
export const SEE_REPORTS = "Ver reportes";

/** How many rows of the queue wait past the goal (the prototype's copy). */
export function overdueCountText(count: number): string {
  return count === 1
    ? "1 registro lleva más de 48 horas esperando."
    : `${count} registros llevan más de 48 horas esperando.`;
}

/** "1 negocio tiene reportes sin atender." / "<n> negocios tienen reportes sin atender." */
export function reportedCountText(count: number): string {
  return count === 1
    ? "1 negocio tiene reportes sin atender."
    : `${count} negocios tienen reportes sin atender.`;
}

/** "1 reporte sin atender" / "<n> reportes sin atender". */
export function pendingReportsText(count: number): string {
  return count === 1 ? "1 reporte sin atender" : `${count} reportes sin atender`;
}

// "Todos los negocios" ("'Todos los negocios' view with the status in sight
// and an entry to the detail", "The listing is filtered by status without
// leaving the view", "The listing is cut into pages and does not degrade when
// there are many records", "The queue has a visible entry to the listing, and
// the listing returns to the queue", "The listing searches by name or
// WhatsApp (v2)").
export const BUSINESSES_HEADING = "Todos los negocios";
export const SEE_DETAIL = "Ver detalle";
export const BACK_TO_QUEUE = "Volver a la cola";
export const FILTER_BY_STATUS = "Filtrar por estado";
export const LIST_EMPTY = "Todavía no hay negocios registrados.";
export const FILTER_EMPTY = "No hay negocios con ese estado.";
export const SEARCH_EMPTY = "No encontramos negocios con esa búsqueda.";
export const SEARCH_LABEL = "Buscar por nombre o WhatsApp";
export const SEARCH_BUTTON = "Buscar";
export const CLEAR_SEARCH = "Quitar la búsqueda";
export const OLDER_PAGE = "Ver más antiguos";
export const NEWER_PAGE = "Ver más nuevos";
/** The name of the pagination's navigation, for screen readers. */
export const PAGES_LABEL = "Páginas de la lista";

/** "1 negocio en esta lista" / "<n> negocios en esta lista". */
export function listCountText(count: number): string {
  return count === 1 ? "1 negocio en esta lista" : `${count} negocios en esta lista`;
}

/** "Página 2 de 5". */
export function pageOfText(page: number, pages: number): string {
  return `Página ${page} de ${pages}`;
}

/** "Se registró el 3 de septiembre de 2026", the date already in its locality's time zone. */
export function registeredOnText(date: string): string {
  return `Se registró el ${date}`;
}

/** The options of "Filtrar por estado". */
export const STATUS_FILTER_TEXT: Readonly<Record<StatusFilter, string>> = {
  all: "Todos",
  in_review: "En revisión",
  published: "Publicados",
  rejected: "Rechazados",
};

/** The status of a card in words, as a row of the list and the detail write it. */
export const STATUS_TEXT: Readonly<Record<BusinessStatus, string>> = {
  in_review: "En revisión",
  published: "Publicado",
  rejected: "Rechazado",
};

// The locality filter ("The panel filters by locality, and the filter is
// hidden while there is one (v2)").
export const FILTER_BY_LOCALITY = "Filtrar por municipio";
export const ALL_LOCALITIES = "Todos";

/** A locality as the filter and the rows name it: "Tizayuca, Hidalgo". */
export function localityText(locality: { name: string; stateName: string }): string {
  return `${locality.name}, ${locality.stateName}`;
}

// The detail of a registration ("Registration detail with all the captured
// data, only inside the panel", "The business detail lists its unattended
// reports", "Verification button that opens WhatsApp with a prefilled
// message").
export const REGISTRATION_TITLE = "Detalle del registro";
export const PHOTO_LABEL = "Foto del negocio";
export const NO_PHOTO = "Sin foto";
export const NOT_CAPTURED = "No capturado";
export const INTERNAL_DATA_HEADING = "Datos internos del panel";
export const UNPUBLISHED_AT_LABEL = "Cuándo la despublicaste";
export const UNPUBLISH_REASON_LABEL = "Por qué la despublicaste";
export const PENDING_REPORTS_HEADING = "Reportes sin atender";
export const VERIFY_BUTTON = "Escribirle por WhatsApp";

/** The fields of a card, labelled as the detail and the comparison label them. */
export const FIELD_LABELS = {
  name: "Nombre",
  category: "Categoría",
  whatsapp: "WhatsApp",
  zone: "Colonia",
  whatYouOffer: "¿Qué ofreces?",
  homeDelivery: "¿Hace entregas o va a domicilio?",
  landline: "Teléfono fijo",
  address: "Dirección o referencias",
  openingHours: "Horario",
  facebookUrl: "Página que registró",
  photo: PHOTO_LABEL,
  status: "Estado",
  origin: "Origen",
  registeredAt: "Fecha de registro",
  consent: "Consentimiento del aviso de privacidad",
  publishedAt: "Fecha de publicación",
  rejectedAt: "Fecha de rechazo",
  rejectionReason: "Motivo del rechazo",
} as const;

/** Whether the business delivers or goes to the customer's home, in words. */
export function yesNo(value: boolean): string {
  return value ? "Sí" : "No";
}

/** The origin of a card, in the words of the approval form. */
export const ORIGIN_TEXT: Readonly<Record<BusinessOrigin, string>> = {
  organic: "Se registró solo",
  seeded: "Lo sembramos nosotros",
};

/** The free text of a zone "Otra", marked as such: the admin normalizes it on approving. */
export function otherZoneText(text: string): string {
  return `${text} (escrita como "Otra", sin normalizar)`;
}

/**
 * The consent record: its date and, in brackets, the version of the notice
 * accepted, "3 de septiembre de 2026 (versión 1)"; a card from before
 * versioning says "versión no registrada", never an invented version.
 */
export function consentText(date: string, version: string | null): string {
  return `${date} (${version === null ? "versión no registrada" : `versión ${version}`})`;
}

/**
 * The label of a re-acceptance: the verifiable fact, a resubmission of the
 * public form accepted version N, never attributed to the data subject.
 */
export function reconsentLabel(version: string): string {
  return `El reenvío aceptó la versión ${version} del aviso`;
}

/** That the card has a management link, and since when; never the link (the prototype's copy). */
export function managementLinkText(date: string): string {
  return `Tiene enlace de gestión, generado el ${date}.`;
}

/** A stored WhatsApp that is not ten national digits, shown as stored, with no button. */
export function unlinkedWhatsappText(whatsapp: string): string {
  return `WhatsApp registrado: ${whatsapp} (no se pudo generar el enlace)`;
}

// The detail of a pending edit ("The pending edit detail compares what is
// published with what is proposed"; "A pending edit is resolved only once and
// only if it is still the latest").
export const EDIT_HEADING = "Cambios por revisar";
export const PUBLISHED_COLUMN = "Lo que está publicado";
export const PROPOSED_COLUMN = "Lo que quiere cambiar";
export const CHANGED_TAG = "Cambió";
export const WHATSAPP_CHANGE_WARNING =
  "Ojo: está cambiando su WhatsApp. Confirma con el número nuevo antes de aplicar.";
export const EDIT_ALREADY_RESOLVED = "Estos cambios ya los habías resuelto.";
export const EDIT_SUPERSEDED =
  "Estos cambios ya no son los últimos: el negocio mandó otros más nuevos.";
/** What a resolved edit that replaced the photo proposed, once its photo is no longer the edit's. */
export const NEW_PHOTO = "Una foto nueva";
