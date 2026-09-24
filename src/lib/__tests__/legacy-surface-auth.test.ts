/**
 * Static auth-gate regression test for the legacy operator surface
 * (launch audit fix B2, 2026-06-09).
 *
 * The legacy operator dashboard pages and their APIs shipped with zero
 * auth: server components queried supabaseAdmin directly and the API
 * routes trusted "the admin UI is operator-only" as the protection
 * layer. The UI is not the gate. The route is.
 *
 * This suite scans the route and page SOURCE FILES (no imports, no
 * mocking) and asserts the gate is present:
 *
 *   - API routes: every exported HTTP handler in the gated segments
 *     calls requireOperator() (or isCronAuthorized for cron-callable
 *     routes). Enumeration is dynamic, so a new route.ts added under
 *     a gated segment without a gate fails this suite.
 *   - Pages: every server page in the gated segments calls
 *     getOperatorSession() and redirects when it returns null.
 *
 * Out of scope by design: /api/v1/* (token auth), /api/cron/* (bearer
 * auth via cron-auth.ts), /portal/* (firm/client session gates),
 * /admin/* (gated once in src/app/admin/layout.tsx).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as ts from "typescript";

const APP_DIR = path.join(process.cwd(), "src", "app");
const ENRICHMENT_API_DIR = path.join(APP_DIR, "api", "admin", "prospect-enrichment");
const ENRICHMENT_AUTH_IMPORT = "@/lib/prospect-enrichment-auth";

// ── Gated segments ──────────────────────────────────────────────────────────

/** API segments where every route.ts must gate every handler. */
const GATED_API_SEGMENTS = [
  path.join(APP_DIR, "api", "leads"),
  path.join(APP_DIR, "api", "sequences"),
  path.join(APP_DIR, "api", "admin"),
];

/** Page segments where every page.tsx must carry the operator gate. */
const GATED_PAGE_SEGMENTS = [
  path.join(APP_DIR, "pipeline"),
  path.join(APP_DIR, "leads"),
  path.join(APP_DIR, "sequences"),
  path.join(APP_DIR, "reviews"),
  path.join(APP_DIR, "firms"),
  path.join(APP_DIR, "domains"),
  path.join(APP_DIR, "conflict-register"),
  path.join(APP_DIR, "analytics"),
  path.join(APP_DIR, "onboarding"),
  path.join(APP_DIR, "settings"),
];

/**
 * The legacy root operator dashboard (src/app/page.tsx) was deleted in
 * 698b4bc: it collided with the relocated marketing homepage
 * ((marketing)/page.tsx), which now serves `/` as a public surface. The
 * operator console lives at /admin/triage. Pinned below as non-existence
 * so the collision cannot silently return.
 */
const ROOT_DASHBOARD_PAGE = path.join(APP_DIR, "page.tsx");

// ── Helpers ─────────────────────────────────────────────────────────────────

function walk(dir: string, fileName: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, fileName));
    } else if (entry.name === fileName) {
      out.push(full);
    }
  }
  return out;
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function rel(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

/** Counts exported HTTP method handlers in a route file. */
function countHandlers(src: string): number {
  const matches = src.match(
    /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
  );
  return matches?.length ?? 0;
}

function sourceTree(src: string): ts.SourceFile {
  return ts.createSourceFile("route.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Require the real, unaliased named import, not a comment or lookalike helper. */
function namedImport(tree: ts.SourceFile, name: string): string | null {
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings) && bindings.elements.some((item) =>
      !item.isTypeOnly && item.name.text === name && (!item.propertyName || item.propertyName.text === name))) {
      return statement.moduleSpecifier.text;
    }
  }
  return null;
}

/** The two leading statements must return the helper's denial before any work. */
function hasLeadingEnrichmentGuard(statements: ts.NodeArray<ts.Statement>, mutation: boolean): boolean {
  const [gate, denial] = statements;
  if (!gate || !ts.isVariableStatement(gate) || gate.declarationList.declarations.length !== 1 || !denial) return false;
  const declaration = gate.declarationList.declarations[0];
  if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "auth"
    || !declaration.initializer || !ts.isAwaitExpression(declaration.initializer)) return false;
  const call = declaration.initializer.expression;
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)
    || call.expression.text !== "requireProspectEnrichmentOperator"
    || call.arguments[0]?.getText() !== "request"
    || (mutation && call.arguments[1]?.kind !== ts.SyntaxKind.TrueKeyword)) return false;
  return denial.getText().replace(/\s+/g, "") === "if(!auth.ok)returnauth.response;";
}

/** Scoped recognition preserves a separate gate requirement for every handler. */
function countEnrichmentGates(src: string, file: string): number {
  const relative = path.relative(ENRICHMENT_API_DIR, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return 0;
  const tree = sourceTree(src);
  const direct = namedImport(tree, "requireProspectEnrichmentOperator") === ENRICHMENT_AUTH_IMPORT;
  const readImport = namedImport(tree, "readRoute");
  const wrapped = Boolean(readImport?.startsWith(".")
    && path.resolve(path.dirname(file), readImport + ".ts") === path.join(ENRICHMENT_API_DIR, "_read-common.ts"));
  return tree.statements.filter((statement) => {
    if (!ts.isFunctionDeclaration(statement) || !statement.body || !statement.name
      || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      || !statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(statement.name.text)) return false;
    if (direct && hasLeadingEnrichmentGuard(statement.body.statements, !["GET", "HEAD", "OPTIONS"].includes(statement.name.text))) return true;
    if (!wrapped || statement.name.text !== "GET" || statement.body.statements.length !== 1) return false;
    const returned = statement.body.statements[0];
    if (!ts.isReturnStatement(returned) || !returned.expression || !ts.isCallExpression(returned.expression)) return false;
    const call = returned.expression;
    return ts.isIdentifier(call.expression) && call.expression.text === "readRoute"
      && call.arguments[0]?.getText() === "request" && call.arguments.length === 3
      && ts.isArrowFunction(call.arguments[2]);
  }).length;
}

/**
 * Counts auth-gate invocations in a route file. Recognized mechanisms:
 *
 *   - requireOperator()        @/lib/admin-auth one-liner (preferred)
 *   - isCronAuthorized(req)    @/lib/cron-auth bearer compare (cron routes
 *                              and cron-or-operator combos)
 *   - getOperatorSession()     @/lib/portal-auth session check; several
 *                              admin routes gate on it directly (explainers,
 *                              firms routing, webhook-outbox, voice-callback
 *                              promote, onboarding retry, triage stream-check)
 *   - x-admin-secret header    /api/admin/provision-clients compares the
 *                              header against ADMIN_API_SECRET (ops-script
 *                              shared secret, predates the session gates)
 */
function countGates(src: string, file: string): number {
  const operatorGates = src.match(/await\s+requireOperator\(\)/g)?.length ?? 0;
  const cronGates = src.match(/isCronAuthorized\(/g)?.length ?? 0;
  const operatorSessionGates =
    src.match(/await\s+getOperatorSession\(\)/g)?.length ?? 0;
  const adminSecretGates =
    src.match(/headers\.get\(["']x-admin-secret["']\)/g)?.length ?? 0;
  return operatorGates + cronGates + operatorSessionGates + adminSecretGates + countEnrichmentGates(src, file);
}

describe("legacy surface auth: verified prospect enrichment delegation", () => {
  it("keeps the recognized helper bound to a current operator session", () => {
    const tree = sourceTree(read(path.join(process.cwd(), "src/lib/prospect-enrichment-auth.ts")));
    expect(namedImport(tree, "getOperatorSession")).toBe("@/lib/portal-auth");
    const helper = tree.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "requireProspectEnrichmentOperator");
    const statements = helper?.body?.statements;
    expect(statements?.[0].getText().replace(/\s+/g, "")).toBe("constsession=awaitgetOperatorSession();");
    expect(statements?.[1].getText().replace(/\s+/g, "")).toBe('if(!session){return{ok:false,response:prospectEnrichmentJson({error:"Unauthorized"},401)};}');
  });

  it("keeps the read wrapper's operator denial ahead of its callback", () => {
    const tree = sourceTree(read(path.join(ENRICHMENT_API_DIR, "_read-common.ts")));
    expect(namedImport(tree, "requireProspectEnrichmentOperator")).toBe(ENRICHMENT_AUTH_IMPORT);
    const wrapper = tree.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "readRoute");
    const first = wrapper?.body?.statements[0];
    expect(first && ts.isTryStatement(first)).toBe(true);
    if (!first || !ts.isTryStatement(first)) return;
    expect(hasLeadingEnrichmentGuard(first.tryBlock.statements, false)).toBe(true);
    expect(first.tryBlock.statements.slice(0, 2).some((node) => /work\s*\(/.test(node.getText()))).toBe(false);
  });

  it("does not count an import, ignored denial, wrong helper, or a second unguarded handler", () => {
    const file = path.join(ENRICHMENT_API_DIR, "packages", "route.ts");
    const imported = `import { requireProspectEnrichmentOperator } from "${ENRICHMENT_AUTH_IMPORT}";`;
    const guarded = `${imported} export async function POST(request) { const auth = await requireProspectEnrichmentOperator(request, true); if (!auth.ok) return auth.response; return work(); }`;
    expect(countEnrichmentGates(guarded, file)).toBe(1);
    expect(countEnrichmentGates(imported + "export async function POST(request) { return work(); }", file)).toBe(0);
    expect(countEnrichmentGates(guarded.replace("if (!auth.ok) return auth.response;", ""), file)).toBe(0);
    expect(countEnrichmentGates(guarded.replace(ENRICHMENT_AUTH_IMPORT, "./untrusted-helper"), file)).toBe(0);
    expect(countEnrichmentGates(guarded.replace("request, true", "request"), file)).toBe(0);
    expect(countEnrichmentGates(guarded + " export async function GET(request) { return work(); }", file)).toBe(1);
    expect(countEnrichmentGates(guarded, path.join(APP_DIR, "api", "leads", "route.ts"))).toBe(0);
  });
});

// ── API routes ──────────────────────────────────────────────────────────────

describe("legacy surface auth: API routes", () => {
  const routeFiles = GATED_API_SEGMENTS.flatMap((seg) => walk(seg, "route.ts"));

  it("finds the gated route files (sweep sanity check)", () => {
    // 5 under api/leads, 4 under api/sequences, 20 under api/admin.
    expect(routeFiles.length).toBeGreaterThanOrEqual(29);
  });

  it.each(routeFiles.map((f) => [rel(f), f]))(
    "%s imports an auth gate",
    (_label, file) => {
      const src = read(file as string);
      expect(
        src.includes("requireOperator") ||
          src.includes("isCronAuthorized") ||
          src.includes("getOperatorSession") ||
          src.includes("x-admin-secret") ||
          countEnrichmentGates(src, file as string) > 0,
        `${rel(file as string)} must import an existing operator/cron gate or use the verified prospect enrichment helper`,
      ).toBe(true);
    },
  );

  it.each(routeFiles.map((f) => [rel(f), f]))(
    "%s gates every exported handler",
    (_label, file) => {
      const src = read(file as string);
      const handlers = countHandlers(src);
      const gates = countGates(src, file as string);
      expect(handlers, `${rel(file as string)} exports no handlers?`).toBeGreaterThan(0);
      expect(
        gates,
        `${rel(file as string)} has ${handlers} handler(s) but only ${gates} auth-gate call(s); every handler must open with requireOperator() (or isCronAuthorized for cron-callable routes)`,
      ).toBeGreaterThanOrEqual(handlers);
    },
  );
});

// ── Pages ───────────────────────────────────────────────────────────────────

describe("legacy surface auth: operator pages", () => {
  const pageFiles = GATED_PAGE_SEGMENTS.flatMap((seg) => walk(seg, "page.tsx"));

  it("the root dashboard stays deleted (698b4bc homepage collision fix)", () => {
    expect(
      fs.existsSync(ROOT_DASHBOARD_PAGE),
      "src/app/page.tsx must not exist: it collides with (marketing)/page.tsx at `/`. A gated root dashboard belongs under /admin.",
    ).toBe(false);
  });

  it("finds the gated page files (sweep sanity check)", () => {
    // Pipeline + leads (2) + sequences (2) + reviews + firms (2)
    // + domains + conflict-register + analytics + onboarding + settings.
    expect(pageFiles.length).toBeGreaterThanOrEqual(13);
  });

  it.each(pageFiles.map((f) => [rel(f), f]))(
    "%s gates with getOperatorSession + redirect",
    (_label, file) => {
      const src = read(file as string);
      expect(
        src.includes("getOperatorSession"),
        `${rel(file as string)} must call getOperatorSession() before any data access (pattern: src/app/admin/layout.tsx)`,
      ).toBe(true);
      // Require the actual guard shape, not just an import or a stray
      // redirect() somewhere in the file: the null-session check must be
      // immediately followed by the redirect.
      expect(
        /if\s*\(!session\)[\s\S]{0,80}redirect\(/.test(src),
        `${rel(file as string)} must guard with the shape: if (!session) redirect("/portal/login...") (a getOperatorSession import alone is not a gate)`,
      ).toBe(true);
    },
  );
});
