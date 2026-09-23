import "server-only";

import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  buildProspectEnrichmentClientItems,
  PROSPECT_ENRICHMENT_MAX_ITEMS,
  type ProspectEnrichmentAssessment,
  type ProspectEnrichmentEnvelope,
  type ProspectEnrichmentObservation,
  type ProspectEnrichmentSource,
} from "@/lib/prospect-enrichment-contract";
import {
  prospectEnrichmentIdempotencyKey,
  prospectEnrichmentPayloadSha256,
  prospectEnrichmentSha256,
} from "@/lib/prospect-enrichment-hash";

type DatabaseError = Readonly<{ code?: string; message?: string }>;
export type ProspectEnrichmentStoreClient = Pick<typeof supabaseAdmin, "from" | "rpc">;

export class ProspectEnrichmentStoreError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 | 422 | 503 = 503,
    readonly code = "prospect_enrichment_store_error",
  ) {
    super(message);
    this.name = "ProspectEnrichmentStoreError";
  }
}

export type ProspectEnrichmentItemInput = Readonly<{
  clientItemId: string;
  itemKind: string;
  sourceEventKey: string;
  semanticSha256: string;
  data: unknown;
  sourceIds: readonly string[];
  observedAt: string | null;
  observedOn: string | null;
  provenanceState: "complete" | "partial" | "legacy_unknown";
}>;

export type ProspectEnrichmentSourceInput = Readonly<{
  sourceId: string;
  clientItemId: string;
  sourceEventKey: string;
  semanticSha256: string;
  data: ProspectEnrichmentSource;
  observedAt: string | null;
  observedOn: string | null;
  provenanceState: "complete" | "partial" | "legacy_unknown";
}>;

export type ProspectEnrichmentStageReceipt = Readonly<{
  outcome: "created" | "replayed";
  packageId: string;
  clientPackageId: string;
  runId: string;
  payloadSha256: string;
  state: "received" | "identity_hold" | "evidence_hold" | "ready_for_review" | "applied" | "rejected" | "superseded";
  identityState: "resolved" | "unresolved" | "conflict";
  counts: Readonly<{ sources: number; observations: number; assessments: number; items: number }>;
  receivedAt: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRpcRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return isRecord(value[0]) ? value[0] : null;
  return isRecord(value) ? value : null;
}

function mapRpcError(error: DatabaseError | null, operation: string): never {
  if (error?.code === "23505" || error?.code === "P0001") {
    throw new ProspectEnrichmentStoreError("The package conflicts with an existing research record.", 409, "conflict");
  }
  if (error?.code === "PGRST116") {
    throw new ProspectEnrichmentStoreError("The requested research record was not found.", 404, "not_found");
  }
  console.error("[prospect-enrichment] database operation failed", { operation, databaseCode: error?.code ?? "unknown" });
  throw new ProspectEnrichmentStoreError("Prospect research could not be saved or loaded.", 503, "database_unavailable");
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProspectEnrichmentStoreError(`The database did not return ${field}.`, 503, "invalid_database_receipt");
  }
  return value;
}

function itemProvenance(source: ProspectEnrichmentSource): "complete" | "partial" | "legacy_unknown" {
  if (source.policyState === "legacy-unknown" || source.retrievalMethod === "legacy-unknown" || source.retrievalOutcome === "legacy-unknown") return "legacy_unknown";
  if (source.missingProvenanceReason || source.policyState === "policy-blocked") return "partial";
  return "complete";
}

const PACKAGE_STATE = new Set(["received", "identity_hold", "evidence_hold", "ready_for_review", "applied", "rejected", "superseded"]);
const IDENTITY_STATE = new Set(["resolved", "unresolved", "conflict"]);
const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function receiptCount(value: Record<string, unknown>, key: string, expected: number): number {
  const actual = value[key];
  if (typeof actual !== "number" || !Number.isSafeInteger(actual) || actual !== expected) {
    throw new ProspectEnrichmentStoreError("The database returned inconsistent package item counts.", 503, "invalid_database_receipt");
  }
  return actual;
}

function sourceInput(source: ProspectEnrichmentSource, lineage: ReturnType<typeof buildProspectEnrichmentClientItems>[number]): ProspectEnrichmentSourceInput {
  return {
    sourceId: source.sourceId,
    clientItemId: lineage.clientItemId,
    sourceEventKey: lineage.sourceEventKey,
    semanticSha256: lineage.semanticSha256,
    data: source,
    observedAt: source.observedAt,
    observedOn: source.observedOn,
    provenanceState: itemProvenance(source),
  };
}

function observationInput(observation: ProspectEnrichmentObservation, lineage: ReturnType<typeof buildProspectEnrichmentClientItems>[number]): ProspectEnrichmentItemInput {
  return {
    clientItemId: lineage.clientItemId,
    itemKind: lineage.itemKind,
    sourceEventKey: lineage.sourceEventKey,
    semanticSha256: lineage.semanticSha256,
    data: observation,
    sourceIds: observation.sourceIds,
    observedAt: observation.observedAt,
    observedOn: observation.observedOn,
    provenanceState: observation.missingProvenanceReason ? "partial" : "complete",
  };
}

function assessmentInput(assessment: ProspectEnrichmentAssessment, lineage: ReturnType<typeof buildProspectEnrichmentClientItems>[number]): ProspectEnrichmentItemInput {
  return {
    clientItemId: lineage.clientItemId,
    itemKind: lineage.itemKind,
    sourceEventKey: lineage.sourceEventKey,
    semanticSha256: lineage.semanticSha256,
    data: assessment,
    sourceIds: assessment.sourceIds,
    observedAt: assessment.assessedAt,
    observedOn: assessment.assessedOn,
    provenanceState: assessment.missingProvenanceReason ? "partial" : "complete",
  };
}

export function buildProspectEnrichmentItemInputs(envelope: ProspectEnrichmentEnvelope): Readonly<{
  items: readonly ProspectEnrichmentItemInput[];
  sources: readonly ProspectEnrichmentSourceInput[];
}> {
  const lineageItems = buildProspectEnrichmentClientItems(envelope);
  const lineageByClientId = new Map(lineageItems.map((item) => [item.clientItemId, item]));
  const items = [
    ...envelope.observations.map((item) => observationInput(item, lineageByClientId.get(`obs:${item.observationId}`)!)),
    ...(envelope.assessment ? [assessmentInput(envelope.assessment, lineageByClientId.get(`assessment:${envelope.assessment.assessmentId}`)!)] : []),
  ];
  const sources = envelope.sources.map((source) => sourceInput(source, lineageByClientId.get(`src:${source.sourceId}`)!));
  const itemIds = [...sources.map((item) => item.clientItemId), ...items.map((item) => item.clientItemId)];
  if (items.length > PROSPECT_ENRICHMENT_MAX_ITEMS + 1 || sources.length > PROSPECT_ENRICHMENT_MAX_ITEMS) {
    throw new ProspectEnrichmentStoreError("A package cannot contain more than 500 sources, 500 observations, and one assessment.", 422, "too_many_items");
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw new ProspectEnrichmentStoreError("Research item identifiers must be unique within a package.", 422, "duplicate_item_id");
  }
  return { items, sources };
}

export async function stageProspectEnrichmentPackage(input: Readonly<{
  submittedBy: string;
  rawBody: string;
  envelope: ProspectEnrichmentEnvelope;
  client?: ProspectEnrichmentStoreClient;
}>): Promise<ProspectEnrichmentStageReceipt> {
  const client = input.client ?? supabaseAdmin;
  const envelope = input.envelope;
  const { items, sources } = buildProspectEnrichmentItemInputs(envelope);
  const payloadSha256 = prospectEnrichmentPayloadSha256(envelope);
  const idempotencyKey = prospectEnrichmentIdempotencyKey(envelope.sourceSystem, envelope.runId, envelope.packageId);
  const { data, error } = await client.rpc("stage_prospect_enrichment_package_v1", {
    p_submitted_by: input.submittedBy,
    p_run_key: envelope.runId,
    p_source_system: envelope.sourceSystem,
    p_source_name: envelope.sourceName,
    p_client_package_id: envelope.packageId,
    p_idempotency_key: idempotencyKey,
    p_raw_body: input.rawBody,
    p_raw_body_sha256: prospectEnrichmentSha256(input.rawBody),
    p_payload: envelope,
    p_payload_sha256: payloadSha256,
    p_research_key: envelope.subject.researchKey,
    p_identity_state: envelope.subject.identityState,
    p_items: items,
    p_sources: sources,
    p_supersedes_package_id: envelope.supersedesPackageId,
  });
  if (error) mapRpcError(error, "stage_package");

  const receipt = firstRpcRecord(data);
  if (!receipt) throw new ProspectEnrichmentStoreError("The database did not return a package receipt.", 503, "invalid_database_receipt");
  const outcome = receipt.outcome;
  if (outcome === "run_conflict" || outcome === "package_conflict" || outcome === "idempotency_conflict" || outcome === "source_event_conflict") {
    throw new ProspectEnrichmentStoreError("This research package conflicts with an existing immutable record.", 409, String(outcome));
  }
  if (outcome !== "created" && outcome !== "replayed") {
    throw new ProspectEnrichmentStoreError("The research package could not be staged.", 503, "stage_failed");
  }
  const rawCounts = isRecord(receipt.counts) ? receipt.counts : {};
  const receivedPackageId = requiredText(receipt.packageId, "packageId");
  const receivedClientPackageId = requiredText(receipt.clientPackageId, "clientPackageId");
  const receivedRunId = requiredText(receipt.runId, "runId");
  const receivedPayloadSha256 = requiredText(receipt.payloadSha256, "payloadSha256");
  const receivedState = requiredText(receipt.state, "state");
  const receivedIdentityState = requiredText(receipt.identityState, "identityState");
  const receivedAt = requiredText(receipt.receivedAt, "receivedAt");
  const expectedAssessmentCount = envelope.assessment ? 1 : 0;
  const expectedItemCount = sources.length + items.length;
  if (!DATABASE_UUID.test(receivedPackageId) || receivedClientPackageId !== envelope.packageId
    || receivedRunId !== envelope.runId || receivedPayloadSha256 !== payloadSha256
    || !PACKAGE_STATE.has(receivedState) || !IDENTITY_STATE.has(receivedIdentityState)
    || receivedIdentityState !== envelope.subject.identityState || !Number.isFinite(Date.parse(receivedAt))) {
    throw new ProspectEnrichmentStoreError("The database returned a package receipt that does not match this submission.", 503, "invalid_database_receipt");
  }
  const counts = {
    sources: receiptCount(rawCounts, "sources", sources.length),
    observations: receiptCount(rawCounts, "observations", envelope.observations.length),
    assessments: receiptCount(rawCounts, "assessments", expectedAssessmentCount),
    items: receiptCount(rawCounts, "items", expectedItemCount),
  };
  return {
    outcome,
    packageId: receivedPackageId,
    clientPackageId: receivedClientPackageId,
    runId: receivedRunId,
    payloadSha256: receivedPayloadSha256,
    state: receivedState as ProspectEnrichmentStageReceipt["state"],
    identityState: receivedIdentityState as ProspectEnrichmentStageReceipt["identityState"],
    counts,
    receivedAt,
  };
}

export type ProspectEnrichmentDatabaseRow = Record<string, unknown>;

export async function getProspectEnrichmentOperatorReceipt(input: Readonly<{
  packageId: string;
  submittedBy: string;
  client?: ProspectEnrichmentStoreClient;
}>): Promise<Readonly<Record<string, unknown>> | null> {
  const client = input.client ?? supabaseAdmin;
  const { data: packageRow, error } = await client.from("prospect_enrichment_packages")
    .select("id,run_id,client_package_id,payload_sha256,state,identity_state,created_at,updated_at,applied_at")
    .eq("id", input.packageId)
    .eq("submitted_by", input.submittedBy)
    .maybeSingle();
  if (error) mapRpcError(error, "read_agent_receipt");
  if (!packageRow || !isRecord(packageRow)) return null;

  const { data: itemRows, error: itemError } = await client.from("prospect_enrichment_items")
    .select("item_kind,provenance_state")
    .eq("package_id", input.packageId)
    .limit(PROSPECT_ENRICHMENT_MAX_ITEMS * 2 + 2);
  if (itemError) mapRpcError(itemError, "count_agent_receipt_items");
  const values = Array.isArray(itemRows) ? itemRows.filter(isRecord) : [];
  if (values.length > PROSPECT_ENRICHMENT_MAX_ITEMS * 2 + 1) throw new ProspectEnrichmentStoreError("The stored package exceeds the supported item count.", 503, "invalid_database_receipt");
  const counts = {
    sources: values.filter((row) => row.item_kind === "source").length,
    observations: values.filter((row) => row.item_kind !== "source" && row.item_kind !== "assessment").length,
    assessments: values.filter((row) => row.item_kind === "assessment").length,
    items: values.length,
  };
  return {
    packageId: packageRow.id,
    clientPackageId: packageRow.client_package_id,
    runId: packageRow.run_id,
    payloadSha256: packageRow.payload_sha256,
    state: packageRow.state,
    identityState: packageRow.identity_state,
    counts,
    receivedAt: packageRow.created_at,
    updatedAt: packageRow.updated_at,
    appliedAt: packageRow.applied_at,
  };
}
