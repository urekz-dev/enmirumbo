// Scenarios of docs/specs/admin-review.md on the forms and screens of F3,
// rendered with Astro's Container API: "Unpublish a published card, with a
// mandatory reason and conditioned on the status", "On unpublishing, an offer
// is made to notify the business by WhatsApp", "The admin can generate a new
// link, and the previous one stops working", "Permanent deletion is confirmed
// in two steps, by typing a word", "Permanent deletion takes everything and
// leaves no trace of personal data", "The panel says that a change takes up
// to a minute to reach the site (v2)" and "The panel is operated from the
// phone and without unnecessary client JavaScript"; and of
// docs/specs/deployment.md, "Permanent deletion refuses to claim it deleted
// what it did not delete" and "A deleted photo is purged from the cache of
// the media hostname, and a purge that fails is retried every hour (v2)". The
// data comes from the database in test/worker/review-removals.test.ts; end to
// end, through Access, in test/e2e/admin-removals.spec.ts.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import * as TEXTS from "../../src/core/review/texts.ts";
import type { NewLinkNotice } from "../../src/lib/review.ts";
import DecisionScreen from "../../src/components/admin/DecisionScreen.astro";
import DeleteConfirmation from "../../src/components/admin/DeleteConfirmation.astro";
import DeleteControl from "../../src/components/admin/DeleteControl.astro";
import NewLinkConfirmation from "../../src/components/admin/NewLinkConfirmation.astro";
import NewLinkForm from "../../src/components/admin/NewLinkForm.astro";
import UnpublishConfirmation from "../../src/components/admin/UnpublishConfirmation.astro";
import UnpublishForm from "../../src/components/admin/UnpublishForm.astro";
import { collapseProblems } from "../responsive-rules.ts";

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

/** Text as a person reads it: entities decoded. */
function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, "&");
}

/** The text a person reads, one line per block; what is aria-hidden is not read. */
function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<(\w+)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(
        /<\/?(?:p|div|h[1-6]|li|ul|a|span|article|nav|label|section|dl|dt|dd|button|form)\b[^>]*>/gi,
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

const linksNamed = (html: string, text: string) => anchors(html).filter((a) => a.text === text);
const attribute = (tag: string, name: string) =>
  decode(new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? "");
const classesOf = (html: string) =>
  [...html.matchAll(/\bclass="([^"]*)"/g)].map(([, classes = ""]) => classes);
const formTag = (html: string) => html.match(/<form\b[^>]*>/)?.[0] ?? "";

/** Every element a person taps measures at least 44px, and nothing blocks the collapse at 390px. */
function expectPhoneReady(html: string): void {
  for (const a of anchors(html)) expect(a.tag, a.text).toMatch(/\bmin-h-11\b/);
  for (const button of html.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/\bmin-h-11\b/);
  expect(classesOf(html).flatMap(collapseProblems)).toEqual([]);
}

describe("Unpublish a published card, with a mandatory reason and conditioned on the status", () => {
  const render = (reason = "", error: "required" | "too-long" | null = null) =>
    container.renderToString(UnpublishForm, {
      props: { action: "?_action=admin.unpublish", reason, error },
    });

  it("the admin knows where what they write goes: the hint is next to ¿Por qué la despublicas?", async () => {
    const html = await render();
    const text = visibleText(html);

    expect(text).toContain(
      "Despublicar\n¿Por qué la despublicas?\nEste motivo se le enviará al negocio por WhatsApp.",
    );
    expect(attribute(formTag(html), "action")).toBe("?_action=admin.unpublish");
    expect(attribute(formTag(html), "method")).toBe("post");
    expect(formTag(html)).toMatch(/\bnovalidate\b/);
    const [textarea = ""] = html.match(/<textarea\b[^>]*>/) ?? [];
    expect(attribute(textarea, "name")).toBe("motivo");
    expect(attribute(textarea, "aria-describedby")).toBe("unpublish-reason-hint");
    expect(textarea).not.toMatch(/maxlength|required/);
    expect(html).toMatch(/<button\b[^>]*type="submit"[^>]*>\s*Despublicar\s*<\/button>/);
    expect(html).not.toMatch(/<script\b/);
    expectPhoneReady(html);
  });

  it("without a reason, and over 500 characters, the error says so and the reason comes back whole", async () => {
    const empty = await render("", "required");
    expect(visibleText(empty)).toContain("Escribe por qué la despublicas");
    const [field = ""] = empty.match(/<textarea\b[^>]*>/) ?? [];
    expect(attribute(field, "aria-invalid")).toBe("true");
    expect(attribute(field, "aria-describedby")).toBe(
      "unpublish-reason-hint unpublish-reason-error",
    );

    const long = `${"Motivo <b>largo</b> ".repeat(30)}fin`;
    const html = await render(long, "too-long");
    expect(visibleText(html)).toContain(
      "El motivo no puede pasar de 500 caracteres. Recórtalo un poco: así, completo, es como le va a llegar al negocio.",
    );
    expect(decode(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? "")).toBe(long);
    expect(html).not.toContain("<b>largo</b>");
  });

  it("something that was no longer published says so, with the way back to the queue", async () => {
    const html = await container.renderToString(DecisionScreen, {
      props: { heading: TEXTS.NOT_PUBLISHED, queueHref: "/admin" },
    });
    expect(html).toMatch(/<h1\b[^>]*>Esta ficha ya no estaba publicada\.<\/h1>/);
    expect(linksNamed(html, "Volver a la cola").map((a) => a.href)).toEqual(["/admin"]);
  });
});

describe("On unpublishing, an offer is made to notify the business by WhatsApp", () => {
  it("Ya la despublicaste., the minute it takes, and Avisarle por WhatsApp with the reason", async () => {
    const html = await container.renderToString(UnpublishConfirmation, {
      props: {
        name: "Tacos del Güero",
        whatsapp: "7719990404",
        reason: "El negocio cerró",
        queueHref: "/admin",
      },
    });
    const text = visibleText(html);

    expect(html).toMatch(/<h1\b[^>]*>Ya la despublicaste\.<\/h1>/);
    expect(text).toContain("Listo. El cambio puede tardar hasta un minuto en verse en el sitio.");
    const [button] = linksNamed(html, "Avisarle por WhatsApp");
    expect(decodeURIComponent(button?.href ?? "")).toBe(
      "https://wa.me/527719990404?text=Hola, te escribo de enmirumbo. Bajamos del directorio la ficha de «Tacos del Güero»: El negocio cerró. Si quieres que la volvamos a publicar o tienes alguna duda, contéstame por aquí.",
    );
    expect(attribute(button?.tag ?? "", "target")).toBe("_blank");
    expect(attribute(button?.tag ?? "", "rel")).toBe("noopener noreferrer");
    expect(linksNamed(html, "Volver a la cola").map((a) => a.href)).toEqual(["/admin"]);
    expect(html).not.toMatch(/<form\b|<script\b/);
    expectPhoneReady(html);
  });

  it("a number that cannot be interpreted is shown as stored, without a button", async () => {
    const html = await container.renderToString(UnpublishConfirmation, {
      props: { name: "X", whatsapp: "12345", reason: "Y", queueHref: null },
    });
    expect(html).not.toContain("wa.me");
    expect(visibleText(html)).toContain(
      "WhatsApp registrado: 12345 (no se pudo generar el enlace)",
    );
    expect(linksNamed(html, "Volver a la cola")).toEqual([]);
  });
});

const TOKEN = "T".repeat(43);
const LINK_NOTICE: NewLinkNotice = {
  name: "Tacos del Güero",
  whatsapp: "7719990505",
  managementUrl: `https://enmirumbo.example/hidalgo/tizayuca/editar/${TOKEN}`,
};

describe("The admin can generate a new link, and the previous one stops working", () => {
  it("Generar un enlace nuevo: one button posted to the detail, with the version of the link and no token", async () => {
    const version = "2026-10-18T19:00:00.000Z";
    const html = await container.renderToString(NewLinkForm, {
      props: { action: "?_action=admin.newLink", version },
    });
    const text = visibleText(html);

    expect(text).toContain(
      "Enlace de gestión\nEl enlace que tiene ahora el negocio deja de servir en cuanto generes otro.\nGenerar un enlace nuevo",
    );
    expect(attribute(formTag(html), "action")).toBe("?_action=admin.newLink");
    expect(attribute(formTag(html), "method")).toBe("post");
    const [hidden = ""] = html.match(/<input\b[^>]*type="hidden"[^>]*>/) ?? [];
    expect(attribute(hidden, "name")).toBe("enlace");
    expect(attribute(hidden, "value")).toBe(version);
    expect(html).toMatch(
      /<button\b[^>]*type="submit"[^>]*>\s*Generar un enlace nuevo\s*<\/button>/,
    );
    expect(html).not.toMatch(/<script\b|editar\//);
    expectPhoneReady(html);
  });

  it("Listo, el enlace anterior ya no sirve., and Mandarle el enlace por WhatsApp with the spec's message", async () => {
    const html = await container.renderToString(NewLinkConfirmation, {
      props: { notice: LINK_NOTICE, queueHref: "/admin" },
    });
    const text = visibleText(html);

    expect(html).toMatch(/<h1\b[^>]*>Listo, el enlace anterior ya no sirve\.<\/h1>/);
    expect(text).toContain(
      "Mándale el mensaje ahora: este enlace solo se ve aquí.\nMandarle el enlace por WhatsApp",
    );
    const [button] = linksNamed(html, "Mandarle el enlace por WhatsApp");
    const message = `Hola, te mandamos un enlace nuevo para editar tu ficha de «Tacos del Güero» en enmirumbo: ${LINK_NOTICE.managementUrl}. El anterior ya no sirve. Guarda este mensaje (puedes destacarlo con la estrella), con ese enlace actualizas tus datos cuando quieras.`;
    expect(button?.href).toBe(`https://wa.me/527719990505?text=${encodeURIComponent(message)}`);
    expect(attribute(button?.tag ?? "", "rel")).toBe("noopener noreferrer");
    // A new link changes nothing public.
    expect(text).not.toContain("tardar hasta un minuto");
    // The link is in the notice and nowhere else of the screen.
    expect(html.split(TOKEN)).toHaveLength(2);
    expect(html).not.toMatch(/<form\b|<script\b/);
    expect(linksNamed(html, "Volver a la cola").map((a) => a.href)).toEqual(["/admin"]);
    expectPhoneReady(html);
  });

  it("a form sent again after its link was replaced says so, and shows no link", async () => {
    const html = await container.renderToString(DecisionScreen, {
      props: { heading: TEXTS.LINK_ALREADY_REPLACED, queueHref: null },
    });
    expect(visibleText(html)).toBe(
      "Este enlace ya lo habías cambiado. El último que generaste es el que sirve.",
    );
    expect(html).not.toContain("wa.me");
  });
});

describe("Permanent deletion is confirmed in two steps, by typing a word", () => {
  it("Borrar definitivamente is a link to the confirmation, marked as the irreversible action", async () => {
    const html = await container.renderToString(DeleteControl, {
      props: { href: "/admin/registros/b5q68b2e72/borrar" },
    });
    expect(visibleText(html)).toBe("Acción irreversible\nBorrar definitivamente");
    expect(linksNamed(html, "Borrar definitivamente").map((a) => a.href)).toEqual([
      "/admin/registros/b5q68b2e72/borrar",
    ]);
    expect(html).not.toMatch(/<form\b|<button\b/);
    expect(html).toMatch(/\bborder-2\b/);
    expectPhoneReady(html);
  });

  const render = (wrongWord = false) =>
    container.renderToString(DeleteConfirmation, {
      props: {
        name: "Tacos <del> Güero",
        action: "?_action=admin.deleteCard",
        detailHref: "/admin/registros/b5q68b2e72",
        wrongWord,
      },
    });

  it("the confirmation, in its order: heading, warning, reminder, the word, the button and the way back", async () => {
    const html = await render();
    expect(visibleText(html)).toBe(
      [
        "¿Seguro que quieres borrar esta ficha?",
        "Esto borra para siempre el registro de «Tacos <del> Güero», sus giros y sus reportes. No hay papelera y no se puede deshacer.",
        "Antes de borrar: confirma por WhatsApp, desde el número con el que se registró, que quien lo pide es el dueño del negocio. Tienes 20 días hábiles para contestarle.",
        "Escribe BORRAR para confirmar",
        "Sí, borrar para siempre",
        "Mejor no, regresar",
      ].join("\n"),
    );
    expect(html).toMatch(/<h1\b[^>]*>¿Seguro que quieres borrar esta ficha\?<\/h1>/);
    expect(html).not.toContain("<del>");
    expect(attribute(formTag(html), "action")).toBe("?_action=admin.deleteCard");
    expect(attribute(formTag(html), "method")).toBe("post");
    expect(formTag(html)).toMatch(/\bnovalidate\b/);
    const [input = ""] = html.match(/<input\b[^>]*>/) ?? [];
    expect(attribute(input, "name")).toBe("confirmacion");
    expect(attribute(input, "autocomplete")).toBe("off");
    expect(input).not.toMatch(/\bvalue=|\brequired\b|\bpattern=/);
    expect(linksNamed(html, "Mejor no, regresar").map((a) => a.href)).toEqual([
      "/admin/registros/b5q68b2e72",
    ]);
    expect(html).not.toMatch(/<script\b/);
    expectPhoneReady(html);
  });

  it("the word does not match: the field comes back empty, with the error next to it", async () => {
    const html = await render(true);
    expect(visibleText(html)).toContain(
      "Escribe BORRAR para confirmar\nPara borrar, escribe BORRAR en el campo.",
    );
    const [input = ""] = html.match(/<input\b[^>]*>/) ?? [];
    expect(attribute(input, "aria-invalid")).toBe("true");
    expect(attribute(input, "aria-describedby")).toBe("delete-word-error");
    expect(input).not.toMatch(/\bvalue=/);
  });
});

describe("Permanent deletion takes everything and leaves no trace of personal data", () => {
  it("the screens of a deletion say what happened in the spec's words, and carry nothing of the card", async () => {
    expect(TEXTS.DELETED).toBe("Ya se borró para siempre.");
    expect(TEXTS.ALREADY_GONE).toBe("Esta ficha ya no existe.");
    expect(TEXTS.DELETE_STORAGE_UNREACHABLE).toBe(
      "La ficha no se borró: no pude alcanzar el almacén de fotos. Revisa la configuración y vuelve a intentar.",
    );
    for (const heading of [
      TEXTS.DELETED,
      TEXTS.ALREADY_GONE,
      TEXTS.DELETE_STORAGE_UNREACHABLE,
      TEXTS.DELETE_FAILED,
      TEXTS.DELETED_PHOTO_CACHED,
    ]) {
      const html = await container.renderToString(DecisionScreen, {
        props: { heading, queueHref: "/admin" },
      });
      expect(visibleText(html)).toBe(`${heading}\nVolver a la cola`);
      expect(anchors(html).map((a) => a.href)).toEqual(["/admin"]);
    }
  });

  it("when the photo may still be cached, the screen says so instead of claiming more", () => {
    expect(TEXTS.DELETED_PHOTO_CACHED).not.toContain("para siempre");
    expect(TEXTS.DELETED_PHOTO_CACHED_DETAIL).toContain("cada hora");
  });
});
