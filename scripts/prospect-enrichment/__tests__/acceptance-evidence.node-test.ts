import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildOfflineAcceptance, validateFrozenFiveCaseSelection, type FrozenFiveCaseReport } from "../acceptance-evidence";
import { main as cliMain } from "../acceptance-evidence-cli";
import { coordinatorFixture } from "../fixtures/coordinator";
import { canonicalJson, protocolHash } from "../model";
import { freezeWholeFirmExport, compileWholeFirmSnapshot } from "../whole-firm";
import { produceWholeFirmExport } from "../whole-firm-producer";

const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function testSource() {
  const produced = produceWholeFirmExport(coordinatorFixture(), { sourcePath: "synthetic-coordinator.json", sourceSha256: "b".repeat(64), references: [] }, "2026-10-02T12:00:00.000Z");
  return freezeWholeFirmExport(produced.exported, sha(canonicalJson(produced.exported) + "\n"));
}
function frozenFixture() {
  const categories = ["qualified-source", "held", "rejected", "identity-uncertain", "package-less-schema-held"];
  const rows = categories.map((category, i) => ({ revisionId: "revision-" + i, researchKey: "synthetic:key-" + i,
    sourcePointer: "/originalExport/revisions/" + i, sourceSha256: "c".repeat(64), packageIds: i === 4 ? [] : ["pkg-" + i],
    issues: i === 4 ? [{ code: "producer_envelope_schema_invalid" }, { code: "whole_firm_standard_envelope_missing" }] : [] }));
  const indexLines = rows.map(row => JSON.stringify(row)), sourceIndexBytes = Buffer.from(indexLines.join("\n") + "\n");
  const cases = categories.map((category, i) => ({ category, line: i + 1, revisionId: rows[i].revisionId, researchKey: rows[i].researchKey,
    packageId: i === 4 ? null : "pkg-" + i, sourcePointer: rows[i].sourcePointer, sourceSha256: rows[i].sourceSha256,
    lineSha256: sha(indexLines[i]), decision: i === 2 ? "rejected" : i === 4 ? "held" : i === 1 ? "held" : "qualified",
    ...(i === 4 ? { issues: ["producer_envelope_schema_invalid", "whole_firm_standard_envelope_missing"] } : {}) }));
  const frozenBytes = Buffer.from(JSON.stringify({ schemaVersion: "prospect-a4-frozen-case-selection/v1", capturedAtUtc: "2026-09-30T05:30:00Z",
    status: "prepared_unapplied", source: { path: "synthetic-index.jsonl", sha256: sha(sourceIndexBytes), rows: rows.length }, cases,
    productionWrites: 0, adminImports: 0, canonicalLinks: 0, qualificationChanges: 0, receipts: 0, renderedReadbacks: 0 }));
  return { frozenBytes, sourceIndexBytes };
}

test("frozen five-case selection is independently bound to exact file, source index, rows and categories", () => {
  const { frozenBytes, sourceIndexBytes } = frozenFixture();
  const result = validateFrozenFiveCaseSelection(frozenBytes, sourceIndexBytes, sha(frozenBytes));
  assert.equal(result.status, "pass", JSON.stringify(result.errors));
  assert.equal(result.caseCount, 5);
  assert.deepEqual(result.categories, ["held", "identity-uncertain", "package-less-schema-held", "qualified-source", "rejected"]);
  const changedIndex = Buffer.from(sourceIndexBytes.toString("utf8").replace("synthetic:key-0", "synthetic:changed"));
  assert.equal(validateFrozenFiveCaseSelection(frozenBytes, changedIndex, sha(frozenBytes)).status, "fail");
  assert.equal(validateFrozenFiveCaseSelection(frozenBytes, sourceIndexBytes, "0".repeat(64)).status, "fail");
});

test("offline acceptance preserves the 10-case requirement and leaves every live assertion pending", () => {
  const source = testSource();
  const sourceBytes = Buffer.from(JSON.stringify(source, null, 2) + "\n");
  const compiled = compileWholeFirmSnapshot(source);
  const frozen: FrozenFiveCaseReport = { status: "pass", fileSha256: "a".repeat(64), sourceIndexSha256: "b".repeat(64), rowCount: 5, caseCount: 5,
    categories: ["held", "identity-uncertain", "package-less-schema-held", "qualified-source", "rejected"], errors: [] };
  const report = buildOfflineAcceptance(source, sourceBytes, compiled.packages, frozen);
  assert.equal(report.canonicalInput.status, "pass");
  assert.equal(report.frozenFiveCase.caseCount, 5);
  assert.equal(report.sourceAccounting.expectedRevisionCount, report.sourceAccounting.accountedRevisionCount);
  assert.equal(report.packageBackedResearchKeyCount, new Set(compiled.packages.map(pkg => pkg.envelope.subject.researchKey)).size);
  assert.equal(report.sourceRevisionDispositionCounts.Qualified + report.sourceRevisionDispositionCounts.Held + report.sourceRevisionDispositionCounts.Rejected + report.sourceRevisionDispositionCounts.Incomplete, report.sourceAccounting.accountedRevisionCount);
  assert.equal(report.pilot10.requiredPerPartition, 2);
  assert.equal(report.pilot10.status, "pending");
  assert.ok(report.pilot10.errors.some(value => value.includes("pilot_partition_shortfall")));
  assert.equal(report.pilotPartitionAvailability.Identity.exact, false);
  assert.ok(report.pilotPartitionAvailability.Identity.availableResearchKeyCount >= 2);
  assert.ok(report.pilotPartitionAvailability.Qualified.exact);
  assert.ok(Object.values(report.liveGates).every(gate => gate.status === "pending"));
  assert.equal(report.syncStatus, "not_verified");
  assert.equal(report.synced, false);
  assert.equal(report.acceptanceStatus, "offline_pilot_pending_live_pending");
  assert.equal(Object.hasOwn(report, "live_readback_verified"), false);
});

test("acceptance compilation makes no network calls", () => {
  const source = testSource(), bytes = Buffer.from(JSON.stringify(source) + "\n"), packages = compileWholeFirmSnapshot(source).packages;
  const frozen: FrozenFiveCaseReport = { status: "pass", fileSha256: "a".repeat(64), sourceIndexSha256: "b".repeat(64), rowCount: 5, caseCount: 5, categories: [], errors: [] };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw Error("network access is forbidden in offline acceptance"); }) as typeof fetch;
  try { buildOfflineAcceptance(source, bytes, packages, frozen); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(calls, 0);
});

test("offline runner rejects a source object that differs from the exact source manifest bytes", () => {
  const source = testSource();
  const sourceBytes = Buffer.from(JSON.stringify(source) + "\n");
  const compiled = compileWholeFirmSnapshot(source);
  const frozen: FrozenFiveCaseReport = { status: "pass", fileSha256: "a".repeat(64), sourceIndexSha256: "b".repeat(64), rowCount: 5, caseCount: 5, categories: [], errors: [] };
  assert.throws(() => buildOfflineAcceptance({ ...source, snapshotAt: "2026-10-04T00:00:00.000Z" }, sourceBytes, compiled.packages, frozen), /source_manifest_bytes_object_mismatch/);
  assert.throws(() => buildOfflineAcceptance(source, sourceBytes, [...compiled.packages, compiled.packages[0]], frozen), /normalized_package_duplicate_id/);
  assert.throws(() => buildOfflineAcceptance(source, sourceBytes, compiled.packages.slice(1), frozen), /normalized_package_source_coverage_mismatch/);
  const altered = structuredClone(compiled.packages) as typeof compiled.packages;
  altered[0].payloadSha256 = "0".repeat(64);
  assert.throws(() => buildOfflineAcceptance(source, sourceBytes, altered, frozen), /normalized_package_payload_hash_mismatch/);
});

test("without a signed comparison, arbitrary firm identity resolution is explicitly unverified", () => {
  const source = testSource(), sourceBytes = Buffer.from(JSON.stringify(source) + "\n"), compiled = compileWholeFirmSnapshot(source);
  const frozen: FrozenFiveCaseReport = { status: "pass", fileSha256: "a".repeat(64), sourceIndexSha256: "b".repeat(64), rowCount: 5, caseCount: 5, categories: [], errors: [] };
  const changed = structuredClone(compiled.packages) as unknown as { envelope: Record<string, unknown>; payloadSha256: string }[];
  const subject = changed[0].envelope.subject as Record<string, unknown>;
  subject.databaseFirmId = "11111111-1111-4111-8111-111111111111";
  subject.identityState = "resolved";
  changed[0].payloadSha256 = protocolHash(changed[0].envelope);
  assert.throws(() => buildOfflineAcceptance(source, sourceBytes, changed as unknown as typeof compiled.packages, frozen), /normalized_package_identity_unverified_without_signed_comparison/);
});

test("without a signed comparison, link_existing mode cannot be inferred from a source package", () => {
  const source = testSource(), sourceBytes = Buffer.from(JSON.stringify(source) + "\n"), compiled = compileWholeFirmSnapshot(source);
  const frozen: FrozenFiveCaseReport = { status: "pass", fileSha256: "a".repeat(64), sourceIndexSha256: "b".repeat(64), rowCount: 5, caseCount: 5, categories: [], errors: [] };
  const changed = structuredClone(compiled.packages) as unknown as { envelope: Record<string, unknown>; payloadSha256: string }[];
  changed[0].envelope.mode = "link_existing";
  changed[0].payloadSha256 = protocolHash(changed[0].envelope);
  assert.throws(() => buildOfflineAcceptance(source, sourceBytes, changed as unknown as typeof compiled.packages, frozen), /normalized_package_mode_unverified_without_signed_comparison/);
});

test("without a signed comparison, existingRecord links cannot be inferred from a source package", () => {
  const source = testSource(), sourceBytes = Buffer.from(JSON.stringify(source) + "\n"), compiled = compileWholeFirmSnapshot(source);
  const frozen: FrozenFiveCaseReport = { status: "pass", fileSha256: "a".repeat(64), sourceIndexSha256: "b".repeat(64), rowCount: 5, caseCount: 5, categories: [], errors: [] };
  const changed = structuredClone(compiled.packages) as unknown as { envelope: Record<string, unknown>; payloadSha256: string }[];
  const envelope = changed[0].envelope, observations = envelope.observations as Record<string, unknown>[];
  assert.ok(observations.length > 0);
  observations[0].existingRecord = { table: "gta_prospect_firms", id: "11111111-1111-4111-8111-111111111111", rowSha256: "c".repeat(64) };
  changed[0].payloadSha256 = protocolHash(envelope);
  assert.throws(() => buildOfflineAcceptance(source, sourceBytes, changed as unknown as typeof compiled.packages, frozen), /normalized_package_existing_record_unverified_without_signed_comparison/);
});

test("CLI rejects any live-evidence promotion flag", async () => {
  await assert.rejects(cliMain(["acceptance", "--manifest", "x", "--packages", "y", "--frozen-five", "z", "--frozen-index", "q", "--output", "r", "--live-evidence", "fake.json"]), /acceptance_unknown_option/);
});
