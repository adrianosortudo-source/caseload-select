import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const previous = readFileSync("supabase/migrations/20261006170000_prospect_candidate_global_text_search_direct_scope.sql", "utf8").replaceAll("\r\n", "\n");
const repair = readFileSync("supabase/migrations/20261006234701_prospect_candidate_global_text_search_bounded_membership.sql", "utf8");
describe("bounded candidate membership forward repair", () => {
  it("changes only chunk membership and preserves all deployed reader semantics and ACLs", () => {
    const body = previous.slice(previous.indexOf("CREATE OR REPLACE FUNCTION"));
    const expected = body.replace(`WHERE EXISTS (
      SELECT 1 FROM public.prospect_research_candidate_search_chunks f
      WHERE f.candidate_id=scope.candidate_id AND f.coverage_revision<=cutoff
        AND f.search_document @@ terms.query
    )`, `CROSS JOIN LATERAL (
      SELECT 1 FROM public.prospect_research_candidate_search_chunks f
      WHERE f.candidate_id=scope.candidate_id AND f.coverage_revision<=cutoff
        -- Keep this as a truth test: the term must filter the candidate range,
        -- not build a global GIN bitmap for every candidate/term lookup.
        AND (f.search_document @@ terms.query) IS TRUE
      LIMIT 1
    ) hit`);
    expect(repair.slice(repair.indexOf("CREATE OR REPLACE FUNCTION"))).toBe(expected);
    expect(repair).toMatch(/^BEGIN;$/m); expect(repair).toMatch(/^COMMIT;$/m);
    expect(repair).not.toMatch(/CREATE INDEX|ALTER ROLE|statement_timeout|INSERT INTO/);
  });
});
