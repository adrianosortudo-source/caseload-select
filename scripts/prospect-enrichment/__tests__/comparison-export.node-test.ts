import test from "node:test";
import assert from "node:assert/strict";
import type { ComparisonExportInput } from "../comparison-export";
import { serializeSyntheticComparisonExport as serializeComparisonExport } from "../fixtures/comparison-signing";
import { protocolHash, sha256 } from "../model";
import { assertFreshComparison } from "../reconciliation";

function input(): ComparisonExportInput {
  return { schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer", capturedAt: "2026-09-23T12:00:00.000Z", provenance: { reader: "synthetic-supported-operator-export", sourceArtifactSha256: "d".repeat(64), operatorAuthenticated: true }, identities: [], packages: [], events: [] };
}
test("comparison export has a stable full SHA, canonical bytes and detached original values", () => {
  const source = input(), result = serializeComparisonExport(source, source.capturedAt);
  assert.equal(result.snapshot.snapshotSha256, "48f39cf9495672a8bca4a19bec7cede1ba62dc8bde6ac78223fb533664fd645b");
  assert.match(result.bodySha256, /^[a-f0-9]{64}$/);
  assert.equal(protocolHash(source), result.snapshot.snapshotSha256);
  assert.equal(sha256(result.body), result.bodySha256);
  assert.deepEqual(JSON.parse(result.body), result.snapshot);
  const reordered = Object.fromEntries(Object.entries(source).reverse());
  assert.equal(serializeComparisonExport(reordered, source.capturedAt).body, result.body);
  source.provenance.reader = "modified after serialization";
  assert.equal(result.snapshot.provenance.reader, "synthetic-supported-operator-export");
});
test("comparison export rejects stale or invented provenance and unknown fields", () => {
  const source = input();
  assert.throws(() => serializeComparisonExport(source, "2026-09-23T12:16:00.000Z"), /comparison_stale/);
  assert.throws(() => serializeComparisonExport({ ...source, provenance: { ...source.provenance, operatorAuthenticated: false } }, source.capturedAt), /comparison_export_schema_invalid/);
  assert.throws(() => serializeComparisonExport({ ...source, snapshotSha256: "0".repeat(64) }, source.capturedAt), /comparison_export_schema_invalid/);
  assert.throws(() => serializeComparisonExport({ ...source, arbitrary: "never silently dropped" }, source.capturedAt), /comparison_export_schema_invalid/);
});
test("comparison export preserves null visibility, explicit current history and all target hashes", () => {
  const source = input();
  source.identities = [{ researchKey: "synthetic-key", databaseFirmId: "11111111-1111-4111-8111-111111111111", stableFirmId: null, sourceRecordKey: "source-key", canonicalDomain: null }];
  source.packages = [{ clientPackageId: "synthetic-package", payloadSha256: "a".repeat(64), state: "applied", serverPackageId: "22222222-2222-4222-8222-222222222222", visible: null }];
  source.events = [{ sourceEventKey: "assessment:" + "b".repeat(64), semanticSha256: "c".repeat(64), researchKey: "synthetic-key", visible: false, primaryTarget: null, targets: [{ table: "gta_prospect_qualification_assessments", id: "33333333-3333-4333-8333-333333333333", rowSha256: "e".repeat(64) }] }];
  source.currentAssessments = [{ researchKey: "synthetic-key", clientAssessmentId: "synthetic-assessment" }];
  const result = serializeComparisonExport(source, source.capturedAt);
  assert.deepEqual(result.snapshot.events, source.events);
  assert.equal(result.snapshot.packages[0].visible, null);
  assert.deepEqual(result.snapshot.currentAssessments, source.currentAssessments);
  const invalid = structuredClone(source) as unknown as Record<string, unknown>;
  invalid.identities = [{ researchKey: "synthetic-key", databaseFirmId: "id", sourceRecordKey: "key", canonicalDomain: null }];
  assert.throws(() => serializeComparisonExport(invalid, source.capturedAt), /comparison_export_schema_invalid/);
});

test("delivery comparison gate fails closed before networking and at the 15-minute boundary", () => {
  const source = input(), exported = serializeComparisonExport(source, source.capturedAt).snapshot;
  assert.doesNotThrow(() => assertFreshComparison(exported, "2026-09-23T12:15:00.000Z"));
  assert.throws(() => assertFreshComparison(exported, "2026-09-23T12:15:00.001Z"), /comparison_stale/);
  assert.throws(() => assertFreshComparison(null, source.capturedAt), /comparison_schema_invalid/);
  assert.throws(() => assertFreshComparison({ ...exported, snapshotSha256: "0".repeat(64) }, source.capturedAt), /comparison_hash_mismatch/);
});
