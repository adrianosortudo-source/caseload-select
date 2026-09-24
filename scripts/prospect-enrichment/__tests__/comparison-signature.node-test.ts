import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { serializeComparisonExport, verifyAndSerializeComparisonExport, type ComparisonExportInput } from "../comparison-export";
import { configuredComparisonTrust, signComparisonSnapshot, verifyComparisonSignature } from "../comparison-signature";
import { assertFreshComparison, reconcilePackage, validateComparisonSnapshot, type ComparisonSnapshot } from "../reconciliation";
import { syntheticSigningKey, syntheticComparisonTrust, serializeSyntheticComparisonExport } from "../fixtures/comparison-signing";
import { candidate, snapshot } from "../fixtures/synthetic";
import { compileCandidate } from "../compiler";
import { protocolHash } from "../model";
function content():ComparisonExportInput {
  return{schemaVersion:"prospect-enrichment-comparison/v1",projectId:"ssxryjxifwiivghglqer",capturedAt:snapshot.snapshotAt,provenance:{reader:"synthetic-signed-server-reader",sourceArtifactSha256:"a".repeat(64),operatorAuthenticated:true},identities:[],packages:[],events:[]};
}
test("valid Ed25519 server signature verifies canonical snapshot bytes under explicit trusted public key",()=>{
  const signed=serializeSyntheticComparisonExport(content(),snapshot.snapshotAt);
  assert.equal(verifyComparisonSignature(signed.snapshot,syntheticComparisonTrust),null);
  assert.deepEqual(validateComparisonSnapshot(signed.snapshot,snapshot.snapshotAt,syntheticComparisonTrust),[]);
  assert.equal(verifyAndSerializeComparisonExport(signed.snapshot,snapshot.snapshotAt,syntheticComparisonTrust).body,signed.body);
  const reordered=Object.fromEntries(Object.entries(signed.snapshot).reverse());
  assert.equal(verifyComparisonSignature(reordered,syntheticComparisonTrust),null);
});
test("modified content with a recomputed unkeyed snapshot hash still fails server signature verification",()=>{
  const signed=serializeSyntheticComparisonExport(content(),snapshot.snapshotAt).snapshot;
  signed.provenance.reader="edited-by-client";
  const {snapshotSha256:_old,signature:_sig,...body}=signed;void _old;void _sig;
  signed.snapshotSha256=protocolHash(body);
  assert.equal(verifyComparisonSignature(signed,syntheticComparisonTrust),"comparison_signature_invalid");
  assert.throws(()=>assertFreshComparison(signed,snapshot.snapshotAt,syntheticComparisonTrust),/comparison_signature_invalid/);
  assert.throws(()=>verifyAndSerializeComparisonExport(signed,snapshot.snapshotAt,syntheticComparisonTrust),/comparison_signature_invalid/);
});
test("unknown key id and re-labeled key id cannot authorize a comparison",()=>{
  const signed=serializeSyntheticComparisonExport(content(),snapshot.snapshotAt).snapshot;
  signed.signature.keyId="unknown-key";
  assert.equal(verifyComparisonSignature(signed,syntheticComparisonTrust),"comparison_signature_unknown_key");
  assert.equal(verifyComparisonSignature(signed,{...syntheticComparisonTrust,keyId:"unknown-key"}),"comparison_signature_invalid");
});
test("missing trusted public-key configuration and unkeyed authentication markers fail closed",()=>{
  const signed=serializeSyntheticComparisonExport(content(),snapshot.snapshotAt).snapshot;
  assert.equal(configuredComparisonTrust({}),null);
  assert.equal(verifyComparisonSignature(signed,null),"comparison_trust_config_missing");
  assert.throws(()=>assertFreshComparison(signed,snapshot.snapshotAt,null),/comparison_trust_config_missing/);
  assert.throws(()=>serializeComparisonExport(content(),snapshot.snapshotAt),/comparison_signing_key_missing/);
  const unsigned={...content(),snapshotSha256:protocolHash(content())} as unknown as ComparisonSnapshot;
  assert.equal(verifyComparisonSignature(unsigned,syntheticComparisonTrust),"comparison_signature_missing_or_invalid");
  const compiled=compileCandidate(candidate({workKey:"unsigned-synthetic",firmName:"Synthetic",status:"held"}),snapshot).packages[0];
  assert.equal(reconcilePackage(compiled,unsigned,{now:snapshot.snapshotAt,comparisonTrust:syntheticComparisonTrust}).action,"receipt_unverified");
  assert.equal(reconcilePackage(compiled,signed,{now:snapshot.snapshotAt,comparisonTrust:null}).action,"receipt_unverified");
});
test("wrong public key, invalid key material and altered signature fail without unsigned fallback",()=>{
  const signed=serializeSyntheticComparisonExport(content(),snapshot.snapshotAt).snapshot;
  const other=generateKeyPairSync("ed25519").publicKey.export({format:"pem",type:"spki"}).toString();
  assert.equal(verifyComparisonSignature(signed,{...syntheticComparisonTrust,publicKeyPem:other}),"comparison_signature_invalid");
  assert.equal(verifyComparisonSignature(signed,{...syntheticComparisonTrust,publicKeyPem:"not a PEM"}),"comparison_trust_key_invalid");
  signed.signature.signatureBase64=(signed.signature.signatureBase64[0]==="A"?"B":"A")+signed.signature.signatureBase64.slice(1);
  assert.equal(verifyComparisonSignature(signed,syntheticComparisonTrust),"comparison_signature_invalid");
  assert.throws(()=>signComparisonSnapshot({snapshotSha256:"a".repeat(64)},{keyId:syntheticSigningKey.keyId,privateKeyPem:"invalid"}),/comparison_signing_key_invalid/);
});
function packageState(state:string,visible:boolean|null=null){
  const compiled=compileCandidate(candidate({workKey:"package-state-synthetic",firmName:"Synthetic State Firm",status:"held"}),snapshot).packages[0];
  const input=content();input.packages=[{clientPackageId:compiled.envelope.packageId,payloadSha256:compiled.payloadSha256,state,serverPackageId:"11111111-1111-4111-8111-111111111111",visible}];
  return{compiled,input};
}
for(const [state,action] of [
  ["received","reuse_existing_draft"],["identity_hold","reuse_existing_draft"],["evidence_hold","reuse_existing_draft"],["ready_for_review","reuse_existing_draft"],
  ["applied","verify_existing"],["rejected","hold_terminal"],["superseded","hold_terminal"],["unknown_future_state","hold_schema"]
] as const)test("persisted package state "+state+" resolves only to "+action,()=>{
  const {compiled,input}=packageState(state,state==="applied"?true:null),signed=serializeSyntheticComparisonExport(input,snapshot.snapshotAt).snapshot;
  const result=reconcilePackage(compiled,signed,{now:snapshot.snapshotAt});
  assert.equal(result.action,action);
  if(action==="hold_terminal"||action==="hold_schema"){assert.equal(result.envelope.mode,"propose");assert.equal(result.linked.length,0);}
});
test("applied visibility remains explicit and duplicated package state fails closed",()=>{
  for(const [visible,action] of [[false,"presentation_gap"],[null,"receipt_unverified"]] as const){
    const {compiled,input}=packageState("applied",visible);
    assert.equal(reconcilePackage(compiled,serializeSyntheticComparisonExport(input,snapshot.snapshotAt).snapshot,{now:snapshot.snapshotAt}).action,action);
  }
  const {compiled,input}=packageState("received");input.packages.push({...input.packages[0],state:"rejected"});
  assert.equal(reconcilePackage(compiled,serializeSyntheticComparisonExport(input,snapshot.snapshotAt).snapshot,{now:snapshot.snapshotAt}).action,"receipt_unverified");
});
