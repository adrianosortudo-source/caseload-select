import test from "node:test";
import assert from "node:assert/strict";
import { compileCandidate } from "../compiler";
import { deriveLegacyAssessmentProjection } from "../legacy-projection-mapper";
import { isCriteriaSelector, selectOwnJsonPointer, validateLegacyAssessmentProjectionClaims } from "../legacy-projections";
import { items, reconcilePackage, type ComparisonSnapshot } from "../reconciliation";
import { serializeSyntheticComparisonExport as serializeComparisonExport } from "../fixtures/comparison-signing";
import { candidate, snapshot } from "../fixtures/synthetic";
import { coordinatorFixture } from "../fixtures/coordinator";
import { produceWholeFirmExport } from "../whole-firm-producer";
import { compileWholeFirmSnapshot, freezeWholeFirmExport } from "../whole-firm";
import { protocolHash } from "../model";
const firmId="11111111-1111-4111-8111-111111111111";
function fixture() {
  const criteria={decisionMaker:{name:"Synthetic Lawyer",role:"Principal"},directPublishedEmail:{address:"lawyer@synthetic.example",attributedTo:"Synthetic Lawyer",observedAt:"2026-09-23",sourceUrl:"https://synthetic.example/person"}};
  const compiled=compileCandidate(candidate({workKey:"synthetic-projection",firmName:"Synthetic Firm",qualificationAssessments:[{assessmentId:"original-parent",qualificationState:"held",criteria}]}),snapshot).packages.find(p=>p.envelope.assessment)!;
  const claim=compiled.legacyAssessmentProjectionClaims![0],parent=items(compiled.envelope).find(i=>i.kind==="assessment")!;
  const primaryTarget={table:"gta_prospect_qualification_assessments",id:"22222222-2222-4222-8222-222222222222",rowSha256:"e".repeat(64)};
  const derived=deriveLegacyAssessmentProjection(compiled.envelope,claim,criteria);
  assert.ok(derived);
  const content:Omit<ComparisonSnapshot,"snapshotSha256"|"signature">={
    schemaVersion:"prospect-enrichment-comparison/v1",projectId:"ssxryjxifwiivghglqer",capturedAt:snapshot.snapshotAt,
    provenance:{reader:"synthetic-supported-reader",sourceArtifactSha256:"d".repeat(64),operatorAuthenticated:true},
    identities:[{researchKey:compiled.envelope.subject.researchKey,databaseFirmId:firmId,stableFirmId:null,sourceRecordKey:"synthetic-source-key",canonicalDomain:null}],packages:[],
    events:[{sourceEventKey:parent.sourceEventKey,semanticSha256:parent.semanticSha256,researchKey:compiled.envelope.subject.researchKey,targets:[primaryTarget],primaryTarget,visible:true,legacyAssessmentProjections:[{...derived,parentAssessmentTarget:primaryTarget,databaseFirmId:firmId}]}]
  };
  return{criteria,compiled,claim,content};
}
const freeze=(content:Omit<ComparisonSnapshot,"snapshotSha256"|"signature">)=>serializeComparisonExport(content,snapshot.snapshotAt).snapshot;
test("only exact nested criteria produce claims and the pinned mapper replays the normalized child",()=>{
  const {criteria,compiled,claim}=fixture();
  assert.equal(claim.sourcePointer,"/qualificationAssessments/0/criteria/directPublishedEmail");
  assert.equal(claim.criteriaSelector,"/criteria/directPublishedEmail");
  assert.equal(claim.selectedValueSha256,protocolHash(criteria.directPublishedEmail));
  assert.deepEqual(validateLegacyAssessmentProjectionClaims(compiled.envelope,[claim]),[]);
  assert.ok(deriveLegacyAssessmentProjection(compiled.envelope,claim,criteria));
  const envelope=structuredClone(compiled.envelope);
  const child=envelope.observations[0];
  assert.equal(child.kind,"contact");
  if(child.kind==="contact") (child.data as unknown as {personName:string}).personName="Arbitrarily changed synthetic person";
  assert.equal(deriveLegacyAssessmentProjection(envelope,claim,criteria),null);
});
test("identical selected scalar/object is insufficient when stored source, date or mapping context differs",()=>{
  const {criteria,compiled,claim}=fixture();
  for(const altered of [
    {...criteria,directPublishedEmail:{...criteria.directPublishedEmail,observedAt:"2026-09-22"}},
    {...criteria,directPublishedEmail:{...criteria.directPublishedEmail,sourceUrl:"https://synthetic.example/other"}},
    {...criteria,decisionMaker:{...criteria.decisionMaker,role:"Different role"}},
  ]) assert.equal(deriveLegacyAssessmentProjection(compiled.envelope,claim,altered),null);
  assert.equal(deriveLegacyAssessmentProjection(compiled.envelope,{...claim,criteriaSelector:"/criteria/decisionMaker"},criteria),null);
});
test("safe RFC6901 selection resolves escaped own keys and rejects aliases and inherited properties",()=>{
  assert.equal(isCriteriaSelector("/criteria/key~1with~0escape"),true);
  assert.deepEqual(selectOwnJsonPointer({criteria:{"key/with~escape":false}},"/criteria/key~1with~0escape"),{found:true,value:false});
  for(const selector of ["/criteria","/criteria/","/criteria/bad~2escape","/criteria/__proto__/x","/criteria/constructor/x"]) assert.equal(isCriteriaSelector(selector),false);
  for(const selector of ["/criteria/01","/criteria/-","/criteria/length"]) assert.equal(selectOwnJsonPointer({criteria:["one","two"]},selector).found,false);
  assert.equal(selectOwnJsonPointer({criteria:Object.create({inherited:"not-owned"})},"/criteria/inherited").found,false);
});
test("missing parent proof never blanket-retains an observation; exact proof permits retain-only linkage",()=>{
  const {compiled,content}=fixture(),positive=reconcilePackage(compiled,freeze(content),{now:snapshot.snapshotAt,sourceClaimsAccepted:true});
  assert.equal(positive.action,"link_existing");assert.equal(positive.retained.length,1);
  assert.equal(positive.retained[0].reason,"already_preserved_in_linked_legacy_assessment");assert.equal(positive.envelope.observations[0].existingRecord,null);
  const absent=structuredClone(content);delete absent.events[0].legacyAssessmentProjections;
  const rejected=reconcilePackage(compiled,freeze(absent),{now:snapshot.snapshotAt,sourceClaimsAccepted:true});
  assert.equal(rejected.action,"receipt_unverified");assert.equal(rejected.retained.length,0);assert.equal(rejected.linked.length,0);
});
test("proof must match exact parent, firm, selector, selected value and child semantic hash",()=>{
  const {compiled,content}=fixture();
  const mutations=[
    (p:NonNullable<ComparisonSnapshot["events"][number]["legacyAssessmentProjections"]>[number])=>{p.databaseFirmId="33333333-3333-4333-8333-333333333333";},
    (p:NonNullable<ComparisonSnapshot["events"][number]["legacyAssessmentProjections"]>[number])=>{p.criteriaSelector="/criteria/decisionMaker";},
    (p:NonNullable<ComparisonSnapshot["events"][number]["legacyAssessmentProjections"]>[number])=>{p.selectedValueSha256="1".repeat(64);},
    (p:NonNullable<ComparisonSnapshot["events"][number]["legacyAssessmentProjections"]>[number])=>{p.observationSemanticSha256="2".repeat(64);},
    (p:NonNullable<ComparisonSnapshot["events"][number]["legacyAssessmentProjections"]>[number])=>{p.observationSourceEventKey="observation:"+"3".repeat(64);},
  ];
  for(const change of mutations){const altered=structuredClone(content);change(altered.events[0].legacyAssessmentProjections![0]);const action=reconcilePackage(compiled,freeze(altered),{now:snapshot.snapshotAt});assert.equal(action.action,"receipt_unverified");assert.equal(action.retained.length,0);}
  const wrongParent=structuredClone(content);wrongParent.events[0].legacyAssessmentProjections![0].parentAssessmentClientId="another-parent";
  assert.throws(()=>freeze(wrongParent),/comparison_legacy_projection_invalid/);
  const wrongTarget=structuredClone(content);wrongTarget.events[0].legacyAssessmentProjections![0].parentAssessmentTarget={...wrongTarget.events[0].primaryTarget!,rowSha256:"9".repeat(64)};
  assert.throws(()=>freeze(wrongTarget),/comparison_legacy_projection_invalid/);
});
test("proof is hash-covered and duplicate/unknown visibility does not authorize retention",()=>{
  const {compiled,content}=fixture(),withProof=freeze(content),without=structuredClone(content);delete without.events[0].legacyAssessmentProjections;
  assert.notEqual(withProof.snapshotSha256,freeze(without).snapshotSha256);
  const tampered=structuredClone(withProof);tampered.events[0].legacyAssessmentProjections![0].selectedValueSha256="0".repeat(64);
  assert.equal(reconcilePackage(compiled,tampered,{now:snapshot.snapshotAt}).action,"receipt_unverified");
  for(const visible of [false,null] as const){const altered=structuredClone(content);altered.events[0].visible=visible;assert.equal(reconcilePackage(compiled,freeze(altered),{now:snapshot.snapshotAt}).action,"receipt_unverified");}
  const duplicate=structuredClone(content);duplicate.events[0].legacyAssessmentProjections!.push({...duplicate.events[0].legacyAssessmentProjections![0]});
  assert.equal(reconcilePackage(compiled,freeze(duplicate),{now:snapshot.snapshotAt}).action,"receipt_unverified");
});
test("no accepted claim may stage new; a prior persistence claim without exact lineage stays unverified",()=>{
  const {compiled,content}=fixture();content.events=[];
  assert.equal(reconcilePackage(compiled,freeze(content),{now:snapshot.snapshotAt}).action,"stage_new");
  assert.equal(reconcilePackage(compiled,freeze(content),{now:snapshot.snapshotAt,sourceClaimsAccepted:true}).action,"receipt_unverified");
});
test("whole-firm nested criteria uses the same pure replay while explicitly linked outside evidence has no projection claim",()=>{
  const state=coordinatorFixture(),raw=state.candidates[0].results[0] as unknown as Record<string,unknown>;
  const service={observationId:"criteria-service",name:"Synthetic criteria service",observedAt:"2026-09-22",sourceUrl:"https://synthetic.example/service"};
  raw.qualificationAssessments=[{assessmentId:"whole-parent",disposition:"held",reason:"Synthetic held",criteria:{services:[service]}}];
  const produced=produceWholeFirmExport(state,{sourcePath:"synthetic-state",sourceSha256:"a".repeat(64),references:[]},snapshot.snapshotAt);
  const packages=compileWholeFirmSnapshot(freezeWholeFirmExport(produced.exported,protocolHash(produced.exported))).packages;
  const compiled=packages.find(p=>p.legacyAssessmentProjectionClaims?.length)!;
  assert.ok(compiled);const claim=compiled.legacyAssessmentProjectionClaims![0];
  assert.ok(deriveLegacyAssessmentProjection(compiled.envelope,claim,{services:[service]}));
  const outside=compileCandidate(candidate({workKey:"outside",services:[{...service,observationId:"outside-service"}],qualificationAssessments:[{assessmentId:"outside-parent",qualificationState:"held",observationIds:["outside-service"],criteria:{}}]}),snapshot).packages.find(p=>p.envelope.assessment)!;
  assert.equal(outside.envelope.observations.length,1);assert.deepEqual(outside.legacyAssessmentProjectionClaims,[]);
});
