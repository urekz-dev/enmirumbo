// Scenarios of docs/specs/business-registration.md, "The registration and edit
// forms are protected by quotas, honeypot and Turnstile (v2)" (daily
// threshold alert) and "The daily registrations alert goes out once per local
// day (v2)"; of docs/specs/deployment.md, "Scheduled work runs from one
// hourly Cron Trigger per environment (v2)" (idempotent; a task that fails);
// and of docs/specs/data-model.md, "The locality is a first-class record
// keyed by the INEGI municipality code (v2)" (the threshold's default). The
// task (src/core/registration/threshold.ts) and the hourly job that runs it
// (src/scheduled.ts), with the database.
//
// The localities are this file's fixtures: A in Mexico City's time zone and
// B in Tijuana's, both active. Every run is in January 2030, a month no other
// file registers in, so the task finds only this file's registrations; the
// businesses and the day of the last alert are reset before each test.
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { businesses, localities } from "../../src/core/db/schema/index.ts";
import {
  claimRegistrationThresholdAlerts,
  logRegistrationThresholdAlert,
  type RegistrationThresholdAlert,
  runRegistrationThresholdTask,
} from "../../src/core/registration/threshold.ts";
import { runScheduledTasks, SCHEDULED_TASKS, type ScheduledTask } from "../../src/scheduled.ts";
import { cleanup, createFixture, db, type Fixture, insertBusiness } from "./fixtures.ts";

const STATE = "88";
let f: Fixture;

beforeAll(async () => {
  f = await createFixture(STATE);
  await db((tx) =>
    tx
      .update(localities)
      .set({ active: true, timeZone: "America/Tijuana" })
      .where(eq(localities.code, f.localityB)),
  );
});

afterAll(async () => {
  await cleanup(STATE);
});

beforeEach(async () => {
  await db(async (tx) => {
    const codes = [f.localityA, f.localityB];
    await tx.delete(businesses).where(inArray(businesses.localityCode, codes));
    await tx
      .update(localities)
      .set({ dailyRegistrationAlertedOn: null, dailyRegistrationThreshold: 2, active: true })
      .where(inArray(localities.code, codes));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `count` organic registrations of locality `code` at `at`. */
async function register(count: number, at: string, code = f.localityA, origin = "organic") {
  for (let n = 0; n < count; n++) {
    await insertBusiness(f, {
      localityCode: code,
      zoneId: code === f.localityA ? f.zoneA : f.zoneB,
      registeredAt: new Date(at),
      origin: origin as "organic" | "seeded",
    });
  }
}

/** The alerts of this file's localities that a run at `at` claims. */
async function claim(at: string): Promise<RegistrationThresholdAlert[]> {
  const alerts = await db((tx) => claimRegistrationThresholdAlerts(tx, new Date(at)));
  return alerts.filter(({ locality }) => locality.startsWith(STATE));
}

describe("The daily registrations alert goes out once per local day (v2)", () => {
  it("a locality takes a threshold of 20 unless it says otherwise", async () => {
    const [created] = await db((tx) =>
      tx
        .select({ threshold: localities.dailyRegistrationThreshold })
        .from(localities)
        .where(eq(localities.code, "13069")),
    );
    expect(created?.threshold).toBe(20);
  });

  // Scenario: daily threshold alert (no alert under the threshold)
  it("as many registrations as the threshold alert nothing; one more alerts", async () => {
    // 10:00 in Mexico City is 16:00 UTC.
    await register(2, "2030-01-10T16:00:00Z");
    expect(await claim("2030-01-10T17:00:00Z")).toEqual([]);
    await register(1, "2030-01-10T17:30:00Z");
    expect(await claim("2030-01-10T18:00:00Z")).toEqual([
      { locality: f.localityA, day: "2030-01-10", registrations: 3, threshold: 2 },
    ]);
  });

  it("once a day: the later runs of the day, a repeated run and two runs at once alert nothing more", async () => {
    await register(3, "2030-01-11T16:00:00Z");
    const [first, second] = await Promise.all([
      claim("2030-01-11T17:00:00Z"),
      claim("2030-01-11T17:00:00Z"),
    ]);
    expect([...(first ?? []), ...(second ?? [])]).toHaveLength(1);
    expect(await claim("2030-01-11T17:00:00Z")).toEqual([]);
    await register(5, "2030-01-11T19:00:00Z");
    expect(await claim("2030-01-11T20:00:00Z")).toEqual([]);
    expect(await claim("2030-01-12T05:00:00Z")).toEqual([]);
  });

  it("the first run after the threshold is passed alerts, even after a run that did not happen", async () => {
    await register(3, "2030-01-12T16:10:00Z");
    // The run of 17:00 never happened; the one of 18:00 alerts.
    expect(await claim("2030-01-12T18:00:00Z")).toHaveLength(1);
  });

  // Scenario: another time zone; the local hour
  it("the day is the locality's own, in its time zone", async () => {
    // 23:30 of the 13th in Mexico City (05:30 UTC of the 14th): the 13th.
    await register(2, "2030-01-14T05:30:00Z");
    // 01:00 of the 14th there, with one registration of the 14th: no alert.
    await register(1, "2030-01-14T06:30:00Z");
    expect(await claim("2030-01-14T07:00:00Z")).toEqual([]);
    // At 23:45 of the 13th there, the 13th has two: no alert either.
    expect(await claim("2030-01-14T05:45:00Z")).toEqual([]);

    // Three at 22:00 of the 14th in Tijuana (UTC-8), already the 15th in UTC
    // and in Mexico City: they are B's 14th.
    await register(3, "2030-01-15T06:00:00Z", f.localityB);
    expect(await claim("2030-01-15T07:45:00Z")).toEqual([
      { locality: f.localityB, day: "2030-01-14", registrations: 3, threshold: 2 },
    ]);
    // At midnight in Tijuana its day starts again from zero.
    expect(await claim("2030-01-15T08:00:00Z")).toEqual([]);
  });

  it("a new day counts from zero and may alert again", async () => {
    await register(3, "2030-01-16T16:00:00Z");
    expect(await claim("2030-01-16T17:00:00Z")).toHaveLength(1);
    await register(2, "2030-01-17T16:00:00Z");
    expect(await claim("2030-01-17T17:00:00Z")).toEqual([]);
    await register(1, "2030-01-17T17:10:00Z");
    expect(await claim("2030-01-17T18:00:00Z")).toEqual([
      { locality: f.localityA, day: "2030-01-17", registrations: 3, threshold: 2 },
    ]);
  });

  // Scenario: daily threshold alert (other localities unaffected)
  it("each locality against its own threshold; an inactive one, one without a threshold and the admin's cards do not count", async () => {
    await register(3, "2030-01-18T16:00:00Z");
    await register(3, "2030-01-18T18:00:00Z", f.localityB);
    await db((tx) =>
      tx
        .update(localities)
        .set({ dailyRegistrationThreshold: 3 })
        .where(eq(localities.code, f.localityB)),
    );
    expect((await claim("2030-01-18T20:00:00Z")).map(({ locality }) => locality)).toEqual([
      f.localityA,
    ]);

    await register(5, "2030-01-19T16:00:00Z", f.localityA, "seeded");
    await register(5, "2030-01-19T18:00:00Z", f.localityB);
    await db(async (tx) => {
      await tx
        .update(localities)
        .set({ dailyRegistrationThreshold: null })
        .where(eq(localities.code, f.localityB));
    });
    expect(await claim("2030-01-19T20:00:00Z")).toEqual([]);
    await db((tx) =>
      tx
        .update(localities)
        .set({ dailyRegistrationThreshold: 2, active: false })
        .where(eq(localities.code, f.localityB)),
    );
    expect(await claim("2030-01-19T21:00:00Z")).toEqual([]);
  });

  it("the alert is one structured line in the log, with counts and the locality's code alone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register(3, "2030-01-20T16:00:00Z");
    const sent: RegistrationThresholdAlert[] = [];
    const result = await db((tx) =>
      runRegistrationThresholdTask(tx, new Date("2030-01-20T17:00:00Z"), async (alert) => {
        if (alert.locality.startsWith(STATE)) sent.push(alert);
      }),
    );
    expect(result.alerts).toBeGreaterThanOrEqual(1);
    expect(sent).toEqual([
      { locality: f.localityA, day: "2030-01-20", registrations: 3, threshold: 2 },
    ]);

    await logRegistrationThresholdAlert(sent[0]!);
    expect(warn).toHaveBeenCalledWith({
      message: "registration: the daily registrations of a locality passed its threshold",
      alert: "daily-registrations",
      locality: f.localityA,
      day: "2030-01-20",
      registrations: 3,
      threshold: 2,
    });
  });
});

describe("Scheduled work runs from one hourly Cron Trigger per environment (v2)", () => {
  const controller = (at: string) =>
    createScheduledController({ cron: "0 * * * *", scheduledTime: new Date(at) });
  /** Waits for what the job leaves for later: the database connections it closes. */
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  afterEach(async () => {
    await Promise.all(pending.splice(0));
  });
  // The orphan-photo sweep keeps its cursor in one shared row that its own test file
  // drives, so this file runs the task it is about (and not the retention purge, which at a far
  // date would purge the rejected cards of the files that run at the same time).
  const thresholdOnly = SCHEDULED_TASKS.filter(({ name }) => name === "registration-threshold");

  it("the hourly job runs the threshold task at the time it was scheduled for, and logs the counts", async () => {
    expect(SCHEDULED_TASKS.map(({ name }) => name)).toEqual([
      "registration-threshold",
      "photo-cache-purge",
      "retention-purge",
      "orphan-photo-sweep",
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register(3, "2030-01-21T16:00:00Z");
    await runScheduledTasks(controller("2030-01-21T17:00:00Z"), env, ctx, thresholdOnly);
    expect(log).toHaveBeenCalledWith('scheduled: cron "0 * * * *" at 2030-01-21T17:00:00.000Z');
    expect(log.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^scheduled: registration-threshold done \(\d+ alerts\)$/),
      ]),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ alert: "daily-registrations", locality: f.localityA }),
    );

    // Scenario: idempotent. The same run again changes nothing and does not fail.
    warn.mockClear();
    await runScheduledTasks(controller("2030-01-21T17:00:00Z"), env, ctx, thresholdOnly);
    expect(warn.mock.calls.flat()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ locality: f.localityA })]),
    );
  });

  // Scenario: a task that fails
  it("a task that fails is logged by its name and kind, the others run, and the run fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ran: string[] = [];
    const tasks: ScheduledTask[] = [
      {
        name: "breaks",
        run: async () => {
          throw Object.assign(new Error("connection lost to 7719990001"), { code: "57P01" });
        },
      },
      {
        name: "works",
        run: async () => {
          ran.push("works");
          return { things: 2 };
        },
      },
    ];
    await expect(
      runScheduledTasks(controller("2030-01-22T17:00:00Z"), env, ctx, tasks),
    ).rejects.toThrow("scheduled: 1 task(s) failed: breaks");
    expect(ran).toEqual(["works"]);
    expect(error).toHaveBeenCalledWith("scheduled: breaks failed (PostgreSQL 57P01)");
    expect(JSON.stringify(error.mock.calls)).not.toContain("7719990001");
  });
});
