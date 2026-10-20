// Idempotent seed runner: `vp run db:seed`. Fictitious businesses only
// (src/core/db/seed), and the photos of those that have one; reference data
// ships in the migrations. It never runs against prod, and runs against a
// remote database only when ENVIRONMENT names a non-production environment.
//
// The photos go to the local media bucket (scripts/seed-media.ts), or, with
// ENVIRONMENT dev or stage, to the directory SEED_MEDIA_DIR, which the deploy
// uploads to the media bucket of dev and stage in its next step
// (scripts/deploy/upload-seed-media.sh).
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/core/db/schema/index.ts";
import { seed, seedSummary } from "../src/core/db/seed/index.ts";
import { seedPhotoObjects } from "../src/core/db/seed/photos.ts";
import {
  assertSafeConnectionString,
  isLocalConnectionString,
  LOCAL_DATABASE_URL,
} from "../src/core/db/url.ts";
import { writeLocalSeedMedia, writeSeedMediaDirectory } from "./seed-media.ts";
import { mediaPhotoFolder } from "../src/lib/media-folder.ts";

const url = process.env["DATABASE_URL"] ?? LOCAL_DATABASE_URL;
// Typed as string on purpose: `wrangler types` narrows ENVIRONMENT to the local value.
const environment: string | undefined = process.env["ENVIRONMENT"];
const deployed = environment === "dev" || environment === "stage";
const mediaDirectory = process.env["SEED_MEDIA_DIR"] ?? "";

if (environment === "prod") {
  console.log("db:seed: skipped, seeds never run against prod.");
  process.exit(0);
}
if (!isLocalConnectionString(url) && !deployed) {
  console.error(
    "db:seed: refused, DATABASE_URL is not a local database. " +
      "Set ENVIRONMENT=dev or ENVIRONMENT=stage to seed a remote database.",
  );
  process.exit(1);
}
if (deployed && mediaDirectory === "") {
  console.error(
    `db:seed: refused, ENVIRONMENT=${environment} needs SEED_MEDIA_DIR, the directory ` +
      "where the seeded photos are written for scripts/deploy/upload-seed-media.sh.",
  );
  process.exit(1);
}
assertSafeConnectionString(url);

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const report = await seed(
    drizzle({ client, schema }),
    new Date(),
    mediaPhotoFolder({ ENVIRONMENT: environment }),
  );
  for (const line of seedSummary(report)) console.log(line);
  const objects = seedPhotoObjects(report.photos);
  if (deployed) {
    await writeSeedMediaDirectory(mediaDirectory, objects);
    console.log(
      `db:seed: ${report.photos.length} fictitious photos (${objects.length} objects) ` +
        `written to ${mediaDirectory} for the upload to the media bucket.`,
    );
  } else {
    await writeLocalSeedMedia(objects);
    console.log(
      `db:seed: ${report.photos.length} fictitious photos (${objects.length} objects) ` +
        "written to the local media bucket.",
    );
  }
  console.log("db:seed: done.");
} finally {
  await client.end();
}
