// Where the fictitious seed writes its photos (docs/specs/data-model.md, "The
// demo seed leaves cards with a photo to see the directory as the resident
// will see it"; ADR 0011): `vp run db:seed` and the global setup of the
// end-to-end tests draw them (src/core/db/seed/photos.ts) and write them here.
//
// - Locally, to the local media bucket: Miniflare's R2, in .wrangler/state/v3,
//   the same storage `vp run dev` and `vp run preview` serve under /_media/.
//   Wrangler's getPlatformProxy opens it with a configuration of the bucket
//   alone, so no other binding of the local Worker starts.
// - On a deploy to dev or stage, to a directory with a manifest, which
//   scripts/deploy/upload-seed-media.sh uploads to the media bucket of dev and
//   stage through R2's S3 API in a step of its own, the only one with the R2
//   token. The seed step never holds that token, and the upload step never
//   holds the database's.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getPlatformProxy, unstable_readConfig } from "wrangler";
import { writeSeedPhotos, type SeedPhotoObject } from "../src/core/db/seed/photos.ts";

/** Wrangler's local state, where `vp run dev` and `vp run preview` keep their bindings. */
const LOCAL_STATE = resolve(".wrangler/state/v3");

/** The bucket of the local Worker's MEDIA binding, as wrangler.jsonc names it. */
function localMediaBucket(): string {
  const config = unstable_readConfig({ config: "wrangler.jsonc" }) as {
    r2_buckets: { binding: string; bucket_name?: string }[];
  };
  const bucket = config.r2_buckets.find(({ binding }) => binding === "MEDIA")?.bucket_name;
  if (bucket === undefined) throw new Error("db:seed: wrangler.jsonc binds no MEDIA bucket");
  return bucket;
}

/** Writes the objects to the local media bucket. */
export async function writeLocalSeedMedia(objects: readonly SeedPhotoObject[]): Promise<void> {
  if (objects.length === 0) return;
  const directory = await mkdtemp(join(tmpdir(), "enmirumbo-seed-media-"));
  try {
    const configPath = join(directory, "wrangler.json");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "enmirumbo-seed-media",
        compatibility_date: "2026-10-01",
        r2_buckets: [{ binding: "MEDIA", bucket_name: localMediaBucket() }],
      }),
    );
    const proxy = await getPlatformProxy<{ MEDIA: R2Bucket }>({
      configPath,
      persist: { path: LOCAL_STATE },
    });
    try {
      await writeSeedPhotos(proxy.env.MEDIA, objects);
    } finally {
      await proxy.dispose();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** One object of the manifest the upload reads. */
export interface ManifestEntry {
  key: string;
  /** The file, relative to the directory of the manifest. */
  file: string;
  contentType: string;
  cacheControl: string;
  bytes: number;
  /** Base64, for the upload's Content-MD5, which R2 checks. */
  md5: string;
}

/** The name of the manifest in the directory. */
export const MANIFEST = "manifest.json";

/**
 * Writes the objects as files under `directory`, at their keys, and the
 * manifest that names them; whatever the directory held before is removed.
 */
export async function writeSeedMediaDirectory(
  directory: string,
  objects: readonly SeedPhotoObject[],
): Promise<void> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const manifest: ManifestEntry[] = [];
  for (const { key, body, contentType, cacheControl } of objects) {
    const file = join("objects", key);
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await writeFile(join(directory, file), body);
    manifest.push({
      key,
      file,
      contentType,
      cacheControl,
      bytes: body.length,
      md5: createHash("md5").update(body).digest("base64"),
    });
  }
  await writeFile(join(directory, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}
