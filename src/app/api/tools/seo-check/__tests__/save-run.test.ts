/**
 * Tests for buildSeoCheckRunRow, the shared row-builder behind both the
 * manual "Save this scan" button (POST /api/admin/seo-check/runs) and the
 * server-side auto-save on every operator scan (POST /api/tools/seo-check).
 * One builder, so the two save paths cannot drift in shape.
 */

import { describe, it, expect, vi } from "vitest";

// supabase-admin.ts carries `import "server-only"` (throws outside a Next.js
// server render) and eagerly builds a real client requiring live env vars at
// module load. buildSeoCheckRunRow itself never touches Supabase (it is
// pure), but save-run.ts also exports saveSeoCheckRunBestEffort from the same
// module, which does, so both need stubbing just to load the file.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));

import { buildSeoCheckRunRow } from "../save-run";

const FULL_RESULT = {
  domain: "Example.CA",
  scanMode: "standard",
  pagesScanned: 25,
  overallScore: 80,
  grade: "A-",
  aiSearchScore: 53,
  aiPolicyScore: 50,
  renderingSummary: { risk: "medium" },
  issues: [{ title: "a" }, { title: "b" }],
};

describe("buildSeoCheckRunRow", () => {
  it("builds a full row from a well-formed result", () => {
    const row = buildSeoCheckRunRow(FULL_RESULT, "lawyer-123");
    expect(row).toEqual({
      domain: "example.ca",
      scan_mode: "standard",
      pages_scanned: 25,
      overall_score: 80,
      ai_search_score: 53,
      ai_policy_score: 50,
      grade: "A-",
      rendering_risk: "medium",
      issue_count: 2,
      result: FULL_RESULT,
      created_by_lawyer_id: "lawyer-123",
    });
  });

  it("lowercases the domain for consistent lookups", () => {
    expect(buildSeoCheckRunRow({ domain: "MixedCase.CA" }, null)?.domain).toBe("mixedcase.ca");
  });

  it("returns null when the result has no domain (nothing meaningful to save)", () => {
    expect(buildSeoCheckRunRow({}, null)).toBeNull();
    expect(buildSeoCheckRunRow({ domain: "" }, null)).toBeNull();
    expect(buildSeoCheckRunRow({ domain: 123 }, null)).toBeNull();
  });

  it("defaults scan_mode to quick for an unrecognized or missing value", () => {
    expect(buildSeoCheckRunRow({ domain: "x.ca" }, null)?.scan_mode).toBe("quick");
    expect(buildSeoCheckRunRow({ domain: "x.ca", scanMode: "bogus" }, null)?.scan_mode).toBe("quick");
  });

  it("defaults issue_count to 0 and pages_scanned to 0 when absent", () => {
    const row = buildSeoCheckRunRow({ domain: "x.ca" }, null);
    expect(row?.issue_count).toBe(0);
    expect(row?.pages_scanned).toBe(0);
  });

  it("clamps overall_score/ai_search_score/ai_policy_score to [0,100] and drops non-numbers", () => {
    const row = buildSeoCheckRunRow({ domain: "x.ca", overallScore: 150, aiSearchScore: -20, aiPolicyScore: "not a number" }, null);
    expect(row?.overall_score).toBe(100);
    expect(row?.ai_search_score).toBe(0);
    expect(row?.ai_policy_score).toBeNull();
  });

  it("passes through a null lawyer id (operator session with no linked firm_lawyers row)", () => {
    expect(buildSeoCheckRunRow({ domain: "x.ca" }, null)?.created_by_lawyer_id).toBeNull();
  });

  it("rejects an unrecognized rendering risk rather than storing garbage", () => {
    const row = buildSeoCheckRunRow({ domain: "x.ca", renderingSummary: { risk: "extreme" } }, null);
    expect(row?.rendering_risk).toBeNull();
  });
});
