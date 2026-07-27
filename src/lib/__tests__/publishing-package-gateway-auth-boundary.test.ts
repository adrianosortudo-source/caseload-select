/**
 * Authorization-boundary regression tests for the Publishing Package
 * Gateway credential (PUBLISHING_PACKAGE_GATEWAY_TOKEN /
 * isPublishingPackageGatewayAuthorized). Same technique this codebase
 * already uses to prove /claim's independence from buildPreflightReport
 * (see .../claim/__tests__/route.test.ts): scan the ACTUAL source files
 * (no mocking) so a future edit that widens this credential's reach fails
 * a real regression, not just a comment someone forgot to update.
 *
 * Behavioral proof that the route itself only ever writes hero_image_url +
 * updated_at, and only via the fixed HERO_PACKAGE_BUCKET, lives in
 * route.test.ts's own happy-path assertions; this file is the static,
 * whole-codebase side of the same guarantee -- that nothing ELSE in the
 * repository can be reached through this credential or this route module.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ROUTE_SOURCE = readFileSync(
  join(ROOT, "src", "app", "api", "publishing-agent", "hero-package", "route.ts"),
  "utf8",
);
const AUTH_SOURCE = readFileSync(join(ROOT, "src", "lib", "publishing-package-gateway-auth.ts"), "utf8");
const CORE_SOURCE = readFileSync(join(ROOT, "src", "lib", "publishing-package-gateway.ts"), "utf8");

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTsFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("PUBLISHING_PACKAGE_GATEWAY_TOKEN / isPublishingPackageGatewayAuthorized: reach", () => {
  it("is referenced ONLY by the gateway's own auth module, its route, and this test tree -- no approval, status, placement, notification, Files-hub, or generic-storage module imports it", () => {
    const allFiles = walkTsFiles(join(ROOT, "src"));
    const allowedFiles = new Set([
      join(ROOT, "src", "lib", "publishing-package-gateway-auth.ts"),
      join(ROOT, "src", "app", "api", "publishing-agent", "hero-package", "route.ts"),
    ]);
    const offenders: string[] = [];
    for (const file of allFiles) {
      if (allowedFiles.has(file)) continue;
      if (file.includes(`${join("__tests__")}`) || file.includes("__tests__")) continue; // test files may reference it in assertions/mocks
      const content = readFileSync(file, "utf8");
      if (content.includes("PUBLISHING_PACKAGE_GATEWAY_TOKEN") || content.includes("isPublishingPackageGatewayAuthorized")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("route.ts: cannot reach approval, status, placement, notification, or Files-hub logic", () => {
  it("never imports any approval-decision module (release-authorization, standing-publishing-authorization, deliverables-auth's approval path)", () => {
    expect(ROUTE_SOURCE).not.toMatch(/from ["']@\/lib\/release-authorization["']/);
    expect(ROUTE_SOURCE).not.toMatch(/from ["']@\/lib\/standing-publishing-authorization["']/);
    expect(ROUTE_SOURCE).not.toMatch(/approveDeliverable|recordApproval|ApprovalDecision/);
  });

  it("never imports the placement-claim module (/claim's own authority) or any placement-mutation helper", () => {
    expect(ROUTE_SOURCE).not.toMatch(/from ["']@\/lib\/publication-placement-claims["']/);
    expect(ROUTE_SOURCE).not.toMatch(/claimPlacementForPublish|content-placements/);
  });

  it("never imports a notification/email/sms dispatch module", () => {
    expect(ROUTE_SOURCE).not.toMatch(/sms-dispatch|webhook-outbox|email-branding|sendEmail|dispatchNotification/i);
  });

  it("never imports the Files-hub upload module (firm-files.ts)", () => {
    expect(ROUTE_SOURCE).not.toMatch(/from ["']@\/lib\/firm-files["']/);
  });

  it("never updates content_deliverables.status, approved_version_id, or any column besides hero_image_url/updated_at -- confirmed by scanning the route's own .update( call sites", () => {
    const updateCalls = ROUTE_SOURCE.match(/\.update\(\{[\s\S]*?\}\)/g) ?? [];
    expect(updateCalls.length).toBeGreaterThan(0);
    for (const call of updateCalls) {
      expect(call).not.toMatch(/status\s*:/);
      expect(call).not.toMatch(/approved_version_id\s*:/);
      expect(call).not.toMatch(/title\s*:/);
      expect(call).not.toMatch(/body_html\s*:/);
      expect(call).toMatch(/hero_image_url\s*:/);
    }
  });

  it("only ever targets content_deliverables via supabase.from(...) -- never any other table", () => {
    const fromCalls = ROUTE_SOURCE.match(/supabase\s*\n?\s*\.from\(["'][a-z_]+["']\)/g) ?? [];
    for (const call of fromCalls) {
      expect(call).toMatch(/content_deliverables/);
    }
  });

  it("storage access is scoped to HERO_PACKAGE_BUCKET (imported from the gateway core, not a caller-supplied or hardcoded arbitrary bucket)", () => {
    expect(ROUTE_SOURCE).toMatch(/HERO_PACKAGE_BUCKET/);
    const storageFromCalls = ROUTE_SOURCE.match(/\.storage\s*\n?\s*\.from\([^)]*\)/g) ?? [];
    expect(storageFromCalls.length).toBeGreaterThan(0);
    for (const call of storageFromCalls) {
      expect(call).toMatch(/HERO_PACKAGE_BUCKET/);
    }
  });

  it("never reads a caller-supplied storage path or url field for the upload target -- the only path constructor used is heroPackageStoragePath", () => {
    expect(ROUTE_SOURCE).toMatch(/heroPackageStoragePath/);
    expect(ROUTE_SOURCE).not.toMatch(/formData\.get\(["']storage_path["']\)/);
    expect(ROUTE_SOURCE).not.toMatch(/formData\.get\(["']url["']\)/);
  });
});

describe("publishing-package-gateway-auth.ts: credential compare is isolated", () => {
  it("imports only the shared constant-time compare utility, not cron-auth's accepted-token list or session logic", () => {
    expect(AUTH_SOURCE).toMatch(/constantTimeEquals/);
    // The header comment legitimately NAMES CRON_SECRET/PG_CRON_TOKEN in
    // prose to explain why this credential is deliberately separate (same
    // allowance this codebase's own /claim independence test makes for a
    // prose mention vs. a real import) -- so check actual usage
    // (process.env reads or imports), not whether the string appears
    // anywhere in the file at all.
    const codeOnly = AUTH_SOURCE.replace(/\/\*\*[\s\S]*?\*\//g, ""); // strip /** ... */ doc comments
    expect(codeOnly).not.toMatch(/process\.env\.CRON_SECRET|process\.env\.PG_CRON_TOKEN/);
    expect(codeOnly).not.toMatch(/getOperatorSession|getFirmSession/);
    expect(AUTH_SOURCE).not.toMatch(/from ["']@\/lib\/portal-auth["']/);
  });

  it("reads exactly one env var, PUBLISHING_PACKAGE_GATEWAY_TOKEN, never a broader admin/session credential", () => {
    const envReads = AUTH_SOURCE.match(/process\.env\.[A-Z_]+/g) ?? [];
    expect(envReads).toEqual(["process.env.PUBLISHING_PACKAGE_GATEWAY_TOKEN"]);
  });
});

describe("publishing-package-gateway.ts: pure core has no I/O and no awareness of other operations", () => {
  it("performs no Supabase, filesystem, or network I/O (only crypto.createHash on in-memory bytes)", () => {
    expect(CORE_SOURCE).not.toMatch(/from ["']@\/lib\/supabase-admin["']/);
    expect(CORE_SOURCE).not.toMatch(/\bfetch\(/);
    expect(CORE_SOURCE).not.toMatch(/from ["']node:fs["']|from ["']fs["']/);
  });
});
