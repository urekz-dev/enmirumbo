// Scenarios of docs/specs/public-directory.md for the business card and the
// listing card, rendered with Astro's Container API: "Business card at its own
// URL with the registered information and the verified seal", "Contact
// buttons on the card with WhatsApp as the main action", "The prefilled
// WhatsApp message names the directory with the current brand", "The zone is
// published, never the exact address nor the card's internal data", "From the
// card the pages of its trades are reached", "The card shows the business
// photo when it has one", "Each published card emits Schema.org
// LocalBusiness", "The listing card brings the essentials and WhatsApp without
// extra taps", "Heading levels never skip (v2)" and "Only the WhatsApp buttons
// of the card and the listing card are measured (v2)", with docs/specs/
// base-layout.md, "Two product events and the no-results tag are recorded,
// only in production (v2)". The page that reads the card from the database is tested end to end
// (test/e2e/business-card.spec.ts).
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { PublishedCard } from "../../src/core/business/card.ts";
import type { ListingBusiness } from "../../src/core/business/listing.ts";
import type { ServedLocality } from "../../src/core/locality/served.ts";
import type { Analytics } from "../../src/lib/analytics.ts";
import BusinessCard from "../../src/components/BusinessCard.astro";
import CardTrades from "../../src/components/CardTrades.astro";
import ContactButtons from "../../src/components/ContactButtons.astro";
import JsonLd from "../../src/components/JsonLd.astro";
import ListingCard from "../../src/components/ListingCard.astro";
import { collapseProblems } from "../responsive-rules.ts";
import { env as workerEnv } from "./cloudflare-workers.ts";

const TIZAYUCA: ServedLocality = {
  code: "13069",
  name: "Tizayuca",
  slug: "tizayuca",
  state: { code: "13", name: "Hidalgo", slug: "hidalgo" },
  timeZone: "America/Mexico_City",
  contactWhatsapp: "7719990100",
  othersActive: false,
  seat: null,
};

const OTHER: ServedLocality = {
  ...TIZAYUCA,
  code: "92001",
  name: "Pueblo Uno",
  slug: "pueblo-uno",
  state: { code: "92", name: "Estado de prueba 92", slug: "estado-de-prueba-92" },
};

const MEASURED: Analytics = {
  scriptUrl: "https://cloud.umami.is/script.js",
  websiteId: "94db1cb1-74f4-4a40-ad6c-962362670409",
};

const WHATSAPP_HREF =
  "https://wa.me/527719990101?text=Hola%2C%20te%20vi%20en%20enmirumbo.%20%C2%BFMe%20das%20informes%3F";

/** A published card with every optional field, overridable. */
function complete(overrides: Partial<PublishedCard> = {}): PublishedCard {
  return {
    id: "b5q68b2e72",
    name: "Plomería Los Fontaneros Ficticios",
    category: { name: "Servicios del hogar", slug: "servicios-del-hogar" },
    zoneName: "Huicalco",
    zoneSlug: "huicalco",
    whatsapp: "7719990101",
    whatYouOffer: "Plomería, destape de drenajes y bombas de agua",
    homeDelivery: true,
    landline: "7719990151",
    address: "a un lado de la primaria, calle Morelos",
    openingHours: "Lunes a sábado de 9 a 7",
    pageUrl: "https://mi-negocio.example/perfil",
    trades: [
      { name: "Plomería", slug: "plomeria" },
      { name: "Fonda / comida corrida", slug: "fonda-comida-corrida" },
    ],
    photoKey: null,
    ...overrides,
  };
}

/** The same card with only the required fields. */
function minimal(overrides: Partial<PublishedCard> = {}): PublishedCard {
  return complete({
    whatYouOffer: null,
    homeDelivery: false,
    landline: null,
    address: null,
    openingHours: null,
    pageUrl: null,
    trades: [],
    ...overrides,
  });
}

/**
 * What every card shows after its contact block (test/astro/report.test.ts):
 * the report link and the owner's block, as text and as links.
 */
const SECONDARY_TEXT = ["Reportar este negocio", "¿Es tu negocio?", "Perdí mi enlace"];
const SECONDARY_LINKS = ["Reportar este negocio", "Perdí mi enlace"];

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

function renderCard(
  card: PublishedCard,
  { locality = TIZAYUCA, analytics = null as Analytics | null } = {},
): Promise<string> {
  return container.renderToString(BusinessCard, { props: { card, locality, analytics } });
}

function renderListing(
  business: Partial<ListingBusiness> = {},
  locality = TIZAYUCA,
  analytics: Analytics | null = null,
) {
  const props: ListingBusiness = {
    id: "uw3ffjy6fw",
    name: "Estética Tijeras de Mentira",
    categorySlug: "belleza",
    zoneName: "Haciendas de Tizayuca",
    zoneSlug: "haciendas-de-tizayuca",
    homeDelivery: true,
    whatsapp: "7719990107",
    photoKey: null,
    ...business,
  };
  return container.renderToString(ListingCard, {
    props: { business: props, locality, analytics },
  });
}

/** The text a person reads, one line per block; what is aria-hidden is not read. */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(\w+)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/<\/?(?:p|div|h[1-6]|li|ul|a|span|article|nav)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

interface Anchor {
  tag: string;
  href: string;
  text: string;
}

/** Every link, with its opening tag and its text. */
function anchors(html: string): Anchor[] {
  return [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map(([, tag = "", text = ""]) => ({
    tag,
    href: (/\bhref="([^"]*)"/.exec(tag)?.[1] ?? "").replaceAll("&amp;", "&"),
    text: visibleText(text),
  }));
}

function anchor(html: string, text: string): Anchor {
  const found = anchors(html).find((a) => a.text === text);
  if (!found) throw new Error(`no link "${text}" in ${html}`);
  return found;
}

/** The headings, in order, as `h1`, `h2`, … */
function headings(html: string): string[] {
  return [...html.matchAll(/<(h[1-6])\b/g)].map(([, level = ""]) => level);
}

describe("Business card at its own URL with the registered information and the verified seal", () => {
  // Scenario: complete card
  it("a complete card shows the name as the only h1, the seal and everything it registered", async () => {
    const html = await renderCard(complete());

    expect(headings(html)).toEqual(["h1"]);
    expect(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.trim()).toBe(
      "Plomería Los Fontaneros Ficticios",
    );
    expect(visibleText(html).split("\n")).toEqual([
      "Plomería Los Fontaneros Ficticios",
      "Negocio verificado",
      "A domicilio",
      "Huicalco",
      "Plomería, destape de drenajes y bombas de agua",
      "a un lado de la primaria, calle Morelos",
      "Horario:",
      "Lunes a sábado de 9 a 7",
      "Plomería",
      "Fondas y comida corrida",
      "Enviar WhatsApp",
      "Llamar",
      "Cómo llegar",
      "Ver su página (mi-negocio.example)",
      ...SECONDARY_TEXT,
    ]);
  });

  // Scenario: card of a business that filled in only the required fields
  it("a card with only the required fields has no empty section or label", async () => {
    const text = visibleText(await renderCard(minimal()));

    expect(text.split("\n")).toEqual([
      "Plomería Los Fontaneros Ficticios",
      "Negocio verificado",
      "Huicalco",
      "Enviar WhatsApp",
      ...SECONDARY_TEXT,
    ]);
    expect(text).not.toMatch(/No disponible|Horario|Teléfono|A domicilio/);
  });

  // "The card shows the business photo when it has one", scenario: card
  // without a photo
  it("a card without a photo shows no image, frame or text about one", async () => {
    const html = await renderCard(complete());

    expect(html).not.toMatch(/<img\b|photo-placeholder|aria-hidden="true" class="flex h-full/);
    expect(visibleText(html)).not.toMatch(/foto/i);
  });

  it("what the business wrote is text: markup in it is never markup", async () => {
    const html = await renderCard(
      complete({
        name: "Tacos <script>alert(1)</script>",
        openingHours: '<img src=x onerror="1">',
      }),
    );

    // Inside a quoted attribute (the button's label) a "<" is only text.
    expect(html.replace(/="[^"]*"/g, "")).not.toMatch(/<script\b|<img\b/);
    expect(html).toContain("Tacos &lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("Contact buttons on the card with WhatsApp as the main action", () => {
  // Scenario: WhatsApp as the main action
  it('"Enviar WhatsApp" is the only control in the action green, and opens the conversation', async () => {
    const html = await renderCard(complete());
    const whatsapp = anchor(html, "Enviar WhatsApp");

    expect(whatsapp.href).toBe(WHATSAPP_HREF);
    expect(whatsapp.tag).toContain('target="_blank"');
    expect(whatsapp.tag).toContain('rel="noopener noreferrer"');
    expect(whatsapp.tag).toContain(
      'aria-label="Enviar WhatsApp a Plomería Los Fontaneros Ficticios"',
    );
    expect(whatsapp.tag).toMatch(/\bbg-action\b/);
    expect(whatsapp.tag).toMatch(/\bmin-h-11\b/);
    // Nothing else uses the action green.
    const green = [...html.matchAll(/class="([^"]*)"/g)].filter(([, list = ""]) =>
      /(?:^|\s)(?:bg|text|border)-action(?:-strong)?(?:\s|$)/.test(list),
    );
    expect(green).toHaveLength(1);
  });

  // Scenario: buttons that depend on what was registered
  it("a landline and an address but no page: Llamar and Cómo llegar, and no external page", async () => {
    // Without trades, whose links are no contact buttons.
    const html = await renderCard(complete({ pageUrl: null, trades: [] }));

    expect(anchors(html).map((a) => a.text)).toEqual([
      "Enviar WhatsApp",
      "Llamar",
      "Cómo llegar",
      ...SECONDARY_LINKS,
    ]);
  });

  // Scenario: business without a phone or an address
  it("without a landline or an address the only contact is Enviar WhatsApp", async () => {
    const html = await renderCard(
      complete({ landline: null, address: null, pageUrl: null, trades: [] }),
    );

    expect(anchors(html).map((a) => a.text)).toEqual(["Enviar WhatsApp", ...SECONDARY_LINKS]);
  });

  // base-layout, "Internal links to existing routes and protected external
  // links", scenario: call link
  it("Llamar is a tel: link that opens no new tab, and the buttons never show the number", async () => {
    const html = await renderCard(complete());
    const call = anchor(html, "Llamar");

    expect(call.href).toBe("tel:+527719990151");
    expect(call.tag).not.toContain("target=");
    expect(visibleText(html)).not.toMatch(/771\s*999/);
  });

  it("a landline that is not a number is shown as written, with no Llamar", async () => {
    const html = await renderCard(complete({ landline: "pregunta en la tienda" }));

    expect(anchors(html).map((a) => a.text)).not.toContain("Llamar");
    expect(html).not.toContain("tel:");
    expect(visibleText(html)).toContain("Teléfono:\npregunta en la tienda");
  });

  // Scenario: "Cómo llegar" opens the map with what the business entered
  it("Cómo llegar searches the reference with its zone and the locality, in a new tab", async () => {
    const directions = anchor(await renderCard(complete()), "Cómo llegar");

    expect(new URL(directions.href).searchParams.get("query")).toBe(
      "a un lado de la primaria, calle Morelos, Huicalco, Tizayuca, Hidalgo",
    );
    expect(directions.tag).toContain('target="_blank"');
    expect(directions.tag).toContain('rel="noopener noreferrer"');
  });

  it("another locality's card names its own locality, and Tizayuca appears nowhere", async () => {
    const html = await renderCard(complete(), { locality: OTHER });

    expect(new URL(anchor(html, "Cómo llegar").href).searchParams.get("query")).toBe(
      "a un lado de la primaria, calle Morelos, Huicalco, Pueblo Uno, Estado de prueba 92",
    );
    expect(html).not.toMatch(/tizayuca|hidalgo/i);
  });

  // Scenario: the link to the registered page does not promise Facebook
  it("the registered page shows the domain it leads to and never says Facebook", async () => {
    const html = await renderCard(complete());
    const page = anchor(html, "Ver su página (mi-negocio.example)");

    expect(page.href).toBe("https://mi-negocio.example/perfil");
    expect(page.tag).toContain('rel="noopener noreferrer"');
    expect(visibleText(html)).not.toMatch(/facebook/i);
  });

  // Scenario: reporting stays outside the contact block
  it("the contact block holds only the contact buttons; reporting and the owner's block come after it", async () => {
    const block = await container.renderToString(ContactButtons, {
      props: { card: complete(), locality: TIZAYUCA, analytics: null },
    });
    expect(anchors(block).map((a) => a.text)).toEqual([
      "Enviar WhatsApp",
      "Llamar",
      "Cómo llegar",
      "Ver su página (mi-negocio.example)",
    ]);

    const text = visibleText(await renderCard(complete()));
    expect(text.indexOf("Ver su página")).toBeLessThan(text.indexOf("Reportar este negocio"));
    expect(text.endsWith(SECONDARY_TEXT.join("\n"))).toBe(true);
  });
});

describe("The prefilled WhatsApp message names the directory with the current brand", () => {
  // Scenarios: the resident writes from a listing card; the resident writes
  // from the card
  it("the card and the listing card open the conversation with the same message", async () => {
    const fromCard = anchor(await renderCard(complete()), "Enviar WhatsApp").href;
    const fromListing = anchor(await renderListing({ whatsapp: "7719990101" }), "WhatsApp").href;

    expect(fromListing).toBe(fromCard);
    expect(new URL(fromCard).searchParams.get("text")).toBe(
      "Hola, te vi en enmirumbo. ¿Me das informes?",
    );
  });
});

describe("Only the WhatsApp buttons of the card and the listing card are measured (v2): the card", () => {
  // base-layout, "Two product events and the no-results tag are recorded,
  // only in production (v2)", scenario: other environments and excluded screens
  it("with the measurement off, no element carries an event attribute", async () => {
    expect(await renderCard(complete())).not.toContain("data-umami");
  });

  // Scenario: WhatsApp click
  it("with it on, Enviar WhatsApp declares whatsapp-card with the locality and the business's category", async () => {
    const html = await renderCard(complete(), { analytics: MEASURED });
    const whatsapp = anchor(html, "Enviar WhatsApp");

    expect(whatsapp.tag).toContain('data-umami-event="whatsapp-card"');
    expect(whatsapp.tag).toContain('data-umami-event-locality="hidalgo/tizayuca"');
    expect(whatsapp.tag).toContain('data-umami-event-category="servicios-del-hogar"');
    // Only those three attributes, and only on that button.
    expect(html.match(/data-umami[\w-]*/g)).toEqual([
      "data-umami-event",
      "data-umami-event-locality",
      "data-umami-event-category",
    ]);
    for (const text of ["Llamar", "Cómo llegar", "Ver su página (mi-negocio.example)"]) {
      expect(anchor(html, text).tag).not.toContain("data-umami");
    }
  });

  // base-layout, scenario: no business data inside a measurement attribute
  it("no measurement attribute carries the name, the number, the zone or the identifier", async () => {
    const html = await renderCard(complete(), { analytics: MEASURED });
    const values = [...html.matchAll(/data-umami[\w-]*="([^"]*)"/g)].map(([, value]) => value);

    expect(values).toEqual(["whatsapp-card", "hidalgo/tizayuca", "servicios-del-hogar"]);
  });
});

describe("From the card the pages of its trades are reached", () => {
  /** The links of the trades' navigation: [href, text, class]. */
  function tradeLinks(html: string): [string, string, string][] {
    const nav = /<nav aria-label="Lo que hace este negocio"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
    return [...(nav ?? "").matchAll(/<a href="([^"]*)" class="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
      ([, href = "", className = "", text = ""]) => [href, text.trim(), className],
    );
  }

  // Scenario: card with assigned trades
  it("each trade the admin assigned links to its page in the card's locality, with its curated phrase", async () => {
    const html = await container.renderToString(CardTrades, {
      props: { trades: complete().trades, locality: TIZAYUCA },
    });

    expect(tradeLinks(html).map(([href, text]) => [href, text])).toEqual([
      ["/hidalgo/tizayuca/plomeria", "Plomería"],
      ["/hidalgo/tizayuca/fonda-comida-corrida", "Fondas y comida corrida"],
    ]);
    // A touch area of at least 44px.
    for (const [, , className] of tradeLinks(html))
      expect(className.split(" ")).toContain("min-h-11");
  });

  it("the card links its trades under its own locality", async () => {
    const links = tradeLinks(await renderCard(complete(), { locality: OTHER }));

    expect(links.map(([href]) => href)).toEqual([
      "/estado-de-prueba-92/pueblo-uno/plomeria",
      "/estado-de-prueba-92/pueblo-uno/fonda-comida-corrida",
    ]);
  });

  // Scenario: card without trades
  it("a card without trades shows no trades section", async () => {
    expect(
      (
        await container.renderToString(CardTrades, { props: { trades: [], locality: TIZAYUCA } })
      ).trim(),
    ).toBe("");
    expect(await renderCard(minimal())).not.toContain("Lo que hace este negocio");
  });
});

describe("Each published card emits Schema.org LocalBusiness: the block", () => {
  // Scenario: name with markup inside
  it("is one data block whose markup stays text inside the data", async () => {
    const data = { "@type": "LocalBusiness", name: "Tacos </script><script>alert(1)</script>" };
    const html = await container.renderToString(JsonLd, { props: { data } });

    expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script type="application/ld+json">']);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const json = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
    expect(JSON.parse(json)).toEqual(data);
  });
});

describe("The listing card brings the essentials and WhatsApp without extra taps", () => {
  // Scenario: card content; scenario: the card leads to the public card
  it("shows the name as an h2 linked to the card, the zone, the tag and the green WhatsApp button", async () => {
    const html = await renderListing();

    expect(headings(html)).toEqual(["h2"]);
    expect(anchors(html).map(({ href, text }) => [href, text])).toEqual([
      [
        "/hidalgo/tizayuca/negocio/estetica-tijeras-de-mentira-uw3ffjy6fw",
        "Estética Tijeras de Mentira",
      ],
      [
        "https://wa.me/527719990107?text=Hola%2C%20te%20vi%20en%20enmirumbo.%20%C2%BFMe%20das%20informes%3F",
        "WhatsApp",
      ],
    ]);
    expect(visibleText(html).split("\n")).toEqual([
      "Estética Tijeras de Mentira",
      "Haciendas de Tizayuca",
      "A domicilio",
      "WhatsApp",
    ]);
  });

  // Scenario: direct WhatsApp from the card; scenario: accessible button label
  it("the WhatsApp button leaves in a new tab, above the card's link, and says whom it writes to", async () => {
    const whatsapp = anchor(await renderListing(), "WhatsApp");

    expect(whatsapp.tag).toContain('target="_blank"');
    expect(whatsapp.tag).toContain('rel="noopener noreferrer"');
    expect(whatsapp.tag).toContain('aria-label="Enviar WhatsApp a Estética Tijeras de Mentira"');
    expect(whatsapp.tag).toMatch(/\bbg-action\b/);
    expect(whatsapp.tag).toMatch(/\bmin-h-11\b/);
    expect(whatsapp.tag).toMatch(/\bz-10\b/);
    // The name's link stretches over the whole card.
    expect(anchor(await renderListing(), "Estética Tijeras de Mentira").tag).toContain(
      "after:absolute after:inset-0",
    );
  });

  // Scenario: "A domicilio" tag only when it applies
  it('"A domicilio" only when the business registered home delivery', async () => {
    expect(visibleText(await renderListing({ homeDelivery: false }))).not.toContain("A domicilio");
  });

  it("a business with no zone shows no empty line", async () => {
    expect(
      visibleText(await renderListing({ zoneName: null, zoneSlug: null })).split("\n"),
    ).toEqual(["Estética Tijeras de Mentira", "A domicilio", "WhatsApp"]);
  });

  // Scenarios: the placeholder without a photo shows the category emoji; the
  // photo is announced with the business name (the placeholder is not)
  it("without a photo, the emoji of its category, hidden from screen readers", async () => {
    const placeholder = (html: string) =>
      /<div aria-hidden="true"[^>]*data-testid="photo-placeholder"[^>]*>\s*<span[^>]*>([^<]*)<\/span>/.exec(
        html,
      )?.[1];

    expect(placeholder(await renderListing())).toBe("💇");
    expect(placeholder(await renderListing({ categorySlug: "servicios-del-hogar" }))).toBe("🔧");
    expect(placeholder(await renderListing({ categorySlug: "categoria-nueva" }))).toBe("✨");
  });

  // Scenarios: the card neither stretches nor squeezes; the layout does not
  // jump
  it("the photo slot is a fixed square, the tag measures its text, and nothing blocks the collapse", async () => {
    const html = await renderListing();
    const classes = [...html.matchAll(/class="([^"]*)"/g)].map(([, list = ""]) => list);

    expect(classes).toContain(
      "relative aspect-square w-20 shrink-0 self-start overflow-hidden rounded-lg",
    );
    expect(classes.some((list) => list.includes("w-fit") && /A domicilio/.test(html))).toBe(true);
    expect(classes.flatMap(collapseProblems)).toEqual([]);
  });

  it("another locality's card links under that locality", async () => {
    expect(anchor(await renderListing({}, OTHER), "Estética Tijeras de Mentira").href).toBe(
      "/estado-de-prueba-92/pueblo-uno/negocio/estetica-tijeras-de-mentira-uw3ffjy6fw",
    );
  });
});

const PHOTO_KEY = "yya626vdevvbuxa5avc2n8e6";
const MEDIA = "https://media-enmirumbo.urekz.com";

/** The `<img>` tags of the HTML, as attribute maps. */
function images(html: string): Record<string, string>[] {
  return [...html.matchAll(/<img\b([^>]*)>/g)].map(([, attributes = ""]) =>
    Object.fromEntries(
      [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name = "", value = ""]) => [
        name,
        value.replaceAll("&amp;", "&"),
      ]),
    ),
  );
}

/** Renders with the vars of an environment, then gives the stand-in its local vars back. */
async function asEnvironment<T>(vars: Partial<Env>, render: () => Promise<T>): Promise<T> {
  const before = { ...workerEnv };
  Object.assign(workerEnv, vars);
  try {
    return await render();
  } finally {
    for (const key of Object.keys(workerEnv)) delete (workerEnv as Record<string, unknown>)[key];
    Object.assign(workerEnv, before);
  }
}

const PRODUCTION: Partial<Env> = { ENVIRONMENT: "prod", MEDIA_URL: MEDIA } as Partial<Env>;

describe("The listing card and the card show the photo the server generated", () => {
  // public-directory, "The listing card brings the essentials", scenarios:
  // card content; the photo is announced with the business name
  it("a listing card with a photo shows its card variant, sized and named, from the media hostname", async () => {
    const html = await asEnvironment(PRODUCTION, () => renderListing({ photoKey: PHOTO_KEY }));

    expect(images(html)).toEqual([
      {
        src: `${MEDIA}/photos/${PHOTO_KEY}/card.webp`,
        width: "400",
        height: "400",
        alt: "Foto de Estética Tijeras de Mentira",
        loading: "lazy",
        decoding: "async",
        class: "h-full w-full bg-surface object-cover",
      },
    ]);
    expect(html).not.toContain("photo-placeholder");
    // "Photo weight does not break the 4G budget": never the card's variant.
    expect(html).not.toContain("full.webp");
  });

  // "Photo weight does not break the 4G budget", scenario: the listing does
  // not download what is not seen
  it("only the first row loads its photo at once", async () => {
    const first = await asEnvironment(PRODUCTION, () =>
      container.renderToString(ListingCard, {
        props: {
          business: {
            id: "uw3ffjy6fw",
            name: "Estética Tijeras de Mentira",
            categorySlug: "belleza",
            zoneName: null,
            zoneSlug: null,
            homeDelivery: false,
            whatsapp: "7719990107",
            photoKey: PHOTO_KEY,
          },
          locality: TIZAYUCA,
          analytics: null,
          firstRow: true,
        },
      }),
    );
    expect(images(first)[0]?.["loading"]).toBe("eager");
  });

  // Scenario: the layout does not jump
  it("with a photo, the slot is the same fixed square as without one", async () => {
    const slot = (html: string) => /<div class="([^"]*aspect-square[^"]*)"/.exec(html)?.[1];
    const withPhoto = await asEnvironment(PRODUCTION, () => renderListing({ photoKey: PHOTO_KEY }));

    expect(slot(withPhoto)).toBe(slot(await renderListing()));
  });

  // "Only the photo generated by the server is rendered", scenarios: external
  // reference stored by hand; `data:` or `javascript:` in the reference;
  // attempt to escape the storage
  it.for([
    "https://evil.example/pixel.png",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "javascript:alert(1)",
    `../${PHOTO_KEY}`,
    "/etc/passwd",
    "clave-de-foto-de-prueba",
  ])("a stored %j shows the placeholder and appears nowhere", async (stored) => {
    const listing = await asEnvironment(PRODUCTION, () => renderListing({ photoKey: stored }));
    const card = await asEnvironment(PRODUCTION, () => renderCard(complete({ photoKey: stored })));

    for (const html of [listing, card]) {
      expect(html).not.toMatch(/<img\b/);
      expect(html).not.toContain(stored.replaceAll("<", "&lt;"));
      expect(html).not.toContain("evil.example");
    }
    expect(listing).toContain("photo-placeholder");
  });

  // "The card shows the business photo when it has one", scenario: card with
  // a photo
  it("the card shows its full variant above the name, larger than the listing card's", async () => {
    const html = await asEnvironment(PRODUCTION, () =>
      renderCard(complete({ photoKey: PHOTO_KEY })),
    );

    expect(images(html)).toEqual([
      {
        src: `${MEDIA}/photos/${PHOTO_KEY}/full.webp`,
        width: "1200",
        height: "900",
        alt: "Foto de Plomería Los Fontaneros Ficticios",
        decoding: "async",
        class: "aspect-4/3 w-full rounded-xl bg-surface object-cover",
      },
    ]);
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<h1"));
    // Nothing else changes: the same text as without a photo.
    expect(visibleText(html)).toBe(visibleText(await renderCard(complete())));
  });

  // Local development: the local Worker serves the local bucket (src/lib/media.ts).
  it("locally, the photo comes from the local Worker's /_media/", async () => {
    const html = await asEnvironment({ ENVIRONMENT: "local", MEDIA_URL: "" } as Partial<Env>, () =>
      renderListing({ photoKey: PHOTO_KEY }),
    );

    expect(images(html)[0]?.["src"]).toBe(`/_media/photos/${PHOTO_KEY}/card.webp`);
  });
});

describe("Only the WhatsApp buttons of the card and the listing card are measured (v2): the listing card", () => {
  // base-layout, "Two product events and the no-results tag are recorded,
  // only in production (v2)", scenario: other environments and excluded
  // screens; "The listing card brings the essentials", scenario: the button
  // behaves the same without measurement
  it("with the measurement off, no attribute, and the same button", async () => {
    const off = await renderListing();
    const on = await renderListing({}, TIZAYUCA, MEASURED);

    expect(off).not.toContain("data-umami");
    expect(anchor(off, "WhatsApp").href).toBe(anchor(on, "WhatsApp").href);
  });

  // Scenarios: WhatsApp click from a listing card; the click from the card is
  // measured with its category
  it("with it on, the WhatsApp button declares whatsapp-listing with the locality and the business's category", async () => {
    const html = await renderListing({ categorySlug: "belleza" }, TIZAYUCA, MEASURED);
    const whatsapp = anchor(html, "WhatsApp");

    expect(whatsapp.tag).toContain('data-umami-event="whatsapp-listing"');
    expect(whatsapp.tag).toContain('data-umami-event-locality="hidalgo/tizayuca"');
    expect(whatsapp.tag).toContain('data-umami-event-category="belleza"');
    // Only those three attributes, and only on that button.
    expect(html.match(/data-umami[\w-]*/g)).toEqual([
      "data-umami-event",
      "data-umami-event-locality",
      "data-umami-event-category",
    ]);
    expect(anchor(html, "Estética Tijeras de Mentira").tag).not.toContain("data-umami");
  });

  // Scenario: on the results page the business's category rules
  it("the category is the business's own, wherever the card is listed", async () => {
    const html = await renderListing({ categorySlug: "servicios-del-hogar" }, OTHER, MEASURED);
    const values = [...html.matchAll(/data-umami[\w-]*="([^"]*)"/g)].map(([, value]) => value);

    expect(values).toEqual([
      "whatsapp-listing",
      "estado-de-prueba-92/pueblo-uno",
      "servicios-del-hogar",
    ]);
  });

  // base-layout, scenario: no business data inside a measurement attribute
  it("no measurement attribute carries the name, the number, the zone or the identifier", async () => {
    const html = await renderListing({}, TIZAYUCA, MEASURED);
    const values = [...html.matchAll(/data-umami[\w-]*="([^"]*)"/g)].map(([, value]) => value);

    expect(values.join(" ")).not.toMatch(/Estética|7719990107|haciendas|uw3ffjy6fw/i);
  });
});
