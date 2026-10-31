// Root-footer behavior for docs/specs/base-layout.md, amended by EMR-61. This
// project runs after the suites that need the seeded locality and restores its
// active state even when an assertion fails.
import { eq, inArray } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { localities } from "../../src/core/db/schema/index.ts";
import { withDatabase } from "./database.ts";

test("the coming-soon home and root 404 omit legal footer links without active localities", async ({
  page,
}) => {
  const activeCodes: string[] = [];
  await withDatabase(async (db) => {
    const active = await db
      .select({ code: localities.code })
      .from(localities)
      .where(eq(localities.active, true));
    if (active.length === 0) throw new Error("e2e: expected the seeded locality to be active");
    activeCodes.push(...active.map(({ code }) => code));
    await db.update(localities).set({ active: false });
  });

  try {
    const home = await page.goto("/");
    expect(home?.status()).toBe(200);
    await expect(
      page.getByRole("main").getByText("Estamos armando el directorio de negocios de tu colonia."),
    ).toBeVisible();
    const homeFooter = page.getByRole("contentinfo");
    await expect(homeFooter.getByRole("link", { name: "Aviso de privacidad" })).toHaveCount(0);
    await expect(homeFooter.getByRole("link", { name: "Términos y condiciones" })).toHaveCount(0);

    const notFound = await page.goto("/no-existe");
    expect(notFound?.status()).toBe(404);
    const notFoundFooter = page.getByRole("contentinfo");
    await expect(notFoundFooter.getByRole("link", { name: "Aviso de privacidad" })).toHaveCount(0);
    await expect(notFoundFooter.getByRole("link", { name: "Términos y condiciones" })).toHaveCount(
      0,
    );
  } finally {
    await withDatabase(async (db) => {
      await db.update(localities).set({ active: false });
      await db
        .update(localities)
        .set({ active: true })
        .where(inArray(localities.code, activeCodes));
    });
  }
});
