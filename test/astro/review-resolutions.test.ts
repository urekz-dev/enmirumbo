// Scenarios of docs/specs/admin-review.md on attending reports and resolving
// pending edits, rendered with Astro's Container API: "Marking a report as
// attended, only once", "Applying the pending edit updates the published
// card and only that", "Discarding the pending edit requires a reason, does
// not touch the card and offers to notify by WhatsApp", "The panel says that
// a change takes up to a minute to reach the site (v2)", "The panel is
// operated from the phone and without unnecessary client JavaScript" and
// "Attending a report and resolving a pending edit are forms of their
// details, and their action checks everything again (v2)". The data comes
// from the database in test/worker/review-resolutions.test.ts; end to end,
// through Access, in test/e2e/admin-resolutions.spec.ts.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { ApplyErrors, ApplyForm as ApplyFormData } from "../../src/core/review/apply.ts";
import { comparedFields, type EditDetail as EditData } from "../../src/core/review/edit.ts";
import type { ReasonError } from "../../src/core/review/reason.ts";
import type {
  PendingReport,
  RegistrationDetail as Registration,
} from "../../src/core/review/registration.ts";
import AppliedConfirmation from "../../src/components/admin/AppliedConfirmation.astro";
import ApplyForm from "../../src/components/admin/ApplyForm.astro";
import DiscardedConfirmation from "../../src/components/admin/DiscardedConfirmation.astro";
import DiscardForm from "../../src/components/admin/DiscardForm.astro";
import EditDetail from "../../src/components/admin/EditDetail.astro";
import RegistrationDetail from "../../src/components/admin/RegistrationDetail.astro";
import { collapseProblems } from "../responsive-rules.ts";

const NOW = new Date("2026-09-10T18:00:00Z");
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const ZONE = "America/Mexico_City";

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
        /<\/?(?:p|div|h[1-6]|li|ul|a|span|article|nav|label|section|dl|dt|dd|button|form|option)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function anchors(html: string): { tag: string; href: string; text: string }[] {
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
const forms = (html: string) => html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];

/** Every element a person taps measures at least 44px, and nothing blocks the collapse at 390px. */
function expectPhoneReady(html: string): void {
  for (const a of anchors(html)) expect(a.tag, a.text).toMatch(/\bmin-h-11\b/);
  for (const button of html.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/\bmin-h-11\b/);
  expect(classesOf(html).flatMap(collapseProblems)).toEqual([]);
}

// ------------------------------------------------- the reports of a card

const REGISTRATION: Registration = {
  id: "b5q68b2e72",
  localityCode: "13069",
  localityName: "Tizayuca",
  timeZone: ZONE,
  name: "Reportada de Mentiras",
  categoryName: "Servicios del hogar",
  whatsapp: "7719990101",
  zoneSlug: "huicalco",
  zoneName: "Huicalco",
  zoneOther: null,
  whatYouOffer: null,
  homeDelivery: false,
  landline: null,
  address: null,
  openingHours: null,
  facebookUrl: null,
  photoKey: null,
  status: "published",
  origin: "organic",
  registeredAt: new Date("2026-09-04T05:30:00Z"),
  publishedAt: new Date("2026-09-05T16:00:00Z"),
  rejectedAt: null,
  rejectionReason: null,
  previousRejectedAt: null,
  previousRejectionReason: null,
  unpublishedAt: null,
  unpublishReason: null,
  consentedToNoticeAt: new Date("2026-09-04T05:30:00Z"),
  consentedToNoticeVersion: "1",
  reconsentedToNoticeAt: null,
  reconsentedToNoticeVersion: null,
  managementLinkCreatedAt: null,
};

const REPORTS: PendingReport[] = [
  { id: 7, reason: "closed", comment: null, createdAt: hoursAgo(30) },
  { id: 9, reason: "incorrect_data", comment: "Ya no es su teléfono", createdAt: hoursAgo(2) },
];

function renderDetail(props: {
  reports?: PendingReport[] | null;
  attendAction?: string | null;
  reportNotice?: string | null;
  reportAlert?: boolean;
}) {
  return container.renderToString(RegistrationDetail, {
    props: {
      detail: REGISTRATION,
      zone: "Huicalco",
      reports: props.reports === undefined ? REPORTS : props.reports,
      now: NOW,
      queueHref: "/admin",
      attendAction: props.attendAction ?? null,
      reportNotice: props.reportNotice ?? null,
      reportAlert: props.reportAlert ?? false,
    },
  });
}

describe("Marking a report as attended, only once", () => {
  it("each pending report has its Marcar como atendido, posted to the detail with its report, without JavaScript", async () => {
    const html = await renderDetail({ attendAction: "?_action=admin.attendReport" });
    const attendForms = forms(html);

    expect(attendForms).toHaveLength(2);
    attendForms.forEach((form, index) => {
      const tag = form.match(/<form\b[^>]*>/)?.[0] ?? "";
      expect(attribute(tag, "method")).toBe("post");
      // The answer opens on the notice of the marking, which names nothing.
      expect(attribute(tag, "action")).toBe("?_action=admin.attendReport#report-notice");
      const hidden = form.match(/<input\b[^>]*>/g) ?? [];
      expect(hidden.map((input) => [attribute(input, "type"), attribute(input, "name")])).toEqual([
        ["hidden", "reporte"],
      ]);
      expect(attribute(hidden[0] ?? "", "value")).toBe(String(REPORTS[index]!.id));
      const button = form.match(/<button\b[^>]*>/)?.[0] ?? "";
      expect(attribute(button, "type")).toBe("submit");
      // Which report a button attends is read with it, not only seen.
      expect(attribute(button, "aria-describedby")).toBe(`report-${REPORTS[index]!.id}`);
      expect(visibleText(form)).toBe("Marcar como atendido");
    });
    expect(html).toMatch(/<p\b[^>]*id="report-7"[^>]*>\s*Ya cerró\s*<\/p>/);
    expect(visibleText(html)).toContain(
      "Reportes sin atender\nYa cerró\nHace 30 horas\nMarcar como atendido\nLos datos están mal\nHace 2 horas\nYa no es su teléfono\nMarcar como atendido",
    );
    expect(html).not.toMatch(/<script\b/);
    expectPhoneReady(html);
  });

  it("the notice of a marking is painted by the detail, even when the section went away with the last report", async () => {
    const attended = await renderDetail({ reports: [], reportNotice: "Reporte atendido." });
    const [notice = ""] = attended.match(/<p\b[^>]*id="report-notice"[^>]*>[\s\S]*?<\/p>/) ?? [];
    expect(visibleText(notice)).toBe("Reporte atendido.");
    expect(attribute(notice, "role")).toBe("status");
    expect(visibleText(attended)).not.toContain("Reportes sin atender");

    const again = await renderDetail({
      reports: [],
      reportNotice: "Este reporte ya lo habías atendido.",
    });
    expect(visibleText(again)).toContain("Este reporte ya lo habías atendido.");

    const failed = await renderDetail({
      reportNotice: "No se pudo guardar. Vuelve a intentarlo.",
      reportAlert: true,
    });
    expect(failed).toMatch(/<p\b[^>]*id="report-notice"[^>]*role="alert"/);
  });

  it("before the section and after the internal data; a detail without a marking paints no notice", async () => {
    const html = visibleText(
      await renderDetail({
        attendAction: "?_action=admin.attendReport",
        reportNotice: "Reporte atendido.",
      }),
    );
    expect(html.indexOf("Reporte atendido.")).toBeGreaterThan(html.indexOf("Datos internos"));
    expect(html.indexOf("Reporte atendido.")).toBeLessThan(html.indexOf("Reportes sin atender"));

    const plain = visibleText(await renderDetail({ attendAction: "?_action=admin.attendReport" }));
    expect(plain).not.toMatch(/Reporte atendido|ya lo habías atendido/);
  });
});

// --------------------------------------------- the resolutions of an edit

const ZONES: ApplyFormData["zones"] = [
  { id: 10, slug: "centro", displayName: "Centro", hidden: false },
  { id: 12, slug: "nacozari", displayName: "Nacozari", hidden: true },
];

function renderApply(
  props: {
    form?: Partial<ApplyFormData>;
    zone?: string;
    errors?: ApplyErrors;
    taken?: boolean;
  } = {},
) {
  return container.renderToString(ApplyForm, {
    props: {
      action: "?_action=admin.applyEdit",
      form: { needsZone: false, zoneOther: null, zones: [], ...props.form },
      draft: { zone: props.zone ?? "" },
      errors: props.errors ?? {},
      taken: props.taken ?? false,
    },
  });
}

describe("Applying the pending edit updates the published card and only that", () => {
  it("the form: Aplicar los cambios, posted to the detail without JavaScript, nothing to choose for a catalogue zone", async () => {
    const html = await renderApply();
    const [form = ""] = html.match(/<form\b[^>]*>/) ?? [];

    expect(attribute(form, "method")).toBe("post");
    expect(attribute(form, "action")).toBe("?_action=admin.applyEdit");
    expect(form).toMatch(/\bnovalidate\b/);
    expect(visibleText(html)).toBe("Aplicar los cambios\nAplicar los cambios");
    expect(html).toMatch(/<button\b[^>]*type="submit"[^>]*>\s*Aplicar los cambios\s*<\/button>/);
    expect(html).not.toMatch(/<select\b|<script\b|\brequired\b/);
    expectPhoneReady(html);
  });

  it('"Otra": the text as the owner wrote it, and every zone of the locality, a hidden one marked', async () => {
    const html = await renderApply({
      form: { needsZone: true, zoneOther: "Rinconada del Venado", zones: ZONES },
    });
    const text = visibleText(html);

    expect(text).toContain('El negocio escribió su colonia como "Otra": Rinconada del Venado');
    expect(text).toContain("¿En qué colonia está?");
    const options = [...html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(
      ([, attributes = "", label = ""]) => [attribute(attributes, "value"), label.trim()],
    );
    expect(options).toEqual([
      ["", "Elige la colonia"],
      ["centro", "Centro"],
      ["nacozari", "Nacozari (oculta)"],
    ]);
    expect(attribute(html.match(/<select\b[^>]*>/)?.[0] ?? "", "name")).toBe("colonia");
    expectPhoneReady(html);
  });

  it("a failed apply comes back with the zone chosen and the error next to it, or the number another card has", async () => {
    const html = await renderApply({
      form: { needsZone: true, zoneOther: "Por allá", zones: ZONES },
      zone: "nacozari",
      errors: { zone: "required" },
    });
    expect(visibleText(html)).toContain("Elige la colonia de este negocio");
    expect(html).toMatch(/<option\b[^>]*value="nacozari"[^>]*selected/);
    const select = html.match(/<select\b[^>]*>/)?.[0] ?? "";
    expect(attribute(select, "aria-invalid")).toBe("true");
    expect(attribute(select, "aria-describedby")).toBe("apply-zone-error");

    const taken = await renderApply({ taken: true });
    expect(visibleText(taken)).toContain(
      "Ese número ya está en otra ficha: no se pudieron aplicar los cambios.\nAplicar los cambios",
    );
    expect(taken).toMatch(/role="alert"/);
  });

  it("Listo, la ficha ya se actualizó., the minute it takes, and Avisarle por WhatsApp with the card's link", async () => {
    const cardUrl = "https://enmirumbo.example/hidalgo/tizayuca/negocio/estetica-lupita-b5q68b2e72";
    const html = await container.renderToString(AppliedConfirmation, {
      props: { name: "Estética Lupita", whatsapp: "7719990202", cardUrl, queueHref: "/admin" },
    });

    expect(html).toMatch(/<h1\b[^>]*>Listo, la ficha ya se actualizó\.<\/h1>/);
    expect(visibleText(html)).toContain(
      "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.",
    );
    const [button] = linksNamed(html, "Avisarle por WhatsApp");
    const message = `¡Listo! Ya actualizamos la ficha de «Estética Lupita» en enmirumbo. Así quedó: ${cardUrl}`;
    expect(button?.href).toBe(`https://wa.me/527719990202?text=${encodeURIComponent(message)}`);
    expect(attribute(button?.tag ?? "", "rel")).toBe("noopener noreferrer");
    expect(linksNamed(html, "Volver a la cola").map((a) => a.href)).toEqual(["/admin"]);
    expect(html).not.toMatch(/<form\b|<script\b|\/editar\//);
    expectPhoneReady(html);

    const offline = await container.renderToString(AppliedConfirmation, {
      props: {
        name: "Estética Lupita",
        whatsapp: "7719990202",
        cardUrl: null,
        queueHref: "/admin",
      },
    });
    expect(offline).not.toContain("wa.me");
    expect(visibleText(offline)).toContain("falta configurar la dirección pública del sitio");
  });
});

function renderDiscard(reason = "", error: ReasonError | null = null) {
  return container.renderToString(DiscardForm, {
    props: { action: "?_action=admin.discardEdit", reason, error },
  });
}

describe("Discarding the pending edit requires a reason, does not touch the card and offers to notify by WhatsApp", () => {
  it("the form: ¿Por qué no aplicas los cambios? and Descartar los cambios, posted to the detail, with no maxlength", async () => {
    const html = await renderDiscard();
    const [form = ""] = html.match(/<form\b[^>]*>/) ?? [];

    expect(visibleText(html)).toBe(
      "Descartar los cambios\n¿Por qué no aplicas los cambios?\nDescartar los cambios",
    );
    expect(attribute(form, "action")).toBe("?_action=admin.discardEdit");
    expect(form).toMatch(/\bnovalidate\b/);
    const [textarea = ""] = html.match(/<textarea\b[^>]*>/) ?? [];
    expect(attribute(textarea, "name")).toBe("motivo");
    expect(textarea).not.toMatch(/maxlength|required/);
    expectPhoneReady(html);
  });

  it("without a reason, and over 500 characters, the error says so and the reason comes back whole", async () => {
    expect(visibleText(await renderDiscard("", "required"))).toContain(
      "Escribe por qué descartas los cambios",
    );

    const long = `${"Motivo <b>largo</b> ".repeat(30)}fin`;
    const html = await renderDiscard(long, "too-long");
    expect(visibleText(html)).toContain(
      "El motivo no puede pasar de 500 caracteres. Recórtalo un poco: así, completo, es como le va a llegar al negocio.",
    );
    expect(decode(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? "")).toBe(long);
    expect(html).not.toContain("<b>largo</b>");
  });

  it("Cambios descartados. and Avisarle por WhatsApp with the reason, without the minute's notice", async () => {
    const html = await container.renderToString(DiscardedConfirmation, {
      props: {
        name: "Préstamos Rápidos",
        whatsapp: "7719990303",
        reason: "No publicamos préstamos informales",
        queueHref: "/admin",
      },
    });

    expect(html).toMatch(/<h1\b[^>]*>Cambios descartados\.<\/h1>/);
    const [button] = linksNamed(html, "Avisarle por WhatsApp");
    expect(decodeURIComponent(button?.href ?? "")).toBe(
      "https://wa.me/527719990303?text=Hola, revisamos los cambios que mandaste para «Préstamos Rápidos» en enmirumbo y por ahora no los pudimos aplicar: No publicamos préstamos informales. Tu ficha sigue publicada como estaba y puedes mandarlos otra vez con tu mismo enlace.",
    );
    expect(visibleText(html)).not.toContain("tardar hasta un minuto");
    expectPhoneReady(html);
  });
});

// --------------------------------------------- where the forms go

const EDIT: EditData = {
  id: 42,
  businessId: "b5q68b2e72",
  localityCode: "13069",
  localityName: "Tizayuca",
  timeZone: ZONE,
  status: "pending",
  createdAt: hoursAgo(5),
  published: {
    name: "Tacos del Güero de Mentiras",
    categoryName: "Comida",
    whatsapp: "7719990101",
    zoneSlug: "huicalco",
    zoneName: "Huicalco",
    zoneOther: null,
    whatYouOffer: "Tacos",
    homeDelivery: false,
    landline: null,
    address: "Calle Uno",
    openingHours: "De 9 a 5",
    facebookUrl: null,
  },
  proposed: {
    name: "Tacos del Güero de Mentiras",
    categoryName: "Comida",
    whatsapp: "7719990199",
    zoneSlug: "huicalco",
    zoneName: "Huicalco",
    zoneOther: null,
    whatYouOffer: "Tacos",
    homeDelivery: false,
    landline: null,
    address: "Calle Dos",
    openingHours: "De 10 a 6",
    facebookUrl: null,
  },
  publishedPhotoKey: null,
  photoChange: "keep",
  newPhotoKey: null,
};

describe("Attending a report and resolving a pending edit are forms of their details, and their action checks everything again (v2)", () => {
  it("the resolutions of an edit go after the comparison and the warning of a new WhatsApp", async () => {
    const html = await container.renderToString(EditDetail, {
      props: { detail: EDIT, fields: comparedFields(EDIT, undefined), queueHref: "/admin" },
      slots: { default: '<form data-testid="apply-form"></form>' },
    });
    const at = (needle: string) => html.indexOf(needle);

    expect(at('data-testid="apply-form"')).toBeGreaterThan(at('data-field="photo"'));
    expect(at('data-testid="apply-form"')).toBeGreaterThan(at("Ojo: está cambiando su WhatsApp"));
  });
});
