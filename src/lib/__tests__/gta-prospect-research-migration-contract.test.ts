import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260907145628_gta_prospect_research_persistence.sql"), "utf8");
const tables = [
  "gta_prospect_import_batches",
  "gta_prospect_firms",
  "gta_prospect_aliases",
  "gta_prospect_domains",
  "gta_prospect_offices",
  "gta_prospect_roster_observations",
  "gta_prospect_evidence_links",
  "gta_prospect_identity_adjudications",
  "gta_prospect_import_audit",
];

describe("GTA prospect research migration contract", () => {
  it("keeps each distinct research table service-role-only with forced RLS", () => {
    for (const table of tables) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`);
    }
  });

  it("models aliases, domains, offices, provenance, adjudication, and raw import audit separately", () => {
    expect(migration).toContain("alias_kind IN ('legal_name', 'brand_name', 'source_identifier')");
    expect(migration).toContain("UNIQUE NULLS NOT DISTINCT (firm_id, city, province, address_raw, suite_raw, source_url, observed_on)");
    expect(migration).toContain("source_url text NOT NULL CHECK (source_url ~ '^https?://')");
    expect(migration).toContain("observed_on date NOT NULL");
    expect(migration).toContain("canonical_record jsonb NOT NULL");
    expect(migration).toContain("review_method text NOT NULL DEFAULT 'manual_review'");
  });

  it("makes observations and adjudications append-only and blocks automatic identity rules", () => {
    expect(migration).toContain("gta_prospect_roster_observations_no_mutation");
    expect(migration).toContain("gta_prospect_identity_adjudications_no_mutation");
    expect(migration).toContain("Automated identity merges are intentionally impossible");
    expect(migration).toContain("Deliberately no global domain uniqueness");
    expect(migration).toContain("same street with a different or");
  });

  it("contains no CRM, contact, or outreach data model", () => {
    expect(migration).not.toMatch(/contact_email|contact_phone|outreach_status|campaign_id|crm_contact_id/i);
    expect(migration).not.toMatch(/REFERENCES public\.(agency_prospects|caseload_prospects)/i);
  });

  it("uses an idempotent per-record RPC and explicit service-role grants", () => {
    expect(migration).toContain("apply_gta_prospect_research_record");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gta_prospect_import_batches");
    expect(migration).not.toContain("REVOKE ALL ON ALL TABLES");
  });

  it("keeps the browser-facing validation route dry-run-only and operator-gated", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/admin/prospects/research-import/route.ts"), "utf8");
    expect(route).toContain("getOperatorSession");
    expect(route).toContain("{ status: 401 }");
    expect(route).toContain('mode: "dry_run"');
    expect(route).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|createClient|\.insert\(|\.upsert\(|\.update\(/);
  });
});
