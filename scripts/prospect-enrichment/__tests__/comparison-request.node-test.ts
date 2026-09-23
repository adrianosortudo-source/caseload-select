import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileCandidate } from "../compiler";
import { buildExpectedRunManifest } from "../run-manifest";
import { serializeComparisonRequest, writeComparisonRequest } from "../comparison-request";
import { candidate, snapshot } from "../fixtures/synthetic";
import { canonicalJson, protocolHash, sha256, within } from "../model";
import { main } from "../cli";
import { coordinatorFixture } from "../fixtures/coordinator";
import { produceWholeFirmExport } from "../whole-firm-producer";
import { compileWholeFirmSnapshot, freezeWholeFirmExport } from "../whole-firm";
function fixture(){
  const input=candidate({workKey:"request-synthetic",firmName:"Synthetic Request Firm",qualificationAssessments:[{assessmentId:"synthetic-parent",qualificationState:"held",criteria:{directPublishedEmail:{address:"lawyer@synthetic.example",attributedTo:"Synthetic Lawyer",sourceUrl:"https://synthetic.example/person",observedAt:"2026-09-23"}}}]});
  const packages=compileCandidate(input,snapshot).packages;
  const manifest=buildExpectedRunManifest({schemaVersion:"prospect-backfill-manifest/v1",snapshotAt:snapshot.snapshotAt,manifestSha256:snapshot.manifestSha256,roots:[],artifacts:[],issues:[]},packages,[{researchKey:packages[0].envelope.subject.researchKey,sourceRoot:input.artifact.sourceRoot,relativePath:input.artifact.relativePath,sourcePointer:input.pointer,sourceSha256:input.artifact.fileSha256,packageIds:packages.map(p=>p.envelope.packageId),issues:[]},{researchKey:"synthetic-incomplete",sourceRoot:"root-a",relativePath:"data/synthetic-incomplete.json",sourcePointer:"",sourceSha256:"b".repeat(64),packageIds:[],issues:[{code:"hold_schema",path:"",reason:"Synthetic incomplete candidate"}]}],[]);
  const values=packages.map(p=>({envelope:p.envelope,payloadSha256:p.payloadSha256,legacyAssessmentProjectionClaims:p.legacyAssessmentProjectionClaims??[]}));
  return{manifest,values};
}
function rehash<T extends {manifestSha256:string}>(value:T):T{const content=Object.fromEntries(Object.entries(value).filter(([key])=>key!=="manifestSha256"));return{...value,manifestSha256:protocolHash(content)};}
async function workspace(t:{after:(fn:()=>Promise<void>)=>void}){
  const root=path.join(path.dirname(fileURLToPath(import.meta.url)),".tmp");
  await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,"comparison-request-synthetic-"));
  t.after(async()=>{const real=await fs.realpath(directory);assert.ok(within(root,real)&&path.basename(real).startsWith("comparison-request-synthetic-"));await fs.rm(real,{recursive:true,force:true});});
  const privateRoot=path.join(directory,"private");await fs.mkdir(privateRoot);
  return{directory,privateRoot};
}
test("comparison request is exact, deterministic, lossless and keeps claims outside the envelope",()=>{
  const {manifest,values}=fixture(),before=canonicalJson({manifest,values}),result=serializeComparisonRequest(manifest,values);
  assert.equal(result.request.schemaVersion,"prospect-enrichment-comparison-request/v1");
  assert.deepEqual(Object.keys(result.request).sort(),["manifest","packages","schemaVersion"]);
  assert.equal(result.request.manifest.entries.length,2);
  assert.equal(result.request.packages[0].legacyAssessmentProjectionClaims.length,1);
  assert.equal(Object.hasOwn(result.request.packages[0].envelope,"legacyAssessmentProjectionClaims"),false);
  assert.equal(result.bodySha256,sha256(result.body));assert.equal(result.body,serializeComparisonRequest(manifest,values).body);
  assert.equal(canonicalJson({manifest,values}),before);
});
test("complete package coverage, exact wrapper fields and payload hashes are mandatory",()=>{
  const {manifest,values}=fixture();
  for(const packages of [[],[...values,...values],[{...values[0],payloadSha256:"0".repeat(64)}],[{...values[0],extra:"not allowed"}],[{envelope:values[0].envelope,payloadSha256:values[0].payloadSha256}]])assert.throws(()=>serializeComparisonRequest(manifest,packages),/comparison_request_/);
  assert.throws(()=>serializeComparisonRequest(manifest,values.map(v=>JSON.stringify(v)).join("\n")),/package_coverage/);
});
test("manifest hash, exact lineage, entry identity and profile mismatches fail closed",()=>{
  const {manifest,values}=fixture();
  assert.throws(()=>serializeComparisonRequest({...manifest,generatedAt:"2026-09-24T12:00:00.000Z"},values),/manifest_hash_mismatch/);
  const lineage=structuredClone(manifest),entry=lineage.entries.find(e=>e.clientPackageId)!;entry.clientItems[0].semanticSha256="0".repeat(64);
  assert.throws(()=>serializeComparisonRequest(rehash(lineage),values),/package_manifest_mismatch/);
  const repeated=structuredClone(manifest);repeated.entries.push({...repeated.entries[0]});
  assert.throws(()=>serializeComparisonRequest(rehash(repeated),values),/manifest_entry_invalid/);
  assert.throws(()=>serializeComparisonRequest(manifest,values,"whole-firm"),/manifest_profile_mismatch/);
});
test("projection claims must match original criteria and immutable observation/parent IDs",()=>{
  const {manifest,values}=fixture(),bad=structuredClone(values);
  bad[0].legacyAssessmentProjectionClaims[0].selectedValueSha256="0".repeat(64);
  assert.throws(()=>serializeComparisonRequest(manifest,bad),/projection_claim_invalid/);
  const absent=structuredClone(values) as unknown as Record<string,unknown>[];delete absent[0].legacyAssessmentProjectionClaims;
  assert.throws(()=>serializeComparisonRequest(manifest,absent),/package_schema_invalid/);
});
test("atomic request writer creates a new private file without replacing existing content",async t=>{
  const w=await workspace(t),{manifest,values}=fixture(),manifestPath=path.join(w.directory,"manifest.json"),packagesPath=path.join(w.directory,"packages.json"),outputPath=path.join(w.privateRoot,"requests","synthetic.json");
  await fs.writeFile(manifestPath,JSON.stringify(manifest));await fs.writeFile(packagesPath,JSON.stringify(values));
  const result=await writeComparisonRequest({manifestPath,packagesPath,outputPath,privateRoot:w.privateRoot});
  assert.equal(result.networkRequests,0);assert.equal(result.packages,1);
  const bytes=await fs.readFile(outputPath,"utf8");assert.equal(bytes,serializeComparisonRequest(manifest,values).body);
  await assert.rejects(writeComparisonRequest({manifestPath,packagesPath,outputPath,privateRoot:w.privateRoot}),/EEXIST/);
  assert.equal(await fs.readFile(outputPath,"utf8"),bytes);
  assert.deepEqual(await fs.readdir(path.dirname(outputPath)),["synthetic.json"]);
});
test("invalid requests and outputs fail before a deliverable or network action",async t=>{
  const w=await workspace(t),{manifest}=fixture(),manifestPath=path.join(w.directory,"manifest.json"),packagesPath=path.join(w.directory,"packages.json"),outputPath=path.join(w.privateRoot,"bad.json");
  await fs.writeFile(manifestPath,JSON.stringify(manifest));await fs.writeFile(packagesPath,"[]");
  await assert.rejects(writeComparisonRequest({manifestPath,packagesPath,outputPath,privateRoot:w.privateRoot}),/package_coverage/);
  await assert.rejects(fs.access(outputPath));
  await assert.rejects(writeComparisonRequest({manifestPath:"never-read.json",packagesPath:"never-read.json",outputPath:path.join(w.directory,"outside.json"),privateRoot:w.privateRoot}),/outside_private_root/);
  await assert.rejects(main(["comparison-request","--manifest","never-read","--packages","never-read","--output","never-write","--execute"]),/cli_scope_invalid/);
  await assert.rejects(main(["comparison-request","--manifest","never-read","--packages","never-read","--output",outputPath]),/output_must_be_in_profile_private_root/);
});
test("whole-firm comparison request preserves every revision package and its projection claims",()=>{
  const produced=produceWholeFirmExport(coordinatorFixture(),{sourcePath:"synthetic-state",sourceSha256:"a".repeat(64),references:[]},snapshot.snapshotAt);
  const compiled=compileWholeFirmSnapshot(freezeWholeFirmExport(produced.exported,protocolHash(produced.exported)));
  const values=compiled.packages.map(p=>({envelope:p.envelope,payloadSha256:p.payloadSha256,legacyAssessmentProjectionClaims:p.legacyAssessmentProjectionClaims??[]}));
  const result=serializeComparisonRequest(compiled.expected,values,"whole-firm");
  assert.equal(result.request.packages.length,compiled.expected.expectedPackageCount);
  assert.equal(result.request.manifest.entries.length,compiled.expected.entries.length);
});
