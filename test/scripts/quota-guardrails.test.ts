// The guardrails of the quota counter: docs/specs/deployment.md, "Anti-abuse
// counters live in a Durable Object and never in PostgreSQL (v2)" (its bounded
// cost), and ADR 0012, amended on 2026-10-15. A Durable Object is billed for
// every second it stays in memory unable to hibernate, so the counter keeps to
// rules that bound its cost: a fixed list of purposes, one instance with a
// constant name, nothing in its storage, no alarm, one timer, and no preview
// URLs. These checks read the code under src/ and wrangler.jsonc, and fail
// naming the file and the line; test/worker/quota.test.ts checks the same
// rules on the running object. The code is parsed with TypeScript, so a
// comment that names a forbidden call is not a finding.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { experimental_readRawConfig } from "wrangler";
import { describe, expect, it } from "vite-plus/test";
import { QUOTAS } from "../../src/core/quota/quotas.ts";
import { filesUnder, ROOT } from "./source-files.ts";

/** The modules of the counter: the Durable Object and what it counts with. */
const COUNTER_MODULES = ["src/lib/quota/", "src/core/quota/"];
/** The one module that may set the counter's timer. */
const COUNTER = "src/lib/quota/counter.ts";
/** The module that names the one instance and addresses it. */
const QUOTA = "src/lib/quota/quota.ts";

const SOURCE = /\.(ts|astro)$/;

/** The code of every source file under src/, by its path from the root. */
function sourceFiles(): Record<string, string> {
  return Object.fromEntries(
    filesUnder(join(ROOT, "src"))
      .filter((file) => SOURCE.test(file))
      .map((file) => [relative(ROOT, file), readFileSync(file, "utf8")]),
  );
}

/** A parsed file: the script of a .astro file is its frontmatter. */
interface Parsed {
  file: string;
  source: ts.SourceFile;
  /** Lines before the parsed code: the opening fence of a frontmatter. */
  offset: number;
}

function parse(file: string, code: string): Parsed {
  let script = code;
  let offset = 0;
  if (file.endsWith(".astro")) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(code);
    script = frontmatter?.[1] ?? "";
    offset = 1;
  }
  const source = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return { file, source, offset };
}

/** Every node of a parsed file, depth first. */
function nodes({ source }: Parsed): ts.Node[] {
  const all: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    all.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return all;
}

/** "file:line" of a node. */
function where({ file, source, offset }: Parsed, node: ts.Node): string {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${file}:${line + offset + 1}`;
}

/** The name a property access or an element access with a literal reads. */
function accessedName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

/** The function a call names: `f(...)` or `x.f(...)`. */
function calledName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  return accessedName(callee);
}

const purposes = new Set(Object.keys(QUOTAS));

/**
 * Every call to `takeQuota` whose purpose is not a literal of QUOTAS, and the
 * purposes of QUOTAS no call takes. The purposes are a fixed list: never one
 * built from a request, so the counters can never multiply by what arrives.
 */
function purposeProblems(files: Record<string, string>): string[] {
  const problems: string[] = [];
  const taken = new Set<string>();
  for (const [file, code] of Object.entries(files)) {
    const parsed = parse(file, code);
    for (const node of nodes(parsed)) {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) continue;
      if (node.expression.text !== "takeQuota") continue;
      const purpose = node.arguments[2];
      if (node.arguments.length === 3 && purpose && ts.isStringLiteralLike(purpose)) {
        if (purposes.has(purpose.text)) {
          taken.add(purpose.text);
          continue;
        }
      }
      problems.push(
        `${where(parsed, node)} — takeQuota takes ${purpose?.getText(parsed.source) ?? "no purpose"}: the purpose must be one of QUOTAS (src/core/quota/quotas.ts), written as a literal`,
      );
    }
  }
  for (const purpose of purposes) {
    if (!taken.has(purpose)) {
      problems.push(
        `QUOTAS has "${purpose}", which no page or action takes: a purpose arrives with the surface it protects`,
      );
    }
  }
  return problems;
}

/**
 * How the code uses the identifier QUOTA_COUNTER: only
 * `<env>.QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME)` is allowed. The text is
 * the widest expression of the use that the check understood.
 */
function bindingUse(
  node: ts.Identifier,
  source: ts.SourceFile,
): { text: string; allowed: boolean } {
  const access = node.parent;
  if (!ts.isPropertyAccessExpression(access) || access.name !== node) {
    return { text: access.getText(source), allowed: false };
  }
  const method = access.parent;
  if (!ts.isPropertyAccessExpression(method) || method.expression !== access) {
    return { text: access.getText(source), allowed: false };
  }
  const call = method.parent;
  if (!ts.isCallExpression(call) || call.expression !== method) {
    return { text: method.getText(source), allowed: false };
  }
  const [name, ...rest] = call.arguments;
  const allowed =
    method.name.text === "getByName" &&
    rest.length === 0 &&
    name !== undefined &&
    ts.isIdentifier(name) &&
    name.text === "QUOTA_COUNTER_NAME";
  return { text: call.getText(source), allowed };
}

/**
 * Every use of the QUOTA_COUNTER binding other than
 * `QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME)`, and a QUOTA_COUNTER_NAME that
 * is not one exported constant string in src/lib/quota/quota.ts. So there is
 * one instance for every purpose, never one per visitor, address, user or
 * purpose.
 */
function instanceProblems(files: Record<string, string>): string[] {
  const problems: string[] = [];
  const names: string[] = [];
  for (const [file, code] of Object.entries(files)) {
    const parsed = parse(file, code);
    for (const node of nodes(parsed)) {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(parsed.source) === "QUOTA_COUNTER_NAME"
      ) {
        const statement = node.parent.parent;
        const exported =
          ts.isVariableStatement(statement) &&
          (statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        const constant = (node.parent.flags & ts.NodeFlags.Const) !== 0;
        const literal = node.initializer !== undefined && ts.isStringLiteral(node.initializer);
        names.push(where(parsed, node));
        if (file !== QUOTA || !exported || !constant || !literal) {
          problems.push(
            `${where(parsed, node)} — QUOTA_COUNTER_NAME must be declared once, in ${QUOTA}, as an exported constant string`,
          );
        }
      }
      if (!ts.isIdentifier(node) || node.text !== "QUOTA_COUNTER") continue;
      const use = bindingUse(node, parsed.source);
      if (!use.allowed) {
        problems.push(
          `${where(parsed, node)} — "${use.text}": the quota counter is reached only as QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME), one instance for every purpose`,
        );
      }
    }
  }
  if (names.length === 0) {
    problems.push(`QUOTA_COUNTER_NAME is not declared: declare it in ${QUOTA}`);
  }
  if (names.length > 1) {
    problems.push(`QUOTA_COUNTER_NAME is declared ${names.length} times: ${names.join(", ")}`);
  }
  return problems;
}

/** Calls and members the counter never uses, and why. */
const FORBIDDEN: Record<string, string> = {
  storage: "the counter never touches the storage of its Durable Object",
  setAlarm: "the counter sets no alarm",
  getAlarm: "the counter has no alarm to read",
  deleteAlarm: "the counter has no alarm to delete",
  setInterval: "the counter's only timer is one setTimeout, set again by hand while counters exist",
};

/**
 * In the modules of the counter: any use of the storage, any alarm (a call or
 * an `alarm()` handler), any interval, and any `setTimeout` other than the one
 * of the counter's `schedule`.
 */
function counterProblems(files: Record<string, string>): string[] {
  const problems: string[] = [];
  const timers: string[] = [];
  for (const [file, code] of Object.entries(files)) {
    if (!COUNTER_MODULES.some((folder) => file.startsWith(folder))) continue;
    const parsed = parse(file, code);
    for (const node of nodes(parsed)) {
      const name = ts.isIdentifier(node) ? node.text : accessedName(node);
      if (name !== null && Object.hasOwn(FORBIDDEN, name)) {
        // An identifier inside an access is reported once, by its access.
        const inAccess =
          ts.isIdentifier(node) &&
          (ts.isPropertyAccessExpression(node.parent) ||
            ts.isElementAccessExpression(node.parent)) &&
          accessedName(node.parent) === name;
        if (!inAccess) {
          problems.push(`${where(parsed, node)} — ${name}: ${FORBIDDEN[name]}`);
        }
      }
      if (
        (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) &&
        node.name.getText(parsed.source) === "alarm"
      ) {
        problems.push(`${where(parsed, node)} — alarm(): the counter has no alarm handler`);
      }
      if (ts.isCallExpression(node) && calledName(node) === "setTimeout") {
        timers.push(where(parsed, node));
        let scope: ts.Node | undefined = node.parent;
        while (scope !== undefined && !ts.isMethodDeclaration(scope)) scope = scope.parent;
        const method = scope?.name.getText(parsed.source);
        if (file !== COUNTER || method !== "schedule") {
          problems.push(
            `${where(parsed, node)} — setTimeout: the counter's one timer is set only by schedule() in ${COUNTER}`,
          );
        }
      }
    }
  }
  if (timers.length > 1) {
    problems.push(`the counter sets ${timers.length} timers (${timers.join(", ")}), not one`);
  }
  return problems;
}

/** A raw Wrangler configuration, as wrangler.jsonc is written. */
interface RawConfig {
  preview_urls?: unknown;
  env?: Record<string, { preview_urls?: unknown }>;
}

/**
 * Where `preview_urls` is not written as false: the top level and every
 * environment, each for itself. A preview URL runs another copy of the Worker
 * and its Durable Objects for each version uploaded.
 */
function previewUrlProblems(raw: RawConfig): string[] {
  const problems: string[] = [];
  if (raw.preview_urls !== false) {
    problems.push(`the top level has preview_urls ${String(raw.preview_urls)}, not false`);
  }
  const environments = Object.entries(raw.env ?? {});
  if (environments.length === 0) problems.push("wrangler.jsonc declares no environment");
  for (const [env, config] of environments) {
    if (config.preview_urls !== false) {
      problems.push(`env.${env} has preview_urls ${String(config.preview_urls)}, not false`);
    }
  }
  return problems;
}

describe("Anti-abuse counters live in a Durable Object and never in PostgreSQL (v2)", () => {
  const files = sourceFiles();

  it("it really reads the code: the counter, how it is asked, and the pages and actions that ask", () => {
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        COUNTER,
        QUOTA,
        "src/core/quota/quotas.ts",
        "src/actions/index.ts",
        "src/pages/[state]/[municipality]/buscar.astro",
      ]),
    );
  });

  // Scenario: the rules are checked (a fixed list of purposes)
  it("the purposes are the fixed list of QUOTAS, each taken with a literal", () => {
    expect(purposeProblems(files)).toEqual([]);
  });

  // Scenario: one object for every purpose
  it("every purpose reaches the one instance named QUOTA_COUNTER_NAME", () => {
    expect(instanceProblems(files)).toEqual([]);
  });

  // Scenarios: nothing in the storage of the Durable Object; no timer without
  // a counter
  it("the counter writes nothing to its storage, sets no alarm and has one timer", () => {
    expect(counterProblems(files)).toEqual([]);
  });

  // Scenario: the rules are checked (no preview URLs)
  it("preview_urls is false at the top level and in every environment of wrangler.jsonc", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    expect(previewUrlProblems(rawConfig as RawConfig)).toEqual([]);
  });
});

describe("The checks of the quota counter fail on a change that could run up a bill", () => {
  // Scenario: the rules are checked
  it("a purpose built from a request, or one QUOTAS does not have", () => {
    expect(
      purposeProblems({
        "src/pages/a.astro": [
          "---",
          'const one = await takeQuota(env, Astro.request.headers, "search");',
          "const two = await takeQuota(env, Astro.request.headers, purpose);",
          "---",
          "<p>takeQuota(env, headers, nope)</p>",
        ].join("\n"),
        "src/actions/b.ts": 'takeQuota(env, headers, "signup");\n// takeQuota(env, h, x)',
      }),
    ).toEqual([
      "src/pages/a.astro:3 — takeQuota takes purpose: the purpose must be one of QUOTAS (src/core/quota/quotas.ts), written as a literal",
      'src/actions/b.ts:1 — takeQuota takes "signup": the purpose must be one of QUOTAS (src/core/quota/quotas.ts), written as a literal',
      'QUOTAS has "report", which no page or action takes: a purpose arrives with the surface it protects',
    ]);
  });

  it("an instance per purpose, per address or per visitor, or the binding passed around", () => {
    const problems = instanceProblems({
      [QUOTA]: [
        'export const QUOTA_COUNTER_NAME = "quotas";',
        "env.QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME).take(purpose, subject);",
        "env.QUOTA_COUNTER.getByName(purpose).take(purpose, subject);",
        "env.QUOTA_COUNTER.get(env.QUOTA_COUNTER.idFromName(subject));",
        "const { QUOTA_COUNTER } = env;",
        'type Quota = Pick<Env, "QUOTA_COUNTER">; // QUOTA_COUNTER.newUniqueId()',
      ].join("\n"),
      "src/lib/other.ts": "let QUOTA_COUNTER_NAME = `visitor-${ip}`;",
    });
    expect(problems).toEqual([
      'src/lib/quota/quota.ts:3 — "env.QUOTA_COUNTER.getByName(purpose)": the quota counter is reached only as QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME), one instance for every purpose',
      'src/lib/quota/quota.ts:4 — "env.QUOTA_COUNTER.get(env.QUOTA_COUNTER.idFromName(subject))": the quota counter is reached only as QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME), one instance for every purpose',
      'src/lib/quota/quota.ts:4 — "env.QUOTA_COUNTER.idFromName(subject)": the quota counter is reached only as QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME), one instance for every purpose',
      'src/lib/quota/quota.ts:5 — "QUOTA_COUNTER": the quota counter is reached only as QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME), one instance for every purpose',
      "src/lib/other.ts:1 — QUOTA_COUNTER_NAME must be declared once, in src/lib/quota/quota.ts, as an exported constant string",
      "QUOTA_COUNTER_NAME is declared 2 times: src/lib/quota/quota.ts:1, src/lib/other.ts:1",
    ]);
    expect(
      instanceProblems({ [QUOTA]: "env.QUOTA_COUNTER.getByName(QUOTA_COUNTER_NAME);" }),
    ).toEqual([`QUOTA_COUNTER_NAME is not declared: declare it in ${QUOTA}`]);
  });

  it("the storage, an alarm, an interval or a second timer in the counter", () => {
    const problems = counterProblems({
      [COUNTER]: [
        "// Never ctx.storage, setAlarm or alarm(): this comment is no finding.",
        "export class QuotaCounter extends DurableObject<Env> {",
        "  async take() {",
        '    await this.ctx.storage.put("code", 1);',
        "    await this.ctx.storage.setAlarm(Date.now() + 1000);",
        '    this.ctx["storage"].sql.exec("SELECT 1");',
        "    setInterval(() => this.sweep(), 1000);",
        "    setTimeout(() => this.sweep(), 1000);",
        "  }",
        "  async alarm() {}",
        "  private schedule() { this.timer = setTimeout(() => {}, 1000); }",
        "}",
      ].join("\n"),
      "src/core/quota/window.ts": "const { storage } = state;",
      "src/lib/elsewhere.ts": "ctx.storage.setAlarm(0); setInterval(f, 1);",
    });
    expect(problems).toEqual([
      "src/lib/quota/counter.ts:4 — storage: the counter never touches the storage of its Durable Object",
      "src/lib/quota/counter.ts:5 — setAlarm: the counter sets no alarm",
      "src/lib/quota/counter.ts:5 — storage: the counter never touches the storage of its Durable Object",
      "src/lib/quota/counter.ts:6 — storage: the counter never touches the storage of its Durable Object",
      "src/lib/quota/counter.ts:7 — setInterval: the counter's only timer is one setTimeout, set again by hand while counters exist",
      "src/lib/quota/counter.ts:8 — setTimeout: the counter's one timer is set only by schedule() in src/lib/quota/counter.ts",
      "src/lib/quota/counter.ts:10 — alarm(): the counter has no alarm handler",
      "src/core/quota/window.ts:1 — storage: the counter never touches the storage of its Durable Object",
      "the counter sets 2 timers (src/lib/quota/counter.ts:8, src/lib/quota/counter.ts:11), not one",
    ]);
  });

  it("preview URLs left on, or left to inheritance, anywhere", () => {
    expect(
      previewUrlProblems({
        preview_urls: false,
        env: { dev: { preview_urls: false }, stage: {}, prod: { preview_urls: true } },
      }),
    ).toEqual([
      "env.stage has preview_urls undefined, not false",
      "env.prod has preview_urls true, not false",
    ]);
    expect(previewUrlProblems({})).toEqual([
      "the top level has preview_urls undefined, not false",
      "wrangler.jsonc declares no environment",
    ]);
  });
});
