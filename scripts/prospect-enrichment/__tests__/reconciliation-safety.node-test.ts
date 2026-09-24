import test from "node:test";
import assert from "node:assert/strict";
import { compileCandidate } from "../compiler";
import { candidate, sample, snapshot } from "../fixtures/synthetic";
import { canonicalJson, protocolHash } from "../model";
import { items, reconcilePackage, researchClaimsAccepted, validateComparisonSnapshot, type ComparisonSnapshot, type Target } from "../reconciliation";
import type { ComparisonExportInput } from "../comparison-export";
import { serializeSyntheticComparisonExport as serializeComparisonExport } from "../fixtures/comparison-signing";

function fixture() {
  const compiled=compileCandidate(candidate(sample()),snapshot).packages.find(p=>p.envelope.observations.length)!;
  const e=compiled.envelope;
  const content:ComparisonExportInput={
    schemaVersion:"prospect-enrichment-comparison/v1",projectId:"ssxryjxifwiivghglqer",capturedAt:snapshot.snapshotAt,
    provenance:{reader:"synthetic-authenticated-reader",sourceArtifactSha256:"d".repeat(64),operatorAuthenticated:true},
    identities:[{researchKey:e.subject.researchKey,databaseFirmId:"11111111-1111-4111-8111-111111111111",stableFirmId:null,sourceRecordKey:"synthetic-source-key",canonicalDomain:"synthetic.example"}],packages:[],
    events:items(e).map(item=>{
      const primary:Target={table:item.kind==="source"?"prospect_source_captures":item.kind==="assessment"?"gta_prospect_qualification_assessments":"prospect_service_observations",id:"22222222-2222-4222-8222-222222222222",rowSha256:"a".repeat(64)};
      return{sourceEventKey:item.sourceEventKey,semanticSha256:item.semanticSha256,researchKey:e.subject.researchKey,targets:[{table:"gta_prospect_import_audit",id:"33333333-3333-4333-8333-333333333333",rowSha256:"b".repeat(64)},primary],primaryTarget:primary,visible:true};
    })
  };
  return{compiled,content};
}
const freeze=(content:ComparisonExportInput)=>serializeComparisonExport(content,snapshot.snapshotAt).snapshot;
test("null and false Admin evidence visibility both fail closed and remain distinguishable",()=>{
  const {compiled,content}=fixture();
  const reasons:string[]=[];
  for(const visible of [null,false] as const){
    const input=structuredClone(content);input.events[0].visible=visible;
    const action=reconcilePackage(compiled,freeze(input),{now:snapshot.snapshotAt});
    assert.equal(action.action,"receipt_unverified");assert.equal(action.envelope.mode,"propose");assert.equal(action.linked.length,0);
    assert.ok(action.envelope.observations.every(o=>o.existingRecord===null));reasons.push(action.reason);
  }
  assert.notEqual(reasons[0],reasons[1]);assert.match(reasons[0],/unknown/);assert.match(reasons[1],/known absent/);
});
test("explicit primary target wins over auxiliary target ordering, with identical selected rows",()=>{
  const {compiled,content}=fixture(),first=reconcilePackage(compiled,freeze(content),{now:snapshot.snapshotAt});
  assert.equal(first.action,"link_existing");
  assert.ok(first.envelope.observations.every(o=>o.existingRecord?.table==="prospect_service_observations"));
  const reversed=structuredClone(content);reversed.events.forEach(e=>e.targets.reverse());
  const second=reconcilePackage(compiled,freeze(reversed),{now:snapshot.snapshotAt});
  assert.deepEqual(second.envelope,first.envelope);
  assert.notEqual(freeze(reversed).snapshotSha256,freeze(content).snapshotSha256);
});
test("null, missing, mismatching or auxiliary primary cannot supply typed existingRecord",()=>{
  const {compiled,content}=fixture();
  const absent=structuredClone(content);absent.events[0].primaryTarget=null;
  assert.equal(reconcilePackage(compiled,freeze(absent),{now:snapshot.snapshotAt}).action,"receipt_unverified");
  const missing=structuredClone(content) as unknown as {events:Record<string,unknown>[]};
  delete missing.events[0].primaryTarget;
  assert.throws(()=>serializeComparisonExport(missing,snapshot.snapshotAt),/schema_invalid/);
  const hashed={...missing,snapshotSha256:protocolHash(missing)} as unknown as ComparisonSnapshot;
  assert.ok(validateComparisonSnapshot(hashed,snapshot.snapshotAt).some(i=>i.code==="comparison_primary_target_invalid"));
  const mismatch=structuredClone(content);mismatch.events[0].primaryTarget={table:"prospect_source_captures",id:"not-present",rowSha256:"c".repeat(64)};
  assert.throws(()=>freeze(mismatch),/schema_invalid/);
  const aux=structuredClone(content),observation=aux.events.find(e=>e.sourceEventKey.startsWith("observation:"))!;
  observation.primaryTarget=observation.targets[0];
  assert.equal(reconcilePackage(compiled,freeze(aux),{now:snapshot.snapshotAt}).action,"receipt_unverified");
});
test("failed visibility clears previously linked metadata and cannot hide behind an applied package receipt",()=>{
  const {compiled,content}=fixture(),linked=reconcilePackage(compiled,freeze(content),{now:snapshot.snapshotAt});
  assert.equal(linked.action,"link_existing");
  const previous={...compiled,envelope:linked.envelope,payloadSha256:protocolHash(linked.envelope)};
  const later=structuredClone(content);later.events[0].visible=null;
  later.packages.push({clientPackageId:previous.envelope.packageId,payloadSha256:previous.payloadSha256,state:"applied",serverPackageId:"44444444-4444-4444-8444-444444444444",visible:true});
  const result=reconcilePackage(previous,freeze(later),{now:snapshot.snapshotAt});
  assert.equal(result.action,"receipt_unverified");assert.ok(result.envelope.observations.every(o=>o.existingRecord===null));assert.equal(result.envelope.mode,"propose");
});
test("primary target participates in canonical snapshot SHA and does not mutate reader input",()=>{
  const {content}=fixture(),before=canonicalJson(content),good=freeze(content);
  const nulled=structuredClone(content);nulled.events[0].primaryTarget=null;
  assert.notEqual(freeze(nulled).snapshotSha256,good.snapshotSha256);assert.equal(canonicalJson(content),before);
});

test("preserved coordinator receipt claims require verified lineage rather than a new import",()=>{
  const {compiled,content}=fixture();
  const claims={candidateContext:{receipts:[{receiptId:"synthetic-existing-receipt"}]},result:{disposition:"complete"}};
  assert.equal(researchClaimsAccepted(claims),true);
  content.events=[];
  const action=reconcilePackage(compiled,freeze(content),{now:snapshot.snapshotAt,sourceClaimsAccepted:researchClaimsAccepted(claims)});
  assert.equal(action.action,"receipt_unverified");
});

test("stored false/null events with no targets cannot fall through to new staging or receipt reuse",()=>{
  const {compiled,content}=fixture(),reasons:string[]=[];
  for(const visible of [false,null] as const){
    const state=structuredClone(content);state.events=[{...state.events[0],targets:[],primaryTarget:null,visible}];
    const result=reconcilePackage(compiled,freeze(state),{now:snapshot.snapshotAt});
    assert.equal(result.action,"receipt_unverified");assert.equal(result.linked.length,0);assert.equal(result.envelope.mode,"propose");reasons.push(result.reason);
    state.packages.push({clientPackageId:compiled.envelope.packageId,payloadSha256:compiled.payloadSha256,state:"applied",serverPackageId:"44444444-4444-4444-8444-444444444444",visible:true});
    assert.equal(reconcilePackage(compiled,freeze(state),{now:snapshot.snapshotAt}).action,"receipt_unverified");
  }
  assert.notEqual(reasons[0],reasons[1]);
  const absent=structuredClone(content);absent.events=[];
  assert.equal(reconcilePackage(compiled,freeze(absent),{now:snapshot.snapshotAt}).action,"stage_new");
});

test("an explicit signed missing-package row permits one new stage only with null server identity and visibility",()=>{
  const {compiled,content}=fixture();
  content.events=[];
  content.packages=[{clientPackageId:compiled.envelope.packageId,payloadSha256:compiled.payloadSha256,state:"missing",serverPackageId:null,visible:null}];
  assert.equal(reconcilePackage(compiled,freeze(content),{now:snapshot.snapshotAt}).action,"stage_new");

  const malformed=structuredClone(content);
  malformed.packages[0].serverPackageId="44444444-4444-4444-8444-444444444444";
  assert.throws(()=>freeze(malformed),/schema_invalid/);

  const duplicate=structuredClone(content);
  duplicate.packages.push({...duplicate.packages[0]});
  assert.equal(reconcilePackage(compiled,freeze(duplicate),{now:snapshot.snapshotAt}).action,"receipt_unverified");
});
