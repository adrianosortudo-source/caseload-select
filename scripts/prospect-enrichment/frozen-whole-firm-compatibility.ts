import type { ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { serializeComparisonRequest } from "./comparison-request";
import { canonicalJson, object, protocolHash, sha256 } from "./model";
import { checkManifestApproval, prepareManifestRequests, type ManifestChunk } from "./manifest-delivery";
import type { DeliveryApproval } from "./outbox";
import { wholeFirmPackageId, wholeFirmRunId } from "./profiles";
import type { ExpectedRunManifest } from "./run-manifest";
import { verifyWholeFirmManifest, type WholeFirmSourceManifest } from "./whole-firm";

/**
 * Exact immutable bindings for the already approved Child 5 run. This is not a
 * reusable legacy mode: any changed source, chunk, hold, package, or approval
 * bytes fail closed. The current compiler remains authoritative for every
 * other whole-firm run.
 */
export const CHILD5_FROZEN_COMPATIBILITY = Object.freeze({
  sourceFileSha256: "ac6b58f1b4b40495fc5aac9a9f0078a566621719f306b8b4f5ed07d46a199f45",
  sourceManifestSha256: "795b2c32ee83051568ee28a76ed7d8feac4a28eaa68029fc689bc313b5a82ddb",
  sourceExportSha256: "104c586b956569daea5b578efd1f46e19e1a6ef48db3be4646970e0d68ef38bd",
  runId: "run-ffa7dfe3a9c2508b9d72f2c9a52857533291f45e47d80544",
  runManifestSha256: "bbd0b09486a933e8c0e68a379529af69bc80b456ed76f742bbdd550756cbae08",
  requestSha256: "6c427e4f21d9ad2768b4cde4a60cdfa7209f5bd688570fad658baba52d23a93c",
  manifestChunksFileSha256: "511beb1bd66fa3dce52bff0bc2ab15f5acc226c23c06efadc20d8d6f7003ea2f",
  heldEvidenceFileSha256: "b2384d0dfa2b2c9b6bf7e2e10af7f5f2d55b8b617121eeaa6afbe272d9188dbc",
  packagesFileSha256: "4621a3018a2df4133ed9439c1c0a89eeb4dfbd70c0eb1e8114b52c83c58f9dc6",
  approvalFileSha256: "f7dd6fa0e73f52fd91382308268f1de01e84fb03f92aa138b4762d8d57d894ea",
  expectedRevisionCount: 50,
  expectedPackageCount: 36,
  expectedHeldCount: 14,
} as const);

export type FrozenWholeFirmCompatibilityContract = {
  sourceFileSha256: string;
  sourceManifestSha256: string;
  sourceExportSha256: string;
  runId: string;
  runManifestSha256: string;
  requestSha256: string;
  manifestChunksFileSha256: string;
  heldEvidenceFileSha256: string;
  packagesFileSha256: string;
  approvalFileSha256: string;
  expectedRevisionCount: number;
  expectedPackageCount: number;
  expectedHeldCount: number;
};

type PackageValue = { envelope: ProspectEnrichmentEnvelope; payloadSha256: string; legacyAssessmentProjectionClaims: unknown[] };
type HeldValue = { entryId: string; researchKey: string; source: { sourcePointer: string }; originalJson: string };

function verifyRawBinding(bytes: Uint8Array, expected: string, code: string): void {
  if (sha256(bytes) !== expected) throw Error(code);
}

function manifestFromChunks(chunks: ManifestChunk[]): ExpectedRunManifest {
  const first = chunks[0];
  if (!first) throw Error("frozen_whole_firm_chunks_missing");
  return {
    schemaVersion: "prospect-enrichment-run-manifest/v1",
    runId: first.runId,
    sourceSystem: first.sourceSystem,
    sourceName: first.sourceName,
    sourceManifestSha256: first.sourceManifestSha256,
    generatedAt: first.generatedAt,
    expectedPackageCount: first.expectedPackageCount,
    entries: chunks.flatMap(chunk => chunk.entries),
    manifestSha256: first.runManifestSha256,
  };
}

/** Verifies a frozen, already-approved whole-firm run without recompiling it. */
export function assertFrozenWholeFirmRunCompatibility(input: {
  contract: FrozenWholeFirmCompatibilityContract;
  sourceFileBytes: Uint8Array;
  source: WholeFirmSourceManifest;
  manifestChunksFileBytes: Uint8Array;
  chunks: unknown;
  heldEvidenceFileBytes: Uint8Array;
  heldEvidence: unknown;
  packagesFileBytes: Uint8Array;
  packages: unknown;
  approvalFileBytes: Uint8Array;
  approvalSha256Argument: string;
}): { requestSha256: string; packages: PackageValue[]; chunks: ManifestChunk[] } {
  const { contract } = input;
  verifyRawBinding(input.sourceFileBytes, contract.sourceFileSha256, "frozen_whole_firm_source_bytes_mismatch");
  verifyRawBinding(input.manifestChunksFileBytes, contract.manifestChunksFileSha256, "frozen_whole_firm_chunks_bytes_mismatch");
  verifyRawBinding(input.heldEvidenceFileBytes, contract.heldEvidenceFileSha256, "frozen_whole_firm_held_evidence_bytes_mismatch");
  verifyRawBinding(input.packagesFileBytes, contract.packagesFileSha256, "frozen_whole_firm_packages_bytes_mismatch");
  verifyRawBinding(input.approvalFileBytes, contract.approvalFileSha256, "frozen_whole_firm_approval_bytes_mismatch");
  if (input.approvalSha256Argument !== contract.approvalFileSha256) throw Error("frozen_whole_firm_approval_argument_mismatch");

  verifyWholeFirmManifest(input.source);
  if (input.source.manifestSha256 !== contract.sourceManifestSha256 || input.source.sourceExportSha256 !== contract.sourceExportSha256 ||
      input.source.expectedRevisionCount !== contract.expectedRevisionCount || input.source.originalExport.expectedRevisions.length !== contract.expectedRevisionCount ||
      input.source.originalExport.revisions.length !== contract.expectedRevisionCount || wholeFirmRunId(input.source.manifestSha256) !== contract.runId) {
    throw Error("frozen_whole_firm_source_binding_mismatch");
  }

  const prepared = prepareManifestRequests(input.chunks, "whole-firm", input.heldEvidence);
  const chunks = prepared.chunks;
  const fullManifest = manifestFromChunks(chunks);
  const rawPackages = input.packages;
  if (!Array.isArray(rawPackages) || !rawPackages.every(value => object(value) && object(value.envelope) && typeof value.payloadSha256 === "string" && Array.isArray(value.legacyAssessmentProjectionClaims))) {
    throw Error("frozen_whole_firm_packages_invalid");
  }
  const packages = rawPackages as PackageValue[];
  const serialized = serializeComparisonRequest(fullManifest, packages, "whole-firm");
  const requestSha256 = protocolHash(serialized.request);
  if (requestSha256 !== contract.requestSha256) throw Error("frozen_whole_firm_request_hash_mismatch");

  const first = chunks[0];
  const entries = chunks.flatMap(chunk => chunk.entries);
  const packageEntries = entries.filter(entry => entry.clientPackageId !== null);
  const heldEntries = entries.filter(entry => entry.clientPackageId === null && entry.researchKey !== null);
  if (!first || first.runId !== contract.runId || first.runManifestSha256 !== contract.runManifestSha256 ||
      first.sourceManifestSha256 !== contract.sourceManifestSha256 || first.expectedEntryCount !== contract.expectedRevisionCount ||
      first.expectedPackageCount !== contract.expectedPackageCount || entries.length !== contract.expectedRevisionCount ||
      packageEntries.length !== contract.expectedPackageCount || heldEntries.length !== contract.expectedHeldCount || packages.length !== contract.expectedPackageCount) {
    throw Error("frozen_whole_firm_inventory_counts_mismatch");
  }
  checkManifestApproval(chunks, JSON.parse(Buffer.from(input.approvalFileBytes).toString("utf8")) as DeliveryApproval, "whole-firm");

  const entryByRevision = new Map<number, (typeof entries)[number]>();
  for (const entry of entries) {
    const match = /^\/originalExport\/revisions\/(\d+)$/.exec(entry.source.sourcePointer);
    if (!match) throw Error("frozen_whole_firm_revision_pointer_invalid");
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= contract.expectedRevisionCount || entryByRevision.has(index)) throw Error("frozen_whole_firm_revision_pointer_duplicate");
    entryByRevision.set(index, entry);
  }
  if (entryByRevision.size !== contract.expectedRevisionCount) throw Error("frozen_whole_firm_revision_pointer_coverage_mismatch");

  const packageById = new Map(packages.map(value => [value.envelope.packageId, value]));
  if (packageById.size !== packages.length) throw Error("frozen_whole_firm_package_duplicate");
  const heldByEntryId = new Map((input.heldEvidence as HeldValue[]).map(value => [value.entryId, value]));
  if (heldByEntryId.size !== heldEntries.length) throw Error("frozen_whole_firm_held_evidence_coverage_mismatch");

  for (const [index, expected] of input.source.originalExport.expectedRevisions.entries()) {
    const entry = entryByRevision.get(index)!;
    const sourceRow = input.source.originalExport.revisions[index];
    if (!object(sourceRow) || sourceRow.revisionId !== expected.revisionId || !Object.hasOwn(sourceRow, "originalRevision") ||
        entry.researchKey !== expected.researchKey || entry.source.relativePath !== "source-manifest.json" || entry.source.sourceRoot !== "whole-firm-coordinator-export") {
      throw Error("frozen_whole_firm_source_revision_mismatch");
    }
    if (entry.clientPackageId !== null) {
      const value = packageById.get(entry.clientPackageId);
      const revision = sourceRow.originalRevision;
      if (!value || value.envelope.subject.researchKey !== expected.researchKey || value.envelope.runId !== contract.runId ||
          value.envelope.packageId !== wholeFirmPackageId(contract.runId, expected.researchKey, revision) ||
          protocolHash(value.envelope.originalResearch.content) !== protocolHash(revision) ||
          entry.expectedPayloadSha256 !== value.payloadSha256 || protocolHash(value.envelope) !== value.payloadSha256) {
        throw Error("frozen_whole_firm_package_source_mismatch");
      }
    } else {
      const held = heldByEntryId.get(entry.entryId);
      if (!held || held.researchKey !== expected.researchKey || held.source.sourcePointer !== entry.source.sourcePointer ||
          canonicalJson(JSON.parse(held.originalJson)) !== canonicalJson(sourceRow)) {
        throw Error("frozen_whole_firm_held_source_mismatch");
      }
    }
  }
  return { requestSha256, packages, chunks };
}

/** A fresh comparison may submit only one exact package it still reports missing. */
export function assertFrozenWholeFirmPackageMissing(snapshot: unknown, packageId: string, payloadSha256: string,
  expectedPackageBindings: { clientPackageId: string; payloadSha256: string }[]): void {
  if (!object(snapshot) || !Array.isArray(snapshot.packages)) throw Error("frozen_whole_firm_comparison_invalid");
  if (new Set(expectedPackageBindings.map(value => value.clientPackageId)).size !== expectedPackageBindings.length) throw Error("frozen_whole_firm_expected_package_duplicate");
  const allowedStates = new Set(["missing", "received", "identity_hold", "evidence_hold", "ready_for_review", "applied", "rejected", "superseded"]);
  const matched = new Map<string, Record<string, unknown>>();
  for (const expected of expectedPackageBindings) {
    const rows = snapshot.packages.filter(value => object(value) && value.clientPackageId === expected.clientPackageId);
    if (rows.length !== 1 || !object(rows[0]) || rows[0].payloadSha256 !== expected.payloadSha256 || !allowedStates.has(String(rows[0].state))) {
      throw Error("frozen_whole_firm_package_comparison_mismatch");
    }
    matched.set(expected.clientPackageId, rows[0]);
  }
  const selected = matched.get(packageId);
  if (!selected || selected.payloadSha256 !== payloadSha256 || selected.state !== "missing" || selected.serverPackageId !== null || selected.visible !== null) {
    throw Error("frozen_whole_firm_package_not_missing");
  }
}
