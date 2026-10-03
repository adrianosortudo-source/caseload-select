import { parseProspectEnrichmentEnvelope, type ProspectEnrichmentEnvelope, type JsonValue } from "../../src/lib/prospect-enrichment-contract";
import type { CompiledPackage } from "./compiler";
import { validateLegacyAssessmentProjectionClaims, type LegacyAssessmentProjectionClaim } from "./legacy-projections";
import { canonicalJson, displayCategory, object, ordinal, protocolHash, recordedDate, sha256, type Issue } from "./model";
import { retainedWholeFirmStableClaim, validWholeFirmIdentityClaimPolicy, type WholeFirmIdentityClaimPolicy } from "./whole-firm-identity-claims";
import { buildExpectedRunManifest, type CandidateCoverage, type ExpectedRunManifest } from "./run-manifest";
import { bindReconciledPackages, type ReconciledAction } from "./reconciliation";
import type { ManifestChunk } from "./manifest-delivery";
import { WHOLE_FIRM_PROFILE, wholeFirmPackageId, wholeFirmRunId } from "./profiles";

export type WholeFirmCoordinatorExport = {
  schemaVersion: "prospect-whole-firm-coordinator-export/v1";
  snapshotAt: string;
  expectedRevisions: { revisionId: string; researchKey: string }[];
  revisions: unknown[];
  compilerIdentityClaimPolicy?: WholeFirmIdentityClaimPolicy;
  sourceInventory?: unknown;
};
export type WholeFirmSourceManifest = {
  schemaVersion: "prospect-whole-firm-source-manifest/v1";
  snapshotAt: string;
  sourceExportSha256: string;
  expectedRevisionCount: number;
  originalExport: WholeFirmCoordinatorExport;
  manifestSha256: string;
};
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
/** Freezes a coordinator-declared finite revision batch, never the mutable live queue. */
export function freezeWholeFirmExport(input: unknown, sourceExportSha256: string): WholeFirmSourceManifest {
  if (!object(input) || input.schemaVersion !== "prospect-whole-firm-coordinator-export/v1" || typeof input.snapshotAt !== "string" || !/^\d{4}-\d\d-\d\dT.*Z$/.test(input.snapshotAt) || !Number.isFinite(Date.parse(input.snapshotAt)) || !Array.isArray(input.expectedRevisions) || !Array.isArray(input.revisions) || !hash(sourceExportSha256)) throw Error("whole_firm_export_schema_invalid");
  if (!input.expectedRevisions.every(v => object(v) && nonempty(v.revisionId) && nonempty(v.researchKey)) || new Set(input.expectedRevisions.map(v => (v as { revisionId: string }).revisionId)).size !== input.expectedRevisions.length) throw Error("whole_firm_revision_inventory_invalid");
  // A missing revision is represented explicitly by null at its declared position.
  if (input.expectedRevisions.length !== input.revisions.length) throw Error("whole_firm_revision_coverage_mismatch");
  const originalExport = JSON.parse(canonicalJson(input)) as WholeFirmCoordinatorExport;
  const content = { schemaVersion: "prospect-whole-firm-source-manifest/v1" as const, snapshotAt: originalExport.snapshotAt, sourceExportSha256, expectedRevisionCount: originalExport.expectedRevisions.length, originalExport };
  return { ...content, manifestSha256: protocolHash(content) };
}
export function verifyWholeFirmManifest(input: WholeFirmSourceManifest): void {
  const rebuilt = freezeWholeFirmExport(input.originalExport, input.sourceExportSha256);
  if (canonicalJson(rebuilt) !== canonicalJson(input)) throw Error("whole_firm_source_manifest_hash_mismatch");
}
/** New source/run/package identities; complete retained originals remain unchanged. */
export function deriveWholeFirmIdentityClaimSource(source: WholeFirmSourceManifest, provenance: Pick<WholeFirmIdentityClaimPolicy, "compilerCommit" | "compilerFileSha256" | "baselineLedgerSha256">): WholeFirmSourceManifest {
  verifyWholeFirmManifest(source);
  if (source.originalExport.compilerIdentityClaimPolicy !== undefined) throw Error("whole_firm_identity_claim_source_already_derived");
  const policy: WholeFirmIdentityClaimPolicy = { schemaVersion: "prospect-whole-firm-identity-claim-policy/v1", policyVersion: "retained-registration-stable-claim/v1", parentSourceManifestSha256: source.manifestSha256, ...provenance };
  if (!validWholeFirmIdentityClaimPolicy(policy)) throw Error("whole_firm_identity_claim_policy_invalid");
  const exported = { ...source.originalExport, compilerIdentityClaimPolicy: policy };
  return freezeWholeFirmExport(exported, sha256(canonicalJson(exported) + "\n"));
}
type RevisionCoverage = CandidateCoverage & { revisionId: string; original: unknown; originalStatus: unknown };
export function compileWholeFirmSnapshot(source: WholeFirmSourceManifest, actions?: ReconciledAction[]): { packages: CompiledPackage[]; candidates: RevisionCoverage[]; issues: Issue[]; expected: ExpectedRunManifest } {
  verifyWholeFirmManifest(source);
  const runId = wholeFirmRunId(source.manifestSha256), packages: CompiledPackage[] = [], candidates: RevisionCoverage[] = [], issues: Issue[] = [];
  for (const [index, expected] of source.originalExport.expectedRevisions.entries()) {
    const original = source.originalExport.revisions[index], pointer = "/originalExport/revisions/" + index;
    const coverage: RevisionCoverage = { revisionId: expected.revisionId, researchKey: expected.researchKey, sourceRoot: "whole-firm-coordinator-export", relativePath: "source-manifest.json", sourcePointer: pointer, sourceSha256: source.sourceExportSha256, packageIds: [], issues: [], original, originalStatus: null };
    candidates.push(coverage);
    if (object(original) && Array.isArray(original.producerIssues)) for (const i of original.producerIssues) if (object(i) && typeof i.code === "string" && typeof i.path === "string" && typeof i.reason === "string") { const issue = { code: i.code, path: i.path, reason: i.reason }; coverage.issues.push(issue); issues.push(issue); }
    const hold = (code: string, reason: string) => { const issue = { code, path: pointer, reason }; coverage.issues.push(issue); issues.push(issue); };
    if (!object(original) || original.revisionId !== expected.revisionId || !Object.hasOwn(original, "originalRevision") || original.originalRevision === null) { hold("whole_firm_revision_incomplete", "Declared revision is missing/malformed; preserve the complete raw snapshot and do not fabricate evidence."); continue; }
    const revision = original.originalRevision;
    coverage.originalStatus = object(revision) ? revision.disposition ?? revision.status ?? null : null;
    const recordedResult = object(revision) && object(revision.result) ? revision.result : null;
    if (recordedResult) {
      const completion = recordedDate(recordedResult.completedAt);
      const timestampIssue = completion.missingProvenanceReason === "not_recorded_in_source"
        ? "result_completed_at_not_recorded"
        : completion.missingProvenanceReason ? "result_completed_at_invalid" : null;
      if (timestampIssue) {
        if (!coverage.issues.some(issue => issue.code === timestampIssue)) hold(timestampIssue, "A persisted result without a supported recorded completedAt stays a package-less technical hold; no timestamp is inferred.");
        continue;
      }
    }
    if (!object(original.standardEnvelope)) { hold("whole_firm_standard_envelope_missing", "The coordinator must provide one explicit standard envelope for this immutable revision."); continue; }
    const subject = object(original.standardEnvelope.subject) ? { ...original.standardEnvelope.subject, identityState: original.standardEnvelope.subject.identityState === "conflict" ? "conflict" : "unresolved" } : original.standardEnvelope.subject;
    const proposed = { ...original.standardEnvelope, subject, schemaVersion: "prospect-enrichment/v1", runId, packageId: wholeFirmPackageId(runId, expected.researchKey, revision), sourceSystem: WHOLE_FIRM_PROFILE.sourceSystem, sourceName: WHOLE_FIRM_PROFILE.sourceName, generatedAt: source.snapshotAt };
    const parsed = parseProspectEnrichmentEnvelope(proposed);
    if (!parsed.ok) { for (const issue of parsed.issues) hold("hold_schema", issue.path + ": " + issue.message); continue; }
    let envelope: ProspectEnrichmentEnvelope = parsed.envelope;
    if (envelope.subject.researchKey !== expected.researchKey || protocolHash(envelope.originalResearch.content) !== protocolHash(revision)) { hold("whole_firm_revision_evidence_mismatch", "The envelope must preserve this exact immutable revision content and researchKey."); continue; }
    if (source.originalExport.compilerIdentityClaimPolicy !== undefined) {
      if (!validWholeFirmIdentityClaimPolicy(source.originalExport.compilerIdentityClaimPolicy)) { hold("retained_identity_claim_hold", "Derived claim policy provenance is invalid."); }
      else {
        const claim = retainedWholeFirmStableClaim(revision, envelope, source.originalExport.sourceInventory);
        if (claim.issue) { hold(claim.issue.code, claim.issue.reason); if (claim.conflicting) envelope = { ...envelope, subject: { ...envelope.subject, identityState: "conflict" } }; }
        else if (envelope.subject.stableFirmId === null) envelope = { ...envelope, subject: { ...envelope.subject, stableFirmId: claim.stableFirmId, identityState: "unresolved" } };
      }
    }
    if (envelope.assessment === null && envelope.observations.length === 0) {
      // Typed-empty held/incomplete research still has its complete original content.
      hold("whole_firm_evidence_hold", "No typed observation or assessment is present; complete raw revision remains staged research only.");
    }
    const projectionIssues = validateLegacyAssessmentProjectionClaims(envelope, original.legacyAssessmentProjectionClaims);
    if (projectionIssues.length) { for (const issue of projectionIssues) hold("hold_schema", issue.path + ": " + issue.reason); continue; }
    const missing = envelope.observations.some(o => !o.sourceIds.length || o.missingProvenanceReason) || !!envelope.assessment?.missingProvenanceReason || !envelope.observations.length;
    const p: CompiledPackage = { envelope, payloadSha256: protocolHash(envelope), state: missing || coverage.issues.some(i => i.code.startsWith("reference_")) ? "evidence_hold" : envelope.subject.identityState === "resolved" ? "ready_for_review" : "identity_hold", displayCategory: displayCategory(coverage.originalStatus), originalStatus: coverage.originalStatus, issues: [...coverage.issues], legacyAssessmentProjectionClaims: (original.legacyAssessmentProjectionClaims ?? []) as LegacyAssessmentProjectionClaim[] };
    coverage.packageIds.push(envelope.packageId); packages.push(p);
  }
  const conflicts = new Set(packages.filter((p, index) => packages.findIndex(q => q.envelope.packageId === p.envelope.packageId) !== index).map(p => p.envelope.packageId));
  if (conflicts.size) {
    for (const coverage of candidates) if (coverage.packageIds.some(id => conflicts.has(id))) {
      coverage.packageIds = [];
      const issue = { code: "whole_firm_duplicate_revision_package", path: coverage.sourcePointer, reason: "Multiple declared revisions produce one package ID; preserve all originals and resolve the exact revision identity before delivery." };
      coverage.issues.push(issue); issues.push(issue);
    }
    for (let index = packages.length - 1; index >= 0; index--) if (conflicts.has(packages[index].envelope.packageId)) packages.splice(index, 1);
  }
  if (actions) packages.splice(0, packages.length, ...bindReconciledPackages(packages, actions));
  const shim = { schemaVersion: "prospect-backfill-manifest/v1" as const, snapshotAt: source.snapshotAt, manifestSha256: source.manifestSha256, roots: [], artifacts: [], issues: [] };
  const provisional = buildExpectedRunManifest(shim, packages, candidates, [], runId);
  const content: Omit<ExpectedRunManifest, "manifestSha256"> = { schemaVersion: provisional.schemaVersion, runId, sourceSystem: WHOLE_FIRM_PROFILE.sourceSystem, sourceName: WHOLE_FIRM_PROFILE.sourceName, sourceManifestSha256: source.manifestSha256, generatedAt: source.snapshotAt, expectedPackageCount: provisional.expectedPackageCount, entries: [...provisional.entries].sort((a, b) => ordinal(a.entryId, b.entryId)) };
  const expected = { ...content, manifestSha256: protocolHash(content) };
  if (expected.entries.length !== source.expectedRevisionCount) throw Error("whole_firm_compiled_coverage_mismatch");
  return { packages, candidates, issues, expected };
}
export function wholeFirmRevision(revisionId: string, originalRevision: JsonValue, standardEnvelope: ProspectEnrichmentEnvelope) {
  return { revisionId, originalRevision, standardEnvelope };
}

export function assertWholeFirmManifestCoverage(source: WholeFirmSourceManifest, chunks: ManifestChunk[]): void {
  const prepared = compileWholeFirmSnapshot(source), expected = prepared.expected;
  if (!chunks.length || chunks[0].sourceManifestSha256 !== source.manifestSha256 || chunks[0].runId !== expected.runId || chunks[0].expectedEntryCount !== source.expectedRevisionCount) throw Error("whole_firm_manifest_source_mismatch");
  const fields = (entries: ExpectedRunManifest["entries"]) => entries.map(e => ({ entryId: e.entryId, researchKey: e.researchKey, clientPackageId: e.clientPackageId, itemCount: e.itemCount, clientItems: e.clientItems, source: e.source, errorCodes: e.errorCodes })).sort((a, b) => ordinal(a.entryId, b.entryId));
  if (canonicalJson(fields(chunks.flatMap(c => c.entries))) !== canonicalJson(fields(expected.entries))) throw Error("whole_firm_manifest_revision_coverage_mismatch");
}
