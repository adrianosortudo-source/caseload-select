#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { RECONCILED_GTA_PROSPECTS } from "../src/app/admin/prospects/reconciled-prospects";
import { buildGtaProspectImportPlan, executeGtaProspectImport, type GtaProspectImportPlan } from "../src/lib/gta-prospect-research-import";

async function apply(plan: GtaProspectImportPlan) {
  const url=process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("--apply requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const started=await db.rpc("begin_gta_prospect_import_batch",{p_source_name:"reconciled_gta_prospect_records",p_source_sha256:plan.sourceSha256,p_source_record_count:plan.accepted.length}); if(started.error||!started.data) throw new Error(started.error?.message??"Could not begin batch."); const batchId=started.data;
  try {
    for (const record of plan.accepted) {
      // The database computes this value from its independently validated
      // canonical projection.  Do not trust a client-side hash for a write.
      const hash = await db.rpc("gta_prospect_research_record_sha256", { p_record: record });
      if (hash.error || !hash.data) throw new Error(`${record.sourceRecordKey}: ${hash.error?.message ?? "Could not canonicalize record."}`);
      const result = await db.rpc("apply_gta_prospect_research_record", { p_batch_id: batchId, p_record: record, p_record_sha256: hash.data });
      if (result.error) throw new Error(`${record.sourceRecordKey}: ${result.error.message}`);
    }
  }
  catch(error) { const failed=await db.rpc("fail_gta_prospect_import_batch",{p_batch_id:batchId}); if(failed.error) throw new Error(`Import failed and batch failure transition failed: ${failed.error.message}`); throw error; }
  const done=await db.rpc("complete_gta_prospect_import_batch",{p_batch_id:batchId}); if(done.error) throw new Error(done.error.message);
}
export async function main(argv=process.argv.slice(2)) { const applyFlag=argv.includes("--apply"), confirm=argv[argv.indexOf("--confirm-source-sha256")+1]??null, input=argv[argv.indexOf("--input")+1]??null; const parsed=input?JSON.parse(await readFile(input,"utf8")):RECONCILED_GTA_PROSPECTS, records=Array.isArray(parsed)?parsed:parsed.records; if(!Array.isArray(records))throw new Error("--input must be an array or records array."); const plan=await buildGtaProspectImportPlan(records); console.log(JSON.stringify({mode:applyFlag?"apply":"dry_run",sourceSha256:plan.sourceSha256,accepted:plan.accepted.length,rejected:plan.rejected},null,2)); if(!applyFlag)return plan.rejected.length?1:0; if(confirm!==plan.sourceSha256)throw new Error("--apply requires matching --confirm-source-sha256."); const result=await executeGtaProspectImport({plan,dryRun:false,operatorAuthorized:true,writer:{apply}}); return result.state==="applied"?0:1; }
if(process.argv[1]?.endsWith("import-gta-prospect-research.ts")) main().then(code=>process.exitCode=code).catch(error=>{console.error(error);process.exitCode=1});
