import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";

const enabled = process.env.CI === "true" && process.env.PROSPECT_ENRICHMENT_REQUIRE_DATABASE_URL === "1";
const rawUrl = (process.env.DIRECT_DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
if (enabled) {
  const url = new URL(rawUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "::1"].includes(url.hostname.replace(/^\[|\]$/g, "")) || !url.port || url.pathname !== "/postgres") {
    throw new Error("Search plan fixture accepts only the disposable loopback Postgres database.");
  }
}
const suite = enabled ? describe : describe.skip;
type Page = { items: { id: string; identityState: string; verifiedFirmId: string | null; originalStatuses: string[] }[];
  inventoryCount: number; filteredCount: number; nextAfterId: string | null; coverageRevision: number; complete: boolean; readWarnings: string[] };
const baseline = readFileSync("supabase/migrations/20261006170000_prospect_candidate_global_text_search_direct_scope.sql", "utf8")
  .match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/)![0];

suite("global candidate search membership at production chunk scale", () => {
  const pool = enabled ? new Pool({ connectionString: rawUrl, max: 1 }) : null;
  afterAll(async () => { await pool?.end(); });
  it("preserves full RPC results, cached plans, the 128 boundary, identity proofs and frozen continuations", async () => {
    const db = await pool!.connect();
    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL statement_timeout='180s'");
      const repaired = (await db.query<{ source: string }>("SELECT pg_get_functiondef('prospect_candidate_private.list_candidates_for_text(jsonb,integer,uuid,bigint)'::regprocedure) source")).rows[0].source;
      const key = "searchplan" + randomUUID().replaceAll("-", "");
      // Direct immutable projection fixtures isolate the reader. Source-writer and
      // governance behavior remain covered by the existing candidate integration tests.
      const start = Number((await db.query("SELECT coalesce(max(revision),0)+1 start FROM public.prospect_research_candidate_coverage")).rows[0].start);
      const cutoff = start + 60003;
      await db.query(`INSERT INTO public.prospect_research_candidate_coverage(revision,source_table,source_key,source_sha256,snapshot)
        SELECT $2::bigint+n,$1,n::text,md5($1||n),'{}' FROM generate_series(0,60003) n WHERE n NOT IN (1,2)`, [key, start]);
      await db.query("SELECT setval('prospect_candidate_private.coverage_seq',$1,true)", [cutoff]);
      await db.query(`INSERT INTO public.prospect_research_candidates(id,identity_namespace,identity_key,identity_namespace_sha256,identity_key_sha256,created_revision)
        SELECT md5($1||n)::uuid,$1,'source'||n,md5($1),md5('source'||n),$2 FROM generate_series(1,6000) n`, [key, start]);
      await db.query(`INSERT INTO public.prospect_research_candidate_history(id,candidate_id,coverage_revision,item_kind,source_table,source_key,payload_sha256,original_json,original_json_sha256,recorded_at,original_status)
        SELECT md5($1||'h'||n)::uuid,md5($1||n)::uuid,$2,'research_revision',$1,n::text,md5(n::text),jsonb_build_object('status','held'),md5(n::text),now(),'held' FROM generate_series(1,6000) n`, [key, start]);
      await db.query(`INSERT INTO public.prospect_research_candidate_fields(revision_id,candidate_id,coverage_revision,pointer,pointer_sha256,scalar_type,value_json,searchable_text,source_ids,validation_state)
        SELECT md5($1||'h'||n)::uuid,md5($1||n)::uuid,$2,'/text',md5('/text'),'string','"synthetic"','synthetic','[]','retained' FROM generate_series(1,6000) n`, [key, start]);
      await db.query(`INSERT INTO public.prospect_research_candidate_search_chunks(revision_id,pointer_sha256,chunk_ordinal,candidate_id,coverage_revision,search_document)
        SELECT md5($1||'h'||candidate)::uuid,md5('/text'),chunk,md5($1||candidate)::uuid,$2,
          to_tsvector('simple',CASE WHEN candidate<=12 AND chunk<22 THEN $1||'anchor evidence'
            WHEN candidate<=29 THEN 'Law evidence' WHEN candidate%3<>0 THEN 'Law background research '||chunk ELSE 'background research '||chunk END)
        FROM (SELECT n candidate,chunk FROM generate_series(1,6000) n CROSS JOIN generate_series(0,165) chunk
          UNION ALL SELECT 1,chunk FROM generate_series(166,4165) chunk) fixture`, [key, start]);
      const firm = randomUUID();
      const otherFirm = randomUUID();
      await db.query("INSERT INTO public.gta_prospect_firms(id,source_record_key,display_name,normalized_display_name,reconciliation_status) VALUES($1,$3,'Synthetic','synthetic','provisional_new'),($2,$3||'other','Synthetic Other','synthetic other','provisional_new')", [firm, otherFirm, key]);
      const link = async (candidate: string, firmId: string, source = "fixture_identity", raw: Record<string, unknown> = {}, revision = start, proof = randomUUID()) => {
        await db.query(`INSERT INTO public.prospect_research_candidate_history(candidate_id,coverage_revision,item_kind,source_table,source_key,payload_sha256,original_json,original_json_sha256,recorded_at,verified_firm_id)
          VALUES($1,$2,'identity_link',$3,$4,$5,$6::jsonb,$5,now(),$7)`, [candidate, revision, source, proof, proof, JSON.stringify(raw), firmId]);
      };
      const ids = (await db.query<{ id: string }>("SELECT id FROM public.prospect_research_candidates WHERE identity_namespace=$1 ORDER BY id", [key])).rows.map(x => x.id);
      for (let n=1;n<=29;n++) await link((await db.query<{ id: string }>("SELECT md5($1||$2::text)::uuid id", [key, n])).rows[0].id, firm);
      const read = async (text: string, limit = 25, after: string | null = null, coverage = cutoff): Promise<Page> => {
        return (await db.query<{ data: Page }>({ name: "search-plan-public-rpc", text: "SELECT public.list_prospect_research_candidates_v1($1::jsonb,$2::integer,$3::uuid,$4::bigint) data", values: [JSON.stringify({ text }), limit, after, coverage] })).rows[0].data;
      };
      for (const table of ["candidates", "candidate_coverage", "candidate_history", "candidate_fields", "candidate_search_chunks"]) await db.query("ANALYZE public.prospect_research_" + table);
      const tokens = key + "anchor";
      const expectedIds = (await db.query<{ id: string }>("SELECT md5($1||n)::uuid id FROM generate_series(1,29) n ORDER BY id", [key])).rows.map(x => x.id);
      const timings: { mode: string; milliseconds: number }[] = [];
      for (const mode of ["force_custom_plan", "force_generic_plan", "auto"]) {
        await db.query("SET LOCAL plan_cache_mode=" + mode);
        await db.query("SET LOCAL statement_timeout='5s'");
        for (let i=0;i<7;i++) {
          const begun = performance.now();
          const text = i%2 ? "Law " + tokens : tokens + " Law";
          const page = await read(text);
          timings.push({ mode, milliseconds: performance.now()-begun });
          expect(page.filteredCount).toBe(29);
          expect(page.items.map(x => x.id)).toEqual(expectedIds.slice(0,25));
          expect(page.items.every(x => x.verifiedFirmId===firm && x.originalStatuses.includes("held"))).toBe(true);
          expect(page.complete).toBe(false);
          expect(page.readWarnings).toEqual(["enrichment_coverage_audit_deferred_for_text_search", "raw_projection_text_search_deferred_for_text_search"]);
          expect(page.coverageRevision).toBe(cutoff);
          const next = await read(text,25,page.nextAfterId!,page.coverageRevision);
          expect(next.items.map(x => x.id)).toEqual(expectedIds.slice(25));
          expect(next.filteredCount).toBe(29); expect(next.inventoryCount).toBe(page.inventoryCount); expect(next.nextAfterId).toBeNull();
        }
        const body=repaired.slice(repaired.indexOf("WITH text_terms"),repaired.indexOf(" INTO result;"))
          .replaceAll("p_filters","$1::jsonb").replaceAll("p_limit","25").replaceAll("p_after_id","NULL::uuid")
          .replace(/\bcutoff\b/g,String(cutoff)).replace(/\bwarnings\b/g,"'[]'::jsonb");
        const plan=(await db.query("EXPLAIN (FORMAT JSON) "+body,[JSON.stringify({text:tokens+" Law"})])).rows[0]["QUERY PLAN"];
        const nodes:Record<string,unknown>[]=[];
        const inspect=(value:unknown):void=>{
          if(!value||typeof value!=="object")return;
          if(Array.isArray(value)){value.forEach(inspect);return;}
          const node=value as Record<string,unknown>;nodes.push(node);Object.values(node).forEach(inspect);
        };
        inspect(plan);
        const scoped=nodes.find(x=>x["Subplan Name"]==="CTE scoped_text_hits");
        expect(scoped).toBeDefined();nodes.length=0;inspect(scoped);
        expect(nodes.some(x=>x["Index Name"]==="prospect_candidate_search_coverage")).toBe(true);
        expect(nodes.some(x=>x["Index Name"]==="prospect_candidate_field_search")).toBe(false);
        expect(nodes.some(x=>x["Relation Name"]==="prospect_research_candidate_search_chunks"&&x["Node Type"]==="Seq Scan")).toBe(false);
      }
      expect(Math.max(...timings.map(x => x.milliseconds))).toBeLessThan(4500);
      console.info("candidate-search-plan-full-rpc", JSON.stringify({ chunks:1000000, cutoff, timings, maxMilliseconds:Math.max(...timings.map(x => x.milliseconds)) }));
      await db.query("SET LOCAL statement_timeout='30s'");
      const original = await read(tokens + " Law",100);
      for (const text of ["  " + tokens + "\tLaw\nLaw  ", "Law " + tokens + " !!!", tokens + " Law Law", tokens + " Law."]) {
        expect(await read(text,100)).toEqual(original);
      }
      // The repair leaves tokenization unchanged, including discarded no-lexeme terms.
      const noLexemes = (await db.query("SELECT count(*)::integer n FROM regexp_split_to_table('  !!! ---  ','\\s+') term WHERE numnode(plainto_tsquery('simple',btrim(term)))>0")).rows[0].n;
      expect(noLexemes).toBe(0);
      const smallCandidate = async (term: string, text: string, revision = start) => {
        const id=randomUUID(), history=randomUUID();
        await db.query("INSERT INTO public.prospect_research_candidates(id,identity_namespace,identity_key,identity_namespace_sha256,identity_key_sha256,created_revision) VALUES($1,$2,$3,md5($2),md5($3),$4)", [id,key,term,revision]);
        await db.query("INSERT INTO public.prospect_research_candidate_history(id,candidate_id,coverage_revision,item_kind,source_table,source_key,payload_sha256,original_json,original_json_sha256,recorded_at,original_status) VALUES($1::uuid,$2::uuid,$3::bigint,'research_revision',$4,$1::uuid::text,$1::uuid::text,'{}',$1::uuid::text,now(),'held')", [history,id,revision,key]);
        await db.query("INSERT INTO public.prospect_research_candidate_fields(revision_id,candidate_id,coverage_revision,pointer,pointer_sha256,scalar_type,value_json,searchable_text,source_ids,validation_state) VALUES($1,$2,$3,'/text',md5('/text'),'string',to_jsonb($4::text),$4,'[]','retained')", [history,id,revision,text]);
        await db.query("INSERT INTO public.prospect_research_candidate_search_chunks VALUES($1,md5('/text'),0,$2,$3,to_tsvector('simple',$4::text))", [history,id,revision,text]);
        return id;
      };
      const boundaryQueries: { text: string; ids: string[] }[] = [];
      for (const count of [127,128,129]) {
        const term=key+"boundary"+count, linkedFirm=randomUUID();
        await db.query("INSERT INTO public.gta_prospect_firms(id,source_record_key,display_name,normalized_display_name,reconciliation_status) VALUES($1,$2,'Synthetic Boundary','synthetic boundary','provisional_new')", [linkedFirm, term]);
        const anchors:string[]=[];
        for(let n=0;n<count;n++) { const id=await smallCandidate(term+":"+n,term+(count>128 ? " Law" : "")); anchors.push(id); await link(id,linkedFirm); }
        const sibling=await smallCandidate(key+"sibling"+count,"Law"); await link(sibling,linkedFirm);
        const expected=count<=128 ? [...anchors,sibling].sort() : anchors.sort();
        boundaryQueries.push({ text:term+" Law",ids:expected });
      }
      const heldTerm=key+"unresolved";
      const held=await smallCandidate(heldTerm,heldTerm+" Law");
      const conflictTerm=key+"conflicted";
      const conflicted=await smallCandidate(conflictTerm,conflictTerm+" Law");
      await link(conflicted,firm); await link(conflicted,otherFirm);
      const splitConflictTerm=key+"conflictsplit";
      const splitConflict=await smallCandidate(splitConflictTerm,splitConflictTerm);
      await link(splitConflict,firm); await link(splitConflict,otherFirm);
      // Exact legacy proof: stale source hashes cannot expand a same-firm group.
      const legacyTerm=key+"legacyproof", legacy=await smallCandidate(legacyTerm,legacyTerm), sibling=await smallCandidate(key+"legacysibling","Law");
      await link(sibling,firm);
      const proof=randomUUID(), sourceRow=randomUUID();
      await db.query("INSERT INTO public.prospect_research_candidate_coverage VALUES($1,'fixture_legacy_source',$2,'hash',jsonb_build_object('sourceRowSha256','valid'),now()),($3,'legacy_identity_assessment',$4,'proof',jsonb_build_object('row',jsonb_build_object('proofSha256',$4::text)),now())", [start+1,sourceRow,start+2,proof]);
      await link(legacy,firm,"legacy_verified_identity",{sourceTable:"fixture_legacy_source",sourceRowId:sourceRow,sourceRowSha256:"valid",dependencies:[]},start+2,proof);
      // Differential equality includes warnings, summaries, counts, order and cursor.
      const queries=[...boundaryQueries.map(x=>x.text),heldTerm+" Law",conflictTerm+" Law",splitConflictTerm+" Law",legacyTerm+" Law"];
      const before:Page[]=[];
      for(const text of queries) before.push(await read(text,100));
      for(let i=0;i<3;i++) {
        const all:string[]=[];let after:string|null=null;
        do {const page=await read(boundaryQueries[i].text,100,after);all.push(...page.items.map(x=>x.id));after=page.nextAfterId;} while(after);
        expect(all).toEqual(boundaryQueries[i].ids);
      }
      expect(before[3].items.map(x=>x.id)).toEqual([held]); expect(before[3].items[0].identityState).toBe("unresolved");
      expect(before[4].items.map(x=>x.id)).toEqual([conflicted]); expect(before[4].items[0].identityState).toBe("conflict"); expect(before[4].items[0].verifiedFirmId).toBeNull();
      expect(before[5].filteredCount).toBe(0);
      expect(before[6].items.some(x=>x.id===legacy)).toBe(true);
      await db.query(baseline);
      for(let i=0;i<queries.length;i++) expect(await read(queries[i],100)).toEqual(before[i]);
      await db.query(repaired);
      const groupBefore=await read(tokens+" Law",100);
      const first=await read(tokens+" Law");
      const future=Number((await db.query("SELECT max(revision)+1 revision FROM public.prospect_research_candidate_coverage")).rows[0].revision);
      await db.query("INSERT INTO public.prospect_research_candidate_coverage VALUES($1,'fixture_legacy_source',$2,'changed',jsonb_build_object('sourceRowSha256','changed'),now())", [future,sourceRow]);
      await smallCandidate(key+"future",tokens+" Law",future);
      const frozen=await read(tokens+" Law",25,first.nextAfterId!,first.coverageRevision);
      expect(frozen.items.map(x=>x.id)).toEqual(groupBefore.items.filter(x=>x.id>first.nextAfterId!).map(x=>x.id));
      expect(frozen.filteredCount).toBe(groupBefore.filteredCount); expect(frozen.inventoryCount).toBe(first.inventoryCount);
      expect((await read(legacyTerm+" Law",100,null,future)).filteredCount).toBe(0);
      expect(await read(legacyTerm+" Law",100,null,cutoff)).toEqual(before[6]);
      expect(ids).toHaveLength(6000);
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 600_000);
});
