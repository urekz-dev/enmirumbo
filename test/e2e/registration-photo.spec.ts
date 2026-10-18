// Scenarios of docs/specs/business-registration.md for the photo of the
// registration, on the built site with the seeded directory of Tizayuca:
// "The photo field explains the PRD §6.1 policy and opens the phone gallery",
// "The server validates every field and returns per-field errors in Spanish"
// (the photo has to be chosen again), "The server only accepts the photo if
// it is a real image of at most 5 MB", "The photo is stored compressed,
// without metadata and with a server-generated reference", "Resubmission
// after a rejection allows changing or removing the photo", "Photos are
// stored as two WebP sizes in R2 under opaque keys (v2)" and "Photos are
// uploaded through the Images binding, within a ceiling of work (v2)". The
// preview runs the offline Images binding and serves the local media bucket
// under /_media/. The field is rendered state by state in
// test/astro/registration.test.ts; the upload is tested in
// test/worker/photo-upload.test.ts.
//
// Turnstile is on, with the local fake of its script (./turnstile.ts), so
// the pages run JavaScript; this file never turns the switch off, so it runs
// with the other phone tests. The flows without JavaScript, with the switch
// off, are those of registration.spec.ts; the photo travels in the same
// submission either way, and no script of the site touches it.
//
// Every business this file creates in Tizayuca has a number of the
// 7719993xxx series; before and after, they are removed, and the objects of
// their photos with them. The images are drawn in code: no image file goes
// in the repository.
import { crc32, deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import { withLocalMediaBucket } from "../../scripts/seed-media.ts";
import { businesses } from "../../src/core/db/schema/index.ts";
import { encodeLosslessWebp } from "../../src/core/db/seed/webp.ts";
import { isPhotoKey, PHOTO_CACHE_CONTROL, photoObjectKeys } from "../../src/core/photos/photo.ts";
import { withDatabase } from "./database.ts";
import { expect, test } from "./turnstile.ts";

const TIZAYUCA = "13069";
const HOME = "/hidalgo/tizayuca";
const FORM = `${HOME}/registro`;
const THANKS = `${FORM}/gracias`;
const PHONES = "7719993";

const NOT_KEPT = "Tu foto no se quedó guardada: vuelve a elegirla antes de enviar.";
const TOO_LARGE = "Esa foto pesa más de 5 MB. Sube una más ligera.";
const UNREADABLE = "No pudimos leer esa foto. Sube una imagen JPG, PNG o WebP.";
const POLICY =
  "Una foto de tu local, de tus productos o de tu trabajo. Que no salgan personas que se puedan reconocer. Máximo 5 MB (JPG, PNG o WebP); nosotros la comprimimos para que cargue rápido.";

type Business = typeof businesses.$inferSelect;

async function businessesOf(whatsapp: string): Promise<Business[]> {
  let rows: Business[] = [];
  await withDatabase(async (db) => {
    rows = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.localityCode, TIZAYUCA), eq(businesses.whatsapp, whatsapp)));
  });
  return rows;
}

/** Removes this file's businesses, and the objects of their photos. */
async function removeRegistrations(): Promise<void> {
  const keys: string[] = [];
  await withDatabase(async (db) => {
    const mine = and(
      eq(businesses.localityCode, TIZAYUCA),
      like(businesses.whatsapp, `${PHONES}%`),
    );
    const rows = await db.select({ photoKey: businesses.photoKey }).from(businesses).where(mine);
    for (const { photoKey } of rows)
      if (isPhotoKey(photoKey)) keys.push(...photoObjectKeys(photoKey));
    await db.delete(businesses).where(mine);
  });
  if (keys.length > 0) await withLocalMediaBucket(async (bucket) => bucket.delete(keys));
}

test.beforeAll(removeRegistrations);
test.afterAll(removeRegistrations);

/** A WebP photo of `width`×`height`, drawn: a blue field with a green corner. */
function webp(width: number, height: number): Buffer {
  const pixels = new Uint32Array(width * height).fill(0x3d5a80);
  for (let y = 0; y < height / 4; y += 1) pixels.fill(0x2f6f5e, y * width, y * width + width / 4);
  return Buffer.from(encodeLosslessWebp({ width, height, pixels }));
}

/** A PNG photo of `width`×`height` in one colour, written with zlib. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const byLabel = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const photoField = (page: Page) => byLabel(page, "Foto de tu negocio (opcional)");
const removePhoto = (page: Page) => byLabel(page, "Dejar mi ficha sin foto");

/** Fills the required fields as a person would. */
async function fillRequired(page: Page, whatsapp: string, name = "Fotos de Prueba Inventadas") {
  await byLabel(page, "¿Cómo se llama tu negocio?").fill(name);
  await byLabel(page, "¿A qué se dedica?").selectOption({ label: "Talleres" });
  await byLabel(page, "Tu WhatsApp (10 dígitos)").fill(whatsapp);
  await byLabel(page, "¿En qué colonia estás?").fill("Huicalco");
  await byLabel(
    page,
    "Acepto el aviso de privacidad y confirmo que este negocio es mío o que tengo permiso para registrarlo.",
  ).setChecked(true);
}

/** Sends the form of the page, and gives the answer to the POST. */
async function send(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse((answer) => answer.request().method() === "POST"),
    page.getByRole("button", { name: "Registrar mi negocio", exact: true }).click(),
  ]);
  return response;
}

/** What the photo field says next to it. */
function photoMessage(page: Page) {
  return page.locator("#registration-photo-error");
}

/** The answer of the local media bucket for both objects of a photo. */
async function objectAnswers(page: Page, photoKey: string) {
  return Promise.all(
    photoObjectKeys(photoKey).map(async (key) => {
      const answer = await page.request.get(`/_media/${key}`);
      return {
        status: answer.status(),
        type: answer.headers()["content-type"],
        cache: answer.headers()["cache-control"],
      };
    }),
  );
}

test.describe("Registering with a photo", () => {
  // Scenarios: choosing a photo from the phone; what is stored (v2); the
  // photo is served compressed and in two sizes
  test("the photo is stored as its two WebP variants under a key of the server's, and no public page names it", async ({
    page,
  }) => {
    await page.goto(FORM);
    await expect(page.getByText(POLICY, { exact: true })).toBeVisible();
    await expect(photoField(page)).toHaveAttribute("type", "file");
    // The formats the server takes, so iOS sends a HEIC photo as a JPEG.
    await expect(photoField(page)).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    await expect(removePhoto(page)).not.toBeChecked();

    await fillRequired(page, "7719993001", "Taller con Foto de Mentiras");
    await photoField(page).setInputFiles({
      name: "foto.png",
      mimeType: "image/png",
      buffer: png(1600, 1200),
    });
    await page.getByRole("button", { name: "Registrar mi negocio", exact: true }).click();
    await expect(page).toHaveURL(THANKS);

    const [saved, ...more] = await businessesOf("7719993001");
    expect(more).toEqual([]);
    expect(saved?.status).toBe("in_review");
    const photoKey = saved?.photoKey ?? "";
    expect(isPhotoKey(photoKey)).toBe(true);
    expect(await objectAnswers(page, photoKey)).toEqual([
      { status: 200, type: "image/webp", cache: PHOTO_CACHE_CONTROL },
      { status: 200, type: "image/webp", cache: PHOTO_CACHE_CONTROL },
    ]);
    // A card in review is referenced nowhere public.
    for (const path of [HOME, `${HOME}/buscar?q=taller`, "/sitemap.xml"]) {
      expect(await (await page.request.get(path)).text(), path).not.toContain(photoKey);
    }
  });

  // Scenario: registering without a photo
  test("without a photo, the card is saved without one and the field says nothing", async ({
    page,
  }) => {
    await page.goto(FORM);
    await fillRequired(page, "7719993002");
    await page.getByRole("button", { name: "Registrar mi negocio", exact: true }).click();
    await expect(page).toHaveURL(THANKS);
    expect(await businessesOf("7719993002")).toEqual([expect.objectContaining({ photoKey: null })]);
  });

  // Scenarios: the photo has to be chosen again; what was entered is not lost
  test("with another field wrong, the photo has to be chosen again; chosen again, it is stored", async ({
    page,
  }) => {
    await page.goto(FORM);
    await fillRequired(page, "771 999 30");
    await photoField(page).setInputFiles({
      name: "foto.webp",
      mimeType: "image/webp",
      buffer: webp(1200, 1600),
    });
    const wrong = await send(page);
    expect(wrong.status()).toBe(400);
    await expect(photoMessage(page)).toHaveText(`⚠ ${NOT_KEPT}`);
    await expect(photoField(page)).toHaveValue("");
    await expect(byLabel(page, "¿Cómo se llama tu negocio?")).toHaveValue(
      "Fotos de Prueba Inventadas",
    );
    await expect(byLabel(page, "Tu WhatsApp (10 dígitos)")).toBeFocused();
    expect(await businessesOf("7719993003")).toEqual([]);

    await byLabel(page, "Tu WhatsApp (10 dígitos)").fill("7719993003");
    await byLabel(
      page,
      "Acepto el aviso de privacidad y confirmo que este negocio es mío o que tengo permiso para registrarlo.",
    ).setChecked(true);
    await photoField(page).setInputFiles({
      name: "foto.webp",
      mimeType: "image/webp",
      buffer: webp(1200, 1600),
    });
    await page.getByRole("button", { name: "Registrar mi negocio", exact: true }).click();
    await expect(page).toHaveURL(THANKS);
    const [saved] = await businessesOf("7719993003");
    expect(isPhotoKey(saved?.photoKey)).toBe(true);
  });

  // Scenarios: file disguised as an image; photo over 5 MB
  test("a file that is no image, or a photo over 5 MB, comes back next to the field with everything written", async ({
    page,
  }) => {
    await page.goto(FORM);
    for (const [file, message, status] of [
      [
        { name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html>hola</html>") },
        UNREADABLE,
        400,
      ],
      [
        {
          name: "foto.png",
          mimeType: "image/png",
          buffer: Buffer.concat([png(10, 10), Buffer.alloc(6_000_000)]),
        },
        TOO_LARGE,
        400,
      ],
    ] as const) {
      await fillRequired(page, "7719993004");
      await photoField(page).setInputFiles(file);
      const answer = await send(page);
      expect(answer.status(), message).toBe(status);
      expect(answer.headers()["cache-control"]).toBe("no-store");
      await expect(photoMessage(page)).toHaveText(`⚠ ${message}`);
      await expect(photoField(page)).toHaveAttribute("aria-invalid", "true");
      await expect(photoField(page)).toBeFocused();
      await expect(byLabel(page, "¿En qué colonia estás?")).toHaveValue("Huicalco");
    }
    expect(await businessesOf("7719993004")).toEqual([]);
  });

  // A body over ACTION_BODY_LIMIT is refused with 413 before it is read
  // (registrationPageFailure in test/worker/registration.test.ts). It is not
  // tested here: Astro's preview proxies to workerd through undici, which
  // fails the request ("fetch failed", a 500) when the Worker answers before
  // the browser has finished sending the body, as it does on a slow runner.

  // Scenarios: removing the photo on resubmission; changing the photo on
  // resubmission; the form does not give away the rejection
  test("a rejected card resubmitted changes its photo, then loses it with Dejar mi ficha sin foto", async ({
    page,
  }) => {
    const whatsapp = "7719993006";
    const reject = () =>
      withDatabase(async (db) => {
        await db
          .update(businesses)
          .set({ status: "rejected", rejectedAt: new Date(), rejectionReason: "Foto borrosa" })
          .where(and(eq(businesses.localityCode, TIZAYUCA), eq(businesses.whatsapp, whatsapp)));
      });

    await page.goto(FORM);
    await fillRequired(page, whatsapp);
    await photoField(page).setInputFiles({
      name: "a.png",
      mimeType: "image/png",
      buffer: png(800, 600),
    });
    await page.getByRole("button", { name: "Registrar mi negocio", exact: true }).click();
    await expect(page).toHaveURL(THANKS);
    const first = (await businessesOf(whatsapp))[0]?.photoKey ?? "";
    expect(isPhotoKey(first)).toBe(true);

    // Rejected, it comes back with another photo: the old objects are gone.
    await reject();
    await page.goto(FORM);
    await fillRequired(page, whatsapp);
    await photoField(page).setInputFiles({
      name: "b.webp",
      mimeType: "image/webp",
      buffer: webp(1600, 900),
    });
    await page.getByRole("button", { name: "Registrar mi negocio", exact: true }).click();
    await expect(page).toHaveURL(THANKS);
    expect(await page.content()).not.toContain("Foto borrosa");
    const second = (await businessesOf(whatsapp))[0]?.photoKey ?? "";
    expect(isPhotoKey(second)).toBe(true);
    expect(second).not.toBe(first);
    expect((await objectAnswers(page, first)).map(({ status }) => status)).toEqual([404, 404]);
    expect((await objectAnswers(page, second)).map(({ status }) => status)).toEqual([200, 200]);

    // Rejected again, it comes back without a photo.
    await reject();
    await page.goto(FORM);
    await fillRequired(page, whatsapp);
    await removePhoto(page).setChecked(true);
    await page.getByRole("button", { name: "Registrar mi negocio", exact: true }).click();
    await expect(page).toHaveURL(THANKS);
    expect(await businessesOf(whatsapp)).toEqual([
      expect.objectContaining({ status: "in_review", photoKey: null }),
    ]);
    expect((await objectAnswers(page, second)).map(({ status }) => status)).toEqual([404, 404]);
  });
});
