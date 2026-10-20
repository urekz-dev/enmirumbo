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
// - `orphan-photo-sweep`: once a UTC day, lists `photos/` in the environment's
//   R2 bucket and removes only the photos that no card or pending edit names
//   and that are older than seven days. A pass that reaches its bound
//   continues on the next hourly run; a failed page stays at its cursor and
//   fails the run, with counts only.
import { withDb } from "./core/db/client.ts";
import { failureKind } from "./core/db/failure.ts";
import { retryCachePurges } from "./core/photos/cache.ts";
import { sweepOrphanPhotos } from "./core/photos/sweep.ts";
import { runRegistrationThresholdTask } from "./core/registration/threshold.ts";
import { cachePurger, mediaBucket } from "./lib/media-bucket.ts";

/** A task of the hourly job: what it did, as counts. */
export interface ScheduledTask {
  name: string;
  run: (env: Env, now: Date, ctx: ExecutionContext) => Promise<Record<string, number>>;
}

/** A task that ran but could not do all it had to; its message is counts only. */
export class IncompleteTask extends Error {
  override readonly name = "IncompleteTask";
}

/**
 * One bounded run of the orphan-photo sweep. A run that could not sweep what
 * it reached (a failed listing, lookup or deletion, or an object under
 * `photos/` that is no photo) fails with counts only; stopping at a bound is
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
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Record<string, number>> {
  if (env.ENVIRONMENT === "local") return { purged: 0, waiting: 0 };
  const { purged, waiting, failed } = await withDb(env, "HYPERDRIVE_FRESH", ctx, (db) =>
    retryCachePurges(db, cachePurger(env)),
  );
  if (failed > 0) {
    throw new IncompleteTask(`${purged} purged, ${waiting} waiting, ${failed} failed purge(s)`);
  }
  return { purged, waiting };
}

export const SCHEDULED_TASKS: readonly ScheduledTask[] = [
  {
    name: "registration-threshold",
    run: (env, now, ctx) =>
      withDb(env, "HYPERDRIVE_FRESH", ctx, (db) => runRegistrationThresholdTask(db, now)),
  },
  { name: "photo-cache-purge", run: (env, _now, ctx) => purgeWaitingPhotos(env, ctx) },
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
