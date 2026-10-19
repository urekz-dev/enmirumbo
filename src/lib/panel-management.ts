// Astro boundary for the users and roles screens: only their own forms may
// reach these actions, and targets come from the route, never hidden fields.
import { ActionError } from "astro:actions";
import { boundedText, formText } from "../core/forms/text.ts";
import { managementId, userId } from "../core/access/paths.ts";
import type { ManagementOutcome, RoleInput } from "../core/access/manage.ts";
interface Context {
  routePattern: string;
  params: Record<string, string | undefined>;
}
export function managementRoute(context: Context, route: string): void {
  if (context.routePattern !== route) throw new ActionError({ code: "NOT_FOUND" });
}
export function managedUser(context: Context, assignment = false): string {
  managementRoute(
    context,
    assignment ? "/admin/usuarios/[id]/roles/[assignment]" : "/admin/usuarios/[id]",
  );
  const id = userId(context.params["id"]);
  if (id === null) throw new ActionError({ code: "NOT_FOUND" });
  return id;
}
export function managedRole(context: Context): number {
  managementRoute(context, "/admin/roles/[id]");
  const id = managementId(context.params["id"]);
  if (id === null) throw new ActionError({ code: "NOT_FOUND" });
  return id;
}
export function managementData(outcome: ManagementOutcome): ManagementOutcome {
  if (outcome.kind === "forbidden") throw new ActionError({ code: "FORBIDDEN" });
  if (outcome.kind === "not-found") throw new ActionError({ code: "NOT_FOUND" });
  return outcome;
}
export function roleInput(form: FormData): RoleInput {
  return {
    name: formText(form, "name"),
    description: formText(form, "description"),
    scope: formText(form, "scope"),
    permissions: form
      .getAll("permissions")
      .map((value) => (typeof value === "string" ? value : "")),
  };
}
export type ManagementFailure = { errors: Record<string, string>; message: string | null };
export function managementFailure(
  result: { data?: ManagementOutcome | undefined; error?: unknown } | undefined,
): ManagementFailure {
  const data = result?.data;
  return {
    errors: data?.kind === "invalid" ? data.errors : {},
    message: result?.error
      ? "No se pudo guardar el cambio. Vuelve a intentarlo."
      : data?.kind === "conflict"
        ? data.message
        : null,
  };
}
/** Bounded echoes belong only in this response, never a cookie or URL. */
export async function managementForm(request: Request): Promise<FormData> {
  try {
    return request.method === "POST" ? await request.formData() : new FormData();
  } catch {
    return new FormData();
  }
}
export const typedManagementText = (form: FormData, field: string) =>
  boundedText(formText(form, field), 600);
export function managementStatus(
  result:
    | { data?: ManagementOutcome | undefined; error?: { status: number } | undefined }
    | undefined,
): number {
  if (result?.error) return result.error.status;
  return result?.data?.kind === "invalid" ? 400 : result?.data?.kind === "conflict" ? 409 : 200;
}

/** Bounded redisplay, without weakening the submitted validation. */
export function roleFormValues(input: RoleInput): RoleInput {
  return {
    name: boundedText(input.name, 600),
    description: boundedText(input.description, 600),
    scope: input.scope,
    permissions: input.permissions,
  };
}
