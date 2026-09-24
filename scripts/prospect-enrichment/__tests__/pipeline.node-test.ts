import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archivedDocuments, extractCandidates, inventory, verifyManifest } from "../inventory";
import { compileCandidate } from "../compiler";
import { deriveLegacyAssessmentProjection } from "../legacy-projection-mapper";
import type { ProspectEnrichmentEnvelope } from "../../../src/lib/prospect-enrichment-contract";
import { items, reconcilePackage, selectPilot, type ComparisonSnapshot } from "../reconciliation";
import { enqueue, readEntry, readState, retryTime, submitOne, type ApprovalManifest } from "../outbox";
import { candidate, sample, snapshot } from "../fixtures/synthetic";
import { protocolHash, within } from "../model";
import { serializeSyntheticComparisonExport, resignSyntheticComparisonSnapshot } from "../fixtures/comparison-signing";

async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const testTempRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp");
  await fs.mkdir(testTempRoot, { recursive: true });
  const temp = await fs.mkdtemp(path.join(testTempRoot, "pe-lane3-synthetic-"));
  t.after(async () => {
    const real = await fs.realpath(temp);
    assert.ok(within(testTempRoot, real) && path.basename(real).startsWith("pe-lane3-synthetic-"));
    await fs.rm(real, { recursive: true, force: true });
  });
  return temp;
}
function comparison(envelope: ProspectEnrichmentEnvelope, targets = false) {
  const content = {
    schemaVersion: "prospect-enrichment-comparison/v1" as const,
    projectId: "ssxryjxifwiivghglqer" as const,
    capturedAt: snapshot.snapshotAt,
    provenance: { reader: "synthetic-supported-operator-export", sourceArtifactSha256: "d".repeat(64), operatorAuthenticated: true as const },
    identities: [{ researchKey: envelope.subject.researchKey, databaseFirmId: "11111111-1111-4111-8111-111111111111", stableFirmId: "FIRM-00000000000000000000000000", sourceRecordKey: "synthetic-source-key", canonicalDomain: "synthetic.example" }],
    packages: [] as ComparisonSnapshot["packages"],
    events: (targets ? items(envelope).map(item => ({ sourceEventKey: item.sourceEventKey, semanticSha256: item.semanticSha256, researchKey: envelope.subject.researchKey, visible: true, primaryTarget: { table: item.kind === "assessment" ? "gta_prospect_qualification_assessments" : item.kind === "source" ? "prospect_source_captures" : "prospect_service_observations", id: "22222222-2222-4222-8222-222222222222", rowSha256: "e".repeat(64) }, targets: [{ table: item.kind === "assessment" ? "gta_prospect_qualification_assessments" : item.kind === "source" ? "prospect_source_captures" : "prospect_service_observations", id: "22222222-2222-4222-8222-222222222222", rowSha256: "e".repeat(64) }] })) : []) as ComparisonSnapshot["events"],
  };
  return serializeSyntheticComparisonExport(content,snapshot.snapshotAt).snapshot;
}
test("frozen snapshot archives complete files and compiler accounts for qualified, held, rejected and incomplete candidates", async t => {
  const temp = await workspace(t), a = path.join(temp, "a"), b = path.join(temp, "b"), output = path.join(temp, "output");
  await fs.mkdir(path.join(a, "data"), { recursive: true }); await fs.mkdir(b);
  const records = ["qualified", "held", "rejected", "incomplete"].map((status, i) => ({ ...sample(status), workKey: "synthetic-" + i }));
  await fs.writeFile(path.join(a, "data", "research.json"), JSON.stringify({ runId: "synthetic-original-run", records }));
  await fs.mkdir(path.join(a, "storage", "request_queues"), { recursive: true });
  await fs.writeFile(path.join(a, "storage", "request_queues", "runtime.json"), JSON.stringify(sample()));
  const manifest = await inventory({ roots: [{ id: "root-a", path: a }, { id: "root-b", path: b }], outputRoot: output, snapshotAt: snapshot.snapshotAt });
  assert.equal(manifest.artifacts.length, 1); verifyManifest(manifest);
  const archived = await archivedDocuments(manifest);
  const extracted = archived.documents.flatMap(doc => extractCandidates(doc).candidates);
  assert.equal(extracted.length, 4);
  const compiled = extracted.map(input => compileCandidate(input, manifest));
  assert.deepEqual(compiled.map(c => c.packages.find(p => p.envelope.assessment)!.displayCategory), ["Qualified", "Held", "Rejected", "Incomplete"]);
  assert.ok(compiled.every(c => c.packages.length > 0));
  assert.deepEqual(compiled[2].retainedOriginal, { candidate: records[2], parentMetadata: { runId: "synthetic-original-run" } });
  await fs.writeFile(path.join(a, "data", "research.json"), "new unrelated source bytes");
  const stillFrozen = await archivedDocuments(manifest);
  assert.deepEqual(stillFrozen.documents[0].value, archived.documents[0].value);
});
test("changed source files, malformed JSONL, missing references and out-of-scope references are visible holds", async t => {
  const temp = await workspace(t), a = path.join(temp, "a"), output = path.join(temp, "output");
  await fs.mkdir(path.join(a, "data"), { recursive: true });
  const changing = path.join(a, "data", "changing.json");
  await fs.writeFile(changing, JSON.stringify(sample()));
  await fs.writeFile(path.join(a, "data", "lines.jsonl"), JSON.stringify({ workKey: "one", firmName: "Synthetic One", sourcePath: "../outside.json", evidenceArtifact: "data/missing.json" }) + "\n{invalid\n");
  let mutated = false;
  const manifest = await inventory({ roots: [{ id: "root-a", path: a }], outputRoot: output, snapshotAt: snapshot.snapshotAt, beforeRecheck: async file => {
    if (file === changing && !mutated) { mutated = true; await fs.writeFile(file, JSON.stringify({ ...sample(), added: true })); }
  } });
  assert.ok(manifest.issues.some(i => i.code === "source_changed_during_snapshot"));
  assert.ok(manifest.issues.some(i => i.code === "hold_schema"));
  assert.ok(manifest.issues.some(i => i.code === "reference_out_of_scope"));
  assert.ok(manifest.issues.some(i => i.code === "source_read_failed"));
  const archived = await archivedDocuments(manifest);
  assert.equal(archived.documents.length, 1);
  assert.equal(archived.documents[0].pointer, "line:1");
});
test("archive tampering and manifest tampering fail closed", async t => {
  const temp = await workspace(t), a = path.join(temp, "a"), output = path.join(temp, "output");
  await fs.mkdir(path.join(a, "data"), { recursive: true }); await fs.writeFile(path.join(a, "data", "one.json"), JSON.stringify(sample()));
  const manifest = await inventory({ roots: [{ id: "root-a", path: a }], outputRoot: output, snapshotAt: snapshot.snapshotAt });
  assert.throws(() => verifyManifest({ ...manifest, snapshotAt: "2026-09-23T15:00:00Z" }), /hash_mismatch/);
  await fs.writeFile(manifest.artifacts[0].archivePath, "changed archive");
  await assert.rejects(archivedDocuments(manifest), /archive_hash_mismatch/);
});
test("exact existing receipts are reused, altered payloads conflict, stale comparisons never trigger staging", () => {
  const compiled = compileCandidate(candidate(sample()), snapshot).packages[0];
  const base = comparison(compiled.envelope);
  assert.equal(reconcilePackage(compiled, base, { now: snapshot.snapshotAt }).action, "stage_new");
  assert.equal(reconcilePackage(compiled, base, { now: "2026-09-23T12:16:00.000Z" }).action, "receipt_unverified");
  assert.equal(reconcilePackage(compiled, null).action, "receipt_unverified");
  base.packages.push({ clientPackageId: compiled.envelope.packageId, payloadSha256: compiled.payloadSha256, state: "received", serverPackageId: "33333333-3333-4333-8333-333333333333", visible: null });
  Object.assign(base,resignSyntheticComparisonSnapshot(base));
  assert.equal(reconcilePackage(compiled, base, { now: snapshot.snapshotAt }).action, "reuse_existing_draft");
  base.packages[0].payloadSha256 = "0".repeat(64);
  Object.assign(base,resignSyntheticComparisonSnapshot(base));
  assert.equal(reconcilePackage(compiled, base, { now: snapshot.snapshotAt }).action, "idempotency_conflict");
});
test("accepted historic assessment links derived criteria evidence without creating duplicate contact/tag rows", () => {
  const raw = { workKey: "synthetic-legacy-assessment", firmName: "Synthetic Legacy", qualificationAssessments: [{ assessmentId: "legacy-parent", qualificationState: "held", criteria: { directPublishedEmail: { address: "lawyer@synthetic.example", attributedTo: "Synthetic Lawyer", observedAt: "2026-09-23", sourceUrl: "https://synthetic.example/person" } } }] };
  const compiled = compileCandidate(candidate(raw), snapshot).packages.find(p => p.envelope.assessment)!;
  const base = comparison(compiled.envelope, true);
  base.events = base.events.filter(e => e.primaryTarget?.table === "gta_prospect_qualification_assessments");
  const claim = compiled.legacyAssessmentProjectionClaims![0];
  const derived = deriveLegacyAssessmentProjection(compiled.envelope, claim, raw.qualificationAssessments[0].criteria);
  assert.ok(derived);
  base.events[0].legacyAssessmentProjections = [{...derived,parentAssessmentTarget:base.events[0].primaryTarget!,databaseFirmId:base.identities[0].databaseFirmId}];
  Object.assign(base,resignSyntheticComparisonSnapshot(base));
  const action = reconcilePackage(compiled, base, { now: snapshot.snapshotAt, sourceClaimsAccepted: true });
  assert.equal(action.action, "link_existing");
  assert.equal(action.envelope.observations[0].existingRecord, null);
  assert.equal(action.envelope.assessment!.existingRecord!.table, "gta_prospect_qualification_assessments");
  assert.equal(action.retained[0].reason, "already_preserved_in_linked_legacy_assessment");
});
test("pilot chooses two exact ordinal keys per category and refuses category substitution", () => {
  const packages = ["qualified", "held", "rejected", "incomplete", "held"].flatMap((status, partition) => [0, 1].map(i => {
    const compiled = compileCandidate(candidate({ workKey: "synthetic-" + partition + "-" + i, firmName: "Synthetic", status }), snapshot).packages[0];
    return { ...compiled, envelope: { ...compiled.envelope, subject: { ...compiled.envelope.subject, identityState: partition === 4 ? "unresolved" as const : "resolved" as const } } };
  }));
  const pilot = selectPilot(packages); assert.equal(pilot.ready, true); assert.equal(pilot.selected.length, 10);
  const short = selectPilot(packages.slice(1)); assert.equal(short.ready, false); assert.ok(short.issues.some(i => i.code === "pilot_partition_shortfall"));
});
test("immutable outbox replays exact bytes after timeout and rejects changed approvals or payloads", async t => {
  const temp = await workspace(t);
  const envelope = compileCandidate(candidate({ workKey: "synthetic-delivery", firmName: "Synthetic", status: "held" }), snapshot).packages[0].envelope;
  const queued = await enqueue(temp, envelope, snapshot.snapshotAt);
  assert.equal((await enqueue(temp, envelope)).replay, true);
  await assert.rejects(enqueue(temp, { ...envelope, generatedAt: "2026-09-23T12:00:01.000Z" }), /outbox_idempotency_conflict/);
  const approval: ApprovalManifest = { schemaVersion: "prospect-enrichment-delivery-approval/v1", scope: "pilot", targetOrigin: "https://admin.caseloadselect.ca", projectId: "ssxryjxifwiivghglqer", sourceManifestSha256: snapshot.manifestSha256, approvalReference: "synthetic-test-authorization-only", packages: [{ clientPackageId: envelope.packageId, payloadSha256: queued.entry.payloadSha256 }] };
  const sent: string[] = [];
  const fetcher = async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => { assert.equal(typeof init?.body, "string"); sent.push(init!.body as string); if (sent.length === 1) throw Error("synthetic timeout"); return new Response(JSON.stringify({ clientPackageId: envelope.packageId, payloadSha256: queued.entry.payloadSha256, packageId: "33333333-3333-4333-8333-333333333333", state: "received" }), { status: 200 }); };
  const options = { outbox: temp, key: queued.entry.key, approval, confirmation: "SUBMIT-APPROVED-PROSPECT-RESEARCH", token: "synthetic-token", fetcher: fetcher as typeof fetch };
  const first = await submitOne({ ...options, now: snapshot.snapshotAt }); assert.equal(first.state, "retry_pending"); assert.equal(first.nextAttemptAt, "2026-09-23T12:00:05.000Z");
  const second = await submitOne({ ...options, now: "2026-09-23T12:00:05.000Z" }); assert.equal(second.state, "received"); assert.equal(second.attempts, 2); assert.equal(sent[0], sent[1]);
  assert.equal((await readEntry(temp, queued.entry.key)).body, sent[0]);
  await assert.rejects(submitOne({ ...options, approval: { ...approval, packages: [] } }), /exact_approval_scope/);
});
test("delivery stops on 401, preserves rate-limit retry-after and caps retries", async t => {
  const temp = await workspace(t);
  const envelope = compileCandidate(candidate({ workKey: "synthetic-stop", firmName: "Synthetic" }), snapshot).packages[0].envelope;
  const queued = await enqueue(temp, envelope);
  const approval: ApprovalManifest = { schemaVersion: "prospect-enrichment-delivery-approval/v1", scope: "backfill", targetOrigin: "https://admin.caseloadselect.ca", projectId: "ssxryjxifwiivghglqer", sourceManifestSha256: snapshot.manifestSha256, approvalReference: "synthetic", packages: [{ clientPackageId: envelope.packageId, payloadSha256: queued.entry.payloadSha256 }] };
  const state = await submitOne({ outbox: temp, key: queued.entry.key, approval, confirmation: "SUBMIT-APPROVED-PROSPECT-RESEARCH", token: "synthetic", now: snapshot.snapshotAt, fetcher: (async () => new Response("not disclosed", { status: 401 })) as typeof fetch });
  assert.equal(state.state, "manual_review"); assert.equal(state.lastError, "http_401");
  assert.equal(retryTime(1, snapshot.snapshotAt, "300"), "2026-09-23T12:05:00.000Z");
  assert.equal(retryTime(4, snapshot.snapshotAt), "2026-09-23T12:10:00.000Z");
  assert.equal(retryTime(5, snapshot.snapshotAt), null);
});

test("expected run inventory accounts for every package and package-less source/schema exception", async () => {
  const { buildExpectedRunManifest, chunkExpectedRunManifest } = await import("../run-manifest");
  const compiled = compileCandidate(candidate({ workKey: "manifest-one", firmName: "Synthetic", status: "held" }), snapshot);
  const sourceBase = { schemaVersion: "prospect-backfill-manifest/v1" as const, snapshotAt: snapshot.snapshotAt, roots: [], artifacts: [], issues: [] };
  const manifest = { ...sourceBase, manifestSha256: protocolHash(sourceBase) };
  const inputCoverage = [{ researchKey: compiled.researchKey, sourceRoot: "root-a", relativePath: "data/one.json", sourcePointer: "", sourceSha256: "d".repeat(64), packageIds: compiled.packages.map(p => p.envelope.packageId), issues: [] }, { researchKey: "bad-candidate", sourceRoot: "root-a", relativePath: "data/bad.json", sourcePointer: "", sourceSha256: "e".repeat(64), packageIds: [], issues: [{ code: "hold_limit", path: "", reason: "Original exceeds transport limit" }] }];
  const expected = buildExpectedRunManifest(manifest, compiled.packages, inputCoverage, [{ code: "source_root_unavailable", path: "root-b", reason: "Synthetic inaccessible root" }]);
  assert.equal(expected.expectedPackageCount, 1);
  assert.equal(expected.entries.length, 3);
  assert.ok(expected.entries.some(e => e.clientPackageId === null && e.researchKey === "bad-candidate" && e.errorCodes.includes("hold_limit")));
  assert.ok(expected.entries.some(e => e.researchKey === null && e.source.fileSha256 === null));
  const item = expected.entries.find(e => e.clientPackageId)!;
  assert.equal(item.itemCount, compiled.packages[0].envelope.sources.length + compiled.packages[0].envelope.observations.length + 1);
  assert.equal(item.clientItems.length, item.itemCount);
  const chunks = chunkExpectedRunManifest(expected, 1);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.flatMap(c => c.entries), expected.entries);
  for (const chunk of chunks) assert.equal(chunk.chunkSha256, protocolHash(chunk.entries));
});
test("retracted evidence remains explicit and cannot be silently treated as a new asserted finding", () => {
  const raw = sample();
  Object.assign(raw.record.opportunity, { state: "retracted", retractionReason: "The follow-up source disproved the original claim." });
  const compiled = compileCandidate(candidate(raw), snapshot);
  const p = compiled.packages.find(p => p.envelope.observations.some(o => o.evidenceState === "retracted"))!;
  assert.ok(p);
  const retracted = p.envelope.observations.find(o => o.evidenceState === "retracted")!;
  assert.equal(retracted.retractionReason, "The follow-up source disproved the original claim.");
  assert.ok(retracted.retractionSourceIds.length > 0);
  const action = reconcilePackage(p, comparison(p.envelope), { now: snapshot.snapshotAt });
  assert.ok(action.retained.some(r => r.itemId === items(p.envelope).find(item => item.originalId === retracted.observationId)!.id));
});
test("pilot uses explicit accepted current assessment without deleting earlier dispositions", () => {
  const held = compileCandidate(candidate({ workKey: "history", firmName: "Synthetic", status: "held" }), snapshot).packages[0];
  const qualified = compileCandidate(candidate({ workKey: "history", firmName: "Synthetic", status: "qualified" }), { ...snapshot, manifestSha256: "f".repeat(64) }).packages[0];
  const history = [held, qualified].map(p => ({ ...p, envelope: { ...p.envelope, subject: { ...p.envelope.subject, identityState: "resolved" as const } } }));
  assert.ok(selectPilot(history).issues.some(i => i.code === "pilot_assessment_conflict"));
  const result = selectPilot(history, [{ researchKey: "history", clientAssessmentId: items(qualified.envelope).find(item => item.kind === "assessment")!.id }]);
  assert.ok(!result.issues.some(i => i.code === "pilot_assessment_conflict"));
  assert.equal(result.selected[0].partition, "Qualified");
  assert.equal(result.selected[0].packageIds.length, 2);
});

test("final reconciliation rebinding changes manifest payload metadata without changing original evidence", async () => {
  const { bindReconciledPackages } = await import("../reconciliation");
  const compiled = compileCandidate(candidate(sample()), snapshot).packages;
  const actions = compiled.map(p => reconcilePackage(p, comparison(p.envelope), { now: snapshot.snapshotAt }));
  const rebound = bindReconciledPackages(compiled, actions);
  assert.equal(rebound[0].envelope.subject.identityState, "resolved");
  assert.notEqual(rebound[0].payloadSha256, compiled[0].payloadSha256);
  assert.deepEqual(rebound[0].envelope.originalResearch, compiled[0].envelope.originalResearch);
  assert.deepEqual(items(rebound[0].envelope).map(i => i.semanticSha256), items(compiled[0].envelope).map(i => i.semanticSha256));
  assert.throws(() => bindReconciledPackages(compiled, []), /coverage_mismatch/);
  const changed = structuredClone(actions); changed[0] = { ...changed[0], envelope: { ...changed[0].envelope, generatedAt: "2026-09-23T12:00:01.000Z" } };
  assert.throws(() => bindReconciledPackages(compiled, changed), /changed_original_evidence/);
});

test("package delivery rechecks freshness after local preparation and sends no stale POST", async t => {
  const outbox = await workspace(t), envelope = compileCandidate(candidate({ workKey: "synthetic-stale-package", firmName: "Synthetic" }), snapshot).packages[0].envelope;
  const queued = await enqueue(outbox, envelope, snapshot.snapshotAt);
  const approval: ApprovalManifest = { schemaVersion: "prospect-enrichment-delivery-approval/v1", scope: "pilot", targetOrigin: "https://admin.caseloadselect.ca", projectId: "ssxryjxifwiivghglqer", sourceManifestSha256: snapshot.manifestSha256, approvalReference: "synthetic", packages: [{ clientPackageId: envelope.packageId, payloadSha256: queued.entry.payloadSha256 }] };
  let calls = 0;
  await assert.rejects(submitOne({ outbox, key: queued.entry.key, approval, confirmation: "SUBMIT-APPROVED-PROSPECT-RESEARCH", token: "synthetic", now: snapshot.snapshotAt, beforeNetwork: () => { throw Error("comparison_stale"); }, fetcher: (async () => { calls++; throw Error("must never run"); }) as typeof fetch }), /comparison_stale/);
  assert.equal(calls, 0); assert.equal((await readState(outbox, queued.entry.key)).attempts, 0);
});
