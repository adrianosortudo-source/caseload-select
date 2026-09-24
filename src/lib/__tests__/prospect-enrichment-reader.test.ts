import { describe, expect, it } from "vitest";
import { getProspectEnrichmentFirmDetail, getProspectEnrichmentFirmHistory, type EnrichmentReadQuery, type ProspectEnrichmentReadClient } from "@/lib/prospect-enrichment-reader";

const firmId = "00000000-0000-4000-8000-000000000001";
const otherFirmId = "00000000-0000-4000-8000-000000000002";
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function clientFor(tables: Record<string, Record<string, unknown>[]> = {}, failures: string[] = []) {
  const queries: EnrichmentReadQuery[] = [];
  const data: Record<string, Record<string, unknown>[]> = { gta_prospect_firms: [{ id: firmId, display_name: "Enrichment Fixture One", source_record_key: "enrichment-fixture-001", website_url: null, enrichment_revision: 4 }], ...tables };
  const client: ProspectEnrichmentReadClient = { async read(query) {
    queries.push(query);
    if (failures.includes(query.table)) return { data: null, error: { message: "synthetic dependency failure" } };
    let rows = data[query.table as keyof typeof data] ?? [];
    for (const [key, value] of Object.entries(query.equals ?? {})) rows = rows.filter((row) => row[key] === value);
    if (query.in) rows = rows.filter((row) => query.in!.values.includes(String(row[query.in!.column])));
    if (query.afterId) rows = rows.filter((row) => String(row.id) > query.afterId!);
    return { data: [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id))).slice(0, query.limit), error: null };
  } };
  return { client, queries };
}

describe("complete prospect research reader", () => {
  it("fails closed on primary identity failure rather than rendering fixtures", async () => {
    const { client } = clientFor({}, ["gta_prospect_firms"]);
    await expect(getProspectEnrichmentFirmDetail({ firmId, client })).rejects.toThrow("could not be loaded");
  });
  it("keeps other sections available when one optional table fails", async () => {
    const { client } = clientFor({ prospect_service_observations: [{ id: id(3), firm_id: firmId, service_name: "Corporate law", matter_fit: "strong-match", observed_at: null, source_observed_on: "2026-09-23", source_observed_precision: "date_only" }] }, ["prospect_advertising_observations"]);
    const result = await getProspectEnrichmentFirmDetail({ firmId, client });
    expect(result.sections.find((section) => section.key === "profile")?.state).toBe("available");
    expect(result.sections.find((section) => section.key === "advertising")?.state).toBe("error");
    expect(result.sections.find((section) => section.key === "sources")?.state).toBe("empty");
    expect(result.complete).toBe(false);
  });
  it("preserves historical criteria and filters unapplied legacy batches", async () => {
    const { client } = clientFor({
      gta_prospect_qualification_assessments: [{ id: id(10), firm_id: firmId, evidence_import_batch_id: id(12), qualification_state: "needs_evidence", criteria: { ownerVerified: false, count: 3, unknown: null, nested: { literal: "<script>not executable</script>" } }, assessed_on: "2026-09-23" }, { id: id(11), firm_id: firmId, evidence_import_batch_id: id(13), qualification_state: "qualified", criteria: {} }],
      gta_prospect_supplemental_evidence_import_batches: [{ id: id(12), firm_id: firmId, state: "applied" }, { id: id(13), firm_id: firmId, state: "staged" }],
    });
    const result = await getProspectEnrichmentFirmDetail({ firmId, client }); const evidence = result.sections.find((section) => section.key === "qualification")!.items;
    expect(evidence).toHaveLength(1); expect(evidence[0].qualificationCategory).toBe("Incomplete"); expect(evidence[0].legacyCriteria.find((entry) => entry.selector === "/criteria/ownerVerified")?.value).toBe(false);
  });
  it("keeps keyset history scoped to the canonical firm and exact source", async () => {
    const { client } = clientFor({ prospect_service_observations: Array.from({ length: 28 }, (_, index) => ({ id: id(index + 100), firm_id: firmId, service_name: `Service ${index}` })) });
    const first = await getProspectEnrichmentFirmHistory({ firmId, table: "prospect_service_observations", client });
    expect(first.items).toHaveLength(25); expect(first.nextCursor).not.toBeNull();
    const second = await getProspectEnrichmentFirmHistory({ firmId, table: first.table, cursor: first.nextCursor!, client });
    expect(second.items).toHaveLength(3); expect(second.nextCursor).toBeNull();
    await expect(getProspectEnrichmentFirmHistory({ firmId: otherFirmId, table: first.table, cursor: first.nextCursor!, client })).rejects.toThrow();
  });
  it("loads profile successors beyond the initial history page before choosing current values", async () => {
    const choices = Array.from({ length: 28 }, (_, index) => ({ id: id(index + 200), firm_id: firmId, field_key: "roster", target_table: "gta_prospect_roster_observations", target_id: id(index + 400), source_selector: "/observed_lawyer_count", selected_value: index + 1, supersedes_choice_id: index ? id(index + 199) : null }));
    const { client } = clientFor({ prospect_enrichment_profile_choices: choices, gta_prospect_roster_observations: Array.from({ length: 28 }, (_, index) => ({ id: id(index + 400), firm_id: firmId, observed_lawyer_count: index + 1 })) });
    const result = await getProspectEnrichmentFirmDetail({ firmId, client });
    expect(result.profileChoices).toHaveLength(1); expect(result.profileChoices[0].data.selected_value).toBe(28);
  });
  it("never reads source paths or follows evidence URLs", async () => {
    const { client, queries } = clientFor({ prospect_source_captures: [{ id: id(90), firm_id: firmId, requested_url: "https://enrichment-fixture-008.example", retained_artifact: "C:/private/original.json", source_observed_precision: "unknown" }] });
    const result = await getProspectEnrichmentFirmDetail({ firmId, client });
    expect(result.sections.find((section) => section.key === "sources")!.items[0].data.retained_artifact).toBe("C:/private/original.json");
    expect(queries.every((query) => !query.table.includes(":"))).toBe(true);
  });

  it("joins accepted evidence back to complete source data and original research", async () => {
    const target = { id: id(600), firm_id: firmId, service_name: "Public route", matter_fit: "partial-match", source_observed_precision: "unknown" };
    const payload = { runId: "synthetic-run", originalResearch: { content: { unknown: null, verified: false }, unmappedPaths: ["/unknown"] }, sources: [{ sourceId: "source-1", url: "https://enrichment-fixture-008.example/team", publicationLabel: "2023", observedAt: null, observedOn: null }] };
    const { client } = clientFor({
      prospect_service_observations: [target],
      prospect_enrichment_item_targets: [{ item_id: id(601), target_table: "prospect_service_observations", target_id: id(600) }],
      prospect_enrichment_items: [{ id: id(601), package_id: id(602), data: { serviceName: "Public route", strengths: [], limitations: null }, source_ids: ["source-1"], source_event_id: id(603) }],
      prospect_enrichment_packages: [{ id: id(602), firm_id: firmId, state: "applied", payload, payload_sha256: "a".repeat(64) }],
    });
    const detail = await getProspectEnrichmentFirmDetail({ firmId, client });
    const item = detail.sections.find((section) => section.key === "profile")!.items[0];
    expect(item.enrichment[0].sources).toEqual(payload.sources);
    expect(item.enrichment[0].originalResearch).toEqual(payload.originalResearch);
    expect(item.enrichment[0].data).toEqual({ serviceName: "Public route", strengths: [], limitations: null });
    expect(item.dateLabel).toBe("Observation date not recorded");
  });
  it("finds a later package retraction and never presents that selected value as current", async () => {
    const { client } = clientFor({
      prospect_opportunity_observations: [{ id: id(610), firm_id: firmId, finding: "Earlier synthetic hypothesis" }],
      prospect_enrichment_profile_choices: [{ id: id(611), firm_id: firmId, field_key: "opportunity:intake", target_table: "prospect_opportunity_observations", target_id: id(610), source_selector: "/finding", selected_value: "Earlier synthetic hypothesis", supersedes_choice_id: null }],
      prospect_enrichment_packages: [{ id: id(612), firm_id: firmId, state: "applied", payload: { sources: [{ sourceId: "source-replacement", url: "https://enrichment-fixture-007.example/intake", observedOn: "2026-09-23" }] } }],
      prospect_enrichment_events: [{ id: id(613), package_id: id(612), event_type: "evidence_retracted", details: { targetTable: "prospect_opportunity_observations", targetId: id(610), reason: "Later official source contradicts it", sourceIds: ["source-replacement"] } }],
    });
    const detail = await getProspectEnrichmentFirmDetail({ firmId, client });
    expect(detail.profileChoices).toHaveLength(1);
    expect(detail.profileChoices[0].retractions).toHaveLength(1);
    expect(detail.profileChoices[0].retractions[0]).toMatchObject({ replacementSourceState: "available", replacementSources: [{ sourceId: "source-replacement" }] });
    expect(detail.sections.find((section) => section.key === "history")?.items.find((item) => item.table === "prospect_enrichment_packages")?.events).toHaveLength(1);
    expect(detail.profileChoices[0].profileSource?.data).toMatchObject({ finding: "Earlier synthetic hypothesis" });
    expect(detail.sections.find((section) => section.key === "marketing")?.items[0].retractions).toHaveLength(1);
  });
  it("fails profile coverage when its exact selected source changes or is missing", async () => {
    const { client } = clientFor({
      prospect_service_observations: [{ id: id(620), firm_id: firmId, service_name: "Changed value" }],
      prospect_enrichment_profile_choices: [{ id: id(621), firm_id: firmId, field_key: "service:one", target_table: "prospect_service_observations", target_id: id(620), source_selector: "/service_name", selected_value: "Original value", supersedes_choice_id: null }],
    });
    const detail = await getProspectEnrichmentFirmDetail({ firmId, client });
    expect(detail.profileChoices).toEqual([]);
    expect(detail.sections.find((section) => section.key === "profile")?.state).toBe("error");
    expect(detail.complete).toBe(false);
  });
  it("paginates all 39 legacy assessments without losing rich values", async () => {
    const assessments = Array.from({ length: 39 }, (_, index) => ({ id: id(700 + index), firm_id: firmId, criteria: index < 5 ? { lawyerCount: true } : { lawyerCount: true, ownerVerified: false, observedLawyers: 3, unknown: null, missingGates: ["owner_role", "advertising"], evidence: { sourceUrl: "https://enrichment-fixture-008.example/team", observedOn: "2026-09-23" } }, assessed_on: "2026-09-23" }));
    const { client } = clientFor({ gta_prospect_qualification_assessments: assessments });
    const first = await getProspectEnrichmentFirmHistory({ firmId, table: "gta_prospect_qualification_assessments", client });
    const second = await getProspectEnrichmentFirmHistory({ firmId, table: first.table, cursor: first.nextCursor!, client });
    expect([...first.items, ...second.items].map((item) => item.data.criteria)).toEqual(assessments.map((item) => item.criteria));
    expect(second.nextCursor).toBeNull();
  });
  it("marks unreadable profile choices as an error while leaving available sources visible", async () => {
    const { client } = clientFor({ prospect_source_captures: [{ id: id(800), firm_id: firmId, requested_url: "https://enrichment-fixture-005.example", source_observed_precision: "unknown" }] }, ["prospect_enrichment_profile_choices"]);
    const result = await getProspectEnrichmentFirmDetail({ firmId, client });
    expect(result.sections.find((section) => section.key === "profile")?.state).toBe("error");
    expect(result.sections.find((section) => section.key === "sources")?.state).toBe("available");
    expect(result.profileChoices).toEqual([]);
    expect(result.complete).toBe(false);
  });
});
