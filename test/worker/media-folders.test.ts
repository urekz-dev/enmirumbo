// EMR-75: exercise dev/stage ownership with real local R2 and PostgreSQL,
// and a fake cache API. No deployed resource or network is used.
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  businesses,
  pendingEdits,
  roleAssignments,
  rolePermissions,
  roles,
  users,
} from "../../src/core/db/schema/index.ts";
import { photoCacheUrls } from "../../src/core/photos/cache.ts";
import {
  DEV_PHOTOS_PREFIX,
  PHOTOS_PREFIX,
  isPhotoKey,
  newPhotoKey,
  photoObjectKeys,
  photoUrl,
} from "../../src/core/photos/photo.ts";
import { deletePhoto, removePhoto, storePhoto } from "../../src/core/photos/upload.ts";
import { deleteCard, submitDeletion, purgeRejectedCard } from "../../src/core/review/deletion.ts";
import { submitApplyEdit } from "../../src/core/review/apply.ts";
import { DISCARD_FIELD, submitDiscardEdit } from "../../src/core/review/discard.ts";
import { mediaBucket } from "../../src/lib/media-bucket.ts";
import { businessPhoto, panelPhoto, photoShareImage } from "../../src/lib/media.ts";
import {
  cleanup,
  createFixture,
  db,
  fakePhone,
  insertBusiness,
  pgErrorCode,
  PG,
  type Fixture,
} from "./fixtures.ts";
import { drawWebp, photoFile, RED } from "./images.ts";

const STATE = "63";
const EMAIL = "reviewer@media-folders.enmirumbo.test";
const BASE = "https://media-folders.enmirumbo.test";
const vars = (environment: string) => ({
  ...env,
  ENVIRONMENT: environment,
  MEDIA_URL: BASE,
  MEDIA_ZONE_ID: "a".repeat(32),
  MEDIA_CACHE_PURGE_TOKEN: crypto.randomUUID(),
});
const written = new Set<string>();
let f: Fixture;

function bucket(environment = "dev") {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ success: true }));
  return { media: mediaBucket(vars(environment), fetch), fetch };
}

async function photo(dev: boolean): Promise<string> {
  const key = newPhotoKey(dev ? DEV_PHOTOS_PREFIX : PHOTOS_PREFIX);
  written.add(key);
  for (const object of photoObjectKeys(key)) await env.MEDIA.put(object, new Uint8Array([1, 2, 3]));
  return key;
}

async function objects(key: string): Promise<number> {
  const found = await Promise.all(photoObjectKeys(key).map((object) => env.MEDIA.head(object)));
  return found.filter((object) => object !== null).length;
}

async function edit(businessId: string, key: string) {
  const [row] = await db((tx) =>
    tx
      .insert(pendingEdits)
      .values({
        businessId,
        localityCode: f.localityA,
        name: "Plomería de Prueba",
        categoryId: f.categoryId,
        whatsapp: fakePhone(),
        zoneId: f.zoneA,
        photoChange: "replace",
        newPhotoKey: key,
      })
      .returning({ id: pendingEdits.id }),
  );
  return row!.id;
}

beforeAll(async () => {
  await db(async (tx) => {
    await tx.delete(users).where(eq(users.email, EMAIL));
    await tx.delete(roles).where(eq(roles.key, "mediafolders_test"));
  });
  f = await createFixture(STATE);
  await db(async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({ key: "mediafolders_test", name: "Fotos de prueba", scope: "locality" })
      .returning();
    const [user] = await tx
      .insert(users)
      .values({ email: EMAIL, name: "Revisor de prueba" })
      .returning();
    await tx.insert(rolePermissions).values(
      ["businesses.delete", "edits.review"].map((permissionKey) => ({
        roleId: role!.id,
        permissionKey,
      })),
    );
    await tx.insert(roleAssignments).values({
      userId: user!.id,
      roleId: role!.id,
      roleScope: "locality",
      localityCode: f.localityA,
    });
  });
});

afterAll(async () => {
  await db(async (tx) => {
    await tx.delete(users).where(eq(users.email, EMAIL));
    await tx.delete(roles).where(eq(roles.key, "mediafolders_test"));
  });
  await cleanup(STATE);
  if (written.size > 0) await env.MEDIA.delete([...written].flatMap(photoObjectKeys));
});

afterEach(() => vi.restoreAllMocks());

describe("Dev owns its folder and still renders stage's copied keys", () => {
  it.for(["dev", "stage", "prod", "local"])(
    "a %s upload uses its configured folder and every address follows the key",
    async (environment) => {
      const { media } = bucket(environment);
      const result = await storePhoto(photoFile(drawWebp(4, 4, RED), "foto.webp", "image/webp"), {
        images: env.IMAGES,
        bucket: media,
      });
      expect(result.kind).toBe("stored");
      if (result.kind !== "stored") throw new Error("photo was not stored");
      const key = result.key;
      written.add(key);
      const prefix = environment === "dev" ? "dev/photos/dev_" : "photos/";
      expect(isPhotoKey(key)).toBe(true);
      expect(await objects(key)).toBe(2);
      expect(photoObjectKeys(key).every((object) => object.startsWith(prefix))).toBe(true);
      const url = `${BASE}/${photoObjectKeys(key)[1]}`;
      expect(photoUrl(BASE, key, "full")?.src).toBe(url);
      expect(businessPhoto(vars("dev"), key, "full")?.src).toBe(url);
      expect(panelPhoto(vars("dev"), key, "full")?.src).toBe(url);
      expect(photoShareImage(vars("dev"), { name: "Negocio de prueba", photoKey: key })?.src).toBe(
        url,
      );
    },
  );

  it.for([false, true])(
    "panel deletion of a dev-folder=%s card changes rows and touches only owned photos",
    async (dev) => {
      const key = await photo(dev);
      const id = await insertBusiness(f, { photoKey: key });
      const { media, fetch } = bucket();
      const form = new FormData();
      form.set("confirmacion", "BORRAR");
      expect(
        await submitDeletion(form, { email: EMAIL, businessId: id }, { useDb: db, bucket: media }),
      ).toEqual({ kind: "deleted", photoCached: false });
      expect(await db((tx) => tx.select().from(businesses).where(eq(businesses.id, id)))).toEqual(
        [],
      );
      expect(await objects(key)).toBe(dev ? 0 : 2);
      expect(fetch).toHaveBeenCalledTimes(dev ? 1 : 0);
      if (dev)
        expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
          files: photoCacheUrls(BASE, key),
        });
    },
  );

  it("retention purges the copied stage card and its edit rows without deleting or purging stage photos", async () => {
    const key = await photo(false);
    const editKey = await photo(false);
    const id = await insertBusiness(f, {
      status: "rejected",
      rejectedAt: new Date("2025-01-01T00:00:00Z"),
      rejectionReason: "De prueba",
      photoKey: key,
    });
    await edit(id, editKey);
    const { media, fetch } = bucket();
    expect(
      await db((tx) => purgeRejectedCard(tx, id, new Date("2026-01-01T09:00:00Z"), media)),
    ).toEqual({ kind: "purged" });
    expect(
      await db((tx) => tx.select().from(pendingEdits).where(eq(pendingEdits.businessId, id))),
    ).toEqual([]);
    expect(await objects(key)).toBe(2);
    expect(await objects(editKey)).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.for([false, true])(
    "replacing a dev-folder=%s card photo through an edit respects ownership",
    async (dev) => {
      const old = await photo(dev);
      const replacement = await photo(true);
      const id = await insertBusiness(f, { status: "published", photoKey: old });
      const editId = await edit(id, replacement);
      const { media, fetch } = bucket();
      expect(
        await submitApplyEdit(
          new FormData(),
          { email: EMAIL, editId: String(editId) },
          { useDb: db, bucket: media },
        ),
      ).toEqual({ kind: "applied" });
      expect(await objects(old)).toBe(dev ? 0 : 2);
      expect(await objects(replacement)).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(dev ? 1 : 0);
      const [card] = await db((tx) =>
        tx.select({ key: businesses.photoKey }).from(businesses).where(eq(businesses.id, id)),
      );
      expect(card?.key).toBe(replacement);
    },
  );

  it.for([false, true])(
    "discarding an edit with a dev-folder=%s photo respects ownership",
    async (dev) => {
      const key = await photo(dev);
      const id = await insertBusiness(f, { status: "published" });
      const editId = await edit(id, key);
      const { media, fetch } = bucket();
      const form = new FormData();
      form.set(DISCARD_FIELD, "Datos de prueba");
      expect(
        await submitDiscardEdit(
          form,
          { email: EMAIL, editId: String(editId) },
          { useDb: db, bucket: media },
        ),
      ).toEqual({ kind: "discarded" });
      expect(await objects(key)).toBe(dev ? 0 : 2);
      expect(fetch).toHaveBeenCalledTimes(dev ? 1 : 0);
      const [row] = await db((tx) =>
        tx.select().from(pendingEdits).where(eq(pendingEdits.id, editId)),
      );
      expect(row).toMatchObject({ status: "discarded", newPhotoKey: null });
    },
  );

  it("foreign cleanup is done without claiming an object deletion, in both directions", async () => {
    for (const environment of ["dev", "stage"]) {
      const key = await photo(environment !== "dev");
      const { media, fetch } = bucket(environment);
      expect(await removePhoto(media, key)).toEqual({ kind: "foreign" });
      expect(await deletePhoto(media, key)).toBe(true);
      expect(await objects(key)).toBe(2);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("a failed row deletion never claims a foreign photo was deleted, even with an owned edit photo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const key = await photo(false);
    const id = await insertBusiness(f, { photoKey: key });
    await edit(id, await photo(true));
    const { media } = bucket();
    // An empty audit actor fails its CHECK after the attempted row deletion.
    expect(await db((tx) => deleteCard(tx, id, "   ", media))).toEqual({
      kind: "failed",
      photoRemoved: false,
    });
    expect(await objects(key)).toBe(2);
  });

  it("the pending-edit CHECK accepts exactly both server key forms", async () => {
    const id = await insertBusiness(f);
    for (const key of [newPhotoKey(), newPhotoKey(DEV_PHOTOS_PREFIX)]) {
      await edit(id, key);
      await db((tx) => tx.delete(pendingEdits).where(eq(pendingEdits.businessId, id)));
    }
    const key = newPhotoKey();
    for (const invalid of [
      `dev_${key}a`,
      `dev_dev_${key}`,
      `stage_${key}`,
      `DEV_${key}`,
      `dev_${key.slice(1)}`,
      `dev_${key}0`,
      `dev/${key}`,
      `${key}\n`,
      `dev_${key}\n`,
      "https://example.test/photo",
    ]) {
      expect(isPhotoKey(invalid)).toBe(false);
      expect(await pgErrorCode(() => edit(id, invalid))).toBe(PG.check);
    }
  });
});
