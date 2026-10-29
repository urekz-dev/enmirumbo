// The daily email's local clocks, claims, permission recipients and current
// aggregate state, with a fake Resend transport and isolated fixture localities.
import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  dailyAdminEmailState,
  businesses,
  localities,
  municipalities,
  orphanPhotoSweepState,
  pendingEdits,
  photoCachePurges,
  reports,
  roleAssignments,
  rolePermissions,
  roles,
  users,
} from "../../src/core/db/schema/index.ts";
import {
  runDailyAdminEmail,
  dailyRecipients,
  DAILY_EMAIL_RETRY_MS,
  type DailyEmailBatch,
  type DailyEmailOptions,
} from "../../src/core/notifications/daily.ts";
import { dailySummary, reservedEmailDomain } from "../../src/core/notifications/summary.ts";
import { claimRegistrationThresholdAlerts } from "../../src/core/registration/threshold.ts";
import { newPhotoKey } from "../../src/core/photos/photo.ts";
import { dailyAdminEmail } from "../../src/lib/daily-email.ts";
import { SCHEDULED_TASKS, runScheduledTasks } from "../../src/scheduled.ts";
import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import {
  cleanup,
  createFixture,
  db as sharedDb,
  type Fixture,
  businessValues,
} from "./fixtures.ts";

const STATE = "62";
const SCHEMA = "daily_email_test";
// Each call gets its own connection and search path; infrastructure singleton
// state and other files' global reviewers cannot change these assertions.
async function db<T>(
  run: (db: import("../../src/core/db/client.ts").Db) => Promise<T>,
): Promise<T> {
  return sharedDb(async (tx) => {
    await tx.execute(sql.raw(`set search_path to ${SCHEMA}, public`));
    return run(tx);
  });
}
async function insertBusiness(
  fixture: Fixture,
  overrides: Parameters<typeof businessValues>[1] = {},
) {
  const values = businessValues(fixture, overrides);
  await db((tx) => tx.insert(businesses).values(values));
  return values.id;
}
const MARKER = "daily_email_test_";
const NOW = new Date("2030-01-10T14:00:00Z"); // 08:00 Mexico City; 06:00 Tijuana.
const WALL = new Date("2026-10-29T14:00:00Z");
let f: Fixture;
let roleId: number;
let editOnlyRole: number;
const send = vi.fn<(batch: DailyEmailBatch) => Promise<boolean>>();
const options = (overrides: Partial<DailyEmailOptions> = {}): DailyEmailOptions => ({
  environment: "dev",
  scope: { base: "https://media-dev.enmirumbo.com", folder: "dev/photos/" },
  links: (code) => ({
    queue: `https://dev.enmirumbo.com/admin?localidad=${code}`,
    businesses: `https://dev.enmirumbo.com/admin/negocios?localidad=${code}`,
  }),
  send,
  wallClock: () => WALL,
  ...overrides,
});
// A schema containing only our two localities prevents the default scheduled
// query from finding other test files' pending work or global reviewers.
const run = (at = NOW, overrides: Partial<DailyEmailOptions> = {}) =>
  db((tx) => runDailyAdminEmail(tx, at, options(overrides)));

async function addUser(
  part: string,
  domain = "mail.example.com",
  locality = f.localityA,
  active = true,
  role = roleId,
) {
  const email = `${MARKER}${part}@${domain}`;
  const [user] = await db((tx) =>
    tx.insert(users).values({ email, name: "Prueba de avisos", active }).returning(),
  );
  await db((tx) =>
    tx
      .insert(roleAssignments)
      .values({ userId: user!.id, roleId: role, roleScope: "locality", localityCode: locality }),
  );
  return email;
}
async function cleanUsers() {
  await db((tx) => tx.delete(users).where(like(users.email, `${MARKER}%`)));
}
async function reset() {
  await cleanUsers();
  await db(async (tx) => {
    await tx
      .delete(dailyAdminEmailState)
      .where(inArray(dailyAdminEmailState.localityCode, [f.localityA, f.localityB]));
    await tx.delete(businesses).where(inArray(businesses.localityCode, [f.localityA, f.localityB]));
    await tx
      .update(orphanPhotoSweepState)
      .set({ cursor: null, startedAt: null, completedOn: null, photoFolder: null });
    await tx.delete(photoCachePurges);
    await tx
      .update(localities)
      .set({
        dailyRegistrationAlertedOn: null,
        dailyRegistrationAlertSnapshots: null,
        dailyRegistrationThreshold: 20,
      })
      .where(inArray(localities.code, [f.localityA, f.localityB]));
  });
  send.mockReset().mockResolvedValue(true);
}

beforeAll(async () => {
  f = await createFixture(STATE);
  await sharedDb(async (tx) => {
    await tx.execute(sql.raw(`drop schema if exists ${SCHEMA} cascade`));
    await tx.execute(sql.raw(`create schema ${SCHEMA}`));
    for (const table of [
      "states",
      "municipalities",
      "localities",
      "zones",
      "categories",
      "trades",
      "businesses",
      "pending_edits",
      "reports",
      "users",
      "permissions",
      "roles",
      "role_permissions",
      "role_assignments",
      "daily_admin_email_state",
      "orphan_photo_sweep_state",
      "photo_cache_purges",
    ]) {
      await tx.execute(
        sql.raw(`create table ${SCHEMA}.${table} (like public.${table} including all)`),
      );
    }
    for (const table of [
      "states",
      "municipalities",
      "localities",
      "zones",
      "categories",
      "trades",
      "permissions",
    ]) {
      await tx.execute(
        sql.raw(
          `insert into ${SCHEMA}.${table} overriding system value select * from public.${table}`,
        ),
      );
    }
    await tx.execute(
      sql.raw(
        `delete from ${SCHEMA}.localities where code not in ('${f.localityA}', '${f.localityB}')`,
      ),
    );
    await tx.execute(
      sql.raw(`insert into ${SCHEMA}.orphan_photo_sweep_state(singleton) values (true)`),
    );
  });
  await db(async (tx) => {
    await tx
      .update(localities)
      .set({ active: true, timeZone: "America/Tijuana" })
      .where(eq(localities.code, f.localityB));
    await tx.delete(roles).where(like(roles.key, `${MARKER}%`));
    const [reviewer] = await tx
      .insert(roles)
      .values({ key: `${MARKER}review`, name: "Revisar avisos", scope: "locality" })
      .returning();
    const [editor] = await tx
      .insert(roles)
      .values({ key: `${MARKER}edits`, name: "Solo ediciones", scope: "locality" })
      .returning();
    roleId = reviewer!.id;
    editOnlyRole = editor!.id;
    await tx.insert(rolePermissions).values([
      { roleId, permissionKey: "businesses.review" },
      { roleId: editOnlyRole, permissionKey: "edits.review" },
    ]);
  });
});
beforeEach(reset);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await cleanUsers();
  await db((tx) => tx.delete(roles).where(like(roles.key, `${MARKER}%`)));
  await sharedDb((tx) => tx.execute(sql.raw(`drop schema ${SCHEMA} cascade`)));
  await cleanup(STATE);
});

it("starts at 08:00 in each locality's own time zone and does nothing at other hours", async () => {
  await addUser("a");
  await addUser("b", "mail.example.com", f.localityB);
  await insertBusiness(f, { registeredAt: NOW });
  await insertBusiness(f, { localityCode: f.localityB, zoneId: f.zoneB, registeredAt: NOW });
  await run(new Date("2030-01-10T13:00:00Z"));
  expect(send).not.toHaveBeenCalled();
  await run();
  expect(
    send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityA)),
  ).toHaveLength(1);
  expect(
    send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityB)),
  ).toHaveLength(0);
  await run(new Date("2030-01-10T16:00:00Z"));
  expect(
    send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityB)),
  ).toHaveLength(1);
});

it("claims a local day once, including repeated runs and two runs at once; clears the sent payload", async () => {
  await addUser("a");
  await insertBusiness(f, { registeredAt: NOW });
  await Promise.all([run(), run()]);
  expect(
    send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityA)),
  ).toHaveLength(1);
  await run();
  expect(
    send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityA)),
  ).toHaveLength(1);
  const [state] = await db((tx) =>
    tx
      .select()
      .from(dailyAdminEmailState)
      .where(eq(dailyAdminEmailState.localityCode, f.localityA)),
  );
  expect(state).toMatchObject({ completed: true, batch: null, day: "2030-01-10" });
  await run(new Date("2030-01-11T14:00:00Z"));
  expect(
    send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityA)),
  ).toHaveLength(2);
});

it("uses review permission in the locality, skips inactive users and filters reserved domains outside production", async () => {
  const reviewer = await addUser("yes");
  const reserved = await addUser("reserved", "example.org");
  await addUser("inactive", "mail.example.com", f.localityA, false);
  await addUser("edit", "mail.example.com", f.localityA, true, editOnlyRole);
  await addUser("other", "mail.example.com", f.localityB);
  const dev = await db((tx) => dailyRecipients(tx, f.localityA, "dev"));
  expect(dev.recipients.filter((email) => email.startsWith(MARKER))).toEqual([reviewer]);
  expect(dev.skipped).toBeGreaterThanOrEqual(1);
  const prod = await db((tx) => dailyRecipients(tx, f.localityA, "prod"));
  expect(prod.recipients).toEqual(expect.arrayContaining([reviewer, reserved]));
  for (const domain of [
    "test",
    "child.test",
    "child.example",
    "child.invalid",
    "example.com",
    "example.net",
    "example.org",
    "EXAMPLE.ORG.",
  ])
    expect(reservedEmailDomain(`person@${domain}`)).toBe(true);
  expect(reservedEmailDomain("person@team.example.com")).toBe(false);
});

it("does not send when there is nothing to report", async () => {
  await addUser("a");
  // Folder-specific infrastructure state is covered separately below.
  await run(NOW, { scope: { base: null, folder: "dev/photos/" } });
  expect(
    send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityA)),
  ).toHaveLength(0);
});

it("keeps the exact batch after a failed send and retries later that day, with counts only", async () => {
  await addUser("a");
  await insertBusiness(f, { registeredAt: NOW });
  send.mockResolvedValue(false);
  const failed = await run();
  expect(failed.failed).toBeGreaterThanOrEqual(1);
  const original = send.mock.calls.find(([batch]) =>
    batch.idempotencyKey.includes(f.localityA),
  )![0];
  await insertBusiness(f, { registeredAt: NOW });
  send.mockResolvedValue(true);
  await run(new Date("2030-01-10T15:00:00Z"));
  const calls = send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityA));
  expect(calls).toHaveLength(2);
  expect(calls[1]![0]).toEqual(original);
  expect(JSON.stringify(failed)).not.toContain(MARKER);
});

it("never retries an ambiguous request after its 23-hour safety window", async () => {
  await addUser("a");
  await insertBusiness(f, { registeredAt: NOW });
  send.mockResolvedValue(false);
  await run();
  send.mockClear();
  const report = await run(new Date("2030-01-10T15:00:00Z"), {
    wallClock: () => new Date(WALL.getTime() + DAILY_EMAIL_RETRY_MS),
  });
  expect(report.failed).toBeGreaterThanOrEqual(1);
  expect(
    send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityA)),
  ).toHaveLength(0);
});

it("does not send a retained batch to a reviewer whose permission was revoked", async () => {
  const email = await addUser("a");
  await insertBusiness(f, { registeredAt: NOW });
  send.mockResolvedValue(false);
  await run();
  send.mockClear();
  await db((tx) => tx.update(users).set({ active: false }).where(eq(users.email, email)));
  expect((await run(new Date("2030-01-10T15:00:00Z"))).failed).toBeGreaterThanOrEqual(1);
  expect(
    send.mock.calls.filter(([batch]) => batch.idempotencyKey.includes(f.localityA)),
  ).toHaveLength(0);
});

function daysAgo(days: number) {
  return new Date(Date.UTC(2030, 0, 10 - days, 18));
}
function editValues(
  businessId: string,
  status: "pending" | "applied" | "discarded" | "superseded",
  days: number,
) {
  return {
    businessId,
    localityCode: f.localityA,
    name: "PRIVATE EDIT TEXT",
    categoryId: f.categoryId,
    whatsapp: "7719990900",
    zoneId: f.zoneA,
    status,
    createdAt: daysAgo(days),
    resolvedAt: status === "pending" ? null : daysAgo(days),
  };
}

it("includes every section as counts and panel links, with local retention boundaries and no card data", async () => {
  await addUser("a");
  const secretName = "PRIVATE CARD TEXT";
  const old = await insertBusiness(f, {
    name: secretName,
    address: "PRIVATE ADDRESS",
    whatsapp: "7719990901",
    registeredAt: daysAgo(4),
  });
  const resubmitted = await insertBusiness(f, {
    registeredAt: daysAgo(3),
    previousRejectedAt: daysAgo(10),
    previousRejectionReason: "PRIVATE REJECTION",
  });
  const unpublished = await insertBusiness(f, {
    registeredAt: daysAgo(200),
    unpublishedAt: NOW,
    unpublishReason: "PRIVATE UNPUBLISH",
  });
  const published = await insertBusiness(f, {
    status: "published",
    publishedAt: NOW,
    registeredAt: NOW,
  });
  for (const days of [90, 89, 83, 82])
    await insertBusiness(f, {
      status: "rejected",
      rejectedAt: daysAgo(days),
      rejectionReason: "PRIVATE REASON",
    });
  await db(async (tx) => {
    await tx
      .insert(pendingEdits)
      .values([
        editValues(published, "pending", 4),
        editValues(published, "applied", 30),
        editValues(published, "discarded", 29),
        editValues(published, "superseded", 23),
        editValues(published, "applied", 22),
      ]);
    await tx.insert(reports).values({
      businessId: published,
      localityCode: f.localityA,
      reason: "closed",
      comment: "PRIVATE REPORT",
      createdAt: daysAgo(4),
    });
    await tx
      .update(localities)
      .set({ dailyRegistrationAlertedOn: "2030-01-09", dailyRegistrationThreshold: 2 })
      .where(eq(localities.code, f.localityA));
    await tx
      .update(orphanPhotoSweepState)
      .set({ photoFolder: "dev/photos/", startedAt: new Date(NOW.getTime() - 24 * 3600000 - 1) });
    const key = newPhotoKey("dev/photos/");
    await tx
      .insert(photoCachePurges)
      .values([
        { url: `https://media-dev.enmirumbo.com/dev/photos/${key}/card.webp` },
        { url: `https://media.enmirumbo.com/dev/photos/${key}/full.webp` },
      ]);
  });
  await insertBusiness(f, { registeredAt: daysAgo(1), status: "published" });
  await insertBusiness(f, { registeredAt: daysAgo(1), status: "published" });
  await insertBusiness(f, { registeredAt: daysAgo(1), status: "published" });
  const summary = await db((tx) => dailySummary(tx, f.localityA, NOW, options().scope));
  expect(summary).toEqual({
    registrations: 2,
    resubmissions: 1,
    edits: 1,
    reports: 1,
    overdue: 4,
    expiringCards: 2,
    expiringEdits: 2,
    expiredCards: 1,
    expiredEdits: 1,
    cachePurges: 1,
    staleSweep: 1,
    alertRegistrations: 3,
    alertThreshold: 2,
  });
  await run();
  const email = send.mock.calls.find(([batch]) => batch.idempotencyKey.includes(f.localityA))![0];
  for (const literal of [
    "Registros por revisar: 2",
    "Reenvíos: 1",
    "Ediciones pendientes: 1",
    "Reportes sin atender: 1",
    "Pendientes con más de 48 horas: 4",
    "Registros rechazados que cumplen 90 días: 2",
    "Ediciones resueltas que cumplen 30 días: 2",
    "Registros rechazados fuera de plazo: 1",
    "Ediciones resueltas fuera de plazo: 1",
    "caché pendiente: 1",
    "más de un día: 1",
    "Ayer se activó la alerta de registros: 3",
    "Todos los negocios: https://dev.enmirumbo.com/admin/negocios",
    "cola de revisión: https://dev.enmirumbo.com/admin",
  ])
    expect(email.text).toContain(literal);
  for (const privateText of [
    secretName,
    "PRIVATE",
    "7719990901",
    old,
    resubmitted,
    unpublished,
    published,
  ])
    expect(email.text).not.toContain(privateText);
});

it("only flags an unfinished owned sweep after more than 24 hours", async () => {
  await db((tx) =>
    tx
      .update(orphanPhotoSweepState)
      .set({ photoFolder: "dev/photos/", startedAt: new Date(NOW.getTime() - 24 * 3600000) }),
  );
  expect((await db((tx) => dailySummary(tx, f.localityA, NOW, options().scope))).staleSweep).toBe(
    0,
  );
  expect(
    (await db((tx) => dailySummary(tx, f.localityA, new Date(NOW.getTime() + 1), options().scope)))
      .staleSweep,
  ).toBe(1);
  expect(
    (
      await db((tx) =>
        dailySummary(tx, f.localityA, new Date(NOW.getTime() + 1), {
          base: null,
          folder: "photos/",
        }),
      )
    ).staleSweep,
  ).toBe(0);
});

it("fails visibly with more than 100 eligible recipients instead of silently dropping anyone", async () => {
  await insertBusiness(f, { registeredAt: NOW });
  await db(async (tx) => {
    const created = await tx
      .insert(users)
      .values(
        Array.from({ length: 101 }, (_, index) => ({
          email: `${MARKER}many${index}@mail.example.com`,
          name: "Prueba de avisos",
        })),
      )
      .returning({ id: users.id });
    await tx.insert(roleAssignments).values(
      created.map(({ id }) => ({
        userId: id,
        roleId,
        roleScope: "locality" as const,
        localityCode: f.localityA,
      })),
    );
  });
  expect((await run()).failed).toBe(1);
  expect(send).not.toHaveBeenCalled();
});

it("does not retry before 08:00, on another local day or after that day has completed", async () => {
  await addUser("a");
  await insertBusiness(f, { registeredAt: NOW });
  send.mockResolvedValue(false);
  await run();
  send.mockClear();
  await run(new Date("2030-01-10T13:00:00Z"));
  await run(new Date("2030-01-11T07:00:00Z"));
  expect(send).not.toHaveBeenCalled();
});

it("production keeps reserved recipients in the delivered batch", async () => {
  const email = await addUser("reserved", "example.invalid");
  await insertBusiness(f, { registeredAt: NOW });
  await run(NOW, { environment: "prod" });
  expect(
    send.mock.calls.find(([batch]) => batch.idempotencyKey.includes(f.localityA))?.[0].recipients,
  ).toEqual([email]);
});

function isolatedEnv() {
  const connection = new URL(env.HYPERDRIVE_FRESH.connectionString);
  connection.searchParams.set("options", `-csearch_path=${SCHEMA},public`);
  return {
    ...env,
    HYPERDRIVE_FRESH: { ...env.HYPERDRIVE_FRESH, connectionString: connection.toString() },
  };
}
let ctx: ExecutionContext;
beforeEach(() => {
  ctx = createExecutionContext();
});
afterEach(async () => {
  await waitOnExecutionContext(ctx);
});

it("locally without a key builds the email and logs counts only without claiming the day", async () => {
  await addUser("a");
  await insertBusiness(f, { registeredAt: NOW });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const counts = await dailyAdminEmail({ ...isolatedEnv(), RESEND_API_KEY: "" }, NOW, ctx, send);
  expect(counts.previewed).toBe(1);
  expect(log).toHaveBeenCalledWith("daily email: 1 previewed, 0 sent, 0 skipped");
  expect(send).not.toHaveBeenCalled();
  expect(await db((tx) => tx.select().from(dailyAdminEmailState))).toEqual([]);
});

it("the scheduled task fails with counts alone on Resend failure and retries one batch later that day", async () => {
  await addUser("a");
  await addUser("second");
  await insertBusiness(f, { registeredAt: NOW });
  const key = crypto.randomUUID();
  const fake = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ message: key }, { status: 503 }));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const tasks = SCHEDULED_TASKS.filter(({ name }) => name === "daily-admin-email");
  const bindings = { ...isolatedEnv(), RESEND_API_KEY: key };
  const controller = (at: Date) =>
    createScheduledController({ cron: "0 * * * *", scheduledTime: at });
  await expect(runScheduledTasks(controller(NOW), bindings, ctx, tasks)).rejects.toThrow(
    "scheduled: 1 task(s) failed: daily-admin-email",
  );
  expect(fake).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith(
    expect.stringMatching(
      /^scheduled: daily-admin-email failed \(0 sent, 0 emails, 0 skipped, 0 empty, 0 previewed, 1 failed, 0 deferred\)$/,
    ),
  );
  // A single request contains both recipient-specific messages.
  fake.mockResolvedValue(
    Response.json({ data: [{ id: crypto.randomUUID() }, { id: crypto.randomUUID() }] }),
  );
  await runScheduledTasks(controller(new Date("2030-01-10T15:00:00Z")), bindings, ctx, tasks);
  expect(fake).toHaveBeenCalledTimes(2);
  expect(JSON.stringify([...error.mock.calls, ...log.mock.calls])).not.toContain(key);
  expect(JSON.stringify([...error.mock.calls, ...log.mock.calls])).not.toContain(MARKER);
});

it("retains yesterday's threshold alert after today alerts before 08:00", async () => {
  await addUser("a");
  await db((tx) =>
    tx
      .update(localities)
      .set({ dailyRegistrationThreshold: 2 })
      .where(eq(localities.code, f.localityA)),
  );
  for (let index = 0; index < 3; index += 1) await insertBusiness(f, { registeredAt: daysAgo(1) });
  await db((tx) => claimRegistrationThresholdAlerts(tx, new Date("2030-01-09T23:00:00Z")));
  for (let index = 0; index < 3; index += 1)
    await insertBusiness(f, { registeredAt: new Date("2030-01-10T07:00:00Z") });
  await db((tx) => claimRegistrationThresholdAlerts(tx, new Date("2030-01-10T13:00:00Z")));
  await db((tx) =>
    tx
      .update(localities)
      .set({ dailyRegistrationThreshold: null })
      .where(eq(localities.code, f.localityA)),
  );
  const summary = await db((tx) => dailySummary(tx, f.localityA, NOW, options().scope));
  expect(summary.alertRegistrations).toBe(3);
  expect(summary.alertThreshold).toBe(2);
  await run();
  expect(send.mock.calls[0]?.[0].text).toContain(
    "Ayer se activó la alerta de registros: 3 registros; el límite es 2.",
  );
});

it("sends at most five locality batches and resumes prepared batches next hour", async () => {
  const extra = Array.from({ length: 6 }, (_, index) => `${STATE}0${index + 10}`);
  let globalRole: number | undefined;
  try {
    await db(async (tx) => {
      await tx.insert(municipalities).values(
        extra.map((code) => ({
          code,
          stateCode: STATE,
          name: `Pueblo de prueba ${code}`,
          slug: `pueblo-${code}`,
        })),
      );
      await tx.insert(localities).values(
        extra.map((code) => ({
          code,
          timeZone: "America/Mexico_City",
          active: true,
          contactWhatsapp: "7719990900",
        })),
      );
      const [role] = await tx
        .insert(roles)
        .values({
          key: `${MARKER}global`,
          name: "Avisos globales",
          scope: "global",
          allPermissions: true,
        })
        .returning();
      globalRole = role!.id;
      const [user] = await tx
        .insert(users)
        .values({ email: `${MARKER}global@mail.example.com`, name: "Prueba global" })
        .returning();
      await tx
        .insert(roleAssignments)
        .values({ userId: user!.id, roleId: globalRole, roleScope: "global" });
    });
    for (const code of [f.localityA, ...extra])
      await insertBusiness(f, {
        localityCode: code,
        zoneId: null,
        zoneOther: "Colonia de prueba",
        registeredAt: NOW,
      });
    const first = await run();
    expect(first.sent).toBe(5);
    expect(first.deferred).toBe(2);
    expect(send).toHaveBeenCalledTimes(5);
    expect((await run(new Date("2030-01-10T15:00:00Z"))).sent).toBe(2);
    expect(send).toHaveBeenCalledTimes(7);
  } finally {
    await cleanUsers();
    await db(async (tx) => {
      await tx
        .delete(dailyAdminEmailState)
        .where(inArray(dailyAdminEmailState.localityCode, extra));
      await tx.delete(businesses).where(inArray(businesses.localityCode, extra));
      await tx.delete(localities).where(inArray(localities.code, extra));
      await tx.delete(municipalities).where(inArray(municipalities.code, extra));
      if (globalRole !== undefined) await tx.delete(roles).where(eq(roles.id, globalRole));
    });
  }
});

it("reuses the provider key and body when delivery succeeds but the completion transaction rolls back", async () => {
  await addUser("a");
  await insertBusiness(f, { registeredAt: NOW });
  const accepted = new Map<string, string>();
  let deliveries = 0;
  send.mockImplementation(async (batch) => {
    const body = JSON.stringify(batch);
    const previous = accepted.get(batch.idempotencyKey);
    if (previous !== undefined) expect(body).toBe(previous);
    else {
      accepted.set(batch.idempotencyKey, body);
      deliveries += 1;
    }
    return true;
  });
  const failed = await db((tx) => {
    const original = tx.transaction.bind(tx);
    // PostgreSQL rolls back the completion after the simulated external send.
    const interrupted = new Proxy(tx, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (run: Parameters<typeof tx.transaction>[0]) =>
            original(async (inner) => {
              await run(inner);
              throw new Error("simulated lost completion");
            });
        return Reflect.get(target, property, receiver);
      },
    });
    return runDailyAdminEmail(interrupted, NOW, options());
  });
  expect(failed.failed).toBe(1);
  expect((await db((tx) => tx.select().from(dailyAdminEmailState)))[0]?.completed).toBe(false);
  await run(new Date("2030-01-10T15:00:00Z"));
  expect(send).toHaveBeenCalledTimes(2);
  expect(deliveries).toBe(1);
  expect((await db((tx) => tx.select().from(dailyAdminEmailState)))[0]).toMatchObject({
    completed: true,
    batch: null,
  });
});
