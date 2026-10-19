// F6 uses the registration's fields, labels and errors in the panel.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import RectificationForm from "../../src/components/admin/RectificationForm.astro";
import RegistrationForm from "../../src/components/RegistrationForm.astro";
import { EMPTY_REGISTRATION_DRAFT } from "../../src/core/registration/submission.ts";
import { RECTIFICATION_WARNING } from "../../src/core/review/texts.ts";

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});
const catalogue = {
  categories: [{ id: 1, slug: "salud", name: "Salud" }],
  zones: [{ id: 1, slug: "centro", name: "Centro", displayName: "Centro", postalCode: "43800" }],
};
const props = {
  action: "?_action=admin.rectify",
  catalogue,
  municipality: "Pueblo de Mentira",
  draft: {
    ...EMPTY_REGISTRATION_DRAFT,
    name: "Negocio de Mentira",
    whatsapp: "7719990100",
    category: "salud",
    postalCode: "43800",
    zone: "centro",
    facebookUrl: "https://example.test/ficha",
  },
  errors: {},
  general: null,
};
describe("panel form", () => {
  it("prefills the shared form without consent, honeypot, Turnstile or a disabled submit", async () => {
    const html = await container.renderToString(RegistrationForm, {
      props: { ...props, mode: "panel", turnstile: { siteKey: "ignored-in-panel" } },
    });
    expect(html).toContain("novalidate");
    expect(html).toContain('enctype="multipart/form-data"');
    for (const value of [
      "Negocio de Mentira",
      "7719990100",
      "https://example.test/ficha",
      "C.P. 43800",
      "Mi colonia no aparece",
      "Guardar cambios",
    ])
      expect(html).toContain(value);
    expect(html).not.toMatch(
      /cf-turnstile|turnstile-response|name="consent"|name="noticeVersion"|data-honeypot|name="website"|<noscript|<button[^>]*\sdisabled(?:=|[ >])/,
    );
    expect(html).toMatch(/name="photo"/);
    expect(html).toMatch(/name="removePhoto"/);
    expect(html).toContain("data-zone-select");
    expect(html).toContain("data-postal-code-source");
  });
  it("warns about an owner's pending edit and keeps submitted values and registration errors", async () => {
    const html = await container.renderToString(RectificationForm, {
      props: {
        ...props,
        errors: { whatsapp: "taken", facebookUrl: "invalid" },
        waiting: true,
        photoKey: null,
        detailHref: "/admin/registros/b5q68b2e72",
      },
    });
    expect(html).toContain(RECTIFICATION_WARNING);
    expect(html).toContain("Ese número ya está en otra ficha del directorio.");
    expect(html).toContain("El link de Facebook debe empezar con http:// o https://");
    expect(html).toContain('value="7719990100"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Sin foto");
    const clean = await container.renderToString(RectificationForm, {
      props: {
        ...props,
        waiting: false,
        photoKey: null,
        detailHref: "/admin/registros/b5q68b2e72",
      },
    });
    expect(clean).not.toContain(RECTIFICATION_WARNING);
  });
});

it("published cards show only grouped catalogue zones, hidden labels and the approval error", async () => {
  const html = await container.renderToString(RectificationForm, {
    props: {
      ...props,
      catalogueZoneOnly: true,
      waiting: false,
      photoKey: null,
      detailHref: "/admin/registros/b5q68b2e72",
      catalogue: {
        ...catalogue,
        zones: [
          ...catalogue.zones,
          {
            id: 2,
            slug: "oculta",
            name: "Colonia de Mentira",
            displayName: "Colonia de Mentira (oculta)",
            postalCode: "43801",
          },
        ],
      },
      errors: { zone: "required" },
    },
  });
  expect(html).toContain("Colonia de Mentira (oculta)");
  expect(html).toContain("C.P. 43801");
  expect(html).toContain("Elige la colonia de este negocio");
  expect(html).toContain("data-zone-select");
  expect(html).toContain("data-postal-code-source");
  expect(html).not.toMatch(
    /Mi colonia no aparece|name="zoneOther"|data-other-zone|data-zone-other/,
  );
});
