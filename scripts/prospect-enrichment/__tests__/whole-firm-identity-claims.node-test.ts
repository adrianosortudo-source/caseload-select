import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { coordinatorFixture, producerDate } from "../fixtures/coordinator";
import { produceWholeFirmExport } from "../whole-firm-producer";
import { compileWholeFirmSnapshot, deriveWholeFirmIdentityClaimSource, freezeWholeFirmExport } from "../whole-firm";
import { retainedWholeFirmStableClaim } from "../whole-firm-identity-claims";
import { canonicalJson, object, protocolHash, sha256 } from "../model";
import { items, reconcilePackage, validateComparisonSnapshot } from "../reconciliation";
import { serializeComparisonExport } from "../comparison-export";
import { signingKeyTrust } from "../comparison-signature";

const stable = "FIRM-" + "1".repeat(26), other = "FIRM-" + "2".repeat(26), digest = "a".repeat(64);
const metadata = { compilerCommit: "c".repeat(40), compilerFileSha256: "d".repeat(64), baselineLedgerSha256: "e".repeat(64) };
function fixture() {
  const state = coordinatorFixture() as unknown as Record<string, unknown>, candidate = (state.candidates as Record<string, unknown>[])[0];
  candidate.canonicalDomain = "synthetic-0.example"; candidate.stableIds = [stable]; candidate.databaseIds = ["33333333-3333-4333-8333-333333333333"];
  candidate.receipts = [{ queryArtifact: "operations/luna_continuous_v1/control/evidence/test.json", queryArtifactSha256: digest, registration: { firmId: stable, canonicalDomain: "synthetic-0.example" } }];
  candidate.history = [{ event: "identity-bound-from-registration-readback", firmId: stable, domain: "synthetic-0.example", queryArtifactSha256: digest }];
  const produced = produceWholeFirmExport(state, { sourcePath: "synthetic/whole_firm_state.json", sourceSha256: "f".repeat(64), references: [{ pointer: "/candidates/0/receipts/0/queryArtifact", value: "operations/luna_continuous_v1/control/evidence/test.json", expectedSha256: digest, sourceSha256: digest, sourcePath: "synthetic/test.json", archivePath: "synthetic/" + digest + ".bin", status: "snapshotted" }] }, producerDate);
  const source = freezeWholeFirmExport(produced.exported, sha256(canonicalJson(produced.exported))), compiled = compileWholeFirmSnapshot(source);
  const revision = (source.originalExport.revisions[0] as { originalRevision: Record<string, unknown> }).originalRevision;
  return { source, compiled, revision, envelope: compiled.packages[0].envelope };
}

test("explicit derivation creates new delivery identities while retaining every raw fact and semantic event", () => {
  const { source, compiled } = fixture(), before = canonicalJson(source);
  assert.equal(compiled.packages[0].envelope.subject.stableFirmId, null);
  const derived = deriveWholeFirmIdentityClaimSource(source, metadata), result = compileWholeFirmSnapshot(derived), envelope = result.packages[0].envelope;
  assert.equal(canonicalJson(source), before); assert.deepEqual(derived.originalExport.revisions, source.originalExport.revisions); assert.deepEqual(derived.originalExport.sourceInventory, source.originalExport.sourceInventory);
  assert.notEqual(derived.manifestSha256, source.manifestSha256); assert.notEqual(envelope.runId, compiled.packages[0].envelope.runId); assert.notEqual(envelope.packageId, compiled.packages[0].envelope.packageId);
  assert.equal(envelope.subject.stableFirmId, stable); assert.equal(envelope.subject.identityState, "unresolved"); assert.equal(envelope.subject.databaseFirmId, null); assert.equal(envelope.subject.sourceRecordKey, null);
  assert.equal(protocolHash(envelope.originalResearch.content), protocolHash(compiled.packages[0].envelope.originalResearch.content));
  assert.deepEqual(items(envelope).map(v => [v.sourceEventKey, v.semanticSha256]), items(compiled.packages[0].envelope).map(v => [v.sourceEventKey, v.semanticSha256]));
  assert.equal(result.packages.length, compiled.packages.length); assert.equal(result.expected.entries.length, compiled.expected.entries.length);
  assert.throws(() => deriveWholeFirmIdentityClaimSource(derived, metadata), /already_derived/);
  assert.throws(() => deriveWholeFirmIdentityClaimSource(source, { ...metadata, compilerFileSha256: "missing" }), /policy_invalid/);
});

test("stable claim requires singleton valid domain-bound registrations and captured query hashes", () => {
  const { source, revision, envelope } = fixture();
  const evaluate = (edit: (value: Record<string, unknown>) => void, inventory: unknown = source.originalExport.sourceInventory) => { const copy = structuredClone(revision); edit(copy); return retainedWholeFirmStableClaim(copy, envelope, inventory); };
  const context = (v: Record<string, unknown>) => v.candidateContext as Record<string, unknown>;
  assert.equal(evaluate(v => { context(v).stableIds = [stable, stable]; }).stableFirmId, stable);
  for (const stableIds of [undefined, [], "not-array", ["malformed"], [stable, other]]) assert.equal(evaluate(v => { context(v).stableIds = stableIds; }).stableFirmId, null);
  assert.equal(evaluate(v => { context(v).canonicalDomain = "different.example"; }).conflicting, true);
  assert.equal(evaluate(v => { context(v).identityConflicts = [{ reason: "retained conflict" }]; }).conflicting, true);
  assert.equal(evaluate(v => { (context(v).receipts as Record<string, unknown>[])[0].queryArtifactSha256 = "b".repeat(64); }).stableFirmId, null);
  assert.equal(evaluate(v => { ((context(v).receipts as Record<string, unknown>[])[0].registration as Record<string, unknown>).firmId = other; }).conflicting, true);
  assert.equal(evaluate(v => { (context(v).history as Record<string, unknown>[])[0].domain = "different.example"; }).conflicting, true);
  assert.equal(evaluate(() => undefined, {}).stableFirmId, null);
  for (const field of ["canonicalDomain", "domain"] as const) {
    const missing = evaluate(v => { const registration = (context(v).receipts as Record<string, unknown>[])[0].registration as Record<string, unknown>; delete registration.canonicalDomain; delete registration.domain; registration[field] = null; });
    assert.equal(missing.stableFirmId, null); assert.equal(missing.conflicting, false);
  }
  assert.equal(evaluate(v => { delete context(v).canonicalDomain; }).conflicting, false);
  assert.equal(evaluate(v => { delete (v.result as { record: Record<string, unknown> }).record.canonicalDomain; }).conflicting, false);
  const missingEnvelopeDomain = retainedWholeFirmStableClaim(revision, { ...envelope, subject: { ...envelope.subject, canonicalDomain: null } }, source.originalExport.sourceInventory);
  assert.equal(missingEnvelopeDomain.stableFirmId, null); assert.equal(missingEnvelopeDomain.conflicting, false);
  const claim = evaluate(() => undefined); assert.equal(claim.proof?.capturedSha256, digest); assert.equal(claim.proof?.receiptPointer, "/candidateContext/receipts/0");
});

test("existing typed claims are preserved and source contradictions cannot be cleared by a signed registry match", () => {
  const { source } = fixture(), raw = structuredClone(source.originalExport), first = raw.revisions[0] as { standardEnvelope: Record<string, unknown>; originalRevision: Record<string, unknown> };
  assert.ok(object(first.standardEnvelope.subject)); first.standardEnvelope.subject.stableFirmId = other;
  const baseline = freezeWholeFirmExport(raw, sha256(canonicalJson(raw))), result = compileWholeFirmSnapshot(deriveWholeFirmIdentityClaimSource(baseline, metadata)), pkg = result.packages[0];
  assert.equal(pkg.envelope.subject.stableFirmId, other); assert.equal(pkg.envelope.subject.identityState, "conflict"); assert.ok(pkg.issues.some(i => i.code === "retained_identity_claim_hold"));
  const key = { keyId: "synthetic-claim-conflict", privateKeyPem: generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  const trust = signingKeyTrust(key), snapshot = serializeComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer", capturedAt: producerDate, provenance: { reader: "admin-prospect-enrichment-bootstrap/v1", sourceArtifactSha256: digest, operatorAuthenticated: true }, identities: [{ researchKey: pkg.envelope.subject.researchKey, databaseFirmId: "33333333-3333-4333-8333-333333333333", stableFirmId: other, sourceRecordKey: "q50-synthetic", canonicalDomain: "synthetic-0.example" }], packages: [], events: [] }, producerDate, key).snapshot;
  assert.deepEqual(validateComparisonSnapshot(snapshot, producerDate, trust), []);
  const action = reconcilePackage(pkg, snapshot, { now: producerDate, comparisonTrust: trust });
  assert.equal(action.action, "hold_identity"); assert.equal(action.envelope.subject.identityState, "conflict"); assert.equal(action.envelope.subject.databaseFirmId, null);
  assert.equal((first.originalRevision.candidateContext as Record<string, unknown>).stableIds instanceof Array, true);
});

test("matching existing typed identifiers are preserved without deriving additional identifiers", () => {
  const { source } = fixture(), raw = structuredClone(source.originalExport), first = raw.revisions[0] as { standardEnvelope: { subject: Record<string, unknown> } };
  first.standardEnvelope.subject.stableFirmId = stable; first.standardEnvelope.subject.databaseFirmId = "33333333-3333-4333-8333-333333333333"; first.standardEnvelope.subject.sourceRecordKey = "existing-source-key";
  const baseline = freezeWholeFirmExport(raw, sha256(canonicalJson(raw))), result = compileWholeFirmSnapshot(deriveWholeFirmIdentityClaimSource(baseline, metadata));
  assert.deepEqual(result.packages[0].envelope.subject, { ...first.standardEnvelope.subject, identityState: "unresolved" });
});

test("missing corroboration remains unresolved without choosing a database UUID", () => {
  const { source } = fixture(), raw = structuredClone(source.originalExport), first = raw.revisions[0] as { originalRevision: Record<string, unknown> };
  (first.originalRevision.candidateContext as Record<string, unknown>).receipts = [];
  // Update only the synthetic fixture's matching raw envelope, not a real frozen artifact.
  const wrapper = raw.revisions[0] as { standardEnvelope: { originalResearch: { content: unknown } } };
  wrapper.standardEnvelope.originalResearch.content = structuredClone(first.originalRevision);
  const baseline = freezeWholeFirmExport(raw, sha256(canonicalJson(raw))), result = compileWholeFirmSnapshot(deriveWholeFirmIdentityClaimSource(baseline, metadata));
  assert.equal(result.packages[0].envelope.subject.identityState, "unresolved"); assert.equal(result.packages[0].envelope.subject.stableFirmId, null); assert.equal(result.packages[0].envelope.subject.databaseFirmId, null);
});
