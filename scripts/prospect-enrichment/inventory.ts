import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_ROOTS, Issue, JsonObject, object, ordinal, protocolHash, sha256, within } from "./model";

export type InventoryRoot = { id: string; path: string };
export type Artifact = { sourceRoot: string; relativePath: string; sourcePointer: string; snapshotAt: string; size: number; fileSha256: string; archivePath: string; classification: "research" | "provenance"; status: "snapshotted" | "source_changed_during_snapshot" };
export type SourceManifest = { schemaVersion: "prospect-backfill-manifest/v1"; snapshotAt: string; roots: InventoryRoot[]; artifacts: Artifact[]; issues: Issue[]; manifestSha256: string };
export type ArchivedDocument = { artifact: Artifact; value: unknown; pointer: string };
const excluded = /(^|\/)(node_modules|_synthetic|request_queues|\.git)(\/|$)|(^|\/)([^/]*(?:\.lock|\.lease)|process[-_]state)\.[^/]+$/i;
const executable = /\.(sql|mjs|cjs|js|ts|ps1|cmd|bat|exe|com|vbs|sh)$/i;
const jsonFile = /\.(json|jsonl)$/i;

export function discoverable(rootId: string, relativePath: string): boolean {
  const p = relativePath.replace(/\\/g, "/");
  if (excluded.test(p) || !jsonFile.test(p)) return false;
  if (rootId === "root-a") return /^data\//.test(p) || /^operations\/luna_continuous_v1\/(control|workers|cohorts)\//.test(p);
  return !p.includes("/") || /^(draft_inbox_packages|staging_submission_2026-09-21_v1|superseded)\//.test(p);
}

async function files(root: InventoryRoot, dir = root.path): Promise<string[]> {
  const result: string[] = [];
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => ordinal(a.name, b.name))) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(root.path, full).replace(/\\/g, "/");
    if (entry.isSymbolicLink() || excluded.test(relative)) continue;
    if (entry.isDirectory()) result.push(...await files(root, full));
    else if (entry.isFile() && discoverable(root.id, relative)) result.push(full);
  }
  return result;
}

function references(value: unknown): string[] {
  const result: string[] = [];
  function walk(item: unknown, key = "") {
    if (typeof item === "string" && /path|artifact|capture|file|evidenceUrls/i.test(key) && !/^https?:/i.test(item) && /\.(jsonl?|html?|pdf|png|jpe?g|txt|csv|md)$/i.test(item)) result.push(item);
    else if (Array.isArray(item)) item.forEach(v => walk(v, key));
    else if (object(item)) Object.entries(item).forEach(([k, v]) => walk(v, k));
  }
  walk(value);
  return [...new Set(result)].sort(ordinal);
}

export function parseArchive(bytes: Uint8Array, artifact: Artifact): { documents: ArchivedDocument[]; issues: Issue[] } {
  const documents: ArchivedDocument[] = [], issues: Issue[] = [];
  if (!jsonFile.test(artifact.relativePath)) return { documents, issues };
  const raw = Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/, "");
  if (/\.jsonl$/i.test(artifact.relativePath)) {
    raw.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      try { documents.push({ artifact, value: JSON.parse(line), pointer: `line:${index + 1}` }); }
      catch { issues.push({ code: "hold_schema", path: `${artifact.relativePath}:line:${index + 1}`, reason: "Invalid JSONL line; original bytes remain archived." }); }
    });
  } else {
    try { documents.push({ artifact, value: JSON.parse(raw), pointer: "" }); }
    catch { issues.push({ code: "hold_schema", path: artifact.relativePath, reason: "Invalid JSON document; original bytes remain archived." }); }
  }
  return { documents, issues };
}

/** Local snapshot only. No locks, writes, renames or executions in the source roots. */
export async function inventory(options: { outputRoot: string; roots?: InventoryRoot[]; snapshotAt?: string; beforeRecheck?: (file: string) => Promise<void> }): Promise<SourceManifest> {
  const roots = options.roots ?? DEFAULT_ROOTS.map(r => ({ ...r }));
  const snapshotAt = options.snapshotAt ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(snapshotAt)) throw new Error("snapshotAt must be a UTC timestamp");
  if (roots.some(r => within(r.path, options.outputRoot))) throw new Error("Output must be separate from source roots");
  const issues: Issue[] = [], artifacts: Artifact[] = [];
  const pending: { root: InventoryRoot; file: string; referenced: boolean }[] = [];
  for (const root of roots) {
    try { pending.push(...(await files(root)).map(file => ({ root, file, referenced: false }))); }
    catch (error) { issues.push({ code: "source_root_unavailable", path: root.id, reason: error instanceof Error ? error.message : "Source root unavailable" }); }
  }
  const seen = new Set<string>();
  while (pending.length) {
    pending.sort((a, b) => ordinal(`${a.root.id}/${path.relative(a.root.path, a.file)}`, `${b.root.id}/${path.relative(b.root.path, b.file)}`));
    const next = pending.shift()!;
    const key = `${next.root.id}:${path.resolve(next.file)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const relativePath = path.relative(next.root.path, next.file).replace(/\\/g, "/");
    if (executable.test(next.file) || excluded.test(relativePath)) { issues.push({ code: "reference_provenance_only", path: relativePath, reason: "Runtime/executable reference is never treated as research or executed." }); continue; }
    try {
      const real = await fs.realpath(next.file), rootReal = await fs.realpath(next.root.path);
      if (!within(rootReal, real)) { issues.push({ code: "reference_out_of_scope", path: relativePath, reason: "Resolved file leaves its allowlisted source root" }); continue; }
      const bytes = await fs.readFile(real), fileSha256 = sha256(bytes);
      const extension = path.extname(real).slice(1).toLowerCase() || "bin";
      const archivePath = path.join(options.outputRoot, "artifacts", "sha256", fileSha256.slice(0, 2), `${fileSha256}.${extension}`);
      await fs.mkdir(path.dirname(archivePath), { recursive: true });
      try { await fs.writeFile(archivePath, bytes, { flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || sha256(await fs.readFile(archivePath)) !== fileSha256) throw error; }
      await options.beforeRecheck?.(real);
      const unchanged = sha256(await fs.readFile(real)) === fileSha256;
      const artifact: Artifact = { sourceRoot: next.root.id, relativePath, sourcePointer: "", snapshotAt, size: bytes.length, fileSha256, archivePath, classification: next.referenced || /^superseded\//.test(relativePath) ? "provenance" : "research", status: unchanged ? "snapshotted" : "source_changed_during_snapshot" };
      artifacts.push(artifact);
      if (!unchanged) { issues.push({ code: "source_changed_during_snapshot", path: relativePath, reason: "Archived first read; deferred from this frozen run because source changed." }); continue; }
      const parsed = parseArchive(bytes, artifact);
      issues.push(...parsed.issues);
      for (const doc of parsed.documents) for (const reference of references(doc.value)) {
        const absolute = path.isAbsolute(reference) || /^[A-Za-z]:[\\/]/.test(reference);
        const candidate = absolute ? path.resolve(reference) : path.resolve(next.root.path, reference);
        const owner = roots.find(r => within(r.path, candidate));
        if (!owner) { issues.push({ code: "reference_out_of_scope", path: reference, reason: "Reference is outside both fixed input roots" }); continue; }
        pending.push({ root: owner, file: candidate, referenced: true });
      }
    } catch (error) { issues.push({ code: "source_read_failed", path: relativePath, reason: (error as NodeJS.ErrnoException).code ?? "Could not read/archive source" }); }
  }
  const value = { schemaVersion: "prospect-backfill-manifest/v1" as const, snapshotAt, roots, artifacts: artifacts.sort((a, b) => ordinal(`${a.sourceRoot}/${a.relativePath}`, `${b.sourceRoot}/${b.relativePath}`)), issues };
  return { ...value, manifestSha256: protocolHash(value) };
}

export function verifyManifest(manifest: SourceManifest): void {
  const { manifestSha256, ...content } = manifest;
  if (protocolHash(content) !== manifestSha256) throw new Error("source_manifest_hash_mismatch");
}
export async function archivedDocuments(manifest: SourceManifest): Promise<{ documents: ArchivedDocument[]; issues: Issue[] }> {
  verifyManifest(manifest);
  const documents: ArchivedDocument[] = [], issues: Issue[] = [];
  for (const artifact of manifest.artifacts) {
    if (artifact.status !== "snapshotted") continue;
    const bytes = await fs.readFile(artifact.archivePath);
    if (sha256(bytes) !== artifact.fileSha256) throw new Error(`archive_hash_mismatch:${artifact.relativePath}`);
    const result = parseArchive(bytes, artifact);
    documents.push(...result.documents); issues.push(...result.issues);
  }
  return { documents, issues };
}

export type CandidateInput = { original: JsonObject; parentMetadata: JsonObject; pointer: string; artifact: Artifact };
function looksLikeCandidate(v: JsonObject): boolean {
  const r = object(v.record) ? v.record : v;
  return ["firmName", "canonicalFirmName", "canonicalCandidateId", "sourceRecordKey", "researchKey", "workKey", "databaseFirmId"].some(k => r[k] !== undefined || v[k] !== undefined);
}
export function extractCandidates(doc: ArchivedDocument): { candidates: CandidateInput[]; issues: Issue[] } {
  const candidates: CandidateInput[] = [], issues: Issue[] = [];
  function walk(value: unknown, pointer: string, metadata: JsonObject) {
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${pointer}/${i}`, metadata)); return; }
    if (!object(value)) return;
    if (looksLikeCandidate(value)) { candidates.push({ original: value, parentMetadata: metadata, pointer, artifact: doc.artifact }); return; }
    let nested = false;
    for (const key of ["records", "candidates", "firms", "packages", "items", "results"]) if (Array.isArray(value[key])) {
      const parent = Object.fromEntries(Object.entries(value).filter(([, v]) => !Array.isArray(v)));
      walk(value[key], `${pointer}/${key}`, parent); nested = true;
    }
    if (!nested && ["sources", "observations", "evidence"].some(k => Array.isArray(value[k]))) issues.push({ code: "hold_schema", path: `${doc.artifact.relativePath}${pointer}`, reason: "Evidence container lacks a candidate identity; retained in archive, not assigned by filename." });
  }
  walk(doc.value, doc.pointer, {});
  if (!candidates.length && !issues.length) issues.push({ code: doc.artifact.classification === "provenance" ? "provenance_only" : "hold_schema", path: doc.artifact.relativePath, reason: "No recognized candidate object; complete file remains in source manifest without guessed field mappings." });
  return { candidates, issues };
}
