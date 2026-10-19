// Users/roles through local Access, without JavaScript. Runs alone because it
// temporarily gives the fixed identity the roles of the newly added user.
import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";
import { roleAssignments, rolePermissions, roles, users } from "../../src/core/db/schema/index.ts";
import { LOCAL_ADMIN_EMAIL } from "../../src/lib/access/verify.ts";
import { withDatabase } from "./database.ts";
import { ensureLocalSuperAdmin } from "./local-admin.ts";
const EMAIL = "added-user@enmirumbo.test";
const NAME = "Persona de mentiras EMR72";
const ROLE = "Revisión de mentiras EMR72";
const STATE = "13069";
async function restore(): Promise<void> {
  await withDatabase(async (db) => {
    await ensureLocalSuperAdmin(db);
    await db.delete(users).where(eq(users.email, EMAIL));
    await db.delete(roles).where(like(roles.description, "EMR72 browser%"));
  });
}
test.beforeAll(restore);
test.afterAll(restore);
test.beforeEach(async () => {
  await withDatabase(ensureLocalSuperAdmin);
});
test.afterEach(async () => {
  await withDatabase(ensureLocalSuperAdmin);
});
test.use({ javaScriptEnabled: false });

test("creates and edits a role, adds a user, assigns it in one municipality and sees that user's permissions", async ({
  page,
}) => {
  await page.goto("/admin");
  await page.getByRole("link", { name: "Roles", exact: true }).click();
  await page.getByLabel("Nombre del rol", { exact: true }).fill(ROLE);
  await page.getByLabel("Descripción", { exact: true }).fill("EMR72 browser role");
  await page.getByLabel("Alcance", { exact: true }).selectOption("locality");
  await page
    .getByLabel("Revisar registros: ver la cola y el detalle, aprobar y rechazar", { exact: true })
    .check();
  await page.getByRole("button", { name: "Crear rol", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Listo. Se guardó el cambio.");
  await page.getByLabel("Nombre del rol", { exact: true }).fill(`${ROLE} editada`);
  await page.getByRole("button", { name: "Guardar rol", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${ROLE} editada`);
  await page.getByRole("link", { name: "Usuarios", exact: true }).click();
  await expect(page.getByText(/Además agrega su correo a la política de Access/)).toBeVisible();
  await page.getByLabel("Correo", { exact: true }).fill(EMAIL.toUpperCase());
  await page.getByLabel("Nombre", { exact: true }).fill(NAME);
  await page.getByRole("button", { name: "Agregar usuario", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAME);
  await expect(page.getByText(EMAIL, { exact: true })).toBeVisible();
  const target = page.url();
  await page
    .getByLabel("Rol", { exact: true })
    .selectOption({ label: `${ROLE} editada (por municipio)` });
  await page.getByRole("button", { name: "Asignar rol", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Elige el municipio donde tendrá este rol.");
  await page.getByLabel("Municipio", { exact: true }).selectOption(STATE);
  await page.getByRole("button", { name: "Asignar rol", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roles asignados" }).locator("..")).toContainText(
    "Tizayuca",
  );
  // Local Access always proves the same email. Copy only the new user's
  // assignments onto that local test identity to exercise its capabilities.
  await withDatabase(async (db) => {
    const [added] = await db.select().from(users).where(eq(users.email, EMAIL));
    const [local] = await db.select().from(users).where(eq(users.email, LOCAL_ADMIN_EMAIL));
    const assignments = await db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, added!.id));
    await db.delete(roleAssignments).where(eq(roleAssignments.userId, local!.id));
    await db.insert(roleAssignments).values(
      assignments.map((a) => ({
        userId: local!.id,
        roleId: a.roleId,
        roleScope: a.roleScope,
        localityCode: a.localityCode,
      })),
    );
  });
  expect((await page.goto("/admin"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registros por revisar");
  await expect(page.getByRole("link", { name: "Usuarios", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Roles", exact: true })).toHaveCount(0);
  expect((await page.goto("/admin/usuarios"))?.status()).toBe(403);
  expect((await page.goto("/admin/roles"))?.status()).toBe(403);
  await withDatabase(ensureLocalSuperAdmin);
  await page.goto(target);
  await page.getByRole("button", { name: "Desactivar usuario", exact: true }).click();
  await expect(page.getByText("Inactivo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reactivar usuario", exact: true }).click();
  await expect(page.getByText("Activo", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Quitar rol/ }).click();
  await page.getByRole("button", { name: "Quitar rol", exact: true }).click();
  await expect(
    page.getByText("Sin roles. Este usuario todavía no puede entrar al panel."),
  ).toBeVisible();
});

test("the home of a user without queue permissions links only to the sections it may open", async ({
  page,
}) => {
  await withDatabase(async (db) => {
    const [role] = await db
      .insert(roles)
      .values({
        key: "e2e_emr72_delete",
        name: "Solo borrar de prueba",
        description: "EMR72 browser delete",
        scope: "locality",
      })
      .returning();
    await db
      .insert(rolePermissions)
      .values({ roleId: role!.id, permissionKey: "businesses.delete" });
    const [local] = await db.select().from(users).where(eq(users.email, LOCAL_ADMIN_EMAIL));
    await db.delete(roleAssignments).where(eq(roleAssignments.userId, local!.id));
    await db
      .insert(roleAssignments)
      .values({ userId: local!.id, roleId: role!.id, roleScope: "locality", localityCode: STATE });
  });
  expect((await page.goto("/admin"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Panel de enmirumbo");
  await page.getByRole("link", { name: "Todos los negocios", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Todos los negocios");
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "Colonias", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Usuarios", exact: true })).toHaveCount(0);
});

test("wrong-page and direct action requests never create users or roles", async ({ page }) => {
  await page.goto("/admin");
  for (const action of [
    "createUser",
    "createRole",
    "deactivateUser",
    "reactivateUser",
    "assignRole",
    "removeRole",
    "updateRole",
  ]) {
    for (const path of [`/admin?_action=admin.${action}`, `/_actions/admin.${action}`]) {
      const response = await page.request.post(path, {
        form: { email: "forged@enmirumbo.test", name: "Prueba" },
        headers: { Origin: new URL(page.url()).origin },
      });
      expect(response.status(), path).toBe(404);
    }
  }
});

test("the system role has no editable form and a forged update is refused", async ({ page }) => {
  let systemId = 0;
  await withDatabase(async (db) => {
    systemId = (await db.select().from(roles).where(eq(roles.key, "super_admin")))[0]!.id;
  });
  await page.goto(`/admin/roles/${systemId}`);
  await expect(
    page.getByText(/El rol Super admin es del sistema y no se puede cambiar/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar rol" })).toHaveCount(0);
  const response = await page.request.post(`/admin/roles/${systemId}?_action=admin.updateRole`, {
    form: { name: "Cambio de prueba", scope: "global" },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(409);
});

test("the last active super admin cannot be deactivated or lose its role from the panel", async ({
  page,
}) => {
  let id = "";
  let assignment = 0;
  await withDatabase(async (db) => {
    const [user] = await db.select().from(users).where(eq(users.email, LOCAL_ADMIN_EMAIL));
    id = user!.id;
    const [role] = await db.select().from(roles).where(eq(roles.key, "super_admin"));
    const rows = await db.select().from(roleAssignments).where(eq(roleAssignments.userId, id));
    assignment = rows.find((row) => row.roleId === role!.id)!.id;
  });
  await page.goto(`/admin/usuarios/${id}`);
  await page.getByRole("button", { name: "Desactivar usuario", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Debe quedar al menos un super admin activo.",
  );
  await expect(page.getByText("Activo", { exact: true })).toBeVisible();
  await page.goto(`/admin/usuarios/${id}/roles/${assignment}`);
  await page.getByRole("button", { name: "Quitar rol", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Debe quedar al menos un super admin activo.",
  );
  expect((await page.goto("/admin"))?.status()).toBe(200);
});
