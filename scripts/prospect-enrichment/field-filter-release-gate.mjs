// Fixed singleton release for the reviewed global field-filter migration.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROJECT_REF, CLI_VERSION, sha256, verifyExecutionGate, verifyLedgerStatements, findProjectEnvFiles } from "./migration-gate.mjs";
import { runDatabaseOperation } from "./complete-release-gate.mjs";

export const TARGET_VERSION="20261014153626";
export const TARGET_NAME="prospect_candidate_global_field_filter_fastpath";
export const TARGET_FILE=`${TARGET_VERSION}_${TARGET_NAME}.sql`;
export const TARGET_PATH=`supabase/migrations/${TARGET_FILE}`;
export const PREREQUISITE_VERSION="20261013214000";
export const PREREQUISITE_NAME="prospect_bounded_original_evidence_v2";
export const PREREQUISITE_PATH=`supabase/migrations/${PREREQUISITE_VERSION}_${PREREQUISITE_NAME}.sql`;
export const RECEIPT_PATH="scripts/prospect-enrichment/field-filter-release-review.json";
export const REFERENCE_PATH="scripts/prospect-enrichment/field-filter-ledger-reference.json";
export const CONFIRMATION="APPLY-PROSPECT-FIELD-FILTER-FASTPATH";
export const ARTIFACT_NAME="prospect-field-filter-preflight";
export const EVIDENCE_TTL_MS=15*60*1000;
export const EVIDENCE_FILES=Object.freeze(["source-check.json","role-check.json","ledger-check.json","catalog-check.json","plan-check.json","stage-check.json"]);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const fail=code=>{throw Error(code);};
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(value,keys)=>object(value)&&equal(Object.keys(value).sort(),[...keys].sort());
const read=file=>JSON.parse(fs.readFileSync(file,"utf8"));
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+"\n",{flag:"wx"});
const rows=value=>Array.isArray(value)?value:Array.isArray(value?.data)?value.data:Array.isArray(value?.rows)?value.rows:fail("field_filter_query_shape_invalid");
const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>equal(stable(a),stable(b));

export function verifyReference(reference,prerequisiteBytes){
 if(!exact(reference,["schemaVersion","projectRef","baseline","prerequisite"])||reference.schemaVersion!=="prospect-field-filter-ledger-reference/v1"||reference.projectRef!==PROJECT_REF||!Array.isArray(reference.baseline)||reference.baseline.length!==273)fail("field_filter_reference_invalid");
 let previous="";
 for(const row of reference.baseline){if(!exact(row,["version","name","statement_count","statements_sha256"])||!/^\d{8}(?:\d{6})?$/.test(row.version)||row.version<=previous||row.version>=PREREQUISITE_VERSION||!/^[a-zA-Z0-9_]+$/.test(row.name)||!Number.isSafeInteger(row.statement_count)||row.statement_count<0||!/^[a-f0-9]{64}$/.test(row.statements_sha256))fail("field_filter_reference_row_invalid");previous=row.version;}
 const p=reference.prerequisite;
 if(!exact(p,["version","name","path","sha256","bytes"])||p.version!==PREREQUISITE_VERSION||p.name!==PREREQUISITE_NAME||p.path!==PREREQUISITE_PATH||!Buffer.isBuffer(prerequisiteBytes)||p.bytes!==prerequisiteBytes.length||p.sha256!==sha256(prerequisiteBytes))fail("field_filter_prerequisite_source_invalid");
 for(const [version,name] of [["20261013173327","agency_followup_journeys"],["20261013174258","harden_agency_followup_events_privileges"]])if(reference.baseline.find(row=>row.version===version)?.name!==name)fail("field_filter_agency_history_missing");
 return reference;
}
export function verifyReceipt(receipt,migrationBytes,prerequisiteBytes,referenceBytes){
 if(!exact(receipt,["schemaVersion","projectRef","cliVersion","reviewOnly","approvalGranted","catalogEvidence","migration","prerequisite","ledgerReferenceSha256","catalogPre","catalogPost"])||receipt.schemaVersion!=="prospect-field-filter-release/v1"||receipt.projectRef!==PROJECT_REF||receipt.cliVersion!==CLI_VERSION||receipt.reviewOnly!==true||receipt.approvalGranted!==false||receipt.catalogEvidence!=="source-derived; protected preflight must verify the live production catalog")fail("field_filter_receipt_invalid");
 for(const [item,bytes,version,name,file] of [[receipt.migration,migrationBytes,TARGET_VERSION,TARGET_NAME,TARGET_PATH],[receipt.prerequisite,prerequisiteBytes,PREREQUISITE_VERSION,PREREQUISITE_NAME,PREREQUISITE_PATH]])if(!exact(item,["path","version","name","sha256","bytes"])||item.path!==file||item.version!==version||item.name!==name||!Buffer.isBuffer(bytes)||item.bytes!==bytes.length||item.sha256!==sha256(bytes))fail("field_filter_receipt_source_invalid");
 if(!Buffer.isBuffer(referenceBytes)||receipt.ledgerReferenceSha256!==sha256(referenceBytes)||!exact(receipt.catalogPre,["functions"])||!exact(receipt.catalogPost,["functions"])||receipt.catalogPre.functions.length!==1||receipt.catalogPost.functions.length!==2)fail("field_filter_receipt_catalog_or_reference_invalid");
 verifyReference(JSON.parse(referenceBytes.toString("utf8")),prerequisiteBytes);
 return {migration:receipt.migration,prerequisite:receipt.prerequisite,ledgerReferenceSha256:receipt.ledgerReferenceSha256,productionApplicationApproved:false};
}
export function verifySource({environment:env,checkoutSha,mainSha,receiptSha256}){
 verifyExecutionGate({event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,repository:env.GITHUB_REPOSITORY,operation:"apply",reviewedSourceSha:env.REVIEWED_SOURCE_SHA,configuredReviewedSha:env.CONFIGURED_REVIEWED_SHA,checkoutSha,githubSha:env.GITHUB_SHA,environment:env,projectEnvFiles:findProjectEnvFiles(),authorizationOnly:true});
 if(env.PROJECT_REF!==PROJECT_REF||env.GITHUB_RUN_ATTEMPT!=="1"||!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID??"")||env.USE_TEMPORARY_DATABASE_CREDENTIAL!=="true"||env.CREDENTIAL_GATE!=="field-filter-release"||env.FIELD_FILTER_CONFIRMATION!==CONFIRMATION||checkoutSha!==mainSha||!/^[a-f0-9]{64}$/.test(receiptSha256)||env.REVIEWED_RECEIPT_SHA256!==receiptSha256||env.CONFIGURED_RECEIPT_SHA256!==receiptSha256)fail("field_filter_source_or_confirmation_invalid");
 return {runId:env.GITHUB_RUN_ID,runAttempt:"1",sourceSha:checkoutSha,projectRef:PROJECT_REF,receiptSha256};
}
export function verifyLedger(input,reference,phase,migrationBytes,prerequisiteBytes){
 verifyReference(reference,prerequisiteBytes);
 if(!["pre","post"].includes(phase)||!Array.isArray(input)||input.length!==reference.baseline.length+1+(phase==="post"?1:0))fail("field_filter_ledger_count_invalid");
 const historical=input.filter(row=>row.version!==TARGET_VERSION);
 if(historical.length!==reference.baseline.length+1)fail("field_filter_ledger_history_invalid");
 historical.slice(0,reference.baseline.length).forEach((row,index)=>{if(!exact(row,["version","name","statement_count","statements_sha256","statements"])||row.statements!==null||!same({...row,statements:undefined},reference.baseline[index]))fail("field_filter_ledger_history_changed");});
 const prerequisite=historical[reference.baseline.length];
 if(!exact(prerequisite,["version","name","statement_count","statements_sha256","statements"])||prerequisite.version!==PREREQUISITE_VERSION||prerequisite.name!==PREREQUISITE_NAME||prerequisite.statement_count!==prerequisite.statements?.length||!/^[a-f0-9]{64}$/.test(prerequisite.statements_sha256))fail("field_filter_prerequisite_ledger_invalid");
 const prerequisiteProof=verifyLedgerStatements(prerequisiteBytes,prerequisite.statements);
 if(prerequisiteProof.statementCount!==prerequisite.statement_count)fail("field_filter_prerequisite_ledger_source_mismatch");
 const target=input.filter(row=>row.version===TARGET_VERSION);let targetProof=null;
 if(phase==="post"){const row=target[0];if(target.length!==1||!exact(row,["version","name","statement_count","statements_sha256","statements"])||row.name!==TARGET_NAME||row.statement_count!==row.statements?.length||!/^[a-f0-9]{64}$/.test(row.statements_sha256))fail("field_filter_target_ledger_invalid");targetProof=verifyLedgerStatements(migrationBytes,row.statements);if(targetProof.statementCount!==row.statement_count)fail("field_filter_target_ledger_source_mismatch");}
 else if(target.length)fail("field_filter_target_replay_prohibited");
 return {phase,historicalRowsUnchanged:reference.baseline.length,prerequisiteVersion:PREREQUISITE_VERSION,prerequisiteProof,addedVersions:phase==="post"?[TARGET_VERSION]:[],targetProof};
}
export function verifyPlan(plan,phase){if(!["pre","post"].includes(phase)||!exact(plan,["dryRun","upToDate","migrations","seeds","roles","message"])||plan.message!==(phase==="pre"?"Finished supabase db push.":"Remote database is up to date.")||plan.dryRun!==true||plan.upToDate!==(phase==="post")||!equal(plan.migrations,phase==="pre"?[TARGET_FILE]:[])||!equal(plan.seeds,[])||!equal(plan.roles,[]))fail("field_filter_exact_singleton_plan_required");return plan;}
export function verifyRole(input){if(!Array.isArray(input)||input.length!==1||!exact(input[0],["effective_postgres"])||input[0].effective_postgres!==true)fail("field_filter_effective_postgres_required");return {effectivePostgres:true};}
export function verifyCatalog(catalog,receipt,phase){if(!["pre","post"].includes(phase)||!same(catalog,phase==="pre"?receipt.catalogPre:receipt.catalogPost))fail("field_filter_catalog_or_acl_changed");return {phase,functionsVerified:catalog.functions.length,hash:sha256(JSON.stringify(stable(catalog)))};}
export function guardedReference(row){return `-- Applied ledger reference only; historical source SQL is never replayed.\n-- ${row.version} ${row.name} statements-sha256 ${row.statements_sha256}\nDO $history_reference$ BEGIN RAISE EXCEPTION 'field_filter_history_reference_execution_prohibited'; END $history_reference$;\n`;}
export function stage(reference,ledgerRows,migrationBytes,destination,prerequisiteBytes){
 verifyReference(reference,prerequisiteBytes);verifyLedger(ledgerRows,reference,"pre",migrationBytes,prerequisiteBytes);if(fs.existsSync(destination))fail("field_filter_stage_not_fresh");
 const expected=ledgerRows.filter(row=>row.version!==TARGET_VERSION);if(expected.length!==reference.baseline.length+1)fail("field_filter_stage_ledger_invalid");
 fs.mkdirSync(path.join(destination,"supabase","migrations"),{recursive:true});fs.writeFileSync(path.join(destination,"supabase","config.toml"),'project_id = "prospect-field-filter-reviewed-release"\n',{flag:"wx"});
 for(const row of expected)fs.writeFileSync(path.join(destination,"supabase","migrations",`${row.version}_${row.name}.sql`),guardedReference(row),{flag:"wx"});
 fs.writeFileSync(path.join(destination,"supabase","migrations",TARGET_FILE),migrationBytes,{flag:"wx"});
 return verifyStage(reference,expected,migrationBytes,destination,prerequisiteBytes);
}
export function verifyStage(reference,ledgerRows,migrationBytes,destination,prerequisiteBytes){
 verifyReference(reference,prerequisiteBytes);verifyLedger(ledgerRows,reference,ledgerRows.some(row=>row.version===TARGET_VERSION)?"post":"pre",migrationBytes,prerequisiteBytes);const dir=path.join(destination,"supabase","migrations");
 for(const part of [destination,path.join(destination,"supabase"),dir])if(!fs.lstatSync(part).isDirectory()||fs.lstatSync(part).isSymbolicLink())fail("field_filter_stage_directory_invalid");
 if(!equal(fs.readdirSync(destination).sort(),["supabase"])||!equal(fs.readdirSync(path.join(destination,"supabase")).sort(),["config.toml","migrations"]))fail("field_filter_stage_extras_prohibited");
 const expectedRows=ledgerRows.filter(row=>row.version!==TARGET_VERSION);if(expectedRows.length!==reference.baseline.length+1)fail("field_filter_stage_ledger_invalid");
 const files=expectedRows.map(row=>`${row.version}_${row.name}.sql`).concat(TARGET_FILE).sort();if(!equal(fs.readdirSync(dir).sort(),files))fail("field_filter_stage_migrations_invalid");
 const config=path.join(destination,"supabase","config.toml");if(!fs.lstatSync(config).isFile()||fs.lstatSync(config).isSymbolicLink()||fs.readFileSync(config,"utf8")!=='project_id = "prospect-field-filter-reviewed-release"\n')fail("field_filter_stage_config_invalid");
 for(const row of expectedRows){const file=path.join(dir,`${row.version}_${row.name}.sql`),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.readFileSync(file,"utf8")!==guardedReference(row))fail("field_filter_stage_history_changed");}
 const target=path.join(dir,TARGET_FILE),targetStat=fs.lstatSync(target);if(!targetStat.isFile()||targetStat.isSymbolicLink()||!fs.readFileSync(target).equals(migrationBytes))fail("field_filter_stage_target_changed");
 return {referenceFiles:expectedRows.length,target:TARGET_FILE,unrelatedFiles:0,prerequisiteVersion:PREREQUISITE_VERSION};
}
function extractBody(source,marker){const sql=source.toString("utf8").replace(/\r\n/g,"\n"),start=sql.indexOf(marker);if(start<0||sql.indexOf(marker,start+marker.length)>=0)fail("field_filter_catalog_source_invalid");const bodyStart=sql.indexOf("AS $$",start),bodyEnd=sql.indexOf("$$;",bodyStart+5);if(bodyStart<0||bodyEnd<0)fail("field_filter_catalog_source_invalid");return sql.slice(bodyStart+5,bodyEnd);}
export function catalogQuery(){return `SELECT jsonb_build_object('functions',coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,'owner',r.rolname,'security_definer',p.prosecdef,'settings',p.proconfig,'acl',p.proacl::text,'body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY n.nspname,p.proname),'[]'::jsonb)) AS catalog FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE (n.nspname='public' AND p.proname='list_prospect_research_candidates_v1') OR (n.nspname='prospect_candidate_private' AND p.proname='list_candidates_for_indexed_field');\n`;}
export function sourceCatalog(receipt,phase,migrationBytes,priorReaderBytes){
 const publicSource=phase==="pre"?priorReaderBytes:migrationBytes;
 const wrapperBody=extractBody(publicSource,"CREATE OR REPLACE FUNCTION public.list_prospect_research_candidates_v1(");
 const functions=[];
 if(phase==="post"){const privateBody=extractBody(migrationBytes,"CREATE OR REPLACE FUNCTION prospect_candidate_private.list_candidates_for_indexed_field(");functions.push({schema:"prospect_candidate_private",name:"list_candidates_for_indexed_field",signature:"prospect_candidate_private.list_candidates_for_indexed_field(jsonb,integer,uuid,bigint)",owner:"postgres",security_definer:true,settings:['search_path=""'],acl:"{postgres=X/postgres,service_role=X/postgres}",body_sha256:sha256(Buffer.from(privateBody))});}
 functions.push({schema:"public",name:"list_prospect_research_candidates_v1",signature:"list_prospect_research_candidates_v1(jsonb,integer,uuid,bigint)",owner:"postgres",security_definer:false,settings:['search_path=""'],acl:"{postgres=X/postgres,service_role=X/postgres}",body_sha256:sha256(Buffer.from(wrapperBody))});
 return {functions};
}
function fileHashes(files){if(!exact(files,EVIDENCE_FILES))fail("field_filter_evidence_files_invalid");return Object.fromEntries(EVIDENCE_FILES.map(name=>{if(!Buffer.isBuffer(files[name])||!files[name].length)fail("field_filter_evidence_bytes_invalid");return [name,sha256(files[name])];}));}
export function createEvidence(binding,files,now=Date.now()){return {schemaVersion:"prospect-field-filter-preflight/v1",binding,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+EVIDENCE_TTL_MS).toISOString(),files:fileHashes(files)};}
export function verifyEvidence(evidence,binding,files,now=Date.now()){
 if(!exact(evidence,["schemaVersion","binding","createdAt","expiresAt","files"])||evidence.schemaVersion!=="prospect-field-filter-preflight/v1"||!same(evidence.binding,binding))fail("field_filter_evidence_binding_invalid");
 const created=Date.parse(evidence.createdAt),expires=Date.parse(evidence.expiresAt);if(!Number.isFinite(created)||created>now||expires<=now||expires-created!==EVIDENCE_TTL_MS||!same(evidence.files,fileHashes(files)))fail("field_filter_evidence_expired_or_changed");
 if(!same(JSON.parse(files["source-check.json"]),binding)||!same(JSON.parse(files["role-check.json"]),{effectivePostgres:true}))fail("field_filter_evidence_source_or_role_invalid");
 const plan=JSON.parse(files["plan-check.json"]),ledger=JSON.parse(files["ledger-check.json"]);verifyPlan(plan,"pre");if(ledger.phase!=="pre"||ledger.historicalRowsUnchanged!==273||ledger.prerequisiteVersion!==PREREQUISITE_VERSION||!equal(ledger.addedVersions,[])||ledger.targetProof!==null)fail("field_filter_evidence_preflight_invalid");return {verified:true,binding};
}
export function verifyArtifact(metadata,env){if(!/^[1-9][0-9]*$/.test(env.EXPECTED_ARTIFACT_ID??"")||!/^[a-f0-9]{64}$/.test(env.EXPECTED_ARTIFACT_DIGEST??"")||String(metadata.id)!==env.EXPECTED_ARTIFACT_ID||metadata.name!==ARTIFACT_NAME||metadata.expired!==false||metadata.digest!=="sha256:"+env.EXPECTED_ARTIFACT_DIGEST||String(metadata.workflow_run?.id)!==env.GITHUB_RUN_ID||metadata.workflow_run?.head_sha!==env.REVIEWED_SOURCE_SHA)fail("field_filter_artifact_identity_mismatch");return true;}
export function executeOnce({verify,write,readback,persist}){verify();let writeError=null,readbackError=null,result;try{write();}catch{writeError="field_filter_write_failed";}try{result=readback();}catch{readbackError="field_filter_readback_failed";}persist({writeError,readbackError,result:result??null,automaticRetry:false});if(writeError||readbackError)fail(writeError??readbackError);return result;}
function command(executable,args,cwd=ROOT){try{return execFileSync(executable,args,{cwd,stdio:["ignore","pipe","pipe"],timeout:180000,maxBuffer:32*1024*1024});}catch{fail("field_filter_command_failed");}}
function source(){const checkoutSha=command("git",["rev-parse","HEAD"]).toString().trim();command("git",["fetch","--no-tags","origin","main"]);const receiptBytes=fs.readFileSync(path.join(ROOT,RECEIPT_PATH)),migrationBytes=command("git",["show","HEAD:"+TARGET_PATH]),prerequisiteBytes=command("git",["show","HEAD:"+PREREQUISITE_PATH]),referenceBytes=fs.readFileSync(path.join(ROOT,REFERENCE_PATH)),priorReaderBytes=command("git",["show","HEAD:supabase/migrations/20261006003626_prospect_candidate_scoped_reader_fastpaths.sql"]),receipt=JSON.parse(receiptBytes.toString("utf8"));
 for(const [file,bytes]of[[TARGET_PATH,migrationBytes],[PREREQUISITE_PATH,prerequisiteBytes],[RECEIPT_PATH,command("git",["show","HEAD:"+RECEIPT_PATH])],[REFERENCE_PATH,command("git",["show","HEAD:"+REFERENCE_PATH])]])if(!fs.readFileSync(path.join(ROOT,file)).equals(bytes))fail("field_filter_worktree_source_changed");
 verifyReceipt(receipt,migrationBytes,prerequisiteBytes,referenceBytes);const binding=verifySource({environment:process.env,checkoutSha,mainSha:command("git",["rev-parse","origin/main"]).toString().trim(),receiptSha256:sha256(receiptBytes)});if(!same(receipt.catalogPre,sourceCatalog(receipt,"pre",migrationBytes,priorReaderBytes))||!same(receipt.catalogPost,sourceCatalog(receipt,"post",migrationBytes,priorReaderBytes)))fail("field_filter_catalog_source_binding_invalid");return{receipt,reference:JSON.parse(referenceBytes.toString("utf8")),migrationBytes,prerequisiteBytes,priorReaderBytes,binding};}
function releaseDir(){if(!process.env.RUNNER_TEMP)fail("field_filter_runner_directory_required");const dir=path.join(path.resolve(process.env.RUNNER_TEMP),"field-filter-release");if(fs.existsSync(dir))fail("field_filter_run_directory_not_fresh");fs.mkdirSync(dir,{recursive:true});return dir;}
function database(args,cwd=ROOT,write=false){return runDatabaseOperation({environment:process.env,args,write,execute:safeArgs=>command("supabase",[...safeArgs,"--db-url",process.env.MIGRATION_DATABASE_URL],cwd)});}
function query(sql,file){fs.writeFileSync(file+".sql",sql,{flag:"wx"});const bytes=database(["db","query","--file",file+".sql","--output-format","json","--agent","no"]);fs.writeFileSync(file,bytes,{flag:"wx"});return rows(JSON.parse(bytes.toString("utf8")));}
function ledgerQuery(){return "SELECT version,name,coalesce(cardinality(statements),0) AS statement_count,encode(sha256(convert_to(coalesce(to_jsonb(statements),'null'::jsonb)::text,'UTF8')),'hex') AS statements_sha256,CASE WHEN version IN ('"+PREREQUISITE_VERSION+"','"+TARGET_VERSION+"') THEN statements ELSE NULL END AS statements FROM supabase_migrations.schema_migrations ORDER BY version;\n";}
function dryRun(staged){return JSON.parse(database(["db","push","--dry-run","--include-all","--skip-vault","--output-format","json"],staged).toString("utf8"));}
function preflight(ctx,dir){
 if(command("supabase",["--version"]).toString().trim()!==CLI_VERSION)fail("field_filter_cli_version_invalid");
 const role=verifyRole(query("SELECT current_user='postgres' AS effective_postgres;\n",path.join(dir,"role.json")));
 const ledgerRows=query(ledgerQuery(),path.join(dir,"ledger.json")),ledger=verifyLedger(ledgerRows,ctx.reference,"pre",ctx.migrationBytes,ctx.prerequisiteBytes);
 const catalog=verifyCatalog(query(catalogQuery(),path.join(dir,"catalog.json"))[0]?.catalog,ctx.receipt,"pre");
 const staged=path.join(dir,"staged"),stageProof=stage(ctx.reference,ledgerRows,ctx.migrationBytes,staged,ctx.prerequisiteBytes);
 const plan=verifyPlan(dryRun(staged),"pre");
 for(const [name,value]of[["source-check.json",ctx.binding],["role-check.json",role],["ledger-check.json",ledger],["catalog-check.json",catalog],["plan-check.json",plan],["stage-check.json",stageProof]])save(path.join(dir,name),value);
 return{staged,ledgerRows};
}
function filesAt(dir){return Object.fromEntries(EVIDENCE_FILES.map(name=>{const file=path.join(dir,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())fail("field_filter_evidence_file_invalid");return[name,fs.readFileSync(file)];}));}
async function main([operation,...args]){
 if(operation==="artifact"&&args.length===1){verifyArtifact(read(args[0]),process.env);console.log('{"verified":true}');return;}
 if(!["source","preflight","verify-evidence","apply"].includes(operation)||args.length)fail("field_filter_usage_invalid");
 const ctx=source();if(operation==="source"){console.log(JSON.stringify(ctx.binding));return;}
 const reviewed=path.join(path.resolve(process.env.RUNNER_TEMP),"reviewed-field-filter");
 if(["verify-evidence","apply"].includes(operation))verifyEvidence(read(path.join(reviewed,"preflight-evidence.json")),ctx.binding,filesAt(reviewed));
 if(operation==="verify-evidence"){console.log('{"verified":true}');return;}
 const dir=releaseDir(),first=preflight(ctx,dir);
 if(operation==="preflight"){save(path.join(dir,"preflight-evidence.json"),createEvidence(ctx.binding,filesAt(dir)));console.log(JSON.stringify({binding:ctx.binding,databaseWrites:0,pendingMigrations:[TARGET_FILE],requiredPrerequisite:PREREQUISITE_VERSION}));return;}
 executeOnce({verify:()=>{
   source();verifyStage(ctx.reference,first.ledgerRows,ctx.migrationBytes,first.staged,ctx.prerequisiteBytes);
   verifyRole(query("SELECT current_user='postgres' AS effective_postgres;\n",path.join(dir,"immediate-role.json")));
   const ledgerRows=query(ledgerQuery(),path.join(dir,"immediate-ledger.json"));verifyLedger(ledgerRows,ctx.reference,"pre",ctx.migrationBytes,ctx.prerequisiteBytes);
   verifyCatalog(query(catalogQuery(),path.join(dir,"immediate-catalog.json"))[0]?.catalog,ctx.receipt,"pre");verifyPlan(dryRun(first.staged),"pre");
 },write:()=>{
   save(path.join(dir,"apply-started.json"),{runId:ctx.binding.runId,version:TARGET_VERSION,automaticRetry:false});
   const bytes=database(["db","push","--yes","--include-all","--skip-vault","--output-format","json"],first.staged,true);fs.writeFileSync(path.join(dir,"apply.json"),bytes,{flag:"wx"});
 },readback:()=>{
   const ledgerRows=query(ledgerQuery(),path.join(dir,"post-ledger.json")),ledger=verifyLedger(ledgerRows,ctx.reference,"post",ctx.migrationBytes,ctx.prerequisiteBytes);
   const catalog=verifyCatalog(query(catalogQuery(),path.join(dir,"post-catalog.json"))[0]?.catalog,ctx.receipt,"post"),plan=verifyPlan(dryRun(first.staged),"post");
   verifyStage(ctx.reference,ledgerRows,ctx.migrationBytes,first.staged,ctx.prerequisiteBytes);return{ledger,catalog,plan};
 },persist:value=>save(path.join(dir,"release-receipt.json"),{schemaVersion:"prospect-field-filter-release-receipt/v1",binding:ctx.binding,...value})});
 console.log('{"verified":true,"addedVersion":"20261014153626","automaticRetry":false}');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{process.stderr.write((error instanceof Error&&/^[a-z0-9_]+$/.test(error.message)?error.message:"field_filter_release_failed")+"\n");process.exitCode=1;});
