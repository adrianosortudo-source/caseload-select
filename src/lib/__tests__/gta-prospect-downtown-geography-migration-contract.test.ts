import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260908140907_gta_prospect_downtown_geography_observations.sql"),
  "utf8",
);
const coreImport = readFileSync(resolve(process.cwd(), "src/lib/gta-prospect-research-import.ts"), "utf8");

describe("GTA Downtown geography migration contract", () => {
  it("keeps boundary evidence private, append-only, and service-role-only", () => {
    expect(migration).toContain("CREATE TABLE public.gta_prospect_downtown_geography_observations");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("gta_prospect_downtown_geography_observations_no_mutation");
    expect(migration).toContain("REVOKE ALL ON TABLE public.gta_prospect_downtown_geography_observations FROM PUBLIC, anon, authenticated, service_role;");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.list_gta_prospect_downtown_geography_for_operator()");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.list_gta_prospect_downtown_geography_for_operator() TO service_role;");
    expect(migration).toContain("ORDER BY candidate.observed_on DESC, candidate.created_at DESC");
    expect(migration).not.toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.gta_prospect_downtown_geography_observations/i);
  });

  it("requires the authoritative boundary and leaves core research import geography-free", () => {
    expect(migration).toContain("toronto-official-plan-secondary-plan-41");
    expect(migration).toContain("boundary_geometry_sha256");
    expect(migration).toContain("geography_status = 'needs_manual_review'");
    expect(coreImport).not.toMatch(/normalizedAddress|boundaryGeometrySha256|coordinateSource|geographyStatus/i);
  });
});
