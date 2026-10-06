import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261006111650_prospect_candidate_global_text_search_scoped.sql"), "utf8");
const setIdentitySql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261006133000_prospect_candidate_global_text_search_set_identity.sql"), "utf8");

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
