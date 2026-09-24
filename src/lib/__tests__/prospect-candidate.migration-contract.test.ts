import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924172758_prospect_enrichment_candidate_profiles.sql"), "utf8");
const publicReads = ["list_prospect_research_candidates_v1", "get_prospect_research_candidate_v1",
  "list_prospect_research_candidate_history_v1", "get_prospect_research_candidate_revision_chunk_v1"];

describe("candidate migration preservation and privilege contract", () => {
  it("has one transaction, unique function declarations, and paired dollar delimiters", () => {
    const names = [...sql.matchAll(/CREATE FUNCTION ([a-z_]+\.[a-z_0-9]+)\(/g)].map(match => match[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(20);
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/END \$;/);
    const bodies = [...sql.matchAll(/\$\$[\s\S]*?\$\$/g)];
    expect(bodies.length).toBe(names.length + 2); // privilege loop + governed stored-row seed
    expect((sql.match(/\$\$/g) ?? []).length).toBe(bodies.length * 2);
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION");
  });

  it("closes all seven append-only projection tables and public read wrappers", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).toContain("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA prospect_candidate_private FROM PUBLIC, anon, authenticated, service_role");
    for (const name of publicReads) {
      const start = sql.indexOf("CREATE FUNCTION public." + name + "(");
      const end = sql.indexOf("$$;", start);
      expect(start).toBeGreaterThan(-1);
      expect(sql.slice(start, end)).toContain("SECURITY INVOKER");
      expect(sql.slice(start, end)).not.toContain("SECURITY DEFINER");
      expect(sql).toMatch(new RegExp("public\\." + name + "\\([^;]+FROM PUBLIC, anon, authenticated, service_role"));
    }
    expect(sql).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL) ON TABLE/i);
  });

  it("serializes coverage commits and never guesses a firm identity", () => {
    expect(sql).toContain("pg_advisory_xact_lock(20260924,314)");
    expect(sql).toContain("identity_namespace_sha256, identity_key_sha256");
    expect(sql).toContain("candidate identity digest collision");
    expect(sql).toContain("'run:'||p_run::text");
    expect(sql).toContain("receipt->>'packageId'=package_value::text");
    expect(sql).toContain("receipt->>'firmId'=package_row.firm_id::text");
    expect(sql).toContain("e.event_type IN ('reviewed','review_changed')");
    expect(sql).toContain("WHEN i.n>1 THEN 'conflict'");
    expect(sql).not.toMatch(/uuid_generate_v5|md5\([^)]*\)::uuid/i);
  });

  it("indexes exact raw fields and bounded text without width-sensitive pointer/date keys", () => {
    expect(sql).toContain("PRIMARY KEY(revision_id,pointer_sha256)");
    expect(sql).toContain("f.pointer=reference_field.pointer");
    expect(sql).toContain("f.value_json=reference_field.value_json");
    expect(sql).toContain("f.source_urls @> ARRAY[p_filters->>'sourceUrl']");
    expect(sql).toContain("USING gin(source_url_hashes)");
    expect(sql).toContain("(candidate_id,observed_day,retrieved_day)");
    expect(sql).not.toContain("PRIMARY KEY(revision_id,pointer)");
    expect(sql).not.toContain("(candidate_id,observed_at,retrieved_at)");
    expect(sql).toContain("generate_series(1,greatest(1,char_length(f.searchable_text)),32768)");
    expect(sql).toContain("regexp_split_to_table(p_filters->>'text'");
    expect(sql).toContain("field_projection_requires_raw_review");
  });

  it("keeps source and retained JSON hashes distinct and serves immutable bounded content chunks", () => {
    expect(sql).toContain("'payloadSha256',h.payload_sha256,'originalJsonSha256',h.original_json_sha256");
    expect(sql).toContain("'contentDeferred',true");
    expect(sql).toContain("'contentDeferred',false");
    expect(sql).toContain("char_length(chunk)<=65536");
    expect(sql).toContain("p_offset%65536<>0");
    expect(sql).toContain("candidate_id=p_candidate_id AND coverage_revision<=cutoff");
    expect(sql).not.toContain("10485760");
    expect(sql).toContain("bytes+octet_length(item::text)>1048000");
    expect(sql).toContain("profile_choices_deferred_to_history");
  });

  it("projects every governed source transactionally without changing old intake or SQL", () => {
    for (const name of ["runs", "run_manifest_items", "manifest_hold_evidence", "packages", "items", "events", "item_targets", "profile_choices"]) {
      expect(sql).toMatch(new RegExp("AFTER INSERT(?: OR UPDATE)? ON public\\.prospect_enrichment_" + name));
    }
    expect(sql).toContain("manifest_hold_body_missing:");
    expect(sql).toContain("unregistered_source_rows:");
    expect(sql).toContain("invalid_source_date:");
    expect(sql).toContain("held_original_json_requires_raw_review");
    expect(sql).not.toMatch(/UPDATE public\.prospect_enrichment_|DELETE FROM public\.prospect_enrichment_/);
  });
});
