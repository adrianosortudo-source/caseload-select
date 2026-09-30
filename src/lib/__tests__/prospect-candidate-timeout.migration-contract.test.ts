import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260930004100_prospect_candidate_reader_timeout_fix.sql"), "utf8");

describe("candidate reader timeout repair migration", () => {
  it("keeps the default inventory page independent of full-inventory identity resolution", () => {
    const fastPathStart = sql.indexOf("IF p_filters='{}'::jsonb THEN");
    const fastPathEnd = sql.indexOf("END IF;", fastPathStart);
    expect(fastPathStart).toBeGreaterThan(-1);
    expect(fastPathEnd).toBeGreaterThan(fastPathStart);
    const fastPath = sql.slice(fastPathStart, fastPathEnd);
    expect(fastPath).toContain("LIMIT p_limit");
    expect(fastPath).toContain("prospect_candidate_private.summary(id,cutoff)");
    expect(fastPath).toContain("(SELECT count(*) FROM inventory)");
    expect(fastPath).not.toContain("identity_links_at");
    expect(fastPath).not.toContain("identities AS MATERIALIZED");
  });

  it("indexes the exact provenance metadata text-search expression and retains service-role RPC access", () => {
    expect(sql).toContain("CREATE INDEX prospect_candidate_history_metadata_search");
    expect(sql).toContain("to_tsvector('simple'::regconfig, coalesce(source_table,'') || ' ' || coalesce(source_root,'')");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates");
    expect(sql).toContain("SECURITY DEFINER SET search_path = ''");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint) TO service_role");
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });
});
