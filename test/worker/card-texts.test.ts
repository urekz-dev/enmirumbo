// The pure half of the business card (docs/specs/public-directory.md): its URL
// (src/core/business/card-path.ts), its contact links and "Perdí mi enlace"
// (src/core/business/contact.ts), the addresses of its report
// (src/core/report/paths.ts), its title, description and structured data
// (src/core/seo/card.ts), and the phrases of the trades
// (src/core/catalogue/trade-phrases.ts). The card read from the database is
// tested in card.test.ts; the rendered card in test/astro/business-card.test.ts
// and end to end in test/e2e/business-card.spec.ts.
import { describe, expect, it } from "vite-plus/test";
import type { PublishedCard } from "../../src/core/business/card.ts";
import {
  businessSlug,
  CARD_SEGMENT,
  cardIdOf,
  cardPath,
  cardSegment,
} from "../../src/core/business/card-path.ts";
import {
  callLink,
  directionsLink,
  lostLinkLink,
  lostLinkMessage,
  nationalNumber,
  registeredPage,
  WHATSAPP_MESSAGE,
  whatsappLink,
} from "../../src/core/business/contact.ts";
import { isReservedSegment } from "../../src/core/catalogue/root-urls.ts";
import {
  REPORT_SEGMENT,
  REPORTED_CARD_PARAM,
  reportPath,
  reportThanksPath,
  THANKS_SEGMENT,
} from "../../src/core/report/paths.ts";
import { TRADE_PHRASES, tradePhrase } from "../../src/core/catalogue/trade-phrases.ts";
import { isMeasured } from "../../src/lib/analytics.ts";
import {
  cardDescription,
  cardTitle,
  hideContactNumbers,
  localBusinessData,
  MAX_DESCRIPTION_LENGTH,
  serializeJsonLd,
  zoneNamesLocality,
} from "../../src/core/seo/card.ts";

const TIZAYUCA = {
  name: "Tizayuca",
  slug: "tizayuca",
  state: { name: "Hidalgo", slug: "hidalgo" },
};
const OTHER = {
  name: "Pueblo Uno",
  slug: "pueblo-uno",
  state: { name: "Estado de prueba 92", slug: "estado-de-prueba-92" },
};

/** A published card with every optional field, overridable. */
function card(overrides: Partial<PublishedCard> = {}): PublishedCard {
  return {
    id: "b5q68b2e72",
    name: "Plomería Los Fontaneros Ficticios",
    category: { name: "Servicios del hogar", slug: "servicios-del-hogar" },
    zoneName: "Huicalco",
    zoneSlug: "huicalco",
    whatsapp: "7719990101",
    whatYouOffer: "Plomería, destape de drenajes y bombas de agua.",
    homeDelivery: true,
    landline: "7719990151",
    address: "a un lado de la primaria, calle Morelos",
    openingHours: "Lunes a sábado de 9 a 7",
    pageUrl: "https://mi-negocio.example/perfil",
    trades: [
      { name: "Plomería", slug: "plomeria" },
      { name: "Cerrajería", slug: "cerrajeria" },
    ],
    photoKey: null,
    ...overrides,
  };
}

describe("Public URLs carry the state and the municipality (v2): the card's URL", () => {
  // Scenario: a card under the locality
  it("is /{estado}/{municipio}/negocio/<slug>-<id>", () => {
    expect(cardPath(TIZAYUCA, card())).toBe(
      "/hidalgo/tizayuca/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72",
    );
    expect(cardPath(OTHER, card())).toBe(
      "/estado-de-prueba-92/pueblo-uno/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72",
    );
  });

  it("negocio is one of the site's reserved segments", () => {
    expect(CARD_SEGMENT).toBe("negocio");
    expect(isReservedSegment(CARD_SEGMENT)).toBe(true);
  });
});

describe("An outdated card URL redirects to its current URL (v2): the readable part", () => {
  it.for([
    ["Plomería Los Fontaneros Ficticios", "plomeria-los-fontaneros-ficticios"],
    ["Estética Tijeras de Mentira", "estetica-tijeras-de-mentira"],
    ["Piñatas Doña Güera", "pinatas-dona-guera"],
    ["  Tacos   «El Güero» #1!  ", "tacos-el-guero-1"],
    ["Fonda / comida corrida", "fonda-comida-corrida"],
    ["Tacos </script><script>alert(1)</script>", "tacos-script-script-alert-1-script"],
  ])("%s → %s", ([name = "", slug = ""]) => {
    expect(businessSlug(name)).toBe(slug);
  });

  it("a name that leaves no slug gives the identifier alone", () => {
    expect(businessSlug("🌮🌮 ¡¡!!")).toBe("");
    expect(cardSegment({ name: "🌮🌮 ¡¡!!", id: "b5q68b2e72" })).toBe("b5q68b2e72");
  });

  it("the identifier is the ten characters of the alphabet after the last hyphen", () => {
    expect(cardIdOf("plomeria-los-fontaneros-ficticios-b5q68b2e72")).toBe("b5q68b2e72");
    expect(cardIdOf("un-nombre-viejo-b5q68b2e72")).toBe("b5q68b2e72");
    expect(cardIdOf("b5q68b2e72")).toBe("b5q68b2e72");
  });

  it.for([
    "",
    "plomeria",
    "plomeria-",
    "plomeria-b5q68b2e7", // nine characters
    "plomeria-b5q68b2e722", // eleven
    "plomeria-B5Q68B2E72", // capitals
    "plomeria-b5q68b2e7l", // a confusable character
    "plomeria-b5q68b2e7%00",
    "plomeria-b5q68b2e72-extra",
  ])("%j names no identifier", (segment) => {
    expect(cardIdOf(segment)).toBeNull();
  });
});

describe("Contact buttons on the card with WhatsApp as the main action: the links", () => {
  it("a Mexican number in its national form", () => {
    expect(nationalNumber("7719990101")).toBe("7719990101");
    expect(nationalNumber("+52 771 999 0101")).toBe("7719990101");
    expect(nationalNumber("521 (771) 999-01-01")).toBe("7719990101");
    expect(nationalNumber("999 0101")).toBeNull();
    // A dialing code (call forwarding) is not a number.
    expect(nationalNumber("*21*7719990101#")).toBeNull();
    expect(nationalNumber("llámame")).toBeNull();
  });

  // The prefilled WhatsApp message names the directory with the current brand
  it("WhatsApp opens the business's conversation with the message already written", () => {
    expect(WHATSAPP_MESSAGE).toBe("Hola, te vi en enmirumbo. ¿Me das informes?");
    const link = whatsappLink("7719990101");
    expect(link).toBe(
      "https://wa.me/527719990101?text=Hola%2C%20te%20vi%20en%20enmirumbo.%20%C2%BFMe%20das%20informes%3F",
    );
    expect(new URL(link!).searchParams.get("text")).toBe(WHATSAPP_MESSAGE);
    expect(whatsappLink("no es un número")).toBeNull();
  });

  it("a landline of ten national digits calls; anything else does not", () => {
    expect(callLink("771 999 0151")).toBe("tel:+527719990151");
    expect(callLink(null)).toBeNull();
    expect(callLink("999 0151")).toBeNull();
    expect(callLink("pregunta en la tienda")).toBeNull();
  });

  // Scenario: "Cómo llegar" opens the map with what the business entered
  it("directions search the reference, its zone and the locality from its record", () => {
    const link = directionsLink("a un lado de la primaria", "Huicalco", TIZAYUCA);
    const url = new URL(link!);
    expect(`${url.origin}${url.pathname}`).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("query")).toBe(
      "a un lado de la primaria, Huicalco, Tizayuca, Hidalgo",
    );
    expect(new URL(directionsLink("junto al kiosco", null, OTHER)!).searchParams.get("query")).toBe(
      "junto al kiosco, Pueblo Uno, Estado de prueba 92",
    );
  });

  // Scenario: business without a phone or an address
  it("without an address or references there are no directions: nothing is invented", () => {
    expect(directionsLink(null, "Huicalco", TIZAYUCA)).toBeNull();
    expect(directionsLink("   ", "Huicalco", TIZAYUCA)).toBeNull();
  });

  // Scenario: the link to the registered page does not promise Facebook
  it("the registered page shows the real domain it leads to", () => {
    expect(registeredPage("https://mi-negocio.example/perfil")).toEqual({
      href: "https://mi-negocio.example/perfil",
      domain: "mi-negocio.example",
    });
    expect(registeredPage("https://www.facebook.com/negocio.ficticio")?.domain).toBe(
      "facebook.com",
    );
    expect(registeredPage("javascript:alert(1)")).toBeNull();
    expect(registeredPage("no es una dirección")).toBeNull();
    expect(registeredPage(null)).toBeNull();
  });
});

describe('"Perdí mi enlace" button on the card, toward the admin\'s WhatsApp: the link', () => {
  const MESSAGE =
    "Hola, soy de «Plomería Los Fontaneros Ficticios» en enmirumbo y perdí el enlace para " +
    "editar mi ficha. Les escribo desde el número que registré, ¿me lo pueden pasar?";

  // Scenario: asking for the link from the card
  it("opens the admin's conversation with the message already written, naming the business", () => {
    expect(lostLinkMessage("Plomería Los Fontaneros Ficticios")).toBe(MESSAGE);
    const link = new URL(lostLinkLink("7719990100", "Plomería Los Fontaneros Ficticios")!);
    expect(`${link.origin}${link.pathname}`).toBe("https://wa.me/527719990100");
    expect(link.searchParams.get("text")).toBe(MESSAGE);
    expect([...link.searchParams.keys()]).toEqual(["text"]);
  });

  // "Perdí mi enlace" opens WhatsApp to the admin of the card's locality (v2):
  // the number is the locality's, as its record keeps it.
  it("to the contact WhatsApp of the locality, whatever its locality", () => {
    expect(lostLinkLink("+52 771 999 0190", "Herrería")).toMatch(
      /^https:\/\/wa\.me\/527719990190\?/,
    );
    expect(lostLinkLink("7719990100", "Herrería")).not.toBe(lostLinkLink("7719990190", "Herrería"));
  });

  // Scenario: no admin number configured
  it("without a number of ten digits there is no link, so the card shows no block", () => {
    expect(lostLinkLink("", "Herrería")).toBeNull();
    expect(lostLinkLink("999 0100", "Herrería")).toBeNull();
    expect(lostLinkLink("pregúntale al admin", "Herrería")).toBeNull();
  });

  it("a name with symbols travels encoded, inside the message", () => {
    const name = "Tacos & Más «El Güero» #1?";
    const link = new URL(lostLinkLink("7719990100", name)!);
    expect(link.searchParams.get("text")).toBe(lostLinkMessage(name));
    expect([...link.searchParams.keys()]).toEqual(["text"]);
  });
});

describe("Report mini-form without an account, with a closed-list reason and optional comment: the addresses", () => {
  it("the form lives under the card, at its current address", () => {
    expect(reportPath(TIZAYUCA, card())).toBe(
      "/hidalgo/tizayuca/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72/reportar",
    );
    expect(reportPath(OTHER, card({ name: "★★★" }))).toBe(
      "/estado-de-prueba-92/pueblo-uno/negocio/b5q68b2e72/reportar",
    );
  });

  // The report form lands on its thank-you page (v2)
  it("the thank-you page is /reportar/gracias of the locality, naming the card", () => {
    expect(reportThanksPath(TIZAYUCA, "b5q68b2e72")).toBe(
      "/hidalgo/tizayuca/reportar/gracias?negocio=b5q68b2e72",
    );
    expect([REPORT_SEGMENT, THANKS_SEGMENT, REPORTED_CARD_PARAM]).toEqual([
      "reportar",
      "gracias",
      "negocio",
    ]);
    // Its first segment is reserved, so no catalogue slug can take it.
    expect(isReservedSegment(REPORT_SEGMENT)).toBe(true);
  });
});

describe("Own title and description on each directory page, with its canonical: the card", () => {
  it("title: «Negocio» en «Colonia», «Municipio»", () => {
    expect(cardTitle(card(), TIZAYUCA)).toBe(
      "Plomería Los Fontaneros Ficticios en Huicalco, Tizayuca",
    );
  });

  it("a zone that already names the municipality does not repeat it", () => {
    expect(cardTitle(card({ zoneName: "Haciendas de Tizayuca" }), TIZAYUCA)).toBe(
      "Plomería Los Fontaneros Ficticios en Haciendas de Tizayuca",
    );
    expect(zoneNamesLocality("Tizayuca Centro", "Tizayuca")).toBe(true);
    expect(zoneNamesLocality("Los Héroes Tizayuca", "Tizayuca")).toBe(true);
    expect(zoneNamesLocality("Tizayucan", "Tizayuca")).toBe(false);
  });

  it("without a zone: «Negocio» en «Municipio», from the record", () => {
    expect(cardTitle(card({ zoneName: null, zoneSlug: null }), OTHER)).toBe(
      "Plomería Los Fontaneros Ficticios en Pueblo Uno",
    );
  });

  // Scenario: card description with what the business wrote
  it("the description is what the business wrote, without its WhatsApp or its phone", () => {
    const description = cardDescription(card(), TIZAYUCA);
    expect(description).toBe("Plomería, destape de drenajes y bombas de agua.");
    expect(description).not.toMatch(/7719990101|7719990151/);
  });

  // Scenario: a number written inside "¿Qué ofreces?"
  it("a number written inside it is hidden", () => {
    expect(
      cardDescription(
        card({ whatYouOffer: "Plomería 24 horas, llámanos al 771 000 0000." }),
        TIZAYUCA,
      ),
    ).toBe("Plomería 24 horas, llámanos al …");
    expect(hideContactNumbers("Tel. 771.999.01.51 o +52 (771) 999-0101, pregunte")).toBe(
      "Tel. … o … pregunte",
    );
    expect(hideContactNumbers("Niñas y niños de 6 a 12 años, L-S 9am-7pm, $1,200")).toBe(
      "Niñas y niños de 6 a 12 años, L-S 9am-7pm, $1,200",
    );
  });

  it("a long text is cut at a word, within the limit", () => {
    const long = `${"palabra ".repeat(30)}fin`;
    const description = cardDescription(card({ whatYouOffer: long }), TIZAYUCA);
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH + 1);
    expect(description).toMatch(/palabra…$/);
  });

  // Scenario: card without "¿Qué ofreces?"
  it("without it, the fallback sentence with its name and its zone", () => {
    expect(cardDescription(card({ whatYouOffer: null }), TIZAYUCA)).toBe(
      "Plomería Los Fontaneros Ficticios en Huicalco, Tizayuca. Negocio verificado que contactas directo por WhatsApp.",
    );
  });
});

describe("Each published card emits Schema.org LocalBusiness", () => {
  const URL = "https://stage.enmirumbo.com/hidalgo/tizayuca/negocio/x-b5q68b2e72";

  // Scenario: published card with structured data
  it("names the business, its URL, its zone in the locality, its category and its trades", () => {
    expect(localBusinessData(card(), TIZAYUCA, URL)).toEqual({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Plomería Los Fontaneros Ficticios",
      url: URL,
      description: "Plomería, destape de drenajes y bombas de agua.",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Huicalco",
        addressLocality: "Tizayuca",
        addressRegion: "Hidalgo",
        addressCountry: "MX",
      },
      knowsAbout: ["Servicios del hogar", "Plomería", "Cerrajería"],
    });
  });

  // Scenario: never the exact address nor the number
  it("never the address or references, the landline, the WhatsApp or the opening hours", () => {
    const json = JSON.stringify(
      localBusinessData(card({ whatYouOffer: "Llámanos al 771 999 0101" }), TIZAYUCA, URL),
    );
    for (const value of [
      "calle Morelos",
      "primaria",
      "7719990151",
      "7719990101",
      "999 0101",
      "Lunes",
    ]) {
      expect(json).not.toContain(value);
    }
    expect(json).not.toMatch(/telephone|openingHours|geo|latitude/);
  });

  // Scenario: business without a catalogue zone
  it('a zone "Otra" is left out, and the locality stays', () => {
    const data = localBusinessData(
      card({ zoneName: "atrás del panteón viejo", zoneSlug: null }),
      TIZAYUCA,
      URL,
    );
    expect(data.address).toEqual({
      "@type": "PostalAddress",
      addressLocality: "Tizayuca",
      addressRegion: "Hidalgo",
      addressCountry: "MX",
    });
    expect(JSON.stringify(data)).not.toContain("panteón");
  });

  it("without a base for absolute URLs, without a url; without an offer, without a description", () => {
    const data = localBusinessData(card({ whatYouOffer: null }), OTHER, null);
    expect(data).not.toHaveProperty("url");
    expect(data).not.toHaveProperty("description");
    expect(data.address.addressLocality).toBe("Pueblo Uno");
    expect(data.address.addressRegion).toBe("Estado de prueba 92");
  });

  // Scenario: the block's image is always built by the site. The address
  // comes from src/lib/media.ts, which builds it only from a photo key the
  // server generated (test/worker/photos.test.ts); the block never reads the
  // stored value.
  it("the image is the address the site built, and there is none without one", () => {
    const photo = "https://media.enmirumbo.com/photos/yya626vdevvbuxa5avc2n8e6/full.webp";
    expect(localBusinessData(card(), TIZAYUCA, URL, photo).image).toEqual([photo]);
    expect(localBusinessData(card(), TIZAYUCA, URL, null)).not.toHaveProperty("image");
    expect(
      localBusinessData(card({ photoKey: "https://evil.example/pixel.png" }), TIZAYUCA, URL),
    ).not.toHaveProperty("image");
  });

  // Scenario: name with markup inside
  it("markup the business wrote stays text inside one block", () => {
    const name = "Tacos </script><script>alert(1)</script> & “Güero”\u2028";
    const json = serializeJsonLd(localBusinessData(card({ name }), TIZAYUCA, URL));
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(json).toContain("\\u003c/script\\u003e");
    expect((JSON.parse(json) as { name: string }).name).toBe(name);
  });
});

describe("From the card the pages of its trades are reached: the phrase of a trade", () => {
  // Indexable trade page: "the sports trade lands the search that PRD §6.5 asks for"
  it("a curated phrase where people search for something else", () => {
    expect(tradePhrase({ name: "Futbol", slug: "futbol" })).toBe("Clases de futbol");
    expect(tradePhrase({ name: "Fonda / comida corrida", slug: "fonda-comida-corrida" })).toBe(
      "Fondas y comida corrida",
    );
  });

  it("the catalogue name for the others, and never an empty phrase", () => {
    expect(tradePhrase({ name: "Plomería", slug: "plomeria" })).toBe("Plomería");
    expect(tradePhrase({ name: "  ", slug: "giro-nuevo" })).toBe("giro-nuevo");
    for (const phrase of Object.values(TRADE_PHRASES)) expect(phrase.trim()).not.toBe("");
  });
});

describe("The card view is measured on its own, without custom instrumentation", () => {
  // Scenario: opening a card counts as a view (the page view Umami records by
  // itself wherever the layout loads its script)
  it("the card's route is in the measured trunk of the site", () => {
    const url = new URL(
      "https://enmirumbo.com/hidalgo/tizayuca/negocio/plomeria-de-prueba-b5q68b2e72",
    );
    expect(isMeasured(url, "/[state]/[municipality]/negocio/[card]")).toBe(true);
  });
});
