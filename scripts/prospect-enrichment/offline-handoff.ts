import fs from "node:fs/promises";
import path from "node:path";
import { prospectEnrichmentIdempotencyKey } from "../../src/lib/prospect-enrichment-hash";
import type { ManifestChunk } from "./manifest-delivery";
import { buildHeldCandidateEvidence, chunkExpectedRunManifest } from "./run-manifest";
import { assertWholeFirmManifestCoverage, compileWholeFirmSnapshot, verifyWholeFirmManifest, type WholeFirmSourceManifest } from "./whole-firm";
import { assertCoordinatorOutputPath, assertCoordinatorOutputRoot, assertCoordinatorStateFile, snapshotCoordinatorState } from "./whole-firm-coordinator-export";
import { canonicalJson, object, ordinal, protocolHash, sha256, within } from "./model";

type InventoryCheckpoint = {
  schemaVersion: "prospect-whole-firm-coordinator-inventory/v1";
  sourcePath: string;
  sourceSha256: string;
  stateArchive: string;
  snapshotAt: string;
  candidateCount: number;
  revisionCount: number;
  references: unknown[];
  exportSha256: string;
  sourceManifestSha256: string;
  inventorySha256: string;
};
type Artifact = { bytes: Buffer; sha256: string };
type OfflineCheckpoint = {
  schemaVersion: "prospect-whole-firm-offline-handoff-checkpoint/v1";
  state: "preparing" | "prepared-pending-admin";
  sourcePath: string;
  sourceSha256: string;
  sourceManifestSha256: string;
  sourceManifestPath: string;
  runId: string;
  handoffDir: string;
  expectedRevisionCount: number;
  accountedRevisionCount: number;
  packageCount: number;
  heldCount: number;
  timestampTechnicalHoldCount: number;
  files: { path: string; sha256: string; bytes: number }[];
  checkpointSha256: string;
};
const PROGRESS_FILE = "progress.jsonl";
const FINAL_CHECKPOINT_TEMP = ".checkpoint.json.tmp";
type SnapshotAnchor = { snapshotAt: string; sourceManifestSha256: string; source: WholeFirmSourceManifest; runDir: string; candidateCount: number; revisionCount: number };
type SnapshotSearch = { anchor?: SnapshotAnchor; hold?: string };
type ValidatedInventoryCheckpoint = { checkpoint: InventoryCheckpoint; source: WholeFirmSourceManifest; runDir: string };
export type OfflineHandoffResult = {
  command: "handoff";
  mode: "dry-run" | "execute-offline";
  state: "technical-hold" | "dry-run" | "prepared-pending-admin";
  technicalHold?: string;
  snapshotCreated?: boolean;
  snapshotReused?: boolean;
  snapshotAtReused?: boolean;
  snapshotAt?: string;
  sourcePath: string;
  sourceSha256: string;
  sourceManifestPath?: string;
  sourceManifestSha256?: string;
  expectedRevisionCount?: number;
  accountedRevisionCount?: number;
  candidateCount?: number;
  revisionCount?: number;
  wouldPrepareCount?: number;
  heldCount?: number;
  timestampTechnicalHoldCount?: number;
  preparedCount?: number;
  alreadyPreparedCount?: number;
  handoffDir?: string;
  checkpointPath?: string;
  networkRequests: number;
  submitted: number;
  applied: number;
  visibleVerified: number;
};
const hashText = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isoTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, "utf8"));
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
async function optionalFile(file: string): Promise<Buffer | null> { try { return await fs.readFile(file); } catch (error) { if (isMissing(error)) return null; throw error; } }
function safeRelative(root: string, file: string): string | null {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? null : relative;
}
function stateArchivePath(root: string, digest: string): string { return path.join(root, "coordinator-artifacts", "sha256", digest.slice(0, 2), digest + ".bin"); }
function contentArchivePath(root: string, digest: string): string { return path.join(root, "coordinator-artifacts", "sha256", digest.slice(0, 2), digest + ".bin"); }

async function validateInventoryCheckpoint(options: { file: string; root: string; statePath: string; stateBytes: Buffer; stateSha256: string }): Promise<ValidatedInventoryCheckpoint | null> {
  try {
    await assertCoordinatorOutputPath(options.root, options.file, "file");
    const bytes = await fs.readFile(options.file), raw = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!object(raw) || raw.schemaVersion !== "prospect-whole-firm-coordinator-inventory/v1") return null;
    const record = raw as unknown as InventoryCheckpoint;
    if (record.sourcePath !== options.statePath || record.sourceSha256 !== options.stateSha256) return null;
    if (!isoTime(record.snapshotAt) || !hashText(record.exportSha256) || !hashText(record.sourceManifestSha256) ||
        !Array.isArray(record.references) || !hashText(record.inventorySha256) ||
        record.inventorySha256 !== protocolHash({ sourceSha256: record.sourceSha256, references: record.references })) return null;
    const runDir = path.dirname(options.file), expectedRunDir = path.join(options.root, "runs", record.sourceManifestSha256);
    if (path.resolve(runDir) !== path.resolve(expectedRunDir)) return null;
    const stateArchive = stateArchivePath(options.root, record.sourceSha256);
    if (path.resolve(record.stateArchive) !== path.resolve(stateArchive)) return null;
    await assertCoordinatorOutputPath(options.root, stateArchive, "file");
    const archivedState = await fs.readFile(stateArchive);
    if (sha256(archivedState) !== record.sourceSha256 || !archivedState.equals(options.stateBytes)) return null;
    const exportFile = path.join(options.root, "exports", record.exportSha256 + ".json");
    await assertCoordinatorOutputPath(options.root, exportFile, "file");
    const exportBytes = await fs.readFile(exportFile);
    if (sha256(exportBytes) !== record.exportSha256) return null;
    const exported = JSON.parse(exportBytes.toString("utf8")) as unknown;
    if (!object(exported) || canonicalJson(exported) + "\n" !== exportBytes.toString("utf8")) return null;
    const sourceFile = path.join(runDir, "source-manifest.json");
    await assertCoordinatorOutputPath(options.root, sourceFile, "file");
    const source = await readJson<WholeFirmSourceManifest>(sourceFile);
    verifyWholeFirmManifest(source);
    if (source.manifestSha256 !== record.sourceManifestSha256 || source.sourceExportSha256 !== record.exportSha256 || source.snapshotAt !== record.snapshotAt || canonicalJson(source.originalExport) !== canonicalJson(exported)) return null;
    if (JSON.stringify(source, null, 2) + "\n" !== (await fs.readFile(sourceFile, "utf8"))) return null;
    const provenance = (source.originalExport.sourceInventory as { provenance?: unknown } | undefined)?.provenance;
    if (!object(provenance) || provenance.sourcePath !== options.statePath || provenance.sourceSha256 !== options.stateSha256 || canonicalJson(provenance.references) !== canonicalJson(record.references)) return null;
    if (!object(source.originalExport.sourceInventory) || canonicalJson((source.originalExport.sourceInventory as { state?: unknown }).state) !== canonicalJson(JSON.parse(options.stateBytes.toString("utf8").replace(/^\uFEFF/, "")))) return null;
    for (const ref of record.references) {
      if (!object(ref) || typeof ref.archivePath !== "string" || !hashText(ref.sourceSha256)) continue;
      if (path.resolve(ref.archivePath) !== path.resolve(contentArchivePath(options.root, ref.sourceSha256))) return null;
      await assertCoordinatorOutputPath(options.root, ref.archivePath, "file");
      const archived = await fs.readFile(ref.archivePath);
      if (sha256(archived) !== ref.sourceSha256) return null;
    }
    const inventoryValue = JSON.parse(bytes.toString("utf8")) as unknown;
    if (canonicalJson(inventoryValue) + "\n" !== bytes.toString("utf8")) return null;
    return { checkpoint: record, source, runDir };
  } catch { return null; }
}

async function findSnapshotAnchor(statePath: string, stateBytes: Buffer, outputRoot: string): Promise<SnapshotSearch> {
  const sourceSha256 = sha256(stateBytes), matching: ValidatedInventoryCheckpoint[] = [], malformedMatches: string[] = [];
  const runs = path.join(outputRoot, "runs");
  await assertCoordinatorOutputPath(outputRoot, runs, "directory");
  let dirs: string[] = [];
  try { dirs = (await fs.readdir(runs, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => path.join(runs, d.name)); }
  catch (error) { if (!isMissing(error)) return { hold: "snapshot_checkpoint_scan_failed" }; }
  for (const runDir of dirs) {
    const file = path.join(runDir, "coordinator-inventory.json");
    await assertCoordinatorOutputPath(outputRoot, file, "file");
    const bytes = await optionalFile(file);
    if (!bytes) continue;
    let record: unknown;
    try { record = JSON.parse(bytes.toString("utf8")); }
    catch {
      const text = bytes.toString("utf8");
      if (text.includes(statePath) || text.includes(sourceSha256)) malformedMatches.push(file);
      continue;
    }
    if (!object(record)) continue;
    const samePath = record.sourcePath === statePath, sameBytes = record.sourceSha256 === sourceSha256;
    if (!samePath || !sameBytes) continue;
    const valid = await validateInventoryCheckpoint({ file, root: outputRoot, statePath, stateBytes, stateSha256: sourceSha256 });
    if (!valid) malformedMatches.push(file); else matching.push(valid);
  }
  if (malformedMatches.length) return { hold: "snapshot_checkpoint_corrupt_or_incomplete" };
  const lineages = [...new Set(matching.map(item => `${item.checkpoint.sourceManifestSha256}:${item.checkpoint.snapshotAt}`))];
  if (lineages.length > 1) return { hold: "snapshot_checkpoint_ambiguous" };
  if (matching.length) {
    const selected = matching.sort((a, b) => ordinal(a.checkpoint.sourceManifestSha256, b.checkpoint.sourceManifestSha256))[0];
    return { anchor: { snapshotAt: selected.checkpoint.snapshotAt, sourceManifestSha256: selected.checkpoint.sourceManifestSha256,
      source: selected.source, runDir: selected.runDir, candidateCount: selected.checkpoint.candidateCount, revisionCount: selected.checkpoint.revisionCount } };
  }
  // A content-addressed state blob alone is not a checkpoint. Reuse only a complete, validated
  // inventory checkpoint so an orphan archive can never imply evidence that was not read back.
  const orphanPath = stateArchivePath(outputRoot, sourceSha256);
  await assertCoordinatorOutputPath(outputRoot, orphanPath, "file");
  const orphanArchive = await optionalFile(orphanPath);
  if (orphanArchive && !orphanArchive.equals(stateBytes)) return { hold: "snapshot_archive_hash_mismatch" };
  return {};
}

function jsonBytes(value: unknown): Buffer { return Buffer.from(JSON.stringify(value, null, 2) + "\n"); }
function jsonlBytes(values: unknown[]): Buffer { return Buffer.from(values.map(v => JSON.stringify(v)).join("\n") + (values.length ? "\n" : "")); }
function compileArtifacts(source: WholeFirmSourceManifest, handoffDir: string) {
  const result = compileWholeFirmSnapshot(source), held = buildHeldCandidateEvidence(result.expected, result.candidates);
  const chunks = chunkExpectedRunManifest(result.expected, 100, 1_048_576, "whole-firm") as ManifestChunk[];
  assertWholeFirmManifestCoverage(source, chunks);
  if (result.expected.entries.length !== source.expectedRevisionCount) throw Error("whole_firm_handoff_coverage_mismatch");
  const nonPackageHolds = result.expected.entries.filter(e => e.clientPackageId === null).length;
  const timestampTechnicalHolds = result.expected.entries.filter(e => e.errorCodes.some(code => code === "result_completed_at_not_recorded" || code === "result_completed_at_invalid")).length;
  const coverage = { profile: "whole-firm", state: "prepared-pending-admin", runId: result.expected.runId,
    sourceManifestSha256: source.manifestSha256, runManifestSha256: result.expected.manifestSha256,
    expectedRevisionCount: source.expectedRevisionCount, accountedRevisionCount: result.expected.entries.length,
    packages: result.packages.length, nonPackageHolds, timestampTechnicalHolds,
    networkRequests: 0, submitted: 0, applied: 0, visibleVerified: 0 };
  const files = new Map<string, Buffer>();
  const add = (name: string, bytes: Buffer) => files.set(name, bytes);
  add("expected-run-manifest.json", jsonBytes(result.expected));
  add("expected-run-manifest-chunks.jsonl", jsonlBytes(chunks));
  add("candidate-index.jsonl", jsonlBytes(result.candidates));
  add("held-candidate-evidence.jsonl", jsonlBytes(held));
  add("normalized-packages.jsonl", jsonlBytes(result.packages));
  add("comparison-packages.json", jsonBytes(result.packages.map(p => ({ envelope: p.envelope, payloadSha256: p.payloadSha256, legacyAssessmentProjectionClaims: p.legacyAssessmentProjectionClaims ?? [] }))));
  for (const p of result.packages) add(path.join("packages", p.envelope.packageId + ".json"), jsonBytes(p.envelope));
  add("delivery-index.jsonl", jsonlBytes(result.packages.map(p => ({ clientPackageId: p.envelope.packageId, payloadSha256: p.payloadSha256,
    key: prospectEnrichmentIdempotencyKey(p.envelope.sourceSystem, p.envelope.runId, p.envelope.packageId), packageFile: path.join(handoffDir, "packages", p.envelope.packageId + ".json") }))));
  add("validation-errors.jsonl", jsonlBytes(result.issues));
  add("coverage-report.json", jsonBytes(coverage));
  const artifacts = new Map<string, Artifact>();
  for (const [file, bytes] of files) artifacts.set(file, { bytes, sha256: sha256(bytes) });
  return { result, coverage, artifacts, nonPackageHolds, timestampTechnicalHolds };
}
async function listArtifactFiles(root: string): Promise<string[] | null> {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
  const files: string[] = [];
  const walk = async (dir: string): Promise<boolean> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(dir, entry.name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) return false;
      if (["checkpoint.json", PROGRESS_FILE, FINAL_CHECKPOINT_TEMP].includes(entry.name) && path.resolve(dir) === path.resolve(root)) {
        if (!stat.isFile()) return false;
        continue;
      }
      if (stat.isDirectory()) { if (!(await walk(file))) return false; }
      else if (stat.isFile()) files.push(path.relative(root, file));
      else return false;
    }
    return true;
  };
  if (!(await walk(root))) return null;
  return files.sort(ordinal);
}

async function validateHandoffCheckpoint(outputRoot: string, dir: string, source: WholeFirmSourceManifest, statePath: string, stateSha256: string,
  prepared: ReturnType<typeof compileArtifacts>): Promise<{ checkpoint: OfflineCheckpoint | null; hold?: string }> {
  try {
    await assertCoordinatorOutputPath(outputRoot, dir, "directory");
    const rootStat = await fs.lstat(dir);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return { checkpoint: null, hold: "offline_handoff_path_invalid" };
    const file = path.join(dir, "checkpoint.json");
    await assertCoordinatorOutputPath(outputRoot, file, "file");
    const fileStat = await fs.lstat(file);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return { checkpoint: null, hold: "offline_handoff_checkpoint_path_invalid" };
    const checkpointBytes = await fs.readFile(file), raw = JSON.parse(checkpointBytes.toString("utf8")) as unknown;
    if (!object(raw) || raw.schemaVersion !== "prospect-whole-firm-offline-handoff-checkpoint/v1" || raw.state !== "prepared-pending-admin") return { checkpoint: null, hold: "offline_handoff_checkpoint_invalid" };
    const checkpoint = raw as unknown as OfflineCheckpoint, { checkpointSha256, ...unsigned } = checkpoint;
    if (!hashText(checkpointSha256) || checkpointSha256 !== protocolHash(unsigned) || checkpoint.sourcePath !== statePath ||
        checkpoint.sourceSha256 !== stateSha256 || checkpoint.sourceManifestSha256 !== source.manifestSha256 ||
        checkpoint.sourceManifestPath !== path.join(path.dirname(dir), "source-manifest.json") || checkpoint.handoffDir !== dir ||
        checkpoint.runId !== compileWholeFirmSnapshot(source).expected.runId || !Array.isArray(checkpoint.files)) return { checkpoint: null, hold: "offline_handoff_checkpoint_binding_mismatch" };
    const counters = [checkpoint.packageCount, checkpoint.heldCount, checkpoint.timestampTechnicalHoldCount, checkpoint.expectedRevisionCount, checkpoint.accountedRevisionCount];
    if (!counters.every(value => Number.isSafeInteger(value) && value >= 0) ||
        checkpoint.packageCount !== prepared.coverage.packages || checkpoint.heldCount !== prepared.coverage.nonPackageHolds ||
        checkpoint.timestampTechnicalHoldCount !== prepared.coverage.timestampTechnicalHolds ||
        checkpoint.expectedRevisionCount !== prepared.coverage.expectedRevisionCount || checkpoint.accountedRevisionCount !== prepared.coverage.accountedRevisionCount)
      return { checkpoint: null, hold: "offline_handoff_checkpoint_coverage_mismatch" };
    const progressPath = path.join(dir, PROGRESS_FILE);
    let progressStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    try { progressStat = await fs.lstat(progressPath); } catch (error) { if (!isMissing(error)) return { checkpoint: null, hold: "offline_handoff_progress_corrupt" }; }
    if (progressStat) {
      if (!progressStat.isFile() || progressStat.isSymbolicLink()) return { checkpoint: null, hold: "offline_handoff_progress_path_invalid" };
      const progress = await readProgress(progressPath, outputRoot, source, statePath, stateSha256,
        checkpoint.sourceManifestPath, dir, prepared);
      if (progress.hold) return { checkpoint: null, hold: progress.hold };
      if (progress.tornTailBytes > 0) return { checkpoint: null, hold: "offline_handoff_progress_unterminated_tail" };
      const terminal = progress.records[progress.records.length - 1];
      if (!terminal) return { checkpoint: null, hold: "offline_handoff_progress_empty" };
      if (terminal.state !== "prepared-pending-admin" || canonicalJson(terminal) !== canonicalJson(checkpoint))
        return { checkpoint: null, hold: "offline_handoff_progress_checkpoint_mismatch" };
    }
    const actualFiles = await listArtifactFiles(dir);
    if (!actualFiles) return { checkpoint: null, hold: "offline_handoff_artifact_tree_invalid" };
    const tempBytes = await optionalFile(path.join(dir, FINAL_CHECKPOINT_TEMP));
    if (tempBytes && !tempBytes.equals(Buffer.from(canonicalJson(checkpoint) + "\n"))) return { checkpoint: null, hold: "offline_handoff_checkpoint_temp_conflicts_with_final" };
    const listed = checkpoint.files.map(v => v.path).sort(ordinal), computed = [...prepared.artifacts.keys()].sort(ordinal);
    if (canonicalJson(listed) !== canonicalJson(actualFiles) || canonicalJson(listed) !== canonicalJson(computed)) return { checkpoint: null, hold: "offline_handoff_artifact_set_mismatch" };
    for (const entry of checkpoint.files) {
      if (safeRelative(dir, path.resolve(dir, entry.path)) === null || entry.path !== path.relative(dir, path.resolve(dir, entry.path)) || !hashText(entry.sha256)) return { checkpoint: null, hold: "offline_handoff_artifact_path_invalid" };
      const bytes = await fs.readFile(path.join(dir, entry.path)), expected = prepared.artifacts.get(entry.path);
      if (!expected || bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256 || !bytes.equals(expected.bytes)) return { checkpoint: null, hold: "offline_handoff_artifact_hash_mismatch" };
    }
    return { checkpoint };
  } catch (error) {
    return { checkpoint: null, hold: isMissing(error) ? "offline_handoff_checkpoint_missing" : "offline_handoff_checkpoint_corrupt" };
  }
}

function makeCheckpoint(source: WholeFirmSourceManifest, statePath: string, stateSha256: string, sourceManifestPath: string,
  handoffDir: string, prepared: ReturnType<typeof compileArtifacts>, state: OfflineCheckpoint["state"], files: OfflineCheckpoint["files"]): OfflineCheckpoint {
  const unsigned = { schemaVersion: "prospect-whole-firm-offline-handoff-checkpoint/v1" as const, state,
    sourcePath: statePath, sourceSha256: stateSha256, sourceManifestSha256: source.manifestSha256, sourceManifestPath,
    runId: prepared.result.expected.runId, handoffDir, expectedRevisionCount: source.expectedRevisionCount,
    accountedRevisionCount: prepared.coverage.accountedRevisionCount, packageCount: prepared.result.packages.length,
    heldCount: prepared.nonPackageHolds, timestampTechnicalHoldCount: prepared.timestampTechnicalHolds, files };
  return { ...unsigned, checkpointSha256: protocolHash(unsigned) };
}

function validateProgressRecord(value: unknown, source: WholeFirmSourceManifest, statePath: string, stateSha256: string,
  sourceManifestPath: string, handoffDir: string, prepared: ReturnType<typeof compileArtifacts>): OfflineCheckpoint | null {
  if (!object(value) || value.schemaVersion !== "prospect-whole-firm-offline-handoff-checkpoint/v1" ||
      (value.state !== "preparing" && value.state !== "prepared-pending-admin")) return null;
  const checkpoint = value as unknown as OfflineCheckpoint, { checkpointSha256, ...unsigned } = checkpoint;
  if (!hashText(checkpointSha256) || checkpointSha256 !== protocolHash(unsigned) || checkpoint.sourcePath !== statePath ||
      checkpoint.sourceSha256 !== stateSha256 || checkpoint.sourceManifestSha256 !== source.manifestSha256 ||
      checkpoint.sourceManifestPath !== sourceManifestPath || checkpoint.handoffDir !== handoffDir ||
      checkpoint.runId !== prepared.result.expected.runId || !Array.isArray(checkpoint.files)) return null;
  if (checkpoint.expectedRevisionCount !== source.expectedRevisionCount || checkpoint.accountedRevisionCount !== prepared.coverage.accountedRevisionCount ||
      checkpoint.packageCount !== prepared.result.packages.length || checkpoint.heldCount !== prepared.nonPackageHolds ||
      checkpoint.timestampTechnicalHoldCount !== prepared.timestampTechnicalHolds) return null;
  const expected = [...prepared.artifacts.entries()].sort(([a], [b]) => ordinal(a, b));
  if (checkpoint.files.length > expected.length || (checkpoint.state === "prepared-pending-admin" && checkpoint.files.length !== expected.length)) return null;
  for (let i = 0; i < checkpoint.files.length; i++) {
    const record = checkpoint.files[i], [expectedPath, expectedArtifact] = expected[i];
    if (record.path !== expectedPath || record.sha256 !== expectedArtifact.sha256 || record.bytes !== expectedArtifact.bytes.length) return null;
  }
  return checkpoint;
}

async function appendProgress(file: string, checkpoint: OfflineCheckpoint, outputRoot: string): Promise<void> {
  await assertCoordinatorOutputPath(outputRoot, file, "file");
  const handle = await fs.open(file, "a");
  try { await handle.writeFile(canonicalJson(checkpoint) + "\n", "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await assertCoordinatorOutputPath(outputRoot, file, "file");
}

async function readProgress(file: string, outputRoot: string, source: WholeFirmSourceManifest, statePath: string, stateSha256: string,
  sourceManifestPath: string, handoffDir: string, prepared: ReturnType<typeof compileArtifacts>): Promise<{ records: OfflineCheckpoint[]; tornTailBytes: number; validBytes: number; hold?: string }> {
  try {
    await assertCoordinatorOutputPath(outputRoot, file, "file");
    const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return { records: [], tornTailBytes: 0, validBytes: 0, hold: "offline_handoff_progress_path_invalid" };
    const bytes = await fs.readFile(file), text = bytes.toString("utf8"), lastNewline = text.lastIndexOf("\n");
    const completeText = lastNewline < 0 ? "" : text.slice(0, lastNewline);
    const validBytes = Buffer.byteLength(completeText + (lastNewline >= 0 ? "\n" : ""), "utf8"), tornTailBytes = bytes.length - validBytes;
    const lines = completeText ? completeText.split("\n") : [], records: OfflineCheckpoint[] = [];
    const expected = [...prepared.artifacts.entries()].sort(([a], [b]) => ordinal(a, b));
    for (const line of lines) {
      if (!line) return { records: [], tornTailBytes: 0, validBytes: 0, hold: "offline_handoff_progress_record_invalid" };
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { return { records: [], tornTailBytes: 0, validBytes: 0, hold: "offline_handoff_progress_record_invalid" }; }
      if (canonicalJson(raw) !== line) return { records: [], tornTailBytes: 0, validBytes: 0, hold: "offline_handoff_progress_record_invalid" };
      const record = validateProgressRecord(raw, source, statePath, stateSha256, sourceManifestPath, handoffDir, prepared);
      if (!record) return { records: [], tornTailBytes: 0, validBytes: 0, hold: "offline_handoff_progress_binding_mismatch" };
      if (records.length === 0) {
        if (record.files.length !== 0 || record.state !== "preparing") return { records: [], tornTailBytes: 0, validBytes: 0, hold: "offline_handoff_progress_order_invalid" };
      } else {
        const previous = records[records.length - 1];
        const nextArtifact = record.state === "preparing" && record.files.length === previous.files.length + 1;
        const finalize = record.state === "prepared-pending-admin" && previous.files.length === expected.length && record.files.length === expected.length;
        if (previous.state !== "preparing" || (!nextArtifact && !finalize))
          return { records: [], tornTailBytes: 0, validBytes: 0, hold: "offline_handoff_progress_order_invalid" };
      }
      records.push(record);
    }
    return { records, tornTailBytes, validBytes };
  } catch (error) {
    return { records: [], tornTailBytes: 0, validBytes: 0, hold: isMissing(error) ? "offline_handoff_progress_missing" : "offline_handoff_progress_corrupt" };
  }
}

async function atomicWriteFinalCheckpoint(outputRoot: string, dir: string, checkpoint: OfflineCheckpoint): Promise<void> {
  const file = path.join(dir, "checkpoint.json"), temp = path.join(dir, FINAL_CHECKPOINT_TEMP), bytes = Buffer.from(canonicalJson(checkpoint) + "\n");
  await assertCoordinatorOutputRoot(outputRoot);
  await assertCoordinatorOutputPath(outputRoot, file, "file");
  await assertCoordinatorOutputPath(outputRoot, temp, "file");
  const finalExists = async () => fs.lstat(file).then(() => true, error => isMissing(error) ? false : Promise.reject(error));
  const promoteWithoutReplace = async () => {
    try { await fs.link(temp, file); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST") throw Error("offline_handoff_checkpoint_final_conflict");
      if (["EPERM", "EOPNOTSUPP", "ENOTSUP"].includes(String(code))) throw Error("offline_handoff_checkpoint_atomic_promotion_unavailable");
      throw error;
    }
  };
  const tempExists = await fs.lstat(temp).then(() => true, error => isMissing(error) ? false : Promise.reject(error));
  if (tempExists) {
    const tempStat = await fs.lstat(temp);
    if (!tempStat.isFile() || tempStat.isSymbolicLink()) throw Error("offline_handoff_checkpoint_temp_invalid");
    const saved = await fs.readFile(temp);
    if (!saved.equals(bytes)) throw Error("offline_handoff_checkpoint_temp_mismatch");
    if (await finalExists()) throw Error("offline_handoff_checkpoint_final_conflict");
    await promoteWithoutReplace();
    const promoted = await fs.readFile(file);
    if (!promoted.equals(bytes)) throw Error("offline_handoff_checkpoint_promotion_mismatch");
    const stillSaved = await fs.readFile(temp);
    if (!stillSaved.equals(bytes)) throw Error("offline_handoff_checkpoint_temp_changed");
    await fs.unlink(temp);
    return;
  }
  if (await finalExists()) throw Error("offline_handoff_checkpoint_final_conflict");
  const handle = await fs.open(temp, "wx");
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await assertCoordinatorOutputPath(outputRoot, temp, "file");
  if (!(await fs.readFile(temp)).equals(bytes)) throw Error("offline_handoff_checkpoint_temp_mismatch");
  if (await finalExists()) throw Error("offline_handoff_checkpoint_final_conflict");
  await promoteWithoutReplace();
  const promoted = await fs.readFile(file);
  if (!promoted.equals(bytes)) throw Error("offline_handoff_checkpoint_promotion_mismatch");
  await fs.unlink(temp);
  await assertCoordinatorOutputPath(outputRoot, file, "file");
}

export async function runWholeFirmOfflineHandoff(options: { statePath: string; outputRoot: string; executeOffline?: boolean; now?: () => Date;
  afterArtifactCheckpoint?: (index: number, relativePath: string) => void | Promise<void>;
  afterFinalProgress?: () => void | Promise<void> }): Promise<OfflineHandoffResult> {
  const statePath = path.resolve(options.statePath), outputRoot = path.resolve(options.outputRoot), executeOffline = options.executeOffline === true;
  await assertCoordinatorOutputRoot(outputRoot);
  const stateRealPath = await assertCoordinatorStateFile(statePath);
  const stateBytes = await fs.readFile(stateRealPath), stateSha256 = sha256(stateBytes), search = await findSnapshotAnchor(statePath, stateBytes, outputRoot);
  const emptyCounters = { networkRequests: 0, submitted: 0, applied: 0, visibleVerified: 0 };
  if (search.hold) return { command: "handoff", mode: executeOffline ? "execute-offline" : "dry-run", state: "technical-hold", technicalHold: search.hold, sourcePath: statePath, sourceSha256: stateSha256, ...emptyCounters };
  const priorSnapshot = !!search.anchor, snapshotAt = search.anchor?.snapshotAt ?? (options.now ?? (() => new Date()))().toISOString();
  let source: WholeFirmSourceManifest, runDir: string, candidateCount: number;
  if (search.anchor) {
    let latestStateRealPath: string;
    try { latestStateRealPath = await assertCoordinatorStateFile(statePath); } catch { latestStateRealPath = ""; }
    if (!latestStateRealPath || path.relative(stateRealPath, latestStateRealPath) !== "" || !(await fs.readFile(latestStateRealPath)).equals(stateBytes))
      return { command: "handoff", mode: executeOffline ? "execute-offline" : "dry-run", state: "technical-hold", technicalHold: "coordinator_state_changed_before_reuse", sourcePath: statePath, sourceSha256: stateSha256, snapshotAt, snapshotAtReused: true, ...emptyCounters };
    // The validated checkpoint contains the exact archived state and reference hashes used to
    // produce this immutable source manifest. Reuse it directly; never reread live references.
    source = search.anchor.source;
    runDir = search.anchor.runDir;
    candidateCount = search.anchor.candidateCount;
  } else {
    let snapshot: Awaited<ReturnType<typeof snapshotCoordinatorState>>;
    try {
      snapshot = await snapshotCoordinatorState({ statePath, outputRoot, snapshotAt, beforeRecheck: async file => {
        if (path.resolve(file) === path.resolve(stateRealPath) && !(await fs.readFile(file)).equals(stateBytes)) throw Error("source_changed_during_snapshot");
      } });
    } catch (error) {
      if (error instanceof Error && error.message === "source_changed_during_snapshot")
        return { command: "handoff", mode: executeOffline ? "execute-offline" : "dry-run", state: "technical-hold", technicalHold: "coordinator_state_changed_during_snapshot", sourcePath: statePath, sourceSha256: stateSha256, snapshotAt, snapshotAtReused: false, ...emptyCounters };
      throw error;
    }
    const stateArchive = await fs.readFile(snapshot.stateArchive);
    if (!stateArchive.equals(stateBytes) || sha256(stateArchive) !== stateSha256) return { command: "handoff", mode: executeOffline ? "execute-offline" : "dry-run", state: "technical-hold", technicalHold: "coordinator_state_changed_during_snapshot", sourcePath: statePath, sourceSha256: stateSha256, ...emptyCounters };
    runDir = snapshot.runDir;
    candidateCount = snapshot.candidateCount;
    source = await readJson<WholeFirmSourceManifest>(path.join(runDir, "source-manifest.json"));
  }
  const sourceManifestPath = path.join(runDir, "source-manifest.json");
  verifyWholeFirmManifest(source);
  const snapshotReused = search.anchor?.sourceManifestSha256 === source.manifestSha256;
  const snapshotCreated = !snapshotReused;
  const handoffDir = path.join(runDir, "prepared-handoff"), prepared = compileArtifacts(source, handoffDir);
  if (!executeOffline) return { command: "handoff", mode: "dry-run", state: "dry-run", snapshotCreated, snapshotReused, snapshotAtReused: priorSnapshot,
    snapshotAt, sourcePath: statePath, sourceSha256: stateSha256, sourceManifestPath, sourceManifestSha256: source.manifestSha256,
    expectedRevisionCount: source.expectedRevisionCount, accountedRevisionCount: prepared.coverage.accountedRevisionCount,
    candidateCount, revisionCount: source.expectedRevisionCount, wouldPrepareCount: prepared.result.packages.length, heldCount: prepared.nonPackageHolds,
    timestampTechnicalHoldCount: prepared.timestampTechnicalHolds, preparedCount: 0, alreadyPreparedCount: 0, handoffDir, ...emptyCounters };
  try {
    await assertCoordinatorOutputPath(outputRoot, handoffDir, "directory");
    await assertCoordinatorOutputPath(outputRoot, path.join(handoffDir, "checkpoint.json"), "file");
  } catch {
    return { command: "handoff", mode: "execute-offline", state: "technical-hold", technicalHold: "offline_handoff_path_invalid",
      snapshotCreated, snapshotReused, snapshotAtReused: priorSnapshot, snapshotAt, sourcePath: statePath, sourceSha256: stateSha256,
      sourceManifestPath, sourceManifestSha256: source.manifestSha256, expectedRevisionCount: source.expectedRevisionCount,
      accountedRevisionCount: prepared.coverage.accountedRevisionCount, candidateCount, revisionCount: source.expectedRevisionCount,
      heldCount: prepared.nonPackageHolds, timestampTechnicalHoldCount: prepared.timestampTechnicalHolds, preparedCount: 0, alreadyPreparedCount: 0, handoffDir, ...emptyCounters };
  }
  const priorHandoff = await optionalFile(path.join(handoffDir, "checkpoint.json"));
  const dirExists = await fs.lstat(handoffDir).then(() => true, error => isMissing(error) ? false : Promise.reject(error));
  if (priorHandoff) {
    const validated = await validateHandoffCheckpoint(outputRoot, handoffDir, source, statePath, stateSha256, prepared);
    if (!validated.checkpoint) return { command: "handoff", mode: "execute-offline", state: "technical-hold", technicalHold: validated.hold ?? "offline_handoff_checkpoint_invalid",
      snapshotCreated, snapshotReused, snapshotAtReused: priorSnapshot, snapshotAt, sourcePath: statePath, sourceSha256: stateSha256,
      sourceManifestPath, sourceManifestSha256: source.manifestSha256, expectedRevisionCount: source.expectedRevisionCount,
      accountedRevisionCount: prepared.coverage.accountedRevisionCount, candidateCount, revisionCount: source.expectedRevisionCount,
      heldCount: prepared.nonPackageHolds, timestampTechnicalHoldCount: prepared.timestampTechnicalHolds, preparedCount: 0, alreadyPreparedCount: 0, handoffDir, ...emptyCounters };
    return { command: "handoff", mode: "execute-offline", state: "prepared-pending-admin", snapshotCreated, snapshotReused, snapshotAtReused: priorSnapshot,
      snapshotAt, sourcePath: statePath, sourceSha256: stateSha256, sourceManifestPath, sourceManifestSha256: source.manifestSha256,
      expectedRevisionCount: source.expectedRevisionCount, accountedRevisionCount: prepared.coverage.accountedRevisionCount,
      candidateCount, revisionCount: source.expectedRevisionCount, heldCount: validated.checkpoint.heldCount,
      timestampTechnicalHoldCount: validated.checkpoint.timestampTechnicalHoldCount, preparedCount: 0,
      alreadyPreparedCount: validated.checkpoint.packageCount, handoffDir, checkpointPath: path.join(handoffDir, "checkpoint.json"), ...emptyCounters };
  }
  try {
    await assertCoordinatorOutputRoot(outputRoot);
    await assertCoordinatorOutputPath(outputRoot, handoffDir, "directory");
    if (!dirExists) await fs.mkdir(handoffDir, { recursive: false });
    const progressPath = path.join(handoffDir, PROGRESS_FILE);
    let progressExists = await fs.lstat(progressPath).then(() => true, error => isMissing(error) ? false : Promise.reject(error));
    if (!progressExists) {
      const entries = await fs.readdir(handoffDir);
      if (entries.length !== 0) throw Error("offline_handoff_checkpoint_missing");
    }
    let progress = progressExists
      ? await readProgress(progressPath, outputRoot, source, statePath, stateSha256, sourceManifestPath, handoffDir, prepared)
      : { records: [], tornTailBytes: 0, validBytes: 0 };
    if (progress.hold) throw Error(progress.hold);
    if (progressExists && progress.tornTailBytes > 0) {
      throw Error("offline_handoff_progress_unterminated_tail");
    }
    if (progress.records.length === 0) {
      const initial = makeCheckpoint(source, statePath, stateSha256, sourceManifestPath, handoffDir, prepared, "preparing", []);
      await appendProgress(progressPath, initial, outputRoot);
      progressExists = true;
      progress = { records: [initial], tornTailBytes: 0, validBytes: 0 };
    }
    const actualFiles = await listArtifactFiles(handoffDir);
    if (!actualFiles) throw Error("offline_handoff_artifact_tree_invalid");
    const expectedPaths = new Set(prepared.artifacts.keys());
    for (const relative of actualFiles) {
      if (!expectedPaths.has(relative)) throw Error("offline_handoff_artifact_set_mismatch");
      const expected = prepared.artifacts.get(relative)!, actual = await fs.readFile(path.join(handoffDir, relative));
      if (!actual.equals(expected.bytes) || sha256(actual) !== expected.sha256) throw Error("offline_handoff_artifact_hash_mismatch");
    }
    const present = new Set(actualFiles);
    const logged = progress.records[progress.records.length - 1].files;
    for (const record of logged) if (!present.has(record.path)) throw Error("offline_handoff_artifact_set_mismatch");
    const orderedArtifacts = [...prepared.artifacts.entries()].sort(([a], [b]) => ordinal(a, b));
    let completedCount = logged.length;
    const finalRecord = progress.records[progress.records.length - 1];
    if (finalRecord.state !== "prepared-pending-admin") {
      for (let index = 0; index < orderedArtifacts.length; index++) {
        const [relative, artifact] = orderedArtifacts[index], file = path.join(handoffDir, relative);
        if (!present.has(relative)) {
          await assertCoordinatorOutputPath(outputRoot, file, "file");
          await fs.mkdir(path.dirname(file), { recursive: true });
          await assertCoordinatorOutputPath(outputRoot, file, "file");
          const handle = await fs.open(file, "wx");
          try { await handle.writeFile(artifact.bytes); await handle.sync(); } finally { await handle.close(); }
          await assertCoordinatorOutputPath(outputRoot, file, "file");
          present.add(relative);
        }
        if (index >= completedCount) {
          const records = orderedArtifacts.slice(0, index + 1).map(([filePath, item]) => ({ path: filePath, sha256: item.sha256, bytes: item.bytes.length }));
          const checkpoint = makeCheckpoint(source, statePath, stateSha256, sourceManifestPath, handoffDir, prepared, "preparing", records);
          await appendProgress(progressPath, checkpoint, outputRoot);
          completedCount = index + 1;
          await options.afterArtifactCheckpoint?.(index, relative);
        }
      }
      const completeFiles = orderedArtifacts.map(([filePath, item]) => ({ path: filePath, sha256: item.sha256, bytes: item.bytes.length }));
      const complete = makeCheckpoint(source, statePath, stateSha256, sourceManifestPath, handoffDir, prepared, "prepared-pending-admin", completeFiles);
      await appendProgress(progressPath, complete, outputRoot);
      progress.records.push(complete);
      await options.afterFinalProgress?.();
    }
    const checkpoint = progress.records[progress.records.length - 1];
    await atomicWriteFinalCheckpoint(outputRoot, handoffDir, checkpoint);
    const validated = await validateHandoffCheckpoint(outputRoot, handoffDir, source, statePath, stateSha256, prepared);
    if (!validated.checkpoint) return { command: "handoff", mode: "execute-offline", state: "technical-hold", technicalHold: validated.hold ?? "offline_handoff_postwrite_validation_failed",
      snapshotCreated, snapshotReused, snapshotAtReused: priorSnapshot, snapshotAt, sourcePath: statePath, sourceSha256: stateSha256,
      sourceManifestPath, sourceManifestSha256: source.manifestSha256, expectedRevisionCount: source.expectedRevisionCount,
      accountedRevisionCount: prepared.coverage.accountedRevisionCount, candidateCount, revisionCount: source.expectedRevisionCount, heldCount: prepared.nonPackageHolds,
      timestampTechnicalHoldCount: prepared.timestampTechnicalHolds, preparedCount: 0, alreadyPreparedCount: 0, handoffDir, ...emptyCounters };
    return { command: "handoff", mode: "execute-offline", state: "prepared-pending-admin", snapshotCreated, snapshotReused, snapshotAtReused: priorSnapshot,
      snapshotAt, sourcePath: statePath, sourceSha256: stateSha256, sourceManifestPath, sourceManifestSha256: source.manifestSha256,
      expectedRevisionCount: source.expectedRevisionCount, accountedRevisionCount: prepared.coverage.accountedRevisionCount,
      candidateCount, revisionCount: source.expectedRevisionCount, heldCount: prepared.nonPackageHolds,
      timestampTechnicalHoldCount: prepared.timestampTechnicalHolds, preparedCount: prepared.result.packages.length,
      alreadyPreparedCount: 0, handoffDir, checkpointPath: path.join(handoffDir, "checkpoint.json"), ...emptyCounters };
  } catch (error) {
    const technicalHold = error instanceof Error && /^offline_handoff_[a-z0-9_]+$/.test(error.message)
      ? error.message : "offline_handoff_partial_artifacts_preserved";
    return { command: "handoff", mode: "execute-offline", state: "technical-hold", technicalHold,
      snapshotCreated, snapshotReused, snapshotAtReused: priorSnapshot, snapshotAt, sourcePath: statePath, sourceSha256: stateSha256,
      sourceManifestPath, sourceManifestSha256: source.manifestSha256, expectedRevisionCount: source.expectedRevisionCount,
      accountedRevisionCount: prepared.coverage.accountedRevisionCount, heldCount: prepared.nonPackageHolds,
      timestampTechnicalHoldCount: prepared.timestampTechnicalHolds, preparedCount: 0, alreadyPreparedCount: 0, handoffDir, ...emptyCounters };
  }
}
