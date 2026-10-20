// Full 390 px audit of the admin panel through the local Access identity.
// Every screen opens with client JavaScript disabled and realistic records;
// the audit checks horizontal overflow, the 44 px target rule (the associated
// label for checkboxes and radios), normal native choice sizes and useful main
// content, and saves a phone screenshot for each step.
import { expect, test, type TestInfo } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { withLocalMediaBucket } from "../../scripts/seed-media.ts";
import { newBusinessId } from "../../src/core/business/id.ts";
import { seedPhotoObjects } from "../../src/core/db/seed/photos.ts";
import {
  adminAuditLog,
  businesses,
  categories,
  pendingEdits,
  reports,
  roleAssignments,
  rolePermissions,
  roles,
  users,
  zones,
} from "../../src/core/db/schema/index.ts";
import { newPhotoKey, photoObjectKeys } from "../../src/core/photos/photo.ts";
import { withDatabase } from "./database.ts";
import { ensureLocalSuperAdmin, setLocalAdminRoles } from "./local-admin.ts";

const LOCALITY = "13069";
const PHONE_PREFIX = "7719993";
const HOME_ROLE = "e2e_emr53_phone_home";
const DETAIL_ROLE = "e2e_emr53_phone_detail";
const AUDIT_USER_EMAIL = "phone-audit-user@enmirumbo.test";
const LONG_REVIEW_NAME = `Negocio-${"L".repeat(88)}`;
const LONG_ZONE = `Otra-${"Z".repeat(88)}`;
const LONG_REPORT_COMMENT = `Comentario sin espacios: ${"R".repeat(180)}`;
const photoKey = newPhotoKey();

const ids = {
  review: newBusinessId(),
  reported: newBusinessId(),
  rejected: newBusinessId(),
  unpublished: newBusinessId(),
  pendingEdit: newBusinessId(),
  appliedEdit: newBusinessId(),
  discardedEdit: newBusinessId(),
} as const;
const listingIds = Array.from({ length: 30 }, () => newBusinessId());
const allBusinessIds = [...Object.values(ids), ...listingIds];
const phone = (suffix: number) => `${PHONE_PREFIX}${String(suffix).padStart(3, "0")}`;
const editIds = { pending: 0, applied: 0, discarded: 0 };
const reportId = { first: 0 };
const identity = { userId: "", roleId: 0, homeRoleId: 0 };

const auditPhotoKeys = [photoKey];
const roleKeys = [HOME_ROLE, DETAIL_ROLE];

async function removeData(): Promise<void> {
  await withDatabase(async (db) => {
    await ensureLocalSuperAdmin(db);
    await db.delete(adminAuditLog).where(inArray(adminAuditLog.businessId, allBusinessIds));
    await db.delete(businesses).where(inArray(businesses.id, allBusinessIds));
    await db.delete(users).where(eq(users.email, AUDIT_USER_EMAIL));
    await db.delete(roles).where(inArray(roles.key, roleKeys));
  });
  await withLocalMediaBucket(async (bucket) => {
    await bucket.delete(auditPhotoKeys.flatMap(photoObjectKeys));
  });
}

test.beforeAll(async () => {
  await removeData();
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms);
  await withDatabase(async (db) => {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, "servicios-del-hogar"));
    const [zone] = await db.select({ id: zones.id }).from(zones).where(eq(zones.slug, "huicalco"));
    if (category === undefined || zone === undefined) {
      throw new Error("e2e: the catalogues are missing; is the database migrated?");
    }

    const base = {
      localityCode: LOCALITY,
      categoryId: category.id,
      consentedToNoticeAt: ago(120 * 24 * 60 * 60 * 1000),
      consentedToNoticeVersion: "2",
    };
    await db.insert(businesses).values([
      {
        ...base,
        id: ids.review,
        name: LONG_REVIEW_NAME,
        whatsapp: phone(1),
        zoneId: null,
        zoneOther: LONG_ZONE,
        whatYouOffer: `Servicio-${"O".repeat(100)}`,
        registeredAt: ago(10 * 60 * 60 * 1000),
      },
      {
        ...base,
        id: ids.reported,
        name: "Negocio publicado con reportes de teléfono",
        whatsapp: phone(2),
        zoneId: zone.id,
        status: "published",
        publishedAt: ago(10 * 24 * 60 * 60 * 1000),
        registeredAt: ago(30 * 24 * 60 * 60 * 1000),
        photoKey,
      },
      {
        ...base,
        id: ids.rejected,
        name: "Negocio rechazado para auditoría de teléfono",
        whatsapp: phone(3),
        zoneId: zone.id,
        status: "rejected",
        rejectedAt: ago(2 * 24 * 60 * 60 * 1000),
        rejectionReason: "La foto no cumple las reglas de prueba.",
        registeredAt: ago(3 * 24 * 60 * 60 * 1000),
      },
      {
        ...base,
        id: ids.unpublished,
        name: "Negocio despublicado para auditoría de teléfono",
        whatsapp: phone(4),
        zoneId: zone.id,
        status: "in_review",
        publishedAt: ago(60 * 24 * 60 * 60 * 1000),
        unpublishedAt: ago(2 * 24 * 60 * 60 * 1000),
        unpublishReason: "El negocio cerró durante la prueba.",
        registeredAt: ago(90 * 24 * 60 * 60 * 1000),
      },
      {
        ...base,
        id: ids.pendingEdit,
        name: "Negocio con varios cambios por revisar",
        whatsapp: phone(5),
        zoneId: zone.id,
        status: "published",
        publishedAt: ago(20 * 24 * 60 * 60 * 1000),
        registeredAt: ago(50 * 24 * 60 * 60 * 1000),
        whatYouOffer: "Instalaciones y reparaciones originales",
        address: "Calle de prueba número 10",
        openingHours: "De 9 a 5",
      },
      {
        ...base,
        id: ids.appliedEdit,
        name: "Negocio con cambio aplicado de teléfono",
        whatsapp: phone(6),
        zoneId: zone.id,
        status: "published",
        publishedAt: ago(20 * 24 * 60 * 60 * 1000),
        registeredAt: ago(50 * 24 * 60 * 60 * 1000),
      },
      {
        ...base,
        id: ids.discardedEdit,
        name: "Negocio con cambio descartado de teléfono",
        whatsapp: phone(7),
        zoneId: zone.id,
        status: "published",
        publishedAt: ago(20 * 24 * 60 * 60 * 1000),
        registeredAt: ago(50 * 24 * 60 * 60 * 1000),
      },
      ...listingIds.map((id, index) => ({
        ...base,
        id,
        name:
          index === 29 ? `Listado-${"N".repeat(90)}` : `Negocio de teléfono ${index + 1} de prueba`,
        whatsapp: phone(100 + index),
        ...(index === 29 ? { zoneId: null, zoneOther: LONG_ZONE } : { zoneId: zone.id }),
        status: "published" as const,
        publishedAt: ago(80 * 24 * 60 * 60 * 1000),
        registeredAt: ago((40 + index) * 24 * 60 * 60 * 1000),
      })),
    ]);

    const [reported] = await db
      .insert(reports)
      .values([
        {
          businessId: ids.reported,
          localityCode: LOCALITY,
          reason: "incorrect_data",
          comment: LONG_REPORT_COMMENT,
          createdAt: ago(60 * 60 * 1000),
        },
        {
          businessId: ids.reported,
          localityCode: LOCALITY,
          reason: "closed",
          createdAt: ago(2 * 60 * 60 * 1000),
        },
      ])
      .returning({ id: reports.id });
    reportId.first = reported?.id ?? 0;

    const editBase = {
      localityCode: LOCALITY,
      categoryId: category.id,
      zoneId: null,
      zoneOther: "Colonia propuesta con varios cambios",
      createdAt: ago(60 * 60 * 1000),
    };
    const [pending] = await db
      .insert(pendingEdits)
      .values({
        ...editBase,
        businessId: ids.pendingEdit,
        name: "Negocio actualizado con nombre propuesto",
        whatsapp: phone(8),
        whatYouOffer: "Servicio nuevo con una descripción diferente",
        homeDelivery: true,
        landline: phone(9),
        address: "Avenida propuesta, número 55",
        openingHours: "De 10 a 7, toda la semana",
      })
      .returning({ id: pendingEdits.id });
    const [applied] = await db
      .insert(pendingEdits)
      .values({
        ...editBase,
        businessId: ids.appliedEdit,
        name: "Negocio con cambio aplicado de teléfono",
        whatsapp: phone(6),
        status: "applied",
        resolvedAt: ago(30 * 60 * 1000),
      })
      .returning({ id: pendingEdits.id });
    const [discarded] = await db
      .insert(pendingEdits)
      .values({
        ...editBase,
        businessId: ids.discardedEdit,
        name: "Negocio con cambio descartado de teléfono",
        whatsapp: phone(7),
        status: "discarded",
        resolvedAt: ago(30 * 60 * 1000),
        discardReason: "No coincide con los datos que revisamos.",
      })
      .returning({ id: pendingEdits.id });
    editIds.pending = pending?.id ?? 0;
    editIds.applied = applied?.id ?? 0;
    editIds.discarded = discarded?.id ?? 0;

    await db.insert(adminAuditLog).values([
      {
        localityCode: LOCALITY,
        businessId: ids.rejected,
        actor: "admin@enmirumbo.test",
        action: "reject",
        previousStatus: "in_review",
        occurredAt: ago(2 * 24 * 60 * 60 * 1000),
      },
      {
        localityCode: LOCALITY,
        businessId: ids.unpublished,
        actor: "admin@enmirumbo.test",
        action: "unpublish",
        previousStatus: "published",
        occurredAt: ago(24 * 60 * 60 * 1000),
      },
    ]);

    const [role] = await db
      .insert(roles)
      .values({
        key: DETAIL_ROLE,
        name: "Rol de teléfono para revisar detalles",
        description: "Rol ficticio creado por la auditoría EMR-53.",
        scope: "locality",
      })
      .returning({ id: roles.id });
    identity.roleId = role?.id ?? 0;
    await db.insert(rolePermissions).values({
      roleId: identity.roleId,
      permissionKey: "businesses.edit",
    });

    const [homeRole] = await db
      .insert(roles)
      .values({
        key: HOME_ROLE,
        name: "Solo administrar negocios en prueba",
        description: "Permiso de inicio sin acceso a la cola.",
        scope: "locality",
      })
      .returning({ id: roles.id });
    identity.homeRoleId = homeRole?.id ?? 0;
    await db.insert(rolePermissions).values({
      roleId: identity.homeRoleId,
      permissionKey: "businesses.delete",
    });

    const [user] = await db
      .insert(users)
      .values({
        email: AUDIT_USER_EMAIL,
        name: "Persona de prueba con nombre largo para el panel",
      })
      .returning({ id: users.id });
    identity.userId = user?.id ?? "";
    await db.insert(roleAssignments).values({
      userId: identity.userId,
      roleId: identity.roleId,
      roleScope: "locality",
      localityCode: LOCALITY,
    });
  });

  await withLocalMediaBucket(async (bucket) => {
    const objects = seedPhotoObjects([
      { name: "Negocio publicado con reportes de teléfono", photoKey, shade: 2 },
    ]);
    for (const { key, body, contentType, cacheControl } of objects) {
      await bucket.put(key, body, { httpMetadata: { contentType, cacheControl } });
    }
  });
});

test.afterAll(removeData);
test.use({ javaScriptEnabled: false });

async function auditPhoneScreen(
  page: import("@playwright/test").Page,
  testInfo: TestInfo,
  step: string,
  expectedMainText: string,
): Promise<void> {
  expect(page.viewportSize()?.width, step).toBe(390);
  const main = page.getByRole("main");
  await expect(main, `${step}: main content is present`).toContainText(expectedMainText);
  const panelNavigation = page.getByRole("navigation", { name: "Secciones del panel" });
  if ((await panelNavigation.count()) > 0) {
    await expect(
      panelNavigation.getByRole("link", { name: "Salir", exact: true }),
      `${step}: Access logout link`,
    ).toHaveAttribute("href", "/cdn-cgi/access/logout");
  }
  const geometry = await page.evaluate(() => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const main = document.querySelector<HTMLElement>("main");
    if (main === null) throw new Error("The page has no main element");
    const selectors = "a, button, input:not([type=hidden]), select, textarea, summary";
    const ordinaryControls = [...main.querySelectorAll<HTMLElement>(selectors)].filter(
      (element) =>
        !(element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)),
    );
    const choiceControls = [
      ...main.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]'),
    ];
    const unlabeledChoices: string[] = [];
    const choiceLabels = choiceControls.flatMap((control) => {
      const labels = [...(control.labels ?? [])].filter((label) => main.contains(label));
      if (labels.length === 0) unlabeledChoices.push(control.type);
      return labels;
    });
    const targets = [...new Set([...ordinaryControls, ...choiceLabels])]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const choice =
          element instanceof HTMLLabelElement
            ? element.querySelector<HTMLInputElement>('input[type="checkbox"], input[type="radio"]')
            : null;
        return {
          tag: element.tagName.toLowerCase(),
          type: choice?.type ?? (element instanceof HTMLInputElement ? element.type : ""),
          text: (element.innerText || element.getAttribute("aria-label") || "")
            .trim()
            .slice(0, 100),
          width: rect.width,
          height: rect.height,
        };
      });
    const choices = choiceControls.map((control) => {
      const rect = control.getBoundingClientRect();
      return { type: control.type, width: rect.width, height: rect.height };
    });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      targets,
      choices,
      unlabeledChoices,
    };
  });
  expect(geometry.scrollWidth, `${step}: no horizontal page scroll`).toBeLessThanOrEqual(
    geometry.innerWidth,
  );
  const ownScripts = page.locator(
    'script:not([src^="https://"]):not([type="application/ld+json"])',
  );
  if (step === "09-rectification") {
    await expect(ownScripts, `${step}: only the shared form's script is present`).toHaveCount(1);
    await expect(ownScripts).toHaveAttribute("src", /^\/_astro\/RegistrationForm\.[^/]*\.js$/);
  } else {
    await expect(ownScripts, `${step}: no panel client script`).toHaveCount(0);
  }
  expect(geometry.targets.length, `${step}: the screen has interactive targets`).toBeGreaterThan(0);
  expect(geometry.unlabeledChoices, `${step}: every checkbox and radio has a label`).toEqual([]);
  for (const target of geometry.targets) {
    expect(
      Math.min(target.width, target.height),
      `${step}: ${target.tag}${target.type ? `[${target.type}]` : ""} "${target.text}" is at least 44px`,
    ).toBeGreaterThanOrEqual(44);
  }
  for (const choice of geometry.choices) {
    expect(choice.width, `${step}: ${choice.type} keeps normal width`).toBeGreaterThanOrEqual(20);
    expect(choice.width, `${step}: ${choice.type} keeps normal width`).toBeLessThanOrEqual(24);
    expect(choice.height, `${step}: ${choice.type} keeps normal height`).toBeGreaterThanOrEqual(20);
    expect(choice.height, `${step}: ${choice.type} keeps normal height`).toBeLessThanOrEqual(24);
  }
  await page.screenshot({ path: testInfo.outputPath(`${step}.png`), fullPage: true });
}

test("every panel screen is complete and usable at 390px without JavaScript", async ({
  page,
}, testInfo) => {
  const localAccess = await page.goto("/admin");
  expect(localAccess?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registros por revisar");
  await expect(page.getByRole("heading", { name: "Negocios reportados" })).toBeVisible();
  await expect(page.getByTestId("reported").getByRole("listitem")).toHaveCount(1);
  await auditPhoneScreen(page, testInfo, "01-queue", "Registros por revisar");

  try {
    await withDatabase((db) => setLocalAdminRoles(db, [{ role: HOME_ROLE, locality: LOCALITY }]));
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Panel de enmirumbo");
    await expect(page.getByRole("link", { name: "Todos los negocios", exact: true })).toBeVisible();
    await auditPhoneScreen(page, testInfo, "02-panel-home", "Elige la sección que necesitas");
  } finally {
    await withDatabase(ensureLocalSuperAdmin);
  }

  await page.goto("/admin/negocios?estado=publicados");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Todos los negocios");
  await expect(page.getByRole("navigation", { name: "Filtrar por estado" })).toBeVisible();
  await auditPhoneScreen(page, testInfo, "03-businesses-filter", "Todos los negocios");
  await page.getByRole("link", { name: "Ver más antiguos" }).click();
  await expect(page).toHaveURL("/admin/negocios?estado=publicados&pagina=2");
  await expect(page.getByTestId("businesses")).toContainText("Listado-");
  await auditPhoneScreen(page, testInfo, "04-businesses-page-2", "Todos los negocios");

  await page.goto(`/admin/registros/${ids.review}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(LONG_REVIEW_NAME);
  await expect(page.getByRole("definition").filter({ hasText: LONG_ZONE })).toBeVisible();
  await auditPhoneScreen(page, testInfo, "05-detail-in-review", LONG_REVIEW_NAME);

  await page.goto(`/admin/registros/${ids.reported}`);
  await expect(page.getByRole("heading", { name: "Reportes sin atender" })).toBeVisible();
  await expect(page.getByText(LONG_REPORT_COMMENT)).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Foto de Negocio publicado con reportes de teléfono" }),
  ).toBeVisible();
  await auditPhoneScreen(
    page,
    testInfo,
    "06-detail-published-with-reports",
    "Negocio publicado con reportes",
  );

  await page.goto(`/admin/registros/${ids.rejected}`);
  await expect(page.getByText("La foto no cumple las reglas de prueba.")).toBeVisible();
  await auditPhoneScreen(page, testInfo, "07-detail-rejected", "Negocio rechazado para auditoría");

  await page.goto(`/admin/registros/${ids.unpublished}`);
  await expect(page.getByText("Cuándo la despublicaste")).toBeVisible();
  await expect(page.getByText("Por qué la despublicaste")).toBeVisible();
  await auditPhoneScreen(
    page,
    testInfo,
    "08-detail-unpublished",
    "Negocio despublicado para auditoría",
  );

  await page.goto(`/admin/registros/${ids.reported}/editar`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('[name="name"]')).toHaveValue(
    "Negocio publicado con reportes de teléfono",
  );
  await auditPhoneScreen(page, testInfo, "09-rectification", "Editar ficha");

  await page.goto(`/admin/registros/${ids.rejected}/rechazado`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registro rechazado.");
  await auditPhoneScreen(page, testInfo, "10-rejected-confirmation", "Registro rechazado.");

  await page.goto(`/admin/registros/${ids.unpublished}/despublicado`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ya la despublicaste.");
  await auditPhoneScreen(page, testInfo, "11-unpublished-confirmation", "Ya la despublicaste.");

  await page.goto(`/admin/registros/${ids.review}/borrar`);
  await expect(page.getByLabel("Escribe BORRAR para confirmar")).toBeVisible();
  await auditPhoneScreen(
    page,
    testInfo,
    "12-delete-confirmation",
    "¿Seguro que quieres borrar esta ficha?",
  );

  await page.goto("/admin/borrado");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ya se borró para siempre.");
  await auditPhoneScreen(page, testInfo, "13-deleted-confirmation", "Ya se borró para siempre.");

  await page.goto(`/admin/ediciones/${editIds.pending}`);
  await expect(page.getByTestId("comparison")).toContainText("Lo que está publicado");
  await expect(page.getByTestId("comparison")).toContainText("Lo que quiere cambiar");
  await expect(page.getByTestId("comparison")).toContainText("Cambió");
  await expect(page.getByRole("button", { name: "Aplicar los cambios" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Descartar los cambios" })).toBeVisible();
  await auditPhoneScreen(
    page,
    testInfo,
    "14-pending-edit",
    "Negocio con varios cambios por revisar",
  );

  await page.goto(`/admin/ediciones/${editIds.applied}/aplicada`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Listo, la ficha ya se actualizó.",
  );
  await auditPhoneScreen(
    page,
    testInfo,
    "15-applied-confirmation",
    "Listo, la ficha ya se actualizó.",
  );

  await page.goto(`/admin/ediciones/${editIds.discarded}/descartada`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cambios descartados.");
  await auditPhoneScreen(page, testInfo, "16-discarded-confirmation", "Cambios descartados.");

  await page.goto("/admin/colonias");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Colonias de Tizayuca");
  await expect(page.getByTestId("zones").getByRole("listitem")).toHaveCount(105);
  await auditPhoneScreen(page, testInfo, "17-zones", "Colonias de Tizayuca");

  await page.goto("/admin/usuarios");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Usuarios del panel");
  await expect(page.getByText(AUDIT_USER_EMAIL)).toBeVisible();
  await auditPhoneScreen(page, testInfo, "18-users", "Usuarios del panel");

  await page.goto(`/admin/usuarios/${identity.userId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Persona de prueba con nombre largo para el panel",
  );
  await expect(page.getByRole("heading", { name: "Roles asignados" })).toBeVisible();
  await auditPhoneScreen(page, testInfo, "19-user-detail", AUDIT_USER_EMAIL);

  await page.goto("/admin/roles");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Roles");
  await expect(
    page.getByRole("link", { name: "Rol de teléfono para revisar detalles" }),
  ).toBeVisible();
  await auditPhoneScreen(page, testInfo, "20-roles", "Roles");

  await page.goto(`/admin/roles/${identity.roleId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Rol de teléfono para revisar detalles",
  );
  await expect(page.getByLabel("Nombre del rol")).toHaveValue(
    "Rol de teléfono para revisar detalles",
  );
  await auditPhoneScreen(page, testInfo, "21-role-detail", "Rol de teléfono para revisar detalles");

  await page.goto("/admin/tareas");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tareas programadas");
  await auditPhoneScreen(page, testInfo, "23-tasks", "Tareas programadas");

  await page.goto("/admin/bitacora");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bitácora");
  await expect(page.getByTestId("audit-log").getByRole("listitem")).toHaveCount(2);
  await auditPhoneScreen(page, testInfo, "22-audit-log", "Bitácora");
});
