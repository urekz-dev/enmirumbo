// Scenarios of docs/specs/business-registration.md for the registration page
// and its thank-you page, rendered with Astro's Container API: "Public
// registration page on a single screen", "Required and optional form
// fields", "The "¿Qué ofreces?" example adapts to the chosen category", "The
// server validates every field and returns per-field errors in Spanish"
// (what the form shows), "Consent with a visible simplified notice and a
// consent record", "Nobody consents to a notice version they did not have in
// front of them" (the version the form carries), "A successful submission
// queues the business and shows the thank-you screen", "Form states and
// registration accessibility", "The registration leaves the card ready for
// the search" (no field of its own), "The zone is chosen from the zones of
// the postal code the business types, or written when it does not appear
// (v2)" (the markup; the script runs in test/e2e/registration.spec.ts), "The
// registration's honeypot and per-IP quota are those of the
// public forms (v2)" (the trap field), "The registration page of a
// locality lives under it, and lands on its thank-you page (v2)", "Turnstile
// is checked on the server, fails closed and has a switch in the database
// (v2)" (the widget, with the switch on and off), "Without JavaScript the
// registration says so and cannot be sent while Turnstile is on (v2)", "The
// photo field explains the PRD §6.1 policy and opens the phone gallery" and,
// for what the photo field shows, "The server only accepts the photo if it
// is a real image of at most 5 MB" and "Image work has a ceiling, and what
// does not fit is turned away with a message, not queued"; and, in
// production with a Website ID, "The registration funnel is measured with
// the views of its two screens" and "No form data travels to the
// measurement", with docs/specs/base-layout.md, "Two product events and the
// no-results tag are recorded, only in production (v2)". What the
// page decides, with the database, the action and the quota, runs end to end
// in test/e2e/registration.spec.ts and test/e2e/registration-photo.spec.ts;
// the submission itself is tested in test/worker/registration.test.ts and
// test/worker/photo-upload.test.ts.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import RegistrationPage from "../../src/components/RegistrationPage.astro";
import { NOTICE_VERSION } from "../../src/core/legal/version.ts";
import type { ServedLocality } from "../../src/core/locality/served.ts";
import type { RegistrationCatalogue } from "../../src/core/registration/catalogue.ts";
import {
  EMPTY_REGISTRATION_DRAFT,
  type GeneralError,
  type RegistrationDraft,
  type RegistrationErrors,
} from "../../src/core/registration/submission.ts";
import { OTHER_ZONE } from "../../src/core/registration/zone.ts";
import ThanksPage from "../../src/pages/[state]/[municipality]/registro/gracias.astro";
import { collapseProblems } from "../responsive-rules.ts";
import { env } from "./cloudflare-workers.ts";

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
  code: "91001",
  name: "Pueblo Uno",
  slug: "pueblo-uno",
  state: { code: "91", name: "Estado de prueba 91", slug: "estado-de-prueba-91" },
};

/** The 8 categories, in catalogue order, and three zones of two postal codes. */
const CATALOGUE: RegistrationCatalogue = {
  categories: [
    { id: 1, name: "Restaurantes y fondas", slug: "restaurantes-y-fondas" },
    { id: 2, name: "Servicios del hogar", slug: "servicios-del-hogar" },
    { id: 3, name: "Belleza", slug: "belleza" },
    { id: 4, name: "Salud", slug: "salud" },
    { id: 5, name: "Abarrotes y comercio", slug: "abarrotes-y-comercio" },
    { id: 6, name: "Talleres", slug: "talleres" },
    { id: 7, name: "Clubes y escuelas deportivas", slug: "clubes-y-escuelas-deportivas" },
    { id: 8, name: "Otro", slug: "otro" },
  ],
  zones: [
    {
      id: 11,
      slug: "colonia-el-carmen",
      name: "El Carmen",
      displayName: "El Carmen (Colonia)",
      postalCode: "43815",
    },
    {
      id: 12,
      slug: "haciendas-de-tizayuca",
      name: "Haciendas de Tizayuca",
      displayName: "Haciendas de Tizayuca",
      postalCode: "43815",
    },
    { id: 13, slug: "huicalco", name: "Huicalco", displayName: "Huicalco", postalCode: "43808" },
  ],
};

const ACTION = "?_action=register";
const PATH = "/hidalgo/tizayuca/registro";

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

afterEach(() => {
  for (const key of Object.keys(env)) delete env[key as keyof Env];
  env.ENVIRONMENT = "local";
});

interface State {
  catalogue?: RegistrationCatalogue;
  draft?: RegistrationDraft;
  errors?: RegistrationErrors;
  general?: GeneralError | null;
  locality?: ServedLocality;
  /** Turnstile, with its site key, while the switch is on; off by default, as E1 built the form. */
  turnstile?: { siteKey: string | null } | null;
  /** The address of the page: the form's, or the answer to a submission with the action's name. */
  address?: string;
}

/** The registration page in one of its states. */
function render({
  catalogue = CATALOGUE,
  draft = EMPTY_REGISTRATION_DRAFT,
  errors = {},
  general = null,
  locality = TIZAYUCA,
  turnstile = null,
  address = PATH,
}: State = {}): Promise<string> {
  return container.renderToString(RegistrationPage, {
    partial: false,
    props: { catalogue, action: ACTION, draft, errors, general, turnstile },
    request: new Request(`https://enmirumbo.com${address}`),
    locals: { locality } as App.Locals,
  });
}

/** The thank-you page of `locality`, at its address, which has no query. */
function renderThanks(locality: ServedLocality = TIZAYUCA): Promise<string> {
  return container.renderToString(ThanksPage, {
    partial: false,
    request: new Request(`https://enmirumbo.com${PATH}/gracias`),
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

/** The inside of `main`. */
function mainOf(html: string): string {
  return /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? html;
}

/** The form. */
function formOf(html: string): string {
  return /<form\b[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
}

/** What a person reads of some markup: no tags, no aria-hidden parts, spaces collapsed. */
function readable(markup: string): string {
  return decode(
    markup
      .replace(/<(\w+)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/** Every form control, as its opening tag; quoted values may hold ">". */
function controls(html: string): string[] {
  return html.match(/<(?:input|textarea|select|button)\b(?:[^>"]|"[^"]*")*>/g) ?? [];
}

const attribute = (tag: string, name: string): string | undefined => {
  const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  return value === undefined ? undefined : decode(value);
};
const has = (tag: string, name: string) => new RegExp(`\\s${name}(?:[\\s=>]|$)`).test(tag);

/** The control named `name`. */
function control(html: string, name: string): string {
  const found = controls(formOf(html)).find((tag) => attribute(tag, "name") === name);
  if (!found) throw new Error(`no control ${name}`);
  return found;
}

/** The select named `name`, whole. */
function selectOf(html: string, name: string): string {
  return (
    new RegExp(`<select\\b[^>]*name="${name}"[\\s\\S]*?</select>`).exec(formOf(html))?.[0] ?? ""
  );
}

/** The visible labels of the form, in order, as a person reads them. */
function labels(html: string): string[] {
  return [...formOf(html).matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)]
    .filter(([tag]) => !tag.includes('for="website"'))
    .map(([, inner = ""]) => readable(inner));
}

/** The label of the control with `id`. */
function labelFor(html: string, id: string): string {
  return readable(new RegExp(`<label for="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html)?.[1] ?? "");
}

/** The error messages shown, in order. */
function alerts(html: string): string[] {
  return [...mainOf(html).matchAll(/<p\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/p>/g)].map(
    ([, inner = ""]) => readable(inner),
  );
}

const LABELS = [
  "¿Cómo se llama tu negocio?",
  "¿A qué se dedica?",
  "Tu WhatsApp (10 dígitos)",
  "Código postal",
  "¿En qué colonia estás?",
  "Si tu colonia no aparece, escribe cómo se llama",
  "¿Qué ofreces? (opcional)",
  "¿Haces entregas o vas a domicilio? (opcional)",
  "Teléfono fijo (opcional)",
  "Dirección o referencias (opcional)",
  "Horario (opcional)",
  "Link de tu Facebook (opcional)",
  "Foto de tu negocio (opcional)",
  "Dejar mi ficha sin foto",
  "Acepto el aviso de privacidad y confirmo que este negocio es mío o que tengo permiso para registrarlo.",
];

const SIMPLIFIED_NOTICE =
  "Aviso de privacidad (resumen): enmirumbo, el directorio de negocios de Tizayuca, usa los datos que escribes aquí para revisar tu negocio, contactarte por WhatsApp y publicar tu ficha en el directorio. Ojo con esto: si publicamos tu ficha, el nombre de tu negocio, tu WhatsApp, tu teléfono fijo y lo demás que escribas quedan a la vista de cualquiera que entre al directorio, con botones para escribirte o marcarte directo. Publicamos tu colonia, no tu domicilio exacto, salvo que tú escribas la dirección. No vendemos ni compartimos tus datos con nadie más. Puedes pedirnos que corrijamos o borremos tu ficha cuando quieras, por el mismo WhatsApp con el que te contactemos; lo atendemos en máximo 20 días hábiles.";

/** A draft with every field written. */
const FULL_DRAFT: RegistrationDraft = {
  name: "Plomería Güicho",
  category: "servicios-del-hogar",
  whatsapp: "771 999 45",
  postalCode: "43899",
  zone: OTHER_ZONE,
  zoneOther: "Rinconada del Venado",
  whatYouOffer: "destape de drenajes",
  homeDelivery: true,
  landline: "no tengo",
  address: "a un lado de la primaria",
  openingHours: "Solo fines de semana",
  facebookUrl: "facebook.com/minegocio",
  photo: false,
  removePhoto: false,
};

describe("Public registration page on a single screen", () => {
  // Scenario: the owner reaches registration from the home page (the page)
  it("Registra tu negocio gratis as its only h1, its phrase and one form, inside the layout", async () => {
    const html = await render();

    expect(html).toMatch(/<header\b[\s\S]*<main\b[\s\S]*<footer\b/);
    const headings = [...mainOf(html).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)];
    expect(headings.map(([, level, inner = ""]) => `h${level} ${readable(inner)}`)).toEqual([
      "h1 Registra tu negocio gratis",
    ]);
    expect(readable(mainOf(html))).toContain(
      "Llena este formulario en un par de minutos, sin cuenta ni contraseña. En cuanto lo revisemos, te contactamos por WhatsApp.",
    );
    expect(mainOf(html).match(/<form\b/g)).toHaveLength(1);
    // No steps: one submit button, no fieldset per step.
    expect(controls(formOf(html)).filter((tag) => tag.startsWith("<button"))).toHaveLength(1);
  });

  // Scenario: mobile-first at 390px
  it("every control is at least 44px tall, and no class blocks the responsive collapse", async () => {
    const html = await render();
    for (const tag of controls(formOf(html))) {
      const type = attribute(tag, "type");
      if (type === "hidden" || type === "checkbox" || attribute(tag, "name") === "website")
        continue;
      expect(attribute(tag, "class") ?? "", tag).toMatch(/\bpy-3\b|\bmin-h-11\b/);
    }
    // A checkbox is tapped through its label, at least 44px tall.
    for (const [tag] of formOf(html).matchAll(/<label\b[^>]*>(?=\s*<input type="checkbox")/g)) {
      expect(tag).toContain("min-h-11");
    }
    const classes = [...html.matchAll(/\bclass="([^"]*)"/g)].map(([, value = ""]) => value);
    expect(classes.flatMap(collapseProblems)).toEqual([]);
  });

  // The registration page of a locality lives under it (v2): its metadata
  it("its title and description name the locality, its canonical is its own address, and it may be indexed", async () => {
    Object.assign(env, {
      ENVIRONMENT: "stage",
      SITE_URL: "https://stage.enmirumbo.com",
    });
    const html = await render();

    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(
      "Registra tu negocio gratis en Tizayuca — enmirumbo",
    );
    expect(decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "")).toBe(
      "Registra gratis tu negocio de Tizayuca en enmirumbo: un solo formulario, sin cuenta ni contraseña. Lo revisamos y te contactamos por WhatsApp.",
    );
    expect(/<link rel="canonical" href="([^"]*)"/.exec(html)?.[1]).toBe(
      "https://stage.enmirumbo.com/hidalgo/tizayuca/registro",
    );
    expect(html).not.toContain('name="robots"');
  });

  it("another locality: its own name in the title and the notice, and Tizayuca nowhere", async () => {
    const html = await render({ locality: OTHER });

    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(
      "Registra tu negocio gratis en Pueblo Uno — enmirumbo",
    );
    expect(readable(mainOf(html))).toContain(
      "Aviso de privacidad (resumen): enmirumbo, el directorio de negocios de Pueblo Uno, usa",
    );
  });
});

describe("Required and optional form fields", () => {
  // Scenario: empty form on open
  it("the required fields and the optional ones, marked, with their literal labels, and nothing prefilled or wrong", async () => {
    const html = await render();

    expect(labels(html)).toEqual(LABELS);
    for (const name of ["name", "category", "whatsapp", "postalCode", "zone", "consent"]) {
      expect(has(control(html, name), "required"), name).toBe(true);
    }
    for (const name of [
      "zoneOther",
      "whatYouOffer",
      "homeDelivery",
      "landline",
      "address",
      "openingHours",
    ]) {
      expect(has(control(html, name), "required"), name).toBe(false);
    }
    expect(has(control(html, "facebookUrl"), "required")).toBe(false);
    expect(has(control(html, "photo"), "required")).toBe(false);
    expect(has(control(html, "removePhoto"), "required")).toBe(false);
    expect(alerts(html)).toEqual([]);
    for (const tag of controls(formOf(html))) {
      if (attribute(tag, "type") === "hidden") continue;
      expect(attribute(tag, "value") ?? "", tag).toBe("");
      expect(has(tag, "checked"), tag).toBe(false);
      expect(has(tag, "aria-invalid"), tag).toBe(false);
      expect(has(tag, "autofocus"), tag).toBe(false);
    }
    expect(formOf(html)).toMatch(/<textarea\b[^>]*name="whatYouOffer"[^>]*><\/textarea>/);
  });

  // Scenario: closed catalogue lists (the categories; the zones are the v2 field)
  it("the 8 categories of the catalogue, in its order, after the empty choice", async () => {
    const select = /<select\b[\s\S]*?<\/select>/.exec(await render())?.[0] ?? "";
    const options = [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];

    expect(options.map(([, , text = ""]) => readable(text))).toEqual([
      "Elige una categoría",
      ...CATALOGUE.categories.map(({ name }) => name),
    ]);
    expect(options.map(([, tag = ""]) => attribute(tag, "value"))).toEqual([
      "",
      ...CATALOGUE.categories.map(({ slug }) => slug),
    ]);
    expect(has(options[0]?.[1] ?? "", "selected")).toBe(true);
  });

  it("the opening hours: the example the way a business says it and the help, always visible", async () => {
    const html = await render();
    const hours = control(html, "openingHours");

    expect(attribute(hours, "placeholder")).toBe(
      "Lunes a sábado de 9 de la mañana a 7 de la tarde",
    );
    const help = attribute(hours, "aria-describedby") ?? "";
    expect(
      readable(new RegExp(`<p id="${help}"[^>]*>([\\s\\S]*?)</p>`).exec(html)?.[1] ?? ""),
    ).toBe(
      "Escríbelo como se lo dirías a un cliente: 'L-S 9am-7pm', 'Todos los días de 8 a 8', 'Solo fines de semana'.",
    );
  });

  // The search text has no field (The registration leaves the card ready
  // for the search, scenario "the form does not change for the owner"), nor
  // does the photo key (scenario "the client cannot set the photo
  // reference")
  it("its only fields are those of the form, the version it carries and the trap field", async () => {
    const names = controls(formOf(await render()))
      .map((tag) => attribute(tag, "name"))
      .filter((name) => name !== undefined);

    expect(names).toEqual([
      "website",
      "name",
      "category",
      "whatsapp",
      "postalCode",
      "zone",
      "zoneOther",
      "whatYouOffer",
      "homeDelivery",
      "landline",
      "address",
      "openingHours",
      "facebookUrl",
      "photo",
      "removePhoto",
      "noticeVersion",
      "consent",
    ]);
  });
});

describe('The "¿Qué ofreces?" example adapts to the chosen category', () => {
  it("with no category chosen, the generic example; each option carries its own", async () => {
    const html = await render();

    expect(attribute(control(html, "whatYouOffer"), "placeholder")).toBe(
      "ej. palabras clave de lo que ofreces",
    );
    const select = /<select\b[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
    const examples = Object.fromEntries(
      [...select.matchAll(/<option\b([^>]*)>/g)]
        .map(([, tag = ""]) => [attribute(tag, "value"), attribute(tag, "data-example")])
        .filter(([value]) => value !== ""),
    );
    // Scenarios: home services example; sports example
    expect(examples["servicios-del-hogar"]).toBe(
      "ej. plomería, destape de drenajes, bombas de agua",
    );
    expect(examples["clubes-y-escuelas-deportivas"]).toBe(
      "ej. futbol infantil 6-12 años, entrenamientos martes y jueves",
    );
    expect(Object.keys(examples)).toHaveLength(8);
  });

  it("when the form comes back with a category chosen, its example", async () => {
    const html = await render({
      draft: { ...EMPTY_REGISTRATION_DRAFT, category: "clubes-y-escuelas-deportivas" },
      errors: { name: "required" },
    });

    expect(attribute(control(html, "whatYouOffer"), "placeholder")).toBe(
      "ej. futbol infantil 6-12 años, entrenamientos martes y jueves",
    );
  });
});

describe("Form states and registration accessibility", () => {
  // Scenario: announced errors; empty required fields
  it("each error sits next to its field, tied to it, and the first field with one takes the focus", async () => {
    const html = await render({
      errors: {
        name: "required",
        category: "required",
        whatsapp: "invalid",
        postalCode: "required",
        zone: "required",
      },
    });

    for (const name of ["name", "category", "whatsapp", "postalCode", "zone"]) {
      const tag = control(html, name);
      const id = attribute(tag, "id") ?? "";
      expect(attribute(tag, "aria-invalid"), name).toBe("true");
      expect((attribute(tag, "aria-describedby") ?? "").split(" "), name).toContain(`${id}-error`);
      expect(html, name).toMatch(new RegExp(`<p id="${id}-error" role="alert"`));
      expect(labelFor(html, id)).not.toBe("");
    }
    expect(alerts(html)).toEqual([
      "Escribe el nombre de tu negocio",
      "Elige una categoría",
      "Revisa tu número de WhatsApp: deben ser 10 dígitos",
      "Escribe tu código postal",
      "Elige tu colonia",
    ]);
    const focused = controls(formOf(html)).filter((tag) => has(tag, "autofocus"));
    expect(focused.map((tag) => attribute(tag, "name"))).toEqual(["name"]);
    // An error is never colour alone: a thicker outline and the bold message.
    expect(attribute(control(html, "name"), "class")).toContain("border-2 border-ink");
  });

  it("the focus goes to the first field in the order of the screen", async () => {
    const html = await render({ errors: { facebookUrl: "invalid", landline: "invalid" } });
    const focused = controls(formOf(html)).filter((tag) => has(tag, "autofocus"));

    expect(focused.map((tag) => attribute(tag, "name"))).toEqual(["landline"]);
  });

  // Scenario: numeric keyboard; the landline asks for the phone keyboard
  it("the WhatsApp opens the numeric keyboard; the landline the phone keyboard; the link the URL one", async () => {
    const html = await render();

    expect(attribute(control(html, "whatsapp"), "type")).toBe("tel");
    expect(attribute(control(html, "whatsapp"), "inputmode")).toBe("numeric");
    expect(attribute(control(html, "landline"), "type")).toBe("tel");
    expect(attribute(control(html, "landline"), "inputmode")).toBe("tel");
    expect(attribute(control(html, "facebookUrl"), "type")).toBe("url");
  });

  // Scenario: submitting state; registration works without client JavaScript
  it("posts to its own page with the action, leaves every check to the server, and says Enviando... only with its script", async () => {
    const html = await render();
    const [form = ""] = formOf(html).match(/<form\b[^>]*>/) ?? [];
    const button = controls(formOf(html)).find((tag) => tag.startsWith("<button")) ?? "";

    expect(attribute(form, "method")).toBe("post");
    expect(attribute(form, "action")).toBe(ACTION);
    expect(has(form, "novalidate")).toBe(true);
    expect(attribute(button, "type")).toBe("submit");
    expect(attribute(button, "data-sending-text")).toBe("Enviando...");
    expect(attribute(button, "class")).toMatch(/\bbg-action\b/);
    expect(readable(/<button\b[\s\S]*?<\/button>/.exec(html)?.[0] ?? "")).toBe(
      "Registrar mi negocio",
    );
  });

  // Registration works without client JavaScript: scenario "JS limited to
  // the example field"
  it("its only script is one module of the site, never inline", async () => {
    const scripts = [...(await render()).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];

    expect(scripts).toHaveLength(1);
    const [, tag = "", body = ""] = scripts[0] ?? [];
    expect(attribute(tag, "type")).toBe("module");
    expect(attribute(tag, "src")).toMatch(/RegistrationForm\.astro/);
    expect(body.trim()).toBe("");
  });
});

describe("Turnstile is checked on the server, fails closed and has a switch in the database (v2)", () => {
  const SITE_KEY = "1x00000000000000000000AA";
  const on = { turnstile: { siteKey: SITE_KEY } };

  // Scenario: the kill switch (on)
  it("with the switch on, the widget goes after the consent and before the button, with the site key and the form's action", async () => {
    const form = formOf(await render(on));
    const widget = /<div\b[^>]*data-turnstile-widget[^>]*>/.exec(form)?.[0] ?? "";

    expect(attribute(widget, "data-sitekey")).toBe(SITE_KEY);
    expect(attribute(widget, "data-action")).toBe("registration");
    expect(form.indexOf("data-turnstile-widget")).toBeGreaterThan(form.indexOf('name="consent"'));
    expect(form.indexOf("data-turnstile-widget")).toBeLessThan(form.indexOf("<button"));
    // The failure message waits hidden for a script that cannot load.
    const failed = /<p\b[^>]*data-turnstile-failed[^>]*>([\s\S]*?)<\/p>/.exec(form);
    expect(has(failed?.[0] ?? "", "hidden")).toBe(true);
    expect(readable(failed?.[1] ?? "")).toBe(
      "No pudimos comprobar que eres una persona. Vuelve a intentarlo.",
    );
    // Turnstile's own script is added by the widget's, never by the page.
    expect(await render(on)).not.toContain("challenges.cloudflare.com");
  });

  // Scenario: the kill switch (off)
  it("with the switch off, no widget, no message about JavaScript and a button ready to send", async () => {
    const html = await render();
    const button = controls(formOf(html)).find((tag) => tag.startsWith("<button")) ?? "";

    expect(html).not.toContain("data-turnstile");
    expect(html).not.toContain("<noscript");
    expect(has(button, "disabled")).toBe(false);
  });

  it("a submission Turnstile refused comes back with the literal message above the form and what was written", async () => {
    const html = await render({ ...on, draft: FULL_DRAFT, general: "turnstile" });

    expect(alerts(html)).toEqual([
      "No pudimos comprobar que eres una persona. Vuelve a intentarlo.",
      // The widget's hidden failure message is in the markup too.
      "No pudimos comprobar que eres una persona. Vuelve a intentarlo.",
    ]);
    expect(formOf(html).indexOf("No pudimos comprobar")).toBeLessThan(
      formOf(html).indexOf('<label for="registration-name"'),
    );
    expect(attribute(control(html, "name"), "value")).toBe("Plomería Güicho");
    expect(formOf(html)).toContain("data-turnstile-widget");
  });

  it("an environment without a site key it may use says the check could not be done, and the form cannot be sent", async () => {
    const html = await render({ turnstile: { siteKey: null } });
    const button = controls(formOf(html)).find((tag) => tag.startsWith("<button")) ?? "";

    expect(html).not.toContain("data-turnstile-widget");
    expect(alerts(html)).toEqual([
      "No pudimos comprobar que eres una persona. Vuelve a intentarlo.",
    ]);
    expect(has(button, "disabled")).toBe(true);
  });

  // The content security policy allows no inline script
  it("the widget's script is a module of the site, never inline, beside the form's", async () => {
    const scripts = [...(await render(on)).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];

    expect(scripts.map(([, tag = ""]) => attribute(tag, "src"))).toEqual([
      expect.stringMatching(/TurnstileWidget\.astro/),
      expect.stringMatching(/RegistrationForm\.astro/),
    ]);
    for (const [, tag = "", body = ""] of scripts) {
      expect(attribute(tag, "type")).toBe("module");
      expect(body.trim()).toBe("");
    }
  });
});

describe("Without JavaScript the registration says so and cannot be sent while Turnstile is on (v2)", () => {
  // Scenario: no JavaScript
  it("the message, literally, above the fields in a noscript, and the button disabled until the widget has a token", async () => {
    const html = await render({ turnstile: { siteKey: "1x00000000000000000000AA" } });
    const form = formOf(html);
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(form);
    const button = controls(form).find((tag) => tag.startsWith("<button")) ?? "";

    expect(readable(noscript?.[1] ?? "")).toBe(
      "Para registrar tu negocio, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona.",
    );
    expect(form.indexOf("<noscript>")).toBeLessThan(form.indexOf('<label for="registration-name"'));
    expect(has(button, "disabled")).toBe(true);
    expect(attribute(button, "type")).toBe("submit");
    // The only submit control: pressing Enter in a field sends nothing either.
    expect(controls(form).filter((tag) => /type="submit"/.test(tag))).toHaveLength(1);
  });
});

describe("The photo field explains the PRD §6.1 policy and opens the phone gallery", () => {
  const POLICY =
    "Una foto de tu local, de tus productos o de tu trabajo. Que no salgan personas que se puedan reconocer. Máximo 5 MB (JPG, PNG o WebP); nosotros la comprimimos para que cargue rápido.";

  // Scenario: choosing a photo from the phone
  it("a file field for one image, labelled, with the policy above it and tied to it", async () => {
    const html = await render();
    const photo = control(html, "photo");
    const id = attribute(photo, "id") ?? "";

    expect(attribute(photo, "type")).toBe("file");
    // The formats the server takes: iOS turns a HEIC photo into a JPEG.
    expect(attribute(photo, "accept")).toBe("image/jpeg,image/png,image/webp");
    // One photo, chosen from the gallery: no `multiple`, no `capture`.
    expect(has(photo, "multiple")).toBe(false);
    expect(has(photo, "capture")).toBe(false);
    expect(labelFor(html, id)).toBe("Foto de tu negocio (opcional)");
    const helpId = `${id}-help`;
    expect(attribute(photo, "aria-describedby")).toBe(helpId);
    expect(
      readable(new RegExp(`<p id="${helpId}"[^>]*>([\\s\\S]*?)</p>`).exec(html)?.[1] ?? ""),
    ).toBe(POLICY);
    // Visible before choosing the file: above it.
    expect(html.indexOf(`id="${helpId}"`)).toBeLessThan(html.indexOf(`id="${id}"`));
    expect(attribute(photo, "class")).toMatch(/\bmin-h-11\b/);
  });

  it("the form sends the photo in the same submission", async () => {
    const [form = ""] = formOf(await render()).match(/<form\b[^>]*>/) ?? [];
    expect(attribute(form, "enctype")).toBe("multipart/form-data");
    expect(attribute(form, "method")).toBe("post");
  });

  // Scenario: the remove-photo checkbox is the same for everyone
  it('"Dejar mi ficha sin foto" is always there, the same, unchecked, below the field', async () => {
    const html = await render();
    const checkbox = control(html, "removePhoto");

    expect(attribute(checkbox, "type")).toBe("checkbox");
    expect(has(checkbox, "checked")).toBe(false);
    expect(labelFor(html, attribute(checkbox, "id") ?? "")).toBe("Dejar mi ficha sin foto");
    expect(html.indexOf('name="photo"')).toBeLessThan(html.indexOf('name="removePhoto"'));
    // Between the Facebook link and the consent.
    const names = controls(formOf(html)).map((tag) => attribute(tag, "name"));
    expect(names.indexOf("photo")).toBe(names.indexOf("facebookUrl") + 1);
    expect(names.indexOf("removePhoto")).toBeLessThan(names.indexOf("consent"));
    // The same markup whatever the form comes back with.
    const again = await render({ draft: FULL_DRAFT, errors: { whatsapp: "duplicate" } });
    expect(control(again, "removePhoto")).toBe(checkbox);
  });

  it("the checkbox comes back as it was sent", async () => {
    const html = await render({
      draft: { ...FULL_DRAFT, removePhoto: true },
      errors: { name: "required" },
    });
    expect(has(control(html, "removePhoto"), "checked")).toBe(true);
  });

  // Scenarios: photo over 5 MB; file disguised as an image; huge image in
  // pixels; more photos arrive than fit at once; a failure while transforming
  it.for([
    ["too-large", "Esa foto pesa más de 5 MB. Sube una más ligera."],
    ["unreadable", "No pudimos leer esa foto. Sube una imagen JPG, PNG o WebP."],
    ["busy", "Estamos recibiendo muchas fotos, intenta de nuevo en un momento"],
    ["failed", "No pudimos procesar tu foto. Intenta con otra o envía tu registro sin foto."],
  ] as const)(
    "the photo's error %s sits next to it, takes the focus, and the rest stays",
    async ([code, message]) => {
      const html = await render({ draft: { ...FULL_DRAFT, photo: true }, errors: { photo: code } });
      const photo = control(html, "photo");
      const id = attribute(photo, "id") ?? "";

      expect(alerts(html)).toEqual([message]);
      expect(attribute(photo, "aria-invalid")).toBe("true");
      expect((attribute(photo, "aria-describedby") ?? "").split(" ")).toEqual([
        `${id}-help`,
        `${id}-error`,
      ]);
      expect(html).toMatch(new RegExp(`<p id="${id}-error" role="alert"`));
      expect(has(photo, "autofocus")).toBe(true);
      expect(attribute(photo, "class")).toContain("border-2 border-ink");
      expect(attribute(control(html, "name"), "value")).toBe("Plomería Güicho");
    },
  );

  // Scenario: the photo has to be chosen again
  it("when the form comes back for another field, a photo that was sent has to be chosen again", async () => {
    const html = await render({
      draft: { ...FULL_DRAFT, photo: true },
      errors: { whatsapp: "invalid" },
    });
    const photo = control(html, "photo");
    const id = attribute(photo, "id") ?? "";

    expect(alerts(html)).toEqual([
      "Revisa tu número de WhatsApp: deben ser 10 dígitos",
      "Tu foto no se quedó guardada: vuelve a elegirla antes de enviar.",
    ]);
    expect((attribute(photo, "aria-describedby") ?? "").split(" ")).toContain(`${id}-error`);
    // It is no error of the photo: the focus stays on the field that has one.
    expect(has(photo, "aria-invalid")).toBe(false);
    expect(has(photo, "autofocus")).toBe(false);
    expect(attribute(photo, "value")).toBeUndefined();
    // Over the quota or after a failure too.
    const quota = await render({ draft: { ...FULL_DRAFT, photo: true }, general: "quota" });
    expect(alerts(quota)).toContain(
      "Tu foto no se quedó guardada: vuelve a elegirla antes de enviar.",
    );
    // Without a photo sent, nothing is said.
    const without = await render({ draft: FULL_DRAFT, errors: { whatsapp: "invalid" } });
    expect(alerts(without)).toEqual(["Revisa tu número de WhatsApp: deben ser 10 dígitos"]);
  });
});

describe("The server validates every field and returns per-field errors in Spanish", () => {
  // Scenario: what was entered is not lost
  it("the form comes back with everything that was written, except the consent", async () => {
    const html = await render({
      draft: FULL_DRAFT,
      errors: {
        whatsapp: "invalid",
        landline: "invalid",
        facebookUrl: "invalid",
        consent: "required",
      },
    });

    expect(attribute(control(html, "name"), "value")).toBe("Plomería Güicho");
    expect(attribute(control(html, "whatsapp"), "value")).toBe("771 999 45");
    expect(attribute(control(html, "postalCode"), "value")).toBe("43899");
    expect(selectOf(html, "zone")).toMatch(/<option value="_otra" selected/);
    expect(attribute(control(html, "zoneOther"), "value")).toBe("Rinconada del Venado");
    expect(attribute(control(html, "landline"), "value")).toBe("no tengo");
    expect(attribute(control(html, "openingHours"), "value")).toBe("Solo fines de semana");
    expect(attribute(control(html, "facebookUrl"), "value")).toBe("facebook.com/minegocio");
    expect(has(control(html, "homeDelivery"), "checked")).toBe(true);
    expect(has(control(html, "consent"), "checked")).toBe(false);
    expect(formOf(html)).toMatch(/name="whatYouOffer"[^>]*>destape de drenajes<\/textarea>/);
    expect(formOf(html)).toMatch(/name="address"[^>]*>a un lado de la primaria<\/textarea>/);
    const select = /<select\b[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
    expect(select).toMatch(/<option value="servicios-del-hogar" selected/);
    expect(alerts(html)).toEqual([
      "Revisa tu número de WhatsApp: deben ser 10 dígitos",
      "Revisa el teléfono fijo: escribe solo números (puedes usar espacios, guiones o paréntesis)",
      "El link de Facebook debe empezar con http:// o https://",
      "Marca la casilla para poder registrar tu negocio",
    ]);
  });

  // Scenarios: "¿Qué ofreces?" too long; number with a published card
  it("the length and duplicate messages, next to their fields", async () => {
    const html = await render({ errors: { whatYouOffer: "length", whatsapp: "duplicate" } });

    expect(alerts(html)).toEqual([
      "Este número ya tiene una ficha registrada. Si es tu negocio, no hace falta registrarlo otra vez: te vamos a pasar por WhatsApp el enlace para editarlo.",
      "Deja esto en 200 caracteres o menos",
    ]);
    // Scenario: registration does not hand out management links: the only
    // link of the page is the one to the full notice
    const links = [...mainOf(html).matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(([, href]) => href);
    expect(links).toEqual(["/aviso-de-privacidad"]);
    expect(mainOf(html)).not.toMatch(/\/editar|token/);
  });

  // Scenario: save failure; per-IP limit
  it("over the quota or after a failure, the message goes above the form, with what was written", async () => {
    for (const [general, message] of [
      ["quota", "Ya recibimos varios registros desde aquí. Espera un rato y vuelve a intentar."],
      ["server", "No pudimos guardar tu registro. Vuelve a intentarlo en un momento."],
    ] as const) {
      const html = await render({ draft: FULL_DRAFT, general });
      expect(alerts(html), general).toEqual([message]);
      expect(formOf(html).indexOf(message), general).toBeLessThan(
        formOf(html).indexOf('<label for="registration-name"'),
      );
      expect(attribute(control(html, "name"), "value"), general).toBe("Plomería Güicho");
    }
  });

  it("what was written is shown as text, escaped, and breaks nothing", async () => {
    const markup = '</textarea><script>alert(1)</script>"><b>';
    const html = await render({
      draft: { ...FULL_DRAFT, name: markup, address: markup, zone: markup, zoneOther: markup },
      errors: { name: "length" },
    });

    // Inside a quoted attribute a tag is text; outside, only the page's own
    // script is a tag.
    const markupOnly = html.replace(/="[^"]*"/g, "");
    expect(markupOnly.match(/<script\b/g)).toHaveLength(1);
    expect(markupOnly).not.toContain("<b>");
    expect(formOf(html)).toContain(
      "&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;b&gt;</textarea>",
    );
    expect(attribute(control(html, "name"), "value")).toBe(markup);
    expect(attribute(control(html, "zoneOther"), "value")).toBe(markup);
    // An unknown zone chooses no option.
    expect(selectOf(html, "zone")).toMatch(/<option value="" selected/);
  });
});

describe("Consent with a visible simplified notice and a consent record", () => {
  // Scenarios: notice visible without leaving the form; the simplified notice
  // warns that the WhatsApp and the phone become public; it names the site
  // with the current brand; the version is visible before accepting; link to
  // the full notice
  it("the simplified notice, the link to the full notice, the version and the checkbox, in that order", async () => {
    const html = await render();
    const block = /<div class="flex flex-col gap-3 rounded-lg[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    const parts = [...block.matchAll(/<(p|a|label)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(
      ([, tag, inner = ""]) => `${tag} ${readable(inner)}`,
    );

    expect(parts).toEqual([
      `p ${SIMPLIFIED_NOTICE}`,
      "a Lee el aviso de privacidad completo",
      `p Estás aceptando la versión ${NOTICE_VERSION} del aviso de privacidad.`,
      `label ${LABELS.at(-1)}`,
    ]);
    const link = /<a\b[^>]*>/.exec(block)?.[0] ?? "";
    expect(attribute(link, "href")).toBe("/aviso-de-privacidad");
    expect(has(link, "target")).toBe(false);
    expect(attribute(link, "class")).toContain("min-h-11");
    expect(html).not.toContain("Cuando publiquemos el aviso completo");
    expect(html).not.toMatch(/EnMiRumbo|enmirumbo Tizayuca/);
  });

  // Nobody consents to a notice version they did not have in front of them:
  // the datum travels in the form's own submission
  it("the form carries the version it was rendered with, and the checkbox is never checked", async () => {
    const html = await render({ errors: { consent: "notice-changed" } });

    expect(attribute(control(html, "noticeVersion"), "type")).toBe("hidden");
    expect(attribute(control(html, "noticeVersion"), "value")).toBe(NOTICE_VERSION);
    const consent = control(html, "consent");
    expect(has(consent, "checked")).toBe(false);
    expect(has(consent, "autofocus")).toBe(true);
    expect(attribute(consent, "aria-describedby")).toBe("registration-consent-error");
    expect(alerts(html)).toEqual([
      "El aviso de privacidad cambió mientras llenabas esto. Léelo otra vez y vuelve a marcar la casilla.",
    ]);
  });
});

describe("The zone is chosen from the zones of the postal code the business types, or written when it does not appear (v2)", () => {
  /** The help of a control: the first id it is described by. */
  const helpOf = (html: string, tag: string) => {
    const help = (attribute(tag, "aria-describedby") ?? "").split(" ")[0] ?? "";
    return readable(new RegExp(`<p id="${help}"[^>]*>([\\s\\S]*?)</p>`).exec(html)?.[1] ?? "");
  };
  /** The groups of the zone select: each label, its postal code and its options. */
  const groupsOf = (select: string) =>
    [...select.matchAll(/<optgroup\b([^>]*)>([\s\S]*?)<\/optgroup>/g)].map(
      ([, tag = "", inner = ""]) => ({
        label: attribute(tag, "label"),
        // An empty attribute is written without its value.
        postalCode:
          attribute(tag, "data-postal-code") ?? (has(tag, "data-postal-code") ? "" : undefined),
        options: [...inner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(
          ([, option = "", text = ""]) => [attribute(option, "value"), readable(text)],
        ),
      }),
    );

  it("the postal code comes first: five digits, the numeric keyboard, and where to find it", async () => {
    const html = await render();
    const postalCode = control(html, "postalCode");

    expect(labels(html).indexOf("Código postal")).toBe(
      labels(html).indexOf("¿En qué colonia estás?") - 1,
    );
    expect(attribute(postalCode, "type")).toBe("text");
    expect(attribute(postalCode, "inputmode")).toBe("numeric");
    expect(attribute(postalCode, "maxlength")).toBe("5");
    expect(attribute(postalCode, "autocomplete")).toBe("postal-code");
    expect(helpOf(html, postalCode)).toBe(
      "Si no te lo sabes, viene en tu recibo de luz o de agua.",
    );
  });

  it("a classic select: every visible zone by display name, grouped by postal code in order, and Mi colonia no aparece last", async () => {
    const html = await render();
    const select = selectOf(html, "zone");
    const options = [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];

    expect(attribute(options[0]?.[1] ?? "", "value")).toBe("");
    expect(readable(options[0]?.[2] ?? "")).toBe("Elige tu colonia");
    expect(has(options[0]?.[1] ?? "", "selected")).toBe(true);
    expect(groupsOf(select)).toEqual([
      { label: "C.P. 43808", postalCode: "43808", options: [["huicalco", "Huicalco"]] },
      {
        label: "C.P. 43815",
        postalCode: "43815",
        options: [
          ["colonia-el-carmen", "El Carmen (Colonia)"],
          ["haciendas-de-tizayuca", "Haciendas de Tizayuca"],
        ],
      },
    ]);
    const last = options.at(-1);
    expect(attribute(last?.[1] ?? "", "value")).toBe("_otra");
    expect(readable(last?.[2] ?? "")).toBe("Mi colonia no aparece");
    expect(select.lastIndexOf("</optgroup>")).toBeLessThan(select.indexOf('value="_otra"'));
    expect(helpOf(html, control(html, "zone"))).toBe(
      "Si tu colonia no aparece en la lista, elige “Mi colonia no aparece” y escríbela abajo.",
    );
    // No suggestions of the browser any more.
    expect(html).not.toContain("<datalist");
  });

  it("without JavaScript, the field for the name of a zone that does not appear is always there", async () => {
    const html = await render();
    const wrapper = /<div\b[^>]*data-zone-other[^>]*>/.exec(html)?.[0] ?? "";

    expect(wrapper).not.toBe("");
    expect(has(wrapper, "hidden")).toBe(false);
    expect(labelFor(html, "registration-zoneOther")).toBe(
      "Si tu colonia no aparece, escribe cómo se llama",
    );
    expect(attribute(control(html, "zoneOther"), "maxlength")).toBe("80");
  });

  it("what the script says of a postal code no zone has waits in the markup, empty and announced", async () => {
    const html = await render();
    const hint = /<p\b([^>]*data-postal-code-hint[^>]*)>([\s\S]*?)<\/p>/.exec(html);

    expect(attribute(hint?.[1] ?? "", "role")).toBe("status");
    expect(hint?.[2]).toBe("");
    expect(attribute(hint?.[1] ?? "", "data-postal-code-hint")).toBe(
      "No tenemos colonias con ese código postal. Revisa que esté bien o elige “Mi colonia no aparece”.",
    );
  });

  it("zones without a postal code go last, under Otras colonias", async () => {
    const html = await render({
      catalogue: {
        ...CATALOGUE,
        zones: [
          ...CATALOGUE.zones,
          { id: 14, slug: "nueva", name: "Nueva", displayName: "Nueva", postalCode: null },
        ],
      },
    });

    expect(
      groupsOf(selectOf(html, "zone")).map(({ label, postalCode }) => [label, postalCode]),
    ).toEqual([
      ["C.P. 43808", "43808"],
      ["C.P. 43815", "43815"],
      ["Otras colonias", ""],
    ]);
  });

  it("the form comes back with the zone chosen, or Mi colonia no aparece with its name", async () => {
    const chosen = await render({
      draft: { ...EMPTY_REGISTRATION_DRAFT, postalCode: "43808", zone: "huicalco" },
      errors: { name: "required" },
    });
    expect(selectOf(chosen, "zone")).toMatch(/<option value="huicalco" selected/);
    expect(selectOf(chosen, "zone")).not.toMatch(/<option value="" selected/);
    expect(attribute(control(chosen, "postalCode"), "value")).toBe("43808");

    const other = await render({ draft: FULL_DRAFT, errors: { name: "required" } });
    expect(selectOf(other, "zone")).toMatch(/<option value="_otra" selected/);
    expect(attribute(control(other, "zoneOther"), "value")).toBe("Rinconada del Venado");
  });

  // Scenarios: a zone of another postal code; "Otra" without text
  it("the errors of the postal code and the zone, next to their fields, the first one focused", async () => {
    const html = await render({
      draft: { ...EMPTY_REGISTRATION_DRAFT, postalCode: "43815", zone: "huicalco" },
      errors: { postalCode: "invalid", zone: "postal-code", zoneOther: "required" },
    });

    expect(alerts(html)).toEqual([
      "Revisa tu código postal: deben ser 5 dígitos",
      "Esa colonia no es de ese código postal. Revisa el código o elige otra colonia.",
      "Escribe el nombre de tu colonia",
    ]);
    for (const name of ["postalCode", "zone", "zoneOther"]) {
      expect(attribute(control(html, name), "aria-invalid"), name).toBe("true");
    }
    const focused = controls(formOf(html)).filter((tag) => has(tag, "autofocus"));
    expect(focused.map((tag) => attribute(tag, "name"))).toEqual(["postalCode"]);
  });
});

describe("The registration's honeypot and per-IP quota are those of the public forms (v2)", () => {
  // Scenario: the honeypot does not bother people
  it("the trap field is off the screen, out of the keyboard's order and hidden from screen readers", async () => {
    const html = await render();
    const trap = control(html, "website");

    expect(formOf(html)).toMatch(/<div aria-hidden="true" class="absolute left-\[-9999px\]/);
    expect(attribute(trap, "tabindex")).toBe("-1");
    expect(attribute(trap, "autocomplete")).toBe("off");
  });
});

describe("A successful submission queues the business and shows the thank-you screen", () => {
  // Scenario: successful registration
  it("the literal of PRD §6.1 as its only h1, and Volver al inicio to the home of the locality", async () => {
    const html = await renderThanks();
    const main = mainOf(html);

    expect(
      [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(([, t = ""]) => readable(t)),
    ).toEqual([
      "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo.",
    ]);
    const links = [...main.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
    expect(links.map(([, href, text = ""]) => [href, readable(text)])).toEqual([
      ["/hidalgo/tizayuca", "Volver al inicio"],
    ]);
    // Scenario: reload after success: nothing to send again
    expect(main).not.toMatch(/<form\b/);
    expect(html).not.toMatch(/<script\b/);
  });

  it("it is never indexed, and its title is static", async () => {
    const html = await renderThanks(OTHER);

    expect(html).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).not.toContain('rel="canonical"');
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(
      "Gracias por registrar tu negocio — enmirumbo",
    );
    expect(mainOf(html)).toContain('href="/estado-de-prueba-91/pueblo-uno"');
  });
});

// business-registration, "The registration funnel is measured with the views
// of its two screens" and "No form data travels to the measurement"; and
// base-layout, "Two product events and the no-results tag are recorded, only
// in production (v2)", scenario: a registration is measured by its page
// views. In production with a Website ID both screens load Umami's script,
// which leaves the query of the address out (`data-exclude-search`), and
// nothing on them declares an event or adds a script to measure. The
// addresses the browser shows, the answer with errors and the 303 to the
// thank-you page, are checked end to end in test/e2e/registration.spec.ts.
describe("The registration funnel is measured with the views of its two screens", () => {
  const WEBSITE_ID = "94db1cb1-74f4-4a40-ad6c-962362670409";
  const UMAMI = `<script defer src="https://cloud.umami.is/script.js" data-website-id="${WEBSITE_ID}" data-exclude-search="true">`;
  const SITE = "https://enmirumbo.com";

  function measured(): void {
    Object.assign(env, { ENVIRONMENT: "prod", SITE_URL: SITE, UMAMI_WEBSITE_ID: WEBSITE_ID });
  }

  /** Every script tag, as its opening tag. */
  const scripts = (html: string): string[] => html.match(/<script\b[^>]*>/g) ?? [];

  /** The head, as a person would read its values. */
  const headOf = (html: string): string => decode(/<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "");

  // Scenarios: successful registration (the view of the form); no
  // instrumentation on the button
  it("the form page loads Umami's script and its own module, and declares no event", async () => {
    measured();
    const html = await render();
    const tags = scripts(html);

    expect(tags.filter((tag) => tag.includes("umami"))).toEqual([UMAMI]);
    const own = tags.filter((tag) => !tag.includes("umami"));
    expect(own).toHaveLength(1);
    expect(attribute(own[0] ?? "", "src")).toMatch(/RegistrationForm\.astro/);
    // Neither the form, nor its button, nor anything else carries an event.
    expect(html).not.toContain("data-umami");
  });

  // Scenarios: a submission with errors does not count as a conversion; the
  // registration URLs carry no data
  it("the form that comes back with errors is the same page to the measurement, and nothing written reaches it", async () => {
    measured();
    const html = await render({
      address: `${PATH}${ACTION}`,
      draft: FULL_DRAFT,
      errors: { whatsapp: "invalid", landline: "invalid", facebookUrl: "invalid" },
    });

    expect(alerts(html)).toHaveLength(3);
    // The same script, no tag: the view is of the form's address, without its query.
    expect(scripts(html).filter((tag) => tag.includes("umami"))).toEqual([UMAMI]);
    expect(html).not.toContain("data-umami");
    // What the owner wrote travels in no channel of the measurement: no
    // attribute of the script, no title, no address the page declares.
    const head = headOf(html);
    expect(/<title>([^<]*)<\/title>/.exec(head)?.[1]).toBe(
      "Registra tu negocio gratis en Tizayuca — enmirumbo",
    );
    expect(head).toContain(`<link rel="canonical" href="${SITE}${PATH}">`);
    expect(head).not.toMatch(/Güicho|771 999 45|Rinconada|drenajes|primaria|semana|minegocio/);
    const [form = ""] = formOf(html).match(/<form\b[^>]*>/) ?? [];
    expect(attribute(form, "action")).toBe(ACTION);
  });

  // Scenario: successful registration (the view of the thank-you page)
  it("the thank-you page, which needs no query, loads Umami's script alone and declares no event", async () => {
    measured();
    const html = await renderThanks();

    expect(scripts(html)).toEqual([UMAMI]);
    expect(html).not.toContain("data-umami");
    expect(readable(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "")).toBe(
      "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo.",
    );
  });
});
