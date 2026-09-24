import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260923161812_prospect_enrichment_v1.sql"),
  "utf8",
);
const identityReadMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260923174500_prospect_enrichment_identity_read_rpc.sql"),
  "utf8",
);
const holdEvidenceMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924071322_prospect_enrichment_manifest_hold_evidence.sql"),
  "utf8",
);

function functionDefinition(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `missing function ${name}`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("$$;", start);
  expect(end, `missing end of function ${name}`).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}

describe("prospect enrichment protected-table RPC boundary", () => {
  it.each([
    "stage_prospect_enrichment_package_v1",
    "list_prospect_enrichment_run_summaries_v1",
    "list_prospect_enrichment_run_manifest_items_v1",
    "prospect_enrichment_validate_review_v1",
    "prospect_enrichment_existing_target_sha256_v1",
    "prospect_enrichment_lock_existing_target_v1",
    "review_prospect_enrichment_package_v1",
    "apply_prospect_enrichment_package_v1",
    "record_prospect_enrichment_verification_v1",
  ])("uses a fixed-path SECURITY DEFINER function for %s", (name) => {
    const definition = functionDefinition(name);
    expect(definition).toMatch(/SECURITY DEFINER\s+SET search_path = ''/i);
  });

  it("keeps the canonical firm and identity tables closed to direct service-role access", () => {
    expect(migration).not.toMatch(
      /GRANT\s+[^;]*ON\s+TABLE\s+[^;]*public\.gta_prospect_firms[^;]*TO\s+service_role/i,
    );
    expect(migration).not.toMatch(
      /GRANT\s+[^;]*ON\s+TABLE\s+[^;]*public\.gta_prospect_stable_identity_registry[^;]*TO\s+service_role/i,
    );
  });

  it("exposes only the exact operator membership RPC to service-role callers", () => {
    const definition = functionDefinition("revalidate_operator_membership_v1");
    expect(definition).toMatch(/SECURITY DEFINER\s+SET search_path = ''/i);
    expect(definition).toContain("id = p_lawyer_id");
    expect(definition).toContain("firm_id = p_firm_id");
    expect(definition).toContain("role = 'operator'");
    expect(definition).toContain("disabled = false");
    expect(definition).toContain("SET last_signed_in_at = now()");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.revalidate_operator_membership_v1(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.revalidate_operator_membership_v1(uuid,uuid,boolean) TO service_role",
    );
  });

  it("exposes only the bounded firm identity projection to service-role callers", () => {
    expect(identityReadMigration).toMatch(/RETURNS TABLE\s*\(firm_id uuid, source_record_key text, stable_firm_id text, canonical_domain text, enrichment_revision bigint\)/i);
    expect(identityReadMigration).toMatch(/SECURITY DEFINER\s+SET search_path = ''/i);
    expect(identityReadMigration).toContain("coalesce(cardinality(p_firm_ids), 0) > 1000");
    expect(identityReadMigration).toContain("public.gta_prospect_firms");
    expect(identityReadMigration).toContain("public.gta_prospect_stable_identity_registry");
    expect(identityReadMigration).toContain("firm.enrichment_revision");
    expect(identityReadMigration).toContain("REVOKE ALL ON FUNCTION public.read_prospect_enrichment_firm_identities_v1(uuid[],text[],text[]) FROM PUBLIC, anon, authenticated, service_role");
    expect(identityReadMigration).toContain("GRANT EXECUTE ON FUNCTION public.read_prospect_enrichment_firm_identities_v1(uuid[],text[],text[]) TO service_role");
    expect(identityReadMigration).not.toMatch(/GRANT\s+[^;]*ON\s+TABLE\s+[^;]*gta_prospect_(?:firms|stable_identity_registry)[^;]*TO\s+service_role/i);
  });

  it("exposes only bounded core identity conflict keys to service-role callers", () => {
    expect(identityReadMigration).toMatch(/RETURNS TABLE\s*\(match_kind text, match_value text, firm_id uuid\)/i);
    expect(identityReadMigration).toMatch(/SECURITY DEFINER\s+SET search_path = ''/i);
    expect(identityReadMigration).toContain("coalesce(cardinality(p_source_record_keys), 0) > 1000");
    expect(identityReadMigration).toContain("coalesce(cardinality(p_domains), 0) > 100");
    expect(identityReadMigration).toContain("public.gta_prospect_firms");
    expect(identityReadMigration).toContain("public.gta_prospect_stable_identity_registry");
    expect(identityReadMigration).toContain("public.gta_prospect_domains");
    expect(identityReadMigration).toContain("REVOKE ALL ON FUNCTION public.lookup_prospect_enrichment_core_identity_conflicts_v1(text,text[],text[]) FROM PUBLIC, anon, authenticated, service_role");
    expect(identityReadMigration).toContain("GRANT EXECUTE ON FUNCTION public.lookup_prospect_enrichment_core_identity_conflicts_v1(text,text[],text[]) TO service_role");
    expect(identityReadMigration).toContain("NOTIFY pgrst, 'reload schema'");
    expect(identityReadMigration).not.toMatch(/GRANT\s+[^;]*ON\s+TABLE\s+[^;]*gta_prospect_(?:firms|stable_identity_registry|domains)[^;]*TO\s+service_role/i);
  });

  it("keeps held-candidate evidence append-only and requires it before finalization", () => {
    expect(holdEvidenceMigration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(holdEvidenceMigration).toContain("FORCE ROW LEVEL SECURITY");
    expect(holdEvidenceMigration).toContain("REVOKE ALL ON TABLE public.prospect_enrichment_manifest_hold_evidence FROM PUBLIC, anon, authenticated, service_role");
    expect(holdEvidenceMigration).toContain("GRANT SELECT, INSERT ON TABLE public.prospect_enrichment_manifest_hold_evidence TO service_role");
    expect(holdEvidenceMigration).toContain("BEFORE UPDATE OR DELETE ON public.prospect_enrichment_manifest_hold_evidence");
    expect(holdEvidenceMigration).toContain("prospect_enrichment_manifest_hold_evidence_append_only");
    expect(holdEvidenceMigration).toContain("manifest cannot finalize before every package-less candidate has durable held evidence");
    expect(holdEvidenceMigration).toContain("REVOKE ALL ON FUNCTION public.record_prospect_enrichment_manifest_hold_evidence_v1(text,text,text,jsonb) FROM PUBLIC, anon, authenticated");
    expect(holdEvidenceMigration).toContain("GRANT EXECUTE ON FUNCTION public.record_prospect_enrichment_manifest_hold_evidence_v1(text,text,text,jsonb) TO service_role");
    expect(holdEvidenceMigration).toContain("REVOKE ALL ON FUNCTION public.summarize_prospect_enrichment_manifest_hold_evidence_v1(uuid) FROM PUBLIC, anon, authenticated");
    expect(holdEvidenceMigration).toContain("GRANT EXECUTE ON FUNCTION public.summarize_prospect_enrichment_manifest_hold_evidence_v1(uuid) TO service_role");
    const stage = holdEvidenceMigration.slice(holdEvidenceMigration.indexOf("CREATE OR REPLACE FUNCTION public.stage_prospect_enrichment_package_v1("));
    expect(stage).toContain("manifest_row.client_items IS DISTINCT FROM actual_lineage");
    expect(stage).toContain("RETURN jsonb_build_object('outcome','manifest_required')");
  });
});
