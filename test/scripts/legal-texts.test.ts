// Scenarios of docs/specs/legal-pages.md about what the two legal texts say,
// on the data the pages render (src/core/legal/). The fingerprint guard is
// test/scripts/notice-version.test.ts; the rendered pages are tested in
// test/astro/legal-pages.test.ts and test/e2e/legal-pages.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  isExternal,
  lastUpdatedLine,
  TURNSTILE_PRIVACY_ADDENDUM,
  type LegalBlock,
  type LegalDocument,
} from "../../src/core/legal/document.ts";
import {
  DIRECTORY_EMAIL,
  DIRECTORY_WHATSAPP,
  DRAFT_MARK,
  OPERATIONAL_PENDING_ITEMS,
  PENDING_PLACEHOLDERS,
  PUBLISHED_DRAFT_MARK,
  RESPONSIBLE_ADDRESS,
  RESPONSIBLE_NAME,
} from "../../src/core/legal/placeholders.ts";
import {
  MUNICIPALITY_MARK,
  PRIVACY_NOTICE,
  PRIVACY_NOTICE_PAGE,
  SIMPLIFIED_NOTICE_TEMPLATE,
  simplifiedNotice,
} from "../../src/core/legal/privacy-notice.ts";
import { TERMS, TERMS_PAGE } from "../../src/core/legal/terms.ts";
import { brandFindings } from "../brand-rules.ts";
import { staticRoutes } from "../site-routes.ts";
import { ROOT } from "./source-files.ts";

/** The texts of a block, as a person reads them. */
function blockTexts(block: LegalBlock): string[] {
  return block.kind === "list" ? [...block.items] : [block.text];
}

/** Every text of a document, in reading order. */
function texts(document: LegalDocument): string[] {
  return [
    document.title,
    document.lastUpdated,
    document.introduction,
    ...document.sections.flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap(blockTexts),
    ]),
    ...(document.closingLink ? [document.closingLink.text] : []),
  ];
}

/** The texts of the section with that heading, joined. */
function section(document: LegalDocument, heading: string): string {
  const found = document.sections.find((candidate) => candidate.heading === heading);
  if (!found) throw new Error(`no section "${heading}"`);
  return found.blocks.flatMap(blockTexts).join("\n");
}

function lists(document: LegalDocument, heading: string): (readonly string[])[] {
  return (document.sections.find((candidate) => candidate.heading === heading)?.blocks ?? [])
    .filter((block) => block.kind === "list")
    .map((block) => block.items);
}

function links(document: LegalDocument) {
  return [
    ...document.sections.flatMap((s) => s.blocks.filter((block) => block.kind === "link")),
    ...(document.closingLink ? [document.closingLink] : []),
  ];
}

const notice = texts(PRIVACY_NOTICE).join("\n");
const terms = texts(TERMS).join("\n");

describe("The full notice carries the six minimum elements of the LFPDPPP", () => {
  it("each element has its own section, and the closing link leads to the terms", () => {
    expect(PRIVACY_NOTICE.sections.map(({ heading }) => heading)).toEqual([
      "Quién es responsable de tus datos",
      "Qué datos recogemos",
      "Para qué usamos tus datos",
      "Qué queda público y qué no",
      "Con quién compartimos tus datos",
      "Cuánto tiempo guardamos tus datos",
      "Cómo limitar el uso o la divulgación de tus datos",
      "Tus derechos ARCO",
      "Cookies y datos de navegación",
      "Cambios a este aviso",
      "Si crees que no respetamos tus derechos",
    ]);
    expect(PRIVACY_NOTICE.closingLink).toEqual({
      text: "Términos y condiciones",
      href: "/terminos",
    });
  });

  // Scenario: identity and address of the responsible party
  it("the responsible party, its address and the contact channels, as placeholders", () => {
    const text = section(PRIVACY_NOTICE, "Quién es responsable de tus datos");
    expect(text).toContain(RESPONSIBLE_NAME);
    expect(text).toContain(`con domicilio en ${RESPONSIBLE_ADDRESS}.`);
    expect(text).toContain(DIRECTORY_EMAIL);
    expect(text).toContain(DIRECTORY_WHATSAPP);
  });

  // Scenarios: data processed and purposes; the photo is in the list of data collected
  it("the data collected, the photo among them, and the purposes", () => {
    const data = section(PRIVACY_NOTICE, "Qué datos recogemos");
    expect(data).toContain("Obligatorios: el nombre de tu negocio");
    expect(data).toContain("una foto de tu negocio");
    const purposes = section(PRIVACY_NOTICE, "Para qué usamos tus datos");
    for (const purpose of ["revisar", "publicar tu ficha", "avisarte", "contar cuántos negocios"]) {
      expect(purposes).toContain(purpose);
    }
  });

  // Scenario: means to limit use or disclosure
  it("what the owner can ask for, handled by hand, within 20 business days", () => {
    const text = section(PRIVACY_NOTICE, "Cómo limitar el uso o la divulgación de tus datos");
    expect(text).toContain("Dinos qué no quieres publicar");
    expect(text).toContain("en cuanto nos llega tu mensaje la bajamos del directorio");
    expect(text).toContain("eliminamos tu registro de forma definitiva");
    expect(text).toContain("lo hace a mano quien administra el directorio");
    expect(text).toContain("no hay un botón que lo haga solo");
    expect(text).toContain("en un máximo de 20 días hábiles");
  });

  // Scenario: procedure for changes to the notice
  it("a change is published on the same page, and an important one is announced by WhatsApp", () => {
    const text = section(PRIVACY_NOTICE, "Cambios a este aviso");
    expect(text).toContain("publicamos la versión nueva en esta misma página");
    expect(text).toContain("te avisamos por WhatsApp al número que registraste antes de aplicarlo");
  });
});

describe("The full notice warns that the WhatsApp and the landline become public", () => {
  // Scenarios: the WhatsApp is in plain view; zone and address; the photo;
  // what is never published
  it("says what is public, what is not, and what never is", () => {
    const text = section(PRIVACY_NOTICE, "Qué queda público y qué no");
    expect(text).toContain(
      "tu WhatsApp y tu teléfono fijo, con botones para escribirte o marcarte directo",
    );
    expect(text).toContain("Publicamos tu colonia, no tu domicilio exacto");
    expect(text).toContain("piénsalo si atiendes desde tu casa");
    expect(text).toContain("esa foto es pública");
    expect(text).toContain("la ubicación GPS");
    expect(text).toContain(
      "Lo que nunca se publica: la fecha en que te registraste, las notas internas de la revisión y el motivo",
    );
  });

  // Scenario: the address feeds the "Cómo llegar" button (v2: with no locality named)
  it('the address feeds "Cómo llegar" with the zone, the municipality and the state', () => {
    expect(section(PRIVACY_NOTICE, "Qué queda público y qué no")).toContain(
      'Esa dirección también alimenta el botón "Cómo llegar" de tu ficha: quien lo toca abre Google Maps en su teléfono, buscando lo que escribiste junto con tu colonia, tu municipio y tu estado.',
    );
  });
});

describe("The privacy notice names the processors (v2)", () => {
  // Scenario: each processor
  it("names each processor with its purpose, Twilio only when SMS verification is on", () => {
    const [processors = []] = lists(PRIVACY_NOTICE, "Con quién compartimos tus datos");
    expect(processors.map((item) => item.split(":")[0])).toEqual([
      "Cloudflare",
      "Neon",
      "Twilio",
      "Resend",
      "Umami",
    ]);
    const [cloudflare, neon, twilio, resend, umami] = processors;
    expect(cloudflare).toMatch(/hospeda el sitio y las fotos.*panel.*Turnstile/);
    expect(neon).toContain("base de datos");
    expect(twilio).toContain("solo si tenemos encendida esa verificación");
    expect(resend).toContain("correos");
    expect(umami).toContain("sin cookies");
    expect(notice).not.toContain("(hospedaje y base de datos)");
  });

  // Scenario: the Turnstile addendum
  it("references Cloudflare's Turnstile privacy addendum, opening it outside the site", () => {
    const addendum = links(PRIVACY_NOTICE).find(({ href }) => href === TURNSTILE_PRIVACY_ADDENDUM);
    expect(addendum?.text).toBe("Anexo de privacidad de Turnstile, de Cloudflare (en inglés)");
    expect(TURNSTILE_PRIVACY_ADDENDUM).toBe("https://www.cloudflare.com/turnstile-privacy-policy/");
    expect(isExternal(TURNSTILE_PRIVACY_ADDENDUM)).toBe(true);
  });
});

describe("The privacy notice states how the IP address is used (v2)", () => {
  // Scenario: the sentence
  it("less than an hour, only in memory, as a keyed code, never in the database", () => {
    const text = section(PRIVACY_NOTICE, "Cookies y datos de navegación");
    expect(text).toContain("tu dirección IP");
    expect(text).toContain("la convierte en un código con una clave secreta");
    expect(text).toContain("vive solo en su memoria y por menos de una hora");
    expect(text).toContain("Ni tu IP ni ese código se escriben nunca en la base de datos");
  });
});

describe("The privacy notice lists the cookies (v2)", () => {
  // Scenario: the list
  it("exactly two cookies, the locality's and Access's, and analytics without cookies", () => {
    const [cookies = []] = lists(PRIVACY_NOTICE, "Cookies y datos de navegación");
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("guarda solo el nombre de ese municipio");
    expect(cookies[1]).toContain(
      "Cloudflare Access, que solo existe en el panel de administración",
    );
    expect(section(PRIVACY_NOTICE, "Cookies y datos de navegación")).toContain("solo dos cookies");
    expect(section(PRIVACY_NOTICE, "Cookies y datos de navegación")).toContain(
      "Umami, la herramienta con la que contamos las visitas, no usa cookies.",
    );
  });
});

describe("The notice states the retention periods (v2)", () => {
  // Scenario: the periods; the 90-day period is the one for rejected registrations
  it("90 days for rejected registrations, 30 for pending edits and never-verified registrations", () => {
    const [periods = []] = lists(PRIVACY_NOTICE, "Cuánto tiempo guardamos tus datos");
    expect(periods).toEqual([
      "Si rechazamos tu registro, sus datos se borran a los 90 días.",
      expect.stringMatching(/nunca llegamos a verificarlo y publicarlo.*a los 30 días/),
      expect.stringMatching(
        /cambios para tu ficha.*aplicamos o los descartamos.*más nuevos.*30 días/,
      ),
    ]);
  });
});

describe("The notice describes access and rectification served from the panel (v2)", () => {
  // Scenario: the commitment
  it("the four rights from the panel, 20 working days, and contacto@enmirumbo.com", () => {
    const text = section(PRIVACY_NOTICE, "Tus derechos ARCO");
    expect(text).toContain("acceder a tus datos, a rectificarlos");
    expect(text).toContain("Los atiende quien administra el directorio desde su panel");
    expect(text).toContain("te manda por WhatsApp una copia de tus datos, corrige tu ficha");
    expect(text).toContain("en un máximo de 20 días hábiles");
    expect(text).toContain("No cobramos nada por esto.");
    expect(text).toContain("escríbenos al correo contacto@enmirumbo.com");
  });
});

describe("The terms declare the directory an informational intermediary and disclaim the transactions", () => {
  // Scenarios: disclaimer of the transaction; real scope of the seal
  it("the deal is between resident and business, and the seal only checks two things", () => {
    const disclaimer = section(TERMS, "Somos un intermediario informativo, no el negocio");
    expect(disclaimer).toContain("enmirumbo no es parte de ese trato, no lo garantiza");
    const seal = section(TERMS, "Qué verificamos y qué no");
    expect(seal).toContain("que el negocio existe y que el número es de quien lo registró");
    expect(seal).toContain(
      "Lo que no verificamos: la calidad del trabajo, los precios, que el negocio tenga licencias, permisos o seguros",
    );
    expect(section(TERMS, "Qué es enmirumbo")).toContain(
      "No cobramos por registrarse, no vendemos nada, no cobramos comisiones",
    );
  });
});

describe("The terms publish the moderation rules of PRD §6.3", () => {
  // Scenarios: the moderation rules are published; rejecting is not forever;
  // withdrawal of cards
  it("the rules with their examples, the resubmission, the 90 days and the withdrawal", () => {
    const rules = section(TERMS, "Reglas para registrar un negocio");
    expect(rules).toContain("medicamentos controlados, armas, préstamos informales");
    expect(rules).toContain("Contenido ofensivo, discriminatorio o sexual.");
    expect(rules).toContain("sin autorización del negocio");
    expect(rules).toContain("Fotos que no cumplan");
    expect(rules).toContain("puedes corregir y volver a enviar tu registro");
    expect(rules).toContain("se borran a los 90 días");
    expect(section(TERMS, "Podemos retirar una ficha")).toContain("la bajamos de inmediato");
  });

  // Scenario: the terms link to the privacy notice
  it("the section on personal data links to the privacy notice", () => {
    expect(links(TERMS)).toEqual([
      { kind: "link", text: "Aviso de privacidad", href: "/aviso-de-privacidad" },
    ]);
    expect(section(TERMS, "Si ves algo raro")).toContain(DIRECTORY_EMAIL);
  });
});

describe("Visible placeholders and a draft mark while the responsible party's data is missing", () => {
  // Scenario: the pending items are verifiable
  it("five placeholders are left, without the email, each published in square brackets", () => {
    expect(PENDING_PLACEHOLDERS).toHaveLength(5);
    for (const placeholder of PENDING_PLACEHOLDERS) {
      expect(placeholder).toMatch(/^\[[^\]]+\]$/);
      expect(`${notice}\n${terms}`, placeholder).toContain(placeholder);
    }
    expect(PENDING_PLACEHOLDERS.join(" ")).not.toMatch(/correo|@/i);
  });

  // Scenario: the responsible party's address does not exist yet
  it("the name, the address and the WhatsApp say they still need to be filled in", () => {
    for (const placeholder of [RESPONSIBLE_NAME, RESPONSIBLE_ADDRESS, DIRECTORY_WHATSAPP]) {
      expect(placeholder).toContain("— completar antes del lanzamiento]");
    }
  });

  // Scenario: the email is no longer a placeholder
  it("the email is written out in full in the two sections of the notice and in the terms", () => {
    expect(DIRECTORY_EMAIL).toBe("contacto@enmirumbo.com");
    expect(notice.split(DIRECTORY_EMAIL)).toHaveLength(3);
    expect(terms.split(DIRECTORY_EMAIL)).toHaveLength(2);
    expect(`${notice}\n${terms}`).not.toMatch(/\[[^\]]*CORREO[^\]]*\]/);
  });

  // Scenarios: draft mark visible; publishing the email does not remove the draft mark
  it("the draft mark is published while a placeholder is left", () => {
    expect(PUBLISHED_DRAFT_MARK).toBe(
      "Ojo: este texto todavía es un borrador. Nos faltan los datos que ves entre corchetes y la revisión legal antes de que el directorio se lance.",
    );
    expect(PUBLISHED_DRAFT_MARK).toBe(DRAFT_MARK);
  });

  // Scenario: no legal page contains an invented contact datum or address
  it("no legal text carries a phone number or an address that is not a placeholder", () => {
    for (const text of [notice, terms]) {
      expect(text).not.toMatch(/\b\d{10}\b/);
      expect(text.replace(/\[[^\]]*\]/g, "")).not.toMatch(
        /\b(?:calle|avenida|av\.|col\.|c\.p\.)\s/i,
      );
    }
  });
});

describe("The list of operational pending items reflects v2 (v2)", () => {
  // Scenarios: the operational pending items are also declared; the row that
  // stays; rows that leave
  it("declares its rows, each with what is promised, what the system does and a ticket", () => {
    expect(OPERATIONAL_PENDING_ITEMS.length).toBeGreaterThanOrEqual(2);
    for (const item of OPERATIONAL_PENDING_ITEMS) {
      expect(item.commitment.trim()).not.toBe("");
      expect(item.today.trim()).not.toBe("");
      expect(item.tickets).toMatch(/\bEMR-\d+\b/);
    }
    const all = OPERATIONAL_PENDING_ITEMS.map((item) => `${item.commitment} ${item.today}`).join(
      "\n",
    );
    // Access and rectification stay until the panel edits a card and sends a copy.
    expect(all).toMatch(/editing any card and sending a copy of its data/);
    // Cancellation and opposition are served from the panel since F3 (EMR-48).
    expect(all).toMatch(/cancellation and opposition are served from it/);
    expect(all).not.toMatch(/unpublishing and deleting arrive/);
    // The IP quotas stay until the legal review approves the wording.
    expect(all).toMatch(/IP address/);
    expect(OPERATIONAL_PENDING_ITEMS.map(({ tickets }) => tickets).join(" ")).toContain("EMR-58");
    // The unnamed processors and the stored panel attempts left.
    expect(all).not.toMatch(
      /hospedaje y base de datos|without naming|login attempt|HMAC of the IP \(never/,
    );
  });

  // Scenario: the purge is no longer a pending item
  it("the purge of rejected registrations is not a pending item", () => {
    expect(OPERATIONAL_PENDING_ITEMS.map(({ commitment }) => commitment).join("\n")).not.toMatch(
      /90 days|90 días/,
    );
  });

  it("none of the pending items is published on the legal pages", () => {
    for (const item of OPERATIONAL_PENDING_ITEMS) {
      expect(notice).not.toContain(item.today);
      expect(terms).not.toContain(item.today);
    }
  });
});

describe("The legal pages are prerendered, belong to no locality and name none (v2)", () => {
  // Scenario: no locality named
  it("neither text, nor its title or description, names a locality", () => {
    const all = [
      notice,
      terms,
      ...Object.values(PRIVACY_NOTICE_PAGE),
      ...Object.values(TERMS_PAGE),
    ].join("\n");
    expect(all).not.toMatch(/tizayuca|hidalgo/i);
    expect(all).not.toContain(MUNICIPALITY_MARK);
    expect(PRIVACY_NOTICE.introduction).toContain("enmirumbo, el directorio de negocios locales,");
    expect(TERMS.introduction).toContain("enmirumbo, el directorio de negocios locales,");
  });

  // Scenario: the simplified notice of a locality
  it("the simplified notice names the municipality of the form's locality, read from its record", () => {
    expect(SIMPLIFIED_NOTICE_TEMPLATE.split(MUNICIPALITY_MARK)).toHaveLength(2);
    expect(simplifiedNotice("Pueblo Uno")).toMatch(
      /^Aviso de privacidad \(resumen\): enmirumbo, el directorio de negocios de Pueblo Uno, usa los datos/,
    );
    expect(simplifiedNotice("Pueblo Uno")).not.toContain(MUNICIPALITY_MARK);
  });

  it("every link between the documents names a page of the site", () => {
    const routes = staticRoutes();
    for (const { href } of [...links(PRIVACY_NOTICE), ...links(TERMS)]) {
      if (!isExternal(href)) expect(routes, href).toContain(href);
    }
    expect(routes).toContain(PRIVACY_NOTICE_PAGE.path);
    expect(routes).toContain(TERMS_PAGE.path);
  });
});

describe("No surface of the site names the previous brand or attaches the locality to the name", () => {
  // Scenario: the legal pages do not name it in their metadata either
  it("the texts and the metadata of both pages write the brand as enmirumbo", () => {
    for (const text of [
      notice,
      terms,
      SIMPLIFIED_NOTICE_TEMPLATE,
      ...Object.values(PRIVACY_NOTICE_PAGE),
      ...Object.values(TERMS_PAGE),
    ]) {
      expect(brandFindings(text)).toEqual([]);
    }
    expect(PRIVACY_NOTICE_PAGE.description).toContain("enmirumbo");
    expect(TERMS_PAGE.description).toContain("enmirumbo");
  });
});

describe("Full text of the privacy notice (v2) and Full text of the terms and conditions (v2)", () => {
  const spec = readFileSync(join(ROOT, "docs/specs/legal-pages.md"), "utf8");

  /** The verbatim block of a requirement of the spec. */
  function verbatim(requirement: string): string {
    const start = spec.indexOf(`### Requirement: ${requirement}\n`);
    expect(start, requirement).toBeGreaterThan(-1);
    return /\n```\n([\s\S]*?)\n```\n/.exec(spec.slice(start))?.[1] ?? "";
  }

  /** A document written as the spec writes it: `##` for each h2, `- ` for each bullet. */
  function asSpecBlock(document: LegalDocument): string {
    const lines = [document.title, "", PUBLISHED_DRAFT_MARK ?? "", "", lastUpdatedLine(document)];
    lines.push("", document.introduction);
    for (const { heading, blocks } of document.sections) {
      lines.push("", `## ${heading}`);
      for (const block of blocks) {
        lines.push("");
        if (block.kind === "list") lines.push(...block.items.map((item) => `- ${item}`));
        else lines.push(block.text);
      }
    }
    if (document.closingLink) lines.push("", document.closingLink.text);
    return lines.join("\n");
  }

  // Scenarios: the published text is the approved one (the pages publish these
  // modules exactly: test/astro/legal-pages.test.ts)
  it("the notice of src/core/legal/ is the verbatim block of the spec", () => {
    expect(asSpecBlock(PRIVACY_NOTICE)).toBe(verbatim("Full text of the privacy notice (v2)"));
  });

  it("the terms of src/core/legal/ are the verbatim block of the spec", () => {
    expect(asSpecBlock(TERMS)).toBe(verbatim("Full text of the terms and conditions (v2)"));
  });
});
