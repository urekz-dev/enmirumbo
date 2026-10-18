// Scenarios of docs/specs/public-directory.md for the report controls and the
// report page, rendered with Astro's Container API: "Discreet "Reportar este
// negocio" control on the card", ""Perdí mi enlace" button on the card,
// toward the admin's WhatsApp", ""Perdí mi enlace" opens WhatsApp to the
// admin of the card's locality (v2)", "Contact buttons on the card with
// WhatsApp as the main action" (scenarios on reporting and "Perdí mi
// enlace"), "Report mini-form without an account, with a closed-list reason
// and optional comment", "The server validates the report's reason and
// comment, and keeps the draft without a cookie (v2)", "Report anti-abuse
// without captcha: honeypot, per-IP quota and pending cap per business" (the
// trap field), "No data is requested or stored about the reporter" and
// "Directory in Server Components, mobile-first and usable without
// JavaScript". What the page decides, with the database, the action and the
// quota, runs end to end in test/e2e/report.spec.ts; the submission itself is
// tested in test/worker/report.test.ts.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { PublishedCard } from "../../src/core/business/card.ts";
import type { ListingBusiness } from "../../src/core/business/listing.ts";
import type { ServedLocality } from "../../src/core/locality/served.ts";
import {
  EMPTY_DRAFT,
  type ReportDraft,
  type ReportFormError,
} from "../../src/core/report/submission.ts";
import BusinessCard from "../../src/components/BusinessCard.astro";
import ListingCard from "../../src/components/ListingCard.astro";
import ReportPage from "../../src/components/ReportPage.astro";
import { collapseProblems } from "../responsive-rules.ts";

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

/** A second locality, with its own contact WhatsApp. */
const OTHER: ServedLocality = {
  ...TIZAYUCA,
  code: "92001",
  name: "Pueblo Uno",
  slug: "pueblo-uno",
  state: { code: "92", name: "Estado de prueba 92", slug: "estado-de-prueba-92" },
  contactWhatsapp: "7719990192",
};

const CARD: PublishedCard = {
  id: "b5q68b2e72",
  name: "Plomería Los Fontaneros Ficticios",
  category: { name: "Servicios del hogar", slug: "servicios-del-hogar" },
  zoneName: "Huicalco",
  zoneSlug: "huicalco",
  whatsapp: "7719990101",
  whatYouOffer: null,
  homeDelivery: false,
  landline: "7719990151",
  address: "a un lado de la primaria",
  openingHours: null,
  pageUrl: null,
  trades: [],
  photoKey: null,
};

const LOST_LINK_MESSAGE =
  "Hola, soy de «Plomería Los Fontaneros Ficticios» en enmirumbo y perdí el enlace para " +
  "editar mi ficha. Les escribo desde el número que registré, ¿me lo pueden pasar?";

const ACTION = "?_action=report";
const REPORT_PATH =
  "/hidalgo/tizayuca/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72/reportar";

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

function renderCard(locality: ServedLocality = TIZAYUCA, card: PublishedCard = CARD) {
  return container.renderToString(BusinessCard, { props: { card, locality, analytics: null } });
}

/** The report page of CARD in `locality`, with an error and a draft. */
function renderReport(
  error: ReportFormError | null = null,
  draft: ReportDraft = EMPTY_DRAFT,
  locality: ServedLocality = TIZAYUCA,
) {
  return container.renderToString(ReportPage, {
    partial: false,
    props: { card: { id: CARD.id, name: CARD.name }, action: ACTION, error, draft },
    request: new Request(`https://enmirumbo.urekz.workers.dev${REPORT_PATH}`),
    locals: { locality } as App.Locals,
  });
}

/** Text as a person reads it: entities decoded. */
function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, "&");
}

/** The inside of `main`, or the whole fragment when there is none. */
function mainOf(html: string): string {
  return /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? html;
}

/** The text a person reads, one line per block; what is aria-hidden is not read. */
function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<(\w+)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(
        /<\/?(?:p|div|h[1-6]|li|ul|a|span|article|nav|label|legend|button|form|fieldset)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, ""),
  )
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

function anchors(html: string): Anchor[] {
  return [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map(([, tag = "", text = ""]) => ({
    tag,
    href: decode(/\bhref="([^"]*)"/.exec(tag)?.[1] ?? ""),
    text: visibleText(text),
  }));
}

function anchor(html: string, text: string): Anchor {
  const found = anchors(html).find((a) => a.text === text);
  if (!found) throw new Error(`no link "${text}"`);
  return found;
}

/** Every form control, as its opening tag; quoted values may hold ">". */
function controls(html: string): string[] {
  return html.match(/<(?:input|textarea|select|button)\b(?:[^>"]|"[^"]*")*>/g) ?? [];
}

const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

describe('Discreet "Reportar este negocio" control on the card', () => {
  // Scenario: the card offers reporting without stealing WhatsApp's place
  it("comes after the contact buttons, as a small muted link, never green or a button", async () => {
    const html = await renderCard();
    const report = anchor(html, "Reportar este negocio");
    const texts = anchors(html).map((a) => a.text);

    expect(texts.indexOf("Reportar este negocio")).toBeGreaterThan(texts.indexOf("Cómo llegar"));
    expect(report.tag).toMatch(/\btext-sm\b/);
    expect(report.tag).toMatch(/\btext-ink-muted\b/);
    expect(report.tag).toMatch(/\bunderline\b/);
    expect(report.tag).not.toMatch(/-action\b|-action-strong\b|rounded-lg|\bborder\b|text-lg/);
    // Its touch area is 44px tall.
    expect(report.tag).toMatch(/\bmin-h-11\b/);
    expect(collapseProblems(attribute(report.tag, "class") ?? "")).toEqual([]);
  });

  // Scenario: tapping the control opens the report form
  it("leads to the report form of the card, on the site", async () => {
    const report = anchor(await renderCard(), "Reportar este negocio");

    expect(report.href).toBe(REPORT_PATH);
    expect(report.tag).not.toContain("target=");
  });

  // Scenario: accessible label with the business name
  it("is announced with the name of the business it reports", async () => {
    const report = anchor(await renderCard(), "Reportar este negocio");

    expect(decode(attribute(report.tag, "aria-label") ?? "")).toBe(
      "Reportar este negocio: Plomería Los Fontaneros Ficticios",
    );
  });

  // Scenario: reporting is not on the listing cards
  it("no listing card has it, nor Perdí mi enlace", async () => {
    const business: ListingBusiness = {
      id: CARD.id,
      name: CARD.name,
      categorySlug: CARD.category.slug,
      zoneName: CARD.zoneName,
      zoneSlug: CARD.zoneSlug,
      homeDelivery: false,
      whatsapp: CARD.whatsapp,
      photoKey: null,
    };
    const html = await container.renderToString(ListingCard, {
      props: { business, locality: TIZAYUCA, analytics: null },
    });

    expect(visibleText(html)).not.toMatch(/Reportar|Perdí mi enlace|¿Es tu negocio\?/);
    expect(html).not.toContain("/reportar");
  });
});

describe('"Perdí mi enlace" button on the card, toward the admin\'s WhatsApp', () => {
  // Scenario: asking for the link from the card
  it("¿Es tu negocio? and Perdí mi enlace open the admin's conversation with the message written", async () => {
    const html = await renderCard();
    const lost = anchor(html, "Perdí mi enlace");
    const url = new URL(lost.href);

    expect(visibleText(html)).toContain("¿Es tu negocio?\nPerdí mi enlace");
    expect(`${url.origin}${url.pathname}`).toBe("https://wa.me/527719990100");
    expect(url.searchParams.get("text")).toBe(LOST_LINK_MESSAGE);
    expect(lost.tag).toContain('target="_blank"');
    expect(lost.tag).toContain('rel="noopener noreferrer"');
  });

  // Scenarios: "Perdí mi enlace" does not fight the contact; the control does
  // not compete with the contact
  it("is a small muted link at the end of the card, after reporting", async () => {
    const html = await renderCard();
    const lost = anchor(html, "Perdí mi enlace");

    expect(anchors(html).at(-1)?.text).toBe("Perdí mi enlace");
    expect(lost.tag).toMatch(/\btext-sm\b.*\btext-ink-muted\b|\btext-ink-muted\b.*\btext-sm\b/);
    expect(lost.tag).toMatch(/\bmin-h-11\b/);
    expect(lost.tag).not.toMatch(/-action\b|-action-strong\b|rounded-lg/);
    // "Enviar WhatsApp" stays the only control in the action green.
    const green = [...html.matchAll(/class="([^"]*)"/g)].filter(([, list = ""]) =>
      /(?:^|\s)(?:bg|text|border)-action(?:-strong)?(?:\s|$)/.test(list),
    );
    expect(green).toHaveLength(1);
    // It promises nothing arrives by itself.
    expect(visibleText(html)).not.toMatch(/te llegará|automátic/i);
  });

  // "Perdí mi enlace" opens WhatsApp to the admin of the card's locality
  // (v2), scenario: another locality
  it("opens the contact WhatsApp of the card's own locality", async () => {
    const lost = new URL(anchor(await renderCard(OTHER), "Perdí mi enlace").href);

    expect(`${lost.origin}${lost.pathname}`).toBe("https://wa.me/527719990192");
  });

  // Scenario: no admin number configured
  it("without a contact number of ten digits there is no block, no broken link and no number", async () => {
    for (const contactWhatsapp of ["", "999 0100", "sin número"]) {
      const html = await renderCard({ ...TIZAYUCA, contactWhatsapp });

      expect(visibleText(html), contactWhatsapp).not.toMatch(/¿Es tu negocio\?|Perdí mi enlace/);
      // The only conversation left is the business's own.
      expect(anchors(html).filter((a) => a.href.startsWith("https://wa.me/"))).toEqual([
        expect.objectContaining({ text: "Enviar WhatsApp" }),
      ]);
      // The card is still complete, and can still be reported.
      expect(anchors(html).map((a) => a.text)).toEqual(
        expect.arrayContaining(["Enviar WhatsApp", "Reportar este negocio"]),
      );
    }
  });

  // Scenario: the admin's number does not live in the repo
  it("the number comes from the locality record, never from the code", async () => {
    const html = await renderCard({ ...TIZAYUCA, contactWhatsapp: "771 999 0177" });

    expect(anchor(html, "Perdí mi enlace").href).toMatch(/^https:\/\/wa\.me\/527719990177\?/);
  });
});

describe("Report mini-form without an account, with a closed-list reason and optional comment", () => {
  // Scenario: complete report form
  it("Reportar este negocio as the only h1, the business, the phrase, the four reasons, the comment and the button", async () => {
    const html = await renderReport();
    const main = mainOf(html);

    expect(
      [...main.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(
        ([, n, t]) => `h${n} ${t?.trim()}`,
      ),
    ).toEqual(["h1 Reportar este negocio"]);
    expect(visibleText(main).split("\n")).toEqual([
      "Reportar este negocio",
      "Plomería Los Fontaneros Ficticios",
      "Dinos qué pasa y lo revisamos. No te pedimos ningún dato tuyo.",
      "¿Qué pasa?",
      "Ya cerró",
      "No es real",
      "Los datos están mal",
      "Contenido ofensivo o inapropiado",
      "¿Nos quieres contar más? (opcional)",
      "Máximo 300 caracteres.",
      "Enviar reporte",
      "Volver a la ficha",
    ]);
  });

  it("the four reasons are one closed group, none chosen, and nothing is required of the browser", async () => {
    const tags = controls(mainOf(await renderReport()));
    const radios = tags.filter((tag) => tag.includes('type="radio"'));

    expect(radios.map((tag) => attribute(tag, "value"))).toEqual([
      "closed",
      "not_real",
      "incorrect_data",
      "inappropriate",
    ]);
    expect(radios.every((tag) => attribute(tag, "name") === "reason")).toBe(true);
    expect(radios.some((tag) => /\bchecked\b/.test(tag))).toBe(false);
    expect(tags.some((tag) => /\brequired\b/.test(tag))).toBe(false);
    const comment = tags.find((tag) => tag.startsWith("<textarea"))!;
    expect(attribute(comment, "name")).toBe("comment");
    expect(attribute(comment, "maxlength")).toBe("300");
    expect(attribute(comment, "aria-describedby")).toBe("comment-help");
  });

  // Scenario: the report works without JavaScript
  it("posts to its own page with the action, and adds no script", async () => {
    const html = await renderReport();
    const form = /<form\b[^>]*>/.exec(html)?.[0] ?? "";

    expect(attribute(form, "method")).toBe("post");
    expect(attribute(form, "action")).toBe(ACTION);
    expect(html.match(/<script\b[^>]*>/g) ?? []).toEqual([]);
  });

  // Scenario: the report page is not indexed
  it("is never indexed, has no canonical and a static title", async () => {
    const html = await renderReport();

    expect(html).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).not.toContain('rel="canonical"');
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe("Reportar este negocio — enmirumbo");
  });

  it("Volver a la ficha leads to the card's current address", async () => {
    expect(anchor(mainOf(await renderReport()), "Volver a la ficha").href).toBe(
      "/hidalgo/tizayuca/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72",
    );
    expect(
      anchor(mainOf(await renderReport(null, EMPTY_DRAFT, OTHER)), "Volver a la ficha").href,
    ).toBe("/estado-de-prueba-92/pueblo-uno/negocio/plomeria-los-fontaneros-ficticios-b5q68b2e72");
  });

  // Scenario: the form does not ask for reporter data
  it("its only fields are the reason, the comment and the trap field", async () => {
    const names = controls(mainOf(await renderReport()))
      .map((tag) => attribute(tag, "name"))
      .filter((name) => name !== undefined);

    expect([...new Set(names)]).toEqual(["website", "reason", "comment"]);
    expect(visibleText(mainOf(await renderReport()))).not.toMatch(
      /nombre|teléfono|correo|whatsapp/i,
    );
  });

  it("works on a 390px phone: every class lets it collapse", async () => {
    const lists = [...mainOf(await renderReport("reason")).matchAll(/class="([^"]*)"/g)].map(
      ([, list = ""]) => list,
    );
    expect(lists.flatMap(collapseProblems)).toEqual([]);
  });
});

describe("Report anti-abuse without captcha: honeypot, per-IP quota and pending cap per business", () => {
  // Scenario: the honeypot does not bother people
  it("the trap field is off the screen, out of the keyboard's order and hidden from screen readers", async () => {
    const main = mainOf(await renderReport());
    const wrapper = /<div\b[^>]*aria-hidden="true"[^>]*>([\s\S]*?)<\/div>/.exec(main);
    const trap = controls(wrapper?.[1] ?? "")[0] ?? "";

    expect(wrapper?.[0]).toMatch(/\babsolute\b/);
    expect(wrapper?.[0]).toMatch(/left-\[-9999px\]/);
    expect(attribute(trap, "name")).toBe("website");
    expect(attribute(trap, "tabindex")).toBe("-1");
    expect(attribute(trap, "autocomplete")).toBe("off");
    expect(attribute(trap, "value")).toBeUndefined();
    // Never a style attribute: the content security policy forbids it.
    expect(main).not.toMatch(/\sstyle=/);
  });
});

describe("The server validates the report's reason and comment, and keeps the draft without a cookie (v2)", () => {
  // Scenario: submission without choosing a reason
  it("without a reason: the message in the group, and the comment that was written still in the field", async () => {
    const main = mainOf(await renderReport("reason", { reason: null, comment: "Ya no abre" }));

    expect(visibleText(main)).toContain("¿Qué pasa?\nDinos qué pasa con este negocio");
    expect(main).toMatch(/<p id="reason-error" role="alert"/);
    expect(main).toMatch(/<fieldset\b[^>]*aria-describedby="reason-error"/);
    expect(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/.exec(main)?.[1]).toBe("Ya no abre");
  });

  it("the reason that was chosen is chosen again", async () => {
    const tags = controls(
      mainOf(await renderReport("quota", { reason: "incorrect_data", comment: "" })),
    );
    const checked = tags.filter((tag) => /\bchecked\b/.test(tag));

    expect(checked.map((tag) => attribute(tag, "value"))).toEqual(["incorrect_data"]);
  });

  // Scenario: comment too long
  it("a comment too long: the message under the field, which is marked invalid", async () => {
    const main = mainOf(
      await renderReport("comment", { reason: "closed", comment: "a".repeat(300) }),
    );
    const comment = controls(main).find((tag) => tag.startsWith("<textarea"))!;

    expect(visibleText(main)).toContain(
      "Máximo 300 caracteres.\nEl comentario es muy largo (máximo 300 caracteres)",
    );
    expect(attribute(comment, "aria-invalid")).toBe("true");
    expect(attribute(comment, "aria-describedby")).toBe("comment-error comment-help");
  });

  // Scenarios: per-IP quota exhausted; the server could not save
  it("over the quota or after a failure, the message goes above the form", async () => {
    for (const [error, message] of [
      ["quota", "Ya recibimos varios reportes desde aquí. Espera un rato y vuelve a intentar."],
      ["server", "No pudimos enviar tu reporte. Vuelve a intentarlo en un momento."],
    ] as const) {
      const main = mainOf(await renderReport(error, { reason: "closed", comment: "Cerró" }));

      expect(visibleText(main), error).toContain(
        `Dinos qué pasa y lo revisamos. No te pedimos ningún dato tuyo.\n${message}\n¿Qué pasa?`,
      );
      expect(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/.exec(main)?.[1], error).toBe("Cerró");
    }
  });

  // Scenario: tampered draft
  it("a draft with markup is shown escaped, as text, and breaks nothing", async () => {
    const draft = '</textarea><script>alert(1)</script><img src=x onerror="1">';
    const html = await renderReport("reason", { reason: null, comment: draft });
    const inside = /<textarea\b[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? "";

    expect(decode(inside)).toBe(draft);
    expect(html.match(/<script\b/g) ?? []).toEqual([]);
    expect(html).not.toMatch(/<img\b/);
  });

  it("the business name is text too", async () => {
    const html = await container.renderToString(ReportPage, {
      partial: false,
      props: {
        card: { id: CARD.id, name: "Tacos <script>alert(1)</script>" },
        action: ACTION,
        error: null,
        draft: EMPTY_DRAFT,
      },
      request: new Request(`https://enmirumbo.urekz.workers.dev${REPORT_PATH}`),
      locals: { locality: TIZAYUCA } as App.Locals,
    });

    expect(html).toContain("Tacos &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.match(/<script\b/g) ?? []).toEqual([]);
  });
});
