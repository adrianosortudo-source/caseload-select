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

const APP_DIR = path.join(process.cwd(), "src", "app");

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

/** Root operator dashboard, gated individually (it is src/app/page.tsx). */
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
function countGates(src: string): number {
  const operatorGates = src.match(/await\s+requireOperator\(\)/g)?.length ?? 0;
  const cronGates = src.match(/isCronAuthorized\(/g)?.length ?? 0;
  const operatorSessionGates =
    src.match(/await\s+getOperatorSession\(\)/g)?.length ?? 0;
  const adminSecretGates =
    src.match(/headers\.get\(["']x-admin-secret["']\)/g)?.length ?? 0;
  return operatorGates + cronGates + operatorSessionGates + adminSecretGates;
}

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
          src.includes("x-admin-secret"),
        `${rel(file as string)} must import requireOperator (from @/lib/admin-auth), isCronAuthorized (from @/lib/cron-auth), or getOperatorSession (from @/lib/portal-auth)`,
      ).toBe(true);
    },
  );

  it.each(routeFiles.map((f) => [rel(f), f]))(
    "%s gates every exported handler",
    (_label, file) => {
      const src = read(file as string);
      const handlers = countHandlers(src);
      const gates = countGates(src);
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
  const pageFiles = [
    ROOT_DASHBOARD_PAGE,
    ...GATED_PAGE_SEGMENTS.flatMap((seg) => walk(seg, "page.tsx")),
  ];

  it("finds the gated page files (sweep sanity check)", () => {
    // Dashboard + pipeline + leads (2) + sequences (2) + reviews + firms (2)
    // + domains + conflict-register + analytics + onboarding + settings.
    expect(pageFiles.length).toBeGreaterThanOrEqual(14);
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
