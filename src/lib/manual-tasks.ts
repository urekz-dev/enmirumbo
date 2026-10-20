import { manualTasksEnabled } from "../core/tasks/access.ts";
import { taskInstant } from "../core/tasks/time.ts";
import { formText } from "../core/forms/text.ts";
import { TASKS_PATH } from "../core/review/paths.ts";
import { IncompleteTask, SCHEDULED_TASKS, type ScheduledTask } from "../scheduled.ts";
import { notFound } from "./locality.ts";

export const TASK_ACTION = "admin.runTask";

/** Runs before Astro dispatches actions, including calls from other pages. */
export function hiddenTaskRequest(
  environment: string,
  url: URL,
  routePattern: string,
): Response | null {
  if (manualTasksEnabled(environment)) return null;
  // Astro renders its error page through the middleware again. Let that
  // render finish, rather than replacing the shared HTML with another empty
  // response. Error-page rendering never dispatches actions.
  if (routePattern === "/404") return null;
  const matchesAction = (name: string) => {
    try {
      return decodeURIComponent(name).replace(/\/$/, "") === TASK_ACTION;
    } catch {
      return false;
    }
  };
  if (
    routePattern === TASKS_PATH ||
    url.pathname === TASKS_PATH ||
    (url.pathname.startsWith("/_actions/") &&
      matchesAction(url.pathname.slice("/_actions/".length))) ||
    matchesAction(url.searchParams.get("_action") ?? "")
  )
    return notFound();
  return null;
}

export interface TaskResult {
  task: string;
  instant: string;
  failed: boolean;
  counts: string;
}

// A GET result is display-only. Its query contains counts, never card data.
export function taskResultPath(result: TaskResult): string {
  return `${TASKS_PATH}?${new URLSearchParams({
    tarea: result.task,
    utc: result.instant,
    resultado: result.failed ? "fallo" : "listo",
    conteos: result.counts,
  })}`;
}

const countsOnly = (text: string) =>
  text.length > 0 && text.length <= 2000 && /^\d[\da-zA-Z ,()_-]*$/.test(text);

export function readTaskResult(params: URLSearchParams): TaskResult | null {
  const task = params.get("tarea") ?? "";
  const instant = params.get("utc") ?? "";
  const counts = params.get("conteos") ?? "";
  const state = params.get("resultado");
  if (
    ["tarea", "utc", "conteos", "resultado"].some((key) => params.getAll(key).length !== 1) ||
    !SCHEDULED_TASKS.some((item) => item.name === task) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(instant) ||
    !Number.isFinite(Date.parse(instant)) ||
    new Date(instant).toISOString() !== instant ||
    !countsOnly(counts) ||
    (state !== "fallo" && state !== "listo")
  )
    return null;
  return { task, instant, counts, failed: state === "fallo" };
}

export type TaskSubmission =
  | { kind: "not_found" | "forbidden" }
  | { kind: "invalid"; errors: Record<string, string> }
  | { kind: "preview"; instant: string }
  | { kind: "done"; result: TaskResult };

export async function submitManualTask(
  form: FormData,
  environment: string,
  routePattern: string,
  timeZones: () => Promise<string[] | null>,
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
  tasks: readonly ScheduledTask[] = SCHEDULED_TASKS,
): Promise<TaskSubmission> {
  if (!manualTasksEnabled(environment) || routePattern !== TASKS_PATH) return { kind: "not_found" };
  const zones = await timeZones();
  if (zones === null) return { kind: "forbidden" };
  const task = tasks.find((item) => item.name === formText(form, "task"));
  const zone = formText(form, "zone");
  const errors: Record<string, string> = {};
  if (!task) errors["task"] = "Elige una tarea de la lista.";
  if (!zones.includes(zone)) errors["zone"] = "Elige una zona horaria de la lista.";
  const instant = zones.includes(zone) ? taskInstant(formText(form, "time"), zone) : null;
  if (!instant)
    errors["time"] = "Elige otra fecha y hora. Debe existir una sola vez en esa zona horaria.";
  const intent = formText(form, "intent");
  if (intent !== "preview" && intent !== "run") errors["intent"] = "Elige qué quieres hacer.";
  if (Object.keys(errors).length || !task || !instant) return { kind: "invalid", errors };
  if (intent === "preview") return { kind: "preview", instant: instant.toISOString() };
  let counts: string;
  let failed = false;
  try {
    const report = await task.run(env, instant, ctx);
    counts = Object.entries(report)
      .map(([name, count]) => `${count} ${name}`)
      .join(", ");
    if (!countsOnly(counts)) counts = "0 reported";
    console.log(`scheduled: ${task.name} done (${counts})`);
  } catch (error) {
    failed = true;
    counts =
      error instanceof IncompleteTask && countsOnly(error.message) ? error.message : "1 failed";
    console.error(`scheduled: ${task.name} failed (${counts})`);
  }
  return {
    kind: "done",
    result: { task: task.name, instant: instant.toISOString(), failed, counts },
  };
}
