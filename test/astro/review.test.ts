// Scenarios of docs/specs/admin-review.md on the review screens of the panel,
// rendered with Astro's Container API: "Review queue with the pending
// registrations, oldest first", "Visible indicator for registrations waiting
// more than 48 hours", "The queue tells which businesses have unattended
// reports", "'Todos los negocios' view with the status in sight and an entry
// to the detail", "The listing is filtered by status without leaving the
// view", "The listing is cut into pages and does not degrade when there are
// many records", "The queue has a visible entry to the listing, and the
// listing returns to the queue", "The listing inherits the panel's access,
// no-indexing and minimal data exposure", "The listing searches by name or
// WhatsApp (v2)", "Registration detail with all the captured data, only
// inside the panel", "Verification button that opens WhatsApp with a
// prefilled message", "The business detail lists its unattended reports",
// "The pending edit detail compares what is published with what is
// proposed", "The panel is operated from the phone and without unnecessary
// client JavaScript", "The panel filters by locality, and the filter is
// hidden while there is one (v2)", "Dates in the panel use the time zone of
// the locality (v2)", "The panel shows the photos it reviews from the media
// hostname (v2)" and "The detail of a pending edit shows the photo it
// proposes (v2)"; and of docs/specs/base-layout.md, the panel's no-indexing
// and referrer policy by where it lives. The data comes from the database in
// test/worker/review.test.ts; end to end, through Access, in
// test/e2e/admin.spec.ts.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { ListPage, ListRow } from "../../src/core/review/businesses.ts";
import { comparedFields, type EditDetail as EditData } from "../../src/core/review/edit.ts";
import type { BusinessesView } from "../../src/core/review/paths.ts";
import type { QueueRow, ReportedBusiness } from "../../src/core/review/queue.ts";
import type {
  PendingReport,
  RegistrationDetail as Registration,
} from "../../src/core/review/registration.ts";
import type {
  ApprovalCatalogue,
  ApprovalDraft,
  ApprovalErrors,
} from "../../src/core/review/approval.ts";
import type { ReasonError } from "../../src/core/review/reason.ts";
import type { ApprovalNotice } from "../../src/lib/review.ts";
import ApprovalConfirmation from "../../src/components/admin/ApprovalConfirmation.astro";
import ApproveForm from "../../src/components/admin/ApproveForm.astro";
import BusinessesList from "../../src/components/admin/BusinessesList.astro";
import DecisionScreen from "../../src/components/admin/DecisionScreen.astro";
import EditDetail from "../../src/components/admin/EditDetail.astro";
import RegistrationDetail from "../../src/components/admin/RegistrationDetail.astro";
import RejectForm from "../../src/components/admin/RejectForm.astro";
import RejectionConfirmation from "../../src/components/admin/RejectionConfirmation.astro";
import ReviewQueue from "../../src/components/admin/ReviewQueue.astro";
import BaseLayout from "../../src/layouts/BaseLayout.astro";
import { collapseProblems } from "../responsive-rules.ts";

const NOW = new Date("2026-09-10T18:00:00Z");
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const ZONE = "America/Mexico_City";
const PHOTO = "abcdefghjkmnpqrstuvwxyz2";
const NEW_PHOTO = "23456789abcdefghjkmnpqrs";

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
const images = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];

/** Every element a person taps measures at least 44px, and nothing blocks the collapse at 390px. */
function expectPhoneReady(html: string): void {
  for (const a of anchors(html)) expect(a.tag, a.text).toMatch(/\bmin-h-11\b/);
  for (const button of html.match(/<button\b[^>]*>/g) ?? []) expect(button).toMatch(/\bmin-h-11\b/);
  expect(classesOf(html).flatMap(collapseProblems)).toEqual([]);
}

// ---------------------------------------------------------------- the queue

const row = (overrides: Partial<QueueRow>): QueueRow => ({
  kind: "registration",
  businessId: "b5q68b2e72",
  editId: null,
  localityCode: "13069",
  timeZone: ZONE,
  name: "Plomería de Mentiras",
  zoneSlug: "huicalco",
  zoneName: "Huicalco",
  since: hoursAgo(3),
  overdue: false,
  unpublished: false,
  resubmitted: false,
  ...overrides,
});

interface QueueProps {
  rows?: QueueRow[];
  reported?: ReportedBusiness[];
  localityFilter?: { text: string; href: string; current: boolean }[];
  localityNames?: Map<string, string> | null;
  listHref?: string | null;
}

function renderQueue(props: QueueProps = {}) {
  return container.renderToString(ReviewQueue, {
    props: {
      rows: [],
      reported: [],
      now: NOW,
      localityFilter: [],
      localityFilterLabel: "Filtrar por municipio",
      localityNames: null,
      listHref: "/admin/negocios",
      ...props,
    },
  });
}

describe("Review queue with the pending registrations, oldest first", () => {
  it("rows in the order given, each labelled in words, with its name, zone, wait and Revisar to its detail", async () => {
    const html = await renderQueue({
      rows: [
        row({ businessId: "aaaaaaaaaa", name: "Alta Vieja", since: hoursAgo(72), overdue: true }),
        row({
          kind: "edit",
          businessId: "bbbbbbbbbb",
          editId: 42,
          name: "Cambios de Tacos",
          zoneSlug: null,
          zoneName: "Rinconada del Venado",
          since: hoursAgo(26),
        }),
        row({ businessId: "cccccccccc", name: "Alta Nueva", since: hoursAgo(0.5) }),
      ],
    });
    const text = visibleText(html);

    expect(text).toContain("Registros por revisar");
    expect(html).toMatch(/<h1\b[^>]*>Registros por revisar<\/h1>/);
    const order = ["Alta Vieja", "Cambios de Tacos", "Alta Nueva"].map((name) =>
      text.indexOf(name),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain("Alta Vieja\nHuicalco\nHace 3 días\nAlta nueva\nLleva más de 48 horas");
    expect(text).toContain("Cambios de Tacos\nRinconada del Venado\nHace 26 horas\nEdición");
    expect(text).toContain("Alta Nueva\nHuicalco\nHace menos de una hora\nAlta nueva");
    expect(
      linksNamed(html, "Revisar").map((a) => [a.href, attribute(a.tag, "aria-label")]),
    ).toEqual([
      ["/admin/registros/aaaaaaaaaa", "Revisar: Alta Vieja"],
      ["/admin/ediciones/42", "Revisar: Cambios de Tacos"],
      ["/admin/registros/cccccccccc", "Revisar: Alta Nueva"],
    ]);
  });

  it("an empty queue says so instead of an empty list", async () => {
    const text = visibleText(await renderQueue());

    expect(text).toContain("No hay registros esperando. Todo al día.");
    expect(text).not.toContain("Negocios reportados");
    expect(text).not.toMatch(/reporte|48 horas/);
  });

  it("a card back from an unpublishing carries its label", async () => {
    const text = visibleText(await renderQueue({ rows: [row({ unpublished: true })] }));

    expect(text).toContain("Alta nueva\nYa estaba publicada, la despublicaste");
  });

  it("the queue has its entry to the list, and none for a user who cannot open it", async () => {
    const html = await renderQueue();
    expect(linksNamed(html, "Ver todos los negocios").map((a) => a.href)).toEqual([
      "/admin/negocios",
    ]);
    expect(linksNamed(await renderQueue({ listHref: null }), "Ver todos los negocios")).toEqual([]);
  });

  it("offers nothing but links: no form or button, and every link measures 44px", async () => {
    const html = await renderQueue({
      rows: [row({}), row({ kind: "edit", editId: 7, overdue: true })],
      reported: [
        { businessId: "dddddddddd", localityCode: "13069", name: "Reportado", pending: 2 },
      ],
    });

    expect(html).not.toMatch(/<form\b|<button\b|<script\b/);
    expectPhoneReady(html);
  });
});

describe("Visible indicator for registrations waiting more than 48 hours", () => {
  it("each overdue row says it in words, and the queue counts them", async () => {
    const html = await renderQueue({
      rows: [
        row({ overdue: true, since: hoursAgo(50) }),
        row({ kind: "edit", editId: 3, overdue: true, since: hoursAgo(49) }),
        row({ since: hoursAgo(3) }),
      ],
    });
    const text = visibleText(html);

    expect(text).toContain("2 registros llevan más de 48 horas esperando.");
    expect(text.match(/Lleva más de 48 horas/g)).toHaveLength(2);
    // The clock is decorative; the text says it.
    expect(html).toMatch(/<span aria-hidden="true">⏰<\/span>/);
  });

  it("one overdue row, in the singular, and none without overdue rows", async () => {
    expect(visibleText(await renderQueue({ rows: [row({ overdue: true })] }))).toContain(
      "1 registro lleva más de 48 horas esperando.",
    );
    expect(visibleText(await renderQueue({ rows: [row({})] }))).not.toContain("48 horas");
  });
});

describe("The queue tells which businesses have unattended reports", () => {
  it("below the queue, its own section with the count, each card's reports and Ver reportes", async () => {
    const html = await renderQueue({
      rows: [row({ name: "En Revisión" })],
      reported: [
        { businessId: "eeeeeeeeee", localityCode: "13069", name: "Tres Reportes", pending: 3 },
        { businessId: "ffffffffff", localityCode: "13069", name: "Un Reporte", pending: 1 },
      ],
    });
    const text = visibleText(html);

    expect(text.indexOf("Negocios reportados")).toBeGreaterThan(text.indexOf("En Revisión"));
    expect(text).toContain(
      "Negocios reportados\n2 negocios tienen reportes sin atender.\nTres Reportes\n3 reportes sin atender\nVer reportes\nUn Reporte\n1 reporte sin atender\nVer reportes",
    );
    expect(linksNamed(html, "Ver reportes").map((a) => a.href)).toEqual([
      "/admin/registros/eeeeeeeeee",
      "/admin/registros/ffffffffff",
    ]);
  });

  it("one reported card, in the singular; with none the empty queue keeps its text alone", async () => {
    const text = visibleText(
      await renderQueue({
        reported: [{ businessId: "eeeeeeeeee", localityCode: "13069", name: "Solo", pending: 1 }],
      }),
    );

    expect(text).toContain("No hay registros esperando. Todo al día.");
    expect(text).toContain("1 negocio tiene reportes sin atender.");
  });
});

describe("The panel filters by locality, and the filter is hidden while there is one (v2)", () => {
  it("one locality: no filter and no locality on the rows", async () => {
    const text = visibleText(await renderQueue({ rows: [row({})] }));

    expect(text).not.toContain("Filtrar por municipio");
    expect(text).not.toContain("Hidalgo");
  });

  it("two localities: the filter's links, the chosen one marked, and each row says its locality", async () => {
    const html = await renderQueue({
      rows: [row({})],
      localityFilter: [
        { text: "Todos", href: "/admin", current: true },
        { text: "Pueblo Uno, Estado de prueba 92", href: "/admin?localidad=92001", current: false },
        { text: "Tizayuca, Hidalgo", href: "/admin?localidad=13069", current: false },
      ],
      localityNames: new Map([["13069", "Tizayuca, Hidalgo"]]),
    });
    const filter = anchors(html).filter((a) => a.text === "Todos" || a.text.includes(","));

    expect(visibleText(html)).toContain("Filtrar por municipio");
    expect(filter.map((a) => [a.text, a.href, attribute(a.tag, "aria-current")])).toEqual([
      ["Todos", "/admin", "true"],
      ["Pueblo Uno, Estado de prueba 92", "/admin?localidad=92001", ""],
      ["Tizayuca, Hidalgo", "/admin?localidad=13069", ""],
    ]);
    expect(visibleText(html)).toContain("Huicalco\nTizayuca, Hidalgo\nHace 3 horas");
    expectPhoneReady(html);
  });
});

// ----------------------------------------------------------------- the list

const listRow = (overrides: Partial<ListRow>): ListRow => ({
  id: "b5q68b2e72",
  localityCode: "13069",
  timeZone: ZONE,
  name: "Plomería de Mentiras",
  zoneSlug: "huicalco",
  zoneName: "Huicalco",
  // 23:30 of 3 September in Tizayuca, already the 4th in UTC.
  registeredAt: new Date("2026-09-04T05:30:00Z"),
  status: "published",
  unpublished: false,
  ...overrides,
});

const VIEW: BusinessesView = { status: "all", locality: null, query: "", page: 1 };

function renderList(
  list: Partial<ListPage> = {},
  view: Partial<BusinessesView> = {},
  queueHref: string | null = "/admin",
) {
  return container.renderToString(BusinessesList, {
    props: {
      list: { rows: [], total: 0, pages: 1, beyond: false, ...list },
      view: { ...VIEW, ...view },
      localityFilter: [],
      localityFilterLabel: "Filtrar por municipio",
      localityNames: null,
      queueHref,
    },
  });
}

describe("'Todos los negocios' view with the status in sight and an entry to the detail", () => {
  it("each row: name, zone, its registration date in its locality, its status in words and Ver detalle", async () => {
    const html = await renderList({
      rows: [
        listRow({ id: "aaaaaaaaaa", name: "Recién Llegada", status: "in_review" }),
        listRow({ id: "bbbbbbbbbb", name: "Publicada" }),
        listRow({ id: "cccccccccc", name: "Rechazada", status: "rejected" }),
        listRow({ id: "dddddddddd", name: "Despublicada", status: "in_review", unpublished: true }),
      ],
      total: 4,
    });
    const text = visibleText(html);

    expect(html).toMatch(/<h1\b[^>]*>Todos los negocios<\/h1>/);
    expect(text).toContain("4 negocios en esta lista");
    expect(text).toContain(
      "Recién Llegada\nHuicalco\nSe registró el 3 de septiembre de 2026\nEn revisión",
    );
    expect(text).toContain(
      "Publicada\nHuicalco\nSe registró el 3 de septiembre de 2026\nPublicado",
    );
    expect(text).toContain(
      "Rechazada\nHuicalco\nSe registró el 3 de septiembre de 2026\nRechazado",
    );
    expect(text).toContain(
      "Despublicada\nHuicalco\nSe registró el 3 de septiembre de 2026\nEn revisión\nYa estaba publicada, la despublicaste",
    );
    expect(linksNamed(html, "Ver detalle").map((a) => a.href)).toEqual([
      "/admin/registros/aaaaaaaaaa",
      "/admin/registros/bbbbbbbbbb",
      "/admin/registros/cccccccccc",
      "/admin/registros/dddddddddd",
    ]);
  });

  it("an empty database says so, with no rows", async () => {
    const text = visibleText(await renderList());

    expect(text).toContain("0 negocios en esta lista");
    expect(text).toContain("Todavía no hay negocios registrados.");
  });

  it("the count says how many there are, in the singular for one", async () => {
    expect(visibleText(await renderList({ total: 34, rows: [listRow({})], pages: 2 }))).toContain(
      "34 negocios en esta lista",
    );
    expect(visibleText(await renderList({ total: 1, rows: [listRow({})] }))).toContain(
      "1 negocio en esta lista",
    );
  });

  it("offers no action: only the search, the filters, the pages and the details", async () => {
    const html = await renderList({ rows: [listRow({})], total: 30, pages: 2 });

    expect(html.match(/<form\b[^>]*>/g)).toEqual([expect.stringMatching(/method="get"/)]);
    expect(html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.map(visibleText)).toEqual(["Buscar"]);
    expect(visibleText(html)).not.toMatch(
      /Aprobar|Rechazar|Despublicar|Borrar|Marcar como atendido/,
    );
    expect(html).not.toMatch(/<script\b/);
    expectPhoneReady(html);
  });

  it("the list goes back to the queue, and not for a user who cannot open it", async () => {
    expect(linksNamed(await renderList(), "Volver a la cola").map((a) => a.href)).toEqual([
      "/admin",
    ]);
    expect(linksNamed(await renderList({}, {}, null), "Volver a la cola")).toEqual([]);
  });
});

describe("The listing is filtered by status without leaving the view", () => {
  it("the four options are links of the query, the chosen one marked, each back to the first page", async () => {
    const html = await renderList(
      { rows: [listRow({})], total: 60, pages: 3 },
      { status: "published", page: 2 },
    );
    const options = ["Todos", "En revisión", "Publicados", "Rechazados"].map(
      (text) => linksNamed(html, text)[0]!,
    );

    expect(visibleText(html)).toContain("Filtrar por estado");
    expect(options.map((a) => [a.text, a.href, attribute(a.tag, "aria-current")])).toEqual([
      ["Todos", "/admin/negocios", ""],
      ["En revisión", "/admin/negocios?estado=en-revision", ""],
      ["Publicados", "/admin/negocios?estado=publicados", "true"],
      ["Rechazados", "/admin/negocios?estado=rechazados", ""],
    ]);
    // Marked in words for screen readers and drawn thicker and in bold, not only coloured.
    expect(options[2]!.tag).toMatch(/\bborder-2\b/);
    expect(options[2]!.tag).toMatch(/\bfont-bold\b/);
  });

  it("a filter without results says so and keeps the other filters in sight", async () => {
    const html = await renderList({}, { status: "rejected" });

    expect(visibleText(html)).toContain("No hay negocios con ese estado.");
    expect(visibleText(html)).not.toContain("Todavía no hay negocios registrados.");
    expect(linksNamed(html, "Todos")).toHaveLength(1);
    expect(linksNamed(html, "Publicados")).toHaveLength(1);
  });

  it("the addresses of the screen carry only the filters, the search and the page, never a card's data", async () => {
    const html = await renderList(
      { rows: [listRow({ name: "Tacos del Güero" })], total: 60, pages: 3 },
      { page: 2 },
    );

    for (const a of anchors(html).filter((link) => link.href.startsWith("/admin/negocios"))) {
      expect(new URL(a.href, "https://x.test").searchParams.toString()).toMatch(
        /^(?:(?:estado|pagina|localidad|q)=[^&]*&?)*$/,
      );
      expect(a.href).not.toMatch(/Tacos|b5q68b2e72/);
    }
  });
});

describe("The listing is cut into pages and does not degrade when there are many records", () => {
  const pageLinks = (html: string) =>
    anchors(html)
      .filter((a) => a.text === "Ver más antiguos" || a.text === "Ver más nuevos")
      .map((a) => [a.text, a.href]);

  it("the first of three pages: which page it is and only the link to the older ones", async () => {
    const html = await renderList({ rows: [listRow({})], total: 60, pages: 3 });

    expect(visibleText(html)).toContain("Página 1 de 3");
    expect(pageLinks(html)).toEqual([["Ver más antiguos", "/admin/negocios?pagina=2"]]);
  });

  it("moving between pages keeps the filter, and the last page has no older link", async () => {
    const middle = await renderList(
      { rows: [listRow({})], total: 60, pages: 3 },
      { status: "published", page: 2 },
    );
    const last = await renderList(
      { rows: [listRow({})], total: 60, pages: 3 },
      { status: "published", page: 3 },
    );

    expect(visibleText(middle)).toContain("Página 2 de 3");
    expect(pageLinks(middle)).toEqual([
      ["Ver más nuevos", "/admin/negocios?estado=publicados"],
      ["Ver más antiguos", "/admin/negocios?estado=publicados&pagina=3"],
    ]);
    expect(pageLinks(last)).toEqual([
      ["Ver más nuevos", "/admin/negocios?estado=publicados&pagina=2"],
    ]);
  });

  it("a single page shows no pagination control", async () => {
    const html = await renderList({ rows: [listRow({})], total: 10, pages: 1 });

    expect(visibleText(html)).not.toMatch(/Página|Ver más/);
  });

  it("a page past the last: no rows, no empty-list text, and the way back to the last page", async () => {
    const html = await renderList({ total: 60, pages: 3, beyond: true }, { page: 99 });
    const text = visibleText(html);

    expect(text).toContain("60 negocios en esta lista");
    expect(text).not.toMatch(/Todavía no hay|No hay negocios|Página|Ver más antiguos/);
    expect(pageLinks(html)).toEqual([["Ver más nuevos", "/admin/negocios?pagina=3"]]);
  });

  it("the HTML of a page holds its rows only, so it does not grow with the database", async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      listRow({ id: `id${String(i).padStart(8, "a")}` }),
    );
    const few = await renderList({ rows, total: 30, pages: 2 });
    const many = await renderList({ rows, total: 500, pages: 20 });

    expect(Math.abs(few.length - many.length)).toBeLessThan(20);
    expect(linksNamed(many, "Ver detalle")).toHaveLength(25);
  });
});

describe("The listing searches by name or WhatsApp (v2)", () => {
  it("a GET form to the list that keeps the filters, with what was searched back in its box", async () => {
    const html = await renderList(
      { rows: [listRow({})], total: 1 },
      { status: "published", locality: "13069", query: "tacos" },
    );
    const form = /<form\b[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";

    expect(form).toMatch(/method="get"/);
    expect(attribute(/<form\b[^>]*>/.exec(form)?.[0] ?? "", "action")).toBe("/admin/negocios");
    expect(visibleText(form)).toContain("Buscar por nombre o WhatsApp");
    const inputs = form.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs.map((input) => [attribute(input, "name"), attribute(input, "value")])).toEqual([
      ["localidad", "13069"],
      ["estado", "publicados"],
      ["q", "tacos"],
    ]);
    expect(linksNamed(html, "Quitar la búsqueda").map((a) => a.href)).toEqual([
      "/admin/negocios?localidad=13069&estado=publicados",
    ]);
    // The filters keep the search.
    expect(linksNamed(html, "Rechazados")[0]?.href).toBe(
      "/admin/negocios?localidad=13069&estado=rechazados&q=tacos",
    );
  });

  it("a search that finds nothing says so", async () => {
    const text = visibleText(await renderList({}, { query: "veterinario espacial" }));

    expect(text).toContain("No encontramos negocios con esa búsqueda.");
    expect(text).not.toMatch(/Todavía no hay|No hay negocios con ese estado/);
  });
});

describe("The listing inherits the panel's access, no-indexing and minimal data exposure", () => {
  it("a row shows name, zone, registration date and status, and nothing else of the card", async () => {
    const html = await renderList({ rows: [listRow({})], total: 1 });

    expect(html).not.toMatch(/wa\.me|tel:|<img\b|771999/);
    expect(visibleText(html)).not.toMatch(/WhatsApp registrado|Motivo|Consentimiento/);
  });
});

// ------------------------------------------------------- the detail of a card

const REGISTRATION: Registration = {
  id: "b5q68b2e72",
  localityCode: "13069",
  localityName: "Tizayuca",
  timeZone: ZONE,
  name: "Plomería Completa de Mentiras",
  categoryName: "Servicios del hogar",
  whatsapp: "7719990101",
  zoneSlug: "huicalco",
  zoneName: "Huicalco",
  zoneOther: null,
  postalCode: "43808",
  whatYouOffer: "Destapes y <b>fugas</b>",
  homeDelivery: true,
  landline: "7719990151",
  address: "Junto a la primaria",
  openingHours: "Lunes a sábado de 9 a 6",
  facebookUrl: "https://facebook.com/plomeria-de-mentiras",
  photoKey: PHOTO,
  status: "published",
  origin: "seeded",
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
  managementLinkCreatedAt: new Date("2026-09-05T16:00:00Z"),
};

function renderRegistration(
  detail: Partial<Registration> = {},
  reports: PendingReport[] | null = [],
  zone: string | null = "Huicalco",
) {
  return container.renderToString(RegistrationDetail, {
    props: { detail: { ...REGISTRATION, ...detail }, zone, reports, now: NOW, queueHref: "/admin" },
  });
}

describe("Registration detail with all the captured data, only inside the panel", () => {
  it("everything captured, the photo to judge it, and the internal data in the locality's time zone", async () => {
    const html = await renderRegistration();
    const text = visibleText(html);

    expect(html).toMatch(/<h1\b[^>]*>Plomería Completa de Mentiras<\/h1>/);
    for (const line of [
      "Servicios del hogar",
      "Foto del negocio",
      "WhatsApp\n7719990101",
      "Código postal\n43808",
      "Colonia\nHuicalco",
      "¿Qué ofreces?\nDestapes y <b>fugas</b>",
      "¿Hace entregas o va a domicilio?\nSí",
      "Teléfono fijo\n7719990151",
      "Dirección o referencias\nJunto a la primaria",
      "Horario\nLunes a sábado de 9 a 6",
      "Página que registró\nhttps://facebook.com/plomeria-de-mentiras",
      "Datos internos del panel",
      "Estado\nPublicado",
      "Origen\nLo sembramos nosotros",
      "Fecha de registro\n3 de septiembre de 2026, 23:30",
      "Consentimiento del aviso de privacidad\n3 de septiembre de 2026 (versión 1)",
      "Fecha de publicación\n5 de septiembre de 2026, 10:00",
      "Tiene enlace de gestión, generado el 5 de septiembre de 2026, 10:00.",
    ]) {
      expect(text, line).toContain(line);
    }
    // What the business wrote is text: no tag of it is interpreted.
    expect(html).toContain("Destapes y &lt;b&gt;fugas&lt;/b&gt;");
    expect(images(html)).toHaveLength(1);
    const [photo = ""] = images(html);
    expect(attribute(photo, "src")).toBe(`/_media/photos/${PHOTO}/full.webp`);
    expect([attribute(photo, "width"), attribute(photo, "height")]).toEqual(["1200", "900"]);
    expect(attribute(photo, "alt")).toBe("Foto de Plomería Completa de Mentiras");
    expect(text).not.toMatch(/Cuándo la despublicaste|Por qué la despublicaste|El reenvío/);
  });

  it("only the required fields: the optional ones read as not captured, and Sin foto", async () => {
    const text = visibleText(
      await renderRegistration({
        whatYouOffer: null,
        homeDelivery: false,
        landline: null,
        address: null,
        openingHours: null,
        facebookUrl: null,
        photoKey: null,
        status: "in_review",
        origin: "organic",
        publishedAt: null,
        managementLinkCreatedAt: null,
      }),
    );

    expect(text).toContain("Foto del negocio\nSin foto");
    expect(text.match(/No capturado/g)).toHaveLength(5);
    // A card registered before the form asked for the postal code has none.
    expect(visibleText(await renderRegistration({ postalCode: null }))).toContain(
      "Código postal\nNo capturado",
    );
    expect(text).toContain("¿Hace entregas o va a domicilio?\nNo");
    expect(text).toContain("Estado\nEn revisión");
    expect(text).toContain("Origen\nSe registró solo");
    expect(text).not.toMatch(/Fecha de publicación|enlace de gestión/);
  });

  it("a stored photo that is not a key the server generated is no photo", async () => {
    const html = await renderRegistration({ photoKey: "https://otro.example/foto.jpg" });

    expect(images(html)).toEqual([]);
    expect(visibleText(html)).toContain("Sin foto");
  });

  it("a card from before versioning, and one whose resubmission accepted a later version", async () => {
    expect(visibleText(await renderRegistration({ consentedToNoticeVersion: null }))).toContain(
      "3 de septiembre de 2026 (versión no registrada)",
    );
    const text = visibleText(
      await renderRegistration({
        reconsentedToNoticeAt: new Date("2026-09-08T17:00:00Z"),
        reconsentedToNoticeVersion: "2",
      }),
    );
    expect(text).toContain("3 de septiembre de 2026 (versión 1)");
    expect(text).toContain("El reenvío aceptó la versión 2 del aviso\n8 de septiembre de 2026");
  });

  it("an unpublished card says when and why, a rejected one its rejection", async () => {
    const unpublished = visibleText(
      await renderRegistration({
        status: "in_review",
        unpublishedAt: new Date("2026-09-09T20:00:00Z"),
        unpublishReason: "El negocio cerró",
      }),
    );
    expect(unpublished).toContain("Cuándo la despublicaste\n9 de septiembre de 2026, 14:00");
    expect(unpublished).toContain("Por qué la despublicaste\nEl negocio cerró");
    expect(unpublished).toContain("Fecha de publicación\n5 de septiembre de 2026, 10:00");

    const rejected = visibleText(
      await renderRegistration({
        status: "rejected",
        rejectedAt: new Date("2026-09-06T15:00:00Z"),
        rejectionReason: "No pudimos confirmar el número",
      }),
    );
    expect(rejected).toContain("Estado\nRechazado");
    expect(rejected).toContain("Fecha de rechazo\n6 de septiembre de 2026, 09:00");
    expect(rejected).toContain("Motivo del rechazo\nNo pudimos confirmar el número");
  });

  it("a zone written as Otra is shown as the business wrote it, marked", async () => {
    const text = visibleText(
      await renderRegistration(
        {},
        [],
        'Rinconada del Venado (escrita como "Otra", sin normalizar)',
      ),
    );
    expect(text).toContain('Colonia\nRinconada del Venado (escrita como "Otra", sin normalizar)');
  });

  it("the management link is never on the screen, only that it has one", async () => {
    const html = await renderRegistration();

    expect(html).not.toMatch(/\/editar\/|[A-Za-z0-9_-]{43}/);
  });

  it("read-only: no form, button or script, every link at 44px, nothing that scrolls at 390px", async () => {
    const html = await renderRegistration({}, [
      { id: 1, reason: "closed", comment: "x".repeat(300), createdAt: hoursAgo(2) },
    ]);

    expect(html).not.toMatch(/<form\b|<button\b|<script\b/);
    expectPhoneReady(html);
  });
});

describe("Verification button that opens WhatsApp with a prefilled message", () => {
  it("Escribirle por WhatsApp opens the conversation with the message, naming the card's locality", async () => {
    const [button] = linksNamed(await renderRegistration(), "Escribirle por WhatsApp");
    const message =
      "Hola, te escribo de enmirumbo, el directorio de negocios de Tizayuca. Recibimos el registro de «Plomería Completa de Mentiras». ¿Nos confirmas que el negocio es tuyo y que este es tu WhatsApp?";

    expect(button?.href).toBe(`https://wa.me/527719990101?text=${encodeURIComponent(message)}`);
    expect(attribute(button?.tag ?? "", "target")).toBe("_blank");
    expect(attribute(button?.tag ?? "", "rel")).toBe("noopener noreferrer");
    const elsewhere = linksNamed(
      await renderRegistration({ localityName: "Pueblo Uno" }),
      "Escribirle por WhatsApp",
    )[0];
    expect(decodeURIComponent(elsewhere?.href ?? "")).toContain(
      "el directorio de negocios de Pueblo Uno.",
    );
  });

  it("a number that does not normalize to 10 digits is shown as stored, without a button", async () => {
    const html = await renderRegistration({ whatsapp: "77199901" });

    expect(linksNamed(html, "Escribirle por WhatsApp")).toEqual([]);
    expect(html).not.toContain("wa.me");
    expect(visibleText(html)).toContain(
      "WhatsApp registrado: 77199901 (no se pudo generar el enlace)",
    );
  });
});

describe("The business detail lists its unattended reports", () => {
  it("after the data and before the button, oldest first, with the reason, the wait and the comment as text", async () => {
    const html = await renderRegistration({}, [
      {
        id: 1,
        reason: "incorrect_data",
        comment: "<b>cerró</b><script>alert(1)</script>",
        createdAt: hoursAgo(30),
      },
      { id: 2, reason: "not_real", comment: null, createdAt: hoursAgo(2) },
    ]);
    const text = visibleText(html);

    expect(text).toContain(
      "Reportes sin atender\nLos datos están mal\nHace 30 horas\n<b>cerró</b><script>alert(1)</script>\nNo es real\nHace 2 horas",
    );
    expect(html).toContain("&lt;b&gt;cerró&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/<script>alert/);
    expect(text.indexOf("Reportes sin atender")).toBeGreaterThan(
      text.indexOf("Datos internos del panel"),
    );
    expect(text.indexOf("Reportes sin atender")).toBeLessThan(
      text.indexOf("Escribirle por WhatsApp"),
    );
  });

  it("without pending reports, or for a user who does not attend them, there is no section", async () => {
    for (const reports of [[], null]) {
      expect(visibleText(await renderRegistration({}, reports))).not.toContain(
        "Reportes sin atender",
      );
    }
  });
});

// ------------------------------------------------ the detail of a pending edit

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
    postalCode: "43808",
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
    whatsapp: "7719990101",
    zoneSlug: "huicalco",
    zoneName: "Huicalco",
    zoneOther: null,
    postalCode: "43808",
    whatYouOffer: "Tacos",
    homeDelivery: false,
    landline: null,
    address: "Calle Dos",
    openingHours: "De 10 a 6",
    facebookUrl: null,
  },
  publishedPhotoKey: PHOTO,
  photoChange: "keep",
  newPhotoKey: null,
};

function renderEdit(overrides: Partial<EditData> = {}) {
  const detail = { ...EDIT, ...overrides };
  return container.renderToString(EditDetail, {
    props: { detail, fields: comparedFields(detail, undefined), queueHref: "/admin" },
  });
}

/** The block of one field of the comparison. */
function fieldBlock(html: string, key: string): string {
  return (
    new RegExp(`<section\\b[^>]*data-field="${key}"[^>]*>[\\s\\S]*?</section>`).exec(html)?.[0] ??
    ""
  );
}

describe("The pending edit detail compares what is published with what is proposed", () => {
  it("Cambios por revisar, both columns for every field, and Cambió only where the text changes", async () => {
    const html = await renderEdit();
    const text = visibleText(html);

    expect(html).toMatch(/<h1\b[^>]*>Cambios por revisar<\/h1>/);
    expect(text).toContain("Tacos del Güero de Mentiras");
    expect(text.match(/Lo que está publicado/g)).toHaveLength(12);
    expect(text.match(/Lo que quiere cambiar/g)).toHaveLength(12);
    expect(visibleText(fieldBlock(html, "openingHours"))).toBe(
      "Horario\nCambió\nLo que está publicado\nDe 9 a 5\nLo que quiere cambiar\nDe 10 a 6",
    );
    expect(visibleText(fieldBlock(html, "address"))).toContain("Cambió");
    for (const key of [
      "name",
      "categoryName",
      "whatsapp",
      "postalCode",
      "zone",
      "whatYouOffer",
      "homeDelivery",
      "landline",
      "facebookUrl",
      "photo",
    ]) {
      expect(visibleText(fieldBlock(html, key)), key).not.toContain("Cambió");
    }
    expect(text).not.toContain("Ojo: está cambiando su WhatsApp");
    expect(linksNamed(html, "Escribirle por WhatsApp")).toEqual([]);
  });

  it("a new postal code: both, marked; one from before the form asked for it is not captured", async () => {
    const html = await renderEdit({
      published: { ...EDIT.published, postalCode: null },
      proposed: { ...EDIT.proposed, postalCode: "43815" },
    });

    expect(visibleText(fieldBlock(html, "postalCode"))).toBe(
      "Código postal\nCambió\nLo que está publicado\nNo capturado\nLo que quiere cambiar\n43815",
    );
  });

  it("a new WhatsApp: both numbers, the warning, and the button to the proposed number", async () => {
    const html = await renderEdit({ proposed: { ...EDIT.proposed, whatsapp: "7719990199" } });
    const [button] = linksNamed(html, "Escribirle por WhatsApp");

    expect(visibleText(fieldBlock(html, "whatsapp"))).toBe(
      "WhatsApp\nCambió\nLo que está publicado\n7719990101\nLo que quiere cambiar\n7719990199",
    );
    expect(visibleText(html)).toContain(
      "Ojo: está cambiando su WhatsApp. Confirma con el número nuevo antes de aplicar.",
    );
    expect(button?.href).toMatch(/^https:\/\/wa\.me\/527719990199\?text=/);
    expect(decodeURIComponent(button?.href ?? "")).toContain(
      "el directorio de negocios de Tizayuca. Recibimos el registro de «Tacos del Güero de Mentiras».",
    );
  });

  it("read-only: no form, button or script, the comparison stacked so 390px never scrolls", async () => {
    const html = await renderEdit({ proposed: { ...EDIT.proposed, whatsapp: "7719990199" } });

    expect(html).not.toMatch(/<form\b|<button\b|<script\b/);
    expectPhoneReady(html);
  });
});

describe("The detail of a pending edit shows the photo it proposes (v2)", () => {
  const photoSources = (html: string) =>
    images(fieldBlock(html, "photo")).map((img) => attribute(img, "src"));

  it("keep: the card's photo on both sides, with no mark", async () => {
    const html = await renderEdit();

    expect(photoSources(html)).toEqual([
      `/_media/photos/${PHOTO}/full.webp`,
      `/_media/photos/${PHOTO}/full.webp`,
    ]);
    expect(visibleText(fieldBlock(html, "photo"))).not.toContain("Cambió");
  });

  it("replace: the card's photo and the new one, marked", async () => {
    const html = await renderEdit({ photoChange: "replace", newPhotoKey: NEW_PHOTO });

    expect(photoSources(html)).toEqual([
      `/_media/photos/${PHOTO}/full.webp`,
      `/_media/photos/${NEW_PHOTO}/full.webp`,
    ]);
    expect(visibleText(fieldBlock(html, "photo"))).toContain("Foto del negocio\nCambió");
    expect(images(fieldBlock(html, "photo")).map((img) => attribute(img, "alt"))).toEqual([
      "Foto publicada de Tacos del Güero de Mentiras",
      "Foto nueva de Tacos del Güero de Mentiras",
    ]);
  });

  it("remove: Sin foto, marked when the card had one and unmarked when it had none", async () => {
    const removes = await renderEdit({ photoChange: "remove" });
    expect(photoSources(removes)).toEqual([`/_media/photos/${PHOTO}/full.webp`]);
    expect(visibleText(fieldBlock(removes, "photo"))).toContain("Cambió");
    expect(visibleText(fieldBlock(removes, "photo"))).toContain("Lo que quiere cambiar\nSin foto");

    const nothing = await renderEdit({ photoChange: "remove", publishedPhotoKey: null });
    expect(visibleText(fieldBlock(nothing, "photo"))).not.toContain("Cambió");
  });

  it("a resolved edit that brought a photo only says so: its photo is the card's or gone", async () => {
    const html = await renderEdit({
      status: "applied",
      photoChange: "replace",
      newPhotoKey: NEW_PHOTO,
    });

    expect(photoSources(html)).toEqual([`/_media/photos/${PHOTO}/full.webp`]);
    expect(html).not.toContain(NEW_PHOTO);
    expect(visibleText(fieldBlock(html, "photo"))).toContain(
      "Lo que quiere cambiar\nUna foto nueva",
    );
  });
});

describe("A pending edit is resolved only once and only if it is still the latest", () => {
  it("an edit no longer pending says what happened to it; a pending one says nothing", async () => {
    expect(visibleText(await renderEdit({ status: "applied" }))).toContain(
      "Estos cambios ya los habías resuelto.",
    );
    expect(visibleText(await renderEdit({ status: "discarded" }))).toContain(
      "Estos cambios ya los habías resuelto.",
    );
    expect(visibleText(await renderEdit({ status: "superseded" }))).toContain(
      "Estos cambios ya no son los últimos: el negocio mandó otros más nuevos.",
    );
    expect(visibleText(await renderEdit())).not.toMatch(
      /ya los habías resuelto|ya no son los últimos/,
    );
  });
});

// ------------------------------------------------------------ the panel trunk

describe("The panel is not indexed nor linked from the public site", () => {
  it.for([
    "/admin",
    "/admin/negocios",
    "/admin/registros/b5q68b2e72",
    "/admin/registros/1/loquesea",
  ])(
    "%s declares noindex, nofollow and the panel's referrer policy, by where it lives",
    async (path) => {
      const html = await container.renderToString(BaseLayout, {
        partial: false,
        props: { title: "Registros por revisar" },
        slots: { default: "<h1>Panel</h1>" },
        request: new Request(`https://enmirumbo.urekz.workers.dev${path}`),
        locals: {} as App.Locals,
      });

      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html).toContain('<meta name="referrer" content="strict-origin">');
      expect(html).not.toContain('rel="canonical"');
      expect(html).toContain("<title>Registros por revisar — enmirumbo</title>");
    },
  );
});

// ------------------------------------------------- the decisions of a detail
//
// "Approving assigns trades, normalizes the zone, marks the origin and
// publishes the card", "On approving, an offer is made to notify the business
// by WhatsApp with its card link and its management link", "Rejecting
// requires a reason, stores it with its date and offers to notify by
// WhatsApp", "A transition is only applied to a registration that is still in
// review", "The detail offers the actions that correspond to the status, with
// the context in sight", "A rejection reason is never silently trimmed (v2)",
// "A failed approval repaints exactly the trades the admin selected (v2)",
// "The panel says that a change takes up to a minute to reach the site (v2)"
// and "The queue labels the resubmission of a rejected card, and its detail
// says why it was rejected before (v2)". The data comes from the database in
// test/worker/review-decisions.test.ts.

const CATALOGUE: ApprovalCatalogue = {
  trades: [
    { id: 1, slug: "plomeria", name: "Plomería" },
    { id: 2, slug: "electricidad", name: "Electricidad" },
    { id: 3, slug: "carpinteria", name: "Carpintería" },
    { id: 4, slug: "albanileria", name: "Albañilería" },
  ],
  zones: [
    { id: 10, slug: "centro", displayName: "Centro", hidden: false },
    {
      id: 11,
      slug: "el-carmen-fraccionamiento",
      displayName: "El Carmen (Fraccionamiento)",
      hidden: false,
    },
    { id: 12, slug: "nacozari", displayName: "Nacozari", hidden: true },
  ],
};

interface ApproveProps {
  draft?: Partial<ApprovalDraft>;
  errors?: ApprovalErrors;
  needsZone?: boolean;
  zoneOther?: string | null;
}

function renderApprove(props: ApproveProps = {}) {
  return container.renderToString(ApproveForm, {
    props: {
      action: "?_action=admin.approve",
      catalogue: CATALOGUE,
      draft: { trades: [], zone: "", origin: "organic", ...props.draft },
      errors: props.errors ?? {},
      needsZone: props.needsZone ?? false,
      zoneOther: props.zoneOther ?? null,
    },
  });
}

const checkedValues = (html: string, type: string) =>
  (html.match(new RegExp(`<input\\b[^>]*type="${type}"[^>]*>`, "g")) ?? [])
    .filter((tag) => /\bchecked\b/.test(tag))
    .map((tag) => attribute(tag, "value"));

describe("Approving assigns trades, normalizes the zone, marks the origin and publishes the card", () => {
  it("the form: the trades, the origin and Aprobar y publicar, posted to the detail without JavaScript", async () => {
    const html = await renderApprove();
    const text = visibleText(html);

    const [form = ""] = html.match(/<form\b[^>]*>/) ?? [];
    expect(attribute(form, "method")).toBe("post");
    expect(attribute(form, "action")).toBe("?_action=admin.approve");
    expect(form).toMatch(/\bnovalidate\b/);
    for (const line of [
      "Aprobar",
      "Giros (de 1 a 3, o ninguno si no embona)",
      "Plomería",
      "Albañilería",
      "¿De dónde salió?",
      "Se registró solo",
      "Lo sembramos nosotros",
      "Aprobar y publicar",
    ]) {
      expect(text, line).toContain(line);
    }
    const trades = html.match(/<input\b[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(trades.map((tag) => [attribute(tag, "name"), attribute(tag, "value")])).toEqual(
      CATALOGUE.trades.map((trade) => ["giro", trade.slug]),
    );
    expect(checkedValues(html, "radio")).toEqual(["organic"]);
    // A zone from the catalogue is not asked for.
    expect(html).not.toMatch(/<select\b|¿En qué colonia está\?/);
    expect(html).not.toMatch(/<script\b|\brequired\b/);
    expectPhoneReady(html);
    // Every trade and origin is tapped through its label, at least 44px tall.
    for (const label of html.match(/<label\b[^>]*>(?=\s*<input)/g) ?? []) {
      expect(label).toMatch(/\bmin-h-11\b/);
    }
  });

  it('"Otra": the text as the business wrote it, and every zone by its display name, a hidden one marked', async () => {
    const html = await renderApprove({ needsZone: true, zoneOther: "Rinconada del Venado" });
    const text = visibleText(html);

    expect(text).toContain('El negocio escribió su colonia como "Otra": Rinconada del Venado');
    expect(text).toContain("¿En qué colonia está?");
    const options = [...html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(
      ([, attributes = "", label = ""]) => [attribute(attributes, "value"), label.trim()],
    );
    expect(options).toEqual([
      ["", "Elige la colonia"],
      ["centro", "Centro"],
      ["el-carmen-fraccionamiento", "El Carmen (Fraccionamiento)"],
      ["nacozari", "Nacozari (oculta)"],
    ]);
    expect(attribute(html.match(/<select\b[^>]*>/)?.[0] ?? "", "name")).toBe("colonia");
  });

  it("a failed approval comes back with exactly what the admin chose, and each error next to its field", async () => {
    const html = await renderApprove({
      draft: {
        trades: ["plomeria", "electricidad", "carpinteria", "albanileria"],
        zone: "el-carmen-fraccionamiento",
        origin: "seeded",
      },
      errors: { trades: "too-many", zone: "required" },
      needsZone: true,
      zoneOther: "Por allá",
    });
    const text = visibleText(html);

    expect(text).toContain("Elige máximo 3 giros");
    expect(text).toContain("Elige la colonia de este negocio");
    expect(checkedValues(html, "checkbox")).toEqual([
      "plomeria",
      "electricidad",
      "carpinteria",
      "albanileria",
    ]);
    expect(checkedValues(html, "radio")).toEqual(["seeded"]);
    expect(html).toMatch(/<option\b[^>]*value="el-carmen-fraccionamiento"[^>]*selected/);
    expect(html.match(/role="alert"/g)).toHaveLength(2);
  });

  it("with every trade unticked, the form comes back with none ticked", async () => {
    const html = await renderApprove({
      draft: { trades: [] },
      errors: { zone: "required" },
      needsZone: true,
    });
    expect(checkedValues(html, "checkbox")).toEqual([]);
  });

  it("republishing: the trades the card had arrive ticked", async () => {
    const html = await renderApprove({
      draft: { trades: ["electricidad", "plomeria"], origin: "seeded" },
    });
    expect(checkedValues(html, "checkbox")).toEqual(["plomeria", "electricidad"]);
    expect(checkedValues(html, "radio")).toEqual(["seeded"]);
  });
});

function renderReject(reason = "", error: ReasonError | null = null) {
  return container.renderToString(RejectForm, {
    props: { action: "?_action=admin.reject", reason, error },
  });
}

describe("Rejecting requires a reason, stores it with its date and offers to notify by WhatsApp", () => {
  it("the form: ¿Por qué lo rechazas? and Rechazar, posted to the detail, with no maxlength", async () => {
    const html = await renderReject();
    const text = visibleText(html);

    expect(text).toContain("Rechazar\n¿Por qué lo rechazas?");
    expect(attribute(html.match(/<form\b[^>]*>/)?.[0] ?? "", "action")).toBe(
      "?_action=admin.reject",
    );
    const [textarea = ""] = html.match(/<textarea\b[^>]*>/) ?? [];
    expect(attribute(textarea, "name")).toBe("motivo");
    expect(textarea).not.toMatch(/maxlength|required/);
    expect(html).toMatch(/<button\b[^>]*type="submit"[^>]*>\s*Rechazar\s*<\/button>/);
    expectPhoneReady(html);
  });

  it("without a reason, and over 500 characters, the error says so and the reason comes back whole", async () => {
    expect(visibleText(await renderReject("", "required"))).toContain(
      "Escribe por qué lo rechazas",
    );

    const long = `${"Motivo <b>largo</b> ".repeat(30)}fin`;
    const html = await renderReject(long, "too-long");
    expect(visibleText(html)).toContain(
      "El motivo no puede pasar de 500 caracteres. Recórtalo un poco: así, completo, es como le va a llegar al negocio.",
    );
    expect(decode(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? "")).toBe(long);
    expect(html).not.toContain("<b>largo</b>");
  });
});

const NOTICE: ApprovalNotice = {
  name: "Estética Lupita",
  whatsapp: "7719990202",
  cardUrl: "https://enmirumbo.example/hidalgo/tizayuca/negocio/estetica-lupita-b5q68b2e72",
  managementUrl: `https://enmirumbo.example/hidalgo/tizayuca/editar/${"T".repeat(43)}`,
};

describe("On approving, an offer is made to notify the business by WhatsApp with its card link and its management link", () => {
  it("Ya quedó publicado., the minute it takes, and Avisarle por WhatsApp with both links", async () => {
    const html = await container.renderToString(ApprovalConfirmation, {
      props: { notice: NOTICE, queueHref: "/admin" },
    });
    const text = visibleText(html);

    expect(html).toMatch(/<h1\b[^>]*>Ya quedó publicado\.<\/h1>/);
    expect(text).toContain("Listo. El cambio puede tardar hasta un minuto en verse en el sitio.");
    // Right before the notice, that the link is shown only here.
    expect(text).toContain(
      "Mándale el mensaje ahora: este enlace solo se ve aquí.\nAvisarle por WhatsApp",
    );
    const [button] = linksNamed(html, "Avisarle por WhatsApp");
    const message = `¡Listo! Ya quedó publicado «Estética Lupita» en enmirumbo. Esta es tu ficha: ${NOTICE.cardUrl} — compártela con tus clientes. Y este es tu enlace para editarla: ${NOTICE.managementUrl} — guarda este mensaje (puedes destacarlo con la estrella), con ese enlace actualizas tus datos cuando quieras.`;
    expect(button?.href).toBe(`https://wa.me/527719990202?text=${encodeURIComponent(message)}`);
    expect(attribute(button?.tag ?? "", "target")).toBe("_blank");
    expect(attribute(button?.tag ?? "", "rel")).toBe("noopener noreferrer");
    expect(linksNamed(html, "Volver a la cola").map((a) => a.href)).toEqual(["/admin"]);
    // The management link is in the notice and nowhere else of the screen.
    expect(html.split("T".repeat(43))).toHaveLength(2);
    expect(html).not.toMatch(/<form\b|<script\b/);
    expectPhoneReady(html);
  });

  it("without a public origin, it says the card is published and offers no broken notice", async () => {
    const html = await container.renderToString(ApprovalConfirmation, {
      props: { notice: { ...NOTICE, cardUrl: null, managementUrl: null }, queueHref: "/admin" },
    });

    expect(visibleText(html)).toContain(
      "No se pudo armar el link de la ficha porque falta configurar la dirección pública del sitio. El negocio ya quedó publicado; avísale cuando esté configurada.",
    );
    expect(html).not.toContain("wa.me");
    expect(visibleText(html)).not.toContain("este enlace solo se ve aquí");
  });
});

describe("Rejecting confirms with the notice, and changes nothing public", () => {
  it("Registro rechazado. and Avisarle por WhatsApp with the reason, without the minute's notice", async () => {
    const html = await container.renderToString(RejectionConfirmation, {
      props: {
        name: "Préstamos Rápidos",
        whatsapp: "7719990303",
        reason: "No publicamos préstamos informales",
        queueHref: "/admin",
      },
    });

    expect(html).toMatch(/<h1\b[^>]*>Registro rechazado\.<\/h1>/);
    const [button] = linksNamed(html, "Avisarle por WhatsApp");
    expect(decodeURIComponent(button?.href ?? "")).toBe(
      "https://wa.me/527719990303?text=Hola, revisamos el registro de «Préstamos Rápidos» en enmirumbo y por ahora no lo pudimos publicar: No publicamos préstamos informales. Si lo corriges, lo puedes volver a enviar desde el mismo formulario con este mismo número.",
    );
    expect(visibleText(html)).not.toContain("tardar hasta un minuto");
    expectPhoneReady(html);
  });

  it("a number that is not ten digits is shown as stored, without a button", async () => {
    const html = await container.renderToString(RejectionConfirmation, {
      props: { name: "X", whatsapp: "12345", reason: "Y", queueHref: null },
    });
    expect(html).not.toContain("wa.me");
    expect(visibleText(html)).toContain(
      "WhatsApp registrado: 12345 (no se pudo generar el enlace)",
    );
    expect(linksNamed(html, "Volver a la cola")).toEqual([]);
  });
});

describe("A transition is only applied to a registration that is still in review", () => {
  it("a decision on a card already resolved says so, with the way back to the queue", async () => {
    const html = await container.renderToString(DecisionScreen, {
      props: { heading: "Este registro ya lo habías resuelto.", queueHref: "/admin" },
    });
    expect(html).toMatch(/<h1\b[^>]*>Este registro ya lo habías resuelto\.<\/h1>/);
    expect(linksNamed(html, "Volver a la cola").map((a) => a.href)).toEqual(["/admin"]);
    expect(html).not.toContain("wa.me");
  });
});

describe("The detail offers the actions that correspond to the status, with the context in sight", () => {
  it("the actions go after the data, the reports and the verification button", async () => {
    const html = await container.renderToString(RegistrationDetail, {
      props: {
        detail: { ...REGISTRATION, status: "in_review" },
        zone: "Huicalco",
        reports: [{ id: 1, reason: "closed", comment: null, createdAt: hoursAgo(2) }],
        now: NOW,
        queueHref: "/admin",
      },
      slots: { default: '<form data-testid="approve-form"></form>' },
    });
    const at = (needle: string) => html.indexOf(needle);

    expect(at("Reportes sin atender")).toBeGreaterThan(at("Datos internos del panel"));
    expect(at("Escribirle por WhatsApp")).toBeGreaterThan(at("Reportes sin atender"));
    expect(at('data-testid="approve-form"')).toBeGreaterThan(at("Escribirle por WhatsApp"));
  });
});

describe("The queue labels the resubmission of a rejected card, and its detail says why it was rejected before (v2)", () => {
  it("a resubmitted card is a Reenvío, not an Alta nueva", async () => {
    const text = visibleText(
      await renderQueue({ rows: [row({ name: "Corregida", resubmitted: true })] }),
    );
    expect(text).toContain("Corregida\nHuicalco\nHace 3 horas\nReenvío");
    expect(text).not.toContain("Alta nueva");
  });

  it("its detail says why it was rejected before, and when; a card never resubmitted says nothing", async () => {
    const text = visibleText(
      await renderRegistration({
        status: "in_review",
        previousRejectedAt: new Date("2026-09-06T15:00:00Z"),
        previousRejectionReason: "La foto tenía personas",
      }),
    );
    expect(text).toContain(
      "La rechazaste antes por: La foto tenía personas\nFue el 6 de septiembre de 2026, 09:00.",
    );
    expect(visibleText(await renderRegistration())).not.toContain("La rechazaste antes");
  });
});
