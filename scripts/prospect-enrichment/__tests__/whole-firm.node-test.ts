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
import { chunkExpectedRunManifest } from "../run-manifest";
import { serializeSyntheticComparisonExport as serializeComparisonExport } from "../fixtures/comparison-signing";

async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp");
  await fs.mkdir(root, { recursive: true });
  const temp = await fs.mkdtemp(path.join(root, "pe-lane3-synthetic-"));
  t.after(async () => { const real = await fs.realpath(temp); assert.ok(within(root, real) && path.basename(real).startsWith("pe-lane3-synthetic-")); await fs.rm(real, { recursive: true, force: true }); });
  return temp;
}
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

test("all-raw-hold whole-firm manifests dry-run without a package and cannot skip a nonempty batch", async t => {
  const dir = await workspace(t), base = wholeFirmFixture();
  const exported = { ...base.exported, revisions: base.exported.revisions.map(() => null) };
  const source = freezeWholeFirmExport(exported, sha256(canonicalJson(exported))), compiled = compileWholeFirmSnapshot(source);
  const sourceFile = path.join(dir, "source.json"), chunksFile = path.join(dir, "chunks.jsonl"), snapshotFile = path.join(dir, "comparison.json");
  await fs.writeFile(sourceFile, JSON.stringify(source));
  await fs.writeFile(chunksFile, chunkExpectedRunManifest(compiled.expected, 100, 1_048_576, "whole-firm").map(c => JSON.stringify(c)).join("\n"));
  const comparison = serializeComparisonExport({ schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer", capturedAt: new Date().toISOString(), provenance: { reader: "synthetic-authenticated-reader", sourceArtifactSha256: "b".repeat(64), operatorAuthenticated: true }, identities: [], packages: [], events: [] });
  await fs.writeFile(snapshotFile, comparison.body);
  const args = ["submit", "--profile", "whole-firm", "--manifest-only", "--manifest", sourceFile, "--manifest-chunks", chunksFile, "--snapshot", snapshotFile, "--outbox", path.join(WHOLE_FIRM_PROFILE.outputRoot, "synthetic-never-created-outbox")];
  const result = await main(args) as {dryRun:boolean; networkRequests:number};
  assert.equal(result.dryRun, true); assert.equal(result.networkRequests, 0);
  await fs.writeFile(chunksFile, base.chunks.map(c => JSON.stringify(c)).join("\n"));
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
