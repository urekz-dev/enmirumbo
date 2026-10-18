// Playwright global setup: the public pages need a migrated database with an
// active locality. It applies the migrations and the fictitious seed, which
// turns Tizayuca on while it has no contact WhatsApp, to the database that
// `astro preview` reaches (playwright.config.ts): DATABASE_URL, or the local
// development database. Both are idempotent, the same as `vp run db:migrate`
// and `vp run db:seed`, and only a database on this machine is accepted. Like
// `vp run db:seed`, it writes the seeded photos to the local media bucket,
// which the preview serves under /_media/ (scripts/seed-media.ts).
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "../../src/core/db/schema/index.ts";
import { seed } from "../../src/core/db/seed/index.ts";
import { seedPhotoObjects } from "../../src/core/db/seed/photos.ts";
import { isLocalConnectionString, LOCAL_DATABASE_URL } from "../../src/core/db/url.ts";
import { writeLocalSeedMedia } from "../../scripts/seed-media.ts";

export default async function setup(): Promise<void> {
  const url = process.env["DATABASE_URL"] ?? LOCAL_DATABASE_URL;
  if (!isLocalConnectionString(url)) {
    throw new Error("e2e: DATABASE_URL is not a local database; the end-to-end tests seed it.");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const report = await seed(db);
    await writeLocalSeedMedia(seedPhotoObjects(report.photos));
  } finally {
    await client.end();
  }
}
