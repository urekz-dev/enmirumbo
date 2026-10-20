// Astro middleware, in this order:
// 1. Every request to /admin and below, and every admin action, passes the
//    Cloudflare Access check (ADR 0010, src/lib/access/).
// 2. Every page under /{estado}/{municipio}/ gets its active locality in
//    `locals.locality`, or a 404 (ADR 0007, src/lib/locality.ts). It reads
//    through the cached HYPERDRIVE: one small query per request, which
//    Hyperdrive answers from its cache for 60 seconds.
import { defineMiddleware, sequence } from "astro:middleware";
import { env, waitUntil } from "cloudflare:workers";
import { withDb } from "./core/db/client.ts";
import { servedLocality } from "./core/locality/served.ts";
import { gateAdminRequest } from "./lib/access/admin-gate.ts";
import { readAccessConfig, remoteAccessKeys } from "./lib/access/verify.ts";
import { gateLocalityRequest, type FindLocality } from "./lib/locality.ts";
import { hiddenTaskRequest } from "./lib/manual-tasks.ts";

const findLocality: FindLocality = (stateSlug, municipalitySlug) =>
  withDb(env, "HYPERDRIVE", { waitUntil }, (db) => servedLocality(db, stateSlug, municipalitySlug));

export const onRequest = sequence(
  defineMiddleware((context, next) =>
    gateAdminRequest(context, next, { config: readAccessConfig(env), keys: remoteAccessKeys }),
  ),
  defineMiddleware(
    (context, next) =>
      hiddenTaskRequest(env.ENVIRONMENT, context.url, context.routePattern) ?? next(),
  ),
  defineMiddleware((context, next) => gateLocalityRequest(context, next, findLocality)),
);
