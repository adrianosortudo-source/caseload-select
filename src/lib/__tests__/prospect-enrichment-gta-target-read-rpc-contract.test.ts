import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260923221500_prospect_enrichment_gta_target_read_rpc.sql"), "utf8");
const definition = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION"), migration.indexOf("$$;") + 3);

describe("protected GTA target hash read RPC contract", () => {
  it("is fixed-path, bounded, service-role-only, and returns the canonical complete-row hash", () => {
    expect(definition).toMatch(/SECURITY DEFINER\s+SET search_path = ''/i);
    expect(definition).toContain("cardinality(p_ids) > 100");
    expect(definition).toContain("public.prospect_enrichment_row_sha256_v1(to_jsonb(t))");
    expect(definition).toContain("t.id = $1");
    expect(definition).toContain("t.firm_id = $1");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.read_prospect_enrichment_gta_target_rows_v1(uuid,text,uuid[]) FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.read_prospect_enrichment_gta_target_rows_v1(uuid,text,uuid[]) TO service_role");
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
    expect(migration).not.toMatch(/GRANT\s+[^;]*ON\s+TABLE\s+[^;]*gta_prospect_[^;]*TO\s+service_role/i);
  });

  it("rejects caller-controlled table names outside the fixed allowlist", () => {
    expect(definition).toContain("GTA target table is not allowlisted");
    expect(definition).toContain("'gta_prospect_qualification_assessments'");
    expect(definition).not.toContain("p_table ||");
  });
});