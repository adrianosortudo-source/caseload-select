import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as repair from "../candidate-registration-repair-gate.mjs";
import { PROJECT_REF, PREVIEW_MIGRATION_PATHS, HISTORICAL_LEDGER_NAME_ALIASES, CANDIDATE_READER_REPAIR_PATHS } from "../migration-gate.mjs";
import { MIGRATION_PATHS, APPLIED_OPERATOR_RPC, CATALOG_EXPECTED, RELEASE_PATH, verifyLedgerState } from "../additive-release-gate.mjs";
import { catalogExpectations } from "../candidate-reader-repair-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const committed = file => execFileSync("git", ["show", "HEAD:" + file], { cwd: root, maxBuffer: 4*1024*1024 });
const sources = Object.fromEntries([...MIGRATION_PATHS, APPLIED_OPERATOR_RPC.path].map(file => [file, committed(file)]));
const receipt = JSON.parse(committed(RELEASE_PATH));
const makeRow = file => {
  const filename = path.basename(file), [,version,name] = /^(\d+)_(.+)\.sql$/.exec(filename);
  return {version, name, statements:[committed(file).toString("utf8").trim().replace(/;$/, "")]};
};
const allRows = [...MIGRATION_PATHS,APPLIED_OPERATOR_RPC.path].map(makeRow).sort((a,b)=>a.version.localeCompare(b.version));
const preRows = allRows.filter(row=>row.version!=="20260924185000");
const clone = value => structuredClone(value);
const body = (file,name) => {
  const sql=committed(file).toString("utf8"), start=sql.indexOf("CREATE OR REPLACE FUNCTION public."+name+"(");
  const from=sql.indexOf("AS $$",start)+5;
  return sql.slice(from,sql.indexOf("$$;",from));
};
const coverageSql=committed("supabase/migrations/20260924192549_prospect_enrichment_candidate_firm_coverage.sql").toString("utf8");
const inventory=coverageSql.slice(coverageSql.indexOf("FROM (VALUES"),coverageSql.indexOf(") inventory(name,kind,columns,excluded)"));
const tables=[...inventory.matchAll(/\('([a-z0-9_]+)'/g)].map(match=>match[1]).sort();
const coverage=tables.map(table_name=>({table_name,last_id:null,rows_projected:0,complete:true,total_tables:33,complete_tables:33,incomplete_tables:0}));
const catalog = phase => [
  {functionName:"record_prospect_enrichment_manifest_hold_evidence_v1",identityArguments:"text, text, text, jsonb",
    body:body(phase==="post"?repair.REGISTRATION_REPAIR_PATH:"supabase/migrations/20260924071322_prospect_enrichment_manifest_hold_evidence.sql","record_prospect_enrichment_manifest_hold_evidence_v1")},
  {functionName:"register_prospect_enrichment_manifest_chunk_v1",identityArguments:"text, jsonb, boolean",
    body:body("supabase/migrations/20260923161812_prospect_enrichment_v1.sql","register_prospect_enrichment_manifest_chunk_v1")},
].map(row=>({...row,languageName:"plpgsql",securityDefiner:false,
  settings:phase==="post"?['search_path=""',"statement_timeout=30s"]:['search_path=""'],
  serviceRoleExecute:true,anonExecute:false,authenticatedExecute:false,publicExecute:false,nonOwnerExecuteGrantees:["service_role"],manifestUpdateAllowed:false}));
const plan=phase=>({dryRun:true,upToDate:phase==="post",migrations:phase==="post"?[]:[path.basename(repair.REGISTRATION_REPAIR_PATH)],seeds:[],roles:[]});
const sourceInput={environment:{GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REF:"refs/heads/main",GITHUB_REPOSITORY:"adrianosortudo-source/caseload-select",
  GITHUB_RUN_ID:"999",GITHUB_RUN_ATTEMPT:"1",PROJECT_REF,USE_TEMPORARY_DATABASE_CREDENTIAL:"true",REPAIR_CONFIRMATION:repair.REPAIR_CONFIRMATION,
  REVIEWED_SOURCE_SHA:"a".repeat(40),GITHUB_SHA:"a".repeat(40),REVIEWED_RECEIPT_SHA256:"b".repeat(64)},
  checkoutSha:"a".repeat(40),mainSha:"a".repeat(40),actualReceiptSha256:"b".repeat(64),projectEnvFiles:[]};

test("singleton repair preserves the old prefix rejection while verifying every applied statement",()=>{
  assert.equal(repair.verifyRegistrationRepairLedger(preRows,receipt,sources).verified,true);
  assert.equal(repair.verifyRegistrationRepairLedger(allRows,receipt,sources,"post").pending.length,0);
  assert.throws(()=>verifyLedgerState(preRows,receipt,sources),/release_ledger_not_ordered_prefix/);
  for(const invalid of [preRows.slice(1),allRows,[...preRows,preRows[0]],[...preRows].reverse()]) {
    assert.throws(()=>repair.verifyRegistrationRepairLedger(invalid,receipt,sources));
  }
  const changed=clone(preRows);changed[0].statements=["SELECT 'unreviewed'"];
  assert.throws(()=>repair.verifyRegistrationRepairLedger(changed,receipt,sources),/ledger_statement_content_mismatch/);
  const named=clone(preRows);named[0].name="wrong";
  assert.throws(()=>repair.verifyRegistrationRepairLedger(named,receipt,sources));
  assert.throws(()=>repair.verifyRegistrationRepairLedger(preRows,receipt,sources,"post"));
  const missingOperatorStatements=clone(allRows);
  missingOperatorStatements.find(row=>row.version==="20260924180541").statements=null;
  assert.throws(()=>repair.verifyRegistrationRepairLedger(missingOperatorStatements,receipt,sources,"post"),/ledger_statements_missing/);
});

test("source gate binds dispatch, main, receipt, attempt, confirmation and credential opt-in",()=>{
  assert.equal(repair.verifyRegistrationRepairSourceGate(sourceInput).sourceSha,sourceInput.checkoutSha);
  for(const [key,value] of Object.entries({GITHUB_EVENT_NAME:"push",GITHUB_REF:"refs/heads/other",GITHUB_REPOSITORY:"other/repo",GITHUB_RUN_ATTEMPT:"2",
    USE_TEMPORARY_DATABASE_CREDENTIAL:"false",REPAIR_CONFIRMATION:"wrong",GITHUB_SHA:"c".repeat(40),REVIEWED_RECEIPT_SHA256:"c".repeat(64)})) {
    assert.throws(()=>repair.verifyRegistrationRepairSourceGate({...sourceInput,environment:{...sourceInput.environment,[key]:value}}));
  }
  assert.throws(()=>repair.verifyRegistrationRepairSourceGate({...sourceInput,mainSha:"c".repeat(40)}));
  assert.throws(()=>repair.verifyRegistrationRepairSourceGate({...sourceInput,projectEnvFiles:[".env"]}));
});

test("dry-run admits singleton repair only, then requires no pending migrations, seeds or roles",()=>{
  assert.deepEqual(repair.verifyRegistrationRepairPlan(plan("pre")).migrations,[path.basename(repair.REGISTRATION_REPAIR_PATH)]);
  assert.equal(repair.verifyRegistrationRepairPlan(plan("post"),"post").upToDate,true);
  for(const invalid of [{...plan("pre"),migrations:[]},{...plan("pre"),migrations:["20260925200000_gta_prospect_operator_database_firm_profile_link.sql"]},
    {...plan("pre"),roles:["service_role"]},{...plan("pre"),seeds:["seed.sql"]},{...plan("pre"),dryRun:false}]) {
    assert.throws(()=>repair.verifyRegistrationRepairPlan(invalid));
  }
});

test("live catalog proves exact invoker, ACL, timeout and function bodies without manifest UPDATE",()=>{
  for(const phase of ["pre","post"]) assert.equal(repair.verifyRegistrationRepairCatalog(catalog(phase),sources[repair.REGISTRATION_REPAIR_PATH],phase,sources).verified,true);
  for(const change of [{securityDefiner:true},{anonExecute:true},{publicExecute:true},{manifestUpdateAllowed:true},{settings:['search_path=""']},{body:"changed"}]) {
    const invalid=catalog("post");Object.assign(invalid[0],change);
    assert.throws(()=>repair.verifyRegistrationRepairCatalog(invalid,sources[repair.REGISTRATION_REPAIR_PATH],"post",sources));
  }
  const changed=catalog("post");changed[1].body+="-- drift";
  assert.throws(()=>repair.verifyRegistrationRepairCatalog(changed,sources[repair.REGISTRATION_REPAIR_PATH],"post",sources),/chunk_body_changed/);
});

test("coverage prerequisite requires all 33 exact inventory tables complete",()=>{
  assert.equal(tables.length,33);
  assert.equal(repair.verifyRegistrationRepairCoverage(coverage).complete,true);
  assert.throws(()=>repair.verifyRegistrationRepairCoverage(coverage.slice(1)));
  const incomplete=clone(coverage);incomplete[0].complete=false;for(const row of incomplete){row.complete_tables=32;row.incomplete_tables=1;}
  assert.throws(()=>repair.verifyRegistrationRepairCoverage(incomplete));
  const changed=clone(coverage);changed[0].table_name="unreviewed_table";
  assert.throws(()=>repair.verifyRegistrationRepairCoverage(changed));
});

test("immutable same-run evidence detects source, file, result and expiry changes",()=>{
  const fullRows=fs.readdirSync(path.join(root,"supabase/migrations")).filter(name=>/^\d+_.+\.sql$/.test(name))
    .map(filename=>({filename,path:"supabase/migrations/"+filename}))
    .filter(item=>!PREVIEW_MIGRATION_PATHS.includes(item.path)&&item.path!==repair.REGISTRATION_REPAIR_PATH)
    .map(item=>{const [,version,name]=/^(\d+)_(.+)\.sql$/.exec(item.filename);return {version,name:HISTORICAL_LEDGER_NAME_ALIASES[version]?.name??name};})
    .sort((a,b)=>a.version.localeCompare(b.version));
  const values={"scoped-ledger.json":preRows,"full-ledger.json":fullRows,"operator-catalog.json":[CATALOG_EXPECTED],
    "reader-catalog.json":[{reader_contract:catalogExpectations}],"reader-ledger.json":CANDIDATE_READER_REPAIR_PATHS.map(makeRow),
    "registration-catalog.json":catalog("pre"),"coverage.json":coverage,"plan.json":plan("pre")};
  const files=Object.fromEntries(repair.EVIDENCE_FILES.map(key=>[key,Buffer.from(JSON.stringify(values[key]))]));
  const binding=repair.verifyRegistrationRepairSourceGate(sourceInput), now=1800000000000;
  const options={sourceRoot:root,sourceMaterial:{sources,receipt}};
  const evidence=repair.createRegistrationRepairEvidence(binding,files,now,options);
  assert.equal(repair.verifyRegistrationRepairEvidence(evidence,binding,files,now+1,options).verified,true);
  assert.throws(()=>repair.verifyRegistrationRepairEvidence(evidence,{...binding,runId:"1000"},files,now+1,options));
  assert.throws(()=>repair.verifyRegistrationRepairEvidence(evidence,binding,files,now+86400000,options));
  const tampered={...files,"plan.json":Buffer.from(JSON.stringify(plan("post")))};
  assert.throws(()=>repair.verifyRegistrationRepairEvidence(evidence,binding,tampered,now+1,options),/evidence_changed/);
  const altered=clone(evidence);altered.current.plan.upToDate=true;
  assert.throws(()=>repair.verifyRegistrationRepairEvidence(altered,binding,files,now+1,options));
});

test("artifact identity and safe diagnostics cannot expose untrusted error text",()=>{
  const env={EXPECTED_ARTIFACT_ID:"123",EXPECTED_ARTIFACT_DIGEST:"d".repeat(64),GITHUB_RUN_ID:"999",REVIEWED_SOURCE_SHA:"a".repeat(40)};
  const metadata={id:123,name:repair.REPAIR_ARTIFACT_NAME,expired:false,digest:"sha256:"+env.EXPECTED_ARTIFACT_DIGEST,workflow_run:{id:999,head_sha:env.REVIEWED_SOURCE_SHA}};
  assert.equal(repair.verifyRegistrationRepairArtifactMetadata(metadata,env).verified,true);
  for(const change of [{id:124},{expired:true},{digest:"sha256:"+"0".repeat(64)},{workflow_run:{id:998,head_sha:env.REVIEWED_SOURCE_SHA}}]) {
    assert.throws(()=>repair.verifyRegistrationRepairArtifactMetadata({...metadata,...change},env));
  }
  assert.equal(repair.safeRegistrationRepairFailureCode(Error("postgresql://secret")),"candidate_registration_repair_unexpected_failure");
});

test("review recheck accepts only complete monotonic coverage with unchanged prerequisite proofs",()=>{
  const baseline={ledger:{verified:true},catalog:{verified:true},coverage:repair.verifyRegistrationRepairCoverage(coverage)};
  const advanced=clone(baseline);advanced.coverage.status[0].rows_projected=1;advanced.coverage.rowsProjected=1;
  assert.equal(repair.verifyRegistrationRepairLiveState(baseline,advanced).verified,true);
  const changed=clone(advanced);changed.catalog.verified=false;
  assert.throws(()=>repair.verifyRegistrationRepairLiveState(baseline,changed),/live_state_changed/);
  assert.throws(()=>repair.verifyRegistrationRepairLiveState(advanced,baseline),/coverage_regressed/);
  const missing=clone(advanced);missing.coverage.status[0].complete=false;
  assert.throws(()=>repair.verifyRegistrationRepairLiveState(baseline,missing),/coverage_regressed/);
});

test("workflow requires both protected reviews, independent evidence validation and source before credentials",()=>{
  const yaml=createRequire(import.meta.url)("js-yaml");
  const workflow=yaml.load(fs.readFileSync(path.join(root,".github/workflows/prospect-candidate-registration-repair.yml"),"utf8"));
  assert.equal(workflow.jobs.preflight.environment,"Production prospect migrations");
  assert.equal(workflow.jobs.apply.environment,"Production prospect migrations");
  assert.deepEqual(workflow.jobs.apply.needs,["preflight","verify_preflight"]);
  assert.equal(workflow.jobs.verify_preflight.environment,undefined);
  const steps=workflow.jobs.apply.steps;
  assert.ok(steps.findIndex(step=>/verify-evidence/.test(step.run??""))<steps.findIndex(step=>/temporary-credential/.test(step.run??"")));
  const code=fs.readFileSync(path.join(root,"scripts/prospect-enrichment/candidate-registration-repair-gate.mjs"),"utf8");
  assert.match(code,/--include-all/);
  assert.doesNotMatch(code,/runRecoveryCoverageWriter|runCoverageBackfillWorker|applyProfileLink/);
});
