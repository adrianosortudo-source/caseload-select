import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const current = readFileSync(resolve("supabase/migrations/20261005141204_prospect_candidate_original_status_fastpath.sql"), "utf8").replaceAll("\r\n", "\n");
const prior = readFileSync(resolve("supabase/migrations/20261004120000_prospect_candidate_firm_field_fastpath.sql"), "utf8").replaceAll("\r\n", "\n");
const start = current.indexOf(" -- Start with exact retained statuses");
const end = current.indexOf(" -- Exact firm and JSON-pointer/value filters", start);
const branch = current.slice(start, end);
const definition = (sql: string) => sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"), sql.indexOf("END $$;") + "END $$;".length);

describe("literal original-status candidate reader migration", () => {
  it("preserves the prior same-OID definition byte for byte outside the new branch", () => {
    expect(start).toBeGreaterThan(-1);
    expect(definition(current).replace(branch, "")).toBe(definition(prior));
    expect(current).not.toMatch(/ALTER FUNCTION|DROP FUNCTION|statement_timeout/i);
  });
  it("specializes only literal status-only filters and bounds the index without weakening equality", () => {
    expect(branch).toContain("(p_filters-'originalStatus')='{}'::jsonb");
    expect(branch).toContain("p_filters->>'originalStatus'<>'__unknown__'");
    expect(current).toContain("history(md5(original_status),coverage_revision,candidate_id)");
    expect(current).toContain("WHERE original_status IS NOT NULL");
    expect(branch).toContain("md5(h.original_status)=md5(p_filters->>'originalStatus')");
    expect(branch).toContain("h.original_status=p_filters->>'originalStatus'");
  });
  it("validates seeds and expanded members, retaining conflicts and unresolved matches as singletons", () => {
    expect(branch).toContain("identity_links_for(cutoff,seed.candidate_id)");
    expect(branch).toContain("identity_links_for_firms(");
    expect(branch).toContain("identity_links_for(cutoff,member.candidate_id)");
    expect(branch).toContain("firm_count=1 AND firm_id IN(SELECT firm_id FROM matched_firms)");
    expect(branch).toContain("FROM seed_identities WHERE firm_count<>1");
    expect(branch).not.toContain("identity_links_at(");
    expect(branch).not.toContain("matches_group(");
  });
  it("retains the cutoff, exact counts, UUID order, response budget and service-role boundary", () => {
    expect(branch).toContain("h.coverage_revision<=cutoff");
    expect(branch).toContain("c.created_revision<=cutoff");
    expect(branch).toContain("id>p_after_id ORDER BY id LIMIT p_limit");
    expect(branch).toContain("bytes<=1040000");
    for (const key of ["inventoryCount", "filteredCount", "coverageRevision", "readWarnings", "complete", "nextAfterId"]) expect(branch).toContain("'" + key + "'");
    expect(current).toContain("LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''");
    expect(current).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(current).toContain("GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint) TO service_role");
    expect(current.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(current.match(/^COMMIT;$/gm)).toHaveLength(1);
  });
});
