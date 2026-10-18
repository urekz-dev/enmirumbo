// What a card says about itself to search engines and to the apps it is shared
// on (docs/specs/public-directory.md, "Own title and description on each
// directory page, with its canonical", "The card looks good when shared over
// WhatsApp or Facebook" and "Each published card emits Schema.org
// LocalBusiness"). Pure: it gets the card and the locality, already read, and
// the absolute URL of the card, already built.
//
// Nothing here ever takes the business's WhatsApp, its landline, its address
// or references, its opening hours or its pin. "¿Qué ofreces?" is free text
// where many businesses write their number, so whatever leaves the card from
// it (the description and the structured data) goes through
// `hideContactNumbers` first; the card itself shows people the full text.
import type { PublishedCard } from "../business/card.ts";
import type { ServedLocality } from "../locality/served.ts";
import { normalizeText } from "../search/normalize.ts";

/** What the texts need of the locality: its name and its state's, from the record. */
export type CardLocality = Pick<ServedLocality, "name"> & {
  state: Pick<ServedLocality["state"], "name">;
};

/** What a hidden number becomes. */
export const HIDDEN_NUMBER = "…";

/**
 * Seven or more digits, with the separators a phone number is written with
 * between them (spaces, hyphens, dots, brackets, slashes, `+`). Seven is the
 * length of a local number; Mexican ones have ten. Letters and commas are no
 * separators, so "de 6 a 12 años", "L-S 9am-7pm", "$1,200" and "24 horas"
 * survive. Conservative on purpose: "2020-2024" is hidden too.
 */
const DIGIT_SEQUENCE = /\+?\d(?:[\s().\-+/·–—]*\d){6,}/g;

/**
 * The text with its sequences of seven or more digits replaced by `…`, the
 * punctuation right after them dropped ("llámanos al …", not "al ….") and its
 * whitespace collapsed.
 */
export function hideContactNumbers(text: string): string {
  return text
    .replace(DIGIT_SEQUENCE, HIDDEN_NUMBER)
    .replace(/…[.,;:!¡¿?\-–—]+/g, HIDDEN_NUMBER)
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether the zone's name already says the locality's ("Haciendas de Tizayuca"). */
export function zoneNamesLocality(zoneName: string, localityName: string): boolean {
  const locality = normalizeText(localityName);
  return locality !== "" && ` ${normalizeText(zoneName)} `.includes(` ${locality} `);
}

/** "«Colonia», «Municipio»", or the zone alone when it already names the municipality. */
export function zoneInLocality(zoneName: string, locality: CardLocality): string {
  const zone = zoneName.trim();
  return zoneNamesLocality(zone, locality.name) ? zone : `${zone}, ${locality.name}`;
}

type Titled = Pick<PublishedCard, "name" | "zoneName">;

/** "«Negocio» en «Colonia», «Municipio»", or "«Negocio» en «Municipio»" without a zone. */
export function cardTitle(card: Titled, locality: CardLocality): string {
  const place = card.zoneName ? zoneInLocality(card.zoneName, locality) : locality.name;
  return `${card.name.trim()} en ${place}`;
}

/** Search engines cut a description at about 160 characters. */
export const MAX_DESCRIPTION_LENGTH = 160;

/** The text cut at its last space within the limit, with `…`. */
function shorten(text: string): string {
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text;
  const cut = text.slice(0, MAX_DESCRIPTION_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * What the business wrote in "¿Qué ofreces?", without numbers and cut if
 * long, or else the fallback sentence with its name and zone.
 */
export function cardDescription(
  card: Titled & Pick<PublishedCard, "whatYouOffer">,
  locality: CardLocality,
): string {
  const offer = card.whatYouOffer ? hideContactNumbers(card.whatYouOffer) : "";
  if (offer !== "") return shorten(offer);
  return `${cardTitle(card, locality)}. Negocio verificado que contactas directo por WhatsApp.`;
}

/** The Schema.org block of a published card. */
export interface LocalBusinessData {
  "@context": "https://schema.org";
  "@type": "LocalBusiness";
  name: string;
  url?: string;
  description?: string;
  image?: string[];
  address: {
    "@type": "PostalAddress";
    streetAddress?: string;
    addressLocality: string;
    addressRegion: string;
    addressCountry: "MX";
  };
  knowsAbout: string[];
}

/**
 * The structured data of a published card: what is honest to publish. The
 * generic `LocalBusiness`, since calling a business something it is not
 * would be worse than not marking it. The only location is the catalogue
 * zone inside an address of the locality; a zone "Otra" is free text, so it
 * is left out. Never the opening hours, the address or references, the pin,
 * the WhatsApp or the landline. The image is the address of the card's photo
 * that the site built from its key (src/lib/media.ts), never anything
 * stored; without one the block has no image.
 */
export function localBusinessData(
  card: Pick<
    PublishedCard,
    "name" | "whatYouOffer" | "zoneName" | "zoneSlug" | "category" | "trades"
  >,
  locality: CardLocality,
  url: string | null,
  image: string | null = null,
): LocalBusinessData {
  const description = card.whatYouOffer ? hideContactNumbers(card.whatYouOffer) : "";
  const zone = card.zoneSlug !== null && card.zoneName !== null ? card.zoneName : null;
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: card.name,
    ...(url === null ? {} : { url }),
    ...(description === "" ? {} : { description }),
    ...(image === null ? {} : { image: [image] }),
    address: {
      "@type": "PostalAddress",
      ...(zone === null ? {} : { streetAddress: zone }),
      addressLocality: locality.name,
      addressRegion: locality.state.name,
      addressCountry: "MX",
    },
    knowsAbout: [card.category.name, ...card.trades.map((trade) => trade.name)],
  };
}

/**
 * JSON for a `<script type="application/ld+json">` block. `JSON.stringify`
 * leaves a `</script>` the business wrote as it is, so `<`, `>` and `&` are
 * written as Unicode escapes, and so are the line and paragraph separators:
 * the block stays one block, and the text stays text.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
