// Scenarios of docs/specs/business-registration.md for the edit page of the
// management link and its confirmation, rendered with Astro's Container API:
// "The management link opens the card in edit mode with the same prefilled
// form", "A token that is not exactly the current one opens nothing and gives
// nothing away" (what the pages declare), "Sending the edit does not touch
// the public card: it creates a pending edit" (the confirmation), "The edit
// goes through the same validations as the registration and cannot set what
// is not its to set" (what the form shows), "Sending changes when others are
// already waiting replaces the previous ones" (the warning), "The
// registration and edit forms are protected by quotas, honeypot and
// Turnstile (v2)" and "The registration and edit forms require JavaScript for
// the anti-bot check and say so (v2)" (the edit's widget and message), and
// "The edit mode of a locality lives under it, and lands on its confirmation
// (v2)"; and of docs/specs/base-layout.md, "The admin panel and the edit mode
// stay out of the measurement by where they live (v2)". What the page
// decides, with the database, the action and the quota, runs end to end in
// test/e2e/edit.spec.ts; the submission is tested in test/worker/edit.test.ts.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import EditPage from "../../src/components/EditPage.astro";
import type { ServedLocality } from "../../src/core/locality/served.ts";
import type { RegistrationCatalogue } from "../../src/core/registration/catalogue.ts";
import {
  EMPTY_REGISTRATION_DRAFT,
  type GeneralError,
  type RegistrationDraft,
  type RegistrationErrors,
} from "../../src/core/registration/submission.ts";
import NotFoundPage from "../../src/pages/404.astro";
import EditThanksPage from "../../src/pages/[state]/[municipality]/editar/gracias.astro";
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

const CATALOGUE: RegistrationCatalogue = {
  categories: [
    { id: 1, name: "Restaurantes y fondas", slug: "restaurantes-y-fondas" },
    { id: 2, name: "Servicios del hogar", slug: "servicios-del-hogar" },
    { id: 3, name: "Belleza", slug: "belleza" },
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
  ],
};

/** A token of the shape a link has; fictitious, it opens nothing. */
const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE";
const PATH = `/hidalgo/tizayuca/editar/${TOKEN}`;
const ACTION = "?_action=edit";
const WEBSITE_ID = "94db1cb1-74f4-4a40-ad6c-962362670409";

/** The card of "Plomería Güicho" as its edit form is prefilled, with a zone "Otra". */
const CARD_DRAFT: RegistrationDraft = {
  ...EMPTY_REGISTRATION_DRAFT,
  name: "Plomería Güicho",
  category: "servicios-del-hogar",
  whatsapp: "7719990150",
  postalCode: "43899",
  zone: "_otra",
  zoneOther: "Rinconada del Venado",
  whatYouOffer: "destape de drenajes",
  homeDelivery: true,
  landline: "(775) 123-45-67",
  address: "a un lado de la primaria",
  openingHours: "Lunes a sábado de 9 a 7",
  facebookUrl: "https://facebook.com/plomeriaguicho",
};

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

afterEach(() => {
  for (const key of Object.keys(env)) delete env[key as keyof Env];
  env.ENVIRONMENT = "local";
});

interface State {
  draft?: RegistrationDraft;
  errors?: RegistrationErrors;
  general?: GeneralError | null;
  turnstile?: { siteKey: string | null } | null;
  waiting?: boolean;
  keptPhoto?: boolean;
}

/** The edit page in one of its states. */
function render({
  draft = CARD_DRAFT,
  errors = {},
  general = null,
  turnstile = null,
  waiting = false,
  keptPhoto = false,
}: State = {}): Promise<string> {
  return container.renderToString(EditPage, {
    partial: false,
    props: {
      catalogue: CATALOGUE,
      action: ACTION,
      draft,
      errors,
      general,
      turnstile,
      waiting,
      keptPhoto,
    },
    request: new Request(`https://enmirumbo.urekz.workers.dev${PATH}`),
    locals: { locality: TIZAYUCA } as App.Locals,
  });
}

function renderThanks(): Promise<string> {
  return container.renderToString(EditThanksPage, {
    partial: false,
    request: new Request("https://enmirumbo.urekz.workers.dev/hidalgo/tizayuca/editar/gracias"),
    locals: { locality: TIZAYUCA } as App.Locals,
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

const mainOf = (html: string) => /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? html;
const formOf = (html: string) => /<form\b[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";

function readable(markup: string): string {
  return decode(
    markup
      .replace(/<(\w+)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function controls(html: string): string[] {
  return html.match(/<(?:input|textarea|select|button)\b(?:[^>"]|"[^"]*")*>/g) ?? [];
}

const attribute = (tag: string, name: string): string | undefined => {
  const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  return value === undefined ? undefined : decode(value);
};
const has = (tag: string, name: string) => new RegExp(`\\s${name}(?:[\\s=>]|$)`).test(tag);

function control(html: string, name: string): string {
  const found = controls(formOf(html)).find((tag) => attribute(tag, "name") === name);
  if (!found) throw new Error(`no control ${name}`);
  return found;
}

const button = (html: string) =>
  controls(formOf(html)).find((tag) => tag.startsWith("<button")) ?? "";

function labels(html: string): string[] {
  return [...formOf(html).matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)]
    .filter(([tag]) => !tag.includes('for="website"'))
    .map(([, inner = ""]) => readable(inner));
}

function alerts(html: string): string[] {
  return [...mainOf(html).matchAll(/<p\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/p>/g)].map(
    ([, inner = ""]) => readable(inner),
  );
}

const WARNING =
  "Ojo: ya tienes cambios esperando revisión. Si mandas otros, estos reemplazan a los anteriores.";

describe("The management link opens the card in edit mode with the same prefilled form", () => {
  // Scenario: the owner opens their link
  it("Edita tu ficha as its only h1, its phrase, one form and Enviar cambios", async () => {
    const html = await render();
    const headings = [...mainOf(html).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)];
    expect(headings.map(([, level, inner = ""]) => `h${level} ${readable(inner)}`)).toEqual([
      "h1 Edita tu ficha",
    ]);
    expect(readable(mainOf(html))).toContain(
      "Cambia lo que necesites y lo revisamos antes de publicarlo. Mientras tanto tu ficha sigue como está.",
    );
    expect(mainOf(html).match(/<form\b/g)).toHaveLength(1);
    expect(readable(/<button\b[\s\S]*?<\/button>/.exec(formOf(html))?.[0] ?? "")).toBe(
      "Enviar cambios",
    );
    expect(controls(formOf(html)).filter((tag) => /type="submit"/.test(tag))).toHaveLength(1);
  });

  it("the registration's fields, labels and limits, without the consent, posted to its own page", async () => {
    const html = await render();
    expect(labels(html)).toEqual([
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
    ]);
    const names = controls(formOf(html))
      .map((tag) => attribute(tag, "name"))
      .filter(Boolean);
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
    ]);
    const form = /<form\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(attribute(form, "action")).toBe(ACTION);
    expect(attribute(form, "method")).toBe("post");
    expect(attribute(form, "enctype")).toBe("multipart/form-data");
    expect(has(form, "novalidate")).toBe(true);
    expect(attribute(control(html, "name"), "maxlength")).toBe("80");
    expect(attribute(control(html, "whatYouOffer"), "maxlength")).toBe("200");
  });

  it('every field is prefilled with the card, and a zone "Otra" as "Mi colonia no aparece" with its free text', async () => {
    const html = await render();
    expect(attribute(control(html, "name"), "value")).toBe("Plomería Güicho");
    expect(attribute(control(html, "whatsapp"), "value")).toBe("7719990150");
    expect(attribute(control(html, "postalCode"), "value")).toBe("43899");
    expect(formOf(html)).toMatch(/<option value="_otra" selected/);
    expect(attribute(control(html, "zoneOther"), "value")).toBe("Rinconada del Venado");
    expect(attribute(control(html, "landline"), "value")).toBe("(775) 123-45-67");
    expect(attribute(control(html, "openingHours"), "value")).toBe("Lunes a sábado de 9 a 7");
    expect(attribute(control(html, "facebookUrl"), "value")).toBe(
      "https://facebook.com/plomeriaguicho",
    );
    expect(has(control(html, "homeDelivery"), "checked")).toBe(true);
    expect(has(control(html, "removePhoto"), "checked")).toBe(false);
    const form = formOf(html);
    expect(/<option value="servicios-del-hogar"[^>]*selected/.test(form)).toBe(true);
    expect(
      readable(
        /<textarea[^>]*name="whatYouOffer"[^>]*>([\s\S]*?)<\/textarea>/.exec(form)?.[1] ?? "",
      ),
    ).toBe("destape de drenajes");
    expect(
      readable(/<textarea[^>]*name="address"[^>]*>([\s\S]*?)<\/textarea>/.exec(form)?.[1] ?? ""),
    ).toBe("a un lado de la primaria");
    // The category's own example, already written by the server.
    expect(attribute(control(html, "whatYouOffer"), "placeholder")).toBe(
      "ej. plomería, destape de drenajes, bombas de agua",
    );
    // The zone's options are the locality's, by postal code.
    expect(form).toContain('<optgroup label="C.P. 43815" data-postal-code="43815">');
    expect(form).toContain('<option value="colonia-el-carmen">El Carmen (Colonia)</option>');
    expect(alerts(html)).toEqual([]);
  });

  // Scenario: the edit does not ask for consent again
  it("no consent checkbox and no notice version: the note and the link to the full notice instead", async () => {
    const html = await render();
    const form = formOf(html);
    expect(form).not.toContain('name="consent"');
    expect(form).not.toContain('name="noticeVersion"');
    expect(readable(form)).not.toContain("Aviso de privacidad (resumen)");
    expect(readable(form)).not.toContain("Estás aceptando la versión");
    expect(readable(form)).toContain(
      "Tus datos siguen protegidos por el mismo aviso de privacidad que aceptaste al registrarte.",
    );
    const links = [...form.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(
      links.map(([, tag = "", text = ""]) => [attribute(tag, "href"), readable(text)]),
    ).toEqual([["/aviso-de-privacidad", "Lee el aviso de privacidad completo"]]);
    // In the same tab.
    expect(links[0]?.[1]).not.toContain("target=");
    expect(links[0]?.[1]).toContain("min-h-11");
    // The note sits where the consent would, before the button.
    expect(form.indexOf("Tus datos siguen protegidos")).toBeGreaterThan(
      form.indexOf('name="removePhoto"'),
    );
    expect(form.indexOf("Tus datos siguen protegidos")).toBeLessThan(form.indexOf("<button"));
  });

  // Scenario: mobile-first at 390px
  it("every control is at least 44px tall, and no class blocks the responsive collapse", async () => {
    const html = await render({ waiting: true });
    for (const tag of controls(formOf(html))) {
      const type = attribute(tag, "type");
      if (type === "hidden" || type === "checkbox" || attribute(tag, "name") === "website")
        continue;
      expect(attribute(tag, "class") ?? "", tag).toMatch(/\bpy-3\b|\bmin-h-11\b/);
    }
    const classes = [...html.matchAll(/\bclass="([^"]*)"/g)].map(([, value = ""]) => value);
    expect(classes.flatMap(collapseProblems)).toEqual([]);
  });
});

describe("Sending changes when others are already waiting replaces the previous ones", () => {
  // Scenario: warning when opening with pending changes
  it("with an edit waiting, the warning at the top, before the form; without one, none", async () => {
    const waiting = mainOf(await render({ waiting: true }));
    expect(readable(waiting)).toContain(WARNING);
    expect(waiting.indexOf("Ojo: ya tienes cambios")).toBeLessThan(waiting.indexOf("<form"));
    expect(waiting.indexOf("Ojo: ya tienes cambios")).toBeGreaterThan(waiting.indexOf("<h1"));
    expect(readable(mainOf(await render()))).not.toContain("Ojo: ya tienes cambios");
  });

  // Scenario: the new photo of the edit waiting stays
  it("with an edit waiting that carries a new photo, the photo field says it stays unless another is chosen", async () => {
    const KEPT = "La foto nueva que nos mandaste se queda, a menos que elijas otra.";
    const html = await render({ waiting: true, keptPhoto: true });
    const form = formOf(html);
    const note = /<p\b[^>]*id="registration-photo-kept"[^>]*>([\s\S]*?)<\/p>/.exec(form);
    expect(readable(note?.[1] ?? "")).toBe(KEPT);
    expect(attribute(control(html, "photo"), "aria-describedby")).toBe(
      "registration-photo-help registration-photo-kept",
    );
    // By the field: after it, before "Dejar mi ficha sin foto".
    expect(form.indexOf(KEPT)).toBeGreaterThan(form.indexOf('name="photo"'));
    expect(form.indexOf(KEPT)).toBeLessThan(form.indexOf('name="removePhoto"'));
    // It is not an error: nothing is marked invalid and nothing takes the focus.
    expect(has(control(html, "photo"), "aria-invalid")).toBe(false);
    expect(alerts(html)).toEqual([]);

    // Only in that case: not without such an edit, not with the checkbox
    // checked, and not when the photo field has something else to say.
    expect(readable(formOf(await render({ waiting: true })))).not.toContain(KEPT);
    expect(
      readable(
        formOf(await render({ keptPhoto: true, draft: { ...CARD_DRAFT, removePhoto: true } })),
      ),
    ).not.toContain(KEPT);
    expect(
      readable(formOf(await render({ keptPhoto: true, draft: { ...CARD_DRAFT, photo: true } }))),
    ).not.toContain(KEPT);
    expect(
      readable(formOf(await render({ keptPhoto: true, errors: { photo: "unreadable" } }))),
    ).not.toContain(KEPT);
  });

  it("an edit waiting that removes the photo comes back with the checkbox checked", async () => {
    const html = await render({ waiting: true, draft: { ...CARD_DRAFT, removePhoto: true } });
    expect(has(control(html, "removePhoto"), "checked")).toBe(true);
  });
});

describe("The edit goes through the same validations as the registration and cannot set what is not its to set", () => {
  // Scenarios: invalid WhatsApp in the edit; WhatsApp that already has another card
  it("each error next to its field, with the registration's messages and the edit's own for another card's number", async () => {
    const html = await render({
      draft: { ...CARD_DRAFT, whatsapp: "7719990160", photo: true },
      errors: { whatsapp: "taken", openingHours: "length" },
    });
    expect(alerts(html)).toEqual([
      "Ese número ya está en otra ficha del directorio.",
      "Deja esto en 100 caracteres o menos",
      "Tu foto no se quedó guardada: vuelve a elegirla antes de enviar.",
    ]);
    expect(has(control(html, "whatsapp"), "autofocus")).toBe(true);
    expect(attribute(control(html, "whatsapp"), "value")).toBe("7719990160");
  });

  it("a photo Images could not process gets the edit's own message; the other photo messages are the registration's", async () => {
    expect(alerts(await render({ errors: { photo: "failed" } }))).toEqual([
      "No pudimos procesar tu foto. Intenta con otra o envía tus cambios sin cambiar la foto.",
    ]);
    expect(alerts(await render({ errors: { photo: "too-large" } }))).toEqual([
      "Esa foto pesa más de 5 MB. Sube una más ligera.",
    ]);
  });

  it("over the quota, after a failure or refused by Turnstile, the edit's messages above the form", async () => {
    expect(alerts(await render({ general: "quota" }))).toEqual([
      "Ya recibimos varios cambios desde aquí. Espera un rato y vuelve a intentar.",
    ]);
    expect(alerts(await render({ general: "server" }))).toEqual([
      "No pudimos guardar tus cambios. Vuelve a intentarlo en un momento.",
    ]);
    expect(
      alerts(
        await render({ general: "turnstile", turnstile: { siteKey: "1x00000000000000000000AA" } }),
      )[0],
    ).toBe("No pudimos comprobar que eres una persona. Vuelve a intentarlo.");
  });
});

describe("The registration and edit forms are protected by quotas, honeypot and Turnstile (v2): the edit form", () => {
  const SITE_KEY = "1x00000000000000000000AA";

  it("with the switch on, the widget before the button with the action edit; without JavaScript, the edit's message and a disabled button", async () => {
    const html = await render({ turnstile: { siteKey: SITE_KEY } });
    const form = formOf(html);
    const widget = /<div\b[^>]*data-turnstile-widget[^>]*>/.exec(form)?.[0] ?? "";
    expect(attribute(widget, "data-sitekey")).toBe(SITE_KEY);
    expect(attribute(widget, "data-action")).toBe("edit");
    expect(form.indexOf("data-turnstile-widget")).toBeLessThan(form.indexOf("<button"));
    expect(readable(/<noscript>([\s\S]*?)<\/noscript>/.exec(form)?.[1] ?? "")).toBe(
      "Para editar tu ficha, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona.",
    );
    expect(form.indexOf("<noscript>")).toBeLessThan(form.indexOf('<label for="registration-name"'));
    expect(has(button(html), "disabled")).toBe(true);
  });

  it("with the switch off, no widget, no message about JavaScript, and a button ready to send", async () => {
    const html = await render();
    expect(html).not.toContain("data-turnstile");
    expect(html).not.toContain("<noscript");
    expect(has(button(html), "disabled")).toBe(false);
  });

  it("the trap field is the public forms'", async () => {
    const html = await render();
    expect(formOf(html)).toMatch(
      /<div aria-hidden="true" class="absolute left-\[-9999px\][^"]*">\s*<label for="website">/,
    );
    expect(attribute(control(html, "website"), "tabindex")).toBe("-1");
  });

  it("its scripts are modules of the site, never inline: the form's and the widget's", async () => {
    const scripts = [
      ...(await render({ turnstile: { siteKey: SITE_KEY } })).matchAll(
        /<script\b([^>]*)>([\s\S]*?)<\/script>/g,
      ),
    ];
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

describe("A token that is not exactly the current one opens nothing and gives nothing away: what the pages declare", () => {
  // Scenarios: the edit page is neither indexed nor linked; the token does
  // not leave in the Referer
  it("the edit page asks not to be indexed nor followed, sends no path as referrer, has no canonical and names nothing of the card in its title", async () => {
    Object.assign(env, { SITE_URL: "https://enmirumbo.urekz.workers.dev" });
    const html = await render();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<meta name="referrer" content="strict-origin">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe("Edita tu ficha — enmirumbo");
    // No link of the page leaves the site, and none carries the token.
    const hrefs = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(([, href = ""]) => href);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, href).toMatch(/^\/(?!\/)/);
      expect(href, href).not.toContain("/editar");
    }
    expect(html.split(TOKEN).length - 1).toBe(0);
  });

  // Scenario: the edit route does not travel to any third party
  it.for(["edit", "edit with errors", "thanks"] as const)(
    "in production with a Website ID, the %s page loads no measurement and carries no event",
    async (which) => {
      Object.assign(env, { ENVIRONMENT: "prod", UMAMI_WEBSITE_ID: WEBSITE_ID });
      const html =
        which === "thanks"
          ? await renderThanks()
          : await render(which === "edit" ? {} : { errors: { whatsapp: "invalid" } });
      expect(html).not.toContain("umami");
      expect(html).not.toContain("data-umami");
    },
  );

  // base-layout, "The admin panel and the edit mode stay out of the
  // measurement by where they live (v2)", scenario: the edit mode (its 404)
  it.for(["/hidalgo/tizayuca/editar", "/hidalgo/tizayuca/editar/x", `${PATH}/x`])(
    "in production with a Website ID, the not-found page at %s loads no measurement",
    async (path) => {
      Object.assign(env, { ENVIRONMENT: "prod", UMAMI_WEBSITE_ID: WEBSITE_ID });
      const html = await container.renderToString(NotFoundPage, {
        partial: false,
        request: new Request(`https://enmirumbo.urekz.workers.dev${path}`),
        locals: { locality: TIZAYUCA } as App.Locals,
      });
      expect(readable(mainOf(html))).toContain("No encontramos esta página");
      expect(html).not.toContain("umami");
      // The site's 404 elsewhere is measured, so the exclusion is the edit mode's.
      const elsewhere = await container.renderToString(NotFoundPage, {
        partial: false,
        request: new Request(`https://enmirumbo.urekz.workers.dev/hidalgo/tizayuca/negocio/x`),
        locals: { locality: TIZAYUCA } as App.Locals,
      });
      expect(elsewhere).toContain("https://cloud.umami.is/script.js");
    },
  );

  it("a not-found address under the edit mode declares the same as its pages", async () => {
    const html = await container.renderToString(NotFoundPage, {
      partial: false,
      request: new Request(`https://enmirumbo.urekz.workers.dev/hidalgo/tizayuca/editar/x`),
      locals: { locality: TIZAYUCA } as App.Locals,
    });
    expect(readable(mainOf(html))).toContain("No encontramos esta página");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<meta name="referrer" content="strict-origin">');
    // Outside the edit mode, the site's 404 declares neither.
    const elsewhere = await container.renderToString(NotFoundPage, {
      partial: false,
      request: new Request(`https://enmirumbo.urekz.workers.dev/hidalgo/tizayuca/negocio/x`),
      locals: { locality: TIZAYUCA } as App.Locals,
    });
    expect(elsewhere).not.toContain('name="referrer"');
    expect(elsewhere).not.toContain("nofollow");
  });
});

describe("Sending the edit does not touch the public card: it creates a pending edit: the confirmation", () => {
  // Scenarios: the changes enter review and the card does not move;
  // reloading the confirmation
  it("the literal as its only h1, Volver al inicio to the home of the locality, and nothing to send again", async () => {
    const html = await renderThanks();
    const main = mainOf(html);
    expect(
      [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(([, t = ""]) => readable(t)),
    ).toEqual([
      "¡Gracias! Ya recibimos tus cambios. Los revisamos y en cuanto los aprobemos tu ficha se actualiza. Mientras tanto sigue publicada como está.",
    ]);
    const links = [...main.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
    expect(links.map(([, href, text = ""]) => [href, readable(text)])).toEqual([
      ["/hidalgo/tizayuca", "Volver al inicio"],
    ]);
    expect(main).not.toMatch(/<form\b/);
    expect(html).not.toMatch(/<script\b/);
  });

  it("it asks not to be indexed nor followed, sends no path as referrer, and its title is static", async () => {
    const html = await renderThanks();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<meta name="referrer" content="strict-origin">');
    expect(html).not.toContain('rel="canonical"');
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe("Gracias por tus cambios — enmirumbo");
  });
});
