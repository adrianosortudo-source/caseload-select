import "server-only";

import { applyGtaProspectOperatorImport, defaultGtaProspectImportSourceName, type GtaProspectOperatorImportReceipt } from "@/lib/gta-prospect-operator-import";
import { buildGtaProspectImportPlan, reviewGtaProspectImport, sha256, type CanonicalRecord, type GtaProspectImportReview, type GtaProspectImportReviewResult, type GtaProspectImportReviewSummary } from "@/lib/gta-prospect-research-import";
import { listGtaProspectResearchForOperator } from "@/lib/gta-prospect-research-reader";

const MAX_RECORDS = 2_000;
const ACTOR_PATTERN = /^[-_a-z0-9]{1,120}$/;
const IDEMPOTENCY_PATTERN = /^[-_A-Za-z0-9]{16,200}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRAFT_STATES = new Set(["ready_for_operator", "review_required", "applied"]);

type RpcError = { message?: string } | null;
export type GtaProspectAgentDraftInboxClient = {
  rpc: (functionName: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
};

export type GtaProspectAgentDraftState = "ready_for_operator" | "review_required" | "applied";
export type GtaProspectAgentDraftReceipt = Readonly<{
  state: "created" | "already_present";
  draftId: string;
  payloadSha256: string;
  review: { summary: GtaProspectImportReviewSummary; records: readonly GtaProspectImportReview[] };
}>;
export type GtaProspectAgentDraftListRow = Readonly<{
  draftId: string;
  sourceName: string;
  submittedBy: string;
  payloadSha256: string;
  recordCount: number;
  review: { summary: GtaProspectImportReviewSummary; records: readonly GtaProspectImportReview[] };
  state: GtaProspectAgentDraftState;
  createdAt: string;
  appliedAt: string | null;
}>;

/** A bounded, safe projection for one staged public-evidence record. */
export type GtaProspectAgentDraftRecordReview = Readonly<{
  draftId: string;
  sourceRecordKey: string;
  firmName: string | null;
  city: string | null;
  officeCities: readonly string[];
  websiteUrl: string | null;
  practiceAreas: readonly string[];
  observedLawyerCount: number | null;
  observedLawyerCountQualifier: "exact" | "at_least" | "unknown" | null;
  observedLawyerCountDisplay: string | null;
  reconciliationStatus: string | null;
  reviewSha256: string;
  disposition: GtaProspectImportReview["disposition"];
  reason: string;
  evidence: readonly Readonly<{ type: CanonicalRecord["evidence"][number]["type"]; sourceUrl: string; observedOn: string; value: string | null }>[];
  publicContacts: readonly Readonly<{ name: string | null; email: string | null; relationship: string; emailKind: string; sourceUrl: string; observedAt: string }>[];
}>;

/** Complete, bounded projection used to acknowledge one staged package. */
export type GtaProspectAgentDraftReviewManifest = Readonly<{
  draftId: string;
  reviewSha256: string;
  recordCount: number;
  records: readonly GtaProspectAgentDraftRecordReview[];
}>;

type StoredDraft = Readonly<{
  draftId: string;
  sourceName: string;
  payloadSha256: string;
  reviewSha256: string;
  importSourceSha256: string;
  recordCount: number;
  records: readonly unknown[];
  review: { summary: GtaProspectImportReviewSummary; records: readonly GtaProspectImportReview[] };
  state: GtaProspectAgentDraftState;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rpcError(error: RpcError, fallback: string): Error {
  return new Error(error?.message ?? fallback);
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseSummary(value: unknown): GtaProspectImportReviewSummary {
  if (!isObject(value)) throw new Error("The AI draft inbox returned an invalid review summary.");
  const received = number(value.received), eligibleForApply = number(value.eligibleForApply), created = number(value.new), update = number(value.update);
  const duplicate = number(value.duplicate), reviewRequired = number(value.reviewRequired), invalid = number(value.invalid);
  if ([received, eligibleForApply, created, update, duplicate, reviewRequired, invalid].some((item) => item === null)) throw new Error("The AI draft inbox returned an invalid review summary.");
  return { received: received!, eligibleForApply: eligibleForApply!, new: created!, update: update!, duplicate: duplicate!, reviewRequired: reviewRequired!, invalid: invalid! };
}

function parseReviews(value: unknown): readonly GtaProspectImportReview[] {
  if (!Array.isArray(value)) throw new Error("The AI draft inbox returned invalid review records.");
  return value.map((item) => {
    if (!isObject(item) || typeof item.sourceRecordKey !== "string" || typeof item.reason !== "string"
      || !["new", "update", "duplicate", "review_required", "invalid"].includes(String(item.disposition))) {
      throw new Error("The AI draft inbox returned invalid review records.");
    }
    return { sourceRecordKey: item.sourceRecordKey, reason: item.reason, disposition: item.disposition as GtaProspectImportReview["disposition"] };
  });
}

function stateForReview(summary: GtaProspectImportReviewSummary): Exclude<GtaProspectAgentDraftState, "applied"> {
  return summary.invalid || summary.duplicate || summary.reviewRequired ? "review_required" : "ready_for_operator";
}

async function currentReview(records: readonly unknown[]): Promise<GtaProspectImportReviewResult> {
  const existing = await listGtaProspectResearchForOperator();
  return reviewGtaProspectImport(records, new Set(existing.map((record) => record.id)));
}

async function clientOrDefault(client?: GtaProspectAgentDraftInboxClient): Promise<GtaProspectAgentDraftInboxClient> {
  if (client) return client;
  const { supabaseAdmin } = await import("@/lib/supabase-admin");
  return supabaseAdmin as unknown as GtaProspectAgentDraftInboxClient;
}

function parseStage(value: unknown): { state: "created" | "already_present"; draftId: string; payloadSha256: string } {
  if (!isObject(value) || (value.state !== "created" && value.state !== "already_present")
    || typeof value.draft_id !== "string" || typeof value.payload_sha256 !== "string") {
    throw new Error("The AI draft inbox did not return a valid staging receipt.");
  }
  return { state: value.state, draftId: value.draft_id, payloadSha256: value.payload_sha256 };
}

/** Accepts agent data into private staging only. It cannot import a prospect. */
export async function stageGtaProspectAgentDraft(input: Readonly<{
  submittedBy: string;
  sourceName: string;
  idempotencyKey: string;
  records: readonly unknown[];
  expectedPayloadSha256?: string;
  client?: GtaProspectAgentDraftInboxClient;
}>): Promise<GtaProspectAgentDraftReceipt> {
  if (!ACTOR_PATTERN.test(input.submittedBy)) throw new Error("submittedBy is invalid.");
  const sourceName = defaultGtaProspectImportSourceName(input.sourceName);
  if (!sourceName) throw new Error("sourceName is invalid.");
  if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) throw new Error("Idempotency-Key must use 16-200 letters, numbers, hyphens, or underscores.");
  if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > MAX_RECORDS) throw new Error(`Submit 1-${MAX_RECORDS.toLocaleString("en-CA")} records at a time.`);

  const payloadSha256 = await sha256(input.records);
  if (input.expectedPayloadSha256 && input.expectedPayloadSha256 !== payloadSha256) throw new Error("sourceSha256 does not match the submitted records.");
  const review = await currentReview(input.records);
  const reviewSha256 = await sha256(review.records);
  const state = stateForReview(review.summary);
  const db = await clientOrDefault(input.client);
  const result = await db.rpc("stage_gta_prospect_agent_import_draft", {
    p_submitted_by: input.submittedBy,
    p_source_name: sourceName,
    p_idempotency_key: input.idempotencyKey,
    p_payload_sha256: payloadSha256,
    p_review_sha256: reviewSha256,
    p_import_source_sha256: review.plan.sourceSha256,
    p_record_count: input.records.length,
    p_records: input.records,
    p_review_records: review.records,
    p_review_summary: review.summary,
    p_state: state,
  });
  if (result.error) throw rpcError(result.error, "The AI draft could not be staged.");
  const receipt = parseStage(result.data);
  return { ...receipt, review: { summary: review.summary, records: review.records } };
}

function parseListRow(value: unknown): GtaProspectAgentDraftListRow {
  if (!isObject(value) || typeof value.draft_id !== "string" || typeof value.source_name !== "string"
    || typeof value.submitted_by !== "string" || typeof value.payload_sha256 !== "string"
    || number(value.record_count) === null || typeof value.created_at !== "string"
    || (value.applied_at !== null && typeof value.applied_at !== "string") || typeof value.state !== "string" || !DRAFT_STATES.has(value.state)) {
    throw new Error("The AI draft inbox returned an invalid staged row.");
  }
  return {
    draftId: value.draft_id, sourceName: value.source_name, submittedBy: value.submitted_by,
    payloadSha256: value.payload_sha256, recordCount: number(value.record_count)!,
    review: { summary: parseSummary(value.review_summary), records: parseReviews(value.review_records) },
    state: value.state as GtaProspectAgentDraftState, createdAt: value.created_at, appliedAt: value.applied_at,
  };
}

export async function listGtaProspectAgentDraftsForOperator(client?: GtaProspectAgentDraftInboxClient): Promise<readonly GtaProspectAgentDraftListRow[]> {
  const result = await (await clientOrDefault(client)).rpc("list_gta_prospect_agent_import_drafts_for_operator", { p_limit: 100 });
  if (result.error) throw rpcError(result.error, "The AI draft inbox could not be loaded.");
  if (!Array.isArray(result.data)) throw new Error("The AI draft inbox returned an invalid list.");
  return result.data.map(parseListRow);
}

function parseStored(value: unknown): StoredDraft {
  if (!isObject(value) || typeof value.draftId !== "string" || typeof value.sourceName !== "string"
    || typeof value.payloadSha256 !== "string" || typeof value.reviewSha256 !== "string"
    || typeof value.importSourceSha256 !== "string" || number(value.recordCount) === null
    || !Array.isArray(value.records) || typeof value.state !== "string" || !DRAFT_STATES.has(value.state)) {
    throw new Error("The staged AI package is invalid.");
  }
  return {
    draftId: value.draftId, sourceName: value.sourceName, payloadSha256: value.payloadSha256,
    reviewSha256: value.reviewSha256, importSourceSha256: value.importSourceSha256,
    recordCount: number(value.recordCount)!, records: value.records,
    review: { summary: parseSummary(value.reviewSummary), records: parseReviews(value.reviewRecords) },
    state: value.state as GtaProspectAgentDraftState,
  };
}

function recordProjection(
  draftId: string,
  review: GtaProspectImportReview,
  canonical: CanonicalRecord | undefined,
): GtaProspectAgentDraftRecordReview {
  // A noncanonical record can contain arbitrary rejected source material. It
  // never receives a field-level projection, even when its key is valid.
  if (!canonical) return {
    draftId,
    sourceRecordKey: review.sourceRecordKey,
    firmName: null,
    city: null,
    officeCities: [],
    websiteUrl: null,
    practiceAreas: [],
    observedLawyerCount: null,
    observedLawyerCountQualifier: null,
    observedLawyerCountDisplay: null,
    reconciliationStatus: null,
    reviewSha256: "",
    disposition: review.disposition,
    reason: review.reason.slice(0, 600),
    evidence: [],
    publicContacts: [],
  };
  return {
    draftId,
    sourceRecordKey: review.sourceRecordKey,
    firmName: canonical.firmName.slice(0, 240),
    city: canonical.city.slice(0, 120),
    officeCities: canonical.officeCities.slice(0, 12).map((city) => city.slice(0, 120)),
    websiteUrl: canonical.websiteUrl?.slice(0, 2_000) ?? null,
    practiceAreas: canonical.practiceAreas.slice(0, 20).map((area) => area.slice(0, 120)),
    observedLawyerCount: canonical.roster.lawyerCount,
    observedLawyerCountQualifier: canonical.roster.qualifier,
    observedLawyerCountDisplay: canonical.roster.display?.slice(0, 240) ?? null,
    reconciliationStatus: canonical.reconciliation.status,
    reviewSha256: "",
    disposition: review.disposition,
    reason: review.reason.slice(0, 600),
    // Re-derived canonical evidence is the only evidence returned.
    evidence: canonical.evidence.slice(0, 4).map((evidence) => ({
      type: evidence.type,
      sourceUrl: evidence.sourceUrl,
      observedOn: evidence.observedOn,
      value: evidence.value?.slice(0, 240) ?? null,
    })),
    publicContacts: canonical.publicContacts.flatMap((contact) => contact.sourceUrl ? [{
      name: contact.name,
      email: contact.email,
      relationship: contact.relationship,
      emailKind: contact.emailKind,
      sourceUrl: contact.sourceUrl,
      observedAt: contact.observedAt,
    }] : []).slice(0, 8),
  };
}

/**
 * Loads the complete record manifest for one staged package. Each row is
 * bounded and projections for rejected rows are deliberately empty.
 */
export async function getGtaProspectAgentDraftReviewManifest(input: Readonly<{ draftId: string; client?: GtaProspectAgentDraftInboxClient }>): Promise<GtaProspectAgentDraftReviewManifest | null> {
  if (!UUID_PATTERN.test(input.draftId)) throw new Error("draftId must be a UUID.");
  const db = await clientOrDefault(input.client);
  const loaded = await db.rpc("read_gta_prospect_agent_import_draft_for_operator", { p_draft_id: input.draftId });
  if (loaded.error) throw rpcError(loaded.error, "The staged AI package could not be loaded.");
  if (loaded.data === null) return null;
  const draft = parseStored(loaded.data);
  if (draft.records.length > MAX_RECORDS || draft.review.records.length > MAX_RECORDS || draft.recordCount > MAX_RECORDS) {
    throw new Error("The staged AI package exceeds the review limit.");
  }
  const plan = await buildGtaProspectImportPlan(draft.records);
  const accepted = new Map(plan.accepted.map((record) => [record.sourceRecordKey, record]));
  const records = draft.review.records.map((review) => ({
    ...recordProjection(draft.draftId, review, accepted.get(review.sourceRecordKey)),
    reviewSha256: draft.reviewSha256,
  }));
  return { draftId: draft.draftId, reviewSha256: draft.reviewSha256, recordCount: records.length, records };
}

/**
 * Reads an existing staged package and returns one redacted review record.
 * It deliberately excludes raw contacts, idempotency keys, hashes, CRM state,
 * outreach state, and every other record in the package.
 */
export async function getGtaProspectAgentDraftRecordReview(input: Readonly<{ draftId: string; sourceRecordKey: string; client?: GtaProspectAgentDraftInboxClient }>): Promise<GtaProspectAgentDraftRecordReview | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,159}$/.test(input.sourceRecordKey)) throw new Error("sourceRecordKey is invalid.");
  const manifest = await getGtaProspectAgentDraftReviewManifest(input);
  return manifest?.records.find((record) => record.sourceRecordKey === input.sourceRecordKey) ?? null;
}

export type GtaProspectAgentDraftApplyResult =
  | Readonly<{ state: "applied" | "already_applied"; draftId: string; receipts: readonly GtaProspectOperatorImportReceipt[]; review: GtaProspectImportReviewSummary }>
  | Readonly<{ state: "review_changed"; draftId: string; review: GtaProspectImportReviewSummary }>;

/** Operator-only final gate. It rereads and rechecks a persisted draft before using the existing import writer. */
export async function applyGtaProspectAgentDraft(input: Readonly<{ draftId: string; reviewSha256?: string; client?: GtaProspectAgentDraftInboxClient }>): Promise<GtaProspectAgentDraftApplyResult> {
  if (!UUID_PATTERN.test(input.draftId)) throw new Error("draftId must be a UUID.");
  const db = await clientOrDefault(input.client);
  const loaded = await db.rpc("read_gta_prospect_agent_import_draft_for_operator", { p_draft_id: input.draftId });
  if (loaded.error) throw rpcError(loaded.error, "The staged AI package could not be loaded.");
  if (loaded.data === null) throw new Error("The staged AI package no longer exists.");
  const draft = parseStored(loaded.data);
  if (!input.reviewSha256 || input.reviewSha256 !== draft.reviewSha256) {
    return { state: "review_changed", draftId: draft.draftId, review: draft.review.summary };
  }
  if (draft.state === "applied") return { state: "already_applied", draftId: draft.draftId, receipts: [], review: draft.review.summary };

  const review = await currentReview(draft.records);
  const reviewSha256 = await sha256(review.records);
  const nextState = stateForReview(review.summary);
  if (reviewSha256 !== draft.reviewSha256 || nextState !== draft.state || review.plan.sourceSha256 !== draft.importSourceSha256) {
    const refreshed = await db.rpc("refresh_gta_prospect_agent_import_draft_review", {
      p_draft_id: draft.draftId, p_review_sha256: reviewSha256, p_import_source_sha256: review.plan.sourceSha256,
      p_review_records: review.records, p_review_summary: review.summary, p_state: nextState,
    });
    if (refreshed.error) throw rpcError(refreshed.error, "The staged AI package could not be refreshed.");
    return { state: "review_changed", draftId: draft.draftId, review: review.summary };
  }
  if (nextState !== "ready_for_operator") throw new Error("Resolve invalid, duplicate, or identity-review records before importing this AI draft.");

  const applied = await applyGtaProspectOperatorImport({ sourceName: draft.sourceName, plan: review.plan });
  const completed = await db.rpc("complete_gta_prospect_agent_import_draft", { p_draft_id: draft.draftId, p_apply_receipts: applied.receipts });
  if (completed.error) throw rpcError(completed.error, "The canonical import completed but the AI draft receipt could not be recorded.");
  return { state: applied.state, draftId: draft.draftId, receipts: applied.receipts, review: review.summary };
}
