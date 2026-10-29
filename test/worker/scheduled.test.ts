import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it, vi } from "vite-plus/test";
import { MAX_DAILY_EMAIL_BATCHES_PER_RUN } from "../../src/core/notifications/daily.ts";
import { MAX_PURGE_REQUESTS_PER_RUN } from "../../src/core/photos/cache.ts";
import { MAX_ORPHAN_SWEEP_PHOTOS_PER_RUN } from "../../src/core/photos/sweep.ts";
import { MAX_PHOTOS_PER_RUN } from "../../src/core/review/purge.ts";
import { runScheduledTasks, SUBREQUEST_LIMIT, SUBREQUEST_RESERVE } from "../../src/scheduled.ts";

it("runs the scheduled handler inside workerd with the Worker bindings", async () => {
  expect(navigator.userAgent).toBe("Cloudflare-Workers");
  expect(typeof env.ASSETS.fetch).toBe("function");

  const log = vi.spyOn(console, "log");
  const controller = createScheduledController({
    cron: "0 * * * *",
    scheduledTime: new Date("2026-10-11T14:00:00Z"),
  });
  const ctx = createExecutionContext();
  // A task of its own: the real tasks purge and sweep what other test files
  // write to the shared database and bucket at the same time.
  const run = vi.fn(async () => ({ done: 1 }));

  await runScheduledTasks(controller, env, ctx, [{ name: "probe", run }]);
  await waitOnExecutionContext(ctx);

  expect(log).toHaveBeenCalledWith('scheduled: cron "0 * * * *" at 2026-10-11T14:00:00.000Z');
  expect(run).toHaveBeenCalledWith(env, new Date("2026-10-11T14:00:00Z"), ctx);
  expect(log).toHaveBeenCalledWith("scheduled: probe done (1 done)");
});

it("the tasks that delete photos fit the subrequests of one run on Workers Free", () => {
  // Each photo deleted is one request to Cloudflare's cache API, and every task
  // of a run shares the invocation's budget (the comment of src/scheduled.ts).
  const spent =
    MAX_PURGE_REQUESTS_PER_RUN +
    MAX_PHOTOS_PER_RUN +
    MAX_ORPHAN_SWEEP_PHOTOS_PER_RUN +
    MAX_DAILY_EMAIL_BATCHES_PER_RUN;
  expect(spent + SUBREQUEST_RESERVE).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
  expect(SUBREQUEST_LIMIT).toBe(50);
});
