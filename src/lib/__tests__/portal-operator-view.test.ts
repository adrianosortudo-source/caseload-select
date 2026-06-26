/**
 * Operator-view contract regression test (DR-076, audit 2026-06-26 finding 03).
 *
 * The operator-view of the lawyer portal failed three different ways:
 *   - /clients and /matters guarded with getFirmSession() (which nulls
 *     operators) then redirected to `/portal/${firmId}/login`, a route that
 *     DOES NOT EXIST, producing a hard 404 (this also hit real lawyers who
 *     arrived without a session).
 *   - /dashboard, /pipeline, /leads, /leads/[leadId] and the bare [firmId]
 *     root checked session.firm_id !== firmId with no operator bypass, so the
 *     operator's cross-firm token bounced them to login.
 *   - /messages rendered the console chrome instead of staying in the portal.
 *
 * The fix centralizes the contract in requirePortalViewer(firmId) and uses the
 * real /portal/login. This suite scans the portal SOURCE FILES (no imports,
 * no mocking, same approach as legacy-surface-auth.test.ts) and pins:
 *
 *   1. NO portal page redirects to the non-existent /portal/[firmId]/login.
 *   2. The lawyer-data pages that used to bounce/404 now call
 *      requirePortalViewer (the operator-admitting shared guard).
 *   3. requirePortalViewer admits operators (the helper source carries the
 *      operator branch).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const PORTAL_DIR = path.join(process.cwd(), "src", "app", "portal", "[firmId]");
const PORTAL_AUTH = path.join(process.cwd(), "src", "lib", "portal-auth.ts");

function walk(dir: string, fileName: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, fileName));
    else if (entry.name === fileName) out.push(full);
  }
  return out;
}

const read = (f: string) => fs.readFileSync(f, "utf8");
const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, "/");

const pages = walk(PORTAL_DIR, "page.tsx");

describe("portal operator-view contract (DR-076)", () => {
  it("finds the portal pages (sweep sanity check)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  // ── Invariant 1: the 404 redirect target is gone everywhere ───────────────
  it.each(pages.map((f) => [rel(f), f]))(
    "%s does not redirect to the non-existent /portal/[firmId]/login",
    (_label, file) => {
      const src = read(file as string);
      expect(
        src.includes("/portal/${firmId}/login"),
        `${rel(file as string)} still targets /portal/[firmId]/login, which 404s. Use /portal/login.`,
      ).toBe(false);
    },
  );

  // ── Invariant 2: the previously-broken data pages use the shared guard ────
  const GUARDED = [
    "dashboard/page.tsx",
    "pipeline/page.tsx",
    "leads/page.tsx",
    "leads/[leadId]/page.tsx",
    "clients/page.tsx",
    "matters/[matterId]/page.tsx",
  ].map((p) => path.join(PORTAL_DIR, ...p.split("/")));

  it.each(GUARDED.map((f) => [rel(f), f]))(
    "%s admits operators via requirePortalViewer",
    (_label, file) => {
      const src = read(file as string);
      expect(
        src.includes("requirePortalViewer("),
        `${rel(file as string)} must guard with requirePortalViewer(firmId) so operators get the read-only mirror (DR-076)`,
      ).toBe(true);
      // The old getFirmSession-then-404 pattern must be gone from these pages.
      expect(
        src.includes("getFirmSession("),
        `${rel(file as string)} still calls getFirmSession(), which nulls operators`,
      ).toBe(false);
    },
  );

  // ── Invariant 3: the shared guard actually admits operators ───────────────
  it("requirePortalViewer admits operator sessions read-only", () => {
    const src = read(PORTAL_AUTH);
    expect(src.includes("export async function requirePortalViewer")).toBe(true);
    // The operator branch returns isOperator:true rather than redirecting.
    expect(
      /role === "operator"[\s\S]{0,160}isOperator:\s*true/.test(src),
      "requirePortalViewer must return isOperator:true for operator sessions, not redirect them",
    ).toBe(true);
    // The real login route, not the firm-scoped 404 path.
    expect(src.includes('redirect("/portal/login")')).toBe(true);
  });
});
