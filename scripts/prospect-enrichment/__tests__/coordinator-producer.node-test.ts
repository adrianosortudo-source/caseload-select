import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../cli";
import { coordinatorFixture, producerDate } from "../fixtures/coordinator";
import { produceWholeFirmExport } from "../whole-firm-producer";
import { snapshotCoordinatorState } from "../whole-firm-coordinator-export";
import { compileWholeFirmSnapshot, freezeWholeFirmExport, type WholeFirmSourceManifest } from "../whole-firm";
import { canonicalJson, getPointer, object, protocolHash, sha256, within } from "../model";
import { items } from "../reconciliation";

const provenance={sourcePath:"synthetic/whole_firm_state.json",sourceSha256:"a".repeat(64),references:[]};
function compile(input:unknown) {
  const produced=produceWholeFirmExport(input,provenance,producerDate);
  return {...produced,compiled:compileWholeFirmSnapshot(freezeWholeFirmExport(produced.exported,sha256(canonicalJson(produced.exported))))};
}
async function workspace(t:{after:(fn:()=>Promise<void>)=>void}) {
  const root=path.join(path.dirname(fileURLToPath(import.meta.url)),".tmp");
  await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,"pe-coordinator-synthetic-"));
  t.after(async()=>{const real=await fs.realpath(dir);assert.ok(within(root,real)&&path.basename(real).startsWith("pe-coordinator-synthetic-"));await fs.rm(real,{recursive:true,force:true});});
  const sourceRoot=path.join(dir,"source"),statePath=path.join(sourceRoot,"operations/luna_continuous_v1/control/whole_firm_state.json"),outputRoot=path.join(dir,"output");
  await fs.mkdir(path.dirname(statePath),{recursive:true});return{dir,sourceRoot,statePath,outputRoot};
}
test("coordinator producer maps canonical fields without upgrading decisions or inventing source metadata",()=>{
  const state=coordinatorFixture(),before=canonicalJson(state),result=compile(state);
  assert.equal(canonicalJson(state),before);assert.equal(result.candidateCount,3);
  assert.ok(result.compiled.packages.length>=3);
  const all=result.compiled.packages.flatMap(p=>p.envelope.observations);
  assert.ok(all.some(o=>o.kind==="advertising"&&o.data.evidenceType==="direct-ad"&&o.data.effectiveDate==="2026-09-21"));
  assert.ok(all.some(o=>o.kind==="contact"&&o.data.contactType==="public-named-email"&&o.data.deliverability==="not-tested"));
  assert.ok(all.some(o=>o.kind==="contact"&&o.data.contactType==="general-inbox"));
  assert.ok(all.some(o=>o.kind==="roster"&&o.data.includedNames.length===2&&o.data.excludedPeople[0].reason==="Student"));
  assert.ok(!all.some(o=>o.kind==="opportunity"));
  assert.ok(result.issues.some(i=>i.code==="opportunity_confidence_not_recorded"));
  for(const p of result.compiled.packages){
    assert.ok(p.envelope.sources.every(s=>s.observedAt===null&&s.observedOn==="2026-09-22"&&s.retrievedAt===null&&s.retrievalOutcome==="legacy-unknown"));
    assert.equal(p.envelope.subject.researchKey.startsWith("domain:"),true);
    if(p.envelope.assessment){assert.equal(p.envelope.assessment.researchOutcome,"unknown");assert.equal(p.envelope.assessment.assessedAt,null);assert.notEqual(p.envelope.assessment.selectionDisposition,"selected");assert.deepEqual(p.envelope.assessment.missingGates,["published-direct-email","specific-opportunity"]);}
    for(const pointer of p.envelope.originalResearch.unmappedPaths) assert.notEqual(getPointer(p.envelope.originalResearch.content,pointer),undefined,pointer);
  }
  const rejected=result.compiled.packages.find(p=>p.envelope.subject.researchKey==="domain:synthetic-2.example"&&p.envelope.assessment);
  assert.equal(rejected?.envelope.assessment?.selectionDisposition,"disqualified");
});
test("full candidate history, malformed results and no-result candidates remain accounted raw holds",()=>{
  const state:Record<string,unknown>=coordinatorFixture(),candidates=state.candidates as Record<string,unknown>[];
  candidates[0].results=[...(candidates[0].results as unknown[]),null,{unrecognized:"preserve"}];
  candidates.push({key:"domain:no-result.example",status:"research-held",results:[],deferral:{reason:"Synthetic hold"}});
  candidates.push({malformed:"keep this candidate",results:"invalid array"});
  const result=compile(state);
  assert.equal(result.candidateCount,5);
  assert.ok(result.compiled.expected.entries.filter(e=>e.clientPackageId===null).length>=4);
  assert.ok(result.issues.some(i=>i.code==="research_key_missing"));
  assert.equal(canonicalJson(result.exported.sourceInventory.state),canonicalJson(state));
  assert.equal(result.compiled.expected.entries.length,result.revisionCount);
});
test("identity aliases stay raw and invalid source keys never get rewritten into valid keys",()=>{
  const state=coordinatorFixture();
  state.candidates[0].results[0].record.sourceRecordKey="official:synthetic" as never;
  const result=compile(state),packages=result.compiled.packages.filter(p=>p.envelope.subject.researchKey==="domain:synthetic-0.example");
  assert.ok(packages.length);assert.ok(packages.every(p=>p.envelope.subject.identityState==="conflict"&&p.envelope.subject.sourceRecordKey===null));
  assert.ok(canonicalJson(packages[0].envelope.originalResearch.content).includes("official:synthetic"));
});
test("whole-firm semantic events survive state refreshes while snapshot/package identities change",()=>{
  const state=coordinatorFixture(),a=compile(state);
  state.updatedAt="2026-09-24T12:00:00.000Z";const b=compile(state);
  const lineage=(r:typeof a)=>r.compiled.packages.flatMap(p=>items(p.envelope).map(i=>[i.sourceEventKey,i.semanticSha256])).sort();
  assert.deepEqual(lineage(a),lineage(b));
  assert.notEqual(a.compiled.expected.runId,b.compiled.expected.runId);
  assert.notEqual(a.compiled.packages[0].envelope.packageId,b.compiled.packages[0].envelope.packageId);
});
test("explicit multiple assessments retain only linked findings plus unassigned evidence and retractions",()=>{
  const state=coordinatorFixture(),raw=state.candidates[0].results[0] as unknown as Record<string,unknown>;
  const record=raw.record as Record<string,unknown>;
  const services=record.services as Record<string,unknown>[];
  services[0].observationId="service-original";
  services.push({description:"Retraction example",sourceUrl:"https://synthetic.example/team",observedAt:"2026-09-22",evidenceState:"retracted",retractionReason:"Synthetic corrected source",observationId:"retracted-original"});
  raw.qualificationAssessments=[{assessmentId:"assessment-one",disposition:"held",reason:"One explicit history",observationIds:["service-original"]},{assessmentId:"assessment-two",disposition:"rejected",reason:"Second explicit history",observationIds:["retracted-original"]}];
  const result=compile(state),ps=result.compiled.packages.filter(p=>p.envelope.subject.researchKey==="domain:synthetic-0.example");
  assert.equal(ps.filter(p=>p.envelope.assessment).length,2);
  assert.ok(ps.some(p=>p.envelope.assessment===null));
  assert.ok(ps.some(p=>p.envelope.observations.some(o=>o.evidenceState==="retracted")));
  assert.ok(ps.filter(p=>p.envelope.assessment).every(p=>p.envelope.observations.length===1));
});
test("exact-state snapshot archives raw bytes and bad references become distinct manifest holds",async t=>{
  const w=await workspace(t),state=coordinatorFixture();
  const capture=path.join(w.sourceRoot,"operations/luna_continuous_v1/workers/synthetic/capture.json");
  await fs.mkdir(path.dirname(capture),{recursive:true});await fs.writeFile(capture,'{"synthetic":"capture"}\n');
  state.candidates[0].results[0].evidenceArtifacts=["operations/luna_continuous_v1/workers/synthetic/capture.json","operations/luna_continuous_v1/workers/synthetic/missing.json","../../outside.json"];
  const bytes=Buffer.from(JSON.stringify(state,null,2));await fs.writeFile(w.statePath,bytes);
  const result=await snapshotCoordinatorState({...w,snapshotAt:producerDate});
  assert.ok((await fs.readFile(result.stateArchive)).equals(bytes));assert.ok((await fs.readFile(w.statePath)).equals(bytes));
  const source=JSON.parse(await fs.readFile(path.join(result.runDir,"source-manifest.json"),"utf8")) as WholeFirmSourceManifest;
  const compiled=compileWholeFirmSnapshot(source);
  assert.ok(compiled.expected.entries.some(e=>e.errorCodes.includes("reference_read_failed")&&e.clientPackageId===null));
  assert.ok(compiled.expected.entries.some(e=>e.errorCodes.includes("reference_out_of_scope")&&e.clientPackageId===null));
  const replay=await snapshotCoordinatorState({...w,snapshotAt:producerDate});
  assert.equal(replay.sourceManifestSha256,result.sourceManifestSha256);
  assert.equal(result.networkRequests,0);
});
test("state or referenced-byte change fails before a deliverable snapshot is written",async t=>{
  const w=await workspace(t),state=coordinatorFixture();await fs.writeFile(w.statePath,JSON.stringify(state));
  await assert.rejects(snapshotCoordinatorState({...w,snapshotAt:producerDate,beforeRecheck:async file=>{if(file===await fs.realpath(w.statePath))await fs.appendFile(file," ");}}),/source_changed_during_snapshot/);
  await assert.rejects(fs.access(path.join(w.outputRoot,"exports")));
  const state2=coordinatorFixture(),capture=path.join(w.sourceRoot,"operations/luna_continuous_v1/workers/synthetic/a.txt");
  await fs.mkdir(path.dirname(capture),{recursive:true});await fs.writeFile(capture,"original");
  state2.candidates[0].results[0].evidenceArtifacts=["operations/luna_continuous_v1/workers/synthetic/a.txt"];await fs.writeFile(w.statePath,JSON.stringify(state2));
  await assert.rejects(snapshotCoordinatorState({...w,snapshotAt:producerDate,beforeRecheck:async file=>{if(file===await fs.realpath(capture))await fs.writeFile(file,"changed");}}),/source_changed_during_snapshot/);
  await fs.writeFile(capture,"original");
  await assert.rejects(snapshotCoordinatorState({...w,snapshotAt:producerDate,beforeRecheck:async file=>{if(file===await fs.realpath(w.statePath))await fs.writeFile(capture,"changed after first capture check");}}),/source_changed_during_snapshot/);
  await assert.rejects(fs.access(path.join(w.outputRoot,"exports")));

});
test("coordinator input is explicit and mutually exclusive without reading any input",async()=>{
  await assert.rejects(main(["inventory","--profile","whole-firm","--file","never-read.json","--coordinator-state","never-read.json"]),/mutually_exclusive/);
  await assert.rejects(main(["inventory","--coordinator-state","never-read.json"]),/coordinator_state_input_scope_invalid/);
});
test("source event IDs use whole-firm adapter constants, and all original source fields survive",()=>{
  const result=compile(coordinatorFixture()),p=result.compiled.packages[0],source=p.envelope.sources[0];
  assert.ok(object(p.envelope.originalResearch.content));
  const {sourceId,...semantic}=source;
  assert.equal(sourceId,"src-"+protocolHash(["whole-firm-adapter/v1","caseload-whole-firm-v1",p.envelope.subject.researchKey,"source",semantic]).slice(0,48));
});

test("explicit intake and research-attempt facts map while unqualified counts stay raw",()=>{
  const state=coordinatorFixture(),raw=state.candidates[0].results[0] as unknown as Record<string,unknown>,record=raw.record as Record<string,unknown>;
  (record.lawyerCount as Record<string,unknown>).firmWide=false;
  record.websiteIntake={pageUrl:"https://synthetic.example/intake",observedAt:"2026-09-22",visibleChannels:["form"],visibleFields:["name","message"],opportunityState:"not_established",summary:"Synthetic page summary",observation:"Name and message are visible",interpretation:"Hidden routing is unknown",unknowns:["Internal workflow"]};
  raw.researchFailures=[{provider:"Synthetic provider",queryOrUrl:"https://synthetic.example/source",sourceUrl:"https://synthetic.example/source",observedAt:"2026-09-22",outcome:"http-error",coverage:"failed",reason:"Synthetic source unavailable"}];
  const result=compile(state),observations=result.compiled.packages.filter(p=>p.envelope.subject.researchKey==="domain:synthetic-0.example").flatMap(p=>p.envelope.observations);
  assert.ok(observations.some(o=>o.kind==="website_intake"&&o.data.visibleFields.length===2&&o.data.opportunityState==="not_established"));
  assert.ok(observations.some(o=>o.kind==="research_attempt"&&o.data.coverage==="failed"));
  assert.ok(observations.some(o=>o.kind==="roster"&&o.data.lawyerCount===null&&o.data.countQualifier==="unknown"));
  assert.ok(result.issues.some(i=>i.code==="roster_count_qualifier_not_recorded"));
});
test("receipt reference hash mismatch and absent required hash remain distinct holds",async t=>{
  const w=await workspace(t),state=coordinatorFixture(),capture=path.join(w.sourceRoot,"data/qualification/synthetic-readback.json");
  await fs.mkdir(path.dirname(capture),{recursive:true});await fs.writeFile(capture,'{"synthetic":"readback"}');
  const candidate=state.candidates[0] as unknown as Record<string,unknown>;
  candidate.receipts=[{receiptId:"one",queryArtifact:"data/qualification/synthetic-readback.json",queryArtifactSha256:"e".repeat(64)},{receiptId:"two",queryArtifact:"data/qualification/synthetic-readback.json"}];
  await fs.writeFile(w.statePath,JSON.stringify(state));
  const output=await snapshotCoordinatorState({...w,snapshotAt:producerDate}),source=JSON.parse(await fs.readFile(path.join(output.runDir,"source-manifest.json"),"utf8"));
  const result=compileWholeFirmSnapshot(source);
  assert.ok(result.expected.entries.some(e=>e.errorCodes.includes("reference_hash_mismatch")&&e.clientPackageId===null));
  assert.ok(result.expected.entries.some(e=>e.errorCodes.includes("reference_expected_hash_invalid")&&e.clientPackageId===null));
});
