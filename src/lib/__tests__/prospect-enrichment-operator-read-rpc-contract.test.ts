import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260923182000_prospect_enrichment_operator_read_rpc.sql"), "utf8");

describe("fixed-path prospect enrichment read RPC", () => {
  it("is service-role-only, fixed-path, bounded, and takes no caller-supplied projection", () => {
    expect(migration).toMatch(/RETURNS SETOF jsonb[\s\S]*?SECURITY DEFINER\s+SET search_path = ''/i);
    expect(migration).toContain("p_limit > 501");
    expect(migration).toContain("coalesce(cardinality(p_ids), 0) > 501");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.read_prospect_enrichment_gta_evidence_v1(uuid,text,uuid,uuid[],uuid,integer) FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.read_prospect_enrichment_gta_evidence_v1(uuid,text,uuid,uuid[],uuid,integer) TO service_role");
    expect(migration).not.toMatch(/p_columns|p_projection|GRANT\s+[^;]*ON\s+TABLE\s+[^;]*gta_prospect_[^;]*TO\s+service_role/i);
  });

  it("allowlists explicit projections and scopes batch state through same-firm audit rows", () => {
    for (const table of [
      "gta_prospect_firms", "gta_prospect_stable_identity_registry", "gta_prospect_aliases", "gta_prospect_domains",
      "gta_prospect_offices", "gta_prospect_roster_observations", "gta_prospect_public_contact_observations",
      "gta_prospect_evidence_links", "gta_prospect_import_audit", "gta_prospect_import_batches",
      "gta_prospect_shared_identity_observations", "gta_prospect_downtown_geography_observations",
      "gta_prospect_website_intake_observations", "gta_prospect_qualification_assessments",
      "gta_prospect_supplemental_evidence_import_audit", "gta_prospect_supplemental_evidence_import_batches",
    ]) expect(migration).toContain(`WHEN '${table}'`);
    expect(migration).toContain("audit.firm_id = $1");
    expect(migration).toContain("audit.evidence_import_batch_id = t.id AND audit.firm_id = $1");
    expect(migration).toContain("audit.import_batch_id = t.id AND audit.firm_id = $1");
    expect(migration).toContain("ELSE\n      RAISE EXCEPTION 'protected prospect evidence table is not allowlisted'");
  });
});
