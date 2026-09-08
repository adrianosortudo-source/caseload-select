import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260908160000_gta_prospect_public_contacts.sql"), "utf8");

describe("GTA prospect public-contact migration contract", () => {
  it("stores only source-backed public observations behind forced RLS", () => {
    expect(migration).toContain("CREATE TABLE public.gta_prospect_public_contact_observations");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("gta_prospect_public_contact_observations_no_mutation");
    expect(migration).toContain("Public visibility does not grant outreach authorization");
  });

  it("keeps the operator projection service-role-only and preserves the import hash boundary", () => {
    expect(migration).toContain("list_gta_prospect_research_with_contacts_for_operator");
    expect(migration).toContain("apply_gta_prospect_research_record_with_contacts");
    expect(migration).toContain("record hash does not match canonical record");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.gta_prospect_research_record_with_contacts_sha256");
    expect(migration).toContain("'^\\d{4}-\\d{2}-\\d{2}$'");
    expect(migration).not.toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.gta_prospect_public_contact_observations/i);
  });
});
