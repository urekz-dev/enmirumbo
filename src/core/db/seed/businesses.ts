// The fictitious businesses of `vp run db:seed` (docs/specs/data-model.md,
// "Seed of fictitious businesses for development (v2)"). Everything here is
// made up and reads as made up: invented names, numbers of the 771999xxxx
// series, references that point nowhere, and photos the seed draws when it
// runs (./photos.ts), never a picture of anything real. None is a real
// business of the locality. The texts are copy, so they are in Spanish.
//
// The set covers what the directory, the search and the panel need to show:
// published cards in seven categories (the sports one included) and several
// zones, with and without home delivery, one with every optional field and
// one with only the required ones, one with the zone "Otra" not normalized,
// one in review and one rejected. "Otro" stays empty, for its empty listing.
// The trades are the ones the admin would assign: the cocina's, "Fonda /
// comida corrida", is in neither its name nor its "¿Qué ofreces?", so only the
// search by trade finds it; the academia's keywords carry accents ("Fútbol").
// Two cards of "Servicios del hogar" share their publication date, so the
// listing shows the tie broken by name. Two cards of "Salud" have a photo
// ("The demo seed leaves cards with a photo to see the directory as the
// resident will see it"), the newest and the oldest of that listing, so it
// shows a photo in its first row, the placeholder, and a photo below; every
// other card has none.
import type { BusinessOrigin, BusinessStatus } from "../schema/business.ts";

export interface FakeBusiness {
  /** Fixed, from the identifier alphabet: the seed never inserts it twice. */
  id: string;
  name: string;
  /** The slug of its category. */
  category: string;
  /** The slug of a zone of the seeded locality, or the free text of "Otra". */
  zone: string | { other: string };
  whatsapp: string;
  status: BusinessStatus;
  /** As the admin marked it on approval; `organic` by default. */
  origin?: BusinessOrigin;
  /** The slugs of the trades the admin assigned. */
  trades?: readonly string[];
  whatYouOffer?: string;
  homeDelivery?: boolean;
  landline?: string;
  address?: string;
  pin?: { latitude: number; longitude: number };
  openingHours?: string;
  facebookUrl?: string;
  /** Days before the run: when it registered, or last resubmitted. */
  registeredDaysAgo: number;
  publishedDaysAgo?: number;
  rejected?: { daysAgo: number; reason: string };
  /**
   * Its photo key, fixed like its identifier, so the seed writes the same
   * objects on every run (src/core/photos/photo.ts); none when it has no photo.
   */
  photoKey?: string;
  /**
   * The consent record, by default the notice version in force when it
   * registered. Two cards give the panel its other cases: one from before
   * versioning, without a version, and one that consented to an earlier
   * version and accepted the one in force when it resubmitted.
   */
  consent?: "before-versioning" | "reconsented";
}

export const FAKE_BUSINESSES: readonly FakeBusiness[] = [
  {
    // Every optional field but the photo.
    id: "b5q68b2e72",
    name: "Plomería Los Fontaneros Ficticios",
    category: "servicios-del-hogar",
    zone: "huicalco",
    whatsapp: "7719990101",
    status: "published",
    origin: "seeded",
    trades: ["plomeria"],
    whatYouOffer: "Plomería, destape de drenajes y bombas de agua",
    homeDelivery: true,
    landline: "7719990151",
    address: "Calle Inventada 123, junto a la tiendita de la esquina (referencia de mentira)",
    // Rounded to about a kilometre: it points at no building.
    pin: { latitude: 19.84, longitude: -98.98 },
    openingHours: "Lunes a sábado de 9 de la mañana a 7 de la tarde",
    facebookUrl: "https://facebook.example/fontaneros.ficticios",
    registeredDaysAgo: 40,
    publishedDaysAgo: 38,
  },
  {
    id: "kamsdamstu",
    name: "Electricista Chispazo de Mentiras",
    category: "servicios-del-hogar",
    zone: "atempa",
    whatsapp: "7719990102",
    status: "published",
    trades: ["electricidad"],
    whatYouOffer: "Instalaciones eléctricas, cortos circuitos y centros de carga",
    homeDelivery: true,
    openingHours: "Todos los días de 8 a 8",
    registeredDaysAgo: 30,
    // The same instant as the cerrajería: the listing breaks the tie by name.
    publishedDaysAgo: 25,
  },
  {
    id: "65r9anw94p",
    name: "Cerrajería La Llave Inventada",
    category: "servicios-del-hogar",
    zone: "huicalco",
    whatsapp: "7719990103",
    status: "published",
    origin: "seeded",
    trades: ["cerrajeria"],
    whatYouOffer: "Aperturas, duplicado de llaves y cambio de chapas",
    registeredDaysAgo: 28,
    publishedDaysAgo: 25,
  },
  {
    // Only the required fields. Its trade is in neither its name nor its
    // "¿Qué ofreces?": only the search by trade finds it.
    id: "46ydv7h97a",
    name: "Cocina Doña Chela de Mentiras",
    category: "restaurantes-y-fondas",
    zone: "tizayuca-centro",
    whatsapp: "7719990104",
    status: "published",
    trades: ["fonda-comida-corrida"],
    registeredDaysAgo: 20,
    publishedDaysAgo: 18,
  },
  {
    // Keywords with accents; a link that is not Facebook.
    id: "s7hmtzvsk3",
    name: "Academia Halcones de Mentiras",
    category: "clubes-y-escuelas-deportivas",
    zone: "nuevo-tizayuca",
    whatsapp: "7719990105",
    status: "published",
    origin: "seeded",
    trades: ["futbol"],
    whatYouOffer:
      "Fútbol infantil para niñas y niños de 6 a 12 años, entrenamientos martes y jueves",
    landline: "7719990155",
    address: "Cancha inventada junto al parque (referencia de mentira)",
    openingHours: "Martes y jueves de 5 a 6:30 de la tarde",
    facebookUrl: "https://halcones-ficticios.example/club",
    registeredDaysAgo: 16,
    publishedDaysAgo: 15,
  },
  {
    id: "tr78g9sg27",
    name: "Club de Natación Delfines Inventados",
    category: "clubes-y-escuelas-deportivas",
    zone: "fuentes-de-tizayuca",
    whatsapp: "7719990106",
    status: "published",
    trades: ["natacion"],
    whatYouOffer: "Clases de natación para niños desde 4 años y para adultos",
    openingHours: "Martes a jueves de 5 a 8 de la noche, sábados de 9 a 12",
    registeredDaysAgo: 14,
    publishedDaysAgo: 12,
  },
  {
    id: "uw3ffjy6fw",
    name: "Estética Tijeras de Mentira",
    category: "belleza",
    zone: "haciendas-de-tizayuca",
    whatsapp: "7719990107",
    status: "published",
    origin: "seeded",
    trades: ["estetica", "unas", "maquillaje"],
    whatYouOffer: "Corte, tinte, uñas y maquillaje para eventos",
    homeDelivery: true,
    openingHours: "Lunes a sábado de 10 a 8",
    registeredDaysAgo: 12,
    publishedDaysAgo: 10,
  },
  {
    // The zone "Otra", not normalized: free text and no catalogue zone.
    id: "697wvtkk7e",
    name: "Abarrotes La Esperanza Inventada",
    category: "abarrotes-y-comercio",
    zone: { other: "Privada Los Colibríes Imaginarios" },
    whatsapp: "7719990108",
    status: "published",
    trades: ["abarrotes"],
    whatYouOffer: "Abarrotes, refrescos, recargas y garrafones",
    homeDelivery: true,
    registeredDaysAgo: 10,
    publishedDaysAgo: 8,
  },
  {
    id: "5dncvpyj8k",
    name: "Veterinaria Patitas Ficticias",
    category: "salud",
    zone: "el-cid",
    whatsapp: "7719990109",
    status: "published",
    origin: "seeded",
    trades: ["veterinaria"],
    whatYouOffer: "Consultas, vacunas y desparasitación",
    landline: "7719990159",
    openingHours: "Lunes a sábado de 9 a 7",
    registeredDaysAgo: 8,
    publishedDaysAgo: 6,
  },
  {
    // With a photo: the newest card of "Salud", first in its listing.
    id: "rq7ka9z3yd",
    name: "Farmacia La Pastilla de Mentiras",
    category: "salud",
    zone: "atempa",
    whatsapp: "7719990113",
    status: "published",
    origin: "seeded",
    trades: ["farmacia"],
    whatYouOffer: "Medicamentos, material de curación y toma de presión",
    homeDelivery: true,
    openingHours: "Todos los días de 8 de la mañana a 10 de la noche",
    registeredDaysAgo: 3,
    publishedDaysAgo: 1,
    photoKey: "yya626vdevvbuxa5avc2n8e6",
  },
  {
    // With a photo: the oldest card of "Salud", below the placeholder.
    id: "evr69edxat",
    name: "Dentista Sonrisa de Mentiras",
    category: "salud",
    zone: "tizayuca-centro",
    whatsapp: "7719990114",
    status: "published",
    trades: ["dentista"],
    whatYouOffer: "Limpiezas, resinas y extracciones",
    openingHours: "Lunes a viernes de 10 a 7",
    registeredDaysAgo: 22,
    publishedDaysAgo: 20,
    photoKey: "rt2874ra8hntwxavrv7rc2f4",
  },
  {
    id: "5k3fca733a",
    name: "Taller Mecánico El Tornillo Inventado",
    category: "talleres",
    zone: "zona-industrial-tizayuca",
    whatsapp: "7719990110",
    status: "published",
    trades: ["taller-mecanico"],
    whatYouOffer: "Afinación, frenos y suspensión",
    openingHours: "Lunes a viernes de 8 a 6",
    registeredDaysAgo: 6,
    publishedDaysAgo: 4,
  },
  {
    // Waiting for review for more than 48 hours, and from before versioning.
    id: "c9yaseemtj",
    name: "Barbería El Corte Imaginario",
    category: "belleza",
    zone: "los-heroes-tizayuca",
    whatsapp: "7719990111",
    status: "in_review",
    whatYouOffer: "Corte de caballero y arreglo de barba",
    landline: "7719990161",
    openingHours: "Lunes a sábado de 10 a 8",
    registeredDaysAgo: 3,
    consent: "before-versioning",
  },
  {
    // Rejected after a resubmission that accepted the notice in force.
    id: "vj47rbgwgu",
    name: "Taller Fantasma de Mentiras",
    category: "talleres",
    zone: "emiliano-zapata",
    whatsapp: "7719990112",
    status: "rejected",
    whatYouOffer: "Reparamos de todo",
    registeredDaysAgo: 12,
    rejected: {
      daysAgo: 11,
      reason:
        "El número no contesta y no pudimos confirmar que el negocio exista (motivo de mentira).",
    },
    consent: "reconsented",
  },
];
