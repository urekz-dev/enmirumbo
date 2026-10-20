// A harmless local task through the panel, on a phone without JavaScript.
import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

test("previews UTC, runs one task and reloads only its result", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("link", { name: "Tareas", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tareas programadas");
  await expect(page.getByLabel("Tarea").getByRole("option")).toHaveCount(4);
  await page.getByLabel("Tarea").selectOption("photo-cache-purge");
  await page.getByLabel("Zona horaria").selectOption("America/Mexico_City");
  await page.getByLabel("Fecha y hora").fill("2026-10-19T03:00");
  await page.getByRole("button", { name: "Ver hora UTC" }).click();
  await expect(page.locator("#utc-time")).toHaveText("Hora UTC: 2026-10-19T09:00:00.000Z");
  await expect(page.getByRole("region", { name: "Resultado de la tarea" })).toHaveCount(0);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts++;
  });
  const response = page.waitForResponse((res) => res.request().method() === "POST");
  await page.getByRole("button", { name: "Correr tarea", exact: true }).click();
  expect((await response).status()).toBe(303);
  await expect(page.getByRole("region", { name: "Resultado de la tarea" })).toContainText(
    "0 purged, 0 waiting",
  );
  await expect(page.getByRole("region", { name: "Resultado de la tarea" })).toContainText(
    "2026-10-19T09:00:00.000Z",
  );
  const resultUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(resultUrl);
  await expect(page.getByRole("region", { name: "Resultado de la tarea" })).toContainText(
    "Listo, la tarea terminó.",
  );
  expect(posts).toBe(1);
});

test("invalid input stays next to the field and an unreadable result shows the plain form", async ({
  page,
}) => {
  await page.goto("/admin/tareas?resultado=anything&conteos=unreadable");
  await expect(page.getByRole("region", { name: "Resultado de la tarea" })).toHaveCount(0);
  await page.getByLabel("Fecha y hora").fill("");
  // Form defaults are not validation defaults: an empty submitted date is invalid.
  await page.getByRole("button", { name: "Correr tarea", exact: true }).click();
  await expect(page.locator("#time-error")).toContainText("Elige otra fecha y hora");
});
