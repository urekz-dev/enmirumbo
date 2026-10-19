// The catalogue of what the admin panel lets a user do (ADR 0021). The code
// checks these keys; roles and who holds them live in the database. The
// migrations insert the same keys and descriptions into `permissions`, and
// test/worker/access.test.ts fails when the two lists differ. A new permission
// comes with the screen or action that checks it, and with its migration.
//
// Descriptions are shown in the panel, so they are in Spanish.
export const PERMISSIONS = {
  "businesses.review": "Revisar registros: ver la cola y el detalle, aprobar y rechazar",
  "businesses.edit": "Editar cualquier ficha, asignar giros y normalizar la colonia",
  "businesses.unpublish": "Despublicar fichas",
  "businesses.delete": "Borrar fichas de forma definitiva",
  "edits.review": "Aplicar o descartar los cambios que mandan los dueños",
  "reports.manage": "Atender los reportes de los vecinos",
  "links.manage": "Generar enlaces de gestión",
  "zones.manage": "Agregar, ocultar y renombrar colonias",
  "audit_log.view": "Ver la bitácora",
  "localities.manage": "Configurar ciudades: WhatsApp de contacto, umbral y activación",
  "users.manage": "Invitar, crear y desactivar usuarios del panel y asignarles roles",
  "roles.manage": "Crear y editar roles",
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;
