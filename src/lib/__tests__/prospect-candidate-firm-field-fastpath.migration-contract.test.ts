import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261004120000_prospect_candidate_firm_field_fastpath.sql"), "utf8");
const start = sql.indexOf("CREATE FUNCTION prospect_candidate_private.list_candidates(");
const startReplace = sql.indexOf("CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates(");
const functionStart = startReplace < 0 ? start : startReplace;
const end = sql.indexOf("END $$;", functionStart);
const reader = sql.slice(functionStart, end + 7);
const fastPathStart = reader.indexOf("IF p_filters ? 'firmId'");
const fastPathEnd = reader.indexOf("-- Search first", fastPathStart);
const fastPath = reader.slice(fastPathStart, fastPathEnd);

describe("candidate firm and exact-field fast path migration contract", () => {
  it("routes only the exact three-filter shape and retains the previous reader as fallback", () => {
    expect(functionStart).toBeGreaterThan(-1);
    expect(sql).not.toContain("ALTER FUNCTION prospect_candidate_private.list_candidates");
    expect(fastPath).toContain("p_filters ? 'firmId' AND p_filters ? 'fieldPointer' AND p_filters ? 'fieldValue'");
    expect(fastPath).toContain("p_filters-ARRAY['firmId','fieldPointer','fieldValue']::text[]");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates(");
  });

  it("uses existing selective indexes then validates the complete identity history of each firm seed", () => {
    expect(fastPath).toContain("h.verified_firm_id=requested_firm");
    expect(fastPath).toContain("h.coverage_revision<=cutoff");
    expect(fastPath).toContain("identity_links_for(cutoff,seed.candidate_id)");
    expect(fastPath).toContain("count(DISTINCT links.verified_firm_id)");
    expect(fastPath).toContain("link_state.firm_count=1 AND link_state.firm_id=requested_firm");
    expect(fastPath).toContain("md5(field.pointer)=md5(p_filters->>'fieldPointer')");
    expect(fastPath).toContain("field.pointer=p_filters->>'fieldPointer'");
    expect(fastPath).toContain("md5(field.value_json::text)=md5((p_filters->'fieldValue')::text)");
    expect(fastPath).toContain("field.value_json=p_filters->'fieldValue'");
    expect(fastPath).not.toContain("identity_links_at(");
  });

  it("preserves page, cutoff, response bound and service-role-only execution without adding indexes or timeouts", () => {
    for (const field of ["inventoryCount", "filteredCount", "coverageRevision", "readWarnings", "nextAfterId"]) expect(reader).toContain("'" + field + "'");
    expect(reader).toContain("bytes<=1040000");
    expect(sql).toContain("REVOKE ALL ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint)");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint) TO service_role");
    expect(sql).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i);
    expect(sql).not.toMatch(/statement_timeout/i);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
  });
});
