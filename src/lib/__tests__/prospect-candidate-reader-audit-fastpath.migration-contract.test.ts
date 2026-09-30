import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260930130000_prospect_candidate_reader_defer_legacy_audit.sql"), "utf8");

describe("candidate-reader legacy audit fast path", () => {
  it("preserves the full audit under a separate name and marks reader coverage incomplete", () => {
    expect(sql).toContain("ALTER FUNCTION prospect_candidate_private.coverage_warnings(bigint)");
    expect(sql).toContain("RENAME TO coverage_warnings_full_audit");
    expect(sql).toContain("coverage_warnings_enrichment_v1(p_cutoff)");
    expect(sql).toContain("legacy_source_audit_deferred");
    expect(sql).toContain("REVOKE ALL ON FUNCTION prospect_candidate_private.coverage_warnings(bigint)");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).not.toContain("legacy_inventory()");
    expect(sql).not.toContain("legacy_research_row(");
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });
});
