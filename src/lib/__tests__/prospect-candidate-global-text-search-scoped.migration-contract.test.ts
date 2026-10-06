import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261006111650_prospect_candidate_global_text_search_scoped.sql"), "utf8");
const setIdentitySql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261006133000_prospect_candidate_global_text_search_set_identity.sql"), "utf8");
const indexOnlySql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261006160000_prospect_candidate_global_text_search_index_only.sql"), "utf8");
const directScopeSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261006170000_prospect_candidate_global_text_search_direct_scope.sql"), "utf8");

describe("global candidate text search scoping migration", () => {
  it("discovers identity groups from one selective anchor and searches other terms only inside that scope", () => {
    const start = sql.indexOf("CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates_for_text");
    const end = sql.indexOf("REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates_for_text", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = sql.slice(start, end);
    expect(fn).toContain("anchor_term AS MATERIALIZED");
    expect(fn).toContain("ORDER BY char_length(term) DESC,term LIMIT 1");
    expect(fn).toContain("FROM anchor_term anchor JOIN public.prospect_research_candidate_search_chunks");
    expect(fn).toContain("FROM anchor_term anchor JOIN public.prospect_research_candidate_projection_issues");
    expect(fn).toContain("FROM anchor_term anchor JOIN public.prospect_research_candidate_history");
    expect(fn).toContain("candidate_scope AS MATERIALIZED");
    expect(fn).toContain("WHERE f.candidate_id=scope.candidate_id");
    expect(fn).toContain("WHERE h.candidate_id=scope.candidate_id");
    expect(fn).toContain("HAVING count(DISTINCT term)=(SELECT count(*) FROM text_terms)");
    expect(fn).not.toContain("), text_hits AS MATERIALIZED");
    expect(fn).not.toContain("), term_counts AS MATERIALIZED");
    expect(fn).toContain("SECURITY DEFINER SET search_path = ''");
  });


  it("keeps the deployed text path within the indexed read budget and surfaces deferred coverage explicitly", () => {
    expect(indexOnlySql).toContain("coverage_warnings_text_search_v1");
    expect(indexOnlySql).toContain("enrichment_coverage_audit_deferred_for_text_search");
    expect(indexOnlySql).toContain("raw_projection_text_search_deferred_for_text_search");
    expect(indexOnlySql).toContain("prospect_research_candidate_search_chunks");
    expect(indexOnlySql).toContain("prospect_research_candidate_history h");
    expect(indexOnlySql).not.toContain("prospect_candidate_projection_issues i ON true");
    expect(indexOnlySql).not.toContain("strpos(lower(h.original_json::text)");
  });
  it("keeps text-only searches in direct indexed candidate scope", () => {
    expect(directScopeSql).toContain("CREATE INDEX IF NOT EXISTS prospect_candidate_identity_search");
    expect(directScopeSql).toContain("anchor_candidates AS MATERIALIZED");
    expect(directScopeSql).toContain("FROM anchor_candidates\n    UNION ALL\n    SELECT candidate_id,'candidate:'||candidate_id::text");
    expect(directScopeSql).toContain("candidate:'||scope.candidate_id::text");
    expect(directScopeSql).toContain("FROM candidate_scope scope\n    WHERE NOT EXISTS (SELECT 1 FROM text_terms)");
    expect(directScopeSql).toContain("search_document @@ terms.query");
    expect(directScopeSql).toContain("identity_links_for_candidates");
    expect(directScopeSql).toContain("LIMIT 128");
    expect(directScopeSql).not.toContain("max(id)");
    expect(directScopeSql).toContain("ORDER BY id DESC LIMIT 1");
    expect(directScopeSql).not.toContain("prospect_candidate_projection_issues");
  });

  it("retains transaction boundaries and service-role-only execution", () => {
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toContain("FROM PUBLIC,anon,authenticated,service_role");
    expect(sql).toContain("TO service_role;");
  });

  it("uses one bounded identity resolution pass for anchor and expanded members", () => {
    const start = setIdentitySql.indexOf("CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates_for_text");
    const end = setIdentitySql.indexOf("REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates_for_text", start);
    const fn = setIdentitySql.slice(start, end);
    expect(setIdentitySql).toContain("CREATE OR REPLACE FUNCTION prospect_candidate_private.identity_links_for_candidates(");
    expect(fn).toContain("anchor_identity_links AS MATERIALIZED");
    expect(fn).toContain("expanded_seed AS MATERIALIZED");
    expect(fn).toContain("FROM prospect_candidate_private.identity_links_for_candidates(");
    expect(fn).toContain("GROUP BY candidate_id");
    expect(fn).not.toContain("LEFT JOIN LATERAL prospect_candidate_private.identity_links_for(cutoff,anchors.candidate_id)");
    expect(fn).not.toContain("LEFT JOIN LATERAL prospect_candidate_private.identity_links_for(cutoff,candidates.candidate_id)");
  });

  it("keeps the follow-up migration protected and transactional", () => {
    expect(setIdentitySql).toMatch(/^BEGIN;$/m);
    expect(setIdentitySql).toMatch(/^COMMIT;$/m);
    expect(setIdentitySql).toContain("FROM PUBLIC,anon,authenticated,service_role");
    expect(setIdentitySql).toContain("TO service_role;");
  });
});
