import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, object, ordinal, protocolHash, sha256 } from "./model";
import { atomicJson, PRODUCTION_ORIGIN, retryTime, type DeliveryApproval, type OutboxEntry } from "./outbox";
import { items } from "./reconciliation";
import { profileConfig, wholeFirmRunId, type EnrichmentProfile } from "./profiles";
import type { ExpectedManifestEntry, ExpectedRunManifest } from "./run-manifest";

export type ManifestChunk = {
  schemaVersion: "prospect-enrichment-run-manifest-chunk/v1"; adapterVersion: string; runId: string;
  sourceSystem: string; sourceName: string; sourceManifestSha256: string; runManifestSha256: string;
  generatedAt: string; expectedPackageCount: number; expectedEntryCount: number;
  chunkIndex: number; chunkCount: number; chunkSha256: string; entries: ExpectedManifestEntry[];
};
export type ManifestReceipt = {
  outcome: "chunk_registered" | "chunk_replayed" | "finalized" | "already_finalized";
  runId: string; runKey: string; sourceManifestSha256: string; manifestSha256: string;
  registeredChunkCount: number; expectedChunkCount: number; receivedEntryCount: number;
  expectedEntryCount: number; receivedPackageCount: number; expectedPackageCount: number;
  manifestState: string;
};
type ManifestRequest = { requestKey: string; body: string; bodySha256: string; chunkIndex: number; finalize: boolean };
type ManifestDeliveryState = {
  requestKey: string; attempts: number; state: "pending" | "retry_pending" | "received" | "manual_review" | "retry_exhausted";
  nextAttemptAt: string | null; lastStatus: number | null; lastError: string | null; updatedAt: string;
  receipt: ManifestReceipt | null;
};
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const dispositions = ["ready_for_review", "identity_hold", "evidence_hold", "hold_schema", "source_root_unavailable", "source_read_failed", "source_changed_during_snapshot", "reference_out_of_scope", "reference_provenance_only", "provenance_only"];
function validEntry(v: unknown): v is ExpectedManifestEntry {
  if (!object(v) || typeof v.entryId !== "string" || !v.entryId || !(v.researchKey === null || typeof v.researchKey === "string") || !(v.clientPackageId === null || typeof v.clientPackageId === "string") || !(v.expectedPayloadSha256 === null || hash(v.expectedPayloadSha256)) || !integer(v.itemCount) || !Array.isArray(v.clientItems) || v.itemCount !== v.clientItems.length || !dispositions.includes(String(v.initialDisposition))) return false;
  if (!object(v.source) || !(v.source.sourceRoot === null || typeof v.source.sourceRoot === "string") || typeof v.source.relativePath !== "string" || typeof v.source.sourcePointer !== "string" || !(v.source.fileSha256 === null || hash(v.source.fileSha256)) || !Array.isArray(v.errorCodes) || !v.errorCodes.every(c => typeof c === "string")) return false;
  if (!v.clientItems.every(i => object(i) && typeof i.clientItemId === "string" && ["source", "observation", "assessment"].includes(String(i.itemKind)) && typeof i.sourceEventKey === "string" && hash(i.semanticSha256))) return false;
  return v.clientPackageId === null ? v.expectedPayloadSha256 === null && v.itemCount === 0 : typeof v.researchKey === "string" && hash(v.expectedPayloadSha256);
}
/** Verify the complete frozen inventory before preparing any network request. */
export function validateManifestChunks(input: unknown, profile: EnrichmentProfile = "legacy-backfill"): ManifestChunk[] {
  const config = profileConfig(profile);
  if (!Array.isArray(input) || input.length === 0) throw Error("manifest_chunks_missing");
  for (const c of input) {
    if (!object(c) || c.schemaVersion !== "prospect-enrichment-run-manifest-chunk/v1" || c.adapterVersion !== config.adapterVersion || c.sourceSystem !== config.sourceSystem || c.sourceName !== config.sourceName || !hash(c.sourceManifestSha256) || !hash(c.runManifestSha256) || (profile === "legacy-backfill" ? c.runId !== "backfill-" + c.sourceManifestSha256.slice(0, 48) : typeof c.runId !== "string" || !/^run-[a-f0-9]{48}$/.test(c.runId)) || typeof c.generatedAt !== "string" || !Number.isFinite(Date.parse(c.generatedAt)) || !integer(c.expectedPackageCount) || !integer(c.expectedEntryCount) || !integer(c.chunkIndex) || !integer(c.chunkCount) || !Array.isArray(c.entries) || !c.entries.every(validEntry) || !hash(c.chunkSha256) || protocolHash(c.entries) !== c.chunkSha256) throw Error("manifest_chunk_invalid");
  }
  const chunks = input as ManifestChunk[], first = chunks[0];
  const fields = ["schemaVersion", "adapterVersion", "runId", "sourceSystem", "sourceName", "sourceManifestSha256", "runManifestSha256", "generatedAt", "expectedPackageCount", "expectedEntryCount", "chunkCount"] as const;
  if (chunks.some((c, i) => c.chunkIndex !== i || c.chunkCount !== chunks.length || fields.some(k => c[k] !== first[k]))) throw Error("manifest_chunk_sequence_mismatch");
  const entries = chunks.flatMap(c => c.entries);
  if (entries.length !== first.expectedEntryCount || new Set(entries.map(e => e.entryId)).size !== entries.length || new Set(entries.flatMap(e => e.clientPackageId ? [e.clientPackageId] : [])).size !== first.expectedPackageCount) throw Error("manifest_inventory_count_mismatch");
  const full: Omit<ExpectedRunManifest, "manifestSha256"> = { schemaVersion: "prospect-enrichment-run-manifest/v1", runId: first.runId, sourceSystem: first.sourceSystem, sourceName: first.sourceName, sourceManifestSha256: first.sourceManifestSha256, generatedAt: first.generatedAt, expectedPackageCount: first.expectedPackageCount, entries };
  if (protocolHash(full) !== first.runManifestSha256) throw Error("manifest_full_hash_mismatch");
  return JSON.parse(canonicalJson(chunks)) as ManifestChunk[];
}
export function checkManifestApproval(chunks: ManifestChunk[], approval: DeliveryApproval, profile: EnrichmentProfile = "legacy-backfill"): void {
  const first = chunks[0];
  if (!first || !object(approval) || !Array.isArray(approval.packages) || !approval.packages.every(p => object(p) && typeof p.clientPackageId === "string" && hash(p.payloadSha256))) throw Error("approval_manifest_invalid");
  if (approval.targetOrigin !== PRODUCTION_ORIGIN || approval.projectId !== "ssxryjxifwiivghglqer" || !approval.approvalReference?.trim() || approval.sourceManifestSha256 !== first.sourceManifestSha256 || approval.runManifestSha256 !== first.runManifestSha256) throw Error("manifest_not_in_exact_approval_scope");
  if (profile === "whole-firm") {
    if (approval.schemaVersion !== "prospect-whole-firm-delivery-approval/v1" || approval.scope !== "whole-firm-run" || approval.runId !== wholeFirmRunId(first.sourceManifestSha256) || first.runId !== approval.runId || approval.expectedRevisionCount !== first.expectedEntryCount) throw Error("whole_firm_manifest_approval_mismatch");
    const expected = chunks.flatMap(c => c.entries).filter(e => e.clientPackageId !== null).map(e => [e.clientPackageId, e.expectedPayloadSha256]).sort((a, b) => ordinal(String(a[0]), String(b[0])));
    const approved = approval.packages.map(p => [p.clientPackageId, p.payloadSha256]).sort((a, b) => ordinal(String(a[0]), String(b[0])));
    if (canonicalJson(approved) !== canonicalJson(expected)) throw Error("whole_firm_approval_package_coverage_mismatch");
  } else if (approval.schemaVersion !== "prospect-enrichment-delivery-approval/v1" || !["pilot", "backfill"].includes(approval.scope)) throw Error("manifest_not_in_exact_approval_scope");
}

export function prepareManifestRequests(input: unknown, profile: EnrichmentProfile = "legacy-backfill"): { chunks: ManifestChunk[]; requests: ManifestRequest[] } {
  const chunks = validateManifestChunks(input, profile);
  const sequence = [...chunks.map(chunk => ({ chunk, finalize: false })), { chunk: chunks[chunks.length - 1], finalize: true }];
  return { chunks, requests: sequence.map(value => {
    const body = canonicalJson(value);
    if (Buffer.byteLength(body) > 2_097_152) throw Error("manifest_request_body_limit");
    return { requestKey: "pe-manifest-v1-" + protocolHash([value.chunk.sourceSystem, value.chunk.runId, value.chunk.runManifestSha256, value.chunk.chunkIndex, value.finalize]), body, bodySha256: sha256(body), chunkIndex: value.chunk.chunkIndex, finalize: value.finalize };
  }) };
}
function verifyReceipt(value: unknown, chunks: ManifestChunk[], request: ManifestRequest): value is ManifestReceipt {
  if (!object(value)) return false;
  const first = chunks[0], registered = request.finalize ? chunks.length : request.chunkIndex + 1;
  const prefixEntries = chunks.slice(0, registered).flatMap(c => c.entries);
  const minimumPackages = new Set(prefixEntries.flatMap(e => e.clientPackageId ? [e.clientPackageId] : [])).size;
  if (value.runId !== first.runId || value.runKey !== first.runId || value.sourceManifestSha256 !== first.sourceManifestSha256 || value.manifestSha256 !== first.runManifestSha256 || value.expectedChunkCount !== chunks.length || value.expectedEntryCount !== first.expectedEntryCount || value.expectedPackageCount !== first.expectedPackageCount) return false;
  if (!integer(value.registeredChunkCount) || value.registeredChunkCount < registered || value.registeredChunkCount > chunks.length || !integer(value.receivedEntryCount) || value.receivedEntryCount < prefixEntries.length || value.receivedEntryCount > first.expectedEntryCount || !integer(value.receivedPackageCount) || value.receivedPackageCount < minimumPackages || value.receivedPackageCount > first.expectedPackageCount) return false;
  if (request.finalize) return ["finalized", "already_finalized"].includes(String(value.outcome)) && value.manifestState === "finalized" && value.registeredChunkCount === chunks.length && value.receivedEntryCount === first.expectedEntryCount && value.receivedPackageCount === first.expectedPackageCount;
  return ["chunk_registered", "chunk_replayed", "already_finalized"].includes(String(value.outcome)) && ["open", "finalized"].includes(String(value.manifestState));
}
async function immutable(file: string, value: unknown): Promise<void> {
  const body = canonicalJson(value) + "\n";
  try { await fs.writeFile(file, body, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; if (await fs.readFile(file, "utf8") !== body) throw Error("manifest_outbox_idempotency_conflict"); }
}
/** Sequential registration only; one bounded attempt per pending request, no sleep or apply. */
export async function submitManifestChunks(options: { outbox: string; chunks: unknown; approval: DeliveryApproval; profile?: EnrichmentProfile; confirmation: string; token: string; now?: string; fetcher?: typeof fetch; beforeNetwork?: () => void }) {
  if (options.confirmation !== "SUBMIT-APPROVED-PROSPECT-RESEARCH") throw Error("explicit_submission_confirmation_required");
  if (!options.token.trim()) throw Error("missing_agent_token");
  const { chunks, requests } = prepareManifestRequests(options.chunks, options.profile); checkManifestApproval(chunks, options.approval, options.profile);
  const first = chunks[0], dir = path.join(options.outbox, "manifests", first.runManifestSha256);
  await fs.mkdir(dir, { recursive: true });
  const lockFile = path.join(options.outbox, "submission.lock"), owner = randomUUID();
  let lock; try { lock = await fs.open(lockFile, "wx"); } catch { throw Error("outbox_submission_locked"); }
  await lock.writeFile(JSON.stringify({ owner, processId: process.pid, runId: first.runId, startedAt: options.now ?? new Date().toISOString() })); await lock.close();
  const result = (state: string, completedRequests: number, receipt: ManifestReceipt | null) => ({ state, runId: first.runId, runManifestSha256: first.runManifestSha256, completedRequests, totalRequests: requests.length, receipt });
  try {
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i], now = options.now ?? new Date().toISOString();
      await immutable(path.join(dir, request.requestKey + ".request.json"), request);
      const stateFile = path.join(dir, request.requestKey + ".state.json");
      let state: ManifestDeliveryState;
      try { state = JSON.parse(await fs.readFile(stateFile, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; state = { requestKey: request.requestKey, attempts: 0, state: "pending", nextAttemptAt: null, lastStatus: null, lastError: null, updatedAt: now, receipt: null }; }
      if (state.requestKey !== request.requestKey) throw Error("manifest_delivery_state_mismatch");
      if (state.state === "received") {
        if (!verifyReceipt(state.receipt, chunks, request)) throw Error("manifest_saved_receipt_mismatch");
        if (request.finalize) return result("finalized", i + 1, state.receipt);
        continue;
      }
      if (["manual_review", "retry_exhausted"].includes(state.state)) return result(state.state, i, state.receipt);
      if (state.nextAttemptAt && Date.parse(state.nextAttemptAt) > Date.parse(now)) return result("retry_pending", i, state.receipt);
      const previous = state;
      state = { ...state, attempts: state.attempts + 1, lastStatus: null, lastError: null, updatedAt: now };
      await atomicJson(stateFile, state);
      try { options.beforeNetwork?.(); } catch (error) { await atomicJson(stateFile, previous); throw error; }
      let response: Response | null = null;
      try { response = await (options.fetcher ?? fetch)(PRODUCTION_ORIGIN + "/api/internal/prospect-enrichment/runs/manifest-chunks", { method: "POST", headers: { Authorization: "Bearer " + options.token.trim(), "Content-Type": "application/json", "Idempotency-Key": request.requestKey }, body: request.body, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
      catch { state.lastError = "network_or_timeout"; state.nextAttemptAt = retryTime(state.attempts, now); state.state = state.nextAttemptAt ? "retry_pending" : "retry_exhausted"; }
      if (response) {
        state.lastStatus = response.status;
        if ([200, 201].includes(response.status)) {
          let receipt: unknown; try { receipt = await response.json(); } catch { receipt = null; }
          if (!verifyReceipt(receipt, chunks, request)) { state.state = "manual_review"; state.lastError = "manifest_receipt_mismatch"; state.nextAttemptAt = null; }
          else { state.state = "received"; state.receipt = receipt; state.nextAttemptAt = null; }
        } else if ([429, 502, 503, 504].includes(response.status)) { state.nextAttemptAt = retryTime(state.attempts, now, response.headers.get("Retry-After")); state.state = state.nextAttemptAt ? "retry_pending" : "retry_exhausted"; state.lastError = "http_" + response.status; }
        else { state.state = "manual_review"; state.nextAttemptAt = null; state.lastError = "http_" + response.status; }
      }
      await atomicJson(stateFile, state);
      if (state.state !== "received") return result(state.state, i, state.receipt);
      if (request.finalize) return result("finalized", i + 1, state.receipt);
    }
    throw Error("manifest_finalized_receipt_missing");
  } finally {
    const current = JSON.parse(await fs.readFile(lockFile, "utf8")); if (current.owner === owner) await fs.unlink(lockFile);
  }
}

export function assertManifestPackage(chunks: ManifestChunk[], entry: OutboxEntry): void {
  const matches = chunks.flatMap(c => c.entries).filter(e => e.clientPackageId === entry.envelope.packageId);
  const expected = matches[0];
  const clientItems = items(entry.envelope).map(i => ({ clientItemId: i.id, itemKind: i.kind, sourceEventKey: i.sourceEventKey, semanticSha256: i.semanticSha256 }));
  if (matches.length !== 1 || expected.expectedPayloadSha256 !== entry.payloadSha256 || expected.researchKey !== entry.envelope.subject.researchKey || entry.envelope.runId !== chunks[0].runId || expected.itemCount !== clientItems.length || canonicalJson(expected.clientItems) !== canonicalJson(clientItems)) throw Error("package_does_not_match_frozen_manifest");
}
