import "server-only";

import type { EnrichmentReadQuery, ProspectEnrichmentReadClient } from "@/lib/prospect-enrichment-reader";
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";
import { normalizedPracticeAreaKey } from "@/lib/prospect-display-normalization";

export type GtaProspectCanonicalService = Readonly<{ id: string; firmId: string; name: string }>;
const SERVICE_TABLE = "prospect_service_observations";
const BATCH_SIZE = 100;
const PAGE_SIZE = 500;
const MAX_ROWS = 5_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function failure(): Error { return new Error("Canonical prospect services could not be fully verified."); }
function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += BATCH_SIZE) result.push(values.slice(offset, offset + BATCH_SIZE));
  return result;
}
async function rows(client: ProspectEnrichmentReadClient, query: EnrichmentReadQuery): Promise<Record<string, unknown>[]> {
  const result = await client.read(query);
  if (result.error || !Array.isArray(result.data) || result.data.some(value => !object(value))) throw failure();
  return result.data as Record<string, unknown>[];
}
async function allRows(client: ProspectEnrichmentReadClient, query: Omit<EnrichmentReadQuery, "limit" | "afterId">): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let afterId: string | undefined;
  for (;;) {
    const page = await rows(client, { ...query, afterId, limit: PAGE_SIZE + 1 });
    if (page.length > PAGE_SIZE + 1 || page.some(row => typeof row.id !== "string" || !uuid.test(row.id))) throw failure();
    for (const row of page.slice(0, PAGE_SIZE)) {
      const id = row.id as string;
      if (seen.has(id) || (afterId && id <= afterId)) throw failure();
      seen.add(id); result.push(row);
    }
    if (result.length > MAX_ROWS) throw failure();
    if (page.length <= PAGE_SIZE) return result;
    afterId = page[PAGE_SIZE - 1].id as string;
  }
}
async function defaultClient(): Promise<ProspectEnrichmentReadClient> {
  const { supabaseAdmin } = await import("@/lib/supabase-admin");
  return { async read(input) {
    let query = supabaseAdmin.from(input.table).select(input.columns);
    for (const [key, value] of Object.entries(input.equals ?? {})) query = query.eq(key, value);
    if (input.in) query = query.in(input.in.column, [...input.in.values]);
    if (input.afterId) query = query.gt("id", input.afterId);
    const ordered = input.table === "prospect_enrichment_item_targets"
      ? query.order("item_id").order("target_id") : query.order("id");
    return await ordered.limit(input.limit);
  } };
}

/** Only the calling operator route authorizes this read; no URLs are fetched. */
export async function listGtaProspectCanonicalServices(input: Readonly<{ firmIds: readonly string[]; client?: ProspectEnrichmentReadClient }>): Promise<readonly GtaProspectCanonicalService[]> {
  const firmIds = [...new Set(input.firmIds)].sort();
  if (firmIds.some(id => !uuid.test(id))) throw failure();
  if (!firmIds.length) return [];
  const client = input.client ?? await defaultClient();
  const result: GtaProspectCanonicalService[] = [];
  for (const firmBatch of chunks(firmIds)) {
    const allowedFirms = new Set(firmBatch);
    const services = await allRows(client, { table: SERVICE_TABLE, columns: "id,firm_id,service_name", in: { column: "firm_id", values: firmBatch } });
    if (services.some(row => typeof row.firm_id !== "string" || !allowedFirms.has(row.firm_id) || typeof row.service_name !== "string" || !row.service_name.trim())) throw failure();
    if (!services.length) continue;
    const packages = await allRows(client, { table: "prospect_enrichment_packages", columns: "id,firm_id,state", in: { column: "firm_id", values: firmBatch } });
    if (packages.some(row => typeof row.firm_id !== "string" || !allowedFirms.has(row.firm_id) || typeof row.state !== "string")) throw failure();
    const parents = new Map(packages.map(row => [row.id as string, row]));
    const targets: Record<string, unknown>[] = [];
    for (const targetIds of chunks(services.map(row => row.id as string))) {
      const page = await rows(client, { table: "prospect_enrichment_item_targets", columns: "item_id,target_table,target_id", equals: { target_table: SERVICE_TABLE }, in: { column: "target_id", values: targetIds }, limit: 1_001 });
      if (page.length > 1_000 || page.some(row => row.target_table !== SERVICE_TABLE || typeof row.target_id !== "string" || !targetIds.includes(row.target_id) || typeof row.item_id !== "string" || !uuid.test(row.item_id))) throw failure();
      targets.push(...page);
    }
    const items: Record<string, unknown>[] = [];
    for (const itemIds of chunks([...new Set(targets.map(row => row.item_id as string))])) {
      const page = await rows(client, { table: "prospect_enrichment_items", columns: "id,package_id", in: { column: "id", values: itemIds }, limit: itemIds.length });
      if (page.length !== itemIds.length || page.some(row => typeof row.id !== "string" || !itemIds.includes(row.id) || typeof row.package_id !== "string") || new Set(page.map(row => row.id)).size !== page.length) throw failure();
      items.push(...page);
    }
    const itemParents = new Map(items.map(row => [row.id as string, parents.get(row.package_id as string)]));
    const retractions = new Map<string, Set<string>>();
    for (const packageIds of chunks(packages.map(row => row.id as string))) {
      const events = await allRows(client, { table: "prospect_enrichment_events", columns: "id,package_id,event_type,details", equals: { event_type: "evidence_retracted" }, in: { column: "package_id", values: packageIds } });
      for (const event of events) {
        const parent = parents.get(String(event.package_id));
        if (!parent || event.event_type !== "evidence_retracted" || !object(event.details)) throw failure();
        if (parent.state !== "applied" || event.details.targetTable !== SERVICE_TABLE) continue;
        if (typeof event.details.targetId !== "string" || !uuid.test(event.details.targetId)) throw failure();
        const firmId = parent.firm_id as string;
        const ids = retractions.get(firmId) ?? new Set<string>();
        ids.add(event.details.targetId); retractions.set(firmId, ids);
      }
    }
    const byTarget = new Map<string, Record<string, unknown>[]>();
    for (const target of targets) {
      const linked = byTarget.get(target.target_id as string) ?? [];
      linked.push(target); byTarget.set(target.target_id as string, linked);
    }
    for (const service of services) {
      const id = service.id as string, firmId = service.firm_id as string;
      // Unlinked legacy canonical rows remain evidence, as in firm detail.
      // Every linked item must have matching applied firm provenance.
      if ((byTarget.get(id) ?? []).some(target => { const parent = itemParents.get(target.item_id as string); return !parent || parent.state !== "applied" || parent.firm_id !== firmId; })) continue;
      if (retractions.get(firmId)?.has(id)) continue;
      result.push({ id, firmId, name: service.service_name as string });
    }
    if (result.length > MAX_ROWS) throw failure();
  }
  return result;
}

/** Preserve existing source values; only append missing canonical service names. */
export function attachGtaProspectCanonicalServices(records: readonly ReconciledGtaProspect[], services: readonly GtaProspectCanonicalService[]): ReconciledGtaProspect[] {
  const byFirm = new Map<string, string[]>();
  for (const service of services) { const names = byFirm.get(service.firmId) ?? []; names.push(service.name); byFirm.set(service.firmId, names); }
  return records.map(record => {
    const names = record.databaseFirmId ? byFirm.get(record.databaseFirmId) : undefined;
    if (!names?.length) return record;
    const practices = [...record.practiceAreas];
    const keys = new Set(practices.map(normalizedPracticeAreaKey));
    for (const name of names) { const key = normalizedPracticeAreaKey(name); if (!keys.has(key)) { practices.push(name); keys.add(key); } }
    return { ...record, practiceAreas: practices };
  });
}
