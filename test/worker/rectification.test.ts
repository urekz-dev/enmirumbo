// F6 direct rectification, locality authorization, atomic contact audit and
// photo lifecycle against PostgreSQL and the local Images/R2 bindings.
import { env } from "cloudflare:workers";
import { eq, like, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  adminAuditLog,
  businesses,
  businessTrades,
  pendingEdits,
  roles,
  rolePermissions,
  roleAssignments,
  users,
  categories,
  zones,
} from "../../src/core/db/schema/index.ts";
import { panelHome } from "../../src/core/access/home.ts";
import { cardAuditEntries } from "../../src/core/review/audit-log.ts";
import { AUDIT_ACTION_TEXT } from "../../src/core/review/texts.ts";
import { editForm } from "../../src/core/edit/card.ts";
import { cardDraft } from "../../src/core/edit/submission.ts";
import { newPhotoKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import { photoCache } from "../../src/core/photos/cache.ts";
import type { MediaBucket } from "../../src/core/photos/upload.ts";
import { validateBusinessFields } from "../../src/core/registration/submission.ts";
import {
  rectificationForm,
  rectifyCard,
  submitRectification,
} from "../../src/core/review/rectification.ts";
import { dataCopyLink, dataCopyMessage } from "../../src/core/review/data-copy.ts";
import { registrationDetail } from "../../src/core/review/registration.ts";
import {
  rectificationTarget,
  rectificationActionError,
  RECTIFICATION_ROUTE,
} from "../../src/lib/rectification.ts";
import { registrationPageFailure } from "../../src/lib/registration.ts";
import { cleanup, createFixture, db, fakePhone, type Fixture, insertBusiness } from "./fixtures.ts";
import { drawWebp, photoFile } from "./images.ts";

const STATE = "68";
const EMAIL = "editor@rectification.enmirumbo.test";
const READER = "reader@rectification.enmirumbo.test";
let f: Fixture;
const written = new Set<string>();
const purged: string[][] = [];
const bucket: MediaBucket = {
  photoFolder: "photos/" as const,
  put: (key, body, options) => {
    written.add(key);
    return env.MEDIA.put(key, body, options);
  },
  delete: (keys) => env.MEDIA.delete(keys),
  cache: photoCache({
    base: "https://media-rectification.enmirumbo.test",
    purge: async (urls) => {
      purged.push([...urls]);
      return { ok: true };
    },
    defer: async () => {
      throw new Error("unexpected deferred purge");
    },
  }),
};
const deps = { useDb: db, photos: { images: env.IMAGES, bucket } };
async function removeData() {
  await db(async (tx) => {
    await tx.delete(users).where(like(users.email, "%@rectification.enmirumbo.test"));
    await tx.delete(roles).where(like(roles.key, "rectificationtest_%"));
  });
  await cleanup(STATE);
}
beforeAll(async () => {
  await removeData();
  f = await createFixture(STATE);
  await db(async (tx) => {
    for (const [email, permission, key] of [
      [EMAIL, "businesses.edit", "editor"],
      [READER, "businesses.review", "reader"],
    ] as const) {
      const [user] = await tx
        .insert(users)
        .values({ email, name: "Persona de mentira" })
        .returning();
      const [role] = await tx
        .insert(roles)
        .values({ key: `rectificationtest_${key}`, name: key, scope: "locality" })
        .returning();
      await tx.insert(rolePermissions).values({ roleId: role!.id, permissionKey: permission });
      await tx.insert(roleAssignments).values({
        userId: user!.id,
        roleId: role!.id,
        roleScope: "locality",
        localityCode: f.localityA,
      });
    }
  });
});
afterAll(async () => {
  await env.MEDIA.delete([...written]);
  await removeData();
});
afterEach(() => vi.restoreAllMocks());
const row = (id: string) =>
  db(async (tx) => (await tx.select().from(businesses).where(eq(businesses.id, id)))[0]!);
const audit = (id: string) =>
  db((tx) => tx.select().from(adminAuditLog).where(eq(adminAuditLog.businessId, id)));
async function formFor(id: string, overrides: Record<string, string> = {}) {
  const form = await db((tx) => editForm(tx, { code: f.localityA, name: "Pueblo Uno" }, id));
  const draft = cardDraft(form!.card, form!.catalogue);
  const sent = new FormData();
  for (const [key, value] of Object.entries(draft)) {
    if (typeof value === "string") sent.set(key, value);
    else if (value) sent.set(key, "on");
  }
  for (const [key, value] of Object.entries(overrides)) sent.set(key, value);
  return sent;
}
const submit = (id: string, form: FormData, email = EMAIL) =>
  submitRectification(form, { businessId: id, email }, deps);

describe("direct rectification", () => {
  it.each(["in_review", "published", "rejected"] as const)(
    "edits a %s card directly, preserving lifecycle and pending edits",
    async (status) => {
      const id = await insertBusiness(f, { status, postalCode: f.postalCodeA });
      const before = await row(id);
      await db(async (tx) => {
        await tx.insert(businessTrades).values({ businessId: id, tradeId: f.tradeIds[0] });
        await tx.insert(pendingEdits).values({
          businessId: id,
          localityCode: f.localityA,
          name: "Cambios de mentira",
          categoryId: f.categoryId,
          whatsapp: before.whatsapp,
          zoneId: f.zoneA,
          homeDelivery: false,
        });
      });
      const waiting = await db((tx) =>
        tx.select().from(pendingEdits).where(eq(pendingEdits.businessId, id)),
      );
      const sent = await formFor(id, {
        name: "Nuevo nombre de mentira",
        address: "Dirección corregida de mentira",
        whatYouOffer: "Café y reparación",
        homeDelivery: "on",
        openingHours: "De lunes a viernes",
        landline: "7719990199",
        facebookUrl: "https://example.test/negocio",
      });
      expect(await submit(id, sent, EMAIL.toUpperCase())).toEqual({ kind: "saved" });
      expect(await row(id)).toMatchObject({
        ...before,
        name: "Nuevo nombre de mentira",
        nameNormalized: "nuevo nombre de mentira",
        address: "Dirección corregida de mentira",
        whatYouOffer: "Café y reparación",
        whatYouOfferNormalized: "cafe y reparacion",
        homeDelivery: true,
        openingHours: "De lunes a viernes",
        landline: "7719990199",
        facebookUrl: "https://example.test/negocio",
      });
      expect(
        await db((tx) => tx.select().from(pendingEdits).where(eq(pendingEdits.businessId, id))),
      ).toEqual(waiting);
      expect(
        await db((tx) => tx.select().from(businessTrades).where(eq(businessTrades.businessId, id))),
      ).toHaveLength(1);
      expect(await audit(id)).toMatchObject([
        {
          actor: EMAIL,
          action: "edit_contact",
          previousStatus: status,
          localityCode: f.localityA,
          businessId: id,
        },
      ]);
      expect(Object.keys((await audit(id))[0]!).sort()).toEqual([
        "action",
        "actor",
        "businessId",
        "id",
        "localityCode",
        "occurredAt",
        "previousStatus",
      ]);
    },
  );
  it("changes category, WhatsApp, postal code and the free-text zone with the shared rules", async () => {
    const id = await insertBusiness(f);
    const whatsapp = fakePhone();
    const [category] = await db((tx) =>
      tx.select().from(categories).where(eq(categories.slug, "salud")),
    );
    expect(
      await submit(
        id,
        await formFor(id, {
          category: category!.slug,
          whatsapp: `+52 ${whatsapp}`,
          postalCode: "00999",
          zone: "_otra",
          zoneOther: "Colonia de mentira",
        }),
      ),
    ).toEqual({ kind: "saved" });
    expect(await row(id)).toMatchObject({
      categoryId: category!.id,
      whatsapp,
      postalCode: "00999",
      zoneId: null,
      zoneOther: "Colonia de mentira",
    });
    // The editor's entry reaches the audit log screen with its Spanish label.
    const entries = await db((tx) => cardAuditEntries(tx, id));
    expect(entries).toMatchObject([
      {
        action: "edit_contact",
        businessId: id,
        localityCode: f.localityA,
        actor: EMAIL,
        previousStatus: "in_review",
      },
    ]);
    expect(AUDIT_ACTION_TEXT[entries[0]!.action]).toBe("Edición de datos de contacto");
  });
  it("refuses free text, no choice and another locality's zone on a published card", async () => {
    const id = await insertBusiness(f, { status: "published", postalCode: f.postalCodeA });
    const before = await row(id);
    const [foreign] = await db((tx) =>
      tx
        .insert(zones)
        .values({
          localityCode: f.localityB,
          name: "Colonia Ajena de Mentira",
          slug: "colonia-ajena-de-mentira",
          type: "Colonia",
          postalCode: f.postalCodeB,
        })
        .returning(),
    );
    for (const chosen of ["_otra", "", foreign!.slug, "unknown"]) {
      const outcome = await submit(
        id,
        await formFor(id, { zone: chosen, zoneOther: "Colonia de mentira" }),
      );
      expect(outcome).toEqual({ kind: "invalid", errors: { zone: "required" } });
    }
    expect(await row(id)).toEqual(before);
    expect(await audit(id)).toEqual([]);
  });
  it("offers and accepts a hidden zone that is not the published card's current zone", async () => {
    const [hidden] = await db((tx) =>
      tx
        .insert(zones)
        .values({
          localityCode: f.localityA,
          name: "Colonia Oculta de Mentira",
          slug: "colonia-oculta-de-mentira",
          type: "Colonia",
          postalCode: f.postalCodeA,
          visible: false,
        })
        .returning(),
    );
    const id = await insertBusiness(f, { status: "published", postalCode: f.postalCodeA });
    const form = await db((tx) =>
      rectificationForm(tx, { code: f.localityA, name: "Pueblo Uno" }, id, true),
    );
    expect(form!.catalogue.zones.find((zone) => zone.id === hidden!.id)).toMatchObject({
      displayName: "Colonia Oculta de Mentira (oculta)",
      postalCode: f.postalCodeA,
    });
    expect(await submit(id, await formFor(id, { zone: hidden!.slug }))).toEqual({ kind: "saved" });
    expect(await row(id)).toMatchObject({ zoneId: hidden!.id, zoneOther: null });
    expect(await audit(id)).toEqual([]);
  });
  it("rechecks the published invariant and locality at the write, after the form was validated", async () => {
    const id = await insertBusiness(f, { postalCode: f.postalCodeA });
    const editing = await db((tx) => editForm(tx, { code: f.localityA, name: "Pueblo Uno" }, id));
    const validation = validateBusinessFields(
      await formFor(id, { zone: "_otra", zoneOther: "Colonia de mentira" }),
      editing!.catalogue,
    );
    if (validation.kind !== "valid") throw new Error("invalid test form");
    await db((tx) =>
      tx.update(businesses).set({ status: "published" }).where(eq(businesses.id, id)),
    );
    for (const zoneId of [null, f.zoneB]) {
      expect(
        await db((tx) =>
          rectifyCard(
            tx,
            { email: EMAIL, businessId: id },
            { ...validation.registration, zoneId },
            { kind: "keep" },
          ),
        ),
      ).toEqual({ kind: "invalid", errors: { zone: "required" } });
    }
    expect(await row(id)).toMatchObject({ status: "published", zoneId: f.zoneA, zoneOther: null });
  });
  it("keeps a hidden current zone", async () => {
    const id = await insertBusiness(f);
    await db((tx) => tx.update(zones).set({ visible: false }).where(eq(zones.id, f.zoneA)));
    try {
      expect(await submit(id, await formFor(id))).toEqual({ kind: "saved" });
    } finally {
      await db((tx) => tx.update(zones).set({ visible: true }).where(eq(zones.id, f.zoneA)));
    }
  });
  it.each(["landline", "address", "facebookUrl"] as const)(
    "removes optional contact %s with an audit entry",
    async (field) => {
      const id = await insertBusiness(f, {
        [field]: field === "facebookUrl" ? "https://example.test/old" : "7719990000",
      });
      expect(await submit(id, await formFor(id, { [field]: "" }))).toEqual({ kind: "saved" });
      expect((await row(id))[field]).toBeNull();
      expect(await audit(id)).toHaveLength(1);
    },
  );
  it("removes the remaining optional fields and logs no non-contact changes", async () => {
    const id = await insertBusiness(f, {
      whatYouOffer: "Prueba",
      openingHours: "Siempre",
      homeDelivery: true,
    });
    const form = await formFor(id, {
      whatYouOffer: "",
      openingHours: "",
      name: "Corregido de mentira",
    });
    form.delete("homeDelivery");
    expect(await submit(id, form)).toEqual({ kind: "saved" });
    expect(await row(id)).toMatchObject({
      whatYouOffer: null,
      openingHours: null,
      homeDelivery: false,
    });
    expect(await audit(id)).toEqual([]);
    expect(await submit(id, await formFor(id))).toEqual({ kind: "saved" });
    expect(await audit(id)).toEqual([]);
  });
  it("returns all the registration's validation errors with nothing saved", async () => {
    const id = await insertBusiness(f);
    const before = await row(id);
    const form = await formFor(id, {
      name: "",
      whatsapp: "nada",
      category: "unknown",
      postalCode: "xx",
      zone: "unknown",
      landline: "abc",
      facebookUrl: "javascript:alert(1)",
      address: "a".repeat(201),
      openingHours: "a".repeat(101),
      whatYouOffer: "a".repeat(201),
    });
    const editing = await db((tx) => editForm(tx, { code: f.localityA, name: "Pueblo Uno" }, id));
    expect(await submit(id, form)).toEqual(validateBusinessFields(form, editing!.catalogue));
    expect(await submit(id, form)).toMatchObject({
      kind: "invalid",
      errors: {
        name: "required",
        whatsapp: "invalid",
        category: "required",
        postalCode: "invalid",
        zone: "required",
        landline: "invalid",
        facebookUrl: "invalid",
        address: "length",
        openingHours: "length",
        whatYouOffer: "length",
      },
    });
    expect(await row(id)).toEqual(before);
  });
  it("refuses another card's WhatsApp in any status, but permits the same number in another locality", async () => {
    const id = await insertBusiness(f);
    for (const status of ["in_review", "published", "rejected"] as const) {
      const other = await insertBusiness(f, { status });
      expect(
        await submit(id, await formFor(id, { whatsapp: (await row(other)).whatsapp })),
      ).toEqual({ kind: "invalid", errors: { whatsapp: "taken" } });
    }
    const number = fakePhone();
    await insertBusiness(f, { localityCode: f.localityB, zoneId: f.zoneB, whatsapp: number });
    expect(await submit(id, await formFor(id, { whatsapp: number }))).toEqual({ kind: "saved" });
  });
  it("fails visibly and rolls back the correction when the audit insert fails", async () => {
    const id = await insertBusiness(f);
    const before = await row(id);
    await db(async (tx) => {
      await tx.execute(
        sql`CREATE FUNCTION rectificationtest_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.locality_code = '68001' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`,
      );
      await tx.execute(
        sql`CREATE TRIGGER rectificationtest_fail_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION rectificationtest_fail_audit()`,
      );
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await submit(id, await formFor(id, { address: "No debe guardarse" }));
      expect(outcome).toEqual({ kind: "server" });
      expect(registrationPageFailure(rectificationActionError(outcome)!)).toMatchObject({
        general: "server",
      });
      expect(await row(id)).toEqual(before);
      expect(await audit(id)).toEqual([]);
    } finally {
      await db(async (tx) => {
        await tx.execute(sql`DROP TRIGGER rectificationtest_fail_audit ON admin_audit_log`);
        await tx.execute(sql`DROP FUNCTION rectificationtest_fail_audit()`);
      });
    }
  });
  it("rechecks locality permissions and refuses a reader or a card in another locality", async () => {
    const id = await insertBusiness(f);
    const form = await formFor(id);
    expect(await submit(id, form, READER)).toEqual({ kind: "forbidden" });
    expect(await submit(id, form, "nobody@rectification.enmirumbo.test")).toEqual({
      kind: "not-found",
    });
    const other = await insertBusiness(f, { localityCode: f.localityB, zoneId: f.zoneB });
    expect(await submit(other, form)).toEqual({ kind: "not-found" });
  });
  it("has no consent, trap, Turnstile or quota requirement", async () => {
    const id = await insertBusiness(f);
    const form = await formFor(id);
    form.set("website", "filled trap ignored in panel");
    expect(await submit(id, form)).toEqual({ kind: "saved" });
  });
});

describe("photos", () => {
  it("replaces and removes both variants and purges their addresses after saving", async () => {
    const old = newPhotoKey();
    for (const key of photoObjectKeys(old)) {
      written.add(key);
      await env.MEDIA.put(key, "old photo");
    }
    const id = await insertBusiness(f, { photoKey: old });
    const sent = await formFor(id);
    sent.set("photo", photoFile(drawWebp(80, 60, 0x334455), "foto.webp", "image/webp"));
    expect(await submit(id, sent)).toEqual({ kind: "saved" });
    const key = (await row(id)).photoKey!;
    expect(key).not.toBe(old);
    for (const object of photoObjectKeys(key)) expect(await env.MEDIA.head(object)).not.toBeNull();
    for (const object of photoObjectKeys(old)) expect(await env.MEDIA.head(object)).toBeNull();
    expect(purged).toContainEqual(
      photoObjectKeys(old).map((object) => `https://media-rectification.enmirumbo.test/${object}`),
    );
    expect(await submit(id, await formFor(id, { removePhoto: "on" }))).toEqual({ kind: "saved" });
    expect((await row(id)).photoKey).toBeNull();
    for (const object of photoObjectKeys(key)) expect(await env.MEDIA.head(object)).toBeNull();
    expect(purged).toContainEqual(
      photoObjectKeys(key).map((object) => `https://media-rectification.enmirumbo.test/${object}`),
    );
    expect(await audit(id)).toEqual([]);
  });
  it("cleans an uploaded photo when its save fails, without deleting the card's photo", async () => {
    const old = newPhotoKey();
    const id = await insertBusiness(f, { photoKey: old });
    const other = await insertBusiness(f);
    const form = await formFor(id, { whatsapp: (await row(other)).whatsapp });
    form.set("photo", photoFile(drawWebp(80, 60, 0x334455), "foto.webp", "image/webp"));
    const before = new Set(written);
    expect(await submit(id, form)).toMatchObject({ kind: "invalid" });
    const added = [...written].filter((key) => !before.has(key));
    expect(added).toHaveLength(2);
    for (const key of added) expect(await env.MEDIA.head(key)).toBeNull();
    expect((await row(id)).photoKey).toBe(old);
  });
});

it("builds the copy from the allowlisted card fields and checks businesses.edit per locality", async () => {
  const id = await insertBusiness(f, {
    photoKey: newPhotoKey(),
    postalCode: f.postalCodeA,
    status: "rejected",
    rejectionReason: "INTERNAL_REASON",
    rejectedAt: new Date(),
    whatYouOffer: "Café de mentira",
    reconsentedToNoticeAt: new Date("2026-10-19T18:00:00Z"),
    reconsentedToNoticeVersion: "2",
  });
  await db((tx) => tx.insert(businessTrades).values({ businessId: id, tradeId: f.tradeIds[0] }));
  const card = (await db((tx) => registrationDetail(tx, id)))!;
  const link = await db((tx) => dataCopyLink(tx, EMAIL, card, "Centro"));
  const url = new URL(link!);
  expect(url.pathname).toBe(`/52${card.whatsapp}`);
  const message = url.searchParams.get("text")!;
  for (const label of [
    "Nombre:",
    "Categoría:",
    "Municipio: Pueblo Uno",
    "WhatsApp:",
    "Teléfono fijo: No capturado",
    "Colonia: Centro",
    "Código postal:",
    "Dirección o referencias:",
    "Horario:",
    "¿Qué ofreces?: Café de mentira",
    "Link de Facebook:",
    "Entregas o servicio a domicilio: No",
    "Giros:",
    "Aviso de privacidad aceptado:",
    "versión 1",
    "Aviso de privacidad aceptado de nuevo:",
    "versión 2",
    "Foto guardada: Sí",
  ])
    expect(message).toContain(label);
  expect(message).not.toContain(card.photoKey);
  expect(message).not.toContain("INTERNAL_REASON");
  expect(message).not.toContain(id);
  expect(await db((tx) => dataCopyLink(tx, READER, card, "Centro"))).toBeNull();
  expect(
    await db((tx) => dataCopyLink(tx, EMAIL, { ...card, localityCode: f.localityB }, "Centro")),
  ).toBeNull();
  const minimal = dataCopyMessage(
    { ...card, photoKey: null, consentedToNoticeVersion: null, reconsentedToNoticeAt: null },
    "Colonia inventada",
    [],
  );
  expect(minimal).toContain("Foto guardada: No");
  expect(minimal).toContain("versión no registrada");
  expect(minimal).not.toContain("Giros:");
});

it("accepts the action only from the panel edit address", () => {
  expect(
    rectificationTarget({ routePattern: RECTIFICATION_ROUTE, params: { id: "from-address" } }),
  ).toBe("from-address");
  for (const routePattern of [
    "/_actions/admin.rectify",
    "/admin/registros/[id]",
    "/[state]/[municipality]/registro",
  ]) {
    expect(rectificationTarget({ routePattern, params: { id: "from-address" } })).toBeNull();
  }
});

it("writes the data-copy message literally with only captured data", () => {
  expect(
    dataCopyMessage(
      {
        name: "Negocio de Mentira",
        categoryName: "Salud",
        localityName: "Pueblo Uno",
        whatsapp: "7719990199",
        landline: "7719990188",
        postalCode: "00999",
        address: "Dirección de mentira",
        openingHours: "Lunes a viernes",
        whatYouOffer: "Productos de mentira",
        facebookUrl: "https://example.test/ficha",
        homeDelivery: true,
        photoKey: newPhotoKey(),
        timeZone: "America/Mexico_City",
        consentedToNoticeAt: new Date("2026-10-18T18:00:00Z"),
        consentedToNoticeVersion: "1",
        reconsentedToNoticeAt: new Date("2026-10-19T18:00:00Z"),
        reconsentedToNoticeVersion: "2",
      },
      "Colonia de mentira",
      ["Giro de mentira"],
    ),
  ).toBe(
    [
      "Hola, esta es la copia de los datos de tu ficha que guardamos en enmirumbo:",
      "Nombre: Negocio de Mentira",
      "Categoría: Salud",
      "Municipio: Pueblo Uno",
      "WhatsApp: 7719990199",
      "Teléfono fijo: 7719990188",
      "Colonia: Colonia de mentira",
      "Código postal: 00999",
      "Dirección o referencias: Dirección de mentira",
      "Horario: Lunes a viernes",
      "¿Qué ofreces?: Productos de mentira",
      "Link de Facebook: https://example.test/ficha",
      "Entregas o servicio a domicilio: Sí",
      "Giros: Giro de mentira",
      "Aviso de privacidad aceptado: 18 de octubre de 2026, 12:00; versión 1",
      "Aviso de privacidad aceptado de nuevo: 19 de octubre de 2026, 12:00; versión 2",
      "Foto guardada: Sí",
    ].join("\n"),
  );
});

it("validates photo content and size without changing the card", async () => {
  const id = await insertBusiness(f);
  const before = await row(id);
  const invalid = await formFor(id);
  invalid.set("photo", new File(["not a photo"], "foto.jpg", { type: "image/jpeg" }));
  expect(await submit(id, invalid)).toEqual({ kind: "invalid", errors: { photo: "unreadable" } });
  invalid.set("photo", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "foto.jpg"));
  expect(await submit(id, invalid)).toEqual({ kind: "invalid", errors: { photo: "too-large" } });
  expect(await row(id)).toEqual(before);
});

it("an edit-only user reaches the card list through the permission-based panel home", async () => {
  expect(await db((tx) => panelHome(tx, EMAIL))).toEqual({
    queue: false,
    links: [{ href: "/admin/negocios", text: "Todos los negocios" }],
  });
});
