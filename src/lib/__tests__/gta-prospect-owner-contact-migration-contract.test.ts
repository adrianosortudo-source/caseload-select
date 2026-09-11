import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260908134358_gta_prospect_owner_contact_research.sql"),
  "utf8",
);
const coreImport = readFileSync(resolve(process.cwd(), "src/lib/gta-prospect-research-import.ts"), "utf8");

describe("GTA owner-contact research migration contract", () => {
  it("keeps owner contact evidence private, append-only, and service-role-only", () => {
    expect(migration).toContain("CREATE TABLE public.gta_prospect_owner_contact_observations");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("gta_prospect_owner_contact_observations_no_mutation");
    expect(migration).toContain("REVOKE ALL ON TABLE public.gta_prospect_owner_contact_observations FROM PUBLIC, anon, authenticated, service_role;");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.list_gta_prospect_owner_contacts_for_operator()");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.list_gta_prospect_owner_contacts_for_operator() TO service_role;");
    expect(migration).toContain("ORDER BY observation.is_primary_contact DESC, observation.ownership_observed_on DESC");
    expect(migration).not.toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.gta_prospect_owner_contact_observations/i);
  });

  it("requires evidence for a direct owner email and leaves core research import contact-free", () => {
    expect(migration).toContain("email_availability <> 'direct_owner_email'");
    expect(migration).toContain("ownership_confidence = 'confirmed_owner'");
    expect(coreImport).not.toMatch(/ownerName|emailAddress|ownershipConfidence|outreach/i);
  });
});
