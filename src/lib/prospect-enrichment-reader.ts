import "server-only";

import { randomUUID } from "node:crypto";
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import type { JsonValue } from "@/lib/prospect-enrichment-contract";
import { evidenceDate, evidenceDateLabel, evidenceRefreshState, isEvidenceObject, projectLegacyCriteria, qualificationDisplayCategory, safeEvidenceUrl, readEvidenceJsonPointer, type EvidenceDate, type LegacyEvidenceProjection } from "@/lib/prospect-enrichment-legacy";

export type ProspectEnrichmentSectionKey = "identity" | "profile" | "sources" | "advertising" | "marketing" | "qualification" | "history";
export type EnrichmentReadQuery = Readonly<{ table: string; columns: string; equals?: Readonly<Record<string, string>>; in?: Readonly<{ column: string; values: readonly string[] }>; afterId?: string; limit: number }>;
export type EnrichmentReadResult = Readonly<{ data: unknown; error: { code?: string; message?: string } | null }>;
export type ProspectEnrichmentReadClient = Readonly<{ read: (query: EnrichmentReadQuery) => Promise<EnrichmentReadResult> }>;
export type ProspectEnrichmentEvidence = Readonly<{
  id: string; table: string; data: Readonly<Record<string, JsonValue>>; semanticSha256: string;
  date: EvidenceDate; dateLabel: string; freshness: "current" | "refresh_recommended" | "unknown";
  sourceUrls: readonly string[]; legacyCriteria: readonly LegacyEvidenceProjection[]; qualificationCategory: string | null;
  enrichment: readonly Readonly<{ packageId: string; itemId: string; sourceEventId: string | null; data: unknown; sources: readonly unknown[]; sourceIds: readonly string[]; originalResearch: unknown; runId: string | null; payloadSha256: string | null }>[];
  retractions: readonly Readonly<Record<string, unknown>>[];
  events?: readonly Readonly<Record<string, unknown>>[];
  profileSource: Readonly<{ table: string; id: string; selector: string; data: unknown; enrichment: ProspectEnrichmentEvidence["enrichment"] }> | null;
}>;
export type ProspectEnrichmentEvidenceSection = Readonly<{
  key: ProspectEnrichmentSectionKey; title: string; state: "available" | "empty" | "error";
  items: readonly ProspectEnrichmentEvidence[]; errorId: string | null; incomplete: boolean;
  nextCursors: Readonly<Record<string, string>>;
}>;
export type ProspectEnrichmentFirmDetail = Readonly<{
  firm: Readonly<{ id: string; displayName: string; websiteUrl: string | null; sourceRecordKey: string; revision: string }>;
  sections: readonly ProspectEnrichmentEvidenceSection[]; complete: boolean; revisionStable: boolean;
  profileChoices: readonly ProspectEnrichmentEvidence[]; readAt: string; rendererVersion: "prospect-enrichment/v1";
}>;
export class ProspectEnrichmentReadError extends Error {
  readonly errorId = randomUUID();
  constructor(message: string, readonly status: 404 | 422 | 503 = 503) { super(message); this.name = "ProspectEnrichmentReadError"; }
}

type Spec = Readonly<{ section: ProspectEnrichmentSectionKey; table: string; columns: string; freshness?: number; batch?: "core" | "supplemental" }>;
const observed = "observed_at,source_observed_on,source_observed_precision";
const specs: readonly Spec[] = [
  { section: "identity", table: "gta_prospect_shared_identity_observations", columns: "id,firm_id,evidence_import_batch_id,mapping_id,match_state,stable_firm_id,canonical_domain,observed_on,confidence,evidence_urls,note,raw_observation", batch: "supplemental" },
  { section: "profile", table: "gta_prospect_downtown_geography_observations", columns: "id,firm_id,evidence_import_batch_id,boundary_id,geography_status,normalized_address,latitude,longitude,coordinate_source_type,coordinate_source_url,boundary_source_url,boundary_geometry_sha256,observed_on,confidence,note", freshness: 90, batch: "supplemental" },

  { section: "identity", table: "gta_prospect_stable_identity_registry", columns: "id,firm_id,stable_firm_id,canonical_domain,source_url,observed_on,confidence,adjudication_basis" },
  { section: "identity", table: "gta_prospect_aliases", columns: "id,firm_id,alias_kind,alias_value,normalized_alias_value,source_type,source_url,observed_on" },
  { section: "identity", table: "gta_prospect_domains", columns: "id,firm_id,domain_value,normalized_domain_value,source_type,source_url,observed_on" },
  { section: "identity", table: "prospect_source_record_map", columns: "id,firm_id,source_system,source_record_id,mapping_status,identity_decision_id,evidence_ids,reviewed_at" },
  { section: "profile", table: "gta_prospect_offices", columns: "id,firm_id,city,province,address_raw,street_normalized,suite_raw,source_type,source_url,observed_on", freshness: 90 },
  { section: "profile", table: "gta_prospect_roster_observations", columns: "id,firm_id,import_batch_id,source_type,source_url,observed_on,observed_lawyer_count,count_qualifier,count_display,canonical_observation", freshness: 90, batch: "core" },
  { section: "profile", table: "prospect_firm_fit_observations", columns: `id,firm_id,target_practice_areas,office_geography,lawyer_count,size_band,independence_status,fit_status,source_url,evidence_ids,${observed}`, freshness: 90 },
  { section: "profile", table: "prospect_service_observations", columns: `id,firm_id,service_name,matter_fit,source_url,evidence_ids,${observed}`, freshness: 90 },
  { section: "profile", table: "prospect_decision_maker_contacts", columns: `id,firm_id,person_name,role_label,role_verification,contact_type,contact_value,contact_quality,source_url,deliverability_state,${observed}`, freshness: 90 },
  { section: "profile", table: "gta_prospect_public_contact_observations", columns: "id,firm_id,import_batch_id,contact_name,relationship,public_email,email_kind,source_url,observed_on", freshness: 90, batch: "core" },
  { section: "sources", table: "prospect_source_captures", columns: `id,firm_id,requested_url,final_url,publisher,retrieval_method,http_status,sha256,retained_artifact,policy_state,${observed}` },
  { section: "sources", table: "gta_prospect_evidence_links", columns: "id,firm_id,import_batch_id,evidence_type,source_type,source_url,observed_on,raw_value", batch: "core" },
  { section: "advertising", table: "prospect_advertising_observations", columns: `id,firm_id,canonical_domain,evidence_type,vendor,signal_type,signal_id,advertiser_identity,advertised_service,destination_url,effective_date,last_shown_date,recency_basis,source_url,capture_id,identity_state,reviewed,attributable,${observed}`, freshness: 30 },
  { section: "advertising", table: "prospect_research_attempts", columns: `id,firm_id,provider,query_or_url,outcome,coverage,failure_reason,evidence_ids,${observed}` },
  { section: "marketing", table: "prospect_opportunity_observations", columns: `id,firm_id,opportunity_type,finding,recommendation_hypothesis,source_url,evidence_ids,confidence,${observed}`, freshness: 60 },
  { section: "marketing", table: "gta_prospect_website_intake_observations", columns: "id,firm_id,evidence_import_batch_id,finding_id,source_url,observed_on,intake_channels,opportunity_state,opportunity_note,evidence_urls,raw_observation", freshness: 60, batch: "supplemental" },
  { section: "qualification", table: "prospect_qualification_decisions", columns: "id,firm_id,run_id,cohort_id,rule_version,advertising_status,advertising_status_state,fit_decision,commercial_relevance,decision_maker_access,opportunity_decision,selection_disposition,evidence_ids,rationale,decided_at,source_observed_on,source_observed_precision" },
  { section: "qualification", table: "gta_prospect_qualification_assessments", columns: "id,firm_id,evidence_import_batch_id,assessment_id,qualification_state,qualification_cohort,assessed_on,criteria,evidence_urls,note,raw_assessment", batch: "supplemental" },
  { section: "history", table: "gta_prospect_import_audit", columns: "id,firm_id,import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,validation_errors,canonical_record,created_at", batch: "core" },
  { section: "history", table: "gta_prospect_supplemental_evidence_import_audit", columns: "id,firm_id,evidence_import_batch_id,source_record_key,source_record_sha256,validation_state,canonical_record,created_at", batch: "supplemental" },
  { section: "history", table: "prospect_enrichment_packages", columns: "id,firm_id,run_id,client_package_id,payload,payload_sha256,raw_body_sha256,state,identity_state,supersedes_package_id,apply_receipt,applied_at,created_at" },
  { section: "history", table: "prospect_enrichment_profile_choices", columns: "id,firm_id,field_key,target_table,target_id,source_selector,selected_value,selected_provenance,package_id,chosen_at,supersedes_choice_id,rationale" },
];
export const PROSPECT_ENRICHMENT_SECTION_TITLES: Readonly<Record<ProspectEnrichmentSectionKey, string>> = {
  identity: "Firm identity", profile: "Current profile", sources: "Sources and evidence", advertising: "Advertising observations", marketing: "Marketing and intake", qualification: "Qualification assessments", history: "History and import receipts",
};
const sectionOrder = Object.keys(PROSPECT_ENRICHMENT_SECTION_TITLES) as ProspectEnrichmentSectionKey[];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const protectedGtaReadTables = new Set([
  "gta_prospect_firms", "gta_prospect_stable_identity_registry", "gta_prospect_aliases", "gta_prospect_domains",
  "gta_prospect_offices", "gta_prospect_roster_observations", "gta_prospect_public_contact_observations",
  "gta_prospect_evidence_links", "gta_prospect_import_audit", "gta_prospect_import_batches",
  "gta_prospect_shared_identity_observations", "gta_prospect_downtown_geography_observations",
  "gta_prospect_website_intake_observations", "gta_prospect_qualification_assessments",
  "gta_prospect_supplemental_evidence_import_audit", "gta_prospect_supplemental_evidence_import_batches",
]);
export function isProtectedGtaEnrichmentReadTable(table: string): boolean { return protectedGtaReadTables.has(table); }
export async function readProtectedGtaEnrichmentEvidence(
  client: Readonly<{ rpc: (name: string, args: Record<string, unknown>) => PromiseLike<EnrichmentReadResult> }>,
  input: EnrichmentReadQuery,
): Promise<EnrichmentReadResult> {
  if (!isProtectedGtaEnrichmentReadTable(input.table)) return { data: null, error: { code: "22023", message: "The protected GTA evidence table is not allowlisted." } };
  const firmId = input.table === "gta_prospect_firms" ? input.equals?.id : input.equals?.firm_id;
  if (!firmId || !uuid.test(firmId)) return { data: null, error: { code: "22023", message: "A canonical firm UUID is required for protected GTA evidence." } };
  const ids = input.in?.column === "id" ? input.in.values : undefined;
  if (input.in && input.in.column !== "id") return { data: null, error: { code: "22023", message: "Protected GTA evidence only supports bounded ID lookups." } };
  return await client.rpc("read_prospect_enrichment_gta_evidence_v1", {
    p_firm_id: firmId,
    p_table: input.table,
    p_row_id: input.equals?.id && input.table !== "gta_prospect_firms" ? input.equals.id : null,
    p_ids: ids ? [...ids] : null,
    p_after_id: input.afterId ?? null,
    p_limit: Math.min(Math.max(input.limit, 1), 501),
  });
}
function requireUuid(id: string) { if (!uuid.test(id)) throw new ProspectEnrichmentReadError("A canonical firm UUID is required.", 422); }
function rows(result: EnrichmentReadResult): Record<string, unknown>[] {
  if (result.error || !Array.isArray(result.data) || result.data.some((row) => !isEvidenceObject(row) || typeof row.id !== "string")) throw new ProspectEnrichmentReadError("Research evidence could not be loaded.");
  return result.data as Record<string, unknown>[];
}
async function defaultClient(): Promise<ProspectEnrichmentReadClient> {
  const { supabaseAdmin } = await import("@/lib/supabase-admin");
  return { async read(input) {
    if (isProtectedGtaEnrichmentReadTable(input.table)) return await readProtectedGtaEnrichmentEvidence(supabaseAdmin, input);
    let query = supabaseAdmin.from(input.table).select(input.columns);
    for (const [key, value] of Object.entries(input.equals ?? {})) query = query.eq(key, value);
    if (input.in) query = query.in(input.in.column, [...input.in.values]);
    if (input.afterId) query = query.gt("id", input.afterId);
    const ordered = input.table === "prospect_enrichment_item_targets" ? query.order("item_id", { ascending: true }).order("target_table", { ascending: true }).order("target_id", { ascending: true }) : query.order("id", { ascending: true });
    return await ordered.limit(input.limit) as unknown as EnrichmentReadResult;
  } };
}

function evidence(spec: Spec, row: Record<string, unknown>, now: Date): ProspectEnrichmentEvidence {
  const data = row as Record<string, JsonValue>;
  // Explicit query columns, not SELECT *, define the public business-evidence projection.
  const semantic = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "created_at"));
  const date = evidenceDate(row);
  const urls = [row.source_url, row.requested_url, row.final_url, row.coordinate_source_url, row.boundary_source_url, ...(Array.isArray(row.evidence_urls) ? row.evidence_urls : [])].map(safeEvidenceUrl).filter((url): url is string => url !== null);
  return { id: row.id as string, table: spec.table, data, semanticSha256: prospectEnrichmentProtocolHash(semantic), date, dateLabel: evidenceDateLabel(date), freshness: spec.freshness ? evidenceRefreshState(date, spec.freshness, now) : "unknown", sourceUrls: [...new Set(urls)],
    legacyCriteria: spec.table === "gta_prospect_qualification_assessments" ? projectLegacyCriteria(row.id as string, data.criteria) : [],
    qualificationCategory: spec.section === "qualification" ? qualificationDisplayCategory(row.selection_disposition ?? row.qualification_state) : null, enrichment: [], retractions: [], profileSource: null };
}
function cursorFor(firmId: string, table: string, id: string): string { return Buffer.from(JSON.stringify({ firmId, table, id }), "utf8").toString("base64url"); }
function decodeCursor(value: string, firmId: string, table: string): string {
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); if (parsed.firmId === firmId && parsed.table === table && uuid.test(parsed.id)) return parsed.id; } catch { /* Invalid cursors never change the selected firm. */ }
  throw new ProspectEnrichmentReadError("The evidence cursor does not belong to this firm and source.", 422);
}
async function appliedRows(client: ProspectEnrichmentReadClient, spec: Spec, firmId: string, values: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (!spec.batch) return values;
  const key = spec.batch === "core" ? "import_batch_id" : "evidence_import_batch_id";
  const ids = [...new Set(values.flatMap((row) => typeof row[key] === "string" ? [row[key] as string] : []))];
  if (!ids.length) return values;
  const batches = rows(await client.read({ table: spec.batch === "core" ? "gta_prospect_import_batches" : "gta_prospect_supplemental_evidence_import_batches", columns: "id,state", equals: { firm_id: firmId }, in: { column: "id", values: ids }, limit: ids.length }));
  if (batches.length !== ids.length) throw new ProspectEnrichmentReadError("Import provenance could not be verified.");
  const accepted = new Set(batches.filter((row) => row.state === "applied").map((row) => row.id));
  return values.filter((row) => row[key] === null || row[key] === undefined || accepted.has(row[key]));
}
async function readSource(client: ProspectEnrichmentReadClient, spec: Spec, firmId: string, limit: number, now: Date, afterId?: string) {
  const values = rows(await client.read({ table: spec.table, columns: spec.columns, equals: { firm_id: firmId }, afterId, limit: limit + 1 }));
  const page = values.slice(0, limit);
  const accepted = await appliedRows(client, spec, firmId, page);
  const items = accepted.map((row) => evidence(spec, row, now));
  const enriched = spec.table === "prospect_enrichment_packages" ? await withPackageEvents(client, items) : items;
  return { items: enriched, nextCursor: values.length > limit ? cursorFor(firmId, spec.table, page[page.length - 1].id as string) : null };
}
async function withPackageEvents(client: ProspectEnrichmentReadClient, values: readonly ProspectEnrichmentEvidence[]): Promise<readonly ProspectEnrichmentEvidence[]> {
  const result: ProspectEnrichmentEvidence[] = []; let count = 0;
  for (const item of values) {
    const events: Record<string, unknown>[] = []; let afterId: string | undefined;
    for (;;) {
      const page = rows(await client.read({ table: "prospect_enrichment_events", columns: "id,package_id,event_key,event_type,details,created_at", equals: { package_id: item.id }, afterId, limit: 101 }));
      events.push(...page.slice(0, 100)); count += Math.min(page.length, 100);
      if (count > 5000) throw new ProspectEnrichmentReadError("Package event history exceeds the supported read size.");
      if (page.length <= 100) break;
      afterId = page[99].id as string;
    }
    result.push({ ...item, events });
  }
  return result;
}
async function readFirm(client: ProspectEnrichmentReadClient, firmId: string) {
  const values = rows(await client.read({ table: "gta_prospect_firms", columns: "id,display_name,website_url,source_record_key,enrichment_revision", equals: { id: firmId }, limit: 1 }));
  if (!values.length) throw new ProspectEnrichmentReadError("The prospect firm was not found.", 404);
  const value = values[0];
  if (value.id !== firmId || typeof value.display_name !== "string" || typeof value.source_record_key !== "string") throw new ProspectEnrichmentReadError("The firm identity could not be verified.");
  return { id: firmId, displayName: value.display_name, websiteUrl: safeEvidenceUrl(value.website_url), sourceRecordKey: value.source_record_key, revision: String(value.enrichment_revision ?? "0") };
}

async function withLineage(client: ProspectEnrichmentReadClient, values: readonly ProspectEnrichmentEvidence[]): Promise<readonly ProspectEnrichmentEvidence[]> {
  if (!values.length) return values;
  const targetIds = [...new Set(values.map((item) => item.id))];
  const result = await client.read({ table: "prospect_enrichment_item_targets", columns: "item_id,target_table,target_id,target_row_sha256", in: { column: "target_id", values: targetIds }, limit: 1001 });
  if (result.error || !Array.isArray(result.data) || result.data.length > 1000 || result.data.some((row) => !isEvidenceObject(row))) throw new ProspectEnrichmentReadError("Evidence lineage could not be fully loaded.");
  const maps = result.data as Record<string, unknown>[];
  const targetKeys = new Set(values.map((item) => `${item.table}:${item.id}`));
  const relevant = maps.filter((row) => targetKeys.has(`${row.target_table}:${row.target_id}`));
  const ids = [...new Set(relevant.flatMap((row) => typeof row.item_id === "string" ? [row.item_id] : []))];
  if (!ids.length) return values;
  const items = rows(await client.read({ table: "prospect_enrichment_items", columns: "id,package_id,source_event_id,client_item_id,item_kind,data,source_ids,observed_at,observed_on,provenance_state", in: { column: "id", values: ids }, limit: ids.length }));
  if (items.length !== ids.length) throw new ProspectEnrichmentReadError("A linked evidence item is missing.");
  const packageIds = [...new Set(items.flatMap((item) => typeof item.package_id === "string" ? [item.package_id] : []))];
  const packages = rows(await client.read({ table: "prospect_enrichment_packages", columns: "id,firm_id,payload,payload_sha256,state,run_id", in: { column: "id", values: packageIds }, limit: packageIds.length }));
  if (packages.length !== packageIds.length) throw new ProspectEnrichmentReadError("A linked research package is missing.");
  const events = rows(await client.read({ table: "prospect_enrichment_events", columns: "id,package_id,event_type,details,created_at", equals: { event_type: "evidence_retracted" }, in: { column: "package_id", values: packageIds }, limit: 1001 }));
  if (events.length > 1000) throw new ProspectEnrichmentReadError("Retraction history could not be fully loaded.");
  return values.map((value) => {
    const linkedIds = new Set(relevant.filter((row) => row.target_table === value.table && row.target_id === value.id).map((row) => row.item_id));
    const linked = items.filter((item) => linkedIds.has(item.id)).map((item) => {
      const parent = packages.find((candidate) => candidate.id === item.package_id)!;
      if (parent.firm_id !== value.data.firm_id || parent.state !== "applied") throw new ProspectEnrichmentReadError("Linked evidence does not have matching applied firm provenance.");
      const payload = isEvidenceObject(parent.payload) ? parent.payload : {};
      const sourceIds = Array.isArray(item.source_ids) ? item.source_ids.filter((id): id is string => typeof id === "string") : [];
      const sources = Array.isArray(payload.sources) ? payload.sources.filter((source) => isEvidenceObject(source) && sourceIds.includes(String(source.sourceId))) : [];
      return { packageId: parent.id as string, itemId: item.id as string, sourceEventId: typeof item.source_event_id === "string" ? item.source_event_id : null, data: item.data, sources, sourceIds, originalResearch: payload.originalResearch ?? null, runId: typeof payload.runId === "string" ? payload.runId : null, payloadSha256: typeof parent.payload_sha256 === "string" ? parent.payload_sha256 : null };
    });
    const retractions = events.filter((event) => isEvidenceObject(event.details) && event.details.targetTable === value.table && event.details.targetId === value.id);
    return { ...value, enrichment: linked, retractions };
  });
}


async function firmRetractions(client: ProspectEnrichmentReadClient, firmId: string): Promise<readonly Record<string, unknown>[]> {
  const packageIds: string[] = [];
  let afterId: string | undefined;
  for (;;) {
    const page = rows(await client.read({ table: "prospect_enrichment_packages", columns: "id,firm_id", equals: { firm_id: firmId }, afterId, limit: 101 }));
    packageIds.push(...page.slice(0, 100).map((row) => row.id as string));
    if (packageIds.length > 5000) throw new ProspectEnrichmentReadError("The complete firm retraction history could not be loaded.");
    if (page.length <= 100) break;
    afterId = page[99].id as string;
  }
  const result: Record<string, unknown>[] = [];
  for (let offset = 0; offset < packageIds.length; offset += 100) {
    let cursor: string | undefined;
    for (;;) {
      const page = rows(await client.read({ table: "prospect_enrichment_events", columns: "id,package_id,event_type,details,created_at", equals: { event_type: "evidence_retracted" }, in: { column: "package_id", values: packageIds.slice(offset, offset + 100) }, afterId: cursor, limit: 101 }));
      result.push(...page.slice(0, 100));
      if (result.length > 5000) throw new ProspectEnrichmentReadError("The complete firm retraction history could not be loaded.");
      if (page.length <= 100) break;
      cursor = page[99].id as string;
    }
  }
  const parentIds = [...new Set(result.map((event) => String(event.package_id)))];
  const parents: Record<string, unknown>[] = [];
  for (let offset = 0; offset < parentIds.length; offset += 100) parents.push(...rows(await client.read({ table: "prospect_enrichment_packages", columns: "id,firm_id,payload", equals: { firm_id: firmId }, in: { column: "id", values: parentIds.slice(offset, offset + 100) }, limit: 100 })));
  return result.map((event) => {
    const details = isEvidenceObject(event.details) ? event.details : {};
    const sourceIds = Array.isArray(details.sourceIds) ? details.sourceIds.filter((value): value is string => typeof value === "string") : [];
    const parent = parents.find((value) => value.id === event.package_id);
    const payload = isEvidenceObject(parent?.payload) ? parent.payload : {};
    const replacementSources = Array.isArray(payload.sources) ? payload.sources.filter((value) => isEvidenceObject(value) && sourceIds.includes(String(value.sourceId))) : [];
    return { ...event, replacementSources, replacementSourceState: !sourceIds.length ? "not_recorded" : replacementSources.length === sourceIds.length ? "available" : "incomplete" };
  });
}
function matchingRetractions(events: readonly Record<string, unknown>[], table: unknown, id: unknown) {
  return events.filter((event) => isEvidenceObject(event.details) && event.details.targetTable === table && event.details.targetId === id);
}
async function resolveProfileChoice(client: ProspectEnrichmentReadClient, choice: ProspectEnrichmentEvidence, firmId: string, now: Date, retractions: readonly Record<string, unknown>[]): Promise<ProspectEnrichmentEvidence> {
  const table = choice.data.target_table, id = choice.data.target_id, selector = choice.data.source_selector;
  if (typeof table !== "string" || typeof id !== "string" || typeof selector !== "string" || !uuid.test(id)) throw new ProspectEnrichmentReadError("A selected profile source is incomplete.");
  const spec = specs.find((candidate) => candidate.table === table);
  if (!spec && table !== "prospect_enrichment_items") throw new ProspectEnrichmentReadError("A selected profile source is not an allowed evidence table.");
  const source = rows(await client.read({ table, columns: spec?.columns ?? "id,package_id,item_kind,data,source_ids,source_event_id,observed_at,observed_on,provenance_state", equals: { id, ...(table === "prospect_enrichment_items" ? {} : { firm_id: firmId }) }, limit: 1 }))[0];
  if (!source) throw new ProspectEnrichmentReadError("The selected profile source could not be loaded.");
  let lineage: ProspectEnrichmentEvidence["enrichment"] = [];
  if (table === "prospect_enrichment_items") {
    if (typeof source.package_id !== "string") throw new ProspectEnrichmentReadError("Selected source package is missing.");
    const parent = rows(await client.read({ table: "prospect_enrichment_packages", columns: "id,firm_id,state,payload,payload_sha256", equals: { id: source.package_id, firm_id: firmId }, limit: 1 }))[0];
    if (!parent || parent.state !== "applied") throw new ProspectEnrichmentReadError("Selected source does not have applied firm provenance.");
    const payload = isEvidenceObject(parent.payload) ? parent.payload : {};
    const sourceIds = Array.isArray(source.source_ids) ? source.source_ids.filter((value): value is string => typeof value === "string") : [];
    lineage = [{ packageId: parent.id as string, itemId: id, sourceEventId: typeof source.source_event_id === "string" ? source.source_event_id : null, data: source.data, sources: Array.isArray(payload.sources) ? payload.sources.filter((value) => isEvidenceObject(value) && sourceIds.includes(String(value.sourceId))) : [], sourceIds, originalResearch: payload.originalResearch ?? null, runId: typeof payload.runId === "string" ? payload.runId : null, payloadSha256: typeof parent.payload_sha256 === "string" ? parent.payload_sha256 : null }];
  } else {
    if (table === "prospect_enrichment_packages" && source.state !== "applied") throw new ProspectEnrichmentReadError("Selected source package has not been applied.");
    const accepted = await appliedRows(client, spec!, firmId, [source]);
    if (!accepted.length) throw new ProspectEnrichmentReadError("Selected profile evidence has not been applied.");
    lineage = (await withLineage(client, [evidence(spec!, source, now)]))[0].enrichment;
  }
  const selected = readEvidenceJsonPointer(source, selector);
  if (!selected.found || prospectEnrichmentProtocolHash(selected.value) !== prospectEnrichmentProtocolHash(choice.data.selected_value)) throw new ProspectEnrichmentReadError("The selected profile value no longer matches its exact source.");
  return { ...choice, retractions: matchingRetractions(retractions, table, id), profileSource: { table, id, selector, data: source, enrichment: lineage } };
}

/** Auth belongs to the calling operator route. No source URL or path is fetched here. */
export async function getProspectEnrichmentFirmDetail(input: Readonly<{ firmId: string; client?: ProspectEnrichmentReadClient; now?: Date }>): Promise<ProspectEnrichmentFirmDetail> {
  requireUuid(input.firmId);
  const client = input.client ?? await defaultClient();
  const now = input.now ?? new Date();
  const firm = await readFirm(client, input.firmId);
  const results = await Promise.allSettled(specs.map(async (spec) => { const page = await readSource(client, spec, input.firmId, 25, now); return { ...page, items: await withLineage(client, page.items) }; }));
  const sections = sectionOrder.map((key): ProspectEnrichmentEvidenceSection => {
    const items: ProspectEnrichmentEvidence[] = []; const nextCursors: Record<string, string> = {}; let errorId: string | null = null;
    specs.forEach((spec, index) => { if (spec.section !== key) return; const result = results[index]; if (result.status === "rejected") { errorId ??= result.reason instanceof ProspectEnrichmentReadError ? result.reason.errorId : randomUUID(); return; } items.push(...result.value.items); if (result.value.nextCursor) nextCursors[spec.table] = result.value.nextCursor; });
    return { key, title: PROSPECT_ENRICHMENT_SECTION_TITLES[key], state: errorId ? "error" : items.length ? "available" : "empty", items, errorId, incomplete: Boolean(errorId) || Object.keys(nextCursors).length > 0, nextCursors };
  });
  const history = sections.find((section) => section.key === "history")!;
  let choices = history.items.filter((item) => item.table === "prospect_enrichment_profile_choices");
  let choiceCursor = history.nextCursors.prospect_enrichment_profile_choices;
  // Exhaust choice chains before deciding which selected value is current.
  let choiceReadError: unknown = null;
  try { while (choiceCursor) {
    if (choices.length >= 5000) throw new ProspectEnrichmentReadError("The complete profile choice history could not be loaded.");
    const spec = specs.find((candidate) => candidate.table === "prospect_enrichment_profile_choices")!;
    const page = await readSource(client, spec, input.firmId, 100, now, decodeCursor(choiceCursor, input.firmId, spec.table));
    choices = [...choices, ...page.items]; choiceCursor = page.nextCursor ?? "";
  } } catch (cause) { choiceReadError = cause; choices = []; }
  const superseded = new Set(choices.map((item) => item.data.supersedes_choice_id).filter((id): id is string => typeof id === "string"));
  const currentChoices = choices.filter((choice) => !superseded.has(choice.id));
  let profileChoices: ProspectEnrichmentEvidence[] = [];
  let renderedSections = sections;
  try {
    if (choiceReadError) throw choiceReadError;
    const choiceResult = results[specs.findIndex((spec) => spec.table === "prospect_enrichment_profile_choices")];
    if (choiceResult.status === "rejected") throw choiceResult.reason;
    const retractions = await firmRetractions(client, input.firmId);
    renderedSections = sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, retractions: matchingRetractions(retractions, item.table, item.id) })) }));
    const resolved = await Promise.allSettled(currentChoices.map((choice) => resolveProfileChoice(client, choice, input.firmId, now, retractions)));
    profileChoices = resolved.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failed = resolved.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  } catch (cause) {
    const errorId = cause instanceof ProspectEnrichmentReadError ? cause.errorId : randomUUID();
    renderedSections = renderedSections.map((section) => section.key === "profile" || section.key === "history" ? { ...section, state: "error" as const, errorId, incomplete: true } : section);
  }
  const nameChoice = profileChoices.find((choice) => choice.data.field_key === "firmName" && !choice.retractions.length);
  const websiteChoice = profileChoices.find((choice) => choice.data.field_key === "websiteUrl");
  const displayedFirm = { ...firm, displayName: typeof nameChoice?.data.selected_value === "string" ? nameChoice.data.selected_value : firm.displayName, websiteUrl: websiteChoice ? websiteChoice.retractions.length ? null : safeEvidenceUrl(websiteChoice.data.selected_value) : firm.websiteUrl };
  const after = await readFirm(client, input.firmId);
  return { firm: displayedFirm, sections: renderedSections, complete: renderedSections.every((section) => !section.incomplete) && after.revision === firm.revision, revisionStable: after.revision === firm.revision, profileChoices, readAt: now.toISOString(), rendererVersion: "prospect-enrichment/v1" };
}

/** Stable keyset pages are scoped to one canonical firm and one fixed source table. */
export async function getProspectEnrichmentFirmHistory(input: Readonly<{ firmId: string; table: string; limit?: number; cursor?: string; client?: ProspectEnrichmentReadClient; now?: Date }>): Promise<Readonly<{ table: string; items: readonly ProspectEnrichmentEvidence[]; nextCursor: string | null; revision: string; revisionStable: boolean }>> {
  requireUuid(input.firmId);
  const spec = specs.find((candidate) => candidate.table === input.table);
  if (!spec) throw new ProspectEnrichmentReadError("This evidence source is not available in prospect history.", 422);
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProspectEnrichmentReadError("History pages must contain 1 to 100 records.", 422);
  const client = input.client ?? await defaultClient();
  const before = await readFirm(client, input.firmId);
  const page = await readSource(client, spec, input.firmId, limit, input.now ?? new Date(), input.cursor ? decodeCursor(input.cursor, input.firmId, spec.table) : undefined);
  const retractions = await firmRetractions(client, input.firmId);
  const items = await withLineage(client, page.items);
  const after = await readFirm(client, input.firmId);
  return { table: spec.table, ...page, revision: before.revision, revisionStable: before.revision === after.revision, items: items.map((item) => ({ ...item, retractions: matchingRetractions(retractions, item.table, item.id) })) };
}
