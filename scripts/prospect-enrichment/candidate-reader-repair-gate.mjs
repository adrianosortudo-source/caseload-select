import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATE_READER_REPAIR_PATHS, PROJECT_REF, sha256, verifyLedgerStatements } from "./migration-gate.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const receiptPath = "scripts/prospect-enrichment/candidate-reader-repair-review.json";
const fail = code => { throw new Error(code); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const isRecord = x => x !== null && typeof x === "object" && !Array.isArray(x);
const normalizedSource = source => Buffer.from(source.toString("utf8").replace(/\r\n/g,"\n"),"utf8");
const migrationIdentity = migrationPath => {
 const filename=path.posix.basename(migrationPath);
 return {path:migrationPath,filename,version:filename.slice(0,14),name:filename.slice(15,-4)};
};
const repairMigrations = Object.freeze(CANDIDATE_READER_REPAIR_PATHS.map(migrationIdentity));
export const catalogExpectations = {
 candidate_list_service_role_execute:true,candidate_list_anon_execute:false,candidate_list_auth_execute:false,
 candidate_detail_service_role_execute:true,candidate_detail_anon_execute:false,candidate_detail_auth_execute:false,
 candidate_history_service_role_execute:true,candidate_history_anon_execute:false,candidate_history_auth_execute:false,
 candidate_chunk_service_role_execute:true,candidate_chunk_anon_execute:false,candidate_chunk_auth_execute:false,
 private_list_service_role_execute:true,private_list_anon_execute:false,private_list_auth_execute:false,
 private_firm_links_service_role_execute:false,private_firm_links_anon_execute:false,private_firm_links_auth_execute:false,
 history_metadata_search_index:true,identity_by_candidate_index:true,identity_by_firm_index:true,
 invalid_date_coverage_index:true,
 original_status_exact_index:true,
 apply_refresh_security_definer:true,apply_refresh_empty_search_path:true,
 apply_refresh_update_transition:true,apply_refresh_own_core_audit_excluded:true,
 apply_refresh_current_identity_excluded:true
};
export function createReaderRepairReceipt(sourceRoot=root) {
 const migrations=repairMigrations.map(identity=>{
  const absolute=path.join(sourceRoot,identity.path), stat=fs.lstatSync(absolute);
  if(!stat.isFile()||stat.isSymbolicLink()) fail("reader_repair_source_invalid");
  const source=normalizedSource(fs.readFileSync(absolute));
  return {...identity,bytes:source.length,sha256:sha256(source)};
 });
 return {schemaVersion:"prospect-candidate-reader-repair-review/v2",projectRef:PROJECT_REF,reviewOnly:true,
  productionApplicationApproved:false,migrations,
  exclusions:["No research data import or identity link","No qualification or campaign state change","No seeds or roles"]};
}
export function verifyReaderRepairReceipt(receipt,sourceRoot=root) {
 const expected=createReaderRepairReceipt(sourceRoot); if(!same(receipt,expected)) fail("reader_repair_receipt_source_mismatch");
 return {projectRef:PROJECT_REF,migrations:expected.migrations,productionApplicationApproved:false,verified:true};
}
export function verifyReaderRepairPlan(plan,ledgerCheck,phase) {
 if(!isRecord(plan)||!isRecord(ledgerCheck)||!["pre","post"].includes(phase)||
  ledgerCheck.phase!==(phase==="pre"?"candidate-reader-repair-pending":"complete")||!Array.isArray(ledgerCheck.pendingPaths)) fail("invalid_reader_repair_plan");
 const pendingPaths=ledgerCheck.pendingPaths;
 const permittedPending=phase==="pre"
  ? repairMigrations.map((_,index)=>repairMigrations.slice(index).map(item=>item.path))
  : [[]];
 if(!permittedPending.some(paths=>same(pendingPaths,paths))) fail("unexpected_reader_repair_plan");
 const pending=pendingPaths.map(item=>path.posix.basename(item));
 if(!same(ledgerCheck.pendingPaths.map(x=>path.posix.basename(x)),pending)||plan.dryRun!==true||
  plan.upToDate!==(phase==="post")||!same(plan.migrations,pending)||!same(plan.seeds,[])||!same(plan.roles,[])) fail("unexpected_reader_repair_plan");
 return {phase,migrations:pending,dryRun:true,upToDate:phase==="post",exactScope:true};
}
export const catalogQuery=[
"SELECT json_build_object(",
" 'candidate_list_service_role_execute',has_function_privilege('service_role','public.list_prospect_research_candidates_v1(jsonb,integer,uuid,bigint)','EXECUTE'),",
" 'candidate_list_anon_execute',has_function_privilege('anon','public.list_prospect_research_candidates_v1(jsonb,integer,uuid,bigint)','EXECUTE'),",
" 'candidate_list_auth_execute',has_function_privilege('authenticated','public.list_prospect_research_candidates_v1(jsonb,integer,uuid,bigint)','EXECUTE'),",
" 'candidate_detail_service_role_execute',has_function_privilege('service_role','public.get_prospect_research_candidate_v1(uuid,bigint)','EXECUTE'),",
" 'candidate_detail_anon_execute',has_function_privilege('anon','public.get_prospect_research_candidate_v1(uuid,bigint)','EXECUTE'),",
" 'candidate_detail_auth_execute',has_function_privilege('authenticated','public.get_prospect_research_candidate_v1(uuid,bigint)','EXECUTE'),",
" 'candidate_history_service_role_execute',has_function_privilege('service_role','public.list_prospect_research_candidate_history_v1(uuid,integer,uuid,bigint)','EXECUTE'),",
" 'candidate_history_anon_execute',has_function_privilege('anon','public.list_prospect_research_candidate_history_v1(uuid,integer,uuid,bigint)','EXECUTE'),",
" 'candidate_history_auth_execute',has_function_privilege('authenticated','public.list_prospect_research_candidate_history_v1(uuid,integer,uuid,bigint)','EXECUTE'),",
" 'candidate_chunk_service_role_execute',has_function_privilege('service_role','public.get_prospect_research_candidate_revision_chunk_v1(uuid,uuid,integer,bigint)','EXECUTE'),",
" 'candidate_chunk_anon_execute',has_function_privilege('anon','public.get_prospect_research_candidate_revision_chunk_v1(uuid,uuid,integer,bigint)','EXECUTE'),",
" 'candidate_chunk_auth_execute',has_function_privilege('authenticated','public.get_prospect_research_candidate_revision_chunk_v1(uuid,uuid,integer,bigint)','EXECUTE'),",
" 'private_list_service_role_execute',has_function_privilege('service_role','prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint)','EXECUTE'),",
" 'private_list_anon_execute',has_function_privilege('anon','prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint)','EXECUTE'),",
" 'private_list_auth_execute',has_function_privilege('authenticated','prospect_candidate_private.list_candidates(jsonb,integer,uuid,bigint)','EXECUTE'),",
" 'private_firm_links_service_role_execute',has_function_privilege('service_role','prospect_candidate_private.identity_links_for_firms(bigint,uuid[])','EXECUTE'),",
" 'private_firm_links_anon_execute',has_function_privilege('anon','prospect_candidate_private.identity_links_for_firms(bigint,uuid[])','EXECUTE'),",
" 'private_firm_links_auth_execute',has_function_privilege('authenticated','prospect_candidate_private.identity_links_for_firms(bigint,uuid[])','EXECUTE'),",
" 'history_metadata_search_index',to_regclass('public.prospect_candidate_history_metadata_search') IS NOT NULL,",
" 'identity_by_candidate_index',to_regclass('public.prospect_candidate_identity_by_candidate') IS NOT NULL,",
" 'identity_by_firm_index',to_regclass('public.prospect_candidate_identity_by_firm') IS NOT NULL,",
" 'invalid_date_coverage_index',to_regclass('public.prospect_candidate_invalid_date_coverage') IS NOT NULL,",
" 'original_status_exact_index',to_regclass('public.prospect_candidate_original_status_exact') IS NOT NULL,",
" 'apply_refresh_security_definer',(SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid='prospect_candidate_private.enrichment_firm_refresh_trigger()'::regprocedure),",
" 'apply_refresh_empty_search_path',(SELECT coalesce(p.proconfig @> ARRAY['search_path=\"\"']::text[],false) FROM pg_catalog.pg_proc p WHERE p.oid='prospect_candidate_private.enrichment_firm_refresh_trigger()'::regprocedure),",
" 'apply_refresh_update_transition',(SELECT position('TG_OP = ''UPDATE''' in p.prosrc)>0 AND position('OLD.state IS DISTINCT FROM ''applied''' in p.prosrc)>0 AND position('NEW.state = ''applied''' in p.prosrc)>0 AND position('NEW.firm_id IS NOT NULL' in p.prosrc)>0 FROM pg_catalog.pg_proc p WHERE p.oid='prospect_candidate_private.enrichment_firm_refresh_trigger()'::regprocedure),",
" 'apply_refresh_own_core_audit_excluded',(SELECT position('b.source_name = ''pe-''' in p.prosrc)>0 AND position('b.source_sha256 = NEW.payload_sha256' in p.prosrc)>0 FROM pg_catalog.pg_proc p WHERE p.oid='prospect_candidate_private.enrichment_firm_refresh_trigger()'::regprocedure),",
" 'apply_refresh_current_identity_excluded',(SELECT position('h.package_id IS DISTINCT FROM NEW.id' in p.prosrc)>0 FROM pg_catalog.pg_proc p WHERE p.oid='prospect_candidate_private.enrichment_firm_refresh_trigger()'::regprocedure)",
") AS reader_contract;"
].join("\n");
export function verifyReaderCatalog(payload) {
 const rows=Array.isArray(payload)?payload:isRecord(payload)&&Array.isArray(payload.data)?payload.data:isRecord(payload)&&Array.isArray(payload.rows)?payload.rows:null;
 if(!rows||rows.length!==1||!isRecord(rows[0])||!same(Object.keys(rows[0]),["reader_contract"])||!isRecord(rows[0].reader_contract)) fail("reader_catalog_shape_invalid");
 const actual=rows[0].reader_contract;
 if(!same(Object.keys(actual).sort(),Object.keys(catalogExpectations).sort())||Object.entries(catalogExpectations).some(([k,v])=>actual[k]!==v)) fail("reader_catalog_contract_mismatch");
 return {verified:true,catalogChecks:Object.keys(catalogExpectations).length,privilegesAndIndexes:"exact"};
}
export function verifyTargetLedgerStatements(payload,sourceRoot=root) {
 const rows=Array.isArray(payload)?payload:isRecord(payload)&&Array.isArray(payload.data)?payload.data:isRecord(payload)&&Array.isArray(payload.rows)?payload.rows:null;
 if(!rows||rows.length!==repairMigrations.length||rows.some(row=>!isRecord(row)||!same(Object.keys(row).sort(),["name","statements","version"]))) fail("reader_repair_target_ledger_invalid");
 const ordered=[...rows].sort((a,b)=>a.version.localeCompare(b.version));
 const checks=repairMigrations.map((identity,index)=>{
  const row=ordered[index];
  if(row.version!==identity.version||row.name!==identity.name) fail("reader_repair_target_ledger_invalid");
  return {version:identity.version,name:identity.name,...verifyLedgerStatements(normalizedSource(fs.readFileSync(path.join(sourceRoot,identity.path))),row.statements)};
 });
 return {migrations:checks};
}
const readJson=f=>JSON.parse(fs.readFileSync(f,"utf8"));
const writeJson=(f,x)=>fs.writeFileSync(f,JSON.stringify(x,null,2)+"\n");
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const [command,...args]=process.argv.slice(2);
if(command==="generate"&&args.length===0){writeJson(path.join(root,receiptPath),createReaderRepairReceipt());console.log(JSON.stringify({receipt:receiptPath,generated:true,productionApplicationApproved:false}));}
else if(command==="source"&&args.length===0) console.log(JSON.stringify(verifyReaderRepairReceipt(readJson(path.join(root,receiptPath)))));
else if(command==="plan"&&args.length===2) console.log(JSON.stringify(verifyReaderRepairPlan(readJson(args[0]),readJson(args[1]),process.env.PLAN_PHASE)));
else if(command==="catalog-query"&&args.length===0) process.stdout.write(catalogQuery+"\n");
else if(command==="catalog"&&args.length===1) console.log(JSON.stringify(verifyReaderCatalog(readJson(args[0]))));
else if(command==="target-ledger"&&args.length===1) console.log(JSON.stringify(verifyTargetLedgerStatements(readJson(args[0]))));
else fail("usage_generate_source_plan_catalog-query_catalog_or_target-ledger");

}
