// Scenarios of docs/specs/admin-review.md on the zones screen of the panel,
// rendered with Astro's Container API: "The admin can hide and rename the
// zones of a locality (v2)", "The admin can add a zone to a locality (v2)",
// "The panel says that a change takes up to a minute to reach the site (v2)",
// "The panel filters by locality, and the filter is hidden while there is one
// (v2)" and "The panel is operated from the phone and without unnecessary
// client JavaScript"; and the entry to it from the queue. The data comes from
// the database in test/worker/zone-management.test.ts; end to end, through
// Access, in test/e2e/admin-zones.spec.ts.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import ReviewQueue from "../../src/components/admin/ReviewQueue.astro";
import ZonesScreen from "../../src/components/admin/ZonesScreen.astro";
import type { PanelZone } from "../../src/core/zones/manage.ts";
import type { ZonesFailure } from "../../src/core/zones/rules.ts";
import BaseLayout from "../../src/layouts/BaseLayout.astro";
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
      .replace(/<(\w+)\b[^>]*class="sr-only"[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(
        /<\/?(?:p|div|h[1-6]|li|ul|a|span|article|nav|label|section|summary|details|button|form|option|select)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

const attribute = (tag: string, name: string) =>
  decode(new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? "");
const classesOf = (html: string) =>
  [...html.matchAll(/\bclass="([^"]*)"/g)].map(([, classes = ""]) => classes);
const forms = (html: string) => html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? [];

/** The `<li>` of the zone `id`. */
function rowOf(html: string, id: number): string {
  return new RegExp(`<li[^>]*id="colonia-${id}"[^>]*>[\\s\\S]*?</li>`).exec(html)?.[0] ?? "";
}

/** Every element a person taps measures at least 44px, and nothing blocks the collapse at 390px. */
function expectPhoneReady(html: string): void {
  for (const tag of html.match(/<(?:a|button|summary|select)\b[^>]*>/g) ?? []) {
    expect(tag).toMatch(/\bmin-h-11\b/);
  }
  for (const input of html.match(/<input\b[^>]*>/g) ?? []) {
    if (attribute(input, "type") !== "hidden") expect(input).toMatch(/\bmin-h-11\b/);
  }
  expect(classesOf(html).flatMap(collapseProblems)).toEqual([]);
}

const zone = (overrides: Partial<PanelZone>): PanelZone => ({
  id: 1,
  slug: "huicalco",
  name: "Huicalco",
  type: "Barrio",
  visible: true,
  displayName: "Huicalco",
  postalCode: "43808",
  ...overrides,
});

const ZONES: PanelZone[] = [
  zone({ id: 1 }),
  zone({
    id: 2,
    slug: "colonia-el-carmen",
    name: "El Carmen",
    type: "Colonia",
    displayName: "El Carmen (Colonia)",
    postalCode: "43815",
  }),
  zone({
    id: 3,
    slug: "nacozari",
    name: "Nacozari",
    type: "Barrio",
    visible: false,
    displayName: "Nacozari",
    // Added before zones had a postal code.
    postalCode: null,
  }),
];
const TYPES = ["Barrio", "Colonia", "Fraccionamiento"];
const ACTIONS = {
  visibility: "/admin/colonias?localidad=13069&_action=admin.setZoneVisibility",
  rename: "/admin/colonias?localidad=13069&_action=admin.renameZone",
  add: "/admin/colonias?localidad=13069&_action=admin.addZone",
};

interface ScreenProps {
  zones?: PanelZone[];
  types?: string[];
  localityFilter?: { text: string; href: string; current: boolean }[];
  done?: number | null;
  failure?: ZonesFailure | null;
  queueHref?: string | null;
}

function renderScreen(props: ScreenProps = {}) {
  return container.renderToString(ZonesScreen, {
    props: {
      localityName: "Tizayuca",
      zones: ZONES,
      types: TYPES,
      localityFilter: [],
      localityFilterLabel: "Filtrar por municipio",
      done: null,
      failure: null,
      actions: ACTIONS,
      queueHref: "/admin",
      queueText: "Volver a la cola",
      ...props,
    },
  });
}

describe("The admin can hide and rename the zones of a locality (v2): the screen", () => {
  it("lists every zone of the locality, hidden ones included, with its type, its postal code, its URL and Oculta", async () => {
    const html = await renderScreen();
    const text = visibleText(html);

    expect(html).toMatch(/<h1\b[^>]*>\s*Colonias de Tizayuca\s*<\/h1>/);
    expect(text).toContain("3 colonias, 1 oculta");
    expect(visibleText(rowOf(html, 1))).toMatch(
      /^Huicalco\nTipo: Barrio\nCódigo postal: 43808\nEn la URL: huicalco\n/,
    );
    expect(visibleText(rowOf(html, 2))).toMatch(
      /^El Carmen \(Colonia\)\nTipo: Colonia\nCódigo postal: 43815\nEn la URL: colonia-el-carmen\n/,
    );
    expect(visibleText(rowOf(html, 3))).toMatch(
      /^Nacozari\nTipo: Barrio\nCódigo postal: sin registrar\nEn la URL: nacozari\nOculta\n/,
    );
    expect(visibleText(rowOf(html, 1))).not.toMatch(/^Oculta$/m);
    expect(text).toContain(
      "Una colonia oculta ya no se ofrece en el formulario de registro ni en el de cambios. Cambiarle el nombre no cambia sus URLs.",
    );
  });

  it("each zone has Ocultar or Mostrar, a form that posts its zone to the screen of its locality", async () => {
    const html = await renderScreen();
    const visible = forms(rowOf(html, 1))[0] ?? "";
    const hidden = forms(rowOf(html, 3))[0] ?? "";

    expect(attribute(visible, "method")).toBe("post");
    expect(attribute(visible, "action")).toBe(ACTIONS.visibility);
    expect(visible).toContain('name="zone" value="1"');
    expect(visible).toContain('name="visible" value="false"');
    expect(visibleText(visible)).toBe("Ocultar");
    expect(visible).toContain('aria-label="Ocultar: Huicalco"');
    expect(hidden).toContain('name="visible" value="true"');
    expect(visibleText(hidden)).toBe("Mostrar");
    expect(hidden).toContain('aria-label="Mostrar: Nacozari"');
  });

  it("each zone has Cambiarle el nombre, a closed disclosure with the rename form and its current name", async () => {
    const html = await renderScreen();
    const row = rowOf(html, 2);
    const rename = forms(row)[1] ?? "";

    expect(row).toMatch(/<details>\s*<summary\b/);
    expect(visibleText(row)).toContain("Cambiarle el nombre");
    expect(row).toContain('<span class="sr-only">: El Carmen (Colonia)</span>');
    expect(attribute(rename, "action")).toBe(ACTIONS.rename);
    expect(rename).toMatch(/\bnovalidate\b/);
    expect(rename).toContain('name="zone" value="2"');
    expect(rename).toMatch(/<label for="rename-zone-2"[^>]*>\s*Nombre nuevo\s*<\/label>/);
    const input = /<input[^>]*id="rename-zone-2"[^>]*>/.exec(rename)?.[0] ?? "";
    expect(attribute(input, "name")).toBe("name");
    // The stored name, not the display name: the type is not part of it.
    expect(attribute(input, "value")).toBe("El Carmen");
    expect(attribute(input, "maxlength")).toBe("80");
    expect(visibleText(rename)).toContain("Guardar el nombre");
  });

  // Scenario of "The panel says that a change takes up to a minute to reach the site (v2)"
  it("after a change, the row of its zone says it may take up to a minute, and no other row does", async () => {
    const html = await renderScreen({ done: 3 });

    expect(visibleText(rowOf(html, 3))).toContain(
      "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.",
    );
    expect(rowOf(html, 3)).toMatch(/role="status"/);
    expect(visibleText(rowOf(html, 1))).not.toContain("Listo.");
    expect(visibleText(await renderScreen())).not.toContain("Listo.");
  });

  it("a rename that fails comes back open, with what was typed and the error next to the field", async () => {
    const html = await renderScreen({
      failure: {
        form: "rename",
        zoneId: 1,
        name: "El Carmen",
        errors: { name: { kind: "display-clash", displayName: "El Carmen (Colonia)" } },
      },
    });
    const row = rowOf(html, 1);
    const input = /<input[^>]*id="rename-zone-1"[^>]*>/.exec(row)?.[0] ?? "";

    expect(row).toMatch(/<details open>/);
    expect(attribute(input, "value")).toBe("El Carmen");
    expect(attribute(input, "aria-invalid")).toBe("true");
    expect(attribute(input, "aria-describedby")).toBe("rename-zone-1-error");
    expect(row).toMatch(/<p id="rename-zone-1-error" role="alert"/);
    expect(visibleText(row)).toContain(
      "Ya hay otra colonia que se vería igual: «El Carmen (Colonia)». Ponle un nombre distinto.",
    );
    // The other rows stay closed and as they were.
    expect(rowOf(html, 2)).toMatch(/<details>/);
    expect(visibleText(rowOf(html, 2))).not.toContain("Ya hay otra colonia");
  });

  it("the locality filter is hidden while the user sees one active locality, and shown with two", async () => {
    expect(visibleText(await renderScreen())).not.toContain("Filtrar por municipio");

    const html = await renderScreen({
      localityFilter: [
        { text: "Tizayuca, Hidalgo", href: "/admin/colonias?localidad=13069", current: true },
        { text: "Pueblo Dos, Estado", href: "/admin/colonias?localidad=90001", current: false },
      ],
    });
    expect(visibleText(html)).toContain(
      "Filtrar por municipio\nTizayuca, Hidalgo\nPueblo Dos, Estado",
    );
    expect(html).toMatch(/<a href="\/admin\/colonias\?localidad=13069" aria-current="true"/);
    // No "Todos": the zones belong to one locality.
    expect(visibleText(html)).not.toMatch(/^Todos$/m);
  });

  it("a locality without zones says so", async () => {
    const text = visibleText(await renderScreen({ zones: [], types: [] }));

    expect(text).toContain("0 colonias\nEste municipio todavía no tiene colonias.");
  });

  it("Volver a la cola only for who may open the queue", async () => {
    expect(visibleText(await renderScreen())).toContain("Volver a la cola");
    expect(visibleText(await renderScreen({ queueHref: null }))).not.toContain("Volver a la cola");
  });

  it("is operated from the phone, without client JavaScript", async () => {
    const html = await renderScreen({
      failure: {
        form: "add",
        name: "",
        type: "",
        postalCode: "",
        errors: { name: { kind: "required" } },
      },
    });

    expectPhoneReady(html);
    expect(html).not.toMatch(/<script\b/);
    expect(html).not.toMatch(/\sstyle=/);
  });
});

describe("The admin can add a zone to a locality (v2): the form", () => {
  it("asks for the name, one of the locality's settlement types and the postal code, and posts to the screen of its locality", async () => {
    const html = await renderScreen();
    const add = forms(html)[0] ?? "";

    expect(visibleText(html)).toContain(
      "Agregar una colonia\nPara fraccionamientos nuevos que todavía no salen en el catálogo de SEPOMEX. Su URL sale del nombre y ya no cambia, aunque luego le cambies el nombre.",
    );
    expect(attribute(add, "method")).toBe("post");
    expect(attribute(add, "action")).toBe(ACTIONS.add);
    expect(add).toMatch(/\bnovalidate\b/);
    expect(add).toMatch(/<label for="add-zone-name"[^>]*>Nombre<\/label>/);
    expect(add).toMatch(/<label for="add-zone-type"[^>]*>Tipo<\/label>/);
    expect([...add.matchAll(/<option value="([^"]*)"/g)].map(([, value]) => value)).toEqual([
      "",
      ...TYPES,
    ]);
    expect(visibleText(add)).toContain("Elige el tipo");
    expect(add).toMatch(/<label for="add-zone-postal-code"[^>]*>Código postal<\/label>/);
    const postalCode = /<input[^>]*id="add-zone-postal-code"[^>]*>/.exec(add)?.[0] ?? "";
    expect(attribute(postalCode, "name")).toBe("postalCode");
    expect(attribute(postalCode, "maxlength")).toBe("5");
    expect(attribute(postalCode, "inputmode")).toBe("numeric");
    expect(visibleText(add)).toContain(
      "El del catálogo de SEPOMEX, si ya la tiene; si no, el que usan sus vecinos. El formulario de registro ofrece cada colonia con su código postal.",
    );
    expect(visibleText(add)).toContain("Agregar colonia");
  });

  it.each([
    [{ kind: "required" }, "", "Escribe el código postal de la colonia."],
    [{ kind: "invalid" }, "4381", "El código postal son 5 números, sin espacios."],
  ] as const)(
    "a postal code %j says it in Spanish, with what was typed",
    async (problem, typed, message) => {
      const html = await renderScreen({
        failure: {
          form: "add",
          name: "Real Toledo",
          type: "Fraccionamiento",
          postalCode: typed,
          errors: { postalCode: problem },
        },
      });
      const add = forms(html)[0] ?? "";
      const postalCode = /<input[^>]*id="add-zone-postal-code"[^>]*>/.exec(add)?.[0] ?? "";

      expect(attribute(postalCode, "value")).toBe(typed);
      expect(attribute(postalCode, "aria-invalid")).toBe("true");
      expect(add).toMatch(/<p id="add-zone-postal-code-error" role="alert"/);
      expect(visibleText(add)).toContain(message);
    },
  );

  it("a new zone that fails comes back with what was typed and each error next to its field", async () => {
    const html = await renderScreen({
      failure: {
        form: "add",
        name: "Registro",
        type: "Colonia",
        postalCode: "",
        errors: {
          name: {
            kind: "url-conflict",
            segment: "registro",
            trade: null,
            other: { kind: "reserved" },
          },
        },
      },
    });
    const add = forms(html)[0] ?? "";
    const name = /<input[^>]*id="add-zone-name"[^>]*>/.exec(add)?.[0] ?? "";

    expect(attribute(name, "value")).toBe("Registro");
    expect(attribute(name, "aria-invalid")).toBe("true");
    expect(add).toMatch(/<option value="Colonia" selected/);
    expect(visibleText(add)).toContain(
      "Con ese nombre, la URL «registro» se confundiría con una página propia del sitio. Ponle otro nombre; por ejemplo, con su tipo adelante: «Colonia Registro».",
    );
  });

  it.each([
    [{ kind: "required" }, "Escribe el nombre de la colonia."],
    [{ kind: "too-long" }, "Deja el nombre en 80 caracteres o menos."],
    [{ kind: "no-letters" }, "Escribe el nombre con letras o números."],
    [
      { kind: "no-slug" },
      "Ese nombre tiene letras que no caben en una URL. Escríbelo con las letras del español, números y espacios.",
    ],
    [
      { kind: "slug-taken", slug: "huicalco", zone: "Huicalco" },
      "Ya hay una colonia con esa misma URL (huicalco): «Huicalco». Si es la misma, búscala en la lista para mostrarla o cambiarle el nombre; si es otra, ponle un nombre distinto.",
    ],
    [
      {
        kind: "url-conflict",
        segment: "pintura-fina",
        trade: "Pintura",
        other: { kind: "trade", name: "Pintura fina" },
      },
      "Con ese nombre, la URL «pintura-fina» (la del giro «Pintura» en esta colonia) se confundiría con el giro «Pintura fina». Ponle otro nombre.",
    ],
  ] as const)("the name error %j says it in Spanish", async (problem, message) => {
    const html = await renderScreen({
      failure: { form: "add", name: "Fina", type: "", postalCode: "", errors: { name: problem } },
    });

    expect(visibleText(forms(html)[0] ?? "")).toContain(message);
  });

  it("without a type, the type says so", async () => {
    const html = await renderScreen({
      failure: {
        form: "add",
        name: "Real Toledo",
        type: "",
        postalCode: "",
        errors: { type: { kind: "required" } },
      },
    });
    const add = forms(html)[0] ?? "";

    expect(add).toMatch(/<option value="" selected/);
    expect(visibleText(add)).toContain("Elige el tipo de la colonia.");
    expect(add).toMatch(/<select[^>]*aria-invalid="true"/);
  });

  it("a submission the screen could not save says so above the forms", async () => {
    const text = visibleText(await renderScreen({ failure: { form: "general" } }));

    expect(text).toContain("No se pudo guardar el cambio. Vuelve a intentarlo.");
  });
});

describe("The queue leads to the zones screen", () => {
  const renderQueue = (zonesHref: string | null) =>
    container.renderToString(ReviewQueue, {
      props: {
        rows: [],
        reported: [],
        now: new Date(),
        localityFilter: [],
        localityFilterLabel: "Filtrar por municipio",
        localityNames: null,
        listHref: "/admin/negocios",
        zonesHref,
      },
    });

  it("Administrar colonias only for who manages zones", async () => {
    const html = await renderQueue("/admin/colonias");
    expect(html).toMatch(
      /<a href="\/admin\/colonias" class="[^"]*\bmin-h-11\b[^"]*">\s*Administrar colonias\s*<\/a>/,
    );
    expect(visibleText(await renderQueue(null))).not.toContain("Administrar colonias");
  });

  it("the screen lives under /admin: noindex, nofollow and the panel's referrer policy", async () => {
    const html = await container.renderToString(BaseLayout, {
      partial: false,
      props: { title: "Colonias" },
      slots: { default: "<h1>Colonias</h1>" },
      request: new Request("https://enmirumbo.com/admin/colonias"),
      locals: {} as App.Locals,
    });

    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<meta name="referrer" content="strict-origin">');
    expect(html).not.toContain('rel="canonical"');
  });
});
