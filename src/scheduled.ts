// The hourly jobs (ADR 0013; docs/specs/deployment.md, "Scheduled work runs
// from one hourly Cron Trigger per environment (v2)"). Every run runs every
// task, at the time the trigger was scheduled for, and each task decides by
// the local day or hour of each locality whether it has something to do. A
// task that fails is logged by its name and the kind of failure, the others
// still run, and the run then fails, so Cloudflare reports it. Each task logs
// what it did as counts.
//
// The tasks:
// - `registration-threshold`: the daily registrations alert
//   (src/core/registration/threshold.ts).
// - `photo-cache-purge`: purges the addresses of deleted photos whose purge
//   from the cache of the media hostname failed (src/core/photos/cache.ts),
//   every run, whatever the hour. A run that cannot purge one fails, with
//   counts only, until they are purged. The local Worker has no such cache,
//   so nothing ever waits there and the task does nothing.
// - `retention-purge`: the purge of the rejected cards 90 days after their
//   rejection and of the pending edits 30 days after they were resolved
//   (src/core/review/purge.ts), by each locality's local days. Called every
//   run, it purges only the localities whose local hour is 3 (03:00 in their
//   own time zone) and does nothing in the others, a bounded amount of work a
//   run. A run that could not purge an item fails, with counts only, and the
//   next day's 03:00 run tries it again.
// - `orphan-photo-sweep`: once a UTC day, lists the owned photo folder in the environment's
//   R2 bucket and removes only the photos that no card or pending edit names
//   and that are older than seven days. A pass that reaches its bound
//   continues on the next hourly run; a failed page stays at its cursor and
//   fails the run, with counts only.
//
// The budget: Workers Free allows 50 subrequests to the internet in one
// invocation, shared by every task of a run, and each photo deleted makes one
// request to Cloudflare's cache API (calls to R2 count against a separate
// limit of 1,000). So the three tasks that delete photos are bounded to
// 10 + 15 + 15 = 40 of them (the purge retry's requests, the photos the
// retention purge deletes and the photos the sweep deletes), and 10 stay in
// reserve, for the admin's daily email (EMR-55) and for the retention purge's
// overshoot: it starts no new item once its 15 photos were deleted, so one
// card can add a photo or two beyond. Workers Paid, from the launch, allows
// 10,000, and the bounds then only keep a run short.
import { withDb } from "./core/db/client.ts";
import { failureKind } from "./core/db/failure.ts";
import { retryCachePurges } from "./core/photos/cache.ts";
import { sweepOrphanPhotos } from "./core/photos/sweep.ts";
import type { MediaBucket } from "./core/photos/upload.ts";
import { runRegistrationThresholdTask } from "./core/registration/threshold.ts";
import { retentionPurgeFailure, runRetentionPurge } from "./core/review/purge.ts";
import {
  cachedMediaOrigin,
  cachePurger,
  mediaBucket,
  type MediaBucketEnv,
} from "./lib/media-bucket.ts";
import { mediaPhotoFolder } from "./lib/media-folder.ts";

/** The subrequests to the internet one invocation may make on Workers Free. */
export const SUBREQUEST_LIMIT = 50;

/** The subrequests of that limit no task's bound spends: the email and the purge's overshoot. */
export const SUBREQUEST_RESERVE = 10;

/** A task of the hourly job: what it did, as counts. */
export interface ScheduledTask {
  name: string;
  run: (
    env: Env,
    now: Date,
    ctx: Pick<ExecutionContext, "waitUntil">,
  ) => Promise<Record<string, number>>;
}

/** A task that ran but could not do all it had to; its message is counts only. */
export class IncompleteTask extends Error {
  override readonly name = "IncompleteTask";
}

/**
 * One bounded run of the orphan-photo sweep. A run that could not sweep what
 * it reached (a failed listing, lookup or deletion, or an object under
 * the owned folder that is no photo) fails with counts only; stopping at a bound is
 * not a failure, the pass continues next hour.
 */
export async function runOrphanPhotoSweepTask(
  env: Env,
  now: Date,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Record<string, number>> {
  const counts = await withDb(env, "HYPERDRIVE_FRESH", ctx, (db) =>
    sweepOrphanPhotos(db, env.MEDIA, mediaBucket(env), now),
  );
  if (counts.incomplete > 0 || counts.invalidObjects > 0) {
    throw new IncompleteTask(
      Object.entries(counts)
        .map(([name, count]) => `${count} ${name}`)
        .join(", "),
    );
  }
  return counts;
}

/** The retry of the purges that failed, with the environment's zone and token. */
export async function purgeWaitingPhotos(
  env: MediaBucketEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Record<string, number>> {
  if (env.ENVIRONMENT === "local") return { purged: 0, waiting: 0 };
  const base = cachedMediaOrigin(env);
  if (base === null) return { purged: 0, waiting: 0 };
  const { purged, waiting, failed } = await withDb(env, "HYPERDRIVE_FRESH", ctx, (db) =>
    retryCachePurges(db, cachePurger(env), { scope: { base, folder: mediaPhotoFolder(env) } }),
  );
  if (failed > 0) {
    throw new IncompleteTask(`${purged} purged, ${waiting} waiting, ${failed} failed purge(s)`);
  }
  return { purged, waiting };
}

/** The purges of rejected cards and resolved edits; the run fails while something could not be purged. */
export async function purgeExpiredRecords(
  env: Env,
  now: Date,
  ctx: Pick<ExecutionContext, "waitUntil">,
  bucket: MediaBucket = mediaBucket(env),
): Promise<Record<string, number>> {
  const report = await withDb(env, "HYPERDRIVE_FRESH", ctx, (db) =>
    runRetentionPurge(db, now, bucket),
  );
  const failure = retentionPurgeFailure(report);
  if (failure !== null) throw new IncompleteTask(failure);
  return report;
}

export const SCHEDULED_TASKS: readonly ScheduledTask[] = [
  {
    name: "registration-threshold",
    run: (env, now, ctx) =>
      withDb(env, "HYPERDRIVE_FRESH", ctx, (db) => runRegistrationThresholdTask(db, now)),
  },
  { name: "photo-cache-purge", run: (env, _now, ctx) => purgeWaitingPhotos(env, ctx) },
  { name: "retention-purge", run: (env, now, ctx) => purgeExpiredRecords(env, now, ctx) },
  { name: "orphan-photo-sweep", run: runOrphanPhotoSweepTask },
];

export async function runScheduledTasks(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
  tasks: readonly ScheduledTask[] = SCHEDULED_TASKS,
): Promise<void> {
  const now = new Date(controller.scheduledTime);
  console.log(`scheduled: cron "${controller.cron}" at ${now.toISOString()}`);
  const failed: string[] = [];
  for (const task of tasks) {
    try {
      const counts = await task.run(env, now, ctx);
      const report = Object.entries(counts)
        .map(([name, count]) => `${count} ${name}`)
        .join(", ");
      console.log(`scheduled: ${task.name} done (${report})`);
    } catch (error) {
      const kind = error instanceof IncompleteTask ? error.message : failureKind(error);
      console.error(`scheduled: ${task.name} failed (${kind})`);
      failed.push(task.name);
    }
  }
  if (failed.length > 0) {
    throw new Error(`scheduled: ${failed.length} task(s) failed: ${failed.join(", ")}`);
  }
}
