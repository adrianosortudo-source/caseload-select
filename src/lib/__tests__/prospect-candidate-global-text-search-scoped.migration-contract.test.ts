import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261006111650_prospect_candidate_global_text_search_scoped.sql"), "utf8");

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
});
