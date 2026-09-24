import test from "node:test";
import assert from "node:assert/strict";
import { compileCandidate, immutableResearchKey } from "../compiler";
import { candidate, sample, snapshot } from "../fixtures/synthetic";
import { displayCategory, getPointer, protocolHash, recordedDate, selectionDisposition } from "../model";
import { parseProspectEnrichmentEnvelope } from "../../../src/lib/prospect-enrichment-contract";

test("legacy dispositions preserve distinctions without selecting a merely qualified firm", () => {
  for (const status of ["qualified", "qualified_verified", "selected"]) assert.equal(selectionDisposition(status, "q50", null), "eligible-not-selected");
  assert.equal(selectionDisposition("selected", "q50", "q50"), "selected");
  for (const status of ["held", "identity_hold", "needs_evidence", "verification_required", "incomplete", "qualified_with_exception", null, "unknown-new-label"]) assert.equal(selectionDisposition(status, "q50"), "verification-required");
  assert.equal(selectionDisposition("policy_hold", "q50"), "policy-hold");
  assert.equal(selectionDisposition("technical_hold", "q50"), "technical-hold");
  assert.equal(selectionDisposition("rejected", "q50"), "disqualified");
  assert.equal(displayCategory("needs_evidence"), "Incomplete");
  assert.equal(displayCategory("qualified_with_exception"), "Held");
});
test("source-less and assessment-only candidates compile durable evidence holds", () => {
  for (const original of [{ firmName: "Synthetic Empty", workKey: "synthetic-empty", unknownFact: null }, { firmName: "Synthetic Assessed", workKey: "synthetic-assessed", status: "rejected" }]) {
    const result = compileCandidate(candidate(original), snapshot);
    assert.equal(result.issues.filter(i => i.code === "hold_schema").length, 0, JSON.stringify(result.issues));
    assert.equal(result.packages.length, 1);
    assert.equal(result.packages[0].state, "evidence_hold");
    assert.deepEqual(result.packages[0].envelope.sources, []);
    assert.deepEqual(result.packages[0].envelope.observations, []);
    if (result.packages[0].envelope.assessment) assert.equal(result.packages[0].envelope.assessment.researchOutcome, "unknown");
    assert.deepEqual(result.retainedOriginal, original);
  }
});
test("rich worker fixture preserves unknowns, separate contacts, source precision and raw leaf pointers", () => {
  const original = sample(), result = compileCandidate(candidate(original), snapshot);
  assert.ok(result.packages.length, JSON.stringify(result.issues));
  for (const p of result.packages) assert.equal(parseProspectEnrichmentEnvelope(p.envelope).ok, true);
  const observations = result.packages.flatMap(p => p.envelope.observations);
  const contacts = observations.filter(o => o.kind === "contact");
  assert.ok(contacts.some(c => c.data.contactValue === null));
  assert.ok(contacts.some(c => c.data.contactType === "general-inbox" && c.data.contactValue === "general@synthetic.example"));
  for (const source of result.packages.flatMap(p => p.envelope.sources)) { assert.equal(source.observedAt, null); assert.equal(source.observedOn, "2026-09-23"); assert.equal(source.retrievalOutcome, "legacy-unknown"); }
  const raw = result.packages[0].envelope.originalResearch;
  assert.deepEqual(raw.content, original);
  assert.ok(raw.unmappedPaths.includes("/record/unusualLegacyField/key~1with~0pointer/0"));
  for (const pointer of raw.unmappedPaths) assert.notEqual(getPointer(raw.content, pointer), undefined);
});
test("event IDs survive unrelated full-file edits and new frozen runs while package IDs do not collide", () => {
  const input = candidate(sample()), one = compileCandidate(input, snapshot), edited = { ...input, artifact: { ...input.artifact, fileSha256: "b".repeat(64) } };
  const two = compileCandidate(edited, { ...snapshot, manifestSha256: "c".repeat(64), snapshotAt: "2026-09-23T13:00:00.000Z" });
  assert.deepEqual(one.packages.flatMap(p => p.envelope.observations.map(o => o.observationId)).sort(), two.packages.flatMap(p => p.envelope.observations.map(o => o.observationId)).sort());
  assert.notEqual(one.packages[0].envelope.packageId, two.packages[0].envelope.packageId);
  assert.deepEqual(one, compileCandidate(input, snapshot));
  assert.match(one.packages[0].envelope.packageId, /^pe-[a-f0-9]{64}$/);
});
test("existing research key survives later registered identity linkage", () => {
  const first = sample(), second = structuredClone(first);
  Object.assign(second.record, { databaseFirmId: "11111111-1111-4111-8111-111111111111", firmId: "FIRM-00000000000000000000000000" });
  assert.equal(immutableResearchKey(candidate(first)), immutableResearchKey(candidate(second)));
});
test("one assessment envelope per original assessment and one unassigned envelope", () => {
  const raw = { workKey: "synthetic-split", firmName: "Synthetic Split", sources: [
    { sourceId: "source-a", url: "https://synthetic.example/a", observedAt: "2026-09-23" },
    { sourceId: "source-b", url: "https://synthetic.example/b", observedAt: "2026-09-23" },
  ], services: [
    { id: "finding-a", name: "Family", sourceIds: ["source-a"], observedAt: "2026-09-23" },
    { id: "finding-b", name: "Estates", sourceIds: ["source-b"], observedAt: "2026-09-23" },
    { id: "finding-unassigned", name: "Employment", observedAt: "2026-09-23" },
  ], qualificationAssessments: [
    { assessmentId: "a", qualificationState: "held", observedAt: "2026-09-23", findingIds: ["finding-a"] },
    { assessmentId: "b", qualificationState: "rejected", findingIds: ["finding-b"] },
  ] };
  const result = compileCandidate(candidate(raw), snapshot);
  assert.equal(result.packages.length, 3, JSON.stringify(result.issues));
  assert.equal(result.packages.filter(p => p.envelope.assessment).length, 2);
  assert.deepEqual(result.packages.map(p => p.envelope.observations.length), [1, 1, 1]);
  assert.deepEqual(result.packages.map(p => p.envelope.sources.length), [1, 1, 0]);
});
test("conflicting identities are not silently chosen; full originals remain available", () => {
  const raw = { workKey: "conflict", firmName: "Synthetic Conflict", databaseFirmId: "11111111-1111-4111-8111-111111111111", record: { firmName: "Synthetic Conflict", databaseFirmId: "22222222-2222-4222-8222-222222222222" } };
  const result = compileCandidate(candidate(raw), snapshot);
  assert.equal(result.packages[0].envelope.subject.identityState, "conflict");
  assert.equal(result.packages[0].envelope.subject.databaseFirmId, null);
  assert.deepEqual(result.retainedOriginal, raw);
});
test("calendar precision never invents a time or turns a year into an observation", () => {
  assert.deepEqual(recordedDate("2023"), { observedAt: null, observedOn: null, missingProvenanceReason: "source_date_not_supported_at_recorded_precision" });
  assert.equal(recordedDate("2026-02-30").observedOn, null);
  assert.equal(recordedDate("2026-99-99").observedAt, null);
  assert.equal(recordedDate("2026-09-23").observedAt, null);
});
test("forbidden prototype keys produce an explicit hold without dropping original bytes", () => {
  const raw = JSON.parse('{"workKey":"synthetic-unsafe","firmName":"Synthetic","constructor":{"x":1}}');
  const result = compileCandidate(candidate(raw), snapshot);
  assert.equal(result.packages.length, 0);
  assert.ok(result.issues.some(i => i.code === "hold_schema"));
  assert.equal(protocolHash(result.retainedOriginal), protocolHash(raw));
});

test("absent legacy opportunity confidence remains raw and unmapped instead of inventing low confidence", () => {
  const base = sample(), opportunity: Record<string, unknown> = { ...base.record.opportunity }; delete opportunity.confidence;
  const original = { ...base, record: { ...base.record, opportunity } };
  const result = compileCandidate(candidate(original), snapshot);
  assert.ok(result.issues.some(i => i.reason === "opportunity_confidence_not_recorded" && i.path === "/record/opportunity"));
  assert.ok(result.packages.every(p => p.envelope.observations.every(o => o.kind !== "opportunity")));
  assert.deepEqual(result.retainedOriginal, original);
  assert.ok(result.packages[0].envelope.originalResearch.unmappedPaths.includes("/record/opportunity"));
  assert.ok(result.packages[0].envelope.originalResearch.unmappedPaths.includes("/record/opportunity/observation"));
  for (const pointer of result.packages[0].envelope.originalResearch.unmappedPaths) assert.notEqual(getPointer(original, pointer), undefined);
});
