import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261016042722_prospect_candidate_identity_filter_fastpath.sql"), "utf8");
const start = sql.indexOf("CREATE FUNCTION prospect_candidate_private.list_candidates_for_identity(");
const wrapper = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.list_prospect_research_candidates_v1("));
const fastPath = sql.slice(start, sql.indexOf("REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates_for_identity", start));

describe("exact candidate identity fast path migration contract", () => {
  it("dispatches only identity-only filters and preserves the prior reader for all other shapes", () => {
    expect(start).toBeGreaterThan(-1);
    expect(wrapper).toContain("p_filters ? 'identityNamespace' AND p_filters ? 'identityKey'");
    expect(wrapper).toContain("(p_filters-ARRAY['identityNamespace','identityKey']::text[])='{}'::jsonb");
    expect(wrapper).toContain("prospect_candidate_private.list_candidates_for_identity(p_filters,p_limit,p_after_id,p_coverage_revision)");
    expect(wrapper).toContain("THEN prospect_candidate_private.list_candidates_for_firm(p_filters,p_limit,p_after_id,p_coverage_revision)");
    expect(wrapper).toContain("THEN prospect_candidate_private.list_candidates_for_indexed_field(p_filters,p_limit,p_after_id,p_coverage_revision)");
    expect(wrapper).toContain("THEN prospect_candidate_private.list_candidates_for_text(p_filters,p_limit,p_after_id,p_coverage_revision)");
    expect(wrapper).toContain("ELSE prospect_candidate_private.list_candidates(p_filters,p_limit,p_after_id,p_coverage_revision)");
  });

  it("uses the existing unique digest index and exact text equality without global identity materialization", () => {
    expect(fastPath).toContain("identity_namespace_sha256=namespace_hash");
    expect(fastPath).toContain("identity_key_sha256=key_hash");
    expect(fastPath).toContain("identity_namespace=p_filters->>'identityNamespace'");
    expect(fastPath).toContain("identity_key=p_filters->>'identityKey'");
    expect(fastPath).toContain("created_revision<=cutoff");
    expect(fastPath).not.toContain("identity_links_at(");
    expect(fastPath).not.toContain("group_candidates(");
  });

  it("retains snapshot pagination, byte bounds, warnings, and service-role-only execution", () => {
    for (const field of ["items", "nextAfterId", "inventoryCount", "filteredCount", "coverageRevision", "readWarnings", "complete"])
      expect(fastPath).toContain("'" + field + "'");
    expect(fastPath).toContain("p_after_id IS NULL OR id>p_after_id");
    expect(fastPath).toContain("bytes<=1040000");
    expect(sql).toContain("REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates_for_identity(jsonb,integer,uuid,bigint)");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates_for_identity(jsonb,integer,uuid,bigint)");
    expect(sql).toContain("TO service_role");
    expect(sql).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i);
    expect(sql).not.toMatch(/statement_timeout/i);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
  });
});
