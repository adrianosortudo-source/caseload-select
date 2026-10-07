import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { attachGtaProspectCanonicalServices, listGtaProspectCanonicalServices } from "../gta-prospect-service-reader";
import type { EnrichmentReadQuery, ProspectEnrichmentReadClient } from "../prospect-enrichment-reader";
import { filterReconciledGtaProspects } from "../gta-prospect-records";
import { RECONCILED_GTA_PROSPECTS } from "@/app/admin/prospects/reconciled-prospects";
import { normalizedPracticeAreaLabel, uniqueNormalizedLabels } from "../prospect-display-normalization";

const id = (n: number) => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const firm = "de1e6289-836f-487c-9e98-913f88c3db73", other = id(2);
type Fixtures = Record<string, Record<string, unknown>[]>;
function clientFor(fixtures: Fixtures): { client: ProspectEnrichmentReadClient; read: ReturnType<typeof vi.fn> } {
  const read = vi.fn(async (query: EnrichmentReadQuery) => {
    const rows = (fixtures[query.table] ?? []).filter(row => Object.entries(query.equals ?? {}).every(([key,value]) => row[key] === value))
      .filter(row => !query.in || query.in.values.includes(String(row[query.in.column])))
      .filter(row => !query.afterId || String(row.id) > query.afterId)
      .sort((a,b) => String(a.id ?? a.item_id).localeCompare(String(b.id ?? b.item_id)));
    return { data: rows.slice(0,query.limit), error: null };
  });
  return { client: { read }, read };
}
function linked(state = "applied", packageFirm = firm): Fixtures {
  return {
    prospect_service_observations: [{ id:id(10),firm_id:firm,service_name:"Notary availability" }],
    prospect_enrichment_packages: [{ id:id(20),firm_id:packageFirm,state }],
    prospect_enrichment_items: [{ id:id(30),package_id:id(20) }],
    prospect_enrichment_item_targets: [{ item_id:id(30),target_table:"prospect_service_observations",target_id:id(10) }],
  };
}

describe("canonical services in the existing Admin list", () => {
  it("reads an applied service with exact firm provenance and retains its saved name", async () => {
    const { client } = clientFor(linked());
    await expect(listGtaProspectCanonicalServices({firmIds:[firm],client})).resolves.toEqual([{id:id(10),firmId:firm,name:"Notary availability"}]);
  });
  it("retains canonical legacy observations without fabricated package lineage", async () => {
    const { client } = clientFor({prospect_service_observations:[{id:id(10),firm_id:firm,service_name:"Legacy service"}]});
    await expect(listGtaProspectCanonicalServices({firmIds:[firm],client})).resolves.toEqual([{id:id(10),firmId:firm,name:"Legacy service"}]);
  });
  it.each(["received","ready_for_review","identity_hold","evidence_hold","rejected","superseded"])("excludes observations linked to %s packages", async state => {
    const { client } = clientFor(linked(state));
    await expect(listGtaProspectCanonicalServices({firmIds:[firm],client})).resolves.toEqual([]);
  });
  it("does not borrow another firm's applied package or same-named record", async () => {
    const { client } = clientFor(linked("applied",other));
    await expect(listGtaProspectCanonicalServices({firmIds:[firm,other],client})).resolves.toEqual([]);
  });
  it("excludes a retracted service even when retraction belongs to a later applied package", async () => {
    const fixtures = linked();
    fixtures.prospect_enrichment_packages.push({id:id(21),firm_id:firm,state:"applied"});
    fixtures.prospect_enrichment_events=[{id:id(40),package_id:id(21),event_type:"evidence_retracted",details:{targetTable:"prospect_service_observations",targetId:id(10)}}];
    const { client } = clientFor(fixtures);
    await expect(listGtaProspectCanonicalServices({firmIds:[firm],client})).resolves.toEqual([]);
  });
  it("does not let unapplied or another firm's retraction hide this firm's evidence", async () => {
    const fixtures = linked();
    fixtures.prospect_enrichment_packages.push({id:id(21),firm_id:other,state:"applied"},{id:id(22),firm_id:firm,state:"evidence_hold"});
    fixtures.prospect_enrichment_events=[id(21),id(22)].map((package_id,index)=>({id:id(40+index),package_id,event_type:"evidence_retracted",details:{targetTable:"prospect_service_observations",targetId:id(10)}}));
    const { client } = clientFor(fixtures);
    await expect(listGtaProspectCanonicalServices({firmIds:[firm,other],client})).resolves.toHaveLength(1);
  });
  it("fails visibly on incomplete lineage rather than silently claiming verified coverage", async () => {
    const fixtures = linked(); fixtures.prospect_enrichment_items=[];
    const { client } = clientFor(fixtures);
    await expect(listGtaProspectCanonicalServices({firmIds:[firm],client})).rejects.toThrow("could not be fully verified");
  });
  it("loads continuation pages rather than truncating services at the first 500", async () => {
    const {client,read} = clientFor({prospect_service_observations:Array.from({length:503},(_,n)=>({id:id(100+n),firm_id:firm,service_name:`Service ${n}`}))});
    expect(await listGtaProspectCanonicalServices({firmIds:[firm],client})).toHaveLength(503);
    expect(read.mock.calls.filter(([query])=>query.table==="prospect_service_observations")).toHaveLength(2);
    expect(read.mock.calls.filter(([query])=>query.table==="prospect_service_observations")[1][0].afterId).toBe(id(599));
  });
  it("batches firm selectors, skips unrelated lineage reads for empty services, and never reads on empty selection", async () => {
    const {client,read} = clientFor({});
    const firms = Array.from({length:203},(_,n)=>id(1_000+n));
    await listGtaProspectCanonicalServices({firmIds:[...firms,firms[0]],client});
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.every(([query])=>query.table==="prospect_service_observations" && query.in!.values.length<=100)).toBe(true);
    read.mockClear();
    expect(await listGtaProspectCanonicalServices({firmIds:[],client})).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
  it("supports existing text, normalized practice and city filters without changing source values or linking an unbound twin", () => {
    const record={...RECONCILED_GTA_PROSPECTS[0],id:"q50-adillaw-ca",databaseFirmId:firm,practiceAreas:["corporate matters"],officeCities:["Milton","Mississauga"]};
    const twin={...record,id:"legacy-adil",databaseFirmId:null,practiceAreas:[]};
    const result=attachGtaProspectCanonicalServices([record,twin],[{id:id(10),firmId:firm,name:"Notary availability"},{id:id(11),firmId:firm,name:"CORPORATE MATTERS"},{id:id(12),firmId:firm,name:"notary  availability"},{id:id(13),firmId:other,name:"Wrong firm service"}]);
    expect(result[0].practiceAreas).toEqual(["corporate matters","Notary availability"]);
    expect(record.practiceAreas).toEqual(["corporate matters"]);
    expect(result[1].practiceAreas).toEqual([]);
    expect(uniqueNormalizedLabels(result.flatMap(r=>r.practiceAreas),normalizedPracticeAreaLabel)).toEqual(["Corporate Matters","Notary Availability"]);
    expect(filterReconciledGtaProspects(result,{query:"Notary availability",practiceArea:"notary availability",city:"Mississauga"}).map(r=>r.id)).toEqual([record.id]);
    expect(filterReconciledGtaProspects(result,{practiceArea:"notary availability",city:"Toronto"})).toEqual([]);
    expect(filterReconciledGtaProspects(result,{query:"Wrong firm service"})).toEqual([]);
  });
});
