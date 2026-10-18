// Worker entry: Astro serves every request, and the scheduled handler runs
// the hourly jobs (ADR 0013). Every response carries the security headers
// (src/lib/security-headers.ts) and, in a deployed environment, asks not to be
// indexed (src/lib/robots.ts, ADR 0008). The static assets never reach this
// Worker: the build gives them the same headers through `_headers`
// (src/integrations/static-headers.ts). It also exports the Durable Object of
// the per-IP quotas (src/lib/quota/counter.ts, ADR 0012).
//
// Locally, and only locally, it also serves the local media bucket, where the
// business photos are, under /_media/ before Astro sees the request
// (src/lib/media.ts): a deployed environment serves its media from its media
// hostname, without this Worker (ADR 0011).
import { handle } from "@astrojs/cloudflare/handler";
import { serveLocalMedia } from "./lib/media.ts";
import { withRobotsPolicy } from "./lib/robots.ts";
import { withSecurityHeaders } from "./lib/security-headers.ts";
import { runScheduledTasks } from "./scheduled.ts";

export { QuotaCounter } from "./lib/quota/counter.ts";

/**
 * A local media object, or Astro's answer, or a bare 500 when either throws,
 * so it carries the headers too.
 */
async function answer(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    return (await serveLocalMedia(request, env)) ?? (await handle(request, env, ctx));
  } catch (error) {
    console.error("worker: the request failed", error);
    return new Response(null, { status: 500 });
  }
}

export default {
  fetch: async (request, env, ctx) =>
    withSecurityHeaders(
      withRobotsPolicy(await answer(request, env, ctx), env.ENVIRONMENT),
      request,
      env,
      // The dev server's pages need Vite's inline styles and scripts, which
      // the policy forbids; every build, the preview included, sends it.
      { csp: !import.meta.env.DEV },
    ),
  scheduled: (controller, env, ctx) => runScheduledTasks(controller, env, ctx),
} satisfies ExportedHandler<Env>;
