import "server-only";
import { publicCoreSource } from "@/lib/prospect-enrichment-core-evidence";
import { readCurrentComparisons } from "./_comparison-read";
import { readProspectEnrichmentNewCoreOptions } from "./_core-options";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseProspectEnrichmentEnvelope, type ProspectEnrichmentEnvelope, type JsonValue } from "@/lib/prospect-enrichment-contract";
import { prospectEnrichmentPayloadSha256, prospectEnrichmentSha256, prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import type { ResearchPackageSummary } from "@/app/admin/prospects/ResearchInbox";
import type { ResearchPackageReviewView, ResearchItemDisposition, ResearchProfileChoice } from "@/app/admin/prospects/ResearchPackageReview";
import { databaseRows, datedCursor, encodeCursor, isRecord, nullableText, ReadApiError, READ_UUID, requiredText } from "./_read-common";

function storedId(value: unknown): string { if (typeof value !== "string" || !READ_UUID.test(value)) throw new ReadApiError("A stored research identity is invalid."); return value.toLowerCase(); }

export type ReadDatabase = Pick<typeof supabaseAdmin, "from" | "rpc">;
export const PACKAGE_STATES = ["all", "held", "received", "ready_for_review", "identity_hold", "evidence_hold", "applied", "rejected", "superseded"] as const;
const packageColumns = "id,run_id,client_package_id,firm_id,state,created_at,display_name:payload->subject->>displayName,research_outcome:payload->assessment->>researchOutcome,qualification:payload->assessment->>selectionDisposition";
function summary(row: Record<string, unknown>, runName: string): ResearchPackageSummary {
  return { packageId: storedId(row.id), clientPackageId: requiredText(row.client_package_id, "package identity"), displayName: requiredText(row.display_name, "candidate name"), firmId: row.firm_id === null ? null : storedId(row.firm_id), runId: storedId(row.run_id), runName, researchOutcome: nullableText(row.research_outcome, "research outcome"), qualification: nullableText(row.qualification, "qualification"), state: requiredText(row.state, "review state"), receivedAt: requiredText(row.created_at, "receipt date") };
}
export async function readPackageList(input: { state: string; limit: number; cursor?: string; runId?: string; client?: ReadDatabase }): Promise<{ packages: ResearchPackageSummary[]; nextCursor: string | null }> {
  const client = input.client ?? supabaseAdmin;
  const scope = input.state + ":" + (input.runId ?? "all");
  const cursor = datedCursor(input.cursor, "packages", scope);
  let query = client.from("prospect_enrichment_packages").select(packageColumns);
  if (input.state === "held") query = query.in("state", ["identity_hold", "evidence_hold"]);
  else if (input.state !== "all") query = query.eq("state", input.state);
  if (input.runId) query = query.eq("run_id", input.runId);
  if (cursor) query = query.or("created_at.lt." + cursor.createdAt + ",and(created_at.eq." + cursor.createdAt + ",id.lt." + cursor.id + ")");
  const values = databaseRows(await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(input.limit + 1));
  const page = values.slice(0, input.limit), runIds = [...new Set(page.map((row) => storedId(row.run_id)))];
  const runs = runIds.length ? databaseRows(await client.from("prospect_enrichment_runs").select("id,source_name").in("id", runIds).limit(runIds.length)) : [];
  const packages = page.map((row) => { const run = runs.find((item) => item.id === row.run_id); if (!run) throw new ReadApiError("A research run could not be loaded."); return summary(row, requiredText(run.source_name, "run name")); });
  const last = page.at(-1);
  return { packages, nextCursor: values.length > input.limit && last ? encodeCursor({ kind: "packages", scope, createdAt: requiredText(last.created_at, "receipt date"), id: storedId(last.id) }) : null };
}
async function allEvents(client: ReadDatabase, packageId: string) {
  const result: Record<string, unknown>[] = []; let cursor: string | null = null;
  for (;;) {
    let query = client.from("prospect_enrichment_events").select("id,package_id,event_key,event_type,created_at,details").eq("package_id", packageId);
    if (cursor) query = query.gt("id", cursor);
    const page = databaseRows(await query.order("id", { ascending: true }).limit(101));
    result.push(...page.slice(0, 100));
    if (result.length > 10000) throw new ReadApiError("This package event history exceeds the supported read size.");
    if (page.length <= 100) return result;
    cursor = storedId(page[99].id);
  }
}
async function verifiedExistingIdentity(client: ReadDatabase, payload: ProspectEnrichmentEnvelope, storedFirmId: unknown): Promise<{ firmId: string | null; holds: string[] }> {
  const supplied = payload.subject;
  if (supplied.identityState !== "resolved") return { firmId: null, holds: ["identity_" + supplied.identityState] };
  const ids = [...new Set([storedFirmId, supplied.databaseFirmId].filter((value): value is string => typeof value === "string"))];
  const { data, error } = await client.rpc("read_prospect_enrichment_firm_identities_v1", {
    p_firm_ids: ids,
    p_source_record_keys: supplied.sourceRecordKey ? [supplied.sourceRecordKey] : [],
    p_stable_firm_ids: supplied.stableFirmId ? [supplied.stableFirmId] : [],
  });
  if (error) throw new ReadApiError("Firm identity read-back is unavailable.", 503);
  const identityRows = databaseRows(data);
  const candidates: string[] = [], holds: string[] = [];
  for (const id of ids) {
    const rows = identityRows.filter((row) => String(row.firm_id).toLowerCase() === storedId(id));
    if (rows.length !== 1) holds.push("database_firm_identity_missing"); else candidates.push(storedId(rows[0].firm_id));
  }
  if (supplied.sourceRecordKey) {
    const rows = identityRows.filter((row) => row.source_record_key === supplied.sourceRecordKey);
    if (rows.length !== 1) holds.push("source_record_identity_missing"); else candidates.push(storedId(rows[0].firm_id));
  }
  if (supplied.stableFirmId) {
    const rows = identityRows.filter((row) => row.stable_firm_id === supplied.stableFirmId);
    if (rows.length !== 1) holds.push("stable_firm_identity_missing"); else candidates.push(storedId(rows[0].firm_id));
  }
  if (!candidates.length && !supplied.databaseFirmId && !supplied.sourceRecordKey && !supplied.stableFirmId) {
    const rows = databaseRows(await client.from("prospect_source_record_map").select("id,firm_id,mapping_status").eq("source_system", payload.sourceSystem).eq("source_record_id", supplied.researchKey).eq("mapping_status", "confirmed").limit(2));
    if (rows.length === 1 && rows[0].firm_id) candidates.push(storedId(rows[0].firm_id)); else holds.push("confirmed_source_identity_missing");
  }
  if (new Set(candidates).size !== 1) holds.push("identity_conflict");
  const firmId = candidates[0] ?? null;
  if (firmId && supplied.canonicalDomain) {
    const rows = identityRows.filter((row) => String(row.firm_id).toLowerCase() === firmId);
    if (rows.length !== 1 || rows[0].canonical_domain !== supplied.canonicalDomain) holds.push("canonical_domain_requires_identity_review");
  }
  return { firmId: holds.length ? null : firmId, holds };
}
function publicSource(payload: ProspectEnrichmentEnvelope, sourceIds: readonly string[]) {
  return payload.sources.some((source) => sourceIds.includes(source.sourceId) && publicCoreSource(source));
}
function profileCapability(item: { itemKind: string; clientItemId: string; data: unknown; sourceIds: readonly string[] }, payload: ProspectEnrichmentEnvelope): ResearchProfileChoice | null {
  if (!isRecord(item.data) || item.data.evidenceState !== "asserted" || item.data.missingProvenanceReason !== null || !isRecord(item.data.data) || !publicSource(payload, item.sourceIds)) return null;
  const data = item.data.data;
  if (item.itemKind === "website_intake") {
    if (typeof data.pageUrl !== "string" || !payload.sources.some((source) => item.sourceIds.includes(source.sourceId) && source.url === data.pageUrl && publicCoreSource(source))) return null;
    return { fieldKey: "websiteUrl", sourceSelector: "/data/pageUrl", selectedValue: data.pageUrl };
  }
  if (item.itemKind === "firm_fit") return isRecord(data.office) ? { fieldKey: "office:" + item.clientItemId, sourceSelector: "/data/office", selectedValue: data.office as JsonValue } : null;
  if (!["roster", "contact", "advertising", "opportunity"].includes(item.itemKind)) return null;
  if (item.itemKind === "contact" && (data.contactValue === null || data.contactType === "not-observed" || data.contactQuality === "not-observed")) return null;
  return { fieldKey: item.itemKind + ":" + item.clientItemId, sourceSelector: "/data", selectedValue: data as JsonValue };
}
export async function readPackageDetail(input: { packageId: string; client?: ReadDatabase }): Promise<ResearchPackageReviewView & { rawBody: string; rawBodySha256: string }> {
  const client = input.client ?? supabaseAdmin;
  const packageRow = databaseRows(await client.from("prospect_enrichment_packages").select("id,run_id,client_package_id,firm_id,payload,payload_sha256,raw_body,raw_body_sha256,state,identity_state,review_json,review_sha256,expected_revision_sha256,review_expires_at,apply_receipt,created_at").eq("id", input.packageId).limit(1))[0];
  if (!packageRow) throw new ReadApiError("The research package was not found.", 404);
  const parsed = parseProspectEnrichmentEnvelope(packageRow.payload);
  if (!parsed.ok) throw new ReadApiError("The stored research envelope could not be verified.");
  const payload = parsed.envelope, rawBody = requiredText(packageRow.raw_body, "raw package");
  if (prospectEnrichmentPayloadSha256(payload) !== packageRow.payload_sha256 || prospectEnrichmentSha256(rawBody) !== packageRow.raw_body_sha256) throw new ReadApiError("The stored research package failed its integrity check.");
  try { if (prospectEnrichmentPayloadSha256(JSON.parse(rawBody)) !== packageRow.payload_sha256) throw new Error(); } catch { throw new ReadApiError("The raw package and parsed envelope do not agree."); }
  const [itemRows, events, identity] = await Promise.all([
    client.from("prospect_enrichment_items").select("id,package_id,client_item_id,item_kind,data,source_ids,source_event_id,normalized_sha256,observed_at,observed_on,provenance_state").eq("package_id", input.packageId).order("id", { ascending: true }).limit(1002).then(databaseRows),
    allEvents(client, input.packageId),
    verifiedExistingIdentity(client, payload, packageRow.firm_id),
  ]);
  const expectedItems = payload.sources.length + payload.observations.length + (payload.assessment ? 1 : 0);
  if (itemRows.length !== expectedItems || itemRows.length > 1001) throw new ReadApiError("The package evidence item coverage is incomplete.");
  const expected = new Map<string, unknown>([...payload.sources.map((source) => [`src:${source.sourceId}`, source] as const), ...payload.observations.map((item) => [`obs:${item.observationId}`, item] as const), ...(payload.assessment ? [[`assessment:${payload.assessment.assessmentId}`, payload.assessment] as const] : [])]);
  if (new Set(itemRows.map((row) => row.client_item_id)).size !== expected.size || itemRows.some((row) => typeof row.client_item_id !== "string" || !expected.has(row.client_item_id) || prospectEnrichmentProtocolHash(row.data) !== prospectEnrichmentProtocolHash(expected.get(row.client_item_id)))) throw new ReadApiError("Stored items do not exactly match the immutable package.");
  const ids = itemRows.map((row) => storedId(row.id));
  const targets = ids.length ? databaseRows(await client.from("prospect_enrichment_item_targets").select("item_id,target_table,target_id,target_row_sha256,application_kind,linked_at").in("item_id", ids).order("item_id", { ascending: true }).order("target_table", { ascending: true }).order("target_id", { ascending: true }).limit(10001)) : [];
  if (targets.length > 10000) throw new ReadApiError("The complete package target history could not be loaded.");
  const holds: unknown[] = [...identity.holds, ...(!identity.firmId ? ["new_core_requires_explicit_reviewed_input"] : [])];
  const items = itemRows.map((row) => {
    const itemId = storedId(row.id), clientItemId = requiredText(row.client_item_id, "item identity"), itemKind = requiredText(row.item_kind, "item kind");
    if (!Array.isArray(row.source_ids) || row.source_ids.some((id) => typeof id !== "string")) throw new ReadApiError("Stored source references are incomplete.");
    const sourceIds = row.source_ids as string[];
    const data = row.data;
    const allowedDispositions: ResearchItemDisposition[] = ["retain_only"];
    if (isRecord(data) && data.existingRecord !== null && data.existingRecord !== undefined) holds.push({ itemId, code: "existing_record_requires_exact_link_review" });
    else if (identity.firmId && payload.mode === "propose" && itemKind !== "source" && isRecord(data)) {
      const typed = ["firm_fit", "service", "contact", "advertising", "opportunity", "research_attempt"].includes(itemKind);
      if ((typed && data.evidenceState === "asserted" && publicSource(payload, sourceIds) && data.missingProvenanceReason === null) || itemKind === "assessment") allowedDispositions.unshift("accept_new");
      else holds.push({ itemId, code: data.evidenceState === "retracted" ? "retracted_evidence_retained" : "destination_requires_exact_review" });
    }
    return { itemId, clientItemId, itemKind, data, sourceIds, sourceEventId: storedId(row.source_event_id), hash: requiredText(row.normalized_sha256, "item hash"), targets: targets.filter((target) => target.item_id === itemId), allowedDispositions, allowProfileChoice: false };
  });
  const comparisons = await readCurrentComparisons({ firmId: identity.firmId, items, client });
  const newCoreOptions = await readProspectEnrichmentNewCoreOptions({ packageId: input.packageId, payload, state: String(packageRow.state), storedFirmId: packageRow.firm_id, existingFirmId: identity.firmId, items, client });
  if (newCoreOptions) holds.push(...newCoreOptions.holds);
  const reviewedItems = items.map((item, index) => {
    const data = item.data;
    const typed = ["firm_fit", "service", "contact", "advertising", "opportunity", "research_attempt"].includes(item.itemKind);
    const eligible = newCoreOptions?.eligible && isRecord(data) && data.existingRecord === null
      && ((typed && data.evidenceState === "asserted" && data.missingProvenanceReason === null && publicSource(payload, item.sourceIds)) || item.itemKind === "assessment");
    const allowedProfileChoice = comparisons[index].currentValue.state !== "error" && (item.allowedDispositions.includes("accept_new") || eligible) ? profileCapability(item, payload) : null;
    return { ...item, ...comparisons[index], allowedProfileChoice, allowProfileChoice: allowedProfileChoice !== null, profileOmissionReason: allowedProfileChoice ? "This exact profile value has not been explicitly selected." : comparisons[index].profileOmissionReason, allowedDispositions: comparisons[index].currentValue.state === "error" ? ["retain_only"] as ResearchItemDisposition[] : item.allowedDispositions, allowedDispositionsForNewIdentity: eligible ? ["accept_new", "retain_only"] as ResearchItemDisposition[] : ["retain_only"] as ResearchItemDisposition[] };
  });
  return {
    newCoreOptions, packageId: storedId(packageRow.id), clientPackageId: requiredText(packageRow.client_package_id, "package identity"), payloadSha256: requiredText(packageRow.payload_sha256, "payload hash"), state: requiredText(packageRow.state, "package state"),
    identityState: identity.firmId ? "resolved" : identity.holds.some((hold) => hold.includes("conflict") || hold === "canonical_domain_requires_identity_review") ? "conflict" : "unresolved", firmId: identity.firmId,
    payload, items: reviewedItems, sources: payload.sources, events, reviewJson: packageRow.review_json, receipt: packageRow.apply_receipt, holds,
    identityOptions: [{ value: "unresolved", label: "Keep identity unresolved", eligible: true }, ...(identity.firmId ? [{ value: "existing" as const, label: "Use verified existing firm", eligible: true, firmId: identity.firmId }] : []), ...(newCoreOptions?.eligible ? [{ value: "new" as const, label: "Create new firm from selected evidence", eligible: true }] : [])],
    reviewSha256: nullableText(packageRow.review_sha256, "review hash"), expectedRevisionSha256: nullableText(packageRow.expected_revision_sha256, "revision hash"), reviewExpiresAt: nullableText(packageRow.review_expires_at, "review expiry"), rawBody, rawBodySha256: requiredText(packageRow.raw_body_sha256, "raw body hash"),
  };
}
