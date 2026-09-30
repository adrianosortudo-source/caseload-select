import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATE_READER_REPAIR_PATH, PROJECT_REF, sha256, verifyLedgerStatements } from "./migration-gate.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const receiptPath = "scripts/prospect-enrichment/candidate-reader-repair-review.json";
const fail = code => { throw new Error(code); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const isRecord = x => x !== null && typeof x === "object" && !Array.isArray(x);
const filename = path.posix.basename(CANDIDATE_READER_REPAIR_PATH), version = filename.slice(0,14), name = filename.slice(15,-4);
const catalogExpectations = {
 candidate_list_service_role_execute:true,candidate_list_anon_execute:false,candidate_list_auth_execute:false,
 candidate_detail_service_role_execute:true,candidate_detail_anon_execute:false,candidate_detail_auth_execute:false,
 candidate_history_service_role_execute:true,candidate_history_anon_execute:false,candidate_history_auth_execute:false,
 candidate_chunk_service_role_execute:true,candidate_chunk_anon_execute:false,candidate_chunk_auth_execute:false,
 private_list_service_role_execute:true,private_list_anon_execute:false,private_list_auth_execute:false,
 private_firm_links_service_role_execute:false,private_firm_links_anon_execute:false,private_firm_links_auth_execute:false,
 history_metadata_search_index:true,identity_by_candidate_index:true,identity_by_firm_index:true
};
export function createReaderRepairReceipt(sourceRoot=root) {
 const absolute=path.join(sourceRoot,CANDIDATE_READER_REPAIR_PATH), stat=fs.lstatSync(absolute);
 if(!stat.isFile()||stat.isSymbolicLink()) fail("reader_repair_source_invalid");
 const source=fs.readFileSync(absolute);
 return {schemaVersion:"prospect-candidate-reader-repair-review/v1",projectRef:PROJECT_REF,reviewOnly:true,
  productionApplicationApproved:false,migration:{path:CANDIDATE_READER_REPAIR_PATH,filename,version,name,bytes:source.length,sha256:sha256(source)},
  exclusions:["No research data import or identity link","No qualification or campaign state change","No seeds or roles"]};
}
export function verifyReaderRepairReceipt(receipt,sourceRoot=root) {
 const expected=createReaderRepairReceipt(sourceRoot); if(!same(receipt,expected)) fail("reader_repair_receipt_source_mismatch");
 return {projectRef:PROJECT_REF,migration:expected.migration,productionApplicationApproved:false,verified:true};
}
export function verifyReaderRepairPlan(plan,ledgerCheck,phase) {
 if(!isRecord(plan)||!isRecord(ledgerCheck)||!["pre","post"].includes(phase)||
  ledgerCheck.phase!==(phase==="pre"?"candidate-reader-repair-pending":"complete")||!Array.isArray(ledgerCheck.pendingPaths)) fail("invalid_reader_repair_plan");
 const pending=phase==="pre"?[filename]:[];
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
" 'identity_by_firm_index',to_regclass('public.prospect_candidate_identity_by_firm') IS NOT NULL",
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
 if(!rows||rows.length!==1||!isRecord(rows[0])||!same(Object.keys(rows[0]).sort(),["name","statements","version"])||rows[0].version!==version||rows[0].name!==name) fail("reader_repair_target_ledger_invalid");
 return {version,name,...verifyLedgerStatements(fs.readFileSync(path.join(sourceRoot,CANDIDATE_READER_REPAIR_PATH)),rows[0].statements)};
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
