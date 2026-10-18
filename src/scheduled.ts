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
import { withDb } from "./core/db/client.ts";
import { failureKind } from "./core/db/failure.ts";
import { runRegistrationThresholdTask } from "./core/registration/threshold.ts";

/** A task of the hourly job: what it did, as counts. */
export interface ScheduledTask {
  name: string;
  run: (env: Env, now: Date, ctx: ExecutionContext) => Promise<Record<string, number>>;
}

export const SCHEDULED_TASKS: readonly ScheduledTask[] = [
  {
    name: "registration-threshold",
    run: (env, now, ctx) =>
      withDb(env, "HYPERDRIVE_FRESH", ctx, (db) => runRegistrationThresholdTask(db, now)),
  },
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
      console.error(`scheduled: ${task.name} failed (${failureKind(error)})`);
      failed.push(task.name);
    }
  }
  if (failed.length > 0) {
    throw new Error(`scheduled: ${failed.length} task(s) failed: ${failed.join(", ")}`);
  }
}
