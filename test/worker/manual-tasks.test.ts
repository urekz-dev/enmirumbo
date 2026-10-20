import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { panelHome } from "../../src/core/access/home.ts";
import { can } from "../../src/core/access/queries.ts";
import { roleAssignments, rolePermissions, roles, users } from "../../src/core/db/schema/index.ts";
import { TASKS_PATH } from "../../src/core/review/paths.ts";
import { manualTasksEnabled, taskTimeZones } from "../../src/core/tasks/access.ts";
import { taskInstant, wallTime } from "../../src/core/tasks/time.ts";
import { forbiddenResponse, gateAdminRequest } from "../../src/lib/access/admin-gate.ts";
import { notFound } from "../../src/lib/locality.ts";
import {
  hiddenTaskRequest,
  readTaskResult,
  submitManualTask,
  taskResultPath,
} from "../../src/lib/manual-tasks.ts";
import { IncompleteTask } from "../../src/scheduled.ts";
import { db } from "./fixtures.ts";

const EMAIL = "runner@tasks.enmirumbo.test";
const DENIED = "denied@tasks.enmirumbo.test";
const ROLE = "emr54_tasks";
async function clean(): Promise<void> {
  await db(async (tx) => {
    await tx.delete(users).where(like(users.email, "%@tasks.enmirumbo.test"));
    await tx.delete(roles).where(eq(roles.key, ROLE));
  });
}
beforeAll(async () => {
  await clean();
  await db(async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({ key: ROLE, name: "Tareas de prueba", scope: "global" })
      .returning();
    await tx.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "tasks.run" });
    for (const email of [EMAIL, DENIED]) {
      const [user] = await tx
        .insert(users)
        .values({ email, name: "Persona de prueba" })
        .returning();
      if (email === EMAIL)
        await tx
          .insert(roleAssignments)
          .values({ userId: user!.id, roleId: role!.id, roleScope: "global" });
    }
  });
});
afterAll(clean);

const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    task: "probe",
    zone: "America/Mexico_City",
    time: "2026-10-19T03:00",
    intent: "run",
    ...overrides,
  }))
    data.set(key, value);
  return data;
};

describe("manual scheduled tasks (EMR-54)", () => {
  it.each(["local", "dev"])("serves the page and action on %s", async (environment) => {
    expect(manualTasksEnabled(environment)).toBe(true);
    expect(
      hiddenTaskRequest(environment, new URL(`http://localhost${TASKS_PATH}`), TASKS_PATH),
    ).toBeNull();
    const run = vi.fn(async () => ({ done: 2 }));
    const ctx = createExecutionContext();
    const outcome = await submitManualTask(
      form(),
      environment,
      TASKS_PATH,
      async () => ["America/Mexico_City"],
      env,
      ctx,
      [{ name: "probe", run }],
    );
    expect(outcome).toEqual({
      kind: "done",
      result: {
        task: "probe",
        instant: "2026-10-19T09:00:00.000Z",
        failed: false,
        counts: "2 done",
      },
    });
    expect(run).toHaveBeenCalledExactlyOnceWith(env, new Date("2026-10-19T09:00:00Z"), ctx);
    await waitOnExecutionContext(ctx);
  });

  it.each(["stage", "prod"])(
    "uses the missing panel response for page and action on %s, before database access",
    async (environment) => {
      const lookup = vi.fn(async () => {
        throw new Error("must not read the database");
      });
      const run = vi.fn(async () => ({ done: 1 }));
      const ctx = createExecutionContext();
      for (const path of [
        TASKS_PATH,
        `${TASKS_PATH}?_action=admin.runTask`,
        "/_actions/admin.runTask",
        "/_actions/admin.runTask/",
        "/_actions/admin%2erunTask",
        "/admin/usuarios?_action=admin%252erunTask",
        "/admin/usuarios?_action=admin.runTask",
      ]) {
        const url = new URL(path, "http://localhost");
        const response = await gateAdminRequest(
          { url, request: new Request(url), routePattern: url.pathname, locals: {} },
          async () => hiddenTaskRequest(environment, url, url.pathname) ?? notFound(),
          {
            config: { environment: "local", teamDomain: "", aud: "" },
            keys: () => {
              throw new Error("unused");
            },
          },
        );
        const missingUrl = new URL("http://localhost/admin/missing-emr54");
        const missing = await gateAdminRequest(
          { url: missingUrl, request: new Request(missingUrl), routePattern: "/404", locals: {} },
          async () => notFound(),
          {
            config: { environment: "local", teamDomain: "", aud: "" },
            keys: () => {
              throw new Error("unused");
            },
          },
        );
        expect(response.status).toBe(missing.status);
        expect([...response.headers]).toEqual([...missing.headers]);
        expect(await response.text()).toBe(await missing.text());
        expect(
          await submitManualTask(form(), environment, url.pathname, lookup, env, ctx, [
            { name: "probe", run },
          ]),
        ).toEqual({ kind: "not_found" });
      }
      expect(lookup).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("refuses a wrong action target and a missing permission before running anything", async () => {
    const run = vi.fn(async () => ({ done: 1 }));
    const ctx = createExecutionContext();
    const lookup = vi.fn(() => db((tx) => taskTimeZones(tx, DENIED)));
    expect(
      await submitManualTask(form(), "local", "/admin", lookup, env, ctx, [{ name: "probe", run }]),
    ).toEqual({ kind: "not_found" });
    expect(lookup).not.toHaveBeenCalled();
    expect(
      await submitManualTask(form(), "local", TASKS_PATH, lookup, env, ctx, [
        { name: "probe", run },
      ]),
    ).toEqual({ kind: "forbidden" });
    expect(forbiddenResponse().status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("authorizes tasks.run globally and offers only database time zones", async () => {
    const zones = await db((tx) => taskTimeZones(tx, EMAIL));
    expect(zones).toContain("America/Mexico_City");
    const run = vi.fn(async () => ({ done: 1 }));
    const ctx = createExecutionContext();
    expect(
      await submitManualTask(
        form(),
        "local",
        TASKS_PATH,
        () => db((tx) => taskTimeZones(tx, EMAIL)),
        env,
        ctx,
        [{ name: "probe", run }],
      ),
    ).toMatchObject({ kind: "done" });
    expect(run).toHaveBeenCalledTimes(1);
    for (const environment of ["local", "dev", "stage", "prod"]) {
      const home = await db((tx) => panelHome(tx, EMAIL, environment));
      expect(home?.links.some((link) => link.href === TASKS_PATH)).toBe(
        manualTasksEnabled(environment),
      );
      expect(
        (await db((tx) => panelHome(tx, DENIED, environment)))?.links.some(
          (link) => link.href === TASKS_PATH,
        ),
      ).toBeFalsy();
    }
  });

  it("the migration grants the new permission only to the super admin base role", async () => {
    const rows = await db((tx) =>
      tx.select().from(rolePermissions).where(eq(rolePermissions.permissionKey, "tasks.run")),
    );
    expect(rows).toHaveLength(1); // Only this file's explicit test role.
    expect(
      (await db((tx) => tx.select().from(roles).where(eq(roles.key, "super_admin"))))[0]
        ?.allPermissions,
    ).toBe(true);
    expect(await db((tx) => can(tx, DENIED, "tasks.run", null))).toBe(false);
    expect(
      (await db((tx) => tx.select().from(roles).where(eq(roles.key, "locality_admin"))))[0]
        ?.allPermissions,
    ).toBe(false);
  });

  it("shows counts-only failures and never exposes an unexpected error message", async () => {
    const ctx = createExecutionContext();
    const log = vi.spyOn(console, "error");
    for (const [error, counts] of [
      [new IncompleteTask("2 purged, 1 failed"), "2 purged, 1 failed"],
      [new Error("private card content"), "1 failed"],
    ] as const) {
      const result = await submitManualTask(
        form(),
        "local",
        TASKS_PATH,
        async () => ["America/Mexico_City"],
        env,
        ctx,
        [
          {
            name: "probe",
            run: async () => {
              throw error;
            },
          },
        ],
      );
      expect(result).toMatchObject({ kind: "done", result: { failed: true, counts } });
    }
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("private card content"));
  });

  it("validates task, zone and time and previews without running", async () => {
    const ctx = createExecutionContext();
    const run = vi.fn(async () => ({ done: 1 }));
    const submit = (data: FormData) =>
      submitManualTask(data, "local", TASKS_PATH, async () => ["America/Mexico_City"], env, ctx, [
        { name: "probe", run },
      ]);
    expect(
      await submit(form({ task: "invented", zone: "UTC", time: "2026-02-30T03:00" })),
    ).toMatchObject({
      kind: "invalid",
      errors: { task: expect.any(String), zone: expect.any(String), time: expect.any(String) },
    });
    expect(await submit(form({ intent: "preview" }))).toEqual({
      kind: "preview",
      instant: "2026-10-19T09:00:00.000Z",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("reads the redirected result repeatedly without executing a task and ignores unreadable queries", () => {
    const result = {
      task: "photo-cache-purge",
      instant: "2026-10-19T09:00:00.000Z",
      failed: false,
      counts: "0 purged, 0 waiting",
    };
    const params = new URL(taskResultPath(result), "http://localhost").searchParams;
    expect(readTaskResult(params)).toEqual(result);
    expect(readTaskResult(params)).toEqual(result);
    params.set("conteos", "private card content");
    expect(readTaskResult(params)).toBeNull();
    expect(readTaskResult(new URLSearchParams())).toBeNull();
  });

  it("converts wall clocks and rejects invalid dates, gaps and ambiguous daylight-saving times", () => {
    expect(wallTime(new Date("2026-10-19T09:00:00Z"), "America/Mexico_City")).toBe(
      "2026-10-19T03:00",
    );
    expect(taskInstant("2026-10-19T03:00", "America/Mexico_City")?.toISOString()).toBe(
      "2026-10-19T09:00:00.000Z",
    );
    for (const time of ["2026-03-08T02:30", "2026-11-01T01:30", "2026-02-30T03:00", "bad"])
      expect(taskInstant(time, "America/New_York")).toBeNull();
  });
});
