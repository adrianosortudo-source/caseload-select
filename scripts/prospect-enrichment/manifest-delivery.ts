import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, object, ordinal, protocolHash, sha256 } from "./model";
import { atomicJson, PRODUCTION_ORIGIN, retryTime, type DeliveryApproval, type OutboxEntry } from "./outbox";
import { items } from "./reconciliation";
import { profileConfig, wholeFirmRunId, type EnrichmentProfile } from "./profiles";
import { heldEvidenceDigest, type ExpectedManifestEntry, type ExpectedRunManifest, type HeldCandidateEvidence } from "./run-manifest";

export type ManifestChunk = {
  schemaVersion: "prospect-enrichment-run-manifest-chunk/v1"; adapterVersion: string; runId: string;
  sourceSystem: string; sourceName: string; sourceManifestSha256: string; runManifestSha256: string;
  generatedAt: string; expectedPackageCount: number; expectedEntryCount: number;
  chunkIndex: number; chunkCount: number; chunkSha256: string; entries: ExpectedManifestEntry[];
};
export type ManifestReceipt = {
  outcome: "chunk_registered" | "chunk_replayed" | "finalized" | "already_finalized" | "held_evidence_recorded" | "held_evidence_replayed";
  runId: string; runKey?: string; sourceManifestSha256?: string; manifestSha256?: string;
  registeredChunkCount?: number; expectedChunkCount?: number; receivedEntryCount?: number;
  expectedEntryCount?: number; receivedPackageCount?: number; expectedPackageCount?: number;
  manifestState?: string; entryId?: string; evidenceSha256?: string;
};
type ManifestRequest = { requestKey: string; body: string; bodySha256: string; chunkIndex: number; finalize: boolean; endpoint: "manifest-chunks" | "held-evidence"; heldEvidence?: HeldCandidateEvidence };
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
  return v.clientPackageId === null ? v.expectedPayloadSha256 === null && v.itemCount === 0 && (v.researchKey === null ? heldEvidenceDigest(v) === null : hash(heldEvidenceDigest(v))) : typeof v.researchKey === "string" && hash(v.expectedPayloadSha256) && heldEvidenceDigest(v) === null;
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

export function prepareManifestRequests(input: unknown, profile: EnrichmentProfile = "legacy-backfill", heldEvidenceInput: unknown = []): { chunks: ManifestChunk[]; requests: ManifestRequest[] } {
  const chunks = validateManifestChunks(input, profile);
  if (!Array.isArray(heldEvidenceInput)) throw Error("held_evidence_invalid");
  const expectedHolds = chunks.flatMap(chunk => chunk.entries).filter(entry => heldEvidenceDigest(entry) !== null);
  const heldEvidence = heldEvidenceInput as HeldCandidateEvidence[];
  if (heldEvidence.length !== expectedHolds.length || new Set(heldEvidence.map(value => value?.entryId)).size !== heldEvidence.length) throw Error("held_evidence_coverage_mismatch");
  for (const value of heldEvidence) {
    if (!object(value) || value.schemaVersion !== "prospect-enrichment-held-candidate-evidence/v1" || value.runId !== chunks[0].runId || typeof value.entryId !== "string" || typeof value.researchKey !== "string" || !object(value.source) || typeof value.originalJson !== "string" || !hash(value.evidenceSha256) || !Array.isArray(value.issues) || !value.issues.every(issue => object(issue) && typeof issue.code === "string" && typeof issue.path === "string" && typeof issue.reason === "string")) throw Error("held_evidence_invalid");
    const entry = expectedHolds.find(item => item.entryId === value.entryId);
    const core = { schemaVersion: value.schemaVersion, entryId: value.entryId, researchKey: value.researchKey, source: value.source, originalJson: value.originalJson, issues: value.issues };
    if (!entry || entry.researchKey !== value.researchKey || heldEvidenceDigest(entry) !== protocolHash(core) || heldEvidenceDigest(entry) !== value.evidenceSha256 || canonicalJson(entry.source) !== canonicalJson(value.source)) throw Error("held_evidence_manifest_mismatch");
  }
  const requests: ManifestRequest[] = [];
  const add = (value: { chunk: ManifestChunk; finalize: boolean }, endpoint: "manifest-chunks" = "manifest-chunks") => {
    const body = canonicalJson(value);
    if (Buffer.byteLength(body) > 2_097_152) throw Error("manifest_request_body_limit");
    requests.push({ requestKey: "pe-manifest-v1-" + protocolHash([value.chunk.sourceSystem, value.chunk.runId, value.chunk.runManifestSha256, value.chunk.chunkIndex, value.finalize]), body, bodySha256: sha256(body), chunkIndex: value.chunk.chunkIndex, finalize: value.finalize, endpoint });
  };
  chunks.forEach(chunk => add({ chunk, finalize: false }));
  for (const evidence of heldEvidence) {
    const body = canonicalJson({ evidence });
    if (Buffer.byteLength(body) > 8_388_608) throw Error("held_evidence_request_body_limit");
    const requestKey = "pe-held-evidence-v1-" + protocolHash([evidence.runId, evidence.entryId, evidence.evidenceSha256]);
    requests.push({ requestKey, body, bodySha256: sha256(body), chunkIndex: -1, finalize: false, endpoint: "held-evidence", heldEvidence: evidence });
  }
  add({ chunk: chunks[chunks.length - 1], finalize: true });
  return { chunks, requests };
}
function verifyReceipt(value: unknown, chunks: ManifestChunk[], request: ManifestRequest): value is ManifestReceipt {
  if (!object(value)) return false;
  if (request.endpoint === "held-evidence") return ["held_evidence_recorded", "held_evidence_replayed"].includes(String(value.outcome)) && value.runId === chunks[0].runId && value.entryId === request.heldEvidence?.entryId && value.evidenceSha256 === request.heldEvidence?.evidenceSha256;
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
export async function submitManifestChunks(options: { outbox: string; chunks: unknown; heldEvidence?: unknown; approval: DeliveryApproval; profile?: EnrichmentProfile; confirmation: string; token: string; now?: string; fetcher?: typeof fetch; beforeNetwork?: () => void }) {
  if (options.confirmation !== "SUBMIT-APPROVED-PROSPECT-RESEARCH") throw Error("explicit_submission_confirmation_required");
  if (!options.token.trim()) throw Error("missing_agent_token");
  const { chunks, requests } = prepareManifestRequests(options.chunks, options.profile, options.heldEvidence ?? []); checkManifestApproval(chunks, options.approval, options.profile);
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
      try { response = await (options.fetcher ?? fetch)(PRODUCTION_ORIGIN + "/api/internal/prospect-enrichment/runs/" + request.endpoint, { method: "POST", headers: { Authorization: "Bearer " + options.token.trim(), "Content-Type": "application/json", "Idempotency-Key": request.requestKey }, body: request.body, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
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

export const CASEY_MOSS_HELD_EVIDENCE_RECOVERY = Object.freeze({
  requestKey: "pe-held-evidence-v1-5d4d1767f39d2be1a8d50c7289a6b57905dfe41135a98c4d3b9d4b4fc5578c57",
  requestFileSha256: "d8370d1516c79cfcb78062918b0292a6bfd728109541ba2111be8992826f0e69",
  requestBodySha256: "ced28dd6b0aee352ba96f85ef409f1a6d03b9ed04901a6e292dc1fc95f0bbfa5",
  evidenceSha256: "54196cbbafa96b95a66b7a6beca9208c48652601d74aa2a1a1a6c236e3460be9",
  priorStateSha256: "a56fb9f4cfab2b91ad876a09cb4c63628ef21fdba6149900d09854f30f077de7",
  comparisonRequestSha256: "7a9ab00e3cb5912449c8fd7e7b742daf35eeb3f4e7f28b5c905637cb20a2d40d",
  entryId: "entry-14e1fc6dc59123aeeea89ed7aad8a22ae678af0b261e2b0d07675d954487ff2f",
  runId: "run-2a85614af50ae60be67addd30ace5ea6b098fa783429e374",
  expectedPackageCount: 28,
  sourceManifestSha256: "fb5f2d02f2ff5ee9379def3397b543479be17a84bc2c5446e704dfee2938832f",
  runManifestSha256: "c64a287b1262f9efb52b4a3b93192e4846706ce3d8e6ceafd7bc0eedb0deaa21",
});
type HeldEvidenceRecoveryAuthorization = {
  schemaVersion: "prospect-held-evidence-recovery-authorization/v1";
  requestKey: string; requestBodySha256: string; evidenceSha256: string;
  sourceManifestSha256: string; runManifestSha256: string; authorizationReference: string;
};
const exactRecordKeys = (value: unknown, keys: string[]) =>
  object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function validateCaseyMossRecoveryAuthorization(bytes: Uint8Array, authorizationSha256: string): HeldEvidenceRecoveryAuthorization {
  if (typeof authorizationSha256 !== "string" || !/^[a-f0-9]{64}$/.test(authorizationSha256) || sha256(bytes) !== authorizationSha256) {
    throw Error("held_evidence_recovery_authorization_hash_mismatch");
  }
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const required = ["schemaVersion", "requestKey", "requestBodySha256", "evidenceSha256", "sourceManifestSha256", "runManifestSha256", "authorizationReference"];
  if (!exactRecordKeys(value, required) || !object(value) || value.schemaVersion !== "prospect-held-evidence-recovery-authorization/v1" ||
      value.requestKey !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey ||
      value.requestBodySha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestBodySha256 ||
      value.evidenceSha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.evidenceSha256 ||
      value.sourceManifestSha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.sourceManifestSha256 ||
      value.runManifestSha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256 ||
      typeof value.authorizationReference !== "string" || !value.authorizationReference.trim()) {
    throw Error("held_evidence_recovery_authorization_invalid");
  }
  return value as HeldEvidenceRecoveryAuthorization;
}
async function appendRecoveryAudit(file: string, event: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, "a");
  try { await handle.writeFile(canonicalJson(event) + "\n", "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}

async function atomicBytes(file: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  const handle = await fs.open(temp, "wx");
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
}

/** One exact, separately authorized attempt for the exhausted held-evidence request. */
export async function recoverCaseyMossHeldEvidenceOnce(options: {
  outbox: string; chunks: unknown; heldEvidence: unknown; approval: DeliveryApproval; authorizationBytes: Uint8Array;
  authorizationSha256: string; profile?: EnrichmentProfile; confirmation: string; token: string; now?: string;
  fetcher?: typeof fetch; beforeNetwork?: () => void;
}) {
  if (options.confirmation !== "RECOVER-CASEY-MOSS-HELD-EVIDENCE-ONCE") throw Error("explicit_held_evidence_recovery_confirmation_required");
  if (!options.token.trim()) throw Error("missing_agent_token");
  const profile = options.profile ?? "legacy-backfill";
  if (profile !== "whole-firm") throw Error("held_evidence_recovery_profile_invalid");
  const authorization = validateCaseyMossRecoveryAuthorization(options.authorizationBytes, options.authorizationSha256);
  const { chunks, requests } = prepareManifestRequests(options.chunks, profile, options.heldEvidence);
  checkManifestApproval(chunks, options.approval, profile);
  const request = requests.find(item => item.requestKey === CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestKey);
  if (!request || request.endpoint !== "held-evidence" || requests.filter(item => item.requestKey === request.requestKey).length !== 1 ||
      request.bodySha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestBodySha256 ||
      request.heldEvidence?.evidenceSha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.evidenceSha256 ||
      request.heldEvidence?.entryId !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.entryId ||
      request.heldEvidence?.runId !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runId ||
      chunks[0].runId !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runId ||
      chunks[0].expectedPackageCount !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.expectedPackageCount ||
      chunks[0].sourceManifestSha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.sourceManifestSha256 ||
      chunks[0].runManifestSha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256 ||
      authorization.requestKey !== request.requestKey || authorization.requestBodySha256 !== request.bodySha256 ||
      authorization.evidenceSha256 !== request.heldEvidence?.evidenceSha256 ||
      authorization.sourceManifestSha256 !== chunks[0].sourceManifestSha256 ||
      authorization.runManifestSha256 !== chunks[0].runManifestSha256) throw Error("held_evidence_recovery_request_binding_mismatch");
  const dir = path.join(options.outbox, "manifests", chunks[0].runManifestSha256);
  const stateFile = path.join(dir, request.requestKey + ".state.json"), requestFile = path.join(dir, request.requestKey + ".request.json");
  const lockFile = path.join(options.outbox, "submission.lock"), owner = randomUUID(), now = options.now ?? new Date().toISOString();
  options.beforeNetwork?.();
  await fs.mkdir(options.outbox, { recursive: true });
  let lock; try { lock = await fs.open(lockFile, "wx"); } catch { throw Error("outbox_submission_locked"); }
  await lock.writeFile(JSON.stringify({ owner, processId: process.pid, runId: chunks[0].runId, requestKey: request.requestKey, startedAt: now, operation: "held-evidence-recovery" }));
  await lock.close();
  const recoveryDir = path.join(options.outbox, "recovery-authorizations");
  const authorizationPath = path.join(recoveryDir, request.requestKey + ".json"), attemptPath = path.join(recoveryDir, request.requestKey + ".attempt.json");
  const auditPath = path.join(options.outbox, "recovery-audit.jsonl");
  try {
    await fs.mkdir(recoveryDir, { recursive: true });
    const savedRequestBytes = await fs.readFile(requestFile);
    if (sha256(savedRequestBytes) !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.requestFileSha256) throw Error("held_evidence_recovery_saved_request_hash_mismatch");
    const savedRequest = JSON.parse(savedRequestBytes.toString("utf8")) as ManifestRequest;
    if (canonicalJson(savedRequest) !== canonicalJson(request)) throw Error("held_evidence_recovery_saved_request_mismatch");
    const stateBytes = await fs.readFile(stateFile);
    if (sha256(stateBytes) !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.priorStateSha256) throw Error("held_evidence_recovery_saved_state_hash_mismatch");
    const state = JSON.parse(stateBytes.toString("utf8")) as ManifestDeliveryState;
    if (state.requestKey !== request.requestKey || state.state !== "retry_exhausted" || state.attempts !== 5 ||
        state.lastStatus !== 503 || state.lastError !== "http_503" || state.receipt !== null || state.nextAttemptAt !== null) {
      throw Error("held_evidence_recovery_retry_history_mismatch");
    }
    try { options.beforeNetwork?.(); }
    catch {
      await appendRecoveryAudit(auditPath, { event: "held_evidence_recovery_not_sent", requestKey: request.requestKey,
        requestBodySha256: request.bodySha256, authorizationSha256: options.authorizationSha256,
        state, reason: "fresh_comparison_revalidation_failed", networkRequests: 0, at: now });
      return { requestKey: request.requestKey, state: state.state, outcome: "not_sent", attempts: state.attempts, httpStatus: state.lastStatus, networkRequests: 0 };
    }
    await immutable(authorizationPath, { authorizationSha256: options.authorizationSha256, authorizationReference: authorization.authorizationReference,
      requestKey: request.requestKey, requestBodySha256: request.bodySha256, evidenceSha256: request.heldEvidence!.evidenceSha256,
      sourceManifestSha256: chunks[0].sourceManifestSha256, runManifestSha256: chunks[0].runManifestSha256 });
    const attempt = await fs.open(attemptPath, "wx");
    await attempt.writeFile(canonicalJson({ requestKey: request.requestKey, requestBodySha256: request.bodySha256, authorizedAt: now, attemptNumber: state.attempts + 1 }) + "\n", "utf8");
    await attempt.sync(); await attempt.close();
    await appendRecoveryAudit(auditPath, { event: "held_evidence_recovery_started", requestKey: request.requestKey, previousState: state,
      previousStateSha256: CASEY_MOSS_HELD_EVIDENCE_RECOVERY.priorStateSha256,
      requestBodySha256: request.bodySha256, evidenceSha256: request.heldEvidence!.evidenceSha256,
      authorizationSha256: options.authorizationSha256, authorizationReference: authorization.authorizationReference, attemptNumber: state.attempts + 1, at: now });
    const next: ManifestDeliveryState = { ...state, attempts: state.attempts + 1, lastStatus: null, lastError: null, updatedAt: now };
    await atomicJson(stateFile, next);
    try { options.beforeNetwork?.(); }
    catch {
      await atomicBytes(stateFile, stateBytes);
      await appendRecoveryAudit(auditPath, { event: "held_evidence_recovery_not_sent", requestKey: request.requestKey,
        requestBodySha256: request.bodySha256, authorizationSha256: options.authorizationSha256,
        state, reason: "fresh_comparison_revalidation_failed_after_durable_write", networkRequests: 0, at: new Date().toISOString() });
      await fs.unlink(attemptPath);
      return { requestKey: request.requestKey, state: state.state, outcome: "not_sent", attempts: state.attempts, httpStatus: state.lastStatus, networkRequests: 0 };
    }
    let response: Response | null = null;
    try {
      response = await (options.fetcher ?? fetch)(PRODUCTION_ORIGIN + "/api/internal/prospect-enrichment/runs/held-evidence", {
        method: "POST", headers: { Authorization: "Bearer " + options.token.trim(), "Content-Type": "application/json", "Idempotency-Key": request.requestKey },
        body: request.body, redirect: "error", signal: AbortSignal.timeout(20_000),
      });
    } catch { next.lastError = "network_or_timeout"; next.state = "retry_exhausted"; next.nextAttemptAt = null; }
    if (response) {
      next.lastStatus = response.status;
      if ([200, 201].includes(response.status)) {
        let receipt: unknown; try { receipt = await response.json(); } catch { receipt = null; }
        if (!verifyReceipt(receipt, chunks, request)) { next.state = "manual_review"; next.lastError = "manifest_receipt_mismatch"; next.nextAttemptAt = null; }
        else { next.state = "received"; next.receipt = receipt; next.nextAttemptAt = null; }
      } else if ([429, 502, 503, 504].includes(response.status)) {
        next.state = "retry_exhausted"; next.lastError = "http_" + response.status; next.nextAttemptAt = null;
      } else { next.state = "manual_review"; next.lastError = "http_" + response.status; next.nextAttemptAt = null; }
    }
    await atomicJson(stateFile, next);
    await appendRecoveryAudit(auditPath, { event: "held_evidence_recovery_finished", requestKey: request.requestKey,
      requestBodySha256: request.bodySha256, authorizationSha256: options.authorizationSha256,
      attemptNumber: next.attempts, state: next.state, httpStatus: next.lastStatus, error: next.lastError, at: new Date().toISOString() });
    return { requestKey: request.requestKey, state: next.state, outcome: "attempted", attempts: next.attempts,
      httpStatus: next.lastStatus, error: next.lastError, networkRequests: 1 };
  } finally {
    const current = JSON.parse(await fs.readFile(lockFile, "utf8"));
    if (current.owner === owner) await fs.unlink(lockFile);
  }
}
export function assertManifestPackage(chunks: ManifestChunk[], entry: OutboxEntry): void {
  const matches = chunks.flatMap(c => c.entries).filter(e => e.clientPackageId === entry.envelope.packageId);
  const expected = matches[0];
  const clientItems = items(entry.envelope).map(i => ({ clientItemId: i.id, itemKind: i.kind, sourceEventKey: i.sourceEventKey, semanticSha256: i.semanticSha256 }));
  if (matches.length !== 1 || expected.expectedPayloadSha256 !== entry.payloadSha256 || expected.researchKey !== entry.envelope.subject.researchKey || entry.envelope.runId !== chunks[0].runId || expected.itemCount !== clientItems.length || canonicalJson(expected.clientItems) !== canonicalJson(clientItems)) throw Error("package_does_not_match_frozen_manifest");
}
