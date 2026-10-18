// The example inside the "¿Qué ofreces?" field, which follows the chosen
// category (docs/specs/business-registration.md, "The "¿Qué ofreces?"
// example adapts to the chosen category"; PRD §6.1 and §6.5: the same form
// takes businesses and sports clubs, only the example changes). It is a
// placeholder, never a value. The examples of "servicios-del-hogar" and
// "clubes-y-escuelas-deportivas" are literals of the spec; the other six are
// the prototype's copy, one to one. Keyed by the category slugs of the
// catalogue (drizzle/0007_categories_trades.sql). Pure.

/** The example while no category is chosen, and without JavaScript. */
export const GENERIC_WHAT_YOU_OFFER_EXAMPLE = "ej. palabras clave de lo que ofreces";

export const WHAT_YOU_OFFER_EXAMPLES: Readonly<Record<string, string>> = {
  "restaurantes-y-fondas": "ej. comida corrida, tacos al pastor, para llevar",
  "servicios-del-hogar": "ej. plomería, destape de drenajes, bombas de agua",
  belleza: "ej. corte de cabello, uñas acrílicas, maquillaje para eventos",
  salud: "ej. consulta general, limpieza dental, vacunas",
  "abarrotes-y-comercio": "ej. abarrotes, tortillas, recargas y paquetería",
  talleres: "ej. afinación, hojalatería y pintura, cambio de llantas",
  "clubes-y-escuelas-deportivas": "ej. futbol infantil 6-12 años, entrenamientos martes y jueves",
  otro: "ej. lo que ofrece tu negocio, en pocas palabras",
};

/**
 * The example for the category `slug`; the generic one without a category,
 * or for a slug with no example of its own. `Object.hasOwn`, so a key of
 * `Object.prototype` ("constructor") is no category.
 */
export function whatYouOfferExample(slug: string | null | undefined): string {
  if (!slug || !Object.hasOwn(WHAT_YOU_OFFER_EXAMPLES, slug)) return GENERIC_WHAT_YOU_OFFER_EXAMPLE;
  return WHAT_YOU_OFFER_EXAMPLES[slug] ?? GENERIC_WHAT_YOU_OFFER_EXAMPLE;
}
