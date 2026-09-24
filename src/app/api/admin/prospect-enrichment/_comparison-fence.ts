import type { ComparisonExportInput } from "../../../../../scripts/prospect-enrichment/comparison-export";
import { prospectEnrichmentProtocolHash as hash } from "@/lib/prospect-enrichment-hash";
import type { ProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import { readPackageDetail, type ReadDatabase } from "./_package-read";
import { databaseRows, isRecord, ReadApiError, READ_UUID } from "./_read-common";
import { PROTECTED_GTA_TARGET_TABLES, readProtectedGtaTargetRows } from "./_protected-target-read";

const MAX_FINAL_FENCE_EVENTS = 10_000;
const MAX_FINAL_FENCE_ITEMS = 50_000;
const MAX_FINAL_FENCE_PACKAGES = 1_000;
const MAX_FINAL_FENCE_TARGETS = 50_000;
const TARGET_TABLES = new Set([
  "gta_prospect_firms", "gta_prospect_stable_identity_registry", "gta_prospect_import_audit",
  "gta_prospect_supplemental_evidence_import_audit", "gta_prospect_shared_identity_observations",
  "gta_prospect_website_intake_observations", "gta_prospect_qualification_assessments",
  "gta_prospect_roster_observations", "gta_prospect_downtown_geography_observations",
  "gta_prospect_public_contact_observations", "prospect_source_record_map", "prospect_source_captures",
  "prospect_research_attempts", "prospect_advertising_observations", "prospect_qualification_decisions",
  "prospect_firm_fit_observations", "prospect_service_observations", "prospect_decision_maker_contacts",
  "prospect_opportunity_observations",
]);

type PackageDetail = Awaited<ReturnType<typeof readPackageDetail>>;
type EventItems = { eventId: string; items: Record<string, unknown>[] };
type EventPresence = { key: string; rows: { id: unknown; sourceSystem: unknown; semanticSha256: unknown }[] };
export type ComparisonFenceBaseline = {
  adminRunId: string;
  actor: string;
  sourceSystem: string;
  expectedPackageCount: number;
  requestedPackageIds: string[];
  expectedEventKeys: string[];
  runPackages: Record<string, unknown>[];
  actorPackages: Record<string, unknown>[];
  eventPresence: EventPresence[];
  eventItems: EventItems[];
  packageDetails: PackageDetail[];
  identities: ComparisonExportInput["identities"];
  snapshot: ComparisonExportInput;
};

function fail(): never { throw new ReadApiError("Admin research changed during the final comparison check. Retry the read.", 503); }
function same(left: unknown, right: unknown): boolean { return hash(left) === hash(right); }
function ordered<T>(values: T[], key: (value: T) => string): T[] { return [...values].sort((a, b) => key(a).localeCompare(key(b))); }
function runPackageProjection(row: Record<string, unknown>) {
  return { id: row.id, runId: row.run_id, actor: row.submitted_by, clientPackageId: row.client_package_id,
    researchKey: row.research_key, payloadSha256: row.payload_sha256, state: row.state, firmId: row.firm_id,
    rawBodySha256: row.raw_body_sha256, reviewJson: row.review_json, reviewSha256: row.review_sha256,
    expectedRevisionSha256: row.expected_revision_sha256, reviewExpiresAt: row.review_expires_at, applyReceipt: row.apply_receipt };
}
function actorPackageProjection(row: Record<string, unknown>) {
  return { id: row.id, runId: row.run_id, clientPackageId: row.client_package_id, researchKey: row.research_key,
    payloadSha256: row.payload_sha256, state: row.state };
}
function eventProjection(row: Record<string, unknown>) {
  return { id: row.id, sourceSystem: row.source_system, sourceEventKey: row.source_event_key, semanticSha256: row.semantic_sha256 };
}
function itemProjection(row: Record<string, unknown>) {
  return { id: row.id, packageId: row.package_id, sourceEventId: row.source_event_id,
    clientItemId: row.client_item_id, itemKind: row.item_kind, data: row.data,
    sourceIds: row.source_ids, normalizedSha256: row.normalized_sha256 };
}
function packageDetailProjection(detail: PackageDetail) {
  return {
    packageId: detail.packageId, clientPackageId: detail.clientPackageId, payloadSha256: detail.payloadSha256,
    payloadHash: hash(detail.payload), state: detail.state, firmId: detail.firmId,
    reviewJsonHash: hash(detail.reviewJson), reviewSha256: detail.reviewSha256,
    expectedRevisionSha256: detail.expectedRevisionSha256, reviewExpiresAt: detail.reviewExpiresAt,
    receiptHash: hash(detail.receipt), rawBodySha256: detail.rawBodySha256,
    items: ordered(detail.items.map((item) => ({
      itemId: item.itemId, clientItemId: item.clientItemId, itemKind: item.itemKind,
      sourceEventId: item.sourceEventId, dataHash: hash(item.data), sourceIds: item.sourceIds, hash: item.hash,
      targets: ordered(item.targets.map((target) => {
        if (!isRecord(target) || typeof target.item_id !== "string" || typeof target.target_table !== "string" ||
            typeof target.target_id !== "string" || typeof target.target_row_sha256 !== "string" ||
            typeof target.application_kind !== "string" || typeof target.linked_at !== "string") fail();
        return { itemId: target.item_id, table: target.target_table, id: target.target_id,
          rowSha256: target.target_row_sha256, applicationKind: target.application_kind, linkedAt: target.linked_at };
      }), (target) => target.table + ":" + target.id),
      firmRevision: isRecord(item.currentValue) ? item.currentValue.firmRevision : null,
    })), (item) => item.itemId),
  };
}

/** Re-read the exact identifiers in the second snapshot after its expensive evidence reads, just before signing. */
export async function verifyComparisonFinalFence(input: {
  baseline: ComparisonFenceBaseline;
  client: ReadDatabase;
  envelopes: readonly ProspectEnrichmentEnvelope[];
  readIdentity: (envelopes: readonly ProspectEnrichmentEnvelope[], client: ReadDatabase) => Promise<ComparisonExportInput["identities"]>;
}): Promise<void> {
  const { baseline, client } = input;
  if (baseline.expectedEventKeys.length > MAX_FINAL_FENCE_EVENTS || baseline.eventItems.length > MAX_FINAL_FENCE_EVENTS || baseline.packageDetails.length > MAX_FINAL_FENCE_PACKAGES ||
      baseline.eventItems.reduce((total, item) => total + item.items.length, 0) > MAX_FINAL_FENCE_ITEMS) fail();

  const runRows = databaseRows(await client.from("prospect_enrichment_packages")
    .select("id,run_id,client_package_id,submitted_by,research_key,payload,payload_sha256,state,firm_id,raw_body_sha256,review_json,review_sha256,expected_revision_sha256,review_expires_at,apply_receipt")
    .eq("run_id", baseline.adminRunId).limit(baseline.expectedPackageCount + 1));
  if (runRows.length > baseline.expectedPackageCount || !same(
    ordered(runRows.map(runPackageProjection), (row) => String(row.clientPackageId)), baseline.runPackages,
  )) fail();

  const actorRows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < baseline.requestedPackageIds.length; offset += 100) {
    actorRows.push(...databaseRows(await client.from("prospect_enrichment_packages")
      .select("id,run_id,client_package_id,submitted_by,research_key,payload_sha256,state")
      .eq("submitted_by", baseline.actor).in("client_package_id", baseline.requestedPackageIds.slice(offset, offset + 100)).limit(101)));
  }
  if (!same(ordered(actorRows.map(actorPackageProjection), (row) => String(row.clientPackageId)), baseline.actorPackages)) fail();

  const sourceEvents: Record<string, unknown>[] = [];
  for (let offset = 0; offset < baseline.expectedEventKeys.length; offset += 100) {
    sourceEvents.push(...databaseRows(await client.from("prospect_enrichment_source_events")
      .select("id,source_system,source_event_key,semantic_sha256").eq("source_system", baseline.sourceSystem)
      .in("source_event_key", baseline.expectedEventKeys.slice(offset, offset + 100)).limit(101)));
  }
  const currentPresence = baseline.expectedEventKeys.map((key) => ({ key,
    rows: sourceEvents.filter((row) => row.source_event_key === key).map((row) => ({ id: row.id,
      sourceSystem: row.source_system, semanticSha256: row.semantic_sha256 })),
  }));
  if (!same(currentPresence, baseline.eventPresence)) fail();

  const currentItems: EventItems[] = [];
  for (const event of baseline.eventItems) {
    const rows = databaseRows(await client.from("prospect_enrichment_items")
      .select("id,package_id,source_event_id,client_item_id,item_kind,data,source_ids,normalized_sha256")
      .eq("source_event_id", event.eventId).limit(1001));
    if (rows.length > 1000) fail();
    currentItems.push({ eventId: event.eventId, items: ordered(rows.map(itemProjection), (row) => String(row.id)) });
  }
  if (!same(currentItems, baseline.eventItems)) fail();

  const rereadDetails: PackageDetail[] = [];
  for (const detail of baseline.packageDetails) {
    const current = await readPackageDetail({ packageId: detail.packageId, client });
    rereadDetails.push(current);
  }
  if (!same(ordered(rereadDetails.map(packageDetailProjection), (item) => item.packageId),
    ordered(baseline.packageDetails.map(packageDetailProjection), (item) => item.packageId))) fail();

  const targetsByKey = new Map<string, { table: string; id: string; rowSha256: string }>();
  for (const event of baseline.snapshot.events) for (const target of event.targets) {
    if (!TARGET_TABLES.has(target.table) || !READ_UUID.test(target.id) || !/^[a-f0-9]{64}$/.test(target.rowSha256)) fail();
    const key = target.table + ":" + target.id, prior = targetsByKey.get(key);
    if (prior && prior.rowSha256 !== target.rowSha256) fail();
    targetsByKey.set(key, target);
  }
  if (targetsByKey.size > MAX_FINAL_FENCE_TARGETS) fail();
  const targetFirmIds = new Map<string, string>();
  for (const detail of baseline.packageDetails) {
    const detailFirmId = detail.firmId;
    const receiptFirmId = isRecord(detail.receipt) && typeof detail.receipt.firmId === "string" ? detail.receipt.firmId : null;
    if ((detailFirmId !== null && !READ_UUID.test(detailFirmId)) || (receiptFirmId !== null && !READ_UUID.test(receiptFirmId))
      || (detailFirmId && receiptFirmId && detailFirmId.toLowerCase() !== receiptFirmId.toLowerCase())) fail();
    const firmId = (receiptFirmId ?? detailFirmId)?.toLowerCase();
    if (!firmId) continue;
    for (const item of detail.items) for (const target of item.targets) {
      if (!isRecord(target) || typeof target.target_table !== "string" || typeof target.target_id !== "string") continue;
      const key = target.target_table + ":" + target.target_id;
      const prior = targetFirmIds.get(key);
      if (prior && prior !== firmId) fail();
      targetFirmIds.set(key, firmId);
    }
  }
  const currentTargetRows = new Map<string, Record<string, unknown>>();
  for (const table of [...new Set([...targetsByKey.values()].map((target) => target.table))].sort()) {
    const ids = [...targetsByKey.values()].filter((target) => target.table === table).map((target) => target.id);
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      let rows: Record<string, unknown>[];
      if (PROTECTED_GTA_TARGET_TABLES.has(table)) {
        const byFirm = new Map<string, string[]>();
        for (const targetId of chunk) {
          const firmId = targetFirmIds.get(table + ":" + targetId);
          if (!firmId) fail();
          const values = byFirm.get(firmId) ?? []; values.push(targetId); byFirm.set(firmId, values);
        }
        rows = [];
        for (const [firmId, firmTargetIds] of byFirm) rows.push(...await readProtectedGtaTargetRows({ client, firmId, table, ids: firmTargetIds }));
      } else {
        rows = databaseRows(await client.from(table).select("*").in("id", chunk).limit(chunk.length + 1));
      }
      if (rows.length !== chunk.length || new Set(rows.map((row) => row.id)).size !== chunk.length) fail();
      for (const row of rows) currentTargetRows.set(table + ":" + String(row.id), row);
    }
  }
  for (const [key, target] of targetsByKey) if (hash(currentTargetRows.get(key)) !== target.rowSha256) fail();

  const identities = await input.readIdentity(input.envelopes, client);
  if (!same(identities.sort((a, b) => a.researchKey.localeCompare(b.researchKey)), baseline.identities)) fail();

  const legacyTargetIds = [...new Set(baseline.snapshot.events.flatMap((event) => event.legacyAssessmentProjections ?? [])
    .map((proof) => proof.parentAssessmentTarget.id))];
  const batchIdsByFirm = new Map<string, Set<string>>();
  for (const id of legacyTargetIds) {
    const assessment = currentTargetRows.get("gta_prospect_qualification_assessments:" + id);
    if (typeof assessment?.evidence_import_batch_id !== "string" || typeof assessment.firm_id !== "string" || !READ_UUID.test(assessment.firm_id)) fail();
    const values = batchIdsByFirm.get(assessment.firm_id) ?? new Set<string>();
    values.add(assessment.evidence_import_batch_id); batchIdsByFirm.set(assessment.firm_id, values);
  }
  for (const [firmId, firmBatchIds] of batchIdsByFirm) {
    const batchIds = [...firmBatchIds];
    for (let offset = 0; offset < batchIds.length; offset += 100) {
      const chunk = batchIds.slice(offset, offset + 100);
      const batches = databaseRows(await client.rpc("read_prospect_enrichment_gta_evidence_v1", {
        p_firm_id: firmId, p_table: "gta_prospect_supplemental_evidence_import_batches", p_row_id: null,
        p_ids: chunk, p_after_id: null, p_limit: chunk.length + 1,
      }));
      if (batches.length !== chunk.length || new Set(batches.map((batch) => batch.id)).size !== chunk.length || batches.some((batch) => batch.state !== "applied")) fail();
    }
  }

  // Firm revisions are last so updates to canonical evidence made during any earlier
  // portion of this sweep invalidate the same receipt/revision pair before signing.
  const revisionsByFirm = new Map<string, Set<string>>();
  for (const detail of baseline.packageDetails) {
    const firmId = detail.firmId ?? (isRecord(detail.receipt) && typeof detail.receipt.firmId === "string" ? detail.receipt.firmId : null);
    if (!firmId) continue;
    const revisions = detail.items.map((item) => isRecord(item.currentValue) ? item.currentValue.firmRevision : null)
      .filter((value): value is string => typeof value === "string");
    for (const revision of new Set(revisions)) {
      const values = revisionsByFirm.get(firmId) ?? new Set<string>(); values.add(revision); revisionsByFirm.set(firmId, values);
    }
  }
  if ([...revisionsByFirm.values()].some((revisions) => revisions.size !== 1)) fail();
  const firmIds = [...revisionsByFirm.keys()];
  for (let offset = 0; offset < firmIds.length; offset += 100) {
    const chunk = firmIds.slice(offset, offset + 100);
    const { data, error } = await client.rpc("read_prospect_enrichment_firm_identities_v1", { p_firm_ids: chunk, p_source_record_keys: [], p_stable_firm_ids: [] });
    if (error) fail();
    const rows = databaseRows({ data, error });
    if (rows.length !== chunk.length || new Set(rows.map((row) => row.firm_id)).size !== chunk.length) fail();
    for (const row of rows) if (!revisionsByFirm.get(String(row.firm_id))?.has(String(row.enrichment_revision))) fail();
  }
}
