import type { ProspectEnrichmentEvidence, ProspectEnrichmentFirmDetail } from "./prospect-enrichment-reader";
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function selected(recordValue: Record<string, unknown>, key: string, fallback: unknown) { return Object.hasOwn(recordValue, key) ? recordValue[key] : fallback; }
export function researchEvidenceFields(item: ProspectEnrichmentEvidence): readonly { label: string; value: unknown }[][] {
  const row = item.data;
  const originals = item.enrichment.length ? item.enrichment.map((lineage) => record(lineage.data)) : [record(row.raw_observation ?? row.canonical_observation ?? row.raw_assessment)];
  return originals.map((outer) => {
    const data = Object.hasOwn(outer, "data") ? record(outer.data) : outer;
    let values: [string, unknown][] = [];
    if (item.table === "prospect_opportunity_observations" || item.table === "gta_prospect_website_intake_observations") values = [
      ["Observation", selected(data, "observation", row.finding ?? row.opportunity_note)], ["Strengths", data.strengths],
      ["Interpretation", data.interpretation], ["Recommendation", selected(data, "recommendation", row.recommendation_hypothesis)], ["Unknowns", data.unknowns],
      ["Visible intake channels", selected(data, "visibleChannels", row.intake_channels)], ["Visible intake fields", data.visibleFields],
    ];
    else if (item.table === "gta_prospect_roster_observations") values = [["Observed lawyer count", row.observed_lawyer_count], ["Count qualifier", row.count_qualifier], ["Count display", row.count_display], ["Included people", data.includedNames], ["Excluded people and reasons", data.excludedPeople]];
    else if (item.table === "prospect_decision_maker_contacts") values = [["Person", row.person_name], ["Leadership role", row.role_label], ["Role verification", row.role_verification], ["Contact type", row.contact_type], ["Published contact value", row.contact_value], ["Contact quality", row.contact_quality], ["Deliverability", row.deliverability_state], ["Role source IDs", data.roleSourceIds]];
    else if (item.table === "gta_prospect_public_contact_observations") values = [["Person", row.contact_name], ["Relationship", row.relationship], ["Public email", row.public_email], ["Direct or general inbox classification", row.email_kind]];
    else if (item.table === "gta_prospect_offices") values = [["Office city", row.city], ["Province", row.province], ["Address", row.address_raw], ["Suite", row.suite_raw]];
    else if (item.table === "prospect_service_observations") values = [["Service", row.service_name], ["Matter fit", row.matter_fit]];
    else if (item.table === "prospect_firm_fit_observations") values = [["Practice areas", row.target_practice_areas], ["Office", selected(data, "office", row.office_geography)], ["Lawyer count", row.lawyer_count], ["Count qualifier", data.countQualifier], ["Independence", row.independence_status], ["Fit decision", row.fit_status]];
    else if (item.table === "prospect_qualification_decisions" || item.table === "gta_prospect_qualification_assessments") values = [["Original decision", row.selection_disposition ?? row.qualification_state], ["Display category", item.qualificationCategory], ["Cohort", row.cohort_id ?? row.qualification_cohort], ["Rule version", row.rule_version ?? outer.ruleVersion], ["Independent gates", { fit: selected(outer, "fitDecision", row.fit_decision), commercialRelevance: selected(outer, "commercialRelevance", row.commercial_relevance), decisionMakerAccess: selected(outer, "decisionMakerAccess", row.decision_maker_access), opportunity: selected(outer, "opportunityDecision", row.opportunity_decision) }], ["Missing gates", selected(outer, "missingGates", record(row.criteria).missingGates)], ["Reasons", row.rationale ?? row.note], ["Research failures", outer.researchFailures], ["Assessment date", item.dateLabel]];
    else if (item.table === "prospect_research_attempts") values = [["Research provider", row.provider], ["Query or URL", row.query_or_url], ["Retrieval outcome", row.outcome], ["Coverage", row.coverage], ["Failure reason", row.failure_reason]];
    return values.map(([label, value]) => ({ label, value }));
  }).filter((group) => group.length > 0);
}
export function researchFirmHeading(detail: ProspectEnrichmentFirmDetail) {
  const identity = detail.sections.find((section) => section.key === "identity");
  const registries = identity?.items.filter((item) => item.table === "gta_prospect_stable_identity_registry") ?? [];
  const stableIds = [...new Set(registries.flatMap((item) => typeof item.data.stable_firm_id === "string" ? [item.data.stable_firm_id] : []))];
  const domains = [...new Set(registries.flatMap((item) => typeof item.data.canonical_domain === "string" ? [item.data.canonical_domain] : []))];
  const observations = detail.sections.flatMap((section) => section.items).filter((item) => item.date.observedAt || item.date.observedOn).sort((a, b) => (b.date.observedAt ?? b.date.observedOn!).localeCompare(a.date.observedAt ?? a.date.observedOn!));
  return { stableIds, domains, identityState: identity?.state ?? "error", latestObservation: observations[0]?.dateLabel ?? "Observation date not recorded", freshness: observations.some((item) => item.freshness === "refresh_recommended") ? "Refresh recommended" : observations.some((item) => item.freshness === "current") ? "Within refresh period" : "Freshness unknown", complete: detail.complete };
}
export function appendResearchHistoryPage(detail: ProspectEnrichmentFirmDetail, sectionKey: string, table: string, page: { table: string; items: readonly ProspectEnrichmentEvidence[]; nextCursor: string | null; revision?: string; revisionStable?: boolean }): ProspectEnrichmentFirmDetail {
  if (page.table !== table || page.items.some((item) => item.table !== table || item.data.firm_id !== detail.firm.id)) throw new Error("The history page does not belong to the requested firm and evidence source.");
  const sections = detail.sections.map((section) => {
    if (section.key !== sectionKey) return section;
    const nextCursors = { ...section.nextCursors };
    if (page.nextCursor) nextCursors[table] = page.nextCursor; else delete nextCursors[table];
    const known = new Set(section.items.map((item) => item.table + ":" + item.id));
    const items = [...section.items, ...page.items.filter((item) => !known.has(item.table + ":" + item.id))];
    return { ...section, items, nextCursors, state: section.errorId ? "error" as const : items.length ? "available" as const : "empty" as const, incomplete: Boolean(section.errorId) || Object.keys(nextCursors).length > 0 };
  });
  const revisionStable = detail.revisionStable && page.revisionStable !== false && (page.revision === undefined || page.revision === detail.firm.revision);
  return { ...detail, sections, revisionStable, complete: revisionStable && sections.every((section) => !section.incomplete) };
}
