// Scenarios of docs/specs/data-model.md that the schema itself guarantees:
// constraints, defaults and relations, checked against the database that the
// full migration tree leaves (test/global-setup.ts). Behaviour that needs
// application code (seeds, purges, the search normalization, the admin
// actions) is tested with the stories that add it.
import { and, asc, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { isBusinessId, newBusinessId } from "../../src/core/business/id.ts";
import {
  adminAuditLog,
  businesses,
  businessTrades,
  localities,
  municipalities,
  pendingEdits,
  reports,
  SCHEDULED_JOB_ACTOR,
  states,
  zones,
} from "../../src/core/db/schema/index.ts";
import {
  businessValues,
  cleanup,
  createFixture,
  db,
  fakePhone,
  type Fixture,
  insertBusiness,
  PG,
  pgErrorCode,
  query,
} from "./fixtures.ts";

const STATE = "98";
let f: Fixture;

beforeAll(async () => {
  f = await createFixture(STATE);
});

afterAll(async () => {
  await cleanup(STATE);
});

const getBusiness = (id: string) =>
  db(async (tx) => (await tx.select().from(businesses).where(eq(businesses.id, id)))[0]);

const updateBusiness = (id: string, values: Partial<typeof businesses.$inferInsert>) =>
  db((tx) => tx.update(businesses).set(values).where(eq(businesses.id, id)));

const insertEdit = (
  businessId: string,
  overrides: Partial<typeof pendingEdits.$inferInsert> = {},
) =>
  db((tx) =>
    tx.insert(pendingEdits).values({
      businessId,
      localityCode: f.localityA,
      name: "Plomería de Prueba",
      categoryId: f.categoryId,
      whatsapp: fakePhone(),
      zoneId: f.zoneA,
      ...overrides,
    }),
  );

describe("The `Business` model covers the registration fields", () => {
  it("minimal creation with required fields only", async () => {
    const id = await insertBusiness(f);
    const row = await getBusiness(id);

    expect(row).toMatchObject({
      whatYouOffer: null,
      homeDelivery: false,
      landline: null,
      address: null,
      latitude: null,
      longitude: null,
      openingHours: null,
      facebookUrl: null,
      photoKey: null,
    });
  });

  it("full creation with optional fields", async () => {
    const values = businessValues(f, {
      whatYouOffer: "Destape de drenajes y bombas de agua",
      homeDelivery: true,
      landline: "7719991234",
      address: "Junto a la tienda de la esquina",
      latitude: 19.8378,
      longitude: -98.9813,
      openingHours: "Lunes a sábado de 9 de la mañana a 7 de la tarde",
      facebookUrl: "https://www.facebook.com/negocio-de-prueba",
      photoKey: "businessphoto",
    });
    await db((tx) => tx.insert(businesses).values(values));

    expect(await getBusiness(values.id)).toMatchObject({
      whatYouOffer: values.whatYouOffer,
      homeDelivery: true,
      landline: values.landline,
      address: values.address,
      latitude: values.latitude,
      longitude: values.longitude,
      openingHours: values.openingHours,
      facebookUrl: values.facebookUrl,
      photoKey: values.photoKey,
    });
  });

  it.for([
    "https://media.enmirumbo.com/photos/a.webp",
    "data:image/png;base64,AAAA",
    "/tmp/foto",
    "a.webp",
  ])("the photo reference is not a URL, a data: value or a path (%s)", async (photoKey) => {
    expect(await pgErrorCode(() => insertBusiness(f, { photoKey }))).toBe(PG.check);
  });

  it("two businesses do not share the same photo", async () => {
    await insertBusiness(f, { photoKey: "sharedphoto01" });
    expect(await pgErrorCode(() => insertBusiness(f, { photoKey: "sharedphoto01" }))).toBe(
      PG.unique,
    );
  });

  it("a pin needs both coordinates, within range", async () => {
    expect(await pgErrorCode(() => insertBusiness(f, { latitude: 19.8 }))).toBe(PG.check);
    expect(await pgErrorCode(() => insertBusiness(f, { latitude: 91, longitude: 0 }))).toBe(
      PG.check,
    );
  });
});

describe("The card is identified by a short random id (v2)", () => {
  it("new ids have ten characters from the alphabet and differ", () => {
    const ids = Array.from({ length: 200 }, () => newBusinessId());
    for (const id of ids) {
      expect(id).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/);
      expect(isBusinessId(id)).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.for(["K7M2QX9FHD", "k7m2qx9fh", "k7m2-x9fhd", "k7m2qx9fh0", "k7m2qx9fhl"])(
    "the database rejects an id with another shape (%s)",
    async (id) => {
      expect(isBusinessId(id)).toBe(false);
      expect(await pgErrorCode(() => insertBusiness(f, { id }))).toBe(PG.check);
    },
  );
});

describe("The consent record stores which notice version it was given against", () => {
  it("creation with its version leaves the re-acceptance empty", async () => {
    const id = await insertBusiness(f, { consentedToNoticeVersion: "2" });
    expect(await getBusiness(id)).toMatchObject({
      consentedToNoticeVersion: "2",
      reconsentedToNoticeAt: null,
      reconsentedToNoticeVersion: null,
    });
  });

  it("the consent date is required", async () => {
    // The column is NOT NULL; the test writes null on purpose.
    const values = businessValues(f, { consentedToNoticeAt: null as unknown as Date });
    expect(await pgErrorCode(() => db((tx) => tx.insert(businesses).values(values)))).toBe(
      PG.notNull,
    );
  });

  it("the re-acceptance date and version do not travel alone", async () => {
    expect(await pgErrorCode(() => insertBusiness(f, { reconsentedToNoticeAt: new Date() }))).toBe(
      PG.check,
    );
    expect(await pgErrorCode(() => insertBusiness(f, { reconsentedToNoticeVersion: "2" }))).toBe(
      PG.check,
    );
  });

  it("re-acceptance of a newer version keeps the original record", async () => {
    const consentedAt = new Date("2026-01-15T12:00:00Z");
    const id = await insertBusiness(f, {
      consentedToNoticeAt: consentedAt,
      consentedToNoticeVersion: "1",
    });
    await updateBusiness(id, {
      reconsentedToNoticeAt: new Date(),
      reconsentedToNoticeVersion: "2",
    });

    expect(await getBusiness(id)).toMatchObject({
      consentedToNoticeAt: consentedAt,
      consentedToNoticeVersion: "1",
      reconsentedToNoticeVersion: "2",
    });
  });

  it("cards from before versioning keep a null version", async () => {
    const id = await insertBusiness(f, { consentedToNoticeVersion: null });
    expect((await getBusiness(id))?.consentedToNoticeVersion).toBeNull();
  });
});

describe("One card per WhatsApp number within a locality (v2)", () => {
  it("a second card with the same number in the same locality is rejected", async () => {
    const whatsapp = fakePhone();
    await insertBusiness(f, { whatsapp });
    expect(await pgErrorCode(() => insertBusiness(f, { whatsapp }))).toBe(PG.unique);
  });

  it("the same number can have a card in another locality", async () => {
    const whatsapp = fakePhone();
    await insertBusiness(f, { whatsapp });
    const other = await insertBusiness(f, {
      whatsapp,
      localityCode: f.localityB,
      zoneId: f.zoneB,
    });
    expect((await getBusiness(other))?.whatsapp).toBe(whatsapp);
  });

  it.for(["77199912", "77-1999-1234", "+527719991234"])(
    "the number is stored as ten digits (%s is rejected)",
    async (whatsapp) => {
      expect(await pgErrorCode(() => insertBusiness(f, { whatsapp }))).toBe(PG.check);
    },
  );
});

describe("Catalogues of categories, zones and trades with stable slug (v2)", () => {
  it.for(["Plomeria", "plomería", "plomeria-", "plomeria haciendas", "-plomeria"])(
    "a slug that is not lowercase ASCII words with hyphens is rejected (%s)",
    async (slug) => {
      expect(
        await pgErrorCode(() =>
          db((tx) =>
            tx
              .insert(zones)
              .values({ localityCode: f.localityA, type: "Colonia", name: "X", slug }),
          ),
        ),
      ).toBe(PG.check);
    },
  );
});

describe("Trades assignable to the business by the admin", () => {
  it("a newly created business has no trade, and three can be linked", async () => {
    const id = await insertBusiness(f);
    const linked = () =>
      db(async (tx) =>
        (await tx.select().from(businessTrades).where(eq(businessTrades.businessId, id))).map(
          (row) => row.tradeId,
        ),
      );
    expect(await linked()).toEqual([]);

    await db((tx) =>
      tx.insert(businessTrades).values(f.tradeIds.map((tradeId) => ({ businessId: id, tradeId }))),
    );
    const byId = (a: number, b: number) => a - b;
    expect((await linked()).sort(byId)).toEqual([...f.tradeIds].sort(byId));

    const fromTrade = await db((tx) =>
      tx.select().from(businessTrades).where(eq(businessTrades.tradeId, f.tradeIds[0])),
    );
    expect(fromTrade.map((row) => row.businessId)).toContain(id);
  });

  it("the same trade is not linked twice", async () => {
    const id = await insertBusiness(f);
    const link = () =>
      db((tx) => tx.insert(businessTrades).values({ businessId: id, tradeId: f.tradeIds[0] }));
    await link();
    expect(await pgErrorCode(link)).toBe(PG.unique);
  });
});

describe("Review status, origin and lifecycle timestamps", () => {
  it("a newly created business is in review with its registration date", async () => {
    const before = Date.now();
    const id = await insertBusiness(f);
    const row = await getBusiness(id);

    expect(row).toMatchObject({
      status: "in_review",
      origin: "organic",
      publishedAt: null,
      rejectedAt: null,
      rejectionReason: null,
    });
    expect(row?.registeredAt.getTime()).toBeGreaterThanOrEqual(before - 60_000);
  });

  it("the publication date survives unpublishing", async () => {
    const publishedAt = new Date("2026-03-01T15:00:00Z");
    const id = await insertBusiness(f, { status: "published", publishedAt });
    await updateBusiness(id, {
      status: "in_review",
      unpublishedAt: new Date(),
      unpublishReason: "Lo pidió el dueño",
    });
    expect((await getBusiness(id))?.publishedAt).toEqual(publishedAt);
  });

  it("rejection with date and reason, cleared on returning to review", async () => {
    const id = await insertBusiness(f);
    await updateBusiness(id, {
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: "La foto no es del negocio",
    });
    expect((await getBusiness(id))?.rejectionReason).toBe("La foto no es del negocio");

    await updateBusiness(id, { status: "in_review", rejectedAt: null, rejectionReason: null });
    expect(await getBusiness(id)).toMatchObject({ rejectedAt: null, rejectionReason: null });
  });

  it("the rejection trace travels together and only on a rejected business", async () => {
    expect(
      await pgErrorCode(() => insertBusiness(f, { status: "rejected", rejectedAt: new Date() })),
    ).toBe(PG.check);
    expect(
      await pgErrorCode(() =>
        insertBusiness(f, { status: "published", rejectedAt: new Date(), rejectionReason: "x" }),
      ),
    ).toBe(PG.check);
  });

  it.for([
    ["status", { status: "approved" }],
    ["origin", { origin: "imported" }],
  ] as const)("a value outside the set is rejected (%s)", async ([, values]) => {
    // The value is outside the declared set on purpose.
    expect(await pgErrorCode(() => insertBusiness(f, values as never))).toBe(PG.check);
  });
});

describe("The business stores the trace of its unpublishing", () => {
  it("is born null and needs date and reason together", async () => {
    const id = await insertBusiness(f, { status: "published", publishedAt: new Date() });
    expect(await getBusiness(id)).toMatchObject({ unpublishedAt: null, unpublishReason: null });
    expect(
      await pgErrorCode(() =>
        updateBusiness(id, { status: "in_review", unpublishedAt: new Date() }),
      ),
    ).toBe(PG.check);
  });

  it("survives the other transitions", async () => {
    const id = await insertBusiness(f, {
      unpublishedAt: new Date("2026-05-01T10:00:00Z"),
      unpublishReason: "Cerró temporalmente",
    });
    await updateBusiness(id, {
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: "Datos incompletos",
    });
    expect((await getBusiness(id))?.unpublishReason).toBe("Cerró temporalmente");
  });
});

describe("A business and its pending edit store the postal code the owner typed (v2)", () => {
  it("is born null, and only five digits are accepted, on the card and on its edit", async () => {
    const id = await insertBusiness(f);
    expect((await getBusiness(id))?.postalCode).toBeNull();
    await updateBusiness(id, { postalCode: "43815" });
    expect((await getBusiness(id))?.postalCode).toBe("43815");
    for (const postalCode of ["4381", "438155", "43 815", "4381a", ""]) {
      expect(await pgErrorCode(() => updateBusiness(id, { postalCode })), postalCode).toBe(
        PG.check,
      );
      expect(
        await pgErrorCode(() =>
          insertEdit(id, { postalCode, status: "superseded", resolvedAt: new Date() }),
        ),
        postalCode,
      ).toBe(PG.check);
    }
    await insertEdit(id, { postalCode: "43899" });
    const [edit] = await db((tx) =>
      tx.select().from(pendingEdits).where(eq(pendingEdits.businessId, id)),
    );
    expect(edit?.postalCode).toBe("43899");
    // An edit saved before the form asked for it has none.
    await insertEdit(id, { status: "superseded", resolvedAt: new Date() });
    expect(
      await db((tx) =>
        tx.$count(
          pendingEdits,
          and(eq(pendingEdits.businessId, id), sql`${pendingEdits.postalCode} IS NULL`),
        ),
      ),
    ).toBe(1);
  });
});

describe("Each zone has its postal code, and Tizayuca's come from the SEPOMEX postal catalogue (v2)", () => {
  it("a zone without one is allowed, and only five digits are accepted", async () => {
    const [row] = await db((tx) =>
      tx
        .insert(zones)
        .values({
          localityCode: f.localityA,
          type: "Colonia",
          name: "Sin Código",
          slug: "sin-codigo",
        })
        .returning({ id: zones.id, postalCode: zones.postalCode }),
    );
    expect(row?.postalCode).toBeNull();
    for (const postalCode of ["4381", "438155", "C.P. 43815", ""]) {
      expect(
        await pgErrorCode(() =>
          db((tx) => tx.update(zones).set({ postalCode }).where(eq(zones.id, row!.id))),
        ),
        postalCode,
      ).toBe(PG.check);
    }
    await db((tx) => tx.update(zones).set({ postalCode: "43815" }).where(eq(zones.id, row!.id)));
  });
});

describe('The zone allows "Otra" with free text pending normalization', () => {
  it("registration with zone Otra, then normalization by the admin", async () => {
    const id = await insertBusiness(f, { zoneId: null, zoneOther: "Rinconada del Venado" });
    expect(await getBusiness(id)).toMatchObject({
      zoneId: null,
      zoneOther: "Rinconada del Venado",
    });

    await updateBusiness(id, { zoneId: f.zoneA });
    expect((await getBusiness(id))?.zoneId).toBe(f.zoneA);
  });

  it("a business needs a catalogue zone or free text", async () => {
    expect(await pgErrorCode(() => insertBusiness(f, { zoneId: null, zoneOther: null }))).toBe(
      PG.check,
    );
  });
});

describe("The `Report` model stores a resident's notice about a card, with no data about the sender", () => {
  const insertReport = (businessId: string, values: Partial<typeof reports.$inferInsert> = {}) =>
    db((tx) =>
      tx
        .insert(reports)
        .values({ businessId, localityCode: f.localityA, reason: "closed", ...values })
        .returning(),
    );

  it("a newly created report is pending, with its date and no comment", async () => {
    const id = await insertBusiness(f, { status: "published", publishedAt: new Date() });
    const [row] = await insertReport(id);
    expect(row).toMatchObject({
      reason: "closed",
      comment: null,
      status: "pending",
      attendedAt: null,
    });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("a comment is kept exactly as sent", async () => {
    const id = await insertBusiness(f);
    const comment = "Ya no está en esa dirección, se cambió a la otra cuadra.";
    const [row] = await insertReport(id, { comment });
    expect(row?.comment).toBe(comment);
  });

  it.for([
    ["reason", { reason: "spam" }],
    ["status", { status: "closed" }],
  ] as const)("a value outside the set is rejected (%s)", async ([, values]) => {
    const id = await insertBusiness(f);
    // The value is outside the declared set on purpose.
    expect(await pgErrorCode(() => insertReport(id, values as never))).toBe(PG.check);
  });

  it("attending needs the attention date", async () => {
    const id = await insertBusiness(f);
    expect(await pgErrorCode(() => insertReport(id, { status: "attended" }))).toBe(PG.check);
    const [row] = await insertReport(id, { status: "attended", attendedAt: new Date() });
    expect(row?.status).toBe("attended");
  });

  it("counts and lists the pending reports of a business, oldest first", async () => {
    const id = await insertBusiness(f);
    for (const minutes of [30, 20, 10]) {
      await insertReport(id, {
        reason: "incorrect_data",
        createdAt: new Date(Date.now() - minutes * 60_000),
      });
    }
    await insertReport(id, { status: "attended", attendedAt: new Date() });

    const pending = await db((tx) =>
      tx
        .select()
        .from(reports)
        .where(and(eq(reports.businessId, id), eq(reports.status, "pending")))
        .orderBy(asc(reports.createdAt)),
    );
    expect(pending).toHaveLength(3);
    expect(pending.map((r) => r.createdAt.getTime())).toEqual(
      pending.map((r) => r.createdAt.getTime()).sort((a, b) => a - b),
    );
  });

  it("nothing about the reporter in the schema", async () => {
    const columns = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reports' ORDER BY ordinal_position",
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "id",
      "business_id",
      "locality_code",
      "reason",
      "comment",
      "status",
      "created_at",
      "attended_at",
    ]);
  });
});

describe("Permanent deletion of a business (ARCO operation)", () => {
  it("deleting a business takes its trades, reports and edits with it", async () => {
    const id = await insertBusiness(f);
    await db(async (tx) => {
      await tx.insert(businessTrades).values({ businessId: id, tradeId: f.tradeIds[1] });
      await tx
        .insert(reports)
        .values({ businessId: id, localityCode: f.localityA, reason: "not_real" });
    });
    await insertEdit(id);
    await insertEdit(id, { status: "applied", resolvedAt: new Date() });

    await db((tx) => tx.delete(businesses).where(eq(businesses.id, id)));

    const remaining = await db(async (tx) => ({
      trades: await tx.$count(businessTrades, eq(businessTrades.businessId, id)),
      reports: await tx.$count(reports, eq(reports.businessId, id)),
      edits: await tx.$count(pendingEdits, eq(pendingEdits.businessId, id)),
    }));
    expect(remaining).toEqual({ trades: 0, reports: 0, edits: 0 });
  });

  it("deleting an identifier that no longer exists is not an error", async () => {
    const id = await insertBusiness(f);
    const remove = () => db((tx) => tx.delete(businesses).where(eq(businesses.id, id)));
    await remove();
    await expect(remove()).resolves.toBeDefined();
  });

  it("every relation that points to the business is cascading", async () => {
    const relations = await query<{ table_name: string; on_delete: string }>(`
      SELECT conrelid::regclass::text AS table_name, confdeltype AS on_delete
      FROM pg_constraint
      WHERE contype = 'f' AND confrelid = 'public.businesses'::regclass
      ORDER BY 1`);

    expect(relations.map((r) => r.table_name)).toEqual([
      "business_trades",
      "pending_edits",
      "reports",
    ]);
    for (const relation of relations) expect(relation.on_delete, relation.table_name).toBe("c");
  });
});

describe("The migration tree applies in full and its constraints survive", () => {
  it("all the tables of the model are there", async () => {
    const tables = await query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    expect(tables.map((t) => t.table_name)).toEqual([
      "admin_audit_log",
      "business_trades",
      "businesses",
      "categories",
      "daily_admin_email_state",
      "localities",
      "municipalities",
      "orphan_photo_sweep_state",
      "pending_edits",
      "permissions",
      "photo_cache_purges",
      "reports",
      "role_assignments",
      "role_permissions",
      "roles",
      "site_settings",
      "states",
      "trades",
      "users",
      "zones",
    ]);
  });

  it("the CHECK constraints of the closed sets are in force", async () => {
    const checks = await query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace",
    );
    expect(checks.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        "businesses_status_check",
        "businesses_origin_check",
        "pending_edits_status_check",
        "reports_reason_check",
        "reports_status_check",
        "admin_audit_log_action_check",
        "admin_audit_log_previous_status_check",
        "businesses_pin_check",
        "localities_coordinates_check",
        "zones_postal_code_check",
        "businesses_postal_code_check",
        "pending_edits_postal_code_check",
      ]),
    );
  });
});

describe("The business stores its management link as a fingerprint, never in plain", () => {
  const fingerprint = (seed: string) => seed.repeat(64).slice(0, 64);

  it("is null on a new business and stored with its date", async () => {
    const id = await insertBusiness(f);
    expect(await getBusiness(id)).toMatchObject({
      managementTokenHash: null,
      managementTokenCreatedAt: null,
    });
    await updateBusiness(id, {
      managementTokenHash: fingerprint("a1"),
      managementTokenCreatedAt: new Date(),
    });
    expect((await getBusiness(id))?.managementTokenHash).toBe(fingerprint("a1"));
  });

  it("two businesses cannot share a fingerprint", async () => {
    const hash = fingerprint("b2");
    await insertBusiness(f, { managementTokenHash: hash, managementTokenCreatedAt: new Date() });
    expect(
      await pgErrorCode(() =>
        insertBusiness(f, { managementTokenHash: hash, managementTokenCreatedAt: new Date() }),
      ),
    ).toBe(PG.unique);
  });

  it("only a SHA-256 fingerprint with its date is accepted", async () => {
    expect(
      await pgErrorCode(() =>
        insertBusiness(f, {
          managementTokenHash: "token-en-claro",
          managementTokenCreatedAt: new Date(),
        }),
      ),
    ).toBe(PG.check);
    expect(
      await pgErrorCode(() => insertBusiness(f, { managementTokenHash: fingerprint("c3") })),
    ).toBe(PG.check);
  });
});

describe("A pending edit stores the full content of what is to be published", () => {
  it("saving an edit does not touch the business", async () => {
    const id = await insertBusiness(f, { status: "published", publishedAt: new Date() });
    const before = await getBusiness(id);
    await insertEdit(id, { name: "Plomería Renovada", openingHours: "Todos los días de 8 a 8" });
    expect(await getBusiness(id)).toEqual(before);
  });

  it("only one pending edit per business", async () => {
    const id = await insertBusiness(f);
    await insertEdit(id);
    expect(await pgErrorCode(() => insertEdit(id))).toBe(PG.unique);
  });

  it("a resolved or superseded edit stops blocking", async () => {
    const id = await insertBusiness(f);
    await insertEdit(id, { status: "superseded", resolvedAt: new Date() });
    await insertEdit(id, {
      status: "discarded",
      resolvedAt: new Date(),
      discardReason: "Sin cambios",
    });
    await insertEdit(id);
    const pending = await db((tx) =>
      tx.$count(
        pendingEdits,
        and(eq(pendingEdits.businessId, id), eq(pendingEdits.status, "pending")),
      ),
    );
    expect(pending).toBe(1);
  });

  it("a status outside the set, or a resolution without its date, is rejected", async () => {
    const id = await insertBusiness(f);
    // The value is outside the declared set on purpose.
    expect(await pgErrorCode(() => insertEdit(id, { status: "approved" as never }))).toBe(PG.check);
    expect(await pgErrorCode(() => insertEdit(id, { status: "applied" }))).toBe(PG.check);
  });

  it("the edit cannot carry fields that are not editable", async () => {
    const columns = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'pending_edits'",
    );
    const names = columns.map((c) => c.column_name);
    for (const field of [
      "origin",
      "published_at",
      "registered_at",
      "consented_to_notice_at",
      "consented_to_notice_version",
      "management_token_hash",
      "photo_key",
    ]) {
      expect(names).not.toContain(field);
    }
    // `status` here is the edit's own review status, not the card's.
    expect(names).toContain("status");
  });
});

describe("The locality is a first-class record keyed by the INEGI municipality code (v2)", () => {
  it("a locality takes its name, slug and state from its INEGI entry", async () => {
    const [row] = await db((tx) =>
      tx
        .select({ name: municipalities.name, slug: municipalities.slug, state: states.slug })
        .from(localities)
        .innerJoin(municipalities, eq(municipalities.code, localities.code))
        .innerJoin(states, eq(states.code, municipalities.stateCode))
        .where(eq(localities.code, f.localityA)),
    );
    expect(row).toEqual({
      name: "Pueblo Uno",
      slug: "pueblo-uno",
      state: `estado-de-prueba-${STATE}`,
    });
  });

  it("a locality without its required data, or without a municipality, is rejected", async () => {
    const insert = (values: Partial<typeof localities.$inferInsert>) =>
      db((tx) =>
        tx.insert(localities).values({
          code: `${STATE}003`,
          timeZone: "America/Mexico_City",
          contactWhatsapp: "7719990003",
          ...values,
        }),
      );
    expect(await pgErrorCode(() => insert({}))).toBe(PG.foreignKey);
    // The column is NOT NULL; the test writes null on purpose.
    expect(await pgErrorCode(() => insert({ code: f.localityB, timeZone: null as never }))).toBe(
      PG.notNull,
    );
    expect(await pgErrorCode(() => insert({ code: f.localityB, contactWhatsapp: "123" }))).toBe(
      PG.check,
    );
  });

  it("the coordinates of its seat are optional, both or neither, within range", async () => {
    const setCoordinates = (values: { latitude?: number | null; longitude?: number | null }) =>
      pgErrorCode(() =>
        db((tx) => tx.update(localities).set(values).where(eq(localities.code, f.localityB))),
      );
    expect(await setCoordinates({ latitude: 19.8 })).toBe(PG.check);
    expect(await setCoordinates({ latitude: 91, longitude: 0 })).toBe(PG.check);
    expect(await setCoordinates({ latitude: 0, longitude: -180.5 })).toBe(PG.check);
    expect(await setCoordinates({ latitude: 19.8, longitude: -98.9 })).toBeUndefined();
    expect(await setCoordinates({ latitude: null, longitude: null })).toBeUndefined();
  });

  it("a locality is served only with a contact WhatsApp", async () => {
    expect(
      (await db((tx) => tx.select().from(localities).where(eq(localities.code, f.localityB))))[0],
    ).toMatchObject({
      active: false,
    });
    expect(
      await pgErrorCode(() =>
        db((tx) =>
          tx
            .update(localities)
            .set({ contactWhatsapp: null, active: true })
            .where(eq(localities.code, f.localityB)),
        ),
      ),
    ).toBe(PG.check);
    await db((tx) =>
      tx.update(localities).set({ contactWhatsapp: null }).where(eq(localities.code, f.localityB)),
    );
    await db((tx) =>
      tx
        .update(localities)
        .set({ contactWhatsapp: "7719990002" })
        .where(eq(localities.code, f.localityB)),
    );
  });

  it("one record per municipality", async () => {
    expect(
      await pgErrorCode(() =>
        db((tx) =>
          tx.insert(localities).values({
            code: f.localityA,
            timeZone: "America/Mexico_City",
            contactWhatsapp: "7719990009",
          }),
        ),
      ),
    ).toBe(PG.unique);
  });
});

describe("The database holds only the reference data of the localities it serves (v2)", () => {
  it("a municipality code starts with its state code", async () => {
    expect(
      await pgErrorCode(() =>
        db((tx) =>
          tx
            .insert(municipalities)
            .values({ code: "97001", stateCode: STATE, name: "Otro", slug: "otro" }),
        ),
      ),
    ).toBe(PG.check);
  });

  it("a municipality slug is unique within its state", async () => {
    expect(
      await pgErrorCode(() =>
        db((tx) =>
          tx.insert(municipalities).values({
            code: `${STATE}009`,
            stateCode: STATE,
            name: "Pueblo Uno",
            slug: "pueblo-uno",
          }),
        ),
      ),
    ).toBe(PG.unique);
  });
});

describe("Businesses, pending edits, reports and the audit log reference their locality, and slugs are unique per locality (v2)", () => {
  it("a business without a locality is rejected", async () => {
    // The column is NOT NULL; the test writes null on purpose.
    const values = businessValues(f, { localityCode: null as never });
    expect(await pgErrorCode(() => db((tx) => tx.insert(businesses).values(values)))).toBe(
      PG.notNull,
    );
  });

  it("a zone from another locality is rejected, on the business and on its edit", async () => {
    expect(await pgErrorCode(() => insertBusiness(f, { zoneId: f.zoneB }))).toBe(PG.foreignKey);
    const id = await insertBusiness(f);
    expect(await pgErrorCode(() => insertEdit(id, { zoneId: f.zoneB }))).toBe(PG.foreignKey);
  });

  it("an edit or a report of another locality than its business is rejected", async () => {
    const id = await insertBusiness(f);
    expect(
      await pgErrorCode(() => insertEdit(id, { localityCode: f.localityB, zoneId: f.zoneB })),
    ).toBe(PG.foreignKey);
    expect(
      await pgErrorCode(() =>
        db((tx) =>
          tx
            .insert(reports)
            .values({ businessId: id, localityCode: f.localityB, reason: "closed" }),
        ),
      ),
    ).toBe(PG.foreignKey);
  });

  it("the same zone slug in two localities, but not twice in one", async () => {
    const [count_] = await db((tx) =>
      tx
        .select({ n: count() })
        .from(zones)
        .where(sql`${zones.slug} = 'centro' AND ${zones.localityCode} LIKE ${`${STATE}%`}`),
    );
    expect(count_?.n).toBe(2);
    expect(
      await pgErrorCode(() =>
        db((tx) =>
          tx.insert(zones).values({
            localityCode: f.localityA,
            type: "Colonia",
            name: "Centro 2",
            slug: "centro",
          }),
        ),
      ),
    ).toBe(PG.unique);
  });
});

describe("The audit log records the destructive actions of the admin (v2)", () => {
  const insertEntry = (
    businessId: string,
    values: Partial<typeof adminAuditLog.$inferInsert> = {},
  ) =>
    db((tx) =>
      tx
        .insert(adminAuditLog)
        .values({
          localityCode: f.localityA,
          businessId,
          actor: "admin@enmirumbo.test",
          action: "reject",
          previousStatus: "in_review",
          ...values,
        })
        .returning(),
    );

  it("an entry records who, when, where, which card, the action and the previous status", async () => {
    const id = await insertBusiness(f);
    const [entry] = await insertEntry(id);
    expect(entry).toMatchObject({
      localityCode: f.localityA,
      businessId: id,
      actor: "admin@enmirumbo.test",
      action: "reject",
      previousStatus: "in_review",
    });
    expect(entry?.occurredAt).toBeInstanceOf(Date);
  });

  it("the entry of a permanent deletion survives the card and holds no personal data", async () => {
    const id = await insertBusiness(f, { status: "published", publishedAt: new Date() });
    await insertEntry(id, { action: "delete", previousStatus: "published" });
    await db((tx) => tx.delete(businesses).where(eq(businesses.id, id)));

    const entries = await db((tx) =>
      tx.select().from(adminAuditLog).where(eq(adminAuditLog.businessId, id)),
    );
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual(
      [
        "action",
        "actor",
        "businessId",
        "id",
        "localityCode",
        "occurredAt",
        "previousStatus",
      ].sort(),
    );
  });

  it("a purge is recorded with the scheduled job as the actor", async () => {
    const [entry] = await insertEntry(newBusinessId(), {
      actor: SCHEDULED_JOB_ACTOR,
      action: "purge",
      previousStatus: "rejected",
    });
    expect(entry?.actor).toBe("scheduled-job");
  });

  it.for([
    ["action", { action: "approve" }],
    ["previous status", { previousStatus: "deleted" }],
    ["empty actor", { actor: " " }],
  ] as const)("a value outside the rules is rejected (%s)", async ([, values]) => {
    // The value is outside the declared set on purpose.
    expect(await pgErrorCode(() => insertEntry(newBusinessId(), values as never))).toBe(PG.check);
  });
});
