import "server-only";

import { buildProspectEnrichmentClientItems, parseProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import { prospectEnrichmentProtocolHash as hash, prospectEnrichmentSha256 } from "@/lib/prospect-enrichment-hash";
import { parseProspectEnrichmentReview, prospectEnrichmentReviewSha256 } from "@/lib/prospect-enrichment-operator";
import { getProspectEnrichmentFirmDetail, getProspectEnrichmentFirmHistory, type ProspectEnrichmentEvidence } from "@/lib/prospect-enrichment-reader";
import { readPackageDetail, type ReadDatabase } from "./_package-read";
import { databaseRows, isRecord, READ_UUID } from "./_read-common";

export const READBACK_VERSION = "prospect-enrichment-readback/v1";
const SHA = /^[a-f0-9]{64}$/;
const pending = new Set(["received", "ready_for_review", "identity_hold", "evidence_hold"]);
const targetTables = new Set([
  "gta_prospect_firms", "gta_prospect_stable_identity_registry", "gta_prospect_import_audit",
  "gta_prospect_supplemental_evidence_import_audit", "gta_prospect_shared_identity_observations",
  "gta_prospect_website_intake_observations", "gta_prospect_qualification_assessments",
  "gta_prospect_roster_observations", "gta_prospect_downtown_geography_observations",
  "gta_prospect_public_contact_observations", "prospect_source_record_map", "prospect_source_captures",
  "prospect_research_attempts", "prospect_advertising_observations", "prospect_qualification_decisions",
  "prospect_firm_fit_observations", "prospect_service_observations", "prospect_decision_maker_contacts",
  "prospect_opportunity_observations",
]);
const destinations: Readonly<Record<string, string>> = {
  firm_fit: "prospect_firm_fit_observations", service: "prospect_service_observations",
  contact: "prospect_decision_maker_contacts", advertising: "prospect_advertising_observations",
  opportunity: "prospect_opportunity_observations", website_intake: "gta_prospect_website_intake_observations",
  roster: "gta_prospect_roster_observations", research_attempt: "prospect_research_attempts",
  assessment: "prospect_qualification_decisions",
};
const auditTables = new Set(["gta_prospect_import_audit", "gta_prospect_supplemental_evidence_import_audit"]);
export type VerificationScope = "package" | "canonical";
type PackageDetail = Awaited<ReturnType<typeof readPackageDetail>>;
type Target = { targetTable: string; targetId: string; targetRowSha256: string; applicationKind: "inserted" | "existing" };
type ReceiptItem = { itemId: string; clientItemId: string; disposition: "accept_new" | "link_existing" | "retain_only"; targets: Target[] };
export class VerificationMismatch extends Error {
  constructor(readonly code: string, message: string, readonly status: 409 | 503 = 409) { super(message); this.name = "VerificationMismatch"; }
}
function requireCheck(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new VerificationMismatch(code, message);
}
function equal(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return false;
  return hash(left) === hash(right);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function uuid(value: unknown): value is string { return typeof value === "string" && READ_UUID.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && SHA.test(value); }
function targetKey(value: { targetTable: string; targetId: string }) { return value.targetTable + ":" + value.targetId; }
function canonicalTarget(value: unknown): Target {
  requireCheck(isRecord(value) && exactKeys(value, ["targetTable", "targetId", "targetRowSha256", "applicationKind"])
    && typeof value.targetTable === "string" && targetTables.has(value.targetTable) && uuid(value.targetId)
    && digest(value.targetRowSha256) && ["inserted", "existing"].includes(String(value.applicationKind)),
  "invalid_receipt_target", "The application receipt contains an unsupported or incomplete evidence target.");
  return value as Target;
}
function mappingTarget(value: unknown): Target {
  requireCheck(isRecord(value), "invalid_target_mapping", "Stored evidence target linkage is incomplete.");
  return canonicalTarget({ targetTable: value.target_table, targetId: value.target_id, targetRowSha256: value.target_row_sha256, applicationKind: value.application_kind });
}
function sortedTargets(values: readonly Target[]) {
  return [...values].sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
}

async function verifyPackage(record: PackageDetail, requestedHash: string, client: ReadDatabase) {
  const parsed = parseProspectEnrichmentEnvelope(record.payload);
  requireCheck(parsed.ok && record.payloadSha256 === requestedHash && hash(record.payload) === requestedHash,
    "payload_mismatch", "The package payload does not match the requested hash.");
  requireCheck(prospectEnrichmentSha256(record.rawBody) === record.rawBodySha256,
    "raw_body_mismatch", "The retained original request does not match its receipt hash.");
  let raw: unknown;
  try { raw = JSON.parse(record.rawBody); } catch { throw new VerificationMismatch("invalid_raw_body", "The retained original request is not valid JSON."); }
  requireCheck(equal(raw, record.payload), "raw_envelope_mismatch", "The retained request and package envelope differ.");
  const payload = parsed.envelope;
  requireCheck(equal(record.sources, payload.sources), "source_coverage_mismatch", "The package source read-back is incomplete.");
  requireCheck(hash(payload.originalResearch.content) === payload.originalResearch.contentSha256,
    "original_research_mismatch", "The original research content does not match its evidence hash.");
  const lineage = buildProspectEnrichmentClientItems(payload);
  requireCheck(record.items.length === lineage.length && new Set(record.items.map((item) => item.itemId)).size === lineage.length
    && new Set(record.items.map((item) => item.clientItemId)).size === lineage.length,
  "item_coverage_mismatch", "The package read-back does not cover every stored item exactly once.");
  const byClient = new Map(record.items.map((item) => [item.clientItemId, item]));
  const events = new Map<string, Record<string, unknown>>();
  const eventIds = [...new Set(record.items.map((item) => item.sourceEventId))];
  requireCheck(eventIds.every(uuid), "source_event_missing", "A package evidence item has no stable source event.");
  for (let offset = 0; offset < eventIds.length; offset += 100) {
    const ids = eventIds.slice(offset, offset + 100) as string[];
    const rows = databaseRows(await client.from("prospect_enrichment_source_events")
      .select("id,source_system,source_event_key,semantic_sha256").in("id", ids).limit(ids.length + 1));
    requireCheck(rows.length === ids.length && new Set(rows.map((row) => row.id)).size === ids.length,
      "source_event_missing", "The package source-event registry is incomplete.");
    for (const row of rows) { requireCheck(uuid(row.id) && ids.includes(row.id), "source_event_mismatch", "The source-event registry returned an unexpected item."); events.set(row.id, row); }
  }
  for (const expected of lineage) {
    const item = byClient.get(expected.clientItemId);
    const source = payload.sources.find((candidate) => expected.clientItemId === "src:" + candidate.sourceId);
    const observation = payload.observations.find((candidate) => expected.clientItemId === "obs:" + candidate.observationId);
    const data = source ?? observation ?? payload.assessment;
    requireCheck(item && data && item.itemKind === (source ? "source" : observation ? observation.kind : "assessment")
      && item.hash === expected.semanticSha256 && equal(item.data, data)
      && equal(item.sourceIds, source ? [] : observation ? observation.sourceIds : payload.assessment!.sourceIds),
    "item_value_mismatch", "A stored item differs from the exact package values, source links or semantic hash.");
    const event = events.get(item.sourceEventId!);
    requireCheck(event && event.source_system === payload.sourceSystem && event.source_event_key === expected.sourceEventKey
      && event.semantic_sha256 === expected.semanticSha256,
    "source_event_mismatch", "An item does not match its immutable source-event registry entry.");
  }
  return { sourceCount: payload.sources.length, itemCount: record.items.length, items: record.items.map((item) => ({
    itemId: item.itemId, clientItemId: item.clientItemId, itemKind: item.itemKind,
    sourceEventId: item.sourceEventId, semanticSha256: item.hash, dataSha256: hash(item.data), sourceIds: item.sourceIds,
  })).sort((a, b) => a.itemId.localeCompare(b.itemId)) };
}

async function fullTargetRows(targets: readonly Target[], firmId: string, client: ReadDatabase) {
  const rows = new Map<string, Record<string, unknown>>();
  for (const table of [...new Set(targets.map((target) => target.targetTable))].sort()) {
    const ids = [...new Set(targets.filter((target) => target.targetTable === table).map((target) => target.targetId))];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      // Full persisted JSON is necessary for receipt hashes; table names come only from the closed allowlist.
      const values = databaseRows(await client.from(table).select("*").in("id", chunk).limit(chunk.length + 1));
      requireCheck(values.length === chunk.length && new Set(values.map((row) => row.id)).size === chunk.length,
        "canonical_target_missing", "A committed evidence target is missing from the canonical database.");
      for (const row of values) {
        requireCheck(uuid(row.id) && chunk.includes(row.id) && (table === "gta_prospect_firms" ? row.id === firmId : row.firm_id === firmId),
          "canonical_target_identity_mismatch", "An evidence target does not belong to the reviewed canonical firm.");
        rows.set(table + ":" + row.id, row);
      }
    }
  }
  for (const target of targets) requireCheck(hash(rows.get(targetKey(target))) === target.targetRowSha256,
    "canonical_target_hash_mismatch", "A canonical evidence row differs from its committed receipt hash.");
  return rows;
}

function verifyVisibleEvidence(visible: ProspectEnrichmentEvidence, fullRow: Record<string, unknown>, item: PackageDetail["items"][number], record: PackageDetail) {
  requireCheck(Object.entries(visible.data).every(([key, value]) => Object.hasOwn(fullRow, key) && equal(value, fullRow[key])),
    "visible_value_mismatch", "The Admin evidence projection differs from the committed destination values.");
  const expectedSources = record.payload.sources.filter((source) => item.sourceIds.includes(source.sourceId));
  const linked = visible.enrichment.find((entry) => entry.packageId === record.packageId && entry.itemId === item.itemId);
  requireCheck(linked && linked.sourceEventId === item.sourceEventId && linked.payloadSha256 === record.payloadSha256
    && linked.runId === record.payload.runId && equal(linked.data, item.data)
    && equal(linked.sourceIds, item.sourceIds) && equal(linked.sources, expectedSources)
    && equal(linked.originalResearch, record.payload.originalResearch),
  "visible_source_link_mismatch", "Admin did not show the complete item, sources and original research linked to this package.");
  if (isRecord(item.data) && item.data.evidenceState === "retracted") {
    requireCheck(visible.retractions.some((event) => event.package_id === record.packageId && isRecord(event.details)
      && event.details.targetTable === visible.table && event.details.targetId === visible.id),
    "visible_retraction_missing", "Admin did not show the reviewed evidence retraction.");
  }
}

async function completeFirmEvidence(firm: Awaited<ReturnType<typeof getProspectEnrichmentFirmDetail>>) {
  requireCheck(firm.revisionStable && firm.sections.every((section) => section.state !== "error")
    && (firm.complete || firm.sections.some((section) => Object.keys(section.nextCursors).length > 0)),
  "canonical_readback_incomplete", "Admin could not read the firm evidence without errors or concurrent changes.");
  const values = firm.sections.flatMap((section) => [...section.items]);
  const keys = new Set(values.map((item) => item.table + ":" + item.id));
  requireCheck(keys.size === values.length && values.length <= 5000, "canonical_coverage_limit", "The complete firm evidence exceeds the bounded verification limit.");
  let paged = false, pageCount = 0;
  for (const section of firm.sections) {
    requireCheck(!section.incomplete || Object.keys(section.nextCursors).length > 0,
      "canonical_readback_incomplete", "An incomplete Admin section has no supported continuation cursor.");
    for (const [table, initialCursor] of Object.entries(section.nextCursors)) {
      let cursor: string | null = initialCursor;
      const seen = new Set<string>();
      while (cursor) {
        requireCheck(!seen.has(cursor), "canonical_cursor_repeated", "Admin evidence pagination did not advance.");
        seen.add(cursor); paged = true; pageCount += 1;
        requireCheck(pageCount <= 100, "canonical_coverage_limit", "The complete firm history exceeds the bounded pagination limit.");
        const page = await getProspectEnrichmentFirmHistory({ firmId: firm.firm.id, table, cursor, limit: 100 });
        requireCheck(page.table === table && (page.nextCursor === null || (typeof page.nextCursor === "string" && page.nextCursor.length > 0 && page.nextCursor.length <= 2048)),
          "canonical_page_mismatch", "Admin returned an incomplete evidence history page.");
        for (const item of page.items) {
          const key = item.table + ":" + item.id;
          requireCheck(item.table === table && !keys.has(key), "canonical_page_mismatch", "Admin history returned duplicate or incorrectly scoped evidence.");
          keys.add(key); values.push(item);
        }
        requireCheck(values.length <= 5000, "canonical_coverage_limit", "The complete firm evidence exceeds the bounded verification limit.");
        cursor = page.nextCursor;
      }
    }
  }
  if (paged) {
    const after = await getProspectEnrichmentFirmDetail({ firmId: firm.firm.id });
    requireCheck(after.firm.id === firm.firm.id && after.revisionStable && after.firm.revision === firm.firm.revision
      && after.sections.every((section) => section.state !== "error"),
    "canonical_revision_mismatch", "The firm changed while Admin paged its evidence history.");
  }
  return values;
}

async function verifyCanonical(record: PackageDetail, client: ReadDatabase) {
  const receipt = record.receipt;
  requireCheck(record.state === "applied" && isRecord(receipt), "canonical_not_applied", "Canonical verification requires a committed application receipt.");
  requireCheck(receipt.schemaVersion === "prospect-enrichment-apply-receipt/v1" && receipt.packageId === record.packageId
    && receipt.clientPackageId === record.clientPackageId && receipt.payloadSha256 === record.payloadSha256
    && uuid(receipt.firmId) && uuid(receipt.appliedBy) && typeof receipt.appliedAt === "string" && Number.isFinite(Date.parse(receipt.appliedAt))
    && digest(receipt.expectedRevisionSha256) && digest(receipt.resultingRevisionSha256) && digest(receipt.reviewSha256)
    && typeof receipt.sourceRecordKey === "string" && Array.isArray(receipt.items) && receipt.items.length === record.items.length
    && Array.isArray(receipt.profileChoices) && receipt.profileChoices.length <= record.items.length,
  "invalid_apply_receipt", "The application receipt is incomplete or belongs to a different package.");
  let review;
  try { review = parseProspectEnrichmentReview(record.reviewJson); }
  catch { throw new VerificationMismatch("invalid_saved_review", "The complete reviewed item choices could not be read back."); }
  requireCheck(review.payloadSha256 === record.payloadSha256 && prospectEnrichmentReviewSha256(review) === receipt.reviewSha256
    && record.reviewSha256 === receipt.reviewSha256 && review.items.length === record.items.length
    && review.identity.choice !== "unresolved" && (review.identity.choice !== "existing" || review.identity.firmId === receipt.firmId)
    && (review.identity.choice !== "new" || review.identity.coreInput?.id === receipt.sourceRecordKey),
  "review_receipt_mismatch", "The application receipt does not match the exact operator review.");
  const byId = new Map(record.items.map((item) => [item.itemId, item]));
  const reviewById = new Map(review.items.map((item) => [item.itemId, item]));
  const receiptItems: ReceiptItem[] = receipt.items.map((value) => {
    requireCheck(isRecord(value) && exactKeys(value, ["itemId", "clientItemId", "disposition", "targets"])
      && uuid(value.itemId) && Array.isArray(value.targets) && value.targets.length <= 1000,
    "invalid_receipt_item", "The application receipt has incomplete item dispositions.");
    const stored = byId.get(value.itemId), choice = reviewById.get(value.itemId);
    requireCheck(stored && choice && stored.clientItemId === value.clientItemId && choice.disposition === value.disposition,
      "item_disposition_mismatch", "A committed item disposition differs from the operator review.");
    const targets = value.targets.map(canonicalTarget);
    requireCheck(new Set(targets.map(targetKey)).size === targets.length
      && equal(sortedTargets(targets), sortedTargets(stored.targets.map(mappingTarget))),
    "target_mapping_mismatch", "Receipt targets differ from the stored item-to-evidence links.");
    requireCheck(choice.disposition === "retain_only" ? targets.length === 0 : targets.length > 0,
      "item_target_coverage_mismatch", "The target coverage contradicts a reviewed item disposition.");
    if (choice.disposition !== "retain_only") {
      const existing = isRecord(stored.data) && isRecord(stored.data.existingRecord) ? stored.data.existingRecord : null;
      const primary = choice.disposition === "link_existing" ? existing?.table : destinations[stored.itemKind];
      requireCheck(typeof primary === "string" && targets.some((target) => target.targetTable === primary
        && (choice.disposition !== "link_existing" || (target.targetId === existing?.id && target.targetRowSha256 === existing?.rowSha256))),
      "item_destination_mismatch", "An applied item does not have its documented evidence destination or exact existing-record link.");
      requireCheck(targets.every((target) => target.targetTable === primary || target.targetTable === "prospect_source_captures"
        || target.targetTable === "gta_prospect_firms" || auditTables.has(target.targetTable)),
      "item_destination_mismatch", "An applied item includes a target outside its documented evidence mapping.");
    }
    return { itemId: value.itemId, clientItemId: stored.clientItemId, disposition: choice.disposition, targets };
  });
  requireCheck(new Set(receiptItems.map((item) => item.itemId)).size === record.items.length,
    "item_disposition_mismatch", "The receipt does not cover every reviewed item exactly once.");
  const targets = receiptItems.flatMap((item) => item.targets);
  requireCheck(targets.length <= 10000, "target_coverage_limit", "This package exceeds the bounded canonical verification limit.");
  const firm = await getProspectEnrichmentFirmDetail({ firmId: receipt.firmId });
  requireCheck(firm.firm.id === receipt.firmId && firm.firm.sourceRecordKey === receipt.sourceRecordKey,
  "canonical_readback_incomplete", "Admin could not read the complete canonical firm evidence without errors or concurrent changes.");
  const revisionSha256 = hash({ schemaVersion: "prospect-enrichment-firm-revision/v1", firmId: receipt.firmId.toLowerCase(), revision: firm.firm.revision });
  requireCheck(revisionSha256 === receipt.resultingRevisionSha256, "canonical_revision_mismatch", "The firm changed after this package was applied.");
  const allVisibleEvidence = await completeFirmEvidence(firm);
  const rows = await fullTargetRows(targets, receipt.firmId, client);
  const visible = new Map(allVisibleEvidence.map((item) => [item.table + ":" + item.id, item]));
  for (const item of receiptItems) for (const target of item.targets) {
    if (target.targetTable === "gta_prospect_firms" || auditTables.has(target.targetTable)) continue;
    const evidence = visible.get(targetKey(target));
    requireCheck(evidence, "canonical_target_not_visible", "A committed business evidence target is not visible in Admin firm detail.");
    verifyVisibleEvidence(evidence, rows.get(targetKey(target))!, byId.get(item.itemId)!, record);
  }
  const profileItemIds = new Set<string>();
  const profileChoiceIds = new Set<string>();
  for (const value of receipt.profileChoices) {
    requireCheck(isRecord(value) && uuid(value.choiceId) && uuid(value.sourceItemId) && !profileChoiceIds.has(value.choiceId),
      "invalid_profile_receipt", "The selected-profile receipt is incomplete.");
    profileChoiceIds.add(value.choiceId); profileItemIds.add(value.sourceItemId);
    requireCheck(reviewById.get(value.sourceItemId)?.profileChoice != null && equal(reviewById.get(value.sourceItemId)?.profileChoice, { fieldKey: value.fieldKey, sourceSelector: value.sourceSelector, selectedValue: value.selectedValue }), "profile_choice_mismatch", "A profile choice was not explicitly selected in review.");
    const choice = firm.profileChoices.find((candidate) => candidate.id === value.choiceId);
    requireCheck(choice && !choice.retractions.length && choice.data.package_id === record.packageId
      && choice.data.field_key === value.fieldKey && choice.data.target_table === value.targetTable
      && choice.data.target_id === value.targetId && choice.data.source_selector === value.sourceSelector
      && equal(choice.data.selected_value, value.selectedValue) && equal(choice.data.selected_provenance, value.selectedProvenance)
      && choice.profileSource && choice.profileSource.table === value.targetTable && choice.profileSource.id === value.targetId
      && choice.profileSource.selector === value.sourceSelector,
    "profile_choice_not_visible", "The reviewed current-profile value and its exact source are not visible in Admin.");
    if (value.fieldKey === "firmName") requireCheck(firm.firm.displayName === value.selectedValue, "profile_value_mismatch", "The reviewed firm name is not visible.");
    if (value.fieldKey === "websiteUrl") requireCheck(firm.firm.websiteUrl === value.selectedValue, "profile_value_mismatch", "The reviewed website is not visible.");
  }
  requireCheck(review.items.every((item) => (item.profileChoice !== null) === profileItemIds.has(item.itemId)),
    "profile_choice_coverage_mismatch", "The receipt does not cover every explicit profile choice.");
  return { expectedReceiptSha256: hash(receipt), resultingRevisionSha256: revisionSha256, targetCount: targets.length,
    receiptItems: [...receiptItems].sort((a, b) => a.itemId.localeCompare(b.itemId)), profileChoiceIds: [...profileChoiceIds].sort(),
    identity: { firmId: receipt.firmId, stableFirmId: receipt.stableFirmId, sourceRecordKey: receipt.sourceRecordKey },
    profileChoices: receipt.profileChoices.map((choice) => { const value = choice as Record<string, unknown>; return { choiceId: value.choiceId, sourceItemId: value.sourceItemId, fieldKey: value.fieldKey, sourceSelector: value.sourceSelector, selectedValueSha256: hash(value.selectedValue) }; }) };
}

/** Read-only evidence checks precede the final RPC's locked hash/state/revision revalidation. */
export async function buildProspectEnrichmentVerification(input: { packageId: string; payloadSha256: string; visibilityScope: VerificationScope; client: ReadDatabase }) {
  const record = await readPackageDetail({ packageId: input.packageId, client: input.client });
  const coverage = await verifyPackage(record, input.payloadSha256, input.client);
  const canonical = input.visibilityScope === "canonical" ? await verifyCanonical(record, input.client) : null;
  if (!canonical) requireCheck(pending.has(record.state) && record.receipt === null,
    "package_scope_state_mismatch", "Package-only verification is available for staged or held research without an application receipt.");
  const readbackSha256 = hash({ verificationVersion: READBACK_VERSION, visibilityScope: input.visibilityScope,
    packageId: record.packageId, payloadSha256: record.payloadSha256, rawBodySha256: record.rawBodySha256,
    state: record.state, ...coverage, canonical });
  return {
    report: {
      visibilityScope: input.visibilityScope, rendererVersion: "prospect-enrichment/v1", readbackAt: new Date().toISOString(),
      identity: canonical?.identity ?? { firmId: record.firmId, stableFirmId: record.firmId ? record.payload.subject.stableFirmId : null, sourceRecordKey: record.firmId ? record.payload.subject.sourceRecordKey : null },
      items: coverage.items.map((item) => { const applied = canonical?.receiptItems.find((value) => value.itemId === item.itemId); return { ...item, disposition: applied?.disposition ?? "pending", visibleInPackage: true, visibleInFirm: applied && applied.disposition !== "retain_only" ? true : null, targets: applied?.targets.map((target) => ({ targetTable: target.targetTable, targetId: target.targetId, retrievedRowSha256: target.targetRowSha256 })) ?? [] }; }),
      sources: record.sources.map((source) => ({ sourceId: source.sourceId, url: source.url, observedAt: source.observedAt, observedOn: source.observedOn, precision: source.observedAt ? "exact_time" : source.observedOn ? "date_only" : "unknown", publicationLabel: source.publicationLabel, publicationPrecision: source.publicationPrecision })),
      profileChoices: canonical?.profileChoices ?? [],
    },
    visibilityScope: input.visibilityScope, payloadSha256: record.payloadSha256, readbackSha256,
    expectedReceiptSha256: canonical?.expectedReceiptSha256 ?? null, sourceCount: coverage.sourceCount,
    itemCount: coverage.itemCount, targetCount: canonical?.targetCount ?? 0, verificationVersion: READBACK_VERSION,
  };
}
