import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";

// Pushed-branch CI only; never connect to a remotely configured database.
const enabled = process.env.CI === "true" && process.env.PROSPECT_ENRICHMENT_REQUIRE_DATABASE_URL === "1";
const rawUrl = (process.env.DIRECT_DATABASE_URL ?? process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
if (enabled) {
  const url = new URL(rawUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "::1"].includes(url.hostname.replace(/^\[|\]$/g, "")) || !url.port || url.pathname !== "/postgres") {
    throw new Error("Candidate performance contract accepts only the CI disposable loopback database.");
  }
}
const suite = enabled ? describe : describe.skip;
type Page = { inventoryCount: number; filteredCount: number; coverageRevision: number; items: { id: string; verifiedFirmId: string | null }[] };

suite("candidate reads above the observed Admin inventory", () => {
  const pool = enabled ? new Pool({ connectionString: rawUrl, max: 1 }) : null;
  afterAll(async () => { await pool?.end(); });
  it("keeps list, typed search and profile reads below five seconds with 6500 sources and retained revisions", async () => {
    const db = await pool!.connect();
    await db.query("BEGIN");
    try {
      const prefix = "synthetic-throughput-" + randomUUID();
      // Exercise ordinary source triggers, not hand-built candidate indexes.
      await db.query("SET LOCAL statement_timeout = '180s'");
      await db.query(`INSERT INTO public.gta_prospect_firms(source_record_key,display_name,normalized_display_name,reconciliation_status)
        SELECT $1||'-'||n, 'Synthetic throughput firm '||n, 'synthetic throughput firm '||n, 'provisional_new' FROM generate_series(1,6500) n`, [prefix]);
      for (const suffix of [" revised", ""]) {
        await db.query(`UPDATE public.gta_prospect_firms SET display_name='Synthetic throughput firm '||n||$2
          FROM generate_series(1,500) n WHERE source_record_key=$1||'-'||n`, [prefix, suffix]);
      }
      const batchId = (await db.query<{ id: string }>(
        "INSERT INTO public.gta_prospect_import_batches(source_name,source_sha256,source_record_count,state,applied_at) VALUES($1,$2,6000,'applied',now()) RETURNING id",
        [prefix, "b".repeat(64)])).rows[0].id;
      // Bounded setup batches let PostgreSQL refresh statistics as the synthetic
      // journal grows. The measured read allowance below stays exactly five seconds.
      const auditSetupStart = performance.now();
      await db.query("SET LOCAL statement_timeout = '60s'");
      for (let first = 1; first <= 6000; first += 500) {
        await db.query(`INSERT INTO public.gta_prospect_import_audit(import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,firm_id,canonical_record)
          SELECT $1,f.source_record_key,$2,'accepted','created',f.id,jsonb_build_object('sourceRecordKey',f.source_record_key,'firmName',f.display_name)
          FROM public.gta_prospect_firms f JOIN generate_series($4::integer,$5::integer) n ON f.source_record_key=$3||'-'||n`, [batchId, "a".repeat(64), prefix, first, first + 499]);
        for (const table of ["gta_prospect_import_audit", "prospect_research_candidate_coverage", "prospect_research_candidate_history"]) {
          await db.query("ANALYZE public." + table);
        }
        const elapsed = performance.now() - auditSetupStart;
        console.info("candidate-setup-progress", JSON.stringify({ appliedAuditRows: first + 499, milliseconds: elapsed }));
        expect(elapsed).toBeLessThan(600_000);
      }
      const targetFirm = (await db.query<{ id: string }>("SELECT id FROM public.gta_prospect_firms WHERE source_record_key=$1", [prefix + "-1"])).rows[0].id;
      const counts = (await db.query<{ candidates: number; histories: number; fields: number; sources: number; identityLinks: number }>(`SELECT
        (SELECT count(*)::integer FROM public.prospect_research_candidates) candidates,
        (SELECT count(*)::integer FROM public.prospect_research_candidate_history) histories,
        (SELECT count(*)::integer FROM public.prospect_research_candidate_fields) fields,
        (SELECT count(*)::integer FROM public.gta_prospect_firms WHERE source_record_key LIKE $1||'-%') sources,
        (SELECT count(*)::integer FROM public.prospect_research_candidate_history WHERE item_kind='identity_link') AS "identityLinks"`, [prefix])).rows[0];
      expect(counts.sources).toBe(6500);
      expect(counts.candidates).toBeGreaterThanOrEqual(12_500);
      expect(counts.identityLinks).toBeGreaterThanOrEqual(12_000);
      console.info("candidate-read-fixture", JSON.stringify(counts));
      expect(counts.histories).toBeGreaterThanOrEqual(7500);
      expect(counts.fields).toBeGreaterThanOrEqual(45_000);
      for (const table of ["prospect_research_candidates", "prospect_research_candidate_history", "prospect_research_candidate_fields", "prospect_research_candidate_search_chunks", "prospect_research_candidate_coverage", "gta_prospect_firms", "gta_prospect_import_audit", "gta_prospect_import_batches"]) {
        await db.query("ANALYZE public." + table);
      }
      await db.query("SET LOCAL statement_timeout = '5s'");
      const explanation = (await db.query<{ "QUERY PLAN": unknown }>(
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM public.gta_prospect_import_audit WHERE firm_id=$1 ORDER BY id", [targetFirm])).rows[0]["QUERY PLAN"];
      const indexes: string[] = [];
      const inspectPlan = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) { value.forEach(inspectPlan); return; }
        const item = value as Record<string, unknown>;
        if (typeof item["Index Name"] === "string") indexes.push(item["Index Name"]);
        Object.values(item).forEach(inspectPlan);
      };
      inspectPlan(explanation);
      expect(indexes).toContain("gta_prospect_import_audit_firm_id_idx");
      console.info("candidate-firm-index-plan", JSON.stringify({ indexes }));
      const timings: { label: string; milliseconds: number }[] = [];
      const read = async (label: string, filters: Record<string, unknown>) => {
        console.info("candidate-read-start", label);
        const start = performance.now();
        const page = (await db.query<{ data: Page }>("SELECT public.list_prospect_research_candidates_v1($1::jsonb,25,NULL,NULL) data", [JSON.stringify(filters)])).rows[0].data;
        timings.push({ label, milliseconds: performance.now() - start });
        expect(page.inventoryCount).toBe(counts.candidates);
        expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThan(1_048_576);
        return page;
      };
      const first = await read("unfiltered-cold", {});
      for (let index = 0; index < 4; index++) await read("unfiltered-repeat-" + index, {});
      expect((await read("indexed-text", { text: "throughput" })).filteredCount).toBeGreaterThanOrEqual(6500);
      expect((await read("typed-field", { fieldPointer: "/reconciliation_status", fieldValue: "provisional_new" })).filteredCount).toBeGreaterThanOrEqual(6500);
      expect((await read("unresolved", { identityState: "unresolved" })).filteredCount).toBeGreaterThanOrEqual(500);
      const linked = await read("verified-firm", { firmId: targetFirm });
      expect(linked.filteredCount).toBeGreaterThanOrEqual(2);
      expect(linked.items.every(item => item.verifiedFirmId === targetFirm)).toBe(true);
      const profileStart = performance.now();
      const profile = (await db.query<{ data: { candidate: { id: string }; coverageRevision: number } }>(
        "SELECT public.get_prospect_research_candidate_v1($1,$2) data", [first.items[0].id, first.coverageRevision])).rows[0].data;
      timings.push({ label: "profile", milliseconds: performance.now() - profileStart });
      expect(profile.candidate.id).toBe(first.items[0].id);
      const ordered = timings.map(item => item.milliseconds).sort((a, b) => a - b);
      const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
      console.info("candidate-read-performance", JSON.stringify({ counts, timings, p95Milliseconds: p95, statementTimeoutMilliseconds: 5000 }));
      expect(p95).toBeLessThan(5000);
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 900_000);
});
