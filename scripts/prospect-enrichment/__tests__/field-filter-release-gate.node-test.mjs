import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, PROJECT_REF } from "../migration-gate.mjs";
import { TARGET_FILE,TARGET_VERSION,TARGET_NAME,TARGET_PATH,PREREQUISITE_PATH,PREREQUISITE_VERSION,PREREQUISITE_NAME,RECEIPT_PATH,REFERENCE_PATH,CONFIRMATION,ARTIFACT_NAME,EVIDENCE_FILES,EVIDENCE_TTL_MS,verifyReference,verifyReceipt,verifySource,verifyLedger,verifyPlan,verifyRole,verifyCatalog,stage,verifyStage,guardedReference,sourceCatalog,createEvidence,verifyEvidence,verifyArtifact,executeOnce } from "../field-filter-release-gate.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const bytes=fs.readFileSync(path.join(root,TARGET_PATH));
const prerequisiteBytes=fs.readFileSync(path.join(root,PREREQUISITE_PATH));
const referenceBytes=fs.readFileSync(path.join(root,REFERENCE_PATH));
const reference=JSON.parse(referenceBytes);
const receipt=JSON.parse(fs.readFileSync(path.join(root,RECEIPT_PATH)));
const priorReader=fs.readFileSync(path.join(root,"supabase/migrations/20261006003626_prospect_candidate_scoped_reader_fastpaths.sql"));
const clone=value=>structuredClone(value);
const prereqRow=()=>({version:PREREQUISITE_VERSION,name:PREREQUISITE_NAME,statement_count:1,statements_sha256:"a".repeat(64),statements:[prerequisiteBytes.toString("utf8").trim()]});
const targetRow=()=>({version:TARGET_VERSION,name:TARGET_NAME,statement_count:1,statements_sha256:"b".repeat(64),statements:[bytes.toString("utf8").trim()]});
const preRows=()=>reference.baseline.map(row=>({...row,statements:null})).concat(prereqRow());
const plan={dryRun:true,upToDate:false,migrations:[TARGET_FILE],seeds:[],roles:[],message:"Finished supabase db push."};
const sha="c".repeat(40),receiptSha=sha256(fs.readFileSync(path.join(root,RECEIPT_PATH)));
const environment={GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REF:"refs/heads/main",GITHUB_REPOSITORY:"adrianosortudo-source/caseload-select",GITHUB_RUN_ID:"123",GITHUB_RUN_ATTEMPT:"1",GITHUB_SHA:sha,PROJECT_REF,USE_TEMPORARY_DATABASE_CREDENTIAL:"true",CREDENTIAL_GATE:"field-filter-release",FIELD_FILTER_CONFIRMATION:CONFIRMATION,REVIEWED_SOURCE_SHA:sha,CONFIGURED_REVIEWED_SHA:sha,REVIEWED_RECEIPT_SHA256:receiptSha,CONFIGURED_RECEIPT_SHA256:receiptSha};

test("receipt pins exact target, prerequisite, ledger reference and source-derived catalogs",()=>{
 assert.equal(verifyReceipt(receipt,bytes,prerequisiteBytes,referenceBytes).productionApplicationApproved,false);
 assert.equal(verifyReference(reference,prerequisiteBytes).baseline.length,273);
 assert.equal(reference.prerequisite.version,"20261013214000");
 assert.deepEqual(receipt.catalogPre,sourceCatalog(receipt,"pre",bytes,priorReader));
 assert.deepEqual(receipt.catalogPost,sourceCatalog(receipt,"post",bytes,priorReader));
 for(const change of [{approvalGranted:true},{catalogEvidence:"operator approved"},{migration:{...receipt.migration,sha256:"0".repeat(64)}},{ledgerReferenceSha256:"0".repeat(64)}])assert.throws(()=>verifyReceipt({...receipt,...change},bytes,prerequisiteBytes,referenceBytes));
 assert.throws(()=>verifyReference({...reference,prerequisite:{...reference.prerequisite,sha256:"0".repeat(64)}},prerequisiteBytes));
});

test("source authorization binds current main, receipt, environment, gate and one-use confirmation",()=>{
 const valid=verifySource({environment:clone(environment),checkoutSha:sha,mainSha:sha,receiptSha256:receiptSha});assert.equal(valid.projectRef,PROJECT_REF);
 for(const change of [{GITHUB_REF:"refs/heads/codex/test"},{GITHUB_RUN_ATTEMPT:"2"},{FIELD_FILTER_CONFIRMATION:"wrong"},{CONFIGURED_RECEIPT_SHA256:"0".repeat(64)},{CREDENTIAL_GATE:"bounded-original-release"}])assert.throws(()=>verifySource({environment:{...environment,...change},checkoutSha:sha,mainSha:sha,receiptSha256:receiptSha}));
 assert.throws(()=>verifySource({environment:clone(environment),checkoutSha:"d".repeat(40),mainSha:sha,receiptSha256:receiptSha}));
});

test("ledger requires the unchanged 273-row history and exact bounded-original prerequisite",()=>{
 const rows=preRows();const proof=verifyLedger(rows,reference,"pre",bytes,prerequisiteBytes);assert.equal(proof.historicalRowsUnchanged,273);assert.equal(proof.prerequisiteVersion,PREREQUISITE_VERSION);
 assert.deepEqual(verifyLedger(rows.concat(targetRow()),reference,"post",bytes,prerequisiteBytes).addedVersions,[TARGET_VERSION]);
 for(const changed of [rows.slice(0,-1),rows.concat({...prereqRow(),name:"wrong"}),rows.concat(targetRow()),rows.map((row,index)=>index===0?{...row,name:"altered"}:row)])assert.throws(()=>verifyLedger(changed,reference,"pre",bytes,prerequisiteBytes));
 const alteredPrerequisite=rows.map(row=>row.version===PREREQUISITE_VERSION?{...row,statements:["SELECT 1"]}:row);assert.throws(()=>verifyLedger(alteredPrerequisite,reference,"pre",bytes,prerequisiteBytes));
});

test("only the exact singleton target dry-run and empty post-plan are accepted",()=>{
 verifyPlan(plan,"pre");verifyPlan({...plan,upToDate:true,migrations:[],message:"Remote database is up to date."},"post");
 for(const change of [{migrations:[]},{migrations:[TARGET_FILE,"unrelated.sql"]},{dryRun:false},{seeds:["seed.sql"]},{roles:["roles.sql"]},{upToDate:true},{extra:true}])assert.throws(()=>verifyPlan({...plan,...change},"pre"));
});

test("catalog checks exact function body hashes, ownership, ACL and search path",()=>{
 verifyCatalog(receipt.catalogPre,receipt,"pre");verifyCatalog(receipt.catalogPost,receipt,"post");
 for(const field of ["body_sha256","owner","acl","settings","security_definer"]){const changed=clone(receipt.catalogPost);changed.functions[0][field]="invalid";assert.throws(()=>verifyCatalog(changed,receipt,"post"));}
 assert.throws(()=>verifyCatalog({functions:[]},receipt,"pre"));
});

test("staging includes only unchanged history references, the prerequisite and target",()=>{
 const temp=fs.mkdtempSync(path.join(root,"field-filter-stage-"));
 try{
  const target=path.join(temp,"staged"),rows=preRows(),proof=stage(reference,rows,bytes,target,prerequisiteBytes);
  assert.equal(proof.referenceFiles,274);assert.equal(proof.unrelatedFiles,0);verifyStage(reference,rows,bytes,target,prerequisiteBytes);
  for(const row of rows)assert.match(guardedReference(row),/field_filter_history_reference_execution_prohibited/);
  assert.throws(()=>stage(reference,rows,bytes,target,prerequisiteBytes));
  fs.writeFileSync(path.join(target,"supabase","migrations","extra.sql"),"SELECT 1");assert.throws(()=>verifyStage(reference,rows,bytes,target,prerequisiteBytes));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

const binding={runId:"123",runAttempt:"1",sourceSha:sha,projectRef:PROJECT_REF,receiptSha256:receiptSha};
const files=()=>Object.fromEntries(EVIDENCE_FILES.map(name=>[name,Buffer.from(JSON.stringify(name==="source-check.json"?binding:name==="role-check.json"?{effectivePostgres:true}:name==="plan-check.json"?plan:name==="ledger-check.json"?{phase:"pre",historicalRowsUnchanged:273,prerequisiteVersion:PREREQUISITE_VERSION,addedVersions:[],targetProof:null}:{verified:true}))]));

test("preflight evidence binds all bytes, current run, receipt and 15-minute freshness",()=>{
 const evidenceFiles=files(),now=Date.now(),evidence=createEvidence(binding,evidenceFiles,now);assert.equal(Date.parse(evidence.expiresAt)-Date.parse(evidence.createdAt),EVIDENCE_TTL_MS);verifyEvidence(evidence,binding,evidenceFiles,now+1);
 for(const key of Object.keys(binding))assert.throws(()=>verifyEvidence(evidence,{...binding,[key]:"changed"},evidenceFiles,now+1));
 for(const name of EVIDENCE_FILES)assert.throws(()=>verifyEvidence(evidence,binding,{...evidenceFiles,[name]:Buffer.from("{}")},now+1));
 assert.throws(()=>verifyEvidence(evidence,binding,evidenceFiles,now-1));assert.throws(()=>verifyEvidence(evidence,binding,evidenceFiles,now+EVIDENCE_TTL_MS));
});

test("artifact identity pins ID, digest, run, source, name and expiry",()=>{
 const metadata={id:7,name:ARTIFACT_NAME,expired:false,digest:"sha256:"+"e".repeat(64),workflow_run:{id:123,head_sha:sha}},env={EXPECTED_ARTIFACT_ID:"7",EXPECTED_ARTIFACT_DIGEST:"e".repeat(64),GITHUB_RUN_ID:"123",REVIEWED_SOURCE_SHA:sha};verifyArtifact(metadata,env);
 for(const change of [{id:8},{name:"other"},{expired:true},{digest:"sha256:"+"f".repeat(64)},{workflow_run:{id:124,head_sha:sha}},{workflow_run:{id:123,head_sha:"f".repeat(40)}}])assert.throws(()=>verifyArtifact({...metadata,...change},env));
});

test("an uncertain write is never retried and still gets read back",()=>{
 let writes=0,reads=0,saved;assert.throws(()=>executeOnce({verify:()=>{},write:()=>{writes++;throw Error("private");},readback:()=>{reads++;return{unchanged:true};},persist:value=>{saved=value;}}),/field_filter_write_failed/);
 assert.equal(writes,1);assert.equal(reads,1);assert.equal(saved.automaticRetry,false);assert.equal(saved.writeError,"field_filter_write_failed");
});

test("workflow has separate protected reviews, exact environment and pinned actions",async()=>{
 const yaml=await import("js-yaml"),workflow=yaml.default.load(fs.readFileSync(path.join(root,".github/workflows/prospect-field-filter-release.yml"),"utf8"));
 assert.equal(workflow.concurrency.group,"gta-prospect-migrations-production");assert.equal(workflow.concurrency["cancel-in-progress"],false);assert.equal(workflow.env.CREDENTIAL_GATE,"field-filter-release");
 assert.deepEqual(Object.keys(workflow.jobs).sort(),["apply","preflight"]);for(const job of Object.values(workflow.jobs)){assert.equal(job.environment.name,"Production prospect migrations");for(const step of job.steps.filter(step=>step.uses))assert.match(step.uses,/@[a-f0-9]{40}$/);}
 assert.match(workflow.jobs.preflight.steps.find(step=>step.name.includes("before credentials")).run,/field-filter-release-gate\.mjs source/);
 assert.match(workflow.jobs.apply.steps.find(step=>step.name.includes("one migration once")).run,/field-filter-release-gate\.mjs apply/);
});
