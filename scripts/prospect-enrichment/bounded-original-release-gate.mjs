// Fixed one-migration release. Historical references are guards, never historical source SQL.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROJECT_REF, CLI_VERSION, sha256, verifyExecutionGate, verifyLedgerStatements, findProjectEnvFiles } from "./migration-gate.mjs";
import { runDatabaseOperation } from "./complete-release-gate.mjs";
export const TARGET_VERSION = "20261013214000";
export const TARGET_NAME = "prospect_bounded_original_evidence_v2";
export const TARGET_FILE = TARGET_VERSION + "_" + TARGET_NAME + ".sql";
export const TARGET_PATH = "supabase/migrations/" + TARGET_FILE;
export const RECEIPT_PATH = "scripts/prospect-enrichment/bounded-original-release-review.json";
export const REFERENCE_PATH = "scripts/prospect-enrichment/bounded-original-ledger-reference.json";
export const CONFIRMATION = "APPLY-PROSPECT-BOUNDED-ORIGINAL-V2";
export const ARTIFACT_NAME = "prospect-bounded-original-preflight";
export const EVIDENCE_FILES = Object.freeze(["source-check.json","role-check.json","ledger-check.json","catalog-check.json","plan-check.json","stage-check.json"]);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fail = code => { throw Error(code); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const exact = (value, keys) => object(value) && equal(Object.keys(value).sort(), [...keys].sort());
const read = file => JSON.parse(fs.readFileSync(file,"utf8"));
const save = (file,value) => fs.writeFileSync(file,JSON.stringify(value,null,2)+"\n",{flag:"wx"});
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : Array.isArray(value?.rows) ? value.rows : fail("bounded_release_query_shape_invalid");
const stable = value => Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
const same = (a,b) => equal(stable(a),stable(b));
export function verifyReference(reference) {
  if (!exact(reference,["schemaVersion","projectRef","ledger"]) || reference.schemaVersion!=="prospect-bounded-original-ledger-reference/v1" || reference.projectRef!==PROJECT_REF || !Array.isArray(reference.ledger) || reference.ledger.length!==273) fail("bounded_release_reference_invalid");
  let previous="";
  for(const row of reference.ledger) {
    if(!exact(row,["version","name","statement_count","statements_sha256"]) || !/^\d{8}(?:\d{6})?$/.test(row.version) || row.version<=previous || row.version>=TARGET_VERSION || !/^[a-zA-Z0-9_]+$/.test(row.name) || !Number.isSafeInteger(row.statement_count) || row.statement_count<0 || !/^[a-f0-9]{64}$/.test(row.statements_sha256)) fail("bounded_release_reference_row_invalid");
    previous=row.version;
  }
  for(const [version,name] of [["20261013173327","agency_followup_journeys"],["20261013174258","harden_agency_followup_events_privileges"]]) if(reference.ledger.find(row=>row.version===version)?.name!==name) fail("bounded_release_agency_history_missing");
  return reference;
}
export function verifyReceipt(receipt, migrationBytes, referenceBytes) {
  if(!exact(receipt,["schemaVersion","projectRef","cliVersion","reviewOnly","approvalGranted","migration","ledgerReferenceSha256","catalogPre","catalogPost"]) || receipt.schemaVersion!=="prospect-bounded-original-release/v1" || receipt.projectRef!==PROJECT_REF || receipt.cliVersion!==CLI_VERSION || receipt.reviewOnly!==true || receipt.approvalGranted!==false ||
    !exact(receipt.migration,["path","version","name","sha256","bytes"]) || receipt.migration.path!==TARGET_PATH || receipt.migration.version!==TARGET_VERSION || receipt.migration.name!==TARGET_NAME || !Buffer.isBuffer(migrationBytes) || receipt.migration.bytes!==migrationBytes.length || receipt.migration.sha256!==sha256(migrationBytes) || !/^[a-f0-9]{64}$/.test(receipt.migration.sha256) || !Buffer.isBuffer(referenceBytes) || receipt.ledgerReferenceSha256!==sha256(referenceBytes)) fail("bounded_release_receipt_invalid");
  verifyReference(JSON.parse(referenceBytes.toString("utf8")));
  if(!exact(receipt.catalogPre,["functions","constraint"]) || receipt.catalogPre.functions.length!==2 || !exact(receipt.catalogPost,["functions","constraint"]) || receipt.catalogPost.functions.length!==8) fail("bounded_release_receipt_catalog_invalid");
  return {migration:receipt.migration,ledgerReferenceSha256:receipt.ledgerReferenceSha256,productionApplicationApproved:false};
}
export function verifySource({environment:env,checkoutSha,mainSha,receiptSha256}) {
  verifyExecutionGate({event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,repository:env.GITHUB_REPOSITORY,operation:"apply",reviewedSourceSha:env.REVIEWED_SOURCE_SHA,configuredReviewedSha:env.CONFIGURED_REVIEWED_SHA,checkoutSha,githubSha:env.GITHUB_SHA,environment:env,projectEnvFiles:findProjectEnvFiles(),authorizationOnly:true});
  if(env.PROJECT_REF!==PROJECT_REF || env.GITHUB_RUN_ATTEMPT!=="1" || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID??"") || env.USE_TEMPORARY_DATABASE_CREDENTIAL!=="true" || env.CREDENTIAL_GATE!=="bounded-original-release" || env.BOUNDED_ORIGINAL_CONFIRMATION!==CONFIRMATION || checkoutSha!==mainSha || !/^[a-f0-9]{64}$/.test(receiptSha256) || env.REVIEWED_RECEIPT_SHA256!==receiptSha256 || env.CONFIGURED_RECEIPT_SHA256!==receiptSha256) fail("bounded_release_source_or_confirmation_invalid");
  return {runId:env.GITHUB_RUN_ID,runAttempt:"1",sourceSha:checkoutSha,projectRef:PROJECT_REF,receiptSha256};
}
export function verifyLedger(input,reference,phase,migrationBytes) {
  verifyReference(reference);
  if(!["pre","post"].includes(phase) || !Array.isArray(input) || input.length!==reference.ledger.length+(phase==="post"?1:0)) fail("bounded_release_ledger_count_invalid");
  const historical=input.filter(row=>row.version!==TARGET_VERSION);
  if(historical.length!==reference.ledger.length) fail("bounded_release_ledger_history_invalid");
  historical.forEach((row,index)=>{
    if(!exact(row,["version","name","statement_count","statements_sha256","statements"]) || row.statements!==null || !same({...row,statements:undefined},reference.ledger[index])) fail("bounded_release_ledger_history_changed");
  });
  const target=input.filter(row=>row.version===TARGET_VERSION);
  let targetProof=null;
  if(phase==="post") {
    const row=target[0];
    if(target.length!==1 || !exact(row,["version","name","statement_count","statements_sha256","statements"]) || row.name!==TARGET_NAME || row.statement_count!==row.statements?.length || !/^[a-f0-9]{64}$/.test(row.statements_sha256)) fail("bounded_release_target_ledger_invalid");
    targetProof=verifyLedgerStatements(migrationBytes,row.statements);
  } else if(target.length) fail("bounded_release_target_replay_prohibited");
  return {phase,historicalRowsUnchanged:historical.length,addedVersions:phase==="post"?[TARGET_VERSION]:[],targetProof};
}
export function verifyPlan(plan,phase) {
  if(!["pre","post"].includes(phase) || !exact(plan,["dryRun","upToDate","migrations","seeds","roles","message"]) || !(phase==="pre" ? plan.message==="Finished supabase db push." : plan.message==="Remote database is up to date.") || plan.dryRun!==true || plan.upToDate!==(phase==="post") || !equal(plan.migrations,phase==="pre"?[TARGET_FILE]:[]) || !equal(plan.seeds,[]) || !equal(plan.roles,[])) fail("bounded_release_exact_singleton_plan_required");
  return plan;
}
export function verifyRole(input) {
  if(!Array.isArray(input) || input.length!==1 || !exact(input[0],["effective_postgres"]) || input[0].effective_postgres!==true) fail("bounded_release_effective_postgres_required");
  return {effectivePostgres:true};
}
export function verifyCatalog(catalog,receipt,phase) {
  if(!["pre","post"].includes(phase) || !same(catalog,phase==="pre"?receipt.catalogPre:receipt.catalogPost)) fail("bounded_release_catalog_changed");
  return {phase,functionsVerified:catalog.functions.length,hash:sha256(JSON.stringify(stable(catalog)))};
}
export function guardedReference(row) {
  return "-- Applied ledger reference only; not a reconstruction of historical source SQL.\n-- "+row.version+" "+row.name+" statements-sha256 "+row.statements_sha256+"\nDO $history_reference$ BEGIN RAISE EXCEPTION 'bounded_release_history_reference_execution_prohibited'; END $history_reference$;\n";
}
export function stage(reference,migrationBytes,destination) {
  verifyReference(reference);
  if(fs.existsSync(destination)) fail("bounded_release_stage_not_fresh");
  fs.mkdirSync(path.join(destination,"supabase","migrations"),{recursive:true});
  fs.writeFileSync(path.join(destination,"supabase","config.toml"),'project_id = "prospect-bounded-original-reviewed-release"\n',{flag:"wx"});
  for(const row of reference.ledger) fs.writeFileSync(path.join(destination,"supabase","migrations",row.version+"_"+row.name+".sql"),guardedReference(row),{flag:"wx"});
  fs.writeFileSync(path.join(destination,"supabase","migrations",TARGET_FILE),migrationBytes,{flag:"wx"});
  return verifyStage(reference,migrationBytes,destination);
}
export function verifyStage(reference,migrationBytes,destination) {
  verifyReference(reference);
  const dir=path.join(destination,"supabase","migrations");
  for(const part of [destination,path.join(destination,"supabase"),dir]) if(!fs.lstatSync(part).isDirectory() || fs.lstatSync(part).isSymbolicLink()) fail("bounded_release_stage_directory_invalid");
  if(!equal(fs.readdirSync(destination).sort(),["supabase"]) || !equal(fs.readdirSync(path.join(destination,"supabase")).sort(),["config.toml","migrations"])) fail("bounded_release_stage_extras_prohibited");
  const config=path.join(destination,"supabase","config.toml");
  if(!fs.lstatSync(config).isFile() || fs.lstatSync(config).isSymbolicLink() || fs.readFileSync(config,"utf8")!=='project_id = "prospect-bounded-original-reviewed-release"\n') fail("bounded_release_stage_config_changed");
  const expected=new Map(reference.ledger.map(row=>[row.version+"_"+row.name+".sql",Buffer.from(guardedReference(row))]));
  expected.set(TARGET_FILE,migrationBytes);
  if(!equal(fs.readdirSync(dir).sort(),[...expected.keys()].sort())) fail("bounded_release_stage_inventory_changed");
  for(const [name,bytes] of expected) {
    const file=path.join(dir,name),stat=fs.lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink() || !fs.readFileSync(file).equals(bytes)) fail("bounded_release_stage_bytes_changed");
  }
  return {referenceFiles:reference.ledger.length,executablePendingFiles:[TARGET_FILE],migrationSha256:sha256(migrationBytes),guardReferencesRaiseOnExecution:true};
}
export function ledgerQuery() { return "SELECT version,name,coalesce(cardinality(statements),0) AS statement_count,encode(sha256(convert_to(coalesce(to_jsonb(statements),'null'::jsonb)::text,'UTF8')),'hex') AS statements_sha256,CASE WHEN version='"+TARGET_VERSION+"' THEN statements ELSE NULL END AS statements FROM supabase_migrations.schema_migrations ORDER BY version;\n"; }
export function catalogQuery() { return `SELECT jsonb_build_object('functions',coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,'owner',r.rolname,'security_definer',p.prosecdef,'settings',p.proconfig,'acl',p.proacl::text,'body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY n.nspname,p.proname),'[]'::jsonb),'constraint',(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.prospect_enrichment_packages'::regclass AND conname='prospect_enrichment_packages_schema_version_check')) AS catalog FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE (n.nspname='public' AND p.proname='stage_prospect_enrichment_package_v1') OR (n.nspname='prospect_candidate_private' AND p.proname IN ('record_history','utf16_sort_key_v2','transport_stable_json_v2','transport_hash_v2','package_stable_json_v1','decode_original_nodes_v1','logical_enrichment_payload_v1'));\n`; }
function fileHashes(files) {
  if(!exact(files,EVIDENCE_FILES)) fail("bounded_release_evidence_files_invalid");
  return Object.fromEntries(EVIDENCE_FILES.map(name=>{
    if(!Buffer.isBuffer(files[name]) || !files[name].length) fail("bounded_release_evidence_bytes_invalid");
    return [name,sha256(files[name])];
  }));
}
export function createEvidence(binding,files,now=Date.now()) {
  return {schemaVersion:"prospect-bounded-original-preflight/v1",binding,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),files:fileHashes(files)};
}
export function verifyEvidence(evidence,binding,files,now=Date.now()) {
  if(!exact(evidence,["schemaVersion","binding","createdAt","expiresAt","files"]) || evidence.schemaVersion!=="prospect-bounded-original-preflight/v1" || !same(evidence.binding,binding)) fail("bounded_release_evidence_binding_invalid");
  const created=Date.parse(evidence.createdAt),expires=Date.parse(evidence.expiresAt);
  if(!Number.isFinite(created) || created>now || expires<=now || expires-created!==86400000 || !same(evidence.files,fileHashes(files))) fail("bounded_release_evidence_expired_or_changed");
  if(!same(JSON.parse(files["source-check.json"]),binding) || !same(JSON.parse(files["role-check.json"]),{effectivePostgres:true})) fail("bounded_release_evidence_source_or_role_invalid");
  const plan=JSON.parse(files["plan-check.json"]),ledger=JSON.parse(files["ledger-check.json"]);
  verifyPlan(plan,"pre");
  if(ledger.phase!=="pre" || ledger.historicalRowsUnchanged!==273 || !equal(ledger.addedVersions,[]) || ledger.targetProof!==null) fail("bounded_release_evidence_preflight_invalid");
  return {verified:true,binding};
}
export function verifyArtifact(metadata,env) {
  if(!/^[1-9][0-9]*$/.test(env.EXPECTED_ARTIFACT_ID??"") || !/^[a-f0-9]{64}$/.test(env.EXPECTED_ARTIFACT_DIGEST??"") || String(metadata.id)!==env.EXPECTED_ARTIFACT_ID || metadata.name!==ARTIFACT_NAME || metadata.expired!==false || metadata.digest!=="sha256:"+env.EXPECTED_ARTIFACT_DIGEST || String(metadata.workflow_run?.id)!==env.GITHUB_RUN_ID || metadata.workflow_run?.head_sha!==env.REVIEWED_SOURCE_SHA) fail("bounded_release_artifact_identity_mismatch");
  return true;
}
export function executeOnce({verify,write,readback,persist}) {
  verify();
  let writeError=null,readbackError=null,result;
  try { write(); } catch { writeError="bounded_release_write_failed"; }
  try { result=readback(); } catch { readbackError="bounded_release_readback_failed"; }
  persist({writeError,readbackError,result:result??null,automaticRetry:false});
  if(writeError || readbackError) fail(writeError??readbackError);
  return result;
}
function command(executable,args,cwd=ROOT) {
  try { return execFileSync(executable,args,{cwd,stdio:["ignore","pipe","pipe"],timeout:180000,maxBuffer:32*1024*1024}); }
  catch { fail("bounded_release_command_failed"); }
}
function source() {
  const checkoutSha=command("git",["rev-parse","HEAD"]).toString().trim();
  command("git",["fetch","--no-tags","origin","main"]);
  const receiptBytes=fs.readFileSync(path.join(ROOT,RECEIPT_PATH)),migrationBytes=command("git",["show","HEAD:"+TARGET_PATH]);
  const referenceBytes=fs.readFileSync(path.join(ROOT,REFERENCE_PATH)),receipt=JSON.parse(receiptBytes.toString("utf8"));
  if(!fs.readFileSync(path.join(ROOT,TARGET_PATH)).equals(migrationBytes)) fail("bounded_release_worktree_migration_changed");
  for(const file of [RECEIPT_PATH,REFERENCE_PATH]) if(!fs.readFileSync(path.join(ROOT,file)).equals(command("git",["show","HEAD:"+file]))) fail("bounded_release_worktree_receipt_changed");
  verifyReceipt(receipt,migrationBytes,referenceBytes);
  const binding=verifySource({environment:process.env,checkoutSha,mainSha:command("git",["rev-parse","origin/main"]).toString().trim(),receiptSha256:sha256(receiptBytes)});
  return {receipt,reference:JSON.parse(referenceBytes.toString("utf8")),migrationBytes,binding};
}
function releaseDir() {
  if(!process.env.RUNNER_TEMP) fail("bounded_release_runner_directory_required");
  const dir=path.join(path.resolve(process.env.RUNNER_TEMP),"bounded-original-release");
  if(fs.existsSync(dir)) fail("bounded_release_run_directory_not_fresh");
  fs.mkdirSync(dir,{recursive:true}); return dir;
}
function database(args,cwd=ROOT,write=false) {
  return runDatabaseOperation({environment:process.env,args,write,execute:safeArgs=>command("supabase",[...safeArgs,"--db-url",process.env.MIGRATION_DATABASE_URL],cwd)});
}
function query(sql,file) {
  fs.writeFileSync(file+".sql",sql,{flag:"wx"});
  const bytes=database(["db","query","--file",file+".sql","--output-format","json","--agent","no"]);
  fs.writeFileSync(file,bytes,{flag:"wx"}); return rows(JSON.parse(bytes.toString("utf8")));
}
function dryRun(staged) { return JSON.parse(database(["db","push","--dry-run","--include-all","--skip-vault","--output-format","json"],staged).toString("utf8")); }
function preflight(ctx,dir) {
  if(command("supabase",["--version"]).toString().trim()!==CLI_VERSION) fail("bounded_release_cli_version_invalid");
  const role=verifyRole(query("SELECT current_user='postgres' AS effective_postgres;\n",path.join(dir,"role.json")));
  const staged=path.join(dir,"staged");
  const ledger=verifyLedger(query(ledgerQuery(),path.join(dir,"ledger.json")),ctx.reference,"pre",ctx.migrationBytes);
  const catalog=verifyCatalog(query(catalogQuery(),path.join(dir,"catalog.json"))[0]?.catalog,ctx.receipt,"pre");
  stage(ctx.reference,ctx.migrationBytes,staged);
  const plan=verifyPlan(dryRun(staged),"pre");
  const stageProof=verifyStage(ctx.reference,ctx.migrationBytes,staged);
  for(const [name,value] of [["source-check.json",ctx.binding],["role-check.json",role],["ledger-check.json",ledger],["catalog-check.json",catalog],["plan-check.json",plan],["stage-check.json",stageProof]]) save(path.join(dir,name),value);
  return staged;
}
function filesAt(dir) {
  return Object.fromEntries(EVIDENCE_FILES.map(name=>{
    const file=path.join(dir,name),stat=fs.lstatSync(file);
    if(!stat.isFile() || stat.isSymbolicLink()) fail("bounded_release_evidence_file_invalid");
    return [name,fs.readFileSync(file)];
  }));
}
async function main([operation,...args]) {
  if(operation==="artifact" && args.length===1) { verifyArtifact(read(args[0]),process.env); console.log('{"verified":true}'); return; }
  if(!["source","preflight","verify-evidence","apply"].includes(operation) || args.length) fail("bounded_release_usage_invalid");
  const ctx=source();
  if(operation==="source") { console.log(JSON.stringify(ctx.binding)); return; }
  const reviewed=path.join(path.resolve(process.env.RUNNER_TEMP),"reviewed-bounded-original");
  if(["verify-evidence","apply"].includes(operation)) verifyEvidence(read(path.join(reviewed,"preflight-evidence.json")),ctx.binding,filesAt(reviewed));
  if(operation==="verify-evidence") { console.log('{"verified":true}'); return; }
  const dir=releaseDir(),staged=preflight(ctx,dir);
  if(operation==="preflight") {
    save(path.join(dir,"preflight-evidence.json"),createEvidence(ctx.binding,filesAt(dir)));
    console.log(JSON.stringify({binding:ctx.binding,databaseWrites:0,pendingMigrations:[TARGET_FILE]})); return;
  }
  executeOnce({verify:()=>{
    source(); verifyStage(ctx.reference,ctx.migrationBytes,staged);
    verifyRole(query("SELECT current_user='postgres' AS effective_postgres;\n",path.join(dir,"immediate-role.json")));
    verifyLedger(query(ledgerQuery(),path.join(dir,"immediate-ledger.json")),ctx.reference,"pre",ctx.migrationBytes);
    verifyCatalog(query(catalogQuery(),path.join(dir,"immediate-catalog.json"))[0]?.catalog,ctx.receipt,"pre");
    verifyPlan(dryRun(staged),"pre");
  },write:()=>{ save(path.join(dir,"apply-started.json"),{runId:ctx.binding.runId,version:TARGET_VERSION,automaticRetry:false});
    const bytes=database(["db","push","--yes","--include-all","--skip-vault","--output-format","json"],staged,true);
    fs.writeFileSync(path.join(dir,"apply.json"),bytes,{flag:"wx"});
  },readback:()=>{
    const ledger=verifyLedger(query(ledgerQuery(),path.join(dir,"post-ledger.json")),ctx.reference,"post",ctx.migrationBytes);
    const catalog=verifyCatalog(query(catalogQuery(),path.join(dir,"post-catalog.json"))[0]?.catalog,ctx.receipt,"post");
    const plan=verifyPlan(dryRun(staged),"post"); verifyStage(ctx.reference,ctx.migrationBytes,staged);
    return {ledger,catalog,plan};
  },persist:value=>save(path.join(dir,"release-receipt.json"),{schemaVersion:"prospect-bounded-original-release-receipt/v1",binding:ctx.binding,...value})});
  console.log('{"verified":true,"addedVersion":"20261013214000","automaticRetry":false}');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error=>{
  process.stderr.write((error instanceof Error && /^[a-z0-9_]+$/.test(error.message)?error.message:"bounded_release_failed")+"\n"); process.exitCode=1;
});
