import test from "node:test";
import type { ProspectEnrichmentEnvelope } from "../../../src/lib/prospect-enrichment-contract";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../cli";
import { wholeFirmFixture } from "../fixtures/whole-firm";
import { compileWholeFirmSnapshot, freezeWholeFirmExport, verifyWholeFirmManifest, assertWholeFirmManifestCoverage } from "../whole-firm";
import { wholeFirmRunId, wholeFirmPackageId, assertEnvelopeProfile, WHOLE_FIRM_PROFILE } from "../profiles";
import { canonicalJson, protocolHash, sha256, within } from "../model";
import { items, assertFreshComparison } from "../reconciliation";
import { checkApproval, enqueue, submitOne, type ApprovalManifest } from "../outbox";
import { checkManifestApproval, prepareManifestRequests, submitManifestChunks, validateManifestChunks } from "../manifest-delivery";
import { buildExpectedRunManifest, buildHeldCandidateEvidence, chunkExpectedRunManifest } from "../run-manifest";
import { serializeSyntheticComparisonExport as serializeComparisonExport } from "../fixtures/comparison-signing";
import { serializeComparisonRequest } from "../comparison-request";
import { assertFrozenWholeFirmPackageMissing, assertFrozenWholeFirmRunCompatibility, CHILD5_FROZEN_COMPATIBILITY, type FrozenWholeFirmCompatibilityContract } from "../frozen-whole-firm-compatibility";

async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp");
  await fs.mkdir(root, { recursive: true });
  const temp = await fs.mkdtemp(path.join(root, "pe-lane3-synthetic-"));
  t.after(async () => { const real = await fs.realpath(temp); assert.ok(within(root, real) && path.basename(real).startsWith("pe-lane3-synthetic-")); await fs.rm(real, { recursive: true, force: true }); });
  return temp;
}
test("frozen whole-firm compatibility accepts only exact pre-guard evidence and preserves raw revision bytes", () => {
  const base = wholeFirmFixture(), exported = structuredClone(base.exported);
  const original = exported.revisions[0] as { originalRevision: Record<string, unknown> };
  original.originalRevision = { ...original.originalRevision, result: { state: "recorded-without-completion-date" } };
  const source = freezeWholeFirmExport(exported, sha256(canonicalJson(exported)));
  const current = compileWholeFirmSnapshot(source);
  assert.equal(current.packages.length, 3, "current compiler keeps the undated result on hold");

  const runId = wholeFirmRunId(source.manifestSha256), revision = original.originalRevision;
  const previousPackage = base.compiled.packages[0];
  const envelope = {
    ...previousPackage.envelope,
    runId,
    packageId: wholeFirmPackageId(runId, source.originalExport.expectedRevisions[0].researchKey, revision),
    generatedAt: source.snapshotAt,
    originalResearch: { ...previousPackage.envelope.originalResearch, content: revision as typeof previousPackage.envelope.originalResearch.content, contentSha256: protocolHash(revision) },
  };
  const restoredPackage = { ...previousPackage, envelope, payloadSha256: protocolHash(envelope) };
  const packages = [restoredPackage, ...current.packages];
  const candidates = current.candidates.map(value => ({ ...value, packageIds: [...value.packageIds], issues: [...value.issues] }));
  candidates[0].packageIds = [restoredPackage.envelope.packageId];
  const provisional = buildExpectedRunManifest({ schemaVersion: "prospect-backfill-manifest/v1", snapshotAt: source.snapshotAt,
    manifestSha256: source.manifestSha256, roots: [], artifacts: [], issues: [] }, packages, candidates, [], runId);
  const expectedContent = { schemaVersion: provisional.schemaVersion, runId, sourceSystem: WHOLE_FIRM_PROFILE.sourceSystem,
    sourceName: WHOLE_FIRM_PROFILE.sourceName, sourceManifestSha256: source.manifestSha256, generatedAt: source.snapshotAt,
    expectedPackageCount: provisional.expectedPackageCount, entries: provisional.entries };
  const expected = { ...expectedContent, manifestSha256: protocolHash(expectedContent) };
  const chunks = validateManifestChunks(chunkExpectedRunManifest(expected, 2, 1_048_576, "whole-firm"), "whole-firm");
  const heldEvidence = buildHeldCandidateEvidence(expected, candidates);
  const packageValues = packages.map(value => ({ envelope: value.envelope, payloadSha256: value.payloadSha256,
    legacyAssessmentProjectionClaims: value.legacyAssessmentProjectionClaims ?? [] }));
  const approval = {
    schemaVersion: "prospect-whole-firm-delivery-approval/v1", scope: "whole-firm-run", targetOrigin: "https://admin.caseloadselect.ca",
    projectId: "ssxryjxifwiivghglqer", runId, sourceManifestSha256: source.manifestSha256,
    runManifestSha256: expected.manifestSha256, expectedRevisionCount: source.expectedRevisionCount,
    approvalReference: "synthetic-frozen-whole-firm-test-only",
    packages: packages.map(value => ({ clientPackageId: value.envelope.packageId, payloadSha256: value.payloadSha256 })),
  } as const;
  const sourceFileBytes = Buffer.from(JSON.stringify(source, null, 2) + "\n");
  const manifestChunksFileBytes = Buffer.from(chunks.map(value => JSON.stringify(value)).join("\n") + "\n");
  const heldEvidenceFileBytes = Buffer.from(heldEvidence.map(value => JSON.stringify(value)).join("\n") + (heldEvidence.length ? "\n" : ""));
  const packagesFileBytes = Buffer.from(JSON.stringify(packageValues));
  const approvalFileBytes = Buffer.from(JSON.stringify(approval));
  const contract: FrozenWholeFirmCompatibilityContract = {
    sourceFileSha256: sha256(sourceFileBytes), sourceManifestSha256: source.manifestSha256, sourceExportSha256: source.sourceExportSha256,
    runId, runManifestSha256: expected.manifestSha256,
    requestSha256: protocolHash(serializeComparisonRequest({ ...expected }, packageValues, "whole-firm").request),
    manifestChunksFileSha256: sha256(manifestChunksFileBytes), heldEvidenceFileSha256: sha256(heldEvidenceFileBytes),
    packagesFileSha256: sha256(packagesFileBytes), approvalFileSha256: sha256(approvalFileBytes),
    expectedRevisionCount: 4, expectedPackageCount: 4, expectedHeldCount: 0,
  };
  const inputs = { contract, sourceFileBytes, source, manifestChunksFileBytes, chunks, heldEvidenceFileBytes, heldEvidence,
    packagesFileBytes, packages: packageValues, approvalFileBytes, approvalSha256Argument: contract.approvalFileSha256 };
  assert.throws(() => assertWholeFirmManifestCoverage(source, chunks), /revision_coverage_mismatch/);
  assert.equal(assertFrozenWholeFirmRunCompatibility(inputs).requestSha256, contract.requestSha256);
  assert.throws(() => assertFrozenWholeFirmRunCompatibility({ ...inputs,
    manifestChunksFileBytes: Buffer.concat([manifestChunksFileBytes, Buffer.from(" ")]) }), /chunks_bytes_mismatch/);
  assert.throws(() => assertFrozenWholeFirmRunCompatibility({ ...inputs,
    sourceFileBytes: Buffer.concat([sourceFileBytes, Buffer.from(" ")]) }), /source_bytes_mismatch/);
  assert.throws(() => assertFrozenWholeFirmRunCompatibility({ ...inputs,
    approvalFileBytes: Buffer.concat([approvalFileBytes, Buffer.from(" ")]) }), /approval_bytes_mismatch/);
  const expectedComparisonRows = [{ clientPackageId: "p", payloadSha256: "a".repeat(64) }];
  assert.doesNotThrow(() => assertFrozenWholeFirmPackageMissing({ packages: [{ clientPackageId: "p", payloadSha256: "a".repeat(64), state: "missing", serverPackageId: null, visible: null }] }, "p", "a".repeat(64), expectedComparisonRows));
  assert.throws(() => assertFrozenWholeFirmPackageMissing({ packages: [{ clientPackageId: "p", payloadSha256: "a".repeat(64), state: "received", serverPackageId: "server", visible: true }] }, "p", "a".repeat(64), expectedComparisonRows), /package_not_missing/);
  assert.throws(() => assertFrozenWholeFirmPackageMissing({ packages: [{ clientPackageId: "p", payloadSha256: "a".repeat(64), state: "identity_hold", serverPackageId: "server", visible: true }] }, "p", "a".repeat(64), expectedComparisonRows), /package_not_missing/);
  assert.throws(() => assertFrozenWholeFirmPackageMissing({ packages: [] }, "p", "a".repeat(64), expectedComparisonRows), /package_comparison_mismatch/);
});

test("submit routes the pinned source hash through frozen validation and makes no network request", async t => {
  const dir = await workspace(t), base = wholeFirmFixture(), now = new Date().toISOString();
  const packageValues = base.compiled.packages.map(pkg => ({ envelope: pkg.envelope, payloadSha256: pkg.payloadSha256, legacyAssessmentProjectionClaims: pkg.legacyAssessmentProjectionClaims ?? [] }));
  const request = serializeComparisonRequest(base.compiled.expected, packageValues, "whole-firm");
  const snapshot = serializeComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer",
    capturedAt: now, provenance: { reader: "admin-prospect-enrichment-comparison/v1", sourceArtifactSha256: protocolHash(request.request), operatorAuthenticated: true },
    identities: [], packages: base.compiled.expected.entries.filter(entry => entry.clientPackageId !== null).map(entry => ({
      clientPackageId: entry.clientPackageId!, payloadSha256: entry.expectedPayloadSha256!, state: "missing", serverPackageId: null, visible: null,
    })), events: [] }, now).snapshot;
  const source = { ...base.source, manifestSha256: CHILD5_FROZEN_COMPATIBILITY.sourceManifestSha256 };
  const files = {
    source: path.join(dir, "source.json"), chunks: path.join(dir, "chunks.jsonl"), held: path.join(dir, "held.jsonl"),
    packages: path.join(dir, "packages.json"), comparison: path.join(dir, "comparison.json"), approval: path.join(dir, "approval.json"),
  };
  const sourceBytes = Buffer.from(JSON.stringify(source));
  const approvalBytes = Buffer.from(JSON.stringify(base.approval));
  await fs.writeFile(files.source, sourceBytes);
  await fs.writeFile(files.chunks, base.chunks.map(chunk => JSON.stringify(chunk)).join("\n") + "\n");
  await fs.writeFile(files.held, buildHeldCandidateEvidence(base.compiled.expected, base.compiled.candidates).map(row => JSON.stringify(row)).join("\n") + "\n");
  await fs.writeFile(files.packages, JSON.stringify(packageValues));
  await fs.writeFile(files.comparison, JSON.stringify(snapshot));
  await fs.writeFile(files.approval, approvalBytes);

  const outboxRoot = WHOLE_FIRM_PROFILE.outputRoot;
  const outbox = path.join(outboxRoot, ".synthetic-cli-frozen-" + process.pid + "-" + Date.now());
  await fs.mkdir(outbox, { recursive: true });
  t.after(async () => {
    const real = await fs.realpath(outbox);
    assert.ok(within(outboxRoot, real) && path.basename(real).startsWith(".synthetic-cli-frozen-"));
    await fs.rm(real, { recursive: true, force: true });
  });
  const queued = await enqueue(outbox, base.compiled.packages[0].envelope, now);
  const args = ["submit", "--profile", "whole-firm", "--key", queued.entry.key, "--manifest", files.source,
    "--manifest-chunks", files.chunks, "--held-evidence", files.held, "--packages", files.packages, "--snapshot", files.comparison,
    "--approval", files.approval, "--approval-sha256", sha256(approvalBytes), "--outbox", outbox];
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => { networkRequests++; throw Error("network_forbidden_in_test"); }) as typeof fetch;
  try {
    await assert.rejects(main(args), /frozen_whole_firm_source_bytes_mismatch/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(networkRequests, 0);
});

test("whole-firm snapshot preserves every declared status and all exact client items", () => {
  const { source, compiled, chunks } = wholeFirmFixture();
  assert.equal(compiled.expected.entries.length, 4);
  assert.deepEqual(compiled.packages.map(p => p.displayCategory), ["Qualified", "Held", "Rejected", "Incomplete"]);
  assert.ok(compiled.packages.every(p => p.envelope.sourceSystem === "caseload-whole-firm-v1" && p.envelope.sourceName === "whole-firm-qualification"));
  assert.equal(compiled.expected.runId, wholeFirmRunId(source.manifestSha256));
  assert.match(compiled.expected.runId, /^run-[a-f0-9]{48}$/);
  assert.equal(compiled.expected.runId, "run-" + protocolHash(["caseload-whole-firm-v1", source.manifestSha256]).slice(0, 48));
  assert.doesNotThrow(() => assertEnvelopeProfile(compiled.packages[0].envelope, "whole-firm"));
  assert.throws(() => assertEnvelopeProfile(compiled.packages[0].envelope, "legacy-backfill"), /envelope_profile_mismatch/);
  for (const [index, p] of compiled.packages.entries()) {
    const revision = source.originalExport.revisions[index] as { originalRevision: unknown };
    assert.equal(p.envelope.packageId, wholeFirmPackageId(p.envelope.runId, p.envelope.subject.researchKey, revision.originalRevision));
    assert.match(p.envelope.packageId, /^pe-[a-f0-9]{64}$/);
    const entry = compiled.expected.entries.find(e => e.clientPackageId === p.envelope.packageId)!;
    assert.deepEqual(entry.clientItems.map(i => i.clientItemId), items(p.envelope).map(i => i.id));
  }
  assert.doesNotThrow(() => assertWholeFirmManifestCoverage(source, chunks));
});
test("same frozen whole-firm snapshot replays while a changed snapshot cannot collide", () => {
  const one = wholeFirmFixture();
  assert.deepEqual(compileWholeFirmSnapshot(one.source), one.compiled);
  const exported = { ...one.exported, snapshotAt: "2026-09-23T12:01:00.000Z" };
  const source = freezeWholeFirmExport(exported, sha256(canonicalJson(exported))), two = compileWholeFirmSnapshot(source);
  assert.notEqual(two.expected.runId, one.compiled.expected.runId);
  assert.notEqual(two.packages[0].envelope.packageId, one.compiled.packages[0].envelope.packageId);
  assert.equal(items(two.packages[0].envelope)[0].sourceEventKey, items(one.compiled.packages[0].envelope)[0].sourceEventKey);
  assert.equal(items(two.packages[0].envelope)[0].semanticSha256, items(one.compiled.packages[0].envelope)[0].semanticSha256);
});
test("malformed and incomplete whole-firm revisions become explicit non-package holds with complete originals", () => {
  const { exported } = wholeFirmFixture();
  const raw = { strange: "never discard", nested: { nullValue: null } };
  const next = { ...exported, expectedRevisions: [...exported.expectedRevisions, { revisionId: "missing", researchKey: "synthetic-missing" }, { revisionId: "bad", researchKey: "synthetic-bad" }], revisions: [...exported.revisions, null, raw] };
  const source = freezeWholeFirmExport(next, sha256(canonicalJson(next))), result = compileWholeFirmSnapshot(source);
  assert.equal(result.expected.entries.length, 6);
  assert.equal(result.expected.entries.filter(e => e.clientPackageId === null).length, 2);
  assert.deepEqual(result.candidates[5].original, raw);
  assert.ok(result.expected.entries.filter(e => !e.clientPackageId).every(e => e.initialDisposition === "hold_schema" && e.itemCount === 0));
  assert.throws(() => freezeWholeFirmExport({ ...next, revisions: next.revisions.slice(1) }, "a".repeat(64)), /coverage_mismatch/);
  assert.throws(() => verifyWholeFirmManifest({ ...source, expectedRevisionCount: 5 }), /hash_mismatch/);
});
test("whole-firm manifest cannot omit held revisions and profiles cannot consume each other's approval", async t => {
  const { source, compiled, chunks, approval } = wholeFirmFixture(), outbox = await workspace(t);
  const queued = await enqueue(outbox, compiled.packages[1].envelope, source.snapshotAt);
  assert.doesNotThrow(() => checkApproval(queued.entry, approval, "whole-firm"));
  assert.doesNotThrow(() => checkManifestApproval(chunks, approval, "whole-firm"));
  assert.throws(() => validateManifestChunks(chunks), /manifest_chunk_invalid/);
  assert.throws(() => checkApproval(queued.entry, approval), /approval_manifest_invalid/);
  const backfill: ApprovalManifest = { schemaVersion: "prospect-enrichment-delivery-approval/v1", scope: "backfill", targetOrigin: approval.targetOrigin, projectId: approval.projectId, sourceManifestSha256: approval.sourceManifestSha256, runManifestSha256: approval.runManifestSha256, approvalReference: "synthetic-backfill-only", packages: approval.packages };
  assert.throws(() => checkApproval(queued.entry, backfill, "whole-firm"), /whole_firm_approval_scope_mismatch/);
  assert.throws(() => checkManifestApproval(chunks, { ...approval, packages: approval.packages.slice(1) }, "whole-firm"), /package_coverage_mismatch/);
  const reduced = structuredClone(chunks); reduced[0].entries.pop();
  assert.throws(() => assertWholeFirmManifestCoverage(source, reduced), /revision_coverage_mismatch/);
});
test("whole-firm malformed standard envelope preserves raw without inventing its assessment", () => {
  const { exported } = wholeFirmFixture(), raw = structuredClone(exported);
  const revision = raw.revisions[0] as { revisionId: string; originalRevision: unknown; standardEnvelope: Record<string, unknown> };
  revision.standardEnvelope = { arbitrary: "not a standard envelope" };
  const source = freezeWholeFirmExport(raw, sha256(canonicalJson(raw))), result = compileWholeFirmSnapshot(source);
  assert.equal(result.packages.length, 3);
  assert.equal(result.expected.entries.filter(e => !e.clientPackageId).length, 1);
  assert.deepEqual(result.candidates[0].original, raw.revisions[0]);
});
test("whole-firm registration, package retries and comparison gates use the approved finite snapshot", async t => {
  const outbox = await workspace(t), { source, compiled, chunks, approval } = wholeFirmFixture();
  const comparison = serializeComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer", capturedAt: source.snapshotAt, provenance: { reader: "synthetic-authenticated-reader", sourceArtifactSha256: "b".repeat(64), operatorAuthenticated: true }, identities: [], packages: [], events: [] }, source.snapshotAt).snapshot;
  const requests: { url: string; body: string }[] = [];
  let packageAttempts = 0;
  const p = compiled.packages[0], queued = await enqueue(outbox, p.envelope, source.snapshotAt);
  const fetcher = (async (url, init) => {
    requests.push({ url: String(url), body: String(init?.body) }); const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/manifest-chunks")) {
      const c = body.chunk, count = body.finalize ? c.chunkCount : c.chunkIndex + 1, entries = chunks.slice(0, count).flatMap(c => c.entries);
      return new Response(JSON.stringify({ outcome: body.finalize ? "finalized" : "chunk_registered", runId: c.runId, runKey: c.runId, sourceManifestSha256: c.sourceManifestSha256, manifestSha256: c.runManifestSha256, registeredChunkCount: count, expectedChunkCount: c.chunkCount, receivedEntryCount: entries.length, expectedEntryCount: c.expectedEntryCount, receivedPackageCount: entries.filter(e => e.clientPackageId).length, expectedPackageCount: c.expectedPackageCount, manifestState: body.finalize ? "finalized" : "open" }), { status: 200 });
    }
    if (++packageAttempts === 1) throw Error("synthetic lost response");
    return new Response(JSON.stringify({ clientPackageId: p.envelope.packageId, payloadSha256: p.payloadSha256, packageId: "33333333-3333-4333-8333-333333333333", state: "received" }), { status: 200 });
  }) as typeof fetch;
  const common = { outbox, profile: "whole-firm" as const, approval, confirmation: "SUBMIT-APPROVED-PROSPECT-RESEARCH", token: "synthetic-transport-only", fetcher, beforeNetwork: () => assertFreshComparison(comparison, source.snapshotAt) };
  const registration = await submitManifestChunks({ ...common, chunks, now: source.snapshotAt });
  assert.equal(registration.state, "finalized");
  assert.equal(requests.length, prepareManifestRequests(chunks, "whole-firm").requests.length);
  assert.equal((await submitOne({ ...common, key: queued.entry.key, now: source.snapshotAt })).state, "retry_pending");
  assert.equal((await submitOne({ ...common, key: queued.entry.key, now: "2026-09-23T12:00:05.000Z" })).state, "received");
  const sentPackages = requests.filter(r => r.url.endsWith("/drafts"));
  assert.equal(sentPackages[0].body, sentPackages[1].body);
  const secondSource = freezeWholeFirmExport({ ...source.originalExport, snapshotAt: "2026-09-23T12:01:00.000Z" }, "c".repeat(64));
  const second = compileWholeFirmSnapshot(secondSource), newChunks = chunkExpectedRunManifest(second.expected, 100, 1_048_576, "whole-firm");
  assert.throws(() => checkManifestApproval(validateManifestChunks(newChunks, "whole-firm"), approval, "whole-firm"), /exact_approval_scope/);
  assert.equal(protocolHash(JSON.parse(sentPackages[0].body)), p.payloadSha256);
});

test("register-manifest dry-run binds the final whole-firm request and reports no package delivery", async t => {
  const dir = await workspace(t), { source, compiled, chunks, approval } = wholeFirmFixture();
  const now = new Date().toISOString();
  const packageValues = compiled.packages.map(pkg => ({ envelope: pkg.envelope, payloadSha256: pkg.payloadSha256, legacyAssessmentProjectionClaims: pkg.legacyAssessmentProjectionClaims ?? [] }));
  const request = serializeComparisonRequest(compiled.expected, packageValues, "whole-firm");
  const snapshot = serializeComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer",
    capturedAt: now, provenance: { reader: "admin-prospect-enrichment-bootstrap/v1", sourceArtifactSha256: protocolHash(request.request), operatorAuthenticated: true },
    identities: [], packages: [], events: [] }, now).snapshot;
  const files = {
    source: path.join(dir, "source.json"), chunks: path.join(dir, "chunks.jsonl"), held: path.join(dir, "held.jsonl"),
    packages: path.join(dir, "packages.json"), comparison: path.join(dir, "bootstrap.json"), approval: path.join(dir, "approval.json"),
  };
  const approvalBytes = Buffer.from(JSON.stringify(approval));
  await fs.writeFile(files.source, JSON.stringify(source));
  await fs.writeFile(files.chunks, chunks.map(chunk => JSON.stringify(chunk)).join("\n") + "\n");
  await fs.writeFile(files.held, buildHeldCandidateEvidence(compiled.expected, compiled.candidates).map(row => JSON.stringify(row)).join("\n") + "\n");
  await fs.writeFile(files.packages, JSON.stringify(packageValues));
  await fs.writeFile(files.comparison, JSON.stringify(snapshot));
  await fs.writeFile(files.approval, approvalBytes);
  const args = ["register-manifest", "--profile", "whole-firm", "--manifest", files.source, "--manifest-chunks", files.chunks,
    "--held-evidence", files.held, "--packages", files.packages, "--snapshot", files.comparison, "--approval", files.approval,
    "--approval-sha256", sha256(approvalBytes), "--outbox", path.join(WHOLE_FIRM_PROFILE.outputRoot, "synthetic-bootstrap-outbox")];
  const result = await main(args) as { dryRun: boolean; networkRequests: number; packagesSubmitted: number; manifestRequests: number };
  assert.deepEqual(result, { dryRun: true, command: "register-manifest", runId: compiled.expected.runId,
    runManifestSha256: compiled.expected.manifestSha256, manifestRequests: prepareManifestRequests(chunks, "whole-firm", buildHeldCandidateEvidence(compiled.expected, compiled.candidates)).requests.length,
    packagesSubmitted: 0, networkRequests: 0, requiredConfirmation: "SUBMIT-APPROVED-PROSPECT-RESEARCH" });
  const wrongBinding = serializeComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer",
    capturedAt: now, provenance: { reader: "admin-prospect-enrichment-bootstrap/v1", sourceArtifactSha256: "0".repeat(64), operatorAuthenticated: true },
    identities: [], packages: [], events: [] }, now).snapshot;
  await fs.writeFile(files.comparison, JSON.stringify(wrongBinding));
  await assert.rejects(main(args), /bootstrap_comparison_binding_invalid/);
  const resumedSnapshot = serializeComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer",
    capturedAt: now, provenance: { reader: "admin-prospect-enrichment-bootstrap-resume/v1", sourceArtifactSha256: protocolHash(request.request), operatorAuthenticated: true },
    identities: [], packages: [], events: [] }, now).snapshot;
  await fs.writeFile(files.comparison, JSON.stringify(resumedSnapshot));
  const resumedRegistration = await main(args) as { dryRun: boolean; packagesSubmitted: number; networkRequests: number };
  assert.equal(resumedRegistration.dryRun, true);
  assert.equal(resumedRegistration.packagesSubmitted, 0);
  assert.equal(resumedRegistration.networkRequests, 0);
  const submitArgs = ["submit", "--profile", "whole-firm", "--key", "synthetic-package-key", "--manifest", files.source,
    "--manifest-chunks", files.chunks, "--held-evidence", files.held, "--packages", files.packages, "--snapshot", files.comparison,
    "--outbox", path.join(WHOLE_FIRM_PROFILE.outputRoot, "synthetic-resume-submit-outbox")];
  await assert.rejects(main(submitArgs), /finalized_comparison_required/);
  const finalizedSnapshot = serializeComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer",
    capturedAt: now, provenance: { reader: "admin-prospect-enrichment-comparison/v1", sourceArtifactSha256: protocolHash(request.request), operatorAuthenticated: true },
    identities: [], packages: compiled.expected.entries.filter(entry => entry.clientPackageId !== null).map(entry => ({ clientPackageId: entry.clientPackageId!,
      payloadSha256: entry.expectedPayloadSha256!, state: "missing", serverPackageId: null, visible: null })), events: [] }, now).snapshot;
  await fs.writeFile(files.comparison, JSON.stringify(finalizedSnapshot));
  const finalizedRegistration = await main(args) as { dryRun: boolean; packagesSubmitted: number; networkRequests: number };
  assert.equal(finalizedRegistration.dryRun, true);
  assert.equal(finalizedRegistration.packagesSubmitted, 0);
  assert.equal(finalizedRegistration.networkRequests, 0);
});

test("all-raw-hold whole-firm manifests dry-run without a package and cannot skip a nonempty batch", async t => {
  const dir = await workspace(t), base = wholeFirmFixture();
  const exported = { ...base.exported, revisions: base.exported.revisions.map(() => null) };
  const source = freezeWholeFirmExport(exported, sha256(canonicalJson(exported))), compiled = compileWholeFirmSnapshot(source);
  const sourceFile = path.join(dir, "source.json"), chunksFile = path.join(dir, "chunks.jsonl"), heldEvidenceFile = path.join(dir, "held-evidence.jsonl"), packagesFile = path.join(dir, "packages.json"), snapshotFile = path.join(dir, "comparison.json");
  await fs.writeFile(sourceFile, JSON.stringify(source));
  await fs.writeFile(chunksFile, chunkExpectedRunManifest(compiled.expected, 100, 1_048_576, "whole-firm").map(c => JSON.stringify(c)).join("\n"));
  await fs.writeFile(heldEvidenceFile, buildHeldCandidateEvidence(compiled.expected, compiled.candidates).map(c => JSON.stringify(c)).join("\n"));
  await fs.writeFile(packagesFile, "[]");
  const request = serializeComparisonRequest(compiled.expected, [], "whole-firm");
  const comparison = serializeComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer", capturedAt: new Date().toISOString(), provenance: { reader: "admin-prospect-enrichment-comparison/v1", sourceArtifactSha256: protocolHash(request.request), operatorAuthenticated: true }, identities: [], packages: [], events: [] });
  await fs.writeFile(snapshotFile, comparison.body);
  const args = ["submit", "--profile", "whole-firm", "--manifest-only", "--manifest", sourceFile, "--manifest-chunks", chunksFile, "--held-evidence", heldEvidenceFile, "--packages", packagesFile, "--snapshot", snapshotFile, "--outbox", path.join(WHOLE_FIRM_PROFILE.outputRoot, "synthetic-never-created-outbox")];
  const result = await main(args) as {dryRun:boolean; networkRequests:number};
  assert.equal(result.dryRun, true); assert.equal(result.networkRequests, 0);
  await fs.writeFile(chunksFile, base.chunks.map(c => JSON.stringify(c)).join("\n"));
  await fs.writeFile(heldEvidenceFile, buildHeldCandidateEvidence(base.compiled.expected, base.compiled.candidates).map(c => JSON.stringify(c)).join("\n"));
  await assert.rejects(main(args), /manifest_only_requires_zero_packages/);
});

test("whole-firm subject claims await authenticated comparison and empty evidence stays explicit", () => {
  const { exported } = wholeFirmFixture(), input = structuredClone(exported);
  const revision = input.revisions[0] as { standardEnvelope: ProspectEnrichmentEnvelope };
  revision.standardEnvelope = { ...revision.standardEnvelope, subject: { ...revision.standardEnvelope.subject, identityState: "resolved" }, sources: [], observations: [], assessment: null };
  const source = freezeWholeFirmExport(input, sha256(canonicalJson(input))), compiled = compileWholeFirmSnapshot(source);
  assert.equal(compiled.packages[0].envelope.subject.identityState, "unresolved");
  assert.equal(compiled.packages[0].state, "evidence_hold");
  assert.equal(compiled.packages[0].envelope.sources.length, 0);
  assert.equal(compiled.expected.entries.find(e => e.clientPackageId === compiled.packages[0].envelope.packageId)!.itemCount, 0);
});
