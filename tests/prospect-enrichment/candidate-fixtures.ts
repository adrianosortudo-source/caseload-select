import type { CandidateDetail, CandidateHistory, CandidateHistoryItem, CandidateList, CandidateSummary } from "../../src/lib/prospect-enrichment-candidate-contract";
export const candidateStatuses = ["selected", "held", "rejected", "incomplete", "not_selected", "malformed", "missing_key", "conflicting_identity"] as const;
export const candidateSummaries: CandidateSummary[] = candidateStatuses.map((status, index) => ({
  id: `81000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  identityNamespace: status === "missing_key" ? "run:82000000-0000-4000-8000-000000000001" : "source:synthetic-candidates",
  identityKey: status === "missing_key" ? "manifest-entry-without-key" : "synthetic-" + status,
  displayName: "Synthetic " + status + " research", verifiedFirmId: null,
  identityState: status === "conflicting_identity" ? "conflict" : "unresolved", revisionCount: 2,
  originalStatuses: status === "missing_key" ? [] : [status], selectionDispositions: status === "selected" ? ["selected"] : status === "not_selected" ? ["eligible-not-selected"] : ["verification-required"],
  processingDispositions: [status === "rejected" ? "rejected" : "evidence_hold"], qualificationStates: ["needs_evidence"],
  latestRecordedAt: "2026-09-24T17:00:00Z", readWarnings: ["identity_unresolved"],
}));
export const candidateList: CandidateList = { items: candidateSummaries, nextCursor: null, inventoryCount: candidateSummaries.length, filteredCount: candidateSummaries.length, coverageRevision: 42, readWarnings: ["source_evidence_held"], complete: false };
export function candidateDetail(id: string): CandidateDetail {
  const candidate = candidateSummaries.find(item => item.id === id); if (!candidate) throw new Error("Unknown synthetic candidate");
  return { candidate, profileChoices: [], coverageRevision: 42, readWarnings: ["identity_unresolved"], complete: false };
}
export function candidateHistory(id: string): CandidateHistory {
  const candidate = candidateDetail(id).candidate;
  const items: CandidateHistoryItem[] = [false, true].map((value, index) => ({
    id: `83000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, candidateId: id, contentDeferred: false,
    itemKind: candidate.originalStatuses[0] === "malformed" ? "provenance_revision" : "research_revision", runId: "82000000-0000-4000-8000-000000000001", entryId: "synthetic-entry-" + index, packageId: null,
    originalStatus: candidate.originalStatuses[0] ?? null, selectionDisposition: candidate.selectionDispositions[0], processingDisposition: candidate.processingDispositions[0], qualificationState: "needs_evidence",
    sourceRoot: "synthetic", relativePath: "examples/research.json", sourcePointer: "/candidates/0", sourceFileSha256: "a".repeat(64), payloadSha256: String(index + 1).repeat(64), originalJsonSha256: "b".repeat(64),
    originalJson: { originalStatus: candidate.originalStatuses[0] ?? null, qualification_state: "needs_evidence", unknownFact: value, "escaped/~field": null, emptyList: [], emptyObject: {}, sources: [{ sourceId: "synthetic-source", url: "https://synthetic.example.test/research", observedOn: index ? "2026-09-24" : null, retrievedAt: null }], website_intake_channels: ["phone", { kind: "web-form", sourceUrl: "https://synthetic.example.test/contact", visibleFields: ["Name", "Consent"] }], evidenceState: index ? "retracted" : "asserted", retrievalOutcome: "unknown" },
    unmappedPaths: ["/unknownFact"], observedAt: index ? "2026-09-24" : null, retrievedAt: null, recordedAt: "2026-09-24T17:00:00Z", readWarnings: index ? ["source_retracted"] : ["source_date_unknown"],
    fields: [{ pointer: "/unknownFact", scalarType: "boolean", value, sourceItemId: "synthetic-observation", sourceIds: ["synthetic-source"], observedAt: index ? "2026-09-24" : null, retrievedAt: null, validationState: index ? "retracted" : "retained_original" }, { pointer: "/sources/0/url", scalarType: "string", value: "https://synthetic.example.test/research", sourceItemId: "synthetic-source", sourceIds: ["synthetic-source"], observedAt: null, retrievedAt: null, validationState: "retained_original" }, { pointer: "/escaped~1~0field", scalarType: "null", value: null, sourceItemId: null, sourceIds: [], observedAt: null, retrievedAt: null, validationState: "retained_original" }],
  }));
  return { items, nextCursor: null, coverageRevision: 42, readWarnings: ["source_evidence_held"], complete: false };
}
