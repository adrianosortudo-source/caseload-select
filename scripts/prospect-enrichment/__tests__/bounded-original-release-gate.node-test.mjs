import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { sha256, PROJECT_REF } from "../migration-gate.mjs";
import { catalogQuery,verifyReceipt,verifyReference,verifySource,verifyLedger,verifyPlan,verifyCatalog,verifyRole,stage,verifyStage,guardedReference,createEvidence,verifyEvidence,verifyArtifact,executeOnce,TARGET_VERSION,TARGET_NAME,TARGET_PATH,TARGET_FILE,RECEIPT_PATH,REFERENCE_PATH,CONFIRMATION,EVIDENCE_FILES,ARTIFACT_NAME } from "../bounded-original-release-gate.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const bytes=fs.readFileSync(path.join(root,TARGET_PATH));
const referenceBytes=fs.readFileSync(path.join(root,REFERENCE_PATH));
const reference=JSON.parse(referenceBytes);
const receipt=JSON.parse(fs.readFileSync(path.join(root,RECEIPT_PATH)));
const clone=value=>structuredClone(value);
const preRows=()=>reference.ledger.map(row=>({...row,statements:null}));
const targetRow=()=>({version:TARGET_VERSION,name:TARGET_NAME,statement_count:1,statements_sha256:"a".repeat(64),statements:[bytes.toString("utf8").trim()]});
const plan={dryRun:true,upToDate:false,migrations:[TARGET_FILE],seeds:[],roles:[],message:"Finished supabase db push."};
const sha="a".repeat(40),receiptSha="b".repeat(64);
const environment={GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REF:"refs/heads/main",GITHUB_REPOSITORY:"adrianosortudo-source/caseload-select",GITHUB_RUN_ID:"123",GITHUB_RUN_ATTEMPT:"1",GITHUB_SHA:sha,PROJECT_REF,USE_TEMPORARY_DATABASE_CREDENTIAL:"true",CREDENTIAL_GATE:"bounded-original-release",BOUNDED_ORIGINAL_CONFIRMATION:CONFIRMATION,REVIEWED_SOURCE_SHA:sha,CONFIGURED_REVIEWED_SHA:sha,REVIEWED_RECEIPT_SHA256:receiptSha,CONFIGURED_RECEIPT_SHA256:receiptSha};
const source=()=>({environment:clone(environment),checkoutSha:sha,mainSha:sha,receiptSha256:receiptSha});
test("receipt pins the exact migration and the complete unchanged agency ledger reference",()=>{
 assert.equal(verifyReceipt(receipt,bytes,referenceBytes).productionApplicationApproved,false);
 assert.equal(verifyReference(reference).ledger.length,273);
 for(const version of ["20261013173327","20261013174258"]) assert.ok(reference.ledger.some(row=>row.version===version));
 for(const field of ["path","version","name","sha256","bytes"]) { const changed=clone(receipt);changed.migration[field]=field==="bytes"?0:"invalid";assert.throws(()=>verifyReceipt(changed,bytes,referenceBytes)); }
 const changed=clone(receipt);changed.approvalGranted=true;assert.throws(()=>verifyReceipt(changed,bytes,referenceBytes));
 assert.throws(()=>verifyReceipt(receipt,Buffer.from("SELECT 1;"),referenceBytes));
 assert.throws(()=>verifyReceipt(receipt,bytes,Buffer.from("{}")));
});
test("current-main, protected SHA/receipt, dispatch and one-use source identity are mandatory",()=>{
 assert.equal(verifySource(source()).runAttempt,"1");
 for(const field of Object.keys(environment)) {const changed=source();changed.environment[field]="invalid";assert.throws(()=>verifySource(changed),field);}
 for(const field of ["checkoutSha","mainSha","receiptSha256"]){const changed=source();changed[field]="c".repeat(field==="receiptSha256"?64:40);assert.throws(()=>verifySource(changed));}
});
test("missing, extra, renamed or modified historical ledger rows fail before execution",()=>{
 assert.equal(verifyLedger(preRows(),reference,"pre",bytes).historicalRowsUnchanged,273);
 const variants=[preRows().slice(1),[...preRows(),targetRow()]];
 for(const key of ["version","name","statement_count","statements_sha256","statements"]) {const changed=preRows();changed[changed.length-1][key]=key==="statement_count"?2:key==="statements"?[]:"changed";variants.push(changed);}
 for(const changed of variants){let writes=0;assert.throws(()=>executeOnce({verify:()=>verifyLedger(changed,reference,"pre",bytes),write:()=>writes++,readback:()=>{},persist:()=>{}}));assert.equal(writes,0);}
});
test("postflight permits exactly the target row with matching raw statements",()=>{
 assert.deepEqual(verifyLedger([...preRows(),targetRow()],reference,"post",bytes).addedVersions,[TARGET_VERSION]);
 for(const change of [{name:"other"},{version:"20261013214001"},{statements:["SELECT 1;"]},{statement_count:2}]) assert.throws(()=>verifyLedger([...preRows(),{...targetRow(),...change}],reference,"post",bytes));
 const changed=preRows();changed[0].statements_sha256="f".repeat(64);assert.throws(()=>verifyLedger([...changed,targetRow()],reference,"post",bytes));
});
test("only the singleton target dry-run and an empty post-plan are accepted",()=>{
 verifyPlan(plan,"pre");verifyPlan({...plan,upToDate:true,migrations:[],message:"Remote database is up to date."},"post");
 for(const change of [{migrations:[]},{migrations:[TARGET_FILE,"20261013174258_harden_agency_followup_events_privileges.sql"]},{dryRun:false},{seeds:["seed.sql"]},{roles:["roles.sql"]},{upToDate:true},{unknown:true},{message:"unsupported output"}]) assert.throws(()=>verifyPlan({...plan,...change},"pre"));
 assert.throws(()=>verifyPlan(plan,"post"));
 const withoutMessage={...plan};delete withoutMessage.message;assert.throws(()=>verifyPlan(withoutMessage,"pre"));
 assert.throws(()=>verifyPlan({...plan,message:null},"pre"));
 assert.throws(()=>verifyPlan({...plan,upToDate:true,migrations:[],message:"Local database is up to date."},"post"));
});
test("remote CLI must prove durable postgres role before migration SQL",()=>{
 assert.deepEqual(verifyRole([{effective_postgres:true}]),{effectivePostgres:true});
 for(const rows of [[],[{effective_postgres:false}],[{effective_postgres:true,extra:true}]])assert.throws(()=>verifyRole(rows));
});
test("catalog pins every function body, owner, ACL, search path and version constraint",()=>{
 verifyCatalog(receipt.catalogPre,receipt,"pre");verifyCatalog(receipt.catalogPost,receipt,"post");
 for(const field of ["body_sha256","owner","acl","settings","security_definer"]) {const changed=clone(receipt.catalogPost);changed.functions[0][field]="invalid";assert.throws(()=>verifyCatalog(changed,receipt,"post"));}
 const changed=clone(receipt.catalogPost);changed.constraint="CHECK (true)";assert.throws(()=>verifyCatalog(changed,receipt,"post"));
});
test("staging is exact and every historical reference fails on execution",()=>{
 const dir=fs.mkdtempSync(path.join(root,"bounded-stage-test-"));
 try {
  const staged=path.join(dir,"staged");const proof=stage(reference,bytes,staged);assert.equal(proof.referenceFiles,273);
  assert.throws(()=>stage(reference,bytes,staged));
  for(const row of reference.ledger)assert.match(guardedReference(row),/RAISE EXCEPTION 'bounded_release_history_reference_execution_prohibited'/);
  const migration=path.join(staged,"supabase","migrations",TARGET_FILE);fs.appendFileSync(migration,"\n-- changed");assert.throws(()=>verifyStage(reference,bytes,staged));
  fs.writeFileSync(migration,bytes);fs.writeFileSync(path.join(staged,"supabase","migrations","extra.sql"),"SELECT 1");assert.throws(()=>verifyStage(reference,bytes,staged));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
const binding={runId:"123",runAttempt:"1",sourceSha:sha,projectRef:PROJECT_REF,receiptSha256:receiptSha};
const evidenceFiles=()=>Object.fromEntries(EVIDENCE_FILES.map(name=>[name,Buffer.from(JSON.stringify(name==="source-check.json"?binding:name==="role-check.json"?{effectivePostgres:true}:name==="plan-check.json"?plan:name==="ledger-check.json"?{phase:"pre",historicalRowsUnchanged:273,addedVersions:[],targetProof:null}:{verified:true}))]));
test("preflight evidence binds every byte, run, receipt and one-day freshness",()=>{
 const files=evidenceFiles(),now=Date.now(),evidence=createEvidence(binding,files,now);
 verifyEvidence(evidence,binding,files,now+1);
 for(const key of Object.keys(binding))assert.throws(()=>verifyEvidence(evidence,{...binding,[key]:"changed"},files,now+1));
 for(const name of EVIDENCE_FILES){const changed={...files,[name]:Buffer.from("{}")};assert.throws(()=>verifyEvidence(evidence,binding,changed,now+1));}
 assert.throws(()=>verifyEvidence(evidence,binding,files,now-1));assert.throws(()=>verifyEvidence(evidence,binding,files,now+86400000));
});
test("artifact ID, digest, run, source, name and expiry cannot drift",()=>{
 const metadata={id:7,name:ARTIFACT_NAME,expired:false,digest:"sha256:"+"c".repeat(64),workflow_run:{id:123,head_sha:sha}};
 const env={EXPECTED_ARTIFACT_ID:"7",EXPECTED_ARTIFACT_DIGEST:"c".repeat(64),GITHUB_RUN_ID:"123",REVIEWED_SOURCE_SHA:sha};
 verifyArtifact(metadata,env);
 for(const change of [{id:8},{name:"other"},{expired:true},{digest:"sha256:"+"d".repeat(64)},{workflow_run:{id:124,head_sha:sha}},{workflow_run:{id:123,head_sha:"e".repeat(40)}}])assert.throws(()=>verifyArtifact({...metadata,...change},env));
});
test("failed apply reads back and persists a truthful receipt without retry",()=>{
 let writes=0,reads=0,saved;
 assert.throws(()=>executeOnce({verify:()=>{},write:()=>{writes++;throw Error("private diagnostic");},readback:()=>{reads++;return {unchanged:true};},persist:value=>{saved=value;}}),/bounded_release_write_failed/);
 assert.equal(writes,1);assert.equal(reads,1);assert.deepEqual(saved,{writeError:"bounded_release_write_failed",readbackError:null,result:{unchanged:true},automaticRetry:false});
 assert.throws(()=>executeOnce({verify:()=>{},write:()=>{},readback:()=>{throw Error("private");},persist:()=>{}}),/bounded_release_readback_failed/);
});
test("workflow requires two protected gates, fixed temporary credentials and immutable artifact identity",async()=>{
 const yaml=await import("js-yaml");const workflow=yaml.default.load(fs.readFileSync(path.join(root,".github/workflows/prospect-bounded-original-release.yml"),"utf8"));
 assert.equal(workflow.concurrency.group,"gta-prospect-migrations-production");assert.equal(workflow.concurrency["cancel-in-progress"],false);
 assert.equal(workflow.env.USE_TEMPORARY_DATABASE_CREDENTIAL,"true");assert.equal(workflow.env.CREDENTIAL_GATE,"bounded-original-release");
 assert.equal(workflow.env.SUPABASE_NO_UPDATE_NOTIFIER,"true");
 for(const job of Object.values(workflow.jobs)){assert.equal(job.environment.name,"Production prospect migrations");const actions=job.steps.filter(step=>step.uses);for(const step of actions)assert.match(step.uses,/@[a-f0-9]{40}$/);}
 assert.equal(workflow.jobs.apply.needs,"preflight");
 const apply=workflow.jobs.apply.steps;assert.ok(apply.findIndex(step=>step.run?.includes("verify-evidence"))<apply.findIndex(step=>step.run?.includes("temporary-credential.mjs")));
 assert.ok(apply.some(step=>step.with?.["artifact-ids"] && step.with["merge-multiple"]===true));assert.ok(apply.some(step=>step.if==="always()"));
 assert.doesNotMatch(JSON.stringify(workflow),/STATIC_MIGRATION_DATABASE_URL|migration repair|supabase db push/);
});
const normalizeTestDatabaseUrl=value=>value?.trim().replace(/^["']|["']$/g, "");
const isHistoricalGuardFailure=error=>{
 if(error.status!==1 || error.signal!==null) return false;
 try {const failure=JSON.parse(String(error.stdout));return failure._tag==="Error" && /^ERROR: bounded_release_history_reference_execution_prohibited \(SQLSTATE P0001\)(?:\r?\n|$)/.test(String(failure.error?.message));}
 catch {return false;}
};
test("negative CLI proof requires the actual P0001 guard error on structured stdout",()=>{
 const message="ERROR: bounded_release_history_reference_execution_prohibited (SQLSTATE P0001)\nAt statement: 0";
 const failure={status:1,signal:null,stdout:JSON.stringify({_tag:"Error",error:{message}})};
 assert.equal(isHistoricalGuardFailure(failure),true);
 for(const change of [{status:0},{signal:"SIGTERM"},{stdout:"not-json"},{stdout:JSON.stringify({_tag:"Error",error:{message:"ERROR: syntax error (SQLSTATE 42601)\nRAISE EXCEPTION bounded_release_history_reference_execution_prohibited"}})},{stdout:JSON.stringify({_tag:"Error",error:{message:"connection failed",detail:message}})}]) assert.equal(isHistoricalGuardFailure({...failure,...change}),false);
});
test("CLI test accepts the quoted loopback URL exported by Supabase status",()=>{
 const value="postgresql://postgres:postgres@127.0.0.1:55562/postgres";
 for(const input of [value,'"'+value+'"',"'"+value+"'",'  "'+value+'"  ']) assert.equal(new URL(normalizeTestDatabaseUrl(input)).href,value);
});
const cliUrl=normalizeTestDatabaseUrl(process.env.PROSPECT_BOUNDED_RELEASE_CLI_TEST_DATABASE_URL);
test("pinned CLI skips guarded historical references and plans only the target on isolated Postgres",{skip:!cliUrl,timeout:300000},async t=>{
 const url=new URL(cliUrl);assert.ok(["postgres:","postgresql:"].includes(url.protocol));assert.ok(["127.0.0.1","::1"].includes(url.hostname.replace(/^\[|\]$/g,"")));assert.ok(url.port);assert.equal(url.pathname,"/postgres");
 const cli=process.env.PROSPECT_BOUNDED_RELEASE_SUPABASE_BIN??"supabase";
 assert.equal(execFileSync(cli,["--version"],{encoding:"utf8"}).trim(),"2.117.0");
 const admin=new Pool({connectionString:cliUrl,max:1});const name="bounded_cli_"+randomUUID().replaceAll("-","");let created=false,db;
 const dir=fs.mkdtempSync(path.join(root,"bounded-cli-test-"));
 try {
  console.info("bounded-cli-phase","actual-catalog");
  verifyCatalog((await admin.query(catalogQuery())).rows[0].catalog,receipt,"post");t.diagnostic("Actual isolated database catalog matches all nine reviewed function bodies and permissions.");
  await admin.query('CREATE DATABASE "'+name+'"');created=true;
  const scratch=new URL(cliUrl);scratch.pathname="/"+name;scratch.searchParams.set("sslmode","disable");db=new Pool({connectionString:scratch.toString(),max:1});
  await db.query("CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text)");
  await db.query("INSERT INTO supabase_migrations.schema_migrations(version,name) SELECT entry->>'version',entry->>'name' FROM jsonb_array_elements($1::jsonb) entry",[JSON.stringify(reference.ledger)]);
  console.info("bounded-cli-phase","guarded-stage");
  const staged=path.join(dir,"staged");stage(reference,bytes,staged);
  const cliEnvironment={...process.env,SUPABASE_NO_UPDATE_NOTIFIER:"true"};
  const dry=()=>JSON.parse(execFileSync(cli,["db","push","--dry-run","--include-all","--skip-vault","--output-format","json","--db-url",scratch.toString()],{cwd:staged,env:cliEnvironment,encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:60000}));
  console.info("bounded-cli-phase","singleton-dry-run");
  verifyPlan(dry(),"pre");t.diagnostic("Pinned CLI planned only the reviewed target.");
  verifyStage(reference,bytes,staged);t.diagnostic("Pinned CLI left the guarded stage exact after its dry-run.");
  await db.query("DELETE FROM supabase_migrations.schema_migrations WHERE version='20261013174258'");
  console.info("bounded-cli-phase","missing-history-dry-run");
  assert.throws(()=>verifyPlan(dry(),"pre"));t.diagnostic("A missing historical ledger row was rejected by the plan verifier.");
  const before=(await db.query("SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version")).rows;
  console.info("bounded-cli-phase","actual-negative-push");
  assert.throws(()=>execFileSync(cli,["db","push","--yes","--include-all","--skip-vault","--output-format","json","--db-url",scratch.toString()],{cwd:staged,env:cliEnvironment,encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:60000}),
    isHistoricalGuardFailure);
  t.diagnostic("Actual CLI push stopped at the historical SQL guard.");
  assert.deepEqual((await db.query("SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version")).rows,before);
  assert.equal((await db.query("SELECT count(*)::int count FROM supabase_migrations.schema_migrations WHERE version='20261013174258'")).rows[0].count,0);
  await assert.rejects(db.query(guardedReference(reference.ledger.at(-1))),/bounded_release_history_reference_execution_prohibited/);
  assert.equal((await db.query("SELECT count(*)::int count FROM supabase_migrations.schema_migrations WHERE version=$1",[TARGET_VERSION])).rows[0].count,0);
 } finally {
  await db?.end();if(created)await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');await admin.end();fs.rmSync(dir,{recursive:true,force:true});
 }
});
