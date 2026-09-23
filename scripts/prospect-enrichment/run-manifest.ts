import type { CompiledPackage } from "./compiler";
import type { SourceManifest } from "./inventory";
import { SOURCE_NAME, SOURCE_SYSTEM, Issue, ordinal, protocolHash } from "./model";
import { items } from "./reconciliation";
import { profileConfig, type EnrichmentProfile } from "./profiles";

export type ExpectedManifestEntry = {
  entryId: string;
  researchKey: string | null;
  clientPackageId: string | null;
  expectedPayloadSha256: string | null;
  itemCount: number;
  clientItems: { clientItemId: string; itemKind: string; sourceEventKey: string; semanticSha256: string }[];
  initialDisposition: string;
  source: { sourceRoot: string | null; relativePath: string; sourcePointer: string; fileSha256: string | null };
  errorCodes: string[];
};
export type CandidateCoverage = { researchKey: string; sourceRoot: string; relativePath: string; sourcePointer: string; sourceSha256: string; packageIds: string[]; issues: Issue[] };
export type ExpectedRunManifest = {
  schemaVersion: "prospect-enrichment-run-manifest/v1";
  runId: string;
  sourceSystem: string;
  sourceName: string;
  sourceManifestSha256: string;
  generatedAt: string;
  expectedPackageCount: number;
  entries: ExpectedManifestEntry[];
  manifestSha256: string;
};

export function buildExpectedRunManifest(source: SourceManifest, packages: CompiledPackage[], candidates: CandidateCoverage[], issues: Issue[]): ExpectedRunManifest {
  const entries: ExpectedManifestEntry[] = [];
  for (const p of packages) {
    const origin = candidates.find(c => c.packageIds.includes(p.envelope.packageId));
    if (!origin) throw new Error("package_without_inventory_origin");
    const clientItems = items(p.envelope).map(i => ({ clientItemId: i.id, itemKind: i.kind, sourceEventKey: i.sourceEventKey, semanticSha256: i.semanticSha256 }));
    entries.push({
      entryId: "entry-" + protocolHash([source.manifestSha256, p.envelope.packageId]),
      researchKey: p.envelope.subject.researchKey,
      clientPackageId: p.envelope.packageId,
      expectedPayloadSha256: p.payloadSha256,
      itemCount: clientItems.length,
      clientItems,
      initialDisposition: p.state,
      source: { sourceRoot: origin.sourceRoot, relativePath: origin.relativePath, sourcePointer: origin.sourcePointer, fileSha256: origin.sourceSha256 },
      errorCodes: [...new Set(p.issues.map(i => i.code))].sort(ordinal),
    });
  }
  for (const c of candidates.filter(c => c.packageIds.length === 0)) entries.push({
    entryId: "entry-" + protocolHash([source.manifestSha256, c.sourceRoot, c.relativePath, c.sourcePointer, "no-envelope"]),
    researchKey: c.researchKey,
    clientPackageId: null,
    expectedPayloadSha256: null,
    itemCount: 0,
    clientItems: [],
    initialDisposition: "hold_schema",
    source: { sourceRoot: c.sourceRoot, relativePath: c.relativePath, sourcePointer: c.sourcePointer, fileSha256: c.sourceSha256 },
    errorCodes: [...new Set(c.issues.map(i => i.code))].sort(ordinal),
  });
  for (const issue of issues) {
    // File/line-level exceptions are expected inventory, not absent prospects.
    if (!["source_root_unavailable", "source_read_failed", "source_changed_during_snapshot", "reference_out_of_scope", "reference_provenance_only", "provenance_only", "hold_schema"].includes(issue.code)) continue;
    const artifact = source.artifacts.find(a => issue.path === a.relativePath || issue.path.startsWith(a.relativePath + ":"));
    if (issue.code === "hold_schema" && !artifact) continue; // Candidate-specific errors already belong to their candidate entry.
    entries.push({
      entryId: "entry-" + protocolHash([source.manifestSha256, "source-issue", issue]),
      researchKey: null,
      clientPackageId: null,
      expectedPayloadSha256: null,
      itemCount: 0,
      clientItems: [],
      initialDisposition: issue.code,
      source: { sourceRoot: artifact?.sourceRoot ?? null, relativePath: artifact?.relativePath ?? issue.path, sourcePointer: artifact ? issue.path.slice(artifact.relativePath.length).replace(/^:/, "") : "", fileSha256: artifact?.fileSha256 ?? null },
      errorCodes: [issue.code],
    });
  }
  const unique = [...new Map(entries.map(e => [e.entryId, e])).values()].sort((a, b) => ordinal(a.entryId, b.entryId));
  const manifest = { schemaVersion: "prospect-enrichment-run-manifest/v1" as const, runId: "backfill-" + source.manifestSha256.slice(0, 48), sourceSystem: SOURCE_SYSTEM, sourceName: SOURCE_NAME, sourceManifestSha256: source.manifestSha256, generatedAt: source.snapshotAt, expectedPackageCount: new Set(packages.map(p => p.envelope.packageId)).size, entries: unique };
  return { ...manifest, manifestSha256: protocolHash(manifest) };
}

/** Offline chunk export only; registration remains root-owned and authorization-bound. */
export function chunkExpectedRunManifest(manifest: ExpectedRunManifest, maxEntries = 100, maxBytes = 1_048_576, profile: EnrichmentProfile = "legacy-backfill") {
  const { manifestSha256, ...content } = manifest;
  if (protocolHash(content) !== manifestSha256) throw new Error("expected_manifest_hash_mismatch");
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) throw new Error("invalid_chunk_limit");
  const chunks: ExpectedManifestEntry[][] = [];
  let pending: ExpectedManifestEntry[] = [];
  for (const entry of manifest.entries) {
    if (Buffer.byteLength(JSON.stringify(entry)) > maxBytes) throw new Error("manifest_entry_too_large");
    if (pending.length && (pending.length >= maxEntries || Buffer.byteLength(JSON.stringify([...pending, entry])) > maxBytes)) { chunks.push(pending); pending = []; }
    pending.push(entry);
  }
  if (pending.length || !chunks.length) chunks.push(pending);
  return chunks.map((entries, index) => ({ schemaVersion: "prospect-enrichment-run-manifest-chunk/v1", adapterVersion: profileConfig(profile).adapterVersion, runId: manifest.runId, sourceSystem: manifest.sourceSystem, sourceName: manifest.sourceName, sourceManifestSha256: manifest.sourceManifestSha256, runManifestSha256: manifest.manifestSha256, generatedAt: manifest.generatedAt, expectedPackageCount: manifest.expectedPackageCount, expectedEntryCount: manifest.entries.length, chunkIndex: index, chunkCount: chunks.length, chunkSha256: protocolHash(entries), entries }));
}
