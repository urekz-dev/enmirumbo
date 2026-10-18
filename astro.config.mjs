// @ts-check
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { ACTION_BODY_LIMIT } from "./src/core/photos/limits.ts";
import { staticHeaders } from "./src/integrations/static-headers.ts";

// The build prerenders pages in a local workerd with the bindings of the
// target environment. Those of a deployed environment (CLOUDFLARE_ENV=dev,
// stage or prod) are real Hyperdrive configs with no local connection string,
// and workerd refuses to start without one. No prerendered page reads the
// database (docs/specs/deployment.md, "The production build does not need the
// database"), so the build gives them an address where nothing answers: a
// page that tried would fail the build. The deployed Worker never sees it.
if (process.env["CLOUDFLARE_ENV"]) {
  for (const binding of ["HYPERDRIVE", "HYPERDRIVE_FRESH"]) {
    process.env[`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${binding}`] ??=
      "postgres://prerender:none@127.0.0.1:9/no-database-at-build-time";
  }
}

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    // Photos are transformed once, on upload, by the registration through
    // the IMAGES binding of wrangler.jsonc (ADR 0011,
    // src/core/photos/upload.ts), never by Astro's image service.
    imageService: "passthrough",
  }),
  build: {
    // Prerendered pages (the legal pages) are written as `<page>.html`, which
    // Cloudflare serves at `/<page>` with no trailing slash, like every other
    // URL of the site. As `<page>/index.html` they would answer a redirect to
    // `/<page>/`.
    format: "file",
    // The content security policy allows no inline style
    // (src/lib/security-headers.ts), so every stylesheet is a file, however
    // small.
    inlineStylesheets: "never",
  },
  // Static assets skip the Worker, so the build gives them the security
  // headers and, in a deployed environment, noindex through `_headers`
  // (src/integrations/static-headers.ts).
  integrations: [staticHeaders()],
  // No sessions, so the adapter does not require a KV binding.
  session: false,
  security: {
    // The registration form uploads a photo of up to 5 MB, over Astro's
    // default of 1 MiB for an action's body (src/core/photos/limits.ts).
    actionBodySizeLimit: ACTION_BODY_LIMIT,
  },
  vite: {
    plugins: [tailwindcss()],
    // Nor any inline script or data: URL: a small script or image stays a
    // file too, instead of being inlined into the page.
    build: { assetsInlineLimit: 0 },
  },
});
