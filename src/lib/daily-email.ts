// Worker bindings and external delivery stay outside the business rules.
import { withDb } from "../core/db/client.ts";
import {
  runDailyAdminEmail,
  type DailyEmailOptions,
  type DailyEmailCounts,
} from "../core/notifications/daily.ts";
import { businessesPath, queuePath } from "../core/review/paths.ts";
import { cachedMediaOrigin, type MediaBucketEnv } from "./media-bucket.ts";
import { mediaPhotoFolder } from "./media-folder.ts";
import { sendResendBatch } from "./resend.ts";
import { absoluteUrl } from "./site-url.ts";

export async function dailyAdminEmail(
  env: MediaBucketEnv & Pick<Env, "ENVIRONMENT" | "SITE_URL" | "RESEND_API_KEY">,
  now: Date,
  ctx: Pick<ExecutionContext, "waitUntil">,
  send?: DailyEmailOptions["send"],
): Promise<DailyEmailCounts> {
  const dryRun = env.ENVIRONMENT === "local" && !env.RESEND_API_KEY;
  const counts = await withDb(env, "HYPERDRIVE_FRESH", ctx, (db) =>
    runDailyAdminEmail(db, now, {
      environment: env.ENVIRONMENT,
      scope: { base: cachedMediaOrigin(env), folder: mediaPhotoFolder(env) },
      links: (locality) => {
        const queue = absoluteUrl(env, queuePath(locality));
        const businesses = absoluteUrl(env, businessesPath({ locality }));
        if (queue === null || businesses === null) throw new Error("daily email: 1 failed");
        return { queue, businesses };
      },
      dryRun,
      send:
        send ??
        ((batch) =>
          env.RESEND_API_KEY ? sendResendBatch(batch, env.RESEND_API_KEY) : Promise.resolve(false)),
    }),
  );
  if (dryRun)
    console.log(`daily email: ${counts.previewed} previewed, 0 sent, ${counts.skipped} skipped`);
  return counts;
}
