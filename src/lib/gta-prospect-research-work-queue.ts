import "server-only";

import { createHash } from "node:crypto";

type RpcError = { message?: string } | null;

export type GtaProspectResearchWorkQueueClient = {
  rpc: (functionName: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
};

export const GTA_PROSPECT_RESEARCH_QUEUE_STATES = ["pending", "leased", "retry", "resolved"] as const;
export type GtaProspectResearchQueueState = typeof GTA_PROSPECT_RESEARCH_QUEUE_STATES[number];
export const GTA_PROSPECT_RESEARCH_QUEUE_RESOLUTIONS = [
  "imported",
  "already_present",
  "duplicate_or_identity_hold",
  "outside_plan41",
  "not_a_firm",
  "insufficient_evidence",
] as const;
export type GtaProspectResearchQueueResolution = typeof GTA_PROSPECT_RESEARCH_QUEUE_RESOLUTIONS[number];

export type GtaProspectResearchWorkSeedItem = Readonly<{
  sourceRecordKey: string;
  candidateName: string;
  canonicalDomain: string | null;
  candidateAddress: string | null;
  sourceUrls: readonly string[];
  priority: number;
  candidateSnapshot: Record<string, unknown>;
}>;

export type GtaProspectResearchWorkSeed = Readonly<{
  sourceSystem: string;
  sourceSha256: string;
  items: readonly GtaProspectResearchWorkSeedItem[];
}>;

export type GtaProspectResearchWorkItem = Readonly<{
  id: string;
  sourceSystem: string;
  sourceRecordKey: string;
  candidateName: string;
  canonicalDomain: string | null;
  candidateAddress: string | null;
  sourceUrls: readonly string[];
  candidateSnapshot: Readonly<Record<string, unknown>> | null;
  priority: number;
  state: GtaProspectResearchQueueState;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  resolution: GtaProspectResearchQueueResolution | null;
  canonicalFirmId: string | null;
}>;

export type GtaProspectResearchWorkQueueSummary = Readonly<{
  counts: Readonly<Record<GtaProspectResearchQueueState, number>>;
  items: readonly GtaProspectResearchWorkItem[];
}>;

const SOURCE_SYSTEM_PATTERN = /^[-_a-z0-9]{1,120}$/;
const WORKER_PATTERN = /^[-_a-z0-9]{1,120}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function rpcError(error: RpcError, fallback: string): Error {
  return new Error(error?.message ?? fallback);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw new Error(`${name} must be a non-empty string up to ${maxLength} characters.`);
  return value.trim();
}

function requireUrl(value: unknown, name: string): string {
  const text = requireText(value, name, 2_000);
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`${name} must be an absolute URL.`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must use http or https.`);
  return url.toString();
}

function requireCanonicalDomain(value: unknown, name: string): string {
  const text = requireText(value, name, 253).toLocaleLowerCase("en-CA");
  if (/\s|[\\/:?@#]/.test(text) || text.endsWith(".")) throw new Error(`${name} must be a canonical hostname, not a URL.`);
  let parsed: URL;
  try { parsed = new URL(`http://${text}`); } catch { throw new Error(`${name} must be a valid hostname.`); }
  const hostname = parsed.hostname.toLocaleLowerCase("en-CA").replace(/^www\./, "");
  if (!hostname || parsed.port || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || hostname !== text.replace(/^www\./, "")) {
    throw new Error(`${name} must be a canonical hostname without www, a port, or a path.`);
  }
  return hostname;
}

function parseState(value: unknown): GtaProspectResearchQueueState {
  if (typeof value !== "string" || !GTA_PROSPECT_RESEARCH_QUEUE_STATES.includes(value as GtaProspectResearchQueueState)) throw new Error("Queue RPC returned an invalid state.");
  return value as GtaProspectResearchQueueState;
}

function parseResolution(value: unknown): GtaProspectResearchQueueResolution | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !GTA_PROSPECT_RESEARCH_QUEUE_RESOLUTIONS.includes(value as GtaProspectResearchQueueResolution)) throw new Error("Queue RPC returned an invalid resolution.");
  return value as GtaProspectResearchQueueResolution;
}

function parseItem(value: unknown): GtaProspectResearchWorkItem {
  if (!isObject(value)) throw new Error("Queue RPC returned a non-object work item.");
  const sourceUrls = value.source_urls;
  if (!Array.isArray(sourceUrls) || sourceUrls.some((url) => typeof url !== "string")) throw new Error("Queue RPC returned invalid source URLs.");
  const nullableText = (field: string, maxLength: number) => {
    const candidate = value[field];
    if (candidate === null || candidate === undefined) return null;
    return requireText(candidate, `Queue item ${field}`, maxLength);
  };
  const priority = value.priority;
  const attemptCount = value.attempt_count;
  if (typeof value.id !== "string" || typeof value.source_system !== "string" || typeof value.source_record_key !== "string" || typeof value.candidate_name !== "string" || typeof priority !== "number" || !Number.isInteger(priority) || typeof attemptCount !== "number" || !Number.isInteger(attemptCount)) {
    throw new Error("Queue RPC returned a malformed work item.");
  }
  const candidateSnapshot = isObject(value.candidate_snapshot) ? Object.freeze(value.candidate_snapshot) : null;
  return {
    id: value.id,
    sourceSystem: value.source_system,
    sourceRecordKey: value.source_record_key,
    candidateName: value.candidate_name,
    canonicalDomain: nullableText("canonical_domain", 253),
    candidateAddress: nullableText("candidate_address", 1_000),
    sourceUrls: Object.freeze(sourceUrls.map((url) => requireUrl(url, "Queue item source URL"))),
    candidateSnapshot,
    priority,
    state: parseState(value.state),
    leaseOwner: nullableText("lease_owner", 120),
    leaseExpiresAt: nullableText("lease_expires_at", 64),
    attemptCount,
    nextAttemptAt: nullableText("next_attempt_at", 64),
    lastError: nullableText("last_error", 2_000),
    resolution: parseResolution(value.resolution),
    canonicalFirmId: nullableText("canonical_firm_id", 64),
  };
}

export function stableGtaProspectResearchQueueJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableGtaProspectResearchQueueJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableGtaProspectResearchQueueJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function sha256GtaProspectResearchQueue(value: unknown): string {
  return createHash("sha256").update(stableGtaProspectResearchQueueJson(value)).digest("hex");
}

export function validateGtaProspectResearchWorkSeed(value: unknown): GtaProspectResearchWorkSeed {
  if (!isObject(value)) throw new Error("Queue seed must be an object.");
  const sourceSystem = requireText(value.sourceSystem, "sourceSystem", 120).toLocaleLowerCase("en-CA");
  if (!SOURCE_SYSTEM_PATTERN.test(sourceSystem)) throw new Error("sourceSystem must use lowercase letters, numbers, hyphens, or underscores.");
  const sourceSha256 = requireText(value.sourceSha256, "sourceSha256", 64).toLocaleLowerCase("en-CA");
  if (!SHA256_PATTERN.test(sourceSha256)) throw new Error("sourceSha256 must be a lowercase SHA-256 digest.");
  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > 2_000) throw new Error("Queue seed must contain 1 to 2,000 items.");
  const keys = new Set<string>();
  const items = value.items.map((raw, index): GtaProspectResearchWorkSeedItem => {
    if (!isObject(raw)) throw new Error(`items[${index}] must be an object.`);
    const sourceRecordKey = requireText(raw.sourceRecordKey, `items[${index}].sourceRecordKey`, 240);
    if (keys.has(sourceRecordKey)) throw new Error(`Queue seed has a duplicate sourceRecordKey: ${sourceRecordKey}.`);
    keys.add(sourceRecordKey);
    const candidateName = requireText(raw.candidateName, `items[${index}].candidateName`, 500);
    const canonicalDomain = raw.canonicalDomain === null || raw.canonicalDomain === undefined || raw.canonicalDomain === "" ? null : requireCanonicalDomain(raw.canonicalDomain, `items[${index}].canonicalDomain`);
    const candidateAddress = raw.candidateAddress === null || raw.candidateAddress === undefined || raw.candidateAddress === "" ? null : requireText(raw.candidateAddress, `items[${index}].candidateAddress`, 1_000);
    if (!Array.isArray(raw.sourceUrls) || raw.sourceUrls.length === 0 || raw.sourceUrls.length > 12) throw new Error(`items[${index}].sourceUrls must contain 1 to 12 URLs.`);
    const sourceUrls = [...new Set(raw.sourceUrls.map((url, urlIndex) => requireUrl(url, `items[${index}].sourceUrls[${urlIndex}]`)))].sort();
    if (!Number.isInteger(raw.priority) || raw.priority < 0 || raw.priority > 10_000) throw new Error(`items[${index}].priority must be an integer from 0 to 10,000.`);
    if (!isObject(raw.candidateSnapshot)) throw new Error(`items[${index}].candidateSnapshot must be an object.`);
    return Object.freeze({ sourceRecordKey, candidateName, canonicalDomain, candidateAddress, sourceUrls: Object.freeze(sourceUrls), priority: raw.priority, candidateSnapshot: raw.candidateSnapshot });
  });
  return Object.freeze({ sourceSystem, sourceSha256, items: Object.freeze(items) });
}

export type GtaProspectResearchQueueSeedReceipt = Readonly<{ state: "seeded" | "already_seeded"; itemCount: number; inserted: number; alreadySeeded: number }>;

function parseSeedReceipt(value: unknown): GtaProspectResearchQueueSeedReceipt {
  if (!isObject(value) || (value.state !== "seeded" && value.state !== "already_seeded") || !Number.isInteger(value.item_count) || !Number.isInteger(value.inserted) || !Number.isInteger(value.already_seeded)) throw new Error("Queue seed RPC returned an invalid receipt.");
  if (value.inserted < 0 || value.already_seeded < 0 || value.inserted + value.already_seeded !== value.item_count) throw new Error("Queue seed RPC returned inconsistent counts.");
  return { state: value.state, itemCount: value.item_count, inserted: value.inserted, alreadySeeded: value.already_seeded };
}

export async function seedGtaProspectResearchWorkQueue({ seed, client }: Readonly<{ seed: GtaProspectResearchWorkSeed; client?: GtaProspectResearchWorkQueueClient }>): Promise<GtaProspectResearchQueueSeedReceipt> {
  const validated = validateGtaProspectResearchWorkSeed(seed);
  const db = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectResearchWorkQueueClient;
  })();
  const response = await db.rpc("seed_gta_prospect_research_work_items", {
    p_source_system: validated.sourceSystem,
    p_payload_sha256: validated.sourceSha256,
    p_items: validated.items.map((item) => ({
      source_record_key: item.sourceRecordKey,
      candidate_name: item.candidateName,
      canonical_domain: item.canonicalDomain,
      candidate_address: item.candidateAddress,
      source_urls: item.sourceUrls,
      priority: item.priority,
      candidate_snapshot: item.candidateSnapshot,
    })),
  });
  if (response.error) throw rpcError(response.error, "Could not seed the GTA prospect research queue.");
  return parseSeedReceipt(response.data);
}

export async function claimGtaProspectResearchWorkItems({ workerId, limit, leaseMinutes = 120, client }: Readonly<{ workerId: string; limit: number; leaseMinutes?: number; client?: GtaProspectResearchWorkQueueClient }>): Promise<readonly GtaProspectResearchWorkItem[]> {
  const normalizedWorker = requireText(workerId, "workerId", 120).toLocaleLowerCase("en-CA");
  if (!WORKER_PATTERN.test(normalizedWorker)) throw new Error("workerId must use lowercase letters, numbers, hyphens, or underscores.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("limit must be an integer from 1 to 25.");
  if (!Number.isInteger(leaseMinutes) || leaseMinutes < 15 || leaseMinutes > 480) throw new Error("leaseMinutes must be an integer from 15 to 480.");
  const db = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectResearchWorkQueueClient;
  })();
  const response = await db.rpc("claim_gta_prospect_research_work_items", { p_worker_id: normalizedWorker, p_limit: limit, p_lease_minutes: leaseMinutes });
  if (response.error) throw rpcError(response.error, "Could not claim GTA prospect research work items.");
  if (!Array.isArray(response.data)) throw new Error("Queue claim RPC returned an invalid payload.");
  return Object.freeze(response.data.map(parseItem));
}

function requireLeaseAction(value: unknown, name: string): string {
  return requireText(value, name, 120).toLocaleLowerCase("en-CA");
}

export async function resolveGtaProspectResearchWorkItem({ itemId, workerId, resolution, note, canonicalFirmId = null, client }: Readonly<{ itemId: string; workerId: string; resolution: GtaProspectResearchQueueResolution; note: string; canonicalFirmId?: string | null; client?: GtaProspectResearchWorkQueueClient }>): Promise<void> {
  const normalizedWorker = requireLeaseAction(workerId, "workerId");
  if (!WORKER_PATTERN.test(normalizedWorker)) throw new Error("workerId must use lowercase letters, numbers, hyphens, or underscores.");
  if (!GTA_PROSPECT_RESEARCH_QUEUE_RESOLUTIONS.includes(resolution)) throw new Error("resolution is invalid.");
  const needsFirmId = resolution === "imported" || resolution === "already_present";
  if (needsFirmId !== Boolean(canonicalFirmId)) throw new Error("canonicalFirmId is required only for imported or already_present resolutions.");
  if (canonicalFirmId && !UUID_PATTERN.test(canonicalFirmId)) throw new Error("canonicalFirmId must be a UUID.");
  const db = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectResearchWorkQueueClient;
  })();
  const response = await db.rpc("resolve_gta_prospect_research_work_item", { p_item_id: requireText(itemId, "itemId", 64), p_worker_id: normalizedWorker, p_resolution: resolution, p_note: requireText(note, "note", 2_000), p_canonical_firm_id: canonicalFirmId });
  if (response.error) throw rpcError(response.error, "Could not resolve GTA prospect research work item.");
}

export async function renewGtaProspectResearchWorkItemLease({ itemId, workerId, leaseMinutes = 120, client }: Readonly<{ itemId: string; workerId: string; leaseMinutes?: number; client?: GtaProspectResearchWorkQueueClient }>): Promise<string> {
  const normalizedWorker = requireLeaseAction(workerId, "workerId");
  if (!WORKER_PATTERN.test(normalizedWorker)) throw new Error("workerId must use lowercase letters, numbers, hyphens, or underscores.");
  if (!Number.isInteger(leaseMinutes) || leaseMinutes < 15 || leaseMinutes > 480) throw new Error("leaseMinutes must be an integer from 15 to 480.");
  const db = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectResearchWorkQueueClient;
  })();
  const response = await db.rpc("renew_gta_prospect_research_work_item_lease", { p_item_id: requireText(itemId, "itemId", 64), p_worker_id: normalizedWorker, p_lease_minutes: leaseMinutes });
  if (response.error) throw rpcError(response.error, "Could not renew GTA prospect research work item lease.");
  return requireText(response.data, "Queue lease expiry", 64);
}

export async function deferGtaProspectResearchWorkItem({ itemId, workerId, error, retryAt, client }: Readonly<{ itemId: string; workerId: string; error: string; retryAt: string; client?: GtaProspectResearchWorkQueueClient }>): Promise<void> {
  const normalizedWorker = requireLeaseAction(workerId, "workerId");
  if (!WORKER_PATTERN.test(normalizedWorker)) throw new Error("workerId must use lowercase letters, numbers, hyphens, or underscores.");
  if (!ISO_TIMESTAMP_PATTERN.test(retryAt)) throw new Error("retryAt must be an ISO timestamp with a timezone.");
  const db = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectResearchWorkQueueClient;
  })();
  const response = await db.rpc("defer_gta_prospect_research_work_item", { p_item_id: requireText(itemId, "itemId", 64), p_worker_id: normalizedWorker, p_error: requireText(error, "error", 2_000), p_retry_at: retryAt });
  if (response.error) throw rpcError(response.error, "Could not defer GTA prospect research work item.");
}

export async function listGtaProspectResearchWorkQueue({ limit = 50, offset = 0, client }: Readonly<{ limit?: number; offset?: number; client?: GtaProspectResearchWorkQueueClient }> = {}): Promise<GtaProspectResearchWorkQueueSummary> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be an integer from 1 to 100.");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new Error("offset must be an integer from 0 to 100,000.");
  const db = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectResearchWorkQueueClient;
  })();
  const response = await db.rpc("list_gta_prospect_research_work_queue_for_operator", { p_limit: limit, p_offset: offset });
  if (response.error) throw rpcError(response.error, "Could not read GTA prospect research queue.");
  if (!isObject(response.data) || !isObject(response.data.counts) || !Array.isArray(response.data.items)) throw new Error("Queue listing RPC returned an invalid payload.");
  const counts = Object.fromEntries(GTA_PROSPECT_RESEARCH_QUEUE_STATES.map((state) => {
    const count = response.data.counts[state];
    if (!Number.isInteger(count) || count < 0) throw new Error("Queue listing RPC returned invalid counts.");
    return [state, count];
  })) as Record<GtaProspectResearchQueueState, number>;
  return Object.freeze({ counts: Object.freeze(counts), items: Object.freeze(response.data.items.map(parseItem)) });
}
