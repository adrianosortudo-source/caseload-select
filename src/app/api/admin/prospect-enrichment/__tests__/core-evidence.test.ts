import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
import type { ProspectEnrichmentEnvelope, ProspectEnrichmentObservation } from "@/lib/prospect-enrichment-contract";
import { collectProspectEnrichmentCoreOptions, deriveProspectEnrichmentNewCoreInput, type ProspectEnrichmentCoreEvidence } from "@/lib/prospect-enrichment-core-evidence";
import { readProspectEnrichmentNewCoreOptions } from "../_core-options";
import type { ReadDatabase } from "../_package-read";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
function fixture() {
  const source: ProspectEnrichmentEnvelope["sources"][number] = { sourceId: "official-site", url: "https://synthetic-legal.example/team",
    requestedUrl: "https://synthetic-legal.example/team", finalUrl: "https://synthetic-legal.example/team",
    policyState: "public-source", publicationLabel: null, publicationPrecision: "unknown", publisher: "Synthetic Legal",
    observedAt: null, observedOn: "2026-09-23", retrievedAt: null, retrievalMethod: "public_html", retrievalOutcome: "success",
    httpStatus: 200, bodySha256: null, excerpt: "Synthetic Legal has offices in Toronto and Ottawa.", missingProvenanceReason: null };
  const observation = (observationId: string, kind: string, data: unknown) => ({ observationId, kind, data, evidenceState: "asserted",
    retractionReason: null, retractionSourceIds: [], missingProvenanceReason: null, sourceIds: [source.sourceId],
    observedAt: null, observedOn: "2026-09-23", existingRecord: null }) as ProspectEnrichmentObservation;
  const payload = { schemaVersion: "prospect-enrichment/v1", runId: "synthetic-run", packageId: "synthetic-package", supersedesPackageId: null,
    sourceSystem: "synthetic-research", sourceName: "synthetic-research", generatedAt: "2026-09-23T12:00:00Z", mode: "propose",
    subject: { researchKey: "synthetic-legal", databaseFirmId: null as string | null, stableFirmId: null, sourceRecordKey: "synthetic-legal",
      canonicalDomain: "synthetic-legal.example", displayName: "Synthetic Legal", identityState: "unresolved" }, sources: [source],
    observations: [
      observation("toronto", "firm_fit", { practiceAreas: [], office: { city: "Toronto", province: "ON", address: null }, lawyerCount: 3, countQualifier: "exact", independence: "independent", fit: "pass" }),
      observation("ottawa", "firm_fit", { practiceAreas: [], office: { city: "Ottawa", province: "ON", address: null }, lawyerCount: 3, countQualifier: "exact", independence: "independent", fit: "pass" }),
      observation("family", "service", { name: "Family law", matterFit: "strong-match" }),
      observation("civil", "service", { name: "Civil litigation", matterFit: "partial-match" }),
      observation("roster", "roster", { lawyerCount: 3, countQualifier: "exact", display: "3 lawyers", includedNames: ["One", "Two", "Three"], excludedPeople: [] }),
    ], assessment: null, originalResearch: { sourcePath: "synthetic/firm.json", sourcePointer: "/firm", sourceSha256: "a".repeat(64), contentSha256: "b".repeat(64), content: {}, unmappedPaths: [] },
    controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false } } satisfies ProspectEnrichmentEnvelope;
  const items = payload.observations.map((item, index) => ({ itemId: id(index + 10), clientItemId: "obs:" + item.observationId, sourceIds: [source.sourceId] }));
  const evidence: ProspectEnrichmentCoreEvidence = { firmName: { sourceId: source.sourceId }, city: { itemId: id(10), sourceId: source.sourceId },
    officeCities: [{ itemId: id(10), sourceId: source.sourceId }, { itemId: id(11), sourceId: source.sourceId }],
    websiteUrl: { sourceId: source.sourceId }, practiceAreas: [{ itemId: id(12), sourceId: source.sourceId }, { itemId: id(13), sourceId: source.sourceId }],
    roster: { itemId: id(14), sourceId: source.sourceId } };
  const note = "Synthetic Legal in Toronto is a separate firm, supported by the roster reviewed on 2026-09-23.";
  const options = () => collectProspectEnrichmentCoreOptions({ payload, items, sourceRecordKey: "synthetic-legal", identityHolds: [] });
  return { payload, items, evidence, note, options };
}
function database(tables: Record<string, Record<string, unknown>[]> = {}, failure?: string) {
  return { from(table: string) {
    let selected = tables[table] ?? [];
    const query = { select: () => query, eq: (field: string, value: unknown) => { selected = selected.filter((row) => row[field] === value); return query; },
      in: (field: string, values: unknown[]) => { selected = selected.filter((row) => values.includes(row[field])); return query; },
      limit: async (limit: number) => ({ data: selected.slice(0, limit), error: failure === table ? { message: "synthetic failure" } : null }) };
    return query;
  }, async rpc(name: string, args: Record<string, unknown>) {
    const failed = failure === name;
    const keys = Array.isArray(args.p_source_record_keys) ? args.p_source_record_keys : [];
    const domains = Array.isArray(args.p_domains) ? args.p_domains : [];
    const nameMatches = (tables.gta_prospect_firms ?? []).filter((row) => typeof args.p_normalized_display_name === "string" && row.normalized_display_name === args.p_normalized_display_name).map((row) => ({ match_kind: "name", match_value: row.normalized_display_name, firm_id: row.id }));
    const keyMatches = (tables.gta_prospect_firms ?? []).filter((row) => keys.includes(row.source_record_key)).map((row) => ({ match_kind: "source_key", match_value: row.source_record_key, firm_id: row.id }));
    const domainMatches = [...(tables.gta_prospect_stable_identity_registry ?? []), ...(tables.gta_prospect_domains ?? [])]
      .filter((row) => domains.includes(row.canonical_domain) || domains.includes(row.normalized_domain_value))
      .map((row) => ({ match_kind: "domain", match_value: row.canonical_domain ?? row.normalized_domain_value, firm_id: row.firm_id }));
    return { data: failed ? null : [...nameMatches, ...keyMatches, ...domainMatches], error: failed ? { message: "synthetic rpc failure" } : null };
  } } as unknown as ReadDatabase;
}
describe("source-bound new-core values", () => {
  it("derives every field from explicit item/source selections and preserves the full proof", () => {
    const f = fixture(), result = deriveProspectEnrichmentNewCoreInput(f.options(), f.evidence, f.note);
    expect(result).toMatchObject({ id: "synthetic-legal", firmName: "Synthetic Legal", city: "Toronto", officeCities: ["Toronto", "Ottawa"],
      websiteUrl: "https://synthetic-legal.example/team", practiceAreas: ["Civil litigation", "Family law"], observedLawyerCount: 3,
      observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: "3 lawyers", rosterCheckedAt: "2026-09-23",
      reconciliationStatus: "provisional_new", legacyClusterLawyerCount: null, legacyCrosswalk: null, publicContacts: [] });
    expect(result.coreEvidence.practiceAreas.map((ref) => ref.itemId)).toEqual([id(13), id(12)]);
  });
  it("does not make a firm-name claim without an exact source excerpt", () => {
    const f = fixture(); f.payload.sources = [{ ...f.payload.sources[0], excerpt: "Another firm" }] as never;
    expect(f.options().eligible).toBe(false);
  });
  it.each(["firmName", "city", "roster"] as const)("rejects a substituted %s source reference", (field) => {
    const f = fixture(); f.evidence[field].sourceId = "invented-source";
    expect(() => deriveProspectEnrichmentNewCoreInput(f.options(), f.evidence, f.note)).toThrow();
  });
  it("requires the selected primary city to be the first office reference", () => {
    const f = fixture(); f.evidence.officeCities.reverse();
    expect(() => deriveProspectEnrichmentNewCoreInput(f.options(), f.evidence, f.note)).toThrow("start");
  });
  it("refuses duplicate city and service projections", () => {
    const f = fixture(); f.evidence.officeCities.push(f.evidence.officeCities[0]);
    expect(() => deriveProspectEnrichmentNewCoreInput(f.options(), f.evidence, f.note)).toThrow("distinct");
    f.evidence.officeCities.pop(); f.evidence.practiceAreas.push(f.evidence.practiceAreas[0]);
    expect(() => deriveProspectEnrichmentNewCoreInput(f.options(), f.evidence, f.note)).toThrow("exact service");
  });
  it("never assigns a website observed on a different date to the roster bootstrap", () => {
    const f = fixture(); const options = f.options(); options.websiteSources = [{ ...options.websiteSources[0], observedOn: "2026-09-22" }];
    expect(() => deriveProspectEnrichmentNewCoreInput(options, f.evidence, f.note)).toThrow("same observation date");
    f.evidence.websiteUrl.sourceId = null;
    expect(deriveProspectEnrichmentNewCoreInput(options, f.evidence, f.note).websiteUrl).toBeNull();
  });
  it.each(["", "Create new firm", "Synthetic Legal in Toronto needs review but has no roster date.", "Placeholder Synthetic Legal Toronto 2026-09-23 fake default note"])("requires a specific operator-authored note: %s", (note) => {
    const f = fixture(); expect(() => deriveProspectEnrichmentNewCoreInput(f.options(), f.evidence, note)).toThrow();
  });
  it("does not derive candidates from retracted or policy-blocked evidence", () => {
    const f = fixture(); f.payload.observations = f.payload.observations.map((item) => ({ ...item, evidenceState: "retracted", retractionReason: "Corrected" })) as never;
    expect(f.options().eligible).toBe(false);
  });
  it("holds candidate expansion without truncating original research or silently omitting selections", () => {
    const f = fixture();
    (f.payload.sources[0] as { excerpt: string }).excerpt = "Synthetic Legal " + "e".repeat(60_000);
    const source = f.payload.observations[2];
    for (let index = 0; index < 40; index += 1) {
      f.payload.observations.push({ ...source, observationId: "extra-" + index });
      f.items.push({ itemId: id(100 + index), clientItemId: "obs:extra-" + index, sourceIds: ["official-site"] });
    }
    expect(f.options().eligible).toBe(false); expect(f.options().holds).toContain("new_core_candidate_limit");
    expect(f.payload.sources[0].excerpt?.length).toBeGreaterThan(60_000);
    expect(f.payload.observations).toHaveLength(45);
  });
  it("preserves zero and unknown roster counts as different values", () => {
    const f = fixture(), options = f.options(), roster = options.rosters[0].observation;
    if (roster.kind !== "roster") throw new Error("fixture");
    roster.data.lawyerCount = 0; roster.data.display = "0 lawyers";
    expect(deriveProspectEnrichmentNewCoreInput(options, f.evidence, f.note).observedLawyerCount).toBe(0);
    roster.data.lawyerCount = null; roster.data.countQualifier = "unknown"; roster.data.display = "Unknown";
    expect(deriveProspectEnrichmentNewCoreInput(options, f.evidence, f.note).observedLawyerCount).toBeNull();
  });
});
describe("authoritative new-core candidate reader", () => {
  const read = (f: ReturnType<typeof fixture>, client: ReadDatabase) => readProspectEnrichmentNewCoreOptions({
    packageId: id(1), payload: f.payload, items: f.items, state: "identity_hold", storedFirmId: null, existingFirmId: null, client });
  it("makes a complete candidate available without canonical writes", async () => {
    const result = await read(fixture(), database()); expect(result?.eligible).toBe(true); expect(result?.sourceRecordKey).toBe("synthetic-legal");
  });
  it("uses a deterministic package key when the supplied source key is already used", async () => {
    const result = await read(fixture(), database({ gta_prospect_firms: [{ id: id(200), source_record_key: "synthetic-legal", normalized_display_name: "another firm" }] }));
    expect(result?.sourceRecordKey).toBe("pe-" + id(1).replace(/-/g, ""));
  });
  it("holds an exact normalized-name collision for existing-firm review", async () => {
    const result = await read(fixture(), database({ gta_prospect_firms: [{ id: id(200), source_record_key: "existing", normalized_display_name: "synthetic legal" }] }));
    expect(result?.eligible).toBe(false); expect(result?.holds).toContain("new_core_name_collision_requires_existing_review");
  });
  it("does not offer sources whose real domain already identifies a canonical firm", async () => {
    const result = await read(fixture(), database({ gta_prospect_stable_identity_registry: [{ id: id(201), firm_id: id(200), canonical_domain: "synthetic-legal.example" }] }));
    expect(result?.eligible).toBe(false); expect(result?.firmNameSources).toEqual([]);
  });
  it("holds a confirmed research source mapping and supplied existing IDs", async () => {
    const f = fixture(); f.payload.subject.databaseFirmId = id(200);
    const result = await read(f, database({ prospect_source_record_map: [{ id: id(201), firm_id: id(200), source_system: f.payload.sourceSystem, source_record_id: f.payload.subject.researchKey, mapping_status: "confirmed" }] }));
    expect(result?.eligible).toBe(false); expect(result?.holds).toContain("new_core_confirmed_mapping_requires_existing_review");
  });
  it("does not hide database errors behind an empty eligible candidate", async () => {
    await expect(read(fixture(), database({}, "lookup_prospect_enrichment_core_identity_conflicts_v1"))).rejects.toThrow();
  });
});
