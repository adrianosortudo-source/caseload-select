import test from "node:test";
import assert from "node:assert/strict";
import { compileCandidate } from "../compiler";
import { candidate, sample } from "../fixtures/synthetic";
import { canonicalJson, protocolHash, sha256 } from "../model";
import type { SourceManifest } from "../inventory";
import { buildExpectedRunManifest, buildHeldCandidateEvidence } from "../run-manifest";
import { main } from "../cli";
import { assertNoExclusionTokens, COHORT_SCHEMA, compileExclusionScoped, containsExclusionToken, EXCLUSION_SCHEMA, screenCandidate, validatePrivateExclusions, type ClosedCohortInventory, type ExcludedMember, type PrivateExclusions } from "../private-exclusions";

const blockedId = "22222222-2222-4222-8222-222222222222";
const allowedId = "11111111-1111-4111-8111-111111111111";
function fixture(extraDomains: string[] = []) {
  const members: ExcludedMember[] = [{
    memberKey: "synthetic-closed-member",
    identities: [
      { namespace: "databaseFirmId", sourceSystem: null, value: blockedId },
      { namespace: "domain", sourceSystem: null, value: "excluded.example" },
      ...extraDomains.map(value => ({ namespace: "domain", sourceSystem: null, value })),
      { namespace: "firmName", sourceSystem: null, value: "excluded synthetic firm" },
      { namespace: "researchKey", sourceSystem: "root-a", value: "excluded-research" },
      { namespace: "sourceRecordKey", sourceSystem: "root-a", value: "excluded-source" },
    ].sort((a,b) => canonicalJson(a) < canonicalJson(b) ? -1 : 1) as ExcludedMember["identities"],
  }];
  const cohort: ClosedCohortInventory = {
    schemaVersion: COHORT_SCHEMA, cohortId: "synthetic-closed-cohort",
    provenance: { kind: "governed-closed-cohort-export", exportId: "synthetic-export", exportedAt: "2026-09-24T12:00:00Z", membershipScope: "all-cohort-members-all-statuses", membershipPolicyVersion: "closed-cohort-membership/v1" },
    declaredMemberCount: members.length, membersSha256: protocolHash(members), members,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(cohort)), original = candidate({});
  const artifact = { ...original.artifact, relativePath: "data/synthetic-cohort.json", size: bytes.length, fileSha256: sha256(bytes), archivePath: "synthetic-only-cohort" };
  const content = { schemaVersion: "prospect-backfill-manifest/v1" as const, snapshotAt: "2026-09-24T12:00:00Z", roots: [{id:"root-a",path:"synthetic-only"}], artifacts: [artifact], issues: [] };
  const source: SourceManifest = { ...content, manifestSha256: protocolHash(content) };
  const rules: PrivateExclusions = {
    schemaVersion: EXCLUSION_SCHEMA, sourceManifestSha256: source.manifestSha256,
    cohortInventory: { sourceRoot: artifact.sourceRoot, relativePath: artifact.relativePath, fileSha256: artifact.fileSha256, schemaVersion: COHORT_SCHEMA, declaredMemberCount: members.length },
    members: structuredClone(members), rulesSha256: protocolHash(members),
  };
  return { source, rules, bytes, cohort };
}
function context() { const f=fixture(); return validatePrivateExclusions(f.source,f.rules,f.bytes); }
function eligible() {
  const raw=sample(); Object.assign(raw.record, {databaseFirmId: allowedId});
  return candidate(raw);
}
function rejection(change: (f:ReturnType<typeof fixture>)=>void) {
  const f=fixture(); change(f); assert.throws(()=>validatePrivateExclusions(f.source,f.rules,f.bytes), /exclusion_coverage_unproven|source_manifest_hash_mismatch/);
}
test("closed independent cohort and exact rule set derive deterministic run scope without changing artifacts",()=>{
  const f=fixture(), one=validatePrivateExclusions(f.source,f.rules,f.bytes), two=validatePrivateExclusions(f.source,f.rules,f.bytes);
  assert.deepEqual(one,two);
  assert.notEqual(one.source.manifestSha256,f.source.manifestSha256);
  assert.deepEqual(one.source.artifacts,f.source.artifacts);
  assert.equal(one.originalSourceManifestSha256,f.source.manifestSha256);
  const result=compileCandidate(eligible(),one.source);
  assert.equal(result.packages[0].envelope.runId,"backfill-"+one.source.manifestSha256.slice(0,48));
  assert.equal(result.packages[0].envelope.subject.databaseFirmId,allowedId);
  assert.equal(result.packages[0].envelope.subject.identityState,"unresolved");
  assert.deepEqual(result.packages,compileCandidate(eligible(),two.source).packages);
});
test("self-declared complete and legacy open Q50 schema cannot establish coverage",()=>{
  for(const bad of [{complete:true,members:[]},{schemaVersion:"luna-q50-manifest-v1",qualifiedCount:1,qualifiedFirms:[],holdFirms:[],reserveFirms:[]}]){
    const f=fixture(), bytes=new TextEncoder().encode(JSON.stringify(bad));
    f.source.artifacts[0].fileSha256=sha256(bytes); f.rules.cohortInventory.fileSha256=sha256(bytes);
    const content={...f.source}; delete (content as Partial<SourceManifest>).manifestSha256; f.source.manifestSha256=protocolHash(content); f.rules.sourceManifestSha256=f.source.manifestSha256;
    assert.throws(()=>validatePrivateExclusions(f.source,f.rules,bytes),/exclusion_coverage_unproven/);
  }
});
test("missing, duplicate and unrepresented excluded members fail the whole compile",()=>{
  rejection(f=>{f.rules.members=[];f.rules.rulesSha256=protocolHash([]);});
  rejection(f=>{f.rules.members.push(structuredClone(f.rules.members[0]));f.rules.rulesSha256=protocolHash(f.rules.members);});
  rejection(f=>{f.rules.members[0].memberKey="unrepresented";f.rules.rulesSha256=protocolHash(f.rules.members);});
  rejection(f=>{f.rules.members[0].identities.pop();f.rules.rulesSha256=protocolHash(f.rules.members);});
  rejection(f=>{f.rules.cohortInventory.declaredMemberCount=2;});
  rejection(f=>{f.rules.members[0].identities[0].sourceSystem="wrong-namespace";f.rules.rulesSha256=protocolHash(f.rules.members);});
});
test("frozen source, inventory bytes, schema, count and rules hash are all mandatory",()=>{
  rejection(f=>{f.rules.sourceManifestSha256="f".repeat(64);});
  rejection(f=>{f.bytes=new TextEncoder().encode("tampered");});
  rejection(f=>{f.rules.rulesSha256="f".repeat(64);});
  rejection(f=>{f.rules.cohortInventory.schemaVersion="unknown" as typeof COHORT_SCHEMA;});
  rejection(f=>{f.source.artifacts.push(f.source.artifacts[0]);});
  rejection(f=>{f.rules.cohortInventory.relativePath="not-in-manifest";});
});
test("clear eligible source claims do not become verified identity",()=>{
  assert.equal(screenCandidate(eligible(),context()),"eligible");
  assert.equal(screenCandidate(candidate({firmName:"A",canonicalDomain:"www.synthetic.example",databaseFirmId:allowedId}),context()),"eligible");
});
test("missing, malformed, multiple, parent-conflicting and nested-alias claims are held",()=>{
  const values=[
    {firmName:"A"},
    {firmName:"A",databaseFirmId:allowedId},
    {firmName:"A",canonicalDomain:"synthetic.example"},
    {firmName:"A",canonicalDomain:"synthetic.example",databaseFirmId:"bad"},
    {firmName:"A",canonicalDomain:["synthetic.example","other.example"],databaseFirmId:allowedId},
    {firmName:"A",canonicalDomain:"synthetic.example",databaseFirmId:allowedId,record:{databaseFirmId:"33333333-3333-4333-8333-333333333333"}},
    {firmName:"A",canonicalDomain:"synthetic.example",databaseFirmId:allowedId,identity:{aliases:[{firmName:"Different name"}]}},
    {firmName:"A",canonicalDomain:"synthetic.example",databaseFirmId:allowedId,identity:{aliases:["unknown-namespace-alias"]}},
    {firmName:"A",canonicalDomain:"synthetic.example",databaseFirmId:allowedId,sourceRecordKey:"one",record:{sourceRecordKey:"two"}},
  ];
  for(const value of values) assert.equal(screenCandidate(candidate(value),context()),"identity_uncertain",JSON.stringify(value));
  const input=eligible(); input.parentMetadata={canonicalDomain:"other.example"};
  assert.equal(screenCandidate(input,context()),"identity_uncertain");
});
test("any exact excluded claim excludes even an otherwise incomplete or conflicting identity",()=>{
  for(const original of [
    {databaseFirmId:blockedId},{canonicalDomain:"https://www.excluded.example/"},
    {firmName:"EXCLUDED SYNTHETIC FIRM"},{sourceRecordKey:"excluded-source"},
    {researchKey:"excluded-research"},{databaseFirmId:allowedId,identity:{aliases:[{databaseFirmId:blockedId}]}},
  ]) assert.equal(screenCandidate(candidate(original),context()),"excluded");
});
test("wrong namespace is never an identity match but cannot leak as a false eligible result",()=>{
  const input=eligible(); input.original.sourceSystem="another-source"; input.original.sourceRecordKey="excluded-source";
  assert.equal(screenCandidate(input,context()),"identity_uncertain");
  const two=eligible(); two.original.workKey="excluded-source";
  assert.equal(screenCandidate(two,context()),"identity_uncertain");
});
test("all retained metadata, key strings and source pointers are token scanned",()=>{
  for(const modify of [
    (input:ReturnType<typeof eligible>)=>{input.original.note="Historical https://www.excluded.example/path";},
    (input:ReturnType<typeof eligible>)=>{input.parentMetadata.note=blockedId;},
    (input:ReturnType<typeof eligible>)=>{input.original["excluded-research"]=true;},
    (input:ReturnType<typeof eligible>)=>{input.pointer="/excluded-source";},
  ]){const input=eligible();modify(input);assert.equal(screenCandidate(input,context()),"identity_uncertain");}
  assert.throws(()=>assertNoExclusionTokens({generated:{note:"excluded.example"}},context()),/exclusion_token_in_compiled_output/);
});
test("scope compile accounts every candidate occurrence and emits no omitted held-evidence/raw details",()=>{
  const ctx=context(), inputs=[eligible(),candidate({databaseFirmId:blockedId}),candidate({firmName:"Uncertain synthetic"})];
  const documents=inputs.map((input,i)=>({artifact:input.artifact,pointer:"/"+i,value:input.original}));
  const result=compileExclusionScoped(ctx,documents);
  assert.equal(result.audit.candidateOccurrenceCount,3);assert.equal(result.audit.eligibleCount,1);
  assert.equal(result.audit.excludedCount,1);assert.equal(result.audit.identityUncertainHoldCount,1);
  assert.equal(result.candidates.length,1);assert.ok(result.packages.length);
  assert.equal(result.candidates[0].sourceSha256,inputs[0].artifact.fileSha256);assert.equal(result.candidates[0].sourcePointer,"/0");
  const expected=buildExpectedRunManifest(ctx.source,result.packages,result.candidates,result.issues);
  const held=buildHeldCandidateEvidence(expected,result.candidates);
  assertNoExclusionTokens({result,expected,held},ctx);assert.deepEqual(held,[]);
  assert.equal(canonicalJson(result).includes("Uncertain synthetic"),false);
  const {auditSha256,...content}=result.audit;assert.equal(auditSha256,protocolHash(content));
  assert.deepEqual(result,compileExclusionScoped(ctx,documents));
});
test("unscoped file issues containing excluded tokens fail before output writes",()=>{
  assert.throws(()=>compileExclusionScoped(context(),[],[{code:"source_read_failed",path:"excluded.example/file",reason:"unavailable"}]),/exclusion_token_in_compiled_output/);
});
test("private exclusion flags are restricted to legacy compile before file or network use",async()=>{
  for(const args of [["inventory"],["submit"],["compile","--profile","whole-firm"]]){
    await assert.rejects(()=>main([...args,"--exclusions","never-opened"]),/exclusions_cli_scope_invalid/);
  }
});
test("token-free text alone cannot satisfy eligibility",()=>{
  const input=candidate({firmName:"Synthetic Clear",note:"contains no excluded tokens"});
  assert.equal(containsExclusionToken(input,context()),false);
  assert.equal(screenCandidate(input,context()),"identity_uncertain");
});

test("identity-less and malformed members in explicit collections remain count-only holds",()=>{
  const input=eligible();
  const value={records:[input.original,{observations:[]},{unknown:"raw unknown"},null,42]};
  const result=compileExclusionScoped(context(),[{artifact:input.artifact,pointer:"",value}]);
  assert.equal(result.audit.candidateOccurrenceCount,5);
  assert.equal(result.audit.eligibleCount,1);assert.equal(result.audit.identityUncertainHoldCount,4);
  assert.equal(result.candidates.length,1);assert.equal(canonicalJson(result).includes("raw unknown"),false);
});
test("ancestor identity conflicts cannot be overwritten by a nested container",()=>{
  const input=eligible();
  const value={canonicalDomain:"ancestor-conflict.example",records:[{canonicalDomain:"synthetic.example",records:[input.original]}]};
  // Give the containers no directly recognized firm identity, while retaining both domain claims.
  const result=compileExclusionScoped(context(),[{artifact:input.artifact,pointer:"",value}]);
  assert.equal(result.audit.identityUncertainHoldCount,1);assert.equal(result.packages.length,0);
});

test("every excluded domain alias is retained, hashed and matched without relaxing candidate uniqueness",()=>{
  const f=fixture(["excluded-alias.example"]), ctx=validatePrivateExclusions(f.source,f.rules,f.bytes);
  assert.equal(ctx.rules.filter(rule=>rule.namespace==="domain").length,2);
  assert.notEqual(ctx.source.manifestSha256,context().source.manifestSha256);
  assert.equal(screenCandidate(candidate({canonicalDomain:"https://www.excluded-alias.example/"}),ctx),"excluded");
  const allowed=eligible(); allowed.original.identity={aliases:[{canonicalDomain:"other-allowed.example"}]};
  assert.equal(screenCandidate(allowed,ctx),"identity_uncertain");
});
test("invalid, empty or duplicate excluded aliases fail rather than disappearing",()=>{
  for(const alias of ["","bad/path","UPPER.example","excluded.example"]){
    const f=fixture([alias]); assert.throws(()=>validatePrivateExclusions(f.source,f.rules,f.bytes),/exclusion_coverage_unproven/);
  }
});
test("a domain alias shared across independent members makes coverage ambiguous",()=>{
  const f=fixture(["excluded-alias.example"]);
  f.cohort.members.push({memberKey:"synthetic-second-member",identities:[
    {namespace:"databaseFirmId",sourceSystem:null,value:"33333333-3333-4333-8333-333333333333"},
    {namespace:"domain",sourceSystem:null,value:"excluded-alias.example"},
  ].sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:1) as ExcludedMember["identities"]});
  f.cohort.declaredMemberCount=2; f.cohort.membersSha256=protocolHash(f.cohort.members);
  const bytes=new TextEncoder().encode(JSON.stringify(f.cohort));
  f.source.artifacts[0].fileSha256=sha256(bytes); f.source.artifacts[0].size=bytes.length;
  const content={...f.source}; delete (content as Partial<SourceManifest>).manifestSha256;
  f.source.manifestSha256=protocolHash(content);
  f.rules.sourceManifestSha256=f.source.manifestSha256;
  f.rules.cohortInventory.fileSha256=sha256(bytes); f.rules.cohortInventory.declaredMemberCount=2;
  f.rules.members=structuredClone(f.cohort.members);f.rules.rulesSha256=protocolHash(f.rules.members);
  assert.throws(()=>validatePrivateExclusions(f.source,f.rules,bytes),/exclusion_coverage_unproven/);
});
