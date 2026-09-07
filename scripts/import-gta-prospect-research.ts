#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { RECONCILED_GTA_PROSPECTS } from "../src/app/admin/prospects/reconciled-prospects";
import { buildGtaProspectImportPlan, executeGtaProspectImport, sha256, type GtaProspectImportPlan } from "../src/lib/gta-prospect-research-import";

async function apply(plan: GtaProspectImportPlan) {
  const url=process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("--apply requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const source_name="reconciled_gta_prospect_records";
  const made=await db.from("gta_prospect_import_batches").upsert({source_name,source_sha256:plan.sourceSha256,source_record_count:plan.accepted.length},{onConflict:"source_name,source_sha256",ignoreDuplicates:true}).select("id");
  if(made.error) throw new Error(made.error.message);
  const batch=made.data?.[0]??(await db.from("gta_prospect_import_batches").select("id").eq("source_name",source_name).eq("source_sha256",plan.sourceSha256).single()).data;
  if(!batch) throw new Error("Could not resolve resumable batch.");
  await db.from("gta_prospect_import_batches").update({state:"staged",applied_at:null}).eq("id",batch.id);
  try { for(const record of plan.accepted) { const result=await db.rpc("apply_gta_prospect_research_record",{p_batch_id:batch.id,p_record:record,p_record_sha256:await sha256(record)}); if(result.error) throw new Error(`${record.sourceRecordKey}: ${result.error.message}`); } }
  catch(error) { await db.from("gta_prospect_import_batches").update({state:"failed"}).eq("id",batch.id); throw error; }
  const done=await db.from("gta_prospect_import_batches").update({state:"applied",applied_at:new Date().toISOString()}).eq("id",batch.id); if(done.error) throw new Error(done.error.message);
}
export async function main(argv=process.argv.slice(2)) { const applyFlag=argv.includes("--apply"), confirm=argv[argv.indexOf("--confirm-source-sha256")+1]??null, input=argv[argv.indexOf("--input")+1]??null; const parsed=input?JSON.parse(await readFile(input,"utf8")):RECONCILED_GTA_PROSPECTS, records=Array.isArray(parsed)?parsed:parsed.records; if(!Array.isArray(records))throw new Error("--input must be an array or records array."); const plan=await buildGtaProspectImportPlan(records); console.log(JSON.stringify({mode:applyFlag?"apply":"dry_run",sourceSha256:plan.sourceSha256,accepted:plan.accepted.length,rejected:plan.rejected},null,2)); if(!applyFlag)return plan.rejected.length?1:0; if(confirm!==plan.sourceSha256)throw new Error("--apply requires matching --confirm-source-sha256."); const result=await executeGtaProspectImport({plan,dryRun:false,operatorAuthorized:true,writer:{apply}}); return result.state==="applied"?0:1; }
if(process.argv[1]?.endsWith("import-gta-prospect-research.ts")) main().then(code=>process.exitCode=code).catch(error=>{console.error(error);process.exitCode=1});
