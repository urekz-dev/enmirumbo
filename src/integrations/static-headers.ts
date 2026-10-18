// The headers of the static assets: the security headers of every response
// (docs/specs/deployment.md, "Every response carries the security headers and
// the content security policy (v2)") and, until the cut-over, noindex
// (docs/specs/base-layout.md, "Deployed environments stay out of search
// engines until the cut-over (v2)").
//
// Cloudflare serves the static assets of the build (the prerendered legal
// pages, the hashed CSS and the share images under /_astro/) without invoking
// the Worker, so the headers that src/worker.ts adds never reach them. For
// those files Cloudflare applies the rules of the `_headers` file at the root
// of the assets instead, and only to them, never to a Worker response. After
// each build this integration reads the vars of the environment the build
// targets (dist/server/wrangler.json, the file `wrangler deploy` deploys) and
// adds to `_headers`:
// - for every static asset, the security headers a page of that environment
//   gets from the Worker (securityHeaders, src/lib/security-headers.ts), the
//   same content security policy included, in every environment;
// - when that environment blocks indexing (`blocksIndexing`, the same rule
//   the Worker follows), `X-Robots-Tag: noindex` for every static asset. A
//   local build gets none, and when the cut-over lets production be indexed,
//   its builds stop getting it with no other change.
// scripts/deploy/check-build.sh refuses a deployed build without both rules.
import { readFile, writeFile } from "node:fs/promises";
import type { AstroIntegration } from "astro";
import { blocksIndexing, NOINDEX, ROBOTS_HEADER } from "../lib/robots.ts";
import { securityHeaders, type SecurityVars } from "../lib/security-headers.ts";

/** The `_headers` rule that asks search engines not to index any static asset. */
export const STATIC_NOINDEX_RULE = `/*\n  ${ROBOTS_HEADER}: ${NOINDEX}\n`;

const NOINDEX_COMMENT =
  "# Deployed environments stay out of search engines until the cut-over (ADR 0008).\n";

const SECURITY_COMMENT =
  "# The security headers of every response, also on the static assets (docs/specs/deployment.md).\n";

/** The `_headers` rule that gives every static asset the security headers of `vars`. */
export function staticSecurityRule(vars: SecurityVars): string {
  const lines = Object.entries(securityHeaders(vars)).map(([name, value]) => `  ${name}: ${value}`);
  return `/*\n${lines.join("\n")}\n`;
}

/** The vars of the Worker configuration a build wrote; none when there is no such file. */
export async function builtVars(serverDir: URL): Promise<Record<string, string>> {
  let config: unknown;
  try {
    config = JSON.parse(await readFile(new URL("./wrangler.json", serverDir), "utf8"));
  } catch {
    // No configuration to read: the environment is unknown, which counts as
    // deployed (blocksIndexing fails closed), with no measurement or media hostname.
    return {};
  }
  const vars = (config as { vars?: Record<string, unknown> } | null)?.vars ?? {};
  return Object.fromEntries(
    Object.entries(vars).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/** What addStaticHeaders wrote. */
export interface StaticHeaders {
  /** Always: the security headers of every static asset. */
  security: true;
  /** Whether every static asset asks not to be indexed. */
  noindex: boolean;
}

/**
 * Adds the security rule and, when the environment blocks indexing, the
 * noindex rule to the `_headers` file of the static assets, keeping the rules
 * already there (the adapter writes the cache rule of /_astro/). Adding a rule
 * the file already has changes nothing.
 */
export async function addStaticHeaders(clientDir: URL, vars: SecurityVars): Promise<StaticHeaders> {
  const file = new URL("./_headers", clientDir);
  let headers = "";
  try {
    headers = await readFile(file, "utf8");
  } catch {
    // No _headers yet: these rules are the first.
  }
  const noindex = blocksIndexing(vars.ENVIRONMENT);
  const rules = [
    [SECURITY_COMMENT, staticSecurityRule(vars)],
    ...(noindex ? [[NOINDEX_COMMENT, STATIC_NOINDEX_RULE]] : []),
  ].filter(([, rule]) => !headers.includes(rule ?? ""));
  if (rules.length > 0) {
    const before = headers === "" ? "" : `${headers.trimEnd()}\n\n`;
    const added = rules.map(([comment, rule]) => `${comment}${rule}`).join("\n");
    await writeFile(file, `${before}${added}`);
  }
  return { security: true, noindex };
}

export function staticHeaders(): AstroIntegration {
  let serverDir: URL | undefined;
  let clientDir: URL | undefined;
  return {
    name: "enmirumbo:static-headers",
    hooks: {
      "astro:config:done": ({ config }) => {
        serverDir = config.build.server;
        clientDir = config.build.client;
      },
      "astro:build:done": async ({ logger }) => {
        if (serverDir === undefined || clientDir === undefined) return;
        const vars = await builtVars(serverDir);
        const environment = vars["ENVIRONMENT"] ?? "an unknown environment";
        const { noindex } = await addStaticHeaders(clientDir, vars);
        logger.info(`security headers for every static asset of ${environment}`);
        logger.info(
          noindex
            ? `${ROBOTS_HEADER}: ${NOINDEX} for every static asset of ${environment}`
            : `static assets stay indexable in ${environment}`,
        );
      },
    },
  };
}
