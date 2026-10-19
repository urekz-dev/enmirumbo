// The users/roles screens work without scripts and explain Access and scope.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import UsersScreen from "../../src/components/admin/UsersScreen.astro";
import UserScreen from "../../src/components/admin/UserScreen.astro";
import RoleForm from "../../src/components/admin/RoleForm.astro";
import PanelHome from "../../src/components/admin/PanelHome.astro";
import { LAST_SUPER_ADMIN } from "../../src/core/access/manage.ts";
import { PERMISSIONS } from "../../src/core/access/permissions.ts";
import { collapseProblems } from "../responsive-rules.ts";
let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});
const failure = { errors: {}, message: null };
const user = {
  id: crypto.randomUUID(),
  name: "Persona de prueba",
  email: "person@enmirumbo.test",
  active: true,
  createdAt: new Date(),
};
const role = {
  id: 1,
  key: "example",
  name: "Revisar",
  scope: "locality",
  description: null,
  system: false,
  allPermissions: false,
};
const baseUserProps = {
  user,
  roles: [role],
  assignments: [],
  localities: [
    {
      code: "70001",
      name: "Pueblo Uno",
      stateName: "Estado de prueba",
      active: true,
      timeZone: "America/Mexico_City",
    },
  ],
  failure,
  done: false,
  statusAction: "?activate",
  assignAction: "?assign",
  values: { role: "", locality: "" },
};
const noScript = (html: string) => {
  expect(html).not.toMatch(/<script|\sstyle=/);
  expect(
    [...html.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => collapseProblems(value ?? "")),
  ).toEqual([]);
};
describe("The users and roles screens (EMR-72)", () => {
  it("adds email and name, explains the separate Access policy and displays active/inactive users", async () => {
    const html = await container.renderToString(UsersScreen, {
      props: {
        users: [user, { ...user, id: crypto.randomUUID(), active: false }],
        action: "?create",
        failure,
        values: { email: "", name: "" },
      },
    });
    expect(html).toContain(
      "Además agrega su correo a la política de Access para que pueda entrar.",
    );
    expect(html).toContain('method="post" action="?create" novalidate');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="name"');
    expect(html).toContain("Activo");
    expect(html).toContain("Inactivo");
    expect(html).toContain(`/admin/usuarios/${user.id}`);
    noScript(html);
  });
  it("echoes invalid submissions safely with accessible errors next to the fields", async () => {
    const html = await container.renderToString(UsersScreen, {
      props: {
        users: [],
        action: "?create",
        failure: {
          errors: { email: "Escribe un correo válido.", name: "Escribe un nombre." },
          message: null,
        },
        values: { email: '" onfocus="bad', name: "Intento" },
      },
    });
    expect(html).toContain('value="&quot; onfocus=&quot;bad"');
    expect(html).toContain('value="Intento"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('id="email-error" role="alert"');
    expect(html).toContain("Escribe un correo válido.");
  });
  it("keeps the last-super-admin explanation visible and offers deactivation/reactivation", async () => {
    const html = await container.renderToString(UserScreen, {
      props: { ...baseUserProps, failure: { errors: {}, message: LAST_SUPER_ADMIN } },
    });
    expect(html).toContain(LAST_SUPER_ADMIN);
    expect(html).toContain("Desactivar usuario");
    expect(html).toContain("Sus roles se conservan");
    expect(html).not.toContain("hasta un minuto");
    const inactive = await container.renderToString(UserScreen, {
      props: { ...baseUserProps, user: { ...user, active: false }, done: true },
    });
    expect(inactive).toContain("Reactivar usuario");
    expect(inactive).toContain('role="status"');
    noScript(html);
  });
  it("shows assigned roles with their locality and removal address, and explains the new assignment's scope", async () => {
    const html = await container.renderToString(UserScreen, {
      props: {
        ...baseUserProps,
        assignments: [
          { id: 17, roleId: 1, name: "Revisar", scope: "locality", localityCode: "70001" },
        ],
        values: { role: "1", locality: "70001" },
        failure: {
          errors: {
            locality: "Elige un municipio del catálogo.",
            role: "Este usuario ya tiene ese rol en ese lugar.",
          },
          message: null,
        },
      },
    });
    expect(html).toContain(`/admin/usuarios/${user.id}/roles/17`);
    expect(html).toContain("Pueblo Uno");
    expect(html).toContain("Sin municipio (rol global)");
    expect(html).toContain("Para un rol global, déjalo sin municipio.");
    expect(html).toContain('value="70001" selected');
    expect(html).toContain('value="1" selected');
    expect(html).toContain('id="locality-error" role="alert"');
    expect(html).toContain("ya tiene ese rol");
    noScript(html);
  });
  it("role creation/editing exposes the complete permission catalogue and scope, with server errors", async () => {
    const html = await container.renderToString(RoleForm, {
      props: {
        action: "?save",
        values: {
          name: "Revisar",
          description: "Ejemplo",
          scope: "locality",
          permissions: ["businesses.review"],
        },
        failure: {
          errors: { permissions: "Elige permisos del catálogo." },
          message: "Este rol ya está asignado.",
        },
        editing: true,
      },
    });
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      expect(html).toContain(`value="${key}"`);
      expect(html).toContain(description);
    }
    expect(html).toContain('value="businesses.review" checked');
    expect(html).toContain("Guardar rol");
    expect(html).toContain("Usuarios, roles y configuración de ciudades necesitan un rol global.");
    expect(html).toContain("Este rol ya está asignado.");
    expect(html).toContain('id="permissions-error" role="alert"');
    noScript(html);
  });
  it("the system role displays all permissions without an editable form", async () => {
    const html = await container.renderToString(RoleForm, {
      props: {
        action: "?save",
        values: { name: "Super admin", description: "", scope: "global", permissions: [] },
        failure,
        system: true,
      },
    });
    expect(html).toContain("El rol Super admin es del sistema y no se puede cambiar.");
    expect(html).toContain("incluidos los que se agreguen después");
    expect(html).not.toContain("<form");
    for (const description of Object.values(PERMISSIONS)) expect(html).toContain(description);
  });
  it("the panel home without a queue shows only permitted links, without client JavaScript", async () => {
    const html = await container.renderToString(PanelHome, {
      props: { links: [{ href: "/admin/colonias", text: "Colonias" }] },
    });
    expect(html).toContain("Panel de enmirumbo");
    expect(html).toContain('href="/admin/colonias"');
    expect(html).not.toContain("/admin/usuarios");
    expect(html).not.toContain("/admin/roles");
    expect(html).not.toContain("Registros por revisar");
    noScript(html);
  });
});
