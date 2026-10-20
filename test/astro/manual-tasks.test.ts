// The hidden route's empty response enters Astro's ordinary error rendering.
// Render the real shared 404 at both addresses, under the same panel gate,
// and ensure the second middleware pass allows its full HTML to finish.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeAll, expect, it } from "vite-plus/test";
import { gateAdminRequest } from "../../src/lib/access/admin-gate.ts";
import { hiddenTaskRequest } from "../../src/lib/manual-tasks.ts";
import NotFound from "../../src/pages/404.astro";
import { env } from "./cloudflare-workers.ts";

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});
afterEach(() => {
  env.ENVIRONMENT = "local";
});

it.each(["stage", "prod"] as const)(
  "renders indistinguishable missing-panel HTML and headers for hidden pages and actions on %s",
  async (environment) => {
    env.ENVIRONMENT = environment;
    const renderError = async (path: string, method = "GET") => {
      const url = new URL(path, "http://localhost");
      const request = new Request(url, { method });
      // The error renderer supplies /404 as routePattern, preserving the
      // original request address, just as a missing /admin address does.
      expect(hiddenTaskRequest(environment, url, "/404")).toBeNull();
      return gateAdminRequest(
        { url, request, routePattern: "/404", locals: {} },
        () => container.renderToResponse(NotFound, { request }),
        {
          config: { environment: "local", teamDomain: "", aud: "" },
          keys: () => {
            throw new Error("unused");
          },
        },
      );
    };
    const missing = await renderError("/admin/no-existe-emr54");
    const body = await missing.text();
    expect(body).toContain("No encontramos esta página");
    expect(missing.status).toBe(404);
    for (const [path, method] of [
      ["/admin/tareas", "GET"],
      ["/admin/tareas?_action=admin.runTask", "POST"],
      ["/_actions/admin.runTask", "POST"],
    ]) {
      const response = await renderError(path!, method!);
      expect(response.status).toBe(missing.status);
      expect([...response.headers]).toEqual([...missing.headers]);
      expect(await response.text()).toBe(body);
    }
  },
);
