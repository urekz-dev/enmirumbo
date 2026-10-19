// The copy of the zones screen of the panel (docs/specs/admin-review.md, "The
// admin can hide and rename the zones of a locality (v2)", "The admin can add
// a zone to a locality (v2)" and "The panel says that a change takes up to a
// minute to reach the site (v2)"). The literals the specification quotes are
// written here exactly as it quotes them, and the tests compare them
// character by character. Colloquial Mexican Spanish. Pure.
import type { ConflictingPage, NameProblem } from "./rules.ts";
import { MAX_ZONE_NAME_LENGTH } from "./rules.ts";

/** After every action that changes what the public pages show (v2). */
export const PUBLIC_DELAY = "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.";

export const ZONES_TITLE = "Colonias";
/** The entry to the screen, from the queue. */
export const MANAGE_ZONES = "Administrar colonias";

/** "Colonias de Tizayuca", the municipality from the locality record. */
export function zonesHeading(localityName: string): string {
  return `Colonias de ${localityName}`;
}

export const ZONES_INTRO =
  "Una colonia oculta ya no se ofrece en el formulario de registro ni en el de cambios. Cambiarle el nombre no cambia sus URLs.";

// Adding.
export const ADD_HEADING = "Agregar una colonia";
export const ADD_HELP =
  "Para fraccionamientos nuevos que todavía no salen en el catálogo de SEPOMEX. Su URL sale del nombre y ya no cambia, aunque luego le cambies el nombre.";
export const NAME_LABEL = "Nombre";
export const TYPE_LABEL = "Tipo";
export const TYPE_PLACEHOLDER = "Elige el tipo";
export const ADD_BUTTON = "Agregar colonia";

// The list.
export const LIST_HEADING = "Las colonias";
export const ZONES_EMPTY = "Este municipio todavía no tiene colonias.";
export const HIDDEN_TAG = "Oculta";
export const HIDE_BUTTON = "Ocultar";
export const SHOW_BUTTON = "Mostrar";
export const RENAME_SUMMARY = "Cambiarle el nombre";
export const NEW_NAME_LABEL = "Nombre nuevo";
export const RENAME_BUTTON = "Guardar el nombre";

/** "Tipo: Fraccionamiento". */
export function typeText(type: string): string {
  return `${TYPE_LABEL}: ${type}`;
}

/** "En la URL: huicalco": the slug, which a rename never changes. */
export function slugText(slug: string): string {
  return `En la URL: ${slug}`;
}

/** "105 colonias, 2 ocultas" / "1 colonia". */
export function zonesCountText(total: number, hidden: number): string {
  const all = total === 1 ? "1 colonia" : `${total} colonias`;
  if (hidden === 0) return all;
  return `${all}, ${hidden === 1 ? "1 oculta" : `${hidden} ocultas`}`;
}

// The errors, next to their field.
export const NAME_REQUIRED = "Escribe el nombre de la colonia.";
export const NAME_TOO_LONG = `Deja el nombre en ${MAX_ZONE_NAME_LENGTH} caracteres o menos.`;
export const NAME_NO_LETTERS = "Escribe el nombre con letras o números.";
export const NAME_NO_SLUG =
  "Ese nombre tiene letras que no caben en una URL. Escríbelo con las letras del español, números y espacios.";
export const TYPE_REQUIRED = "Elige el tipo de la colonia.";
/** A submission the screen could not save, for a reason that is not the form's. */
export const GENERAL_ERROR = "No se pudo guardar el cambio. Vuelve a intentarlo.";

/** What else a URL of the new zone would be, in words. */
function pageText(page: ConflictingPage): string {
  switch (page.kind) {
    case "reserved":
      return "una página propia del sitio";
    case "category":
      return `la categoría «${page.name}»`;
    case "trade":
      return `el giro «${page.name}»`;
    case "zone":
      return `la colonia «${page.name}»`;
    case "trade+zone":
      return `la del giro «${page.trade}» en «${page.zone}»`;
  }
}

/** What the form says next to the name, for each problem. */
export function nameProblemText(problem: NameProblem, name: string, type: string | null): string {
  switch (problem.kind) {
    case "required":
      return NAME_REQUIRED;
    case "too-long":
      return NAME_TOO_LONG;
    case "no-letters":
      return NAME_NO_LETTERS;
    case "no-slug":
      return NAME_NO_SLUG;
    case "slug-taken":
      return `Ya hay una colonia con esa misma URL (${problem.slug}): «${problem.zone}». Si es la misma, búscala en la lista para mostrarla o cambiarle el nombre; si es otra, ponle un nombre distinto.`;
    case "url-conflict": {
      const whose =
        problem.trade === null ? "" : ` (la del giro «${problem.trade}» en esta colonia)`;
      const example = type === null ? "" : `; por ejemplo, con su tipo adelante: «${type} ${name}»`;
      return `Con ese nombre, la URL «${problem.segment}»${whose} se confundiría con ${pageText(problem.other)}. Ponle otro nombre${example}.`;
    }
    case "display-clash":
      return `Ya hay otra colonia que se vería igual: «${problem.displayName}». Ponle un nombre distinto.`;
  }
}
