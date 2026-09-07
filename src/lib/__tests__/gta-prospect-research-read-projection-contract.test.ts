import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260907181342_gta_prospect_research_operator_read_projection.sql"),
  "utf8",
);

describe("GTA prospect research operator read projection contract", () => {
  it("is a narrow service-role-only SECURITY DEFINER read RPC", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.list_gta_prospect_research_for_operator()");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.list_gta_prospect_research_for_operator() FROM PUBLIC, anon, authenticated, service_role;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.list_gta_prospect_research_for_operator() TO service_role;");
    expect(migration).not.toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.gta_prospect_/i);
  });

  it("returns only typed public-research display fields from applied batches", () => {
    const returnContract = migration.slice(migration.indexOf("RETURNS TABLE"), migration.indexOf("LANGUAGE sql"));
    expect(migration).toContain("batch.state = 'applied'");
    expect(migration).toContain("ARRAY[]::text[] AS practice_areas");
    expect(migration).toContain("NULL::integer AS legacy_cluster_lawyer_count");
    expect(migration).toContain("NULL::text AS legacy_crosswalk");
    expect(migration).toContain("ORDER BY observation.observed_on DESC, observation.id DESC");
    expect(returnContract).not.toMatch(/contact|email|phone|outreach|crm|canonical_record|source_record_sha256/i);
  });

  it("keeps the route server-only, operator-gated, and explicit about fixture cutover", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/reconciled/route.ts"), "utf8");
    expect(route).toContain("getOperatorSession");
    expect(route).toContain("{ status: 401 }");
    expect(route).toContain("listGtaProspectResearchForOperator");
    expect(route).toContain("fixture_seed_incomplete");
    expect(route).toContain("ledger_unavailable");
    expect(route).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|createClient|\.from\(/);
  });
});
