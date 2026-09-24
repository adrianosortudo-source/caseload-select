import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseProspectEnrichmentEnvelope, type ProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { prospectEnrichmentIdempotencyKey } from "../../src/lib/prospect-enrichment-hash";
import { canonicalJson, object, protocolHash, sha256 } from "./model";
import { profileConfig, wholeFirmRunId, type EnrichmentProfile } from "./profiles";

export const PRODUCTION_ORIGIN = "https://admin.caseloadselect.ca";
export type OutboxEntry = { schemaVersion: "prospect-enrichment-outbox/v1"; key: string; payloadSha256: string; rawBodySha256: string; body: string; envelope: ProspectEnrichmentEnvelope; createdAt: string };
export type DeliveryState = { key: string; state: "pending" | "retry_pending" | "received" | "manual_review" | "retry_exhausted"; attempts: number; nextAttemptAt: string | null; serverPackageId: string | null; lastStatus: number | null; lastError: string | null; updatedAt: string };
export type ApprovalManifest = { schemaVersion: "prospect-enrichment-delivery-approval/v1"; scope: "pilot" | "backfill"; targetOrigin: typeof PRODUCTION_ORIGIN; projectId: "ssxryjxifwiivghglqer"; sourceManifestSha256: string; runManifestSha256?: string; approvalReference: string; packages: { clientPackageId: string; payloadSha256: string }[] };
export type WholeFirmApprovalManifest = Omit<ApprovalManifest, "schemaVersion" | "scope" | "runManifestSha256"> & { schemaVersion: "prospect-whole-firm-delivery-approval/v1"; scope: "whole-firm-run"; runId: string; runManifestSha256: string; expectedRevisionCount: number };
export type DeliveryApproval = ApprovalManifest | WholeFirmApprovalManifest;
const keyPattern = /^pe-v1-[a-f0-9]{64}$/;

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx");
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
}
export async function enqueue(outbox: string, input: unknown, now = new Date().toISOString()): Promise<{ entry: OutboxEntry; state: DeliveryState; replay: boolean }> {
  const parsed = parseProspectEnrichmentEnvelope(input);
  if (!parsed.ok) throw new Error(`invalid_envelope:${parsed.issues.map(i => i.path).join(",")}`);
  const envelope = parsed.envelope, body = canonicalJson(envelope);
  if (Buffer.byteLength(body) > 2_097_152) throw new Error("body_limit");
  const key = prospectEnrichmentIdempotencyKey(envelope.sourceSystem, envelope.runId, envelope.packageId);
  const entry: OutboxEntry = { schemaVersion: "prospect-enrichment-outbox/v1", key, payloadSha256: protocolHash(envelope), rawBodySha256: sha256(body), body, envelope, createdAt: now };
  await fs.mkdir(path.join(outbox, "packages"), { recursive: true });
  const file = path.join(outbox, "packages", `${key}.json`);
  try { await fs.writeFile(file, `${JSON.stringify(entry)}\n`, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await fs.readFile(file, "utf8")) as OutboxEntry;
    verifyEntry(existing);
    if (existing.payloadSha256 !== entry.payloadSha256 || existing.body !== body) throw new Error("outbox_idempotency_conflict");
    return { entry: existing, state: await readState(outbox, existing.key, now), replay: true };
  }
  const state: DeliveryState = { key, state: "pending", attempts: 0, nextAttemptAt: null, serverPackageId: null, lastStatus: null, lastError: null, updatedAt: now };
  await atomicJson(statePath(outbox, key), state);
  return { entry, state, replay: false };
}
function statePath(outbox: string, key: string): string { if (!keyPattern.test(key)) throw new Error("invalid_outbox_key"); return path.join(outbox, "states", `${key}.json`); }
function verifyEntry(entry: OutboxEntry): void {
  if (!keyPattern.test(entry.key) || sha256(entry.body) !== entry.rawBodySha256 || protocolHash(entry.envelope) !== entry.payloadSha256 || canonicalJson(entry.envelope) !== entry.body || prospectEnrichmentIdempotencyKey(entry.envelope.sourceSystem, entry.envelope.runId, entry.envelope.packageId) !== entry.key) throw new Error("outbox_hash_mismatch");
  if (!parseProspectEnrichmentEnvelope(entry.envelope).ok) throw new Error("outbox_schema_mismatch");
}
export async function readState(outbox: string, key: string, now = new Date().toISOString()): Promise<DeliveryState> {
  try { return JSON.parse(await fs.readFile(statePath(outbox, key), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return { key, state: "pending", attempts: 0, nextAttemptAt: null, serverPackageId: null, lastStatus: null, lastError: null, updatedAt: now }; }
}
export async function readEntry(outbox: string, key: string): Promise<OutboxEntry> {
  if (!keyPattern.test(key)) throw new Error("invalid_outbox_key");
  const entry = JSON.parse(await fs.readFile(path.join(outbox, "packages", `${key}.json`), "utf8")); verifyEntry(entry); return entry;
}
export function retryTime(attempts: number, now: string, retryAfter?: string | null): string | null {
  if (attempts >= 5) return null;
  const minimum = [5, 30, 120, 600][attempts - 1] * 1000;
  const supplied = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.parse(now) : 0;
  return new Date(Date.parse(now) + Math.max(minimum, Number.isFinite(supplied) ? supplied : 0)).toISOString();
}
export function checkApproval(entry: OutboxEntry, approval: DeliveryApproval, profile: EnrichmentProfile = "legacy-backfill"): void {
  const config = profileConfig(profile);
  if (!object(approval) || approval.targetOrigin !== PRODUCTION_ORIGIN || approval.projectId !== "ssxryjxifwiivghglqer" || !approval.approvalReference?.trim() || !/^[a-f0-9]{64}$/.test(approval.sourceManifestSha256) || entry.envelope.sourceSystem !== config.sourceSystem || entry.envelope.sourceName !== config.sourceName) throw new Error("approval_manifest_invalid");
  if (profile === "whole-firm") {
    if (approval.schemaVersion !== "prospect-whole-firm-delivery-approval/v1" || approval.scope !== "whole-firm-run" || !/^[a-f0-9]{64}$/.test(approval.runManifestSha256) || !Number.isSafeInteger(approval.expectedRevisionCount) || approval.expectedRevisionCount < 0 || approval.runId !== wholeFirmRunId(approval.sourceManifestSha256) || entry.envelope.runId !== approval.runId) throw Error("whole_firm_approval_scope_mismatch");
  } else if (approval.schemaVersion !== "prospect-enrichment-delivery-approval/v1" || !["pilot", "backfill"].includes(approval.scope) || entry.envelope.runId !== "backfill-" + approval.sourceManifestSha256.slice(0, 48)) throw Error("approval_run_mismatch");
  if (!Array.isArray(approval.packages) || !approval.packages.some(p => object(p) && p.clientPackageId === entry.envelope.packageId && p.payloadSha256 === entry.payloadSha256)) throw new Error("package_not_in_exact_approval_scope");
}

/** One bounded attempt. No sleep, process scheduler, implicit approvals or canonical apply. */
export async function submitOne(options: { outbox: string; key: string; approval: DeliveryApproval; profile?: EnrichmentProfile; confirmation: string; token: string; now?: string; fetcher?: typeof fetch; beforeNetwork?: () => void }): Promise<DeliveryState> {
  if (options.confirmation !== "SUBMIT-APPROVED-PROSPECT-RESEARCH") throw new Error("explicit_submission_confirmation_required");
  if (!options.token.trim()) throw new Error("missing_agent_token");
  const entry = await readEntry(options.outbox, options.key); checkApproval(entry, options.approval, options.profile);
  const now = options.now ?? new Date().toISOString();
  const previous = await readState(options.outbox, entry.key, now);
  if (previous.state === "received") return previous;
  if (["manual_review", "retry_exhausted"].includes(previous.state)) throw new Error("delivery_requires_manual_review");
  if (previous.nextAttemptAt && Date.parse(previous.nextAttemptAt) > Date.parse(now)) return previous;
  const lockFile = path.join(options.outbox, "submission.lock");
  await fs.mkdir(options.outbox, { recursive: true });
  let lock;
  try { lock = await fs.open(lockFile, "wx"); } catch { throw new Error("outbox_submission_locked"); }
  const owner = randomUUID();
  await lock.writeFile(JSON.stringify({ owner, processId: process.pid, key: entry.key, startedAt: now })); await lock.close();
  const state: DeliveryState = { ...previous, attempts: previous.attempts + 1, updatedAt: now, lastStatus: null, lastError: null };
  // Persist the attempt before networking so process interruption cannot reset retry accounting.
  await atomicJson(statePath(options.outbox, entry.key), state);
  try {
    try { options.beforeNetwork?.(); } catch (error) { await atomicJson(statePath(options.outbox, entry.key), previous); throw error; }
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(`${PRODUCTION_ORIGIN}/api/internal/prospect-enrichment/drafts`, { method: "POST", headers: { Authorization: `Bearer ${options.token.trim()}`, "Content-Type": "application/json", "Idempotency-Key": entry.key }, body: entry.body, redirect: "error", signal: AbortSignal.timeout(20_000) });
    } catch {
      state.lastError = "network_or_timeout"; state.nextAttemptAt = retryTime(state.attempts, now); state.state = state.nextAttemptAt ? "retry_pending" : "retry_exhausted";
      await atomicJson(statePath(options.outbox, entry.key), state); return state;
    }
    state.lastStatus = response.status;
    if ([200, 201].includes(response.status)) {
      let receipt: unknown; try { receipt = await response.json(); } catch { receipt = null; }
      if (!object(receipt) || receipt.clientPackageId !== entry.envelope.packageId || receipt.payloadSha256 !== entry.payloadSha256 || (typeof receipt.packageId !== "string" || !/^[0-9a-f-]{36}$/i.test(receipt.packageId))) { state.state = "manual_review"; state.lastError = "receipt_mismatch"; }
      else { state.state = "received"; state.serverPackageId = receipt.packageId; state.nextAttemptAt = null; await atomicJson(path.join(options.outbox, "receipts", `${entry.key}.json`), { packageId: receipt.packageId, clientPackageId: receipt.clientPackageId, payloadSha256: receipt.payloadSha256, state: receipt.state ?? null, receivedAt: receipt.receivedAt ?? null }); }
    } else if ([429, 502, 503, 504].includes(response.status)) { state.nextAttemptAt = retryTime(state.attempts, now, response.headers.get("Retry-After")); state.state = state.nextAttemptAt ? "retry_pending" : "retry_exhausted"; state.lastError = `http_${response.status}`; }
    else { state.state = "manual_review"; state.nextAttemptAt = null; state.lastError = `http_${response.status}`; }
    await atomicJson(statePath(options.outbox, entry.key), state); return state;
  } finally {
    const current = JSON.parse(await fs.readFile(lockFile, "utf8"));
    if (current.owner === owner) await fs.unlink(lockFile);
  }
}

export async function receiptStatus(options: { outbox: string; key: string; token: string; fetcher?: typeof fetch }) {
  const entry = await readEntry(options.outbox, options.key), state = await readState(options.outbox, options.key);
  if (!state.serverPackageId || !/^[0-9a-f-]{36}$/i.test(state.serverPackageId)) throw new Error("server_package_receipt_not_known");
  const response = await (options.fetcher ?? fetch)(`${PRODUCTION_ORIGIN}/api/internal/prospect-enrichment/drafts/${state.serverPackageId}/receipt`, { headers: { Authorization: `Bearer ${options.token.trim()}` }, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`receipt_http_${response.status}`);
  const receipt = await response.json();
  if (receipt.clientPackageId !== entry.envelope.packageId || receipt.payloadSha256 !== entry.payloadSha256) throw new Error("receipt_hash_mismatch");
  // The agent receipt is transport-only; never claim Admin visual verification here.
  return { packageId: state.serverPackageId, clientPackageId: entry.envelope.packageId, payloadSha256: entry.payloadSha256, state: receipt.state, visibilityVerified: false };
}
