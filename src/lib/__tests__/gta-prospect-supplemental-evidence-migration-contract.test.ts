import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260912131132_gta_prospect_supplemental_evidence_import.sql"), "utf8");

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
});
