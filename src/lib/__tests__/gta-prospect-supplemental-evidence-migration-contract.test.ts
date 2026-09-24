import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DOWNTOWN_PLAN_41_BOUNDARY_ID } from "../gta-prospect-evidence-import";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260912131132_gta_prospect_supplemental_evidence_import.sql"), "utf8");
const projectionFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924093317_fix_gta_prospect_operator_projection_gaps.sql"), "utf8");

describe("GTA supplemental prospect evidence migration", () => {
  it("keeps evidence private, append-only, and outside the core prospect import batch", () => {
    expect(migration).toContain("gta_prospect_supplemental_evidence_import_batches");
    expect(migration).toContain("gta_prospect_shared_identity_observations");
    expect(migration).toContain("gta_prospect_website_intake_observations");
    expect(migration).toContain("gta_prospect_qualification_assessments");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("reject_gta_prospect_research_history_mutation");
    expect(migration).toContain("REVOKE ALL ON TABLE");
  });

  it("allows only service-role RPCs and filters staged evidence from the read projection", () => {
    expect(migration).toContain("begin_gta_prospect_supplemental_evidence_import");
    expect(migration).toContain("apply_gta_prospect_supplemental_evidence_record");
    expect(migration).toContain("list_gta_prospect_supplemental_evidence_for_operator");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator() TO service_role");
    expect(migration).toContain("batch.state = 'applied'");
    expect(migration).not.toContain("GRANT EXECUTE ON FUNCTION public.apply_gta_prospect_supplemental_evidence_record(uuid, jsonb, text) TO anon");
  });

  it("uses the same canonical Plan 41 boundary ID as the geography table", () => {
    const geographyMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260908140907_gta_prospect_downtown_geography_observations.sql"), "utf8");
    expect(geographyMigration).toContain(`boundary_id = '${DOWNTOWN_PLAN_41_BOUNDARY_ID}'`);
    expect(DOWNTOWN_PLAN_41_BOUNDARY_ID).toBe("toronto-official-plan-secondary-plan-41");
  });

  it("adds a versioned service-only read RPC with registry fallback and unresolved-observation precedence", () => {
    expect(projectionFix).toContain("list_gta_prospect_supplemental_evidence_for_operator_v2");
    expect(projectionFix).toContain("LEFT JOIN public.gta_prospect_stable_identity_registry AS registry");
    expect(projectionFix).toContain("AND identity_observation.id IS NULL");
    expect(projectionFix).toContain("WHEN identity_observation.id IS NOT NULL THEN 'supplemental_observation'");
    expect(projectionFix).toContain("WHEN registry.id IS NOT NULL THEN 'stable_identity_registry'");
    expect(projectionFix).toContain("REVOKE ALL ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v2() FROM PUBLIC, anon, authenticated, service_role");
    expect(projectionFix).toContain("GRANT EXECUTE ON FUNCTION public.list_gta_prospect_supplemental_evidence_for_operator_v2() TO service_role");
  });
});
