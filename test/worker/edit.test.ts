// Scenarios of docs/specs/business-registration.md for the edit mode of the
// management link, below the page: "The management link opens the card in
// edit mode with the same prefilled form", "A token that is not exactly the
// current one opens nothing and gives nothing away" (the submission's side;
// the token itself is test/worker/management-link.test.ts), "Sending the edit
// does not touch the public card: it creates a pending edit", "The edit goes
// through the same validations as the registration and cannot set what is
// not its to set", "Sending changes when others are already waiting replaces
// the previous ones", "The registration and edit forms are protected by
// quotas, honeypot and Turnstile (v2)" (the edit), "The edit's honeypot and
// per-IP quota are those of the public forms (v2)", "The edit of a card may
// change its photo, which reaches the card only when the edit is applied
// (v2)" and "The edit mode of a locality lives under it, and lands on its
// confirmation (v2)"; of docs/specs/data-model.md, "A pending edit stores the
// full content of what is to be published", "A pending edit replaced by a
// newer one is kept as superseded (v2)" and "A pending edit may change the
// photo of its card (v2)"; and of docs/specs/public-directory.md, "An edit
// awaiting review does not show through on any public surface" (the search).
// The core is src/core/edit/, the action's side src/lib/edit.ts. The form
// is rendered in test/astro/edit.test.ts and run end to end in
// test/e2e/edit.spec.ts.
//
// The businesses belong to the fixture localities of this file, which
// `cleanup` removes, with their edits; every object this file writes to the
// local media bucket is removed after it. Every address is from the range
// reserved for documentation 203.0.113.0/24, and every number follows
// 771999xxxx (7719997xxx).
import { env } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { ActionError } from "astro:actions";
import { RESERVED_SEGMENTS } from "../../src/core/catalogue/root-urls.ts";
import type { Db } from "../../src/core/db/client.ts";
import {
  businesses,
  businessTrades,
  pendingEdits,
  siteSettings,
  zones,
} from "../../src/core/db/schema/index.ts";
import { editForm } from "../../src/core/edit/card.ts";
import {
  EDIT_SEGMENT,
  EDIT_THANKS_SEGMENT,
  editPath,
  editThanksPath,
} from "../../src/core/edit/paths.ts";
import { savePendingEdit } from "../../src/core/edit/save.ts";
import {
  cardDraft,
  EDIT_GENERAL_ERROR_MESSAGES,
  EDIT_NO_JAVASCRIPT_MESSAGE,
  EDIT_PHOTO_KEPT_NOTE,
  EDIT_THANK_YOU_MESSAGE,
  editErrorMessage,
  validateEdit,
  waitingEditDraft,
} from "../../src/core/edit/submission.ts";
import { submitEdit, type SubmitEditDeps } from "../../src/core/edit/submit.ts";
import { HONEYPOT_FIELD } from "../../src/core/forms/honeypot.ts";
import { issueManagementLink, resolveManagementLink } from "../../src/core/management-link/link.ts";
import { newManagementToken, tokenFingerprint } from "../../src/core/management-link/token.ts";
import {
  isPhotoKey,
  newPhotoKey as generatePhotoKey,
  photoObjectKeys,
} from "../../src/core/photos/photo.ts";
import { NO_PHOTO_CACHE } from "../../src/core/photos/cache.ts";
import { type PhotoServices, PhotoSlots, storePhoto } from "../../src/core/photos/upload.ts";
import { QUOTAS } from "../../src/core/quota/quotas.ts";
import {
  type RegistrationCatalogue,
  registrationCatalogue,
} from "../../src/core/registration/catalogue.ts";
import {
  EMPTY_REGISTRATION_DRAFT,
  errorMessage,
  REGISTRATION_FIELDS as F,
} from "../../src/core/registration/submission.ts";
import { searchPublishedBusinesses } from "../../src/core/search/query.ts";
import type { VerifyTurnstile } from "../../src/core/turnstile/check.ts";
import {
  TURNSTILE_ACTIONS,
  TURNSTILE_DUMMY_TOKEN,
  TURNSTILE_RESPONSE_FIELD,
} from "../../src/core/turnstile/keys.ts";
import { EDIT_ROUTE, editActionError, editTarget } from "../../src/lib/edit.ts";
import { CLIENT_IP_HEADER, takeQuota } from "../../src/lib/quota/quota.ts";
import { registrationPageFailure } from "../../src/lib/registration.ts";
import { LOCALITY_DISALLOW } from "../../src/lib/robots.ts";
import { turnstileVerifier } from "../../src/lib/turnstile.ts";
import { cleanup, createFixture, db, type Fixture, insertBusiness } from "./fixtures.ts";
import { BLUE, convert, drawWebp, GREEN, photoFile } from "./images.ts";

const STATE = "82";
let f: Fixture;
/** The fixture locality A as the action passes it: its code and its name. */
let localityA: { code: string; name: string };
/** The fixture category, by slug, and its id. */
let category: { id: number; slug: string };
/** The hidden zone "Oculta" of locality A. */
let hiddenZone: number;
/** The visible zone "Ángeles" of locality A. */
let angeles: number;

beforeAll(async () => {
  f = await createFixture(STATE);
  localityA = { code: f.localityA, name: "Pueblo Uno" };
  const [hidden, shown] = await db((tx) =>
    tx
      .insert(zones)
      .values([
        {
          localityCode: f.localityA,
          type: "Colonia",
          name: "Oculta",
          slug: "oculta",
          visible: false,
        },
        { localityCode: f.localityA, type: "Colonia", name: "Ángeles", slug: "angeles" },
      ])
      .returning({ id: zones.id }),
  );
  hiddenZone = hidden?.id ?? 0;
  angeles = shown?.id ?? 0;
  const catalogue = await db((tx) => registrationCatalogue(tx, localityA));
  const own = catalogue.categories.find(({ id }) => id === f.categoryId);
  if (!own) throw new Error("the fixture category is not in the catalogue");
  category = own;
});

/** Every photo key this file stored, whose objects are removed afterwards. */
const storedKeys = new Set<string>();

afterAll(async () => {
  await cleanup(STATE);
  await env.MEDIA.delete([...storedKeys].flatMap(photoObjectKeys));
});

afterEach(() => {
  vi.restoreAllMocks();
});

let phone = 0;
/** A fictitious number of this file, 7719997xxx. */
const newPhone = () => `771999${7000 + ++phone}`;

let lastAddress = 10;
/** The address of one test, from the range reserved for documentation. */
const newAddress = () => `203.0.113.${++lastAddress}`;

/** A published card of locality A (or as `overrides` say) with a management link. */
async function cardWithLink(overrides: Parameters<typeof insertBusiness>[1] = {}) {
  const id = await insertBusiness(f, {
    status: "published",
    publishedAt: new Date("2026-09-01T12:00:00Z"),
    whatsapp: newPhone(),
    ...overrides,
  });
  const token = await db((tx) => issueManagementLink(tx, id));
  if (token === null) throw new Error("the card got no link");
  return { id, token };
}

/** A form as a browser sends it; a list sends the field once per value. */
function form(fields: Record<string, string | Blob | (string | Blob)[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  }
  return data;
}

/**
 * The fields of a valid edit, with the trap field empty and the token the
 * local Worker's Turnstile accepts. No consent and no notice version: the
 * edit asks for neither.
 */
function edited(
  overrides: Record<string, string | Blob | (string | Blob)[]> = {},
): Record<string, string | Blob | (string | Blob)[]> {
  return {
    [HONEYPOT_FIELD]: "",
    [TURNSTILE_RESPONSE_FIELD]: TURNSTILE_DUMMY_TOKEN,
    [F.name]: "Plomería de Prueba Renovada",
    [F.category]: category.slug,
    [F.whatsapp]: newPhone(),
    [F.zone]: "Centro",
    ...overrides,
  };
}

/** The local Worker's Turnstile check, which emulates the always-pass test secret. */
const local = turnstileVerifier(env);

/** The local media bucket, noting every photo key written, so it is removed afterwards. */
const bucket: PhotoServices["bucket"] = {
  put: ((key: string, value: Uint8Array, options: R2PutOptions) => {
    const photoKey = key.split("/")[1];
    if (photoKey !== undefined) storedKeys.add(photoKey);
    return env.MEDIA.put(key, value, options);
  }) as R2Bucket["put"],
  delete: (keys) => env.MEDIA.delete(keys),
  cache: NO_PHOTO_CACHE,
};

/**
 * What the action gives the core: a fresh connection, the edit quota of
 * `address`, the Turnstile check and what the photo needs, counting what is
 * asked of the quota and of Turnstile.
 */
function deps(
  options: {
    address?: string | null;
    verify?: VerifyTurnstile;
    useDb?: SubmitEditDeps["useDb"];
    photos?: PhotoServices;
  } = {},
) {
  const address = options.address === undefined ? newAddress() : options.address;
  const headers = new Headers(address === null ? {} : { [CLIENT_IP_HEADER]: address });
  const calls = { quota: 0, turnstile: [] as string[], images: 0 };
  const verify = options.verify ?? local;
  const images: PhotoServices["images"] = {
    info: (stream, infoOptions) => {
      calls.images += 1;
      return env.IMAGES.info(stream, infoOptions);
    },
    input: (stream, inputOptions) => {
      calls.images += 1;
      return env.IMAGES.input(stream, inputOptions);
    },
  };
  const using: SubmitEditDeps = {
    useDb: options.useDb ?? db,
    takeQuota: () => {
      calls.quota += 1;
      return takeQuota(env, headers, "edit");
    },
    verifyTurnstile: (token, action) => {
      calls.turnstile.push(action);
      return verify(token, action);
    },
    photos: options.photos ?? { images, bucket },
  };
  return { calls, using };
}

const submit = (data: FormData, token: string, using: SubmitEditDeps, locality = localityA) =>
  submitEdit(data, { locality, token }, using);

async function cardRow(id: string) {
  const [row] = await db((tx) => tx.select().from(businesses).where(eq(businesses.id, id)));
  return row;
}

/** The edits of the card `id`, oldest first. */
async function editsOf(id: string) {
  return db((tx) =>
    tx
      .select()
      .from(pendingEdits)
      .where(eq(pendingEdits.businessId, id))
      .orderBy(asc(pendingEdits.id)),
  );
}

/** The object keys stored under `photoKey`. */
async function objectsOf(photoKey: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix: `photos/${photoKey}/` });
  return listed.objects.map(({ key }) => key).toSorted();
}

// A photo, drawn once.
let jpeg: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
  jpeg = await convert(
    drawWebp(1200, 900, BLUE, [{ x: 0, y: 0, width: 300, height: 200, rgb: GREEN }]),
    "image/jpeg",
  );
});

/** A photo stored as the registration stores one, for a card that already has one. */
async function storedPhoto(): Promise<string> {
  const outcome = await storePhoto(photoFile(jpeg), { images: env.IMAGES, bucket });
  if (outcome.kind !== "stored") throw new Error(`not stored: ${outcome.error}`);
  return outcome.key;
}

describe("The edit mode of a locality lives under it, and lands on its confirmation (v2)", () => {
  const tizayuca = { slug: "tizayuca", state: { slug: "hidalgo" } };

  it("the link and the confirmation are under the locality, and the confirmation carries no token", () => {
    const token = newManagementToken();
    expect(editPath(tizayuca, token)).toBe(`/hidalgo/tizayuca/editar/${token}`);
    expect(editThanksPath(tizayuca)).toBe("/hidalgo/tizayuca/editar/gracias");
    expect(EDIT_SEGMENT).toBe("editar");
    expect(EDIT_THANKS_SEGMENT).toBe("gracias");
    expect(RESERVED_SEGMENTS).toContain("editar");
    // robots.txt never names the edit mode (base-layout).
    expect(LOCALITY_DISALLOW.flat()).not.toContain("editar");
  });

  // Scenario: the action reached from elsewhere
  it("the action edits only from the edit page, with the locality and the token of its address", () => {
    const locality = {
      code: f.localityA,
      name: "Pueblo Uno",
      slug: "pueblo-uno",
      state: { code: STATE, name: "Estado", slug: "estado" },
      timeZone: "America/Mexico_City",
      contactWhatsapp: "7719990001",
      othersActive: false,
      seat: null,
    };
    const token = newManagementToken();
    expect(
      editTarget({ routePattern: EDIT_ROUTE, params: { token }, locals: { locality } }),
    ).toEqual({ locality, token });
    for (const routePattern of [
      "/[state]/[municipality]/editar/gracias",
      "/[state]/[municipality]/registro",
      "/[state]/[municipality]",
      "/_actions/[...path]",
    ]) {
      expect(
        editTarget({ routePattern, params: { token }, locals: { locality } }),
        routePattern,
      ).toBeNull();
    }
    expect(editTarget({ routePattern: EDIT_ROUTE, params: { token }, locals: {} })).toBeNull();
    expect(editTarget({ routePattern: EDIT_ROUTE, params: {}, locals: { locality } })).toBeNull();
  });

  it("each outcome is its answer, the registration's statuses, and 404 when the link opens nothing", () => {
    expect(editActionError({ kind: "received" })).toBeNull();
    expect(editActionError({ kind: "not-found" })?.code).toBe("NOT_FOUND");
    const taken = editActionError({ kind: "invalid", errors: { whatsapp: "taken" } });
    expect(taken?.code).toBe("BAD_REQUEST");
    expect(taken?.message).toBe("whatsapp:taken");
    expect(registrationPageFailure(taken as ActionError)).toEqual({
      errors: { whatsapp: "taken" },
      general: null,
      keepsDraft: true,
    });
    expect(editActionError({ kind: "turnstile" })?.code).toBe("FORBIDDEN");
    expect(editActionError({ kind: "quota" })?.code).toBe("TOO_MANY_REQUESTS");
    expect(editActionError({ kind: "server" })?.code).toBe("INTERNAL_SERVER_ERROR");
    expect(editActionError({ kind: "invalid", errors: { photo: "busy" } })?.code).toBe(
      "SERVICE_UNAVAILABLE",
    );
    expect(editActionError({ kind: "invalid", errors: { photo: "failed" } })?.code).toBe(
      "BAD_GATEWAY",
    );
  });

  it("the edit's own literals", () => {
    expect(editErrorMessage("photo", "failed")).toBe(
      "No pudimos procesar tu foto. Intenta con otra o envía tus cambios sin cambiar la foto.",
    );
    expect(errorMessage("photo", "failed")).toBe(
      "No pudimos procesar tu foto. Intenta con otra o envía tu registro sin foto.",
    );
    for (const [field, code] of [
      ["photo", "too-large"],
      ["photo", "unreadable"],
      ["photo", "busy"],
      ["whatsapp", "invalid"],
      ["whatsapp", "taken"],
      ["name", "required"],
    ] as const) {
      expect(editErrorMessage(field, code)).toBe(errorMessage(field, code));
    }
    expect(EDIT_PHOTO_KEPT_NOTE).toBe(
      "La foto nueva que nos mandaste se queda, a menos que elijas otra.",
    );
    expect(EDIT_THANK_YOU_MESSAGE).toBe(
      "¡Gracias! Ya recibimos tus cambios. Los revisamos y en cuanto los aprobemos tu ficha se actualiza. Mientras tanto sigue publicada como está.",
    );
    expect(EDIT_GENERAL_ERROR_MESSAGES).toEqual({
      turnstile: "No pudimos comprobar que eres una persona. Vuelve a intentarlo.",
      quota: "Ya recibimos varios cambios desde aquí. Espera un rato y vuelve a intentar.",
      server: "No pudimos guardar tus cambios. Vuelve a intentarlo en un momento.",
    });
    expect(EDIT_NO_JAVASCRIPT_MESSAGE).toBe(
      "Para editar tu ficha, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona.",
    );
  });
});

describe("The management link opens the card in edit mode with the same prefilled form", () => {
  // Scenario: the owner opens their link
  it("the form is prefilled with the card as it is published, and reads nothing else of it", async () => {
    const { id } = await cardWithLink({
      name: "Estética Lupita",
      zoneId: angeles,
      whatYouOffer: "cortes y tintes",
      homeDelivery: true,
      landline: "(775) 123-45-67",
      address: "A un lado de la primaria",
      openingHours: "Lunes a sábado de 9 a 7",
      facebookUrl: "https://facebook.com/esteticalupita",
    });
    const view = await db((tx) => editForm(tx, localityA, id));
    expect(Object.keys(view?.card ?? {}).toSorted()).toEqual(
      [
        "name",
        "categoryId",
        "whatsapp",
        "zoneId",
        "zoneOther",
        "whatYouOffer",
        "homeDelivery",
        "landline",
        "address",
        "openingHours",
        "facebookUrl",
      ].toSorted(),
    );
    expect(view?.waiting).toBeNull();
    const card = await cardRow(id);
    expect(
      cardDraft(view?.card ?? (undefined as never), view?.catalogue as RegistrationCatalogue),
    ).toEqual({
      ...EMPTY_REGISTRATION_DRAFT,
      name: "Estética Lupita",
      category: category.slug,
      whatsapp: card?.whatsapp,
      zone: "Ángeles",
      whatYouOffer: "cortes y tintes",
      homeDelivery: true,
      landline: "(775) 123-45-67",
      address: "A un lado de la primaria",
      openingHours: "Lunes a sábado de 9 a 7",
      facebookUrl: "https://facebook.com/esteticalupita",
    });
  });

  // Scenario: business with an unnormalized zone "Otra"
  it('a zone "Otra" is prefilled with its free text, and sent as it is keeps it, inventing no zone', async () => {
    const { id, token } = await cardWithLink({ zoneId: null, zoneOther: "Rinconada del Venado" });
    const view = await db((tx) => editForm(tx, localityA, id));
    const draft = cardDraft(view?.card as never, view?.catalogue as RegistrationCatalogue);
    expect(draft.zone).toBe("Rinconada del Venado");
    expect(await submit(form(edited({ [F.zone]: draft.zone })), token, deps().using)).toEqual({
      kind: "received",
    });
    const [edit] = await editsOf(id);
    expect(edit).toMatchObject({ zoneId: null, zoneOther: "Rinconada del Venado" });
  });

  it("a zone hidden since the card took it is offered to the card, so a field left as it was keeps it", async () => {
    const { id, token } = await cardWithLink({ zoneId: hiddenZone });
    const view = await db((tx) => editForm(tx, localityA, id));
    expect(view?.catalogue.zones.map(({ id: zone }) => zone)).toContain(hiddenZone);
    const draft = cardDraft(view?.card as never, view?.catalogue as RegistrationCatalogue);
    expect(draft.zone).toBe("Oculta");
    expect(await submit(form(edited({ [F.zone]: "Oculta" })), token, deps().using)).toEqual({
      kind: "received",
    });
    expect((await editsOf(id))[0]).toMatchObject({ zoneId: hiddenZone, zoneOther: null });
    // The registration still does not offer it.
    const registration = await db((tx) => registrationCatalogue(tx, localityA));
    expect(registration.zones.map(({ id: zone }) => zone)).not.toContain(hiddenZone);
  });

  // Scenario: the edit does not ask for consent again
  it("a valid edit needs no consent and no notice version", async () => {
    const view = await db((tx) => registrationCatalogue(tx, localityA));
    const validation = validateEdit(form(edited()), view);
    expect(validation.kind).toBe("valid");
  });
});

describe("Sending the edit does not touch the public card: it creates a pending edit", () => {
  // Scenario: the changes enter review and the card does not move
  it("a valid edit saves its full content as the pending edit, and no column of the card changes", async () => {
    const { id, token } = await cardWithLink({
      name: "Estética Lupita",
      openingHours: "Lunes a viernes",
      address: "Calle Vieja 1",
    });
    await db((tx) => tx.insert(businessTrades).values({ businessId: id, tradeId: f.tradeIds[0] }));
    const before = await cardRow(id);
    const whatsapp = newPhone();
    const sent = Date.now();
    const data = form(
      edited({
        [F.name]: "Estética Lupita",
        [F.whatsapp]: whatsapp,
        [F.zone]: "angeles",
        [F.whatYouOffer]: "cortes, tintes y peinados",
        [F.homeDelivery]: "on",
        [F.landline]: "7719997999",
        [F.address]: "Calle Nueva 2",
        [F.openingHours]: "Todos los días de 8 a 8",
        [F.facebookUrl]: "https://facebook.com/lupita",
      }),
    );
    expect(await submit(data, token, deps().using)).toEqual({ kind: "received" });

    expect(await cardRow(id)).toEqual(before);
    const edits = await editsOf(id);
    expect(edits).toHaveLength(1);
    const [edit] = edits;
    expect(edit).toMatchObject({
      businessId: id,
      localityCode: f.localityA,
      name: "Estética Lupita",
      categoryId: f.categoryId,
      whatsapp,
      zoneId: angeles,
      zoneOther: null,
      whatYouOffer: "cortes, tintes y peinados",
      homeDelivery: true,
      landline: "7719997999",
      address: "Calle Nueva 2",
      openingHours: "Todos los días de 8 a 8",
      facebookUrl: "https://facebook.com/lupita",
      photoChange: "keep",
      newPhotoKey: null,
      status: "pending",
      resolvedAt: null,
      discardReason: null,
    });
    expect(edit?.createdAt.getTime()).toBeGreaterThanOrEqual(sent - 5000);
  });

  // public-directory: "An edit awaiting review does not show through on any public surface"
  it("the search finds the card by what is published, never by what the edit proposes", async () => {
    const { id, token } = await cardWithLink({ name: "Estética Margarita" });
    expect(
      await submit(
        form(edited({ [F.name]: "Estética Margarita y Asociados" })),
        token,
        deps().using,
      ),
    ).toEqual({ kind: "received" });
    const found = async (q: string) =>
      (
        (await db((tx) =>
          searchPublishedBusinesses(tx, localityA, q, { limit: 100, offset: 0 }),
        )) ?? []
      ).map((item) => item.id);
    expect(await found("asociados")).not.toContain(id);
    expect(await found("margarita")).toContain(id);
  });

  // Scenario: failure saving the changes; the token does not appear in the log
  it("a failure to save is told without detail, saves nothing, and the log names neither the token nor the card", async () => {
    const { id, token } = await cardWithLink();
    const failing: SubmitEditDeps["useDb"] = (run) =>
      db((tx) =>
        run(
          new Proxy(tx, {
            get: (target, property, receiver) =>
              property === "transaction"
                ? () => Promise.reject(Object.assign(new Error("lost"), { code: "08006" }))
                : Reflect.get(target, property, receiver),
          }),
        ),
      );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await cardRow(id);
    expect(await submit(form(edited()), token, deps({ useDb: failing }).using)).toEqual({
      kind: "server",
    });
    expect(log).toHaveBeenCalledWith("edit: an edit could not be saved (PostgreSQL 08006)");
    expect(await editsOf(id)).toEqual([]);
    expect(await cardRow(id)).toEqual(before);
    const written = JSON.stringify(log.mock.calls);
    expect(written).not.toContain(token.slice(0, 8));
    expect(written).not.toContain(id);
  });
});

describe("The edit goes through the same validations as the registration and cannot set what is not its to set", () => {
  // Scenario: invalid WhatsApp in the edit
  it("each field comes back with the registration's error and literal message, and nothing is saved", async () => {
    const { id, token } = await cardWithLink();
    const outcome = await submit(
      form(
        edited({
          [F.name]: "",
          [F.whatsapp]: "771 999 70",
          [F.zone]: "",
          [F.whatYouOffer]: "x".repeat(201),
          [F.facebookUrl]: "facebook.com/minegocio",
          [F.landline]: "no tengo",
        }),
      ),
      token,
      deps().using,
    );
    expect(outcome).toEqual({
      kind: "invalid",
      errors: {
        name: "required",
        whatsapp: "invalid",
        zone: "required",
        whatYouOffer: "length",
        facebookUrl: "invalid",
        landline: "invalid",
      },
    });
    expect(errorMessage("whatsapp", "invalid")).toBe(
      "Revisa tu número de WhatsApp: deben ser 10 dígitos",
    );
    expect(await editsOf(id)).toEqual([]);
  });

  // Scenario: WhatsApp that already has another card
  it("a WhatsApp another card of the locality has, in any status, is refused with its message", async () => {
    const { id, token } = await cardWithLink();
    const published = newPhone();
    const rejected = newPhone();
    await insertBusiness(f, { whatsapp: published, status: "published", publishedAt: new Date() });
    await insertBusiness(f, {
      whatsapp: rejected,
      status: "rejected",
      rejectedAt: new Date(),
      rejectionReason: "No es un negocio real",
    });
    for (const whatsapp of [published, rejected, `+52 ${published}`]) {
      expect(await submit(form(edited({ [F.whatsapp]: whatsapp })), token, deps().using)).toEqual({
        kind: "invalid",
        errors: { whatsapp: "taken" },
      });
    }
    expect(errorMessage("whatsapp", "taken")).toBe(
      "Ese número ya está en otra ficha del directorio.",
    );
    expect(await editsOf(id)).toEqual([]);
  });

  it("the card's own number, and a number with a card in another locality, are not another card's", async () => {
    const own = await cardWithLink();
    const ownNumber = (await cardRow(own.id))?.whatsapp ?? "";
    expect(
      await submit(form(edited({ [F.whatsapp]: ownNumber })), own.token, deps().using),
    ).toEqual({
      kind: "received",
    });
    const elsewhere = newPhone();
    await insertBusiness(f, {
      localityCode: f.localityB,
      zoneId: f.zoneB,
      whatsapp: elsewhere,
      status: "published",
      publishedAt: new Date(),
    });
    const other = await cardWithLink();
    expect(
      await submit(form(edited({ [F.whatsapp]: elsewhere })), other.token, deps().using),
    ).toEqual({ kind: "received" });
  });

  // Scenarios: fields that are not its to set; a token only edits its own card
  it("fields the edit cannot set are ignored, and a token edits only its own card", async () => {
    const { id, token } = await cardWithLink();
    const second = await cardWithLink();
    const before = await cardRow(id);
    const secondBefore = await cardRow(second.id);
    const data = form(
      edited({
        id: second.id,
        businessId: second.id,
        localityCode: f.localityB,
        status: "published",
        origin: "seeded",
        trades: String(f.tradeIds[1]),
        tradeIds: String(f.tradeIds[1]),
        publishedAt: "2020-01-01T00:00:00Z",
        registeredAt: "2020-01-01T00:00:00Z",
        consentedToNoticeAt: "2020-01-01T00:00:00Z",
        consentedToNoticeVersion: "99",
        managementTokenHash: await tokenFingerprint("otro"),
        managementToken: newManagementToken(),
        photoKey: "https://evil.example/foto.jpg",
        newPhotoKey: generatePhotoKey(),
        photoChange: "replace",
        createdAt: "2020-01-01T00:00:00Z",
        resolvedAt: "2020-01-01T00:00:00Z",
        nameNormalized: "otro nombre",
      }),
    );
    expect(await submit(data, token, deps().using)).toEqual({ kind: "received" });
    const [edit] = await editsOf(id);
    expect(edit).toMatchObject({
      localityCode: f.localityA,
      photoChange: "keep",
      newPhotoKey: null,
      status: "pending",
      resolvedAt: null,
    });
    expect(edit?.createdAt.getFullYear()).toBeGreaterThan(2020);
    expect(await cardRow(id)).toEqual(before);
    expect(await editsOf(second.id)).toEqual([]);
    expect(await cardRow(second.id)).toEqual(secondBefore);
    expect(
      await db((tx) => tx.select().from(businessTrades).where(eq(businessTrades.businessId, id))),
    ).toEqual([]);
  });

  // Requirement: A token that is not exactly the current one opens nothing
  it("a token that opens no card is not found before anything else: no trap, no Turnstile, no quota", async () => {
    const { token } = await cardWithLink();
    const unpublished = await cardWithLink();
    await db((tx) =>
      tx
        .update(businesses)
        .set({ status: "in_review", unpublishedAt: new Date(), unpublishReason: "Cerró" })
        .where(eq(businesses.id, unpublished.id)),
    );
    const otherLocality = await cardWithLink({ localityCode: f.localityB, zoneId: f.zoneB });
    for (const [what, closed] of [
      ["invented", newManagementToken()],
      ["altered", `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`],
      ["not published", unpublished.token],
      ["of another locality", otherLocality.token],
    ] as const) {
      for (const data of [
        form(edited()),
        form(edited({ [HONEYPOT_FIELD]: "https://spam.example" })),
        form(edited({ [F.whatsapp]: "no tengo" })),
      ]) {
        const d = deps();
        expect(await submit(data, closed, d.using), what).toEqual({ kind: "not-found" });
        expect(d.calls, what).toEqual({ quota: 0, turnstile: [], images: 0 });
      }
    }
    expect(await editsOf(unpublished.id)).toEqual([]);
    expect(await editsOf(otherLocality.id)).toEqual([]);
  });

  it("a link regenerated, or a card unpublished, while the edit was sent saves nothing", async () => {
    const { id, token } = await cardWithLink();
    const link = await db((tx) => resolveManagementLink(tx, f.localityA, token));
    if (link === null) throw new Error("the link did not open");
    const fields = { ...(await db((tx) => editForm(tx, localityA, id)))?.card } as never;
    await db((tx) => issueManagementLink(tx, id));
    expect(
      await db((tx) => savePendingEdit(tx, f.localityA, link, fields, { kind: "keep" })),
    ).toEqual({ kind: "closed" });

    const other = await cardWithLink();
    const otherLink = await db((tx) => resolveManagementLink(tx, f.localityA, other.token));
    await db((tx) =>
      tx
        .update(businesses)
        .set({ status: "in_review", unpublishedAt: new Date(), unpublishReason: "Cerró" })
        .where(eq(businesses.id, other.id)),
    );
    expect(
      await db((tx) =>
        savePendingEdit(tx, f.localityA, otherLink as never, fields, { kind: "keep" }),
      ),
    ).toEqual({ kind: "closed" });
    expect(await editsOf(id)).toEqual([]);
    expect(await editsOf(other.id)).toEqual([]);
  });
});

describe("Sending changes when others are already waiting replaces the previous ones", () => {
  // Scenarios: the new changes replace the old ones; new changes supersede
  // the waiting ones (data-model)
  it("the waiting edit becomes superseded, with its resolution date, and the new one waits from now", async () => {
    const { id, token } = await cardWithLink();
    expect(
      await submit(form(edited({ [F.openingHours]: "De 9 a 5" })), token, deps().using),
    ).toEqual({ kind: "received" });
    expect(
      await submit(form(edited({ [F.openingHours]: "De 10 a 6" })), token, deps().using),
    ).toEqual({ kind: "received" });
    const [first, second] = await editsOf(id);
    expect(first).toMatchObject({ status: "superseded", openingHours: "De 9 a 5" });
    expect(second).toMatchObject({
      status: "pending",
      openingHours: "De 10 a 6",
      resolvedAt: null,
    });
    expect(first?.resolvedAt).toEqual(second?.createdAt);
    expect(second?.createdAt.getTime()).toBeGreaterThan(first?.createdAt.getTime() ?? 0);
  });

  // Scenario: warning when opening with pending changes
  it("the form is prefilled with the edit waiting, not with what is published", async () => {
    const { id, token } = await cardWithLink({ name: "Tacos del Güero", openingHours: "De noche" });
    expect(
      await submit(
        form(
          edited({
            [F.name]: "Tacos del Güero Grande",
            [F.zone]: "Rinconada del Venado",
            [F.removePhoto]: "on",
          }),
        ),
        token,
        deps().using,
      ),
    ).toEqual({ kind: "received" });
    const view = await db((tx) => editForm(tx, localityA, id));
    expect(view?.waiting).toMatchObject({ name: "Tacos del Güero Grande", photoChange: "remove" });
    const draft = waitingEditDraft(
      view?.waiting as never,
      view?.catalogue as RegistrationCatalogue,
    );
    expect(draft).toMatchObject({
      name: "Tacos del Güero Grande",
      zone: "Rinconada del Venado",
      openingHours: "",
      removePhoto: true,
      photo: false,
    });
  });

  // Scenario: two almost simultaneous submissions
  it("submissions at the same time leave exactly one pending edit, and none is an error", async () => {
    const { id, token } = await cardWithLink();
    const outcomes = await Promise.all(
      ["Uno", "Dos", "Tres"].map((n) =>
        submit(form(edited({ [F.openingHours]: `Horario ${n}` })), token, deps().using),
      ),
    );
    expect(outcomes).toEqual([{ kind: "received" }, { kind: "received" }, { kind: "received" }]);
    const edits = await editsOf(id);
    expect(edits).toHaveLength(3);
    expect(edits.filter(({ status }) => status === "pending")).toHaveLength(1);
    expect(edits.filter(({ status }) => status === "superseded")).toHaveLength(2);
  });
});

describe("The edit's honeypot and per-IP quota are those of the public forms (v2)", () => {
  // Scenario: honeypot filled in an edit
  it("a filled trap field is told it was received, and nothing is saved, checked or counted", async () => {
    const { id, token } = await cardWithLink();
    const d = deps();
    expect(
      await submit(form(edited({ [HONEYPOT_FIELD]: "https://spam.example" })), token, d.using),
    ).toEqual({ kind: "received" });
    expect(d.calls).toEqual({ quota: 0, turnstile: [], images: 0 });
    expect(await editsOf(id)).toEqual([]);
  });

  // Scenario: honeypot with only spaces
  it("a trap field of only spaces is no trap", async () => {
    const { id, token } = await cardWithLink();
    expect(await submit(form(edited({ [HONEYPOT_FIELD]: "   " })), token, deps().using)).toEqual({
      kind: "received",
    });
    expect(await editsOf(id)).toHaveLength(1);
  });

  // Scenarios: edit quota; per-IP limit
  it("3 edits an hour from one address; the fourth saves nothing", async () => {
    expect(QUOTAS.edit).toEqual({ limit: 3, windowSeconds: 3600 });
    const { id, token } = await cardWithLink();
    const address = newAddress();
    for (let n = 1; n <= 3; n++) {
      expect(await submit(form(edited()), token, deps({ address }).using), String(n)).toEqual({
        kind: "received",
      });
    }
    const before = await editsOf(id);
    expect(await submit(form(edited()), token, deps({ address }).using)).toEqual({ kind: "quota" });
    expect(await editsOf(id)).toEqual(before);
    // Another address edits the same card.
    expect(await submit(form(edited()), token, deps().using)).toEqual({ kind: "received" });
  });

  it("only an edit that passed the trap, Turnstile and the fields spends quota", async () => {
    const { token } = await cardWithLink();
    const address = newAddress();
    for (const data of [
      form(edited({ [HONEYPOT_FIELD]: "x" })),
      form(edited({ [F.name]: "" })),
      form(edited({ [TURNSTILE_RESPONSE_FIELD]: "forged" })),
    ]) {
      const d = deps({ address });
      vi.spyOn(console, "log").mockImplementation(() => {});
      await submit(data, token, d.using);
      expect(d.calls.quota).toBe(0);
    }
    for (let n = 1; n <= 3; n++) {
      expect(await submit(form(edited()), token, deps({ address }).using)).toEqual({
        kind: "received",
      });
    }
  });

  // Scenarios: independent counters; the quotas do not get in each other's way
  it("an address over its edit quota registers, and one over its registration quota edits", async () => {
    const { token } = await cardWithLink();
    const address = newAddress();
    const headers = new Headers({ [CLIENT_IP_HEADER]: address });
    for (let n = 1; n <= 3; n++) await takeQuota(env, headers, "edit");
    expect((await takeQuota(env, headers, "edit")).allowed).toBe(false);
    expect((await takeQuota(env, headers, "registration")).allowed).toBe(true);
    expect((await takeQuota(env, headers, "report")).allowed).toBe(true);

    const other = newAddress();
    const otherHeaders = new Headers({ [CLIENT_IP_HEADER]: other });
    for (let n = 1; n <= 3; n++) await takeQuota(env, otherHeaders, "registration");
    expect((await takeQuota(env, otherHeaders, "registration")).allowed).toBe(false);
    expect(await submit(form(edited()), token, deps({ address: other }).using)).toEqual({
      kind: "received",
    });
  });

  it("without the address of its visitor, no edit is held back", async () => {
    const { token } = await cardWithLink();
    for (let n = 1; n <= 4; n++) {
      expect(await submit(form(edited()), token, deps({ address: null }).using)).toEqual({
        kind: "received",
      });
    }
  });
});

describe("The registration and edit forms are protected by quotas, honeypot and Turnstile (v2): the edit", () => {
  it("the edit has its own action, and the token is checked with it", async () => {
    expect(TURNSTILE_ACTIONS).toEqual(["registration", "edit"]);
    const { token } = await cardWithLink();
    const d = deps();
    expect(await submit(form(edited()), token, d.using)).toEqual({ kind: "received" });
    expect(d.calls.turnstile).toEqual(["edit"]);
  });

  // Scenario: a missing or invalid token
  it("no token, a forged one, one of another form or no answer: refused, nothing saved, no quota, no photo opened", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, token } = await cardWithLink();
    const cases: [string | undefined, VerifyTurnstile][] = [
      [undefined, local],
      ["forged", local],
      [
        TURNSTILE_DUMMY_TOKEN,
        async (_token, action) => (action === "registration" ? "valid" : "invalid"),
      ],
      [TURNSTILE_DUMMY_TOKEN, async () => "unavailable"],
    ];
    for (const [turnstileToken, verify] of cases) {
      const fields = edited({ [F.photo]: photoFile(jpeg) });
      if (turnstileToken === undefined) delete fields[TURNSTILE_RESPONSE_FIELD];
      else fields[TURNSTILE_RESPONSE_FIELD] = turnstileToken;
      const d = deps({ verify });
      expect(await submit(form(fields), token, d.using), String(turnstileToken)).toEqual({
        kind: "turnstile",
      });
      expect(d.calls.quota).toBe(0);
      expect(d.calls.images).toBe(0);
    }
    expect(await editsOf(id)).toEqual([]);
  });

  // Scenario: the kill switch
  it("with the switch off an edit without a token is saved, and the trap and the quota still work", async () => {
    const { id, token } = await cardWithLink();
    const rollback = new Error("rollback");
    const outcomes: unknown[] = [];
    await db(async (connection) => {
      try {
        await connection.transaction(async (tx) => {
          await tx.update(siteSettings).set({ turnstileEnabled: false });
          const inside: SubmitEditDeps["useDb"] = (run) => run(tx as unknown as Db);
          const address = newAddress();
          const fields = edited();
          delete fields[TURNSTILE_RESPONSE_FIELD];
          outcomes.push(await submit(form(fields), token, deps({ useDb: inside, address }).using));
          outcomes.push(
            await submit(
              form({ ...fields, [HONEYPOT_FIELD]: "x" }),
              token,
              deps({ useDb: inside, address }).using,
            ),
          );
          outcomes.push(
            (await tx.select().from(pendingEdits).where(eq(pendingEdits.businessId, id))).length,
          );
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
    });
    expect(outcomes).toEqual([{ kind: "received" }, { kind: "received" }, 1]);
  });
});

describe("The edit of a card may change its photo, which reaches the card only when the edit is applied (v2)", () => {
  // Scenario: a new photo in the edit
  it("a new photo is stored under a new key the edit names, and the card keeps its own photo", async () => {
    const cardPhoto = await storedPhoto();
    const { id, token } = await cardWithLink({ photoKey: cardPhoto });
    const before = await cardRow(id);
    expect(await submit(form(edited({ [F.photo]: photoFile(jpeg) })), token, deps().using)).toEqual(
      {
        kind: "received",
      },
    );
    const [edit] = await editsOf(id);
    expect(edit?.photoChange).toBe("replace");
    expect(isPhotoKey(edit?.newPhotoKey)).toBe(true);
    expect(edit?.newPhotoKey).not.toBe(cardPhoto);
    expect(await objectsOf(edit?.newPhotoKey ?? "")).toEqual(
      photoObjectKeys(edit?.newPhotoKey ?? "").toSorted(),
    );
    expect(await cardRow(id)).toEqual(before);
    expect(await objectsOf(cardPhoto)).toHaveLength(2);
  });

  // Scenarios: removing the photo in the edit; the checkbox and a file
  it('"Dejar mi ficha sin foto" asks to remove it, a file sent with it is never opened, and nothing else keeps it', async () => {
    const cardPhoto = await storedPhoto();
    const { id, token } = await cardWithLink({ photoKey: cardPhoto });
    const d = deps();
    expect(
      await submit(
        form(edited({ [F.removePhoto]: "on", [F.photo]: photoFile(jpeg) })),
        token,
        d.using,
      ),
    ).toEqual({ kind: "received" });
    expect(d.calls.images).toBe(0);
    expect(await submit(form(edited()), token, deps().using)).toEqual({ kind: "received" });
    const [removing, keeping] = await editsOf(id);
    expect(removing).toMatchObject({
      photoChange: "remove",
      newPhotoKey: null,
      status: "superseded",
    });
    expect(keeping).toMatchObject({ photoChange: "keep", newPhotoKey: null, status: "pending" });
    expect((await cardRow(id))?.photoKey).toBe(cardPhoto);
    expect(await objectsOf(cardPhoto)).toHaveLength(2);
  });

  // Scenario: a newer edit replaces one with a new photo
  // Scenarios: a newer edit replaces one with a new photo; the new photo
  // of the edit waiting stays
  it("a newer edit that keeps the photo takes over the new one waiting; another file replaces it, the checkbox removes it", async () => {
    const cardPhoto = await storedPhoto();
    const { id, token } = await cardWithLink({ photoKey: cardPhoto });
    await submit(form(edited({ [F.photo]: photoFile(jpeg) })), token, deps().using);
    const firstKey = (await editsOf(id))[0]?.newPhotoKey ?? "";
    expect(await objectsOf(firstKey)).toHaveLength(2);

    // Another file: the first photo goes, after the save.
    await submit(form(edited({ [F.photo]: photoFile(jpeg) })), token, deps().using);
    const [first, second] = await editsOf(id);
    expect(first).toMatchObject({
      status: "superseded",
      photoChange: "replace",
      newPhotoKey: null,
    });
    expect(await objectsOf(firstKey)).toEqual([]);
    const secondKey = second?.newPhotoKey ?? "";
    expect(isPhotoKey(secondKey)).toBe(true);
    expect(await objectsOf(secondKey)).toHaveLength(2);

    // Neither a file nor the checkbox: the newer edit takes that photo over,
    // and superseding the one that carried it deletes nothing.
    await submit(form(edited({ [F.openingHours]: "Otro horario" })), token, deps().using);
    const third = (await editsOf(id))[2];
    expect(third).toMatchObject({
      status: "pending",
      photoChange: "replace",
      newPhotoKey: secondKey,
      openingHours: "Otro horario",
    });
    expect((await editsOf(id))[1]).toMatchObject({ status: "superseded", newPhotoKey: null });
    expect(await objectsOf(secondKey)).toHaveLength(2);
    // And again: the same photo stays with the newest edit.
    await submit(form(edited()), token, deps().using);
    expect((await editsOf(id))[3]).toMatchObject({
      photoChange: "replace",
      newPhotoKey: secondKey,
    });
    expect(await objectsOf(secondKey)).toHaveLength(2);

    // The checkbox: the new photo goes, and the edit asks to remove the card's.
    await submit(form(edited({ [F.removePhoto]: "on" })), token, deps().using);
    expect((await editsOf(id))[4]).toMatchObject({ photoChange: "remove", newPhotoKey: null });
    expect(await objectsOf(secondKey)).toEqual([]);
    // No edit names a photo but the one waiting, and the card's never moved.
    expect((await editsOf(id)).filter(({ newPhotoKey }) => newPhotoKey !== null)).toEqual([]);
    expect((await cardRow(id))?.photoKey).toBe(cardPhoto);
    expect(await objectsOf(cardPhoto)).toHaveLength(2);
  });

  it("an edit that removes the photo waiting is not carried over: the next one without the checkbox keeps the card's", async () => {
    const cardPhoto = await storedPhoto();
    const { id, token } = await cardWithLink({ photoKey: cardPhoto });
    await submit(form(edited({ [F.removePhoto]: "on" })), token, deps().using);
    await submit(form(edited()), token, deps().using);
    expect((await editsOf(id)).map(({ photoChange }) => photoChange)).toEqual(["remove", "keep"]);
  });

  it("a photo stored for an edit that is then not saved is deleted", async () => {
    const taken = newPhone();
    await insertBusiness(f, { whatsapp: taken, status: "published", publishedAt: new Date() });
    const { id, token } = await cardWithLink();
    const puts: string[] = [];
    const recording: PhotoServices["bucket"] = {
      put: ((key: string, value: Uint8Array, options: R2PutOptions) => {
        puts.push(key);
        return bucket.put(key, value, options);
      }) as R2Bucket["put"],
      delete: bucket.delete,
      cache: NO_PHOTO_CACHE,
    };
    expect(
      await submit(
        form(edited({ [F.whatsapp]: taken, [F.photo]: photoFile(jpeg) })),
        token,
        deps({ photos: { images: env.IMAGES, bucket: recording } }).using,
      ),
    ).toEqual({ kind: "invalid", errors: { whatsapp: "taken" } });
    expect(puts).toHaveLength(2);
    expect(await objectsOf(puts[0]?.split("/")[1] ?? "")).toEqual([]);
    expect(await editsOf(id)).toEqual([]);
  });

  it("the photo's checks are the registration's: weighed with the fields, opened after the quota, turned away with nothing saved", async () => {
    const { id, token } = await cardWithLink();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "foto.jpg", { type: "image/jpeg" });
    const d = deps();
    expect(await submit(form(edited({ [F.name]: "", [F.photo]: big })), token, d.using)).toEqual({
      kind: "invalid",
      errors: { name: "required", photo: "too-large" },
    });
    expect(d.calls).toMatchObject({ quota: 0, images: 0 });
    const page = new File([new TextEncoder().encode("<!doctype html>")], "foto.jpg", {
      type: "image/jpeg",
    });
    expect(await submit(form(edited({ [F.photo]: page })), token, deps().using)).toEqual({
      kind: "invalid",
      errors: { photo: "unreadable" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const busy = deps({ photos: { images: env.IMAGES, bucket, slots: new PhotoSlots(0) } });
    expect(await submit(form(edited({ [F.photo]: photoFile(jpeg) })), token, busy.using)).toEqual({
      kind: "invalid",
      errors: { photo: "busy" },
    });
    expect(await editsOf(id)).toEqual([]);
  });
});

describe("A token that is not exactly the current one opens nothing and gives nothing away: the log", () => {
  // Scenario: the token does not appear in the log
  it("opening, sending, refusing and failing write nothing of the token to the log", async () => {
    const calls = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const { id, token } = await cardWithLink();
    await db((tx) => resolveManagementLink(tx, f.localityA, token));
    await db((tx) => editForm(tx, localityA, id));
    await submit(form(edited()), token, deps().using);
    await submit(form(edited({ [TURNSTILE_RESPONSE_FIELD]: "forged" })), token, deps().using);
    await submit(form(edited()), `${token.slice(0, -1)}x`, deps().using);
    await submit(
      form(edited()),
      token,
      deps({
        useDb: (run) =>
          db((tx) =>
            run(
              new Proxy(tx, {
                get: (target, property, receiver) =>
                  property === "transaction"
                    ? () => Promise.reject(new Error(`failed for ${token}`))
                    : Reflect.get(target, property, receiver),
              }),
            ),
          ),
      }).using,
    );
    const fingerprint = await tokenFingerprint(token);
    const written = JSON.stringify(calls.flatMap((call) => call.mock.calls));
    expect(written.length).toBeGreaterThan(2);
    for (const part of [token, token.slice(0, 8), token.slice(-8), fingerprint.slice(0, 16)]) {
      expect(written).not.toContain(part);
    }
  });
});

describe("A pending edit may change the photo of its card (v2): the table", () => {
  it("what an edit does to the photo is one of three, and a key comes only with a replacement, always while it waits", async () => {
    const id = await insertBusiness(f, { status: "published", publishedAt: new Date() });
    const base = {
      businessId: id,
      localityCode: f.localityA,
      name: "Edición de Prueba",
      categoryId: f.categoryId,
      whatsapp: newPhone(),
      zoneId: f.zoneA,
    };
    const key = generatePhotoKey();
    const insert = (values: Partial<typeof pendingEdits.$inferInsert>) =>
      db((tx) =>
        tx
          .insert(pendingEdits)
          .values({ ...base, status: "superseded", resolvedAt: new Date(), ...values }),
      );
    await expect(insert({ photoChange: "keep" })).resolves.toBeDefined();
    await expect(insert({ photoChange: "remove" })).resolves.toBeDefined();
    await expect(insert({ photoChange: "replace", newPhotoKey: key })).resolves.toBeDefined();
    // A superseded edit that gave its photo up keeps saying it replaced it.
    await expect(insert({ photoChange: "replace" })).resolves.toBeDefined();
    for (const values of [
      { photoChange: "rotate" as never },
      // While it waits, a replacement names its photo.
      { photoChange: "replace" as const, status: "pending" as const, resolvedAt: null },
      { photoChange: "keep" as const, newPhotoKey: generatePhotoKey() },
      { photoChange: "remove" as const, newPhotoKey: generatePhotoKey() },
      { photoChange: "replace" as const, newPhotoKey: "https://evil.example/x" },
      { photoChange: "replace" as const, newPhotoKey: "abcdefghjk" },
    ]) {
      await expect(insert(values), JSON.stringify(values)).rejects.toThrow();
    }
    // A key names one edit's photo only.
    await expect(insert({ photoChange: "replace", newPhotoKey: key })).rejects.toThrow();
    const rows = await db((tx) =>
      tx
        .select({ change: pendingEdits.photoChange })
        .from(pendingEdits)
        .where(and(eq(pendingEdits.businessId, id))),
    );
    expect(rows.map(({ change }) => change).toSorted()).toEqual([
      "keep",
      "remove",
      "replace",
      "replace",
    ]);
  });
});
