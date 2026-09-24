import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924192549_prospect_enrichment_candidate_firm_coverage.sql"), "utf8");
const reader = readFileSync(resolve(process.cwd(), "src/lib/prospect-enrichment-reader.ts"), "utf8");
const inventory = [...sql.matchAll(/^ \('([a-z_]+)','([a-z_]+)','([^']*)','([^']*)'\)/gm)]
  .map(([, table, kind, columns, excluded]) => ({ table, kind, columns: columns.split(","), excluded: excluded.split(",") }));

describe("proven-firm candidate coverage migration", () => {
  it("has closed, unique SQL bodies and modifies no governed source rows", () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/(?:AS|END|DO) \$(?:;|\s)/);
    expect((sql.match(/\$\$/g) ?? []).length % 2).toBe(0);
    const declarations = [...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION ([a-z_.0-9]+)\(/g)].map(match => match[1]);
    expect(new Set(declarations).size).toBe(declarations.length);
    expect(declarations.length).toBeGreaterThanOrEqual(15);
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO) public\.(?:gta_prospect_|prospect_(?:source_|enrichment_|qualification_|firm_fit_|service_|decision_maker_|opportunity_))/i);
  });

  it("covers every existing legacy reader table through explicit reviewed columns", () => {
    expect(inventory).toHaveLength(33);
    expect(new Set(inventory.map(item => item.table)).size).toBe(33);
    const readerTables = [...reader.matchAll(/section: "\w+", table: "([a-z_]+)"/g)].map(match => match[1]);
    for (const table of readerTables.filter(table => !table.startsWith("prospect_enrichment_"))) {
      expect(inventory.some(item => item.table === table), table).toBe(true);
    }
    for (const item of inventory) {
      expect(item.columns).toContain("id");
      expect(item.columns.some(column => /token|password|secret|session|lease_owner|reviewed_by|worker_id|submitted_by/.test(column))).toBe(false);
    }
    expect(sql).toContain("legacy_columns_not_projected:");
    expect(sql).toContain("legacy_source_rows_unprojected:");
    expect(sql).toContain("e.key=ANY(i.column_names)");
    expect(sql).not.toContain("public.agency_prospects");
    expect(sql).not.toContain("public.prospect_conversations");
  });

  it("requires real applied provenance and never interprets a nested UUID claim as firm identity", () => {
    expect(sql).toContain("a.validation_state='accepted'");
    expect(sql).toContain("a.action_state IN ('created','already_present') AND b.state='applied'");
    expect(sql).toContain("s.firm_id=r.firm_id AND s.stable_firm_id=r.stable_firm_id");
    expect(sql).toContain("IF kind IN ('batch_core','batch_supplemental','agent','unlinked') THEN RETURN NULL");
    expect(sql).toContain("legacy_identity_unverified");
    expect(sql).toContain("draft_research_requires_operator_review");
    expect(sql).toContain("draft_review_without_source_record");
    expect(sql).not.toMatch(/uuid_generate_v5|md5\([^)]*\)::uuid/i);
    expect(sql).toContain("sourceRowSha256");
    expect(sql).toContain("c.revision<=p_cutoff");
    expect(sql).toContain("legacy_identity_assessment");
    expect(sql).toContain("dependency->>'rowSha256' IS DISTINCT FROM");
    expect(sql).toContain("'/snapshot/'||coverage::text");
    expect(sql).toContain("'previousRevision',prior.revision");
  });

  it("aggregates all facets over one verified firm group with singleton unresolved candidates", () => {
    expect(sql).toContain("HAVING count(DISTINCT verified_firm_id)=1");
    expect(sql).toContain("ELSE ARRAY[p_id] END");
    expect(sql).toContain("p_summary->>'identityState'='resolved'");
    expect(sql).toContain("invalid firm ID filter");
    for (const alias of ["h", "f"]) expect(sql).toContain(alias + ".candidate_id=ANY((SELECT ids FROM members)::uuid[])");
    expect(sql).toContain("f.pointer=reference_field.pointer");
    expect(sql).toContain("f.value_json=reference_field.value_json");
    expect(sql).toContain("f.source_urls @> ARRAY[p_filters->>'sourceUrl']");
    expect(sql).toContain("memberships AS MATERIALIZED");
    expect(sql).toContain("coalesce(named.summary->>'identityNamespace','')");
    expect(sql).toContain("h.source_table,h.source_root,h.relative_path,h.source_pointer");
  });

  it("keeps original choice values and binds retractions to their exact target, firm and cutoff", () => {
    expect(sql).toContain("h.original_json->>'event_type'='evidence_retracted'");
    expect(sql).toContain("h.original_json#>>'{details,targetTable}'=p_choice->>'target_table'");
    expect(sql).toContain("h.original_json#>>'{details,targetId}'=p_choice->>'target_id'");
    expect(sql).toContain("lifecycle.original_json->>'firmId'=p_firm::text");
    expect(sql).toContain("'evidenceState',CASE WHEN retractions.items='[]'::jsonb THEN 'retained' ELSE 'retracted' END");
    expect(sql).toContain("'replacementSourceState'");
    expect(sql).toContain("profile_choices_deferred_to_history");
  });

  it("retains snake-case URLs, original date precision and private write boundaries", () => {
    expect(sql).toContain("source_observed_precision'='date_only'");
    expect(sql).toContain("source_observed_precision'='exact_time'");
    expect(sql).toContain("p_value->>'source_url'");
    expect(sql).toContain("p_value->'evidence_urls'");
    expect(sql).toContain("p_value->'source_urls'");
    expect(sql).toContain("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prospect_candidate_private FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL) ON TABLE/i);
    expect(sql).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION public\./);
  });
});
