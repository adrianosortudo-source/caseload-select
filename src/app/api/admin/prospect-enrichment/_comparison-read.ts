import "server-only";
import { getProspectEnrichmentFirmDetail, getProspectEnrichmentFirmHistory, isProtectedGtaEnrichmentReadTable, readProtectedGtaEnrichmentEvidence, type ProspectEnrichmentEvidence, type ProspectEnrichmentFirmDetail, type ProspectEnrichmentReadClient } from "@/lib/prospect-enrichment-reader";
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import { readEvidenceJsonPointer } from "@/lib/prospect-enrichment-legacy";
import type { ReadDatabase } from "./_package-read";

type InputItem = { itemId: string; itemKind: string; data: unknown };
export type ResearchCurrentComparison = {
  state: "available" | "empty" | "error" | "unresolved" | "not_applicable";
  message: string; firmRevision: string | null; complete: boolean;
  historyCount: number; historyShown: number; historyDisplayComplete: boolean;
  acceptedHistory: readonly Pick<ProspectEnrichmentEvidence, "id" | "table" | "data" | "dateLabel" | "sourceUrls" | "retractions">[];
  selectedProfileValues: readonly Pick<ProspectEnrichmentEvidence, "id" | "table" | "data" | "retractions">[];
  fields: { field: string; proposed: { supplied: boolean; value: unknown }; current: { table: string; id: string; supplied: boolean; value: unknown; matches: boolean | null; retracted: boolean }[] }[];
};
const tables: Readonly<Record<string, readonly string[]>> = {
  firm_fit: ["prospect_firm_fit_observations"], service: ["prospect_service_observations"],
  contact: ["prospect_decision_maker_contacts", "gta_prospect_public_contact_observations"],
  advertising: ["prospect_advertising_observations"], opportunity: ["prospect_opportunity_observations"],
  website_intake: ["gta_prospect_website_intake_observations"], roster: ["gta_prospect_roster_observations"],
  research_attempt: ["prospect_research_attempts"], assessment: ["prospect_qualification_decisions", "gta_prospect_qualification_assessments"],
};
const fields: Readonly<Record<string, readonly [string, string][]>> = {
  firm_fit: [["/data/practiceAreas", "target_practice_areas"], ["/data/lawyerCount", "lawyer_count"], ["/data/independence", "independence_status"], ["/data/fit", "fit_status"]],
  service: [["/data/name", "service_name"], ["/data/matterFit", "matter_fit"]],
  contact: [["/data/personName", "person_name"], ["/data/roleLabel", "role_label"], ["/data/roleVerification", "role_verification"], ["/data/contactType", "contact_type"], ["/data/contactValue", "contact_value"], ["/data/contactQuality", "contact_quality"], ["/data/deliverability", "deliverability_state"]],
  advertising: [["/data/evidenceType", "evidence_type"], ["/data/vendor", "vendor"], ["/data/signalType", "signal_type"], ["/data/signalId", "signal_id"], ["/data/advertiserIdentity", "advertiser_identity"], ["/data/advertisedService", "advertised_service"], ["/data/destinationUrl", "destination_url"], ["/data/effectiveDate", "effective_date"], ["/data/lastShownDate", "last_shown_date"], ["/data/recencyBasis", "recency_basis"], ["/data/attributable", "attributable"]],
  website_intake: [["/data/pageUrl", "source_url"], ["/data/visibleChannels", "intake_channels"], ["/data/opportunityState", "opportunity_state"]],
  opportunity: [["/data/type", "opportunity_type"], ["/data/observation", "finding"], ["/data/recommendation", "recommendation_hypothesis"], ["/data/confidence", "confidence"]],
  roster: [["/data/lawyerCount", "observed_lawyer_count"], ["/data/countQualifier", "count_qualifier"], ["/data/display", "count_display"]],
  assessment: [["/cohortId", "cohort_id"], ["/ruleVersion", "rule_version"], ["/fitDecision", "fit_decision"], ["/decisionMakerAccess", "decision_maker_access"], ["/selectionDisposition", "selection_disposition"], ["/advertisingStatus", "advertising_status"]],
  research_attempt: [["/data/provider", "provider"], ["/data/queryOrUrl", "query_or_url"], ["/data/outcome", "outcome"], ["/data/coverage", "coverage"], ["/data/failureReason", "failure_reason"]],
};
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function comparable(item: InputItem, row: ProspectEnrichmentEvidence) {
  const outer = object(item.data), data = object(outer.data);
  if (item.itemKind === "service") return row.data.service_name === data.name;
  if (item.itemKind === "contact") return row.data.contact_type === data.contactType && row.data.person_name === data.personName;
  if (item.itemKind === "advertising") return row.data.evidence_type === data.evidenceType && row.data.vendor === data.vendor && row.data.signal_id === data.signalId;
  if (item.itemKind === "website_intake") return row.data.source_url === data.pageUrl;
  if (item.itemKind === "opportunity") return row.data.opportunity_type === data.type;
  if (item.itemKind === "assessment") return row.data.cohort_id === outer.cohortId && row.data.rule_version === outer.ruleVersion;
  if (item.itemKind === "research_attempt") return row.data.provider === data.provider && row.data.query_or_url === data.queryOrUrl;
  return true;
}
export function compareResearchItem(item: InputItem, detail: ProspectEnrichmentFirmDetail | null, failed = false): { currentValue: ResearchCurrentComparison; conflicts: string[]; profileOmissionReason: string } {
  const applicable = tables[item.itemKind] ?? [];
  const relevant = detail?.sections.filter((section) => section.items.some((row) => applicable.includes(row.table)) || Object.keys(section.nextCursors).some((table) => applicable.includes(table))) ?? [];
  const error = failed || Boolean(detail && (!detail.revisionStable || detail.sections.some((section) => section.state === "error") || relevant.some((section) => section.incomplete)));
  const acceptedHistory = detail?.sections.flatMap((section) => section.items.filter((row) => applicable.includes(row.table))) ?? [];
  const profilePrefix = item.itemKind === "firm_fit" ? "office:" : item.itemKind === "website_intake" ? "websiteUrl" : item.itemKind + ":";
  const selectedProfileValues = detail?.profileChoices.filter((choice) => applicable.includes(String(choice.data.target_table)) || String(choice.data.field_key).startsWith(profilePrefix)) ?? [];
  const state = item.itemKind === "source" ? "not_applicable" : !detail ? failed ? "error" : "unresolved" : error ? "error" : acceptedHistory.length ? "available" : "empty";
  const comparisonFields = (fields[item.itemKind] ?? []).map(([path, field]) => {
    const proposed = readEvidenceJsonPointer(item.data, path);
    return { field, proposed: { supplied: proposed.found, value: proposed.found ? proposed.value : null }, current: acceptedHistory.filter((row) => comparable(item, row)).map((row) => {
      const supplied = Object.hasOwn(row.data, field), value = supplied ? row.data[field] : null;
      return { table: row.table, id: row.id, supplied, value, matches: proposed.found && supplied ? prospectEnrichmentProtocolHash(proposed.value) === prospectEnrichmentProtocolHash(value) : null, retracted: row.retractions.length > 0 };
    }) };
  });
  const differing = comparisonFields.filter((field) => field.current.some((row) => !row.retracted && row.matches === false)).map((field) => field.field);
  const conflicts = error ? ["Current evidence could not be completely verified. Reload before accepting changes."] : differing.length ? ["The proposed observation differs from accepted evidence for: " + differing.join(", ") + ". Both findings remain history; the current profile is unchanged until explicitly selected."] : [];
  const data = object(item.data);
  const profileOmissionReason = item.itemKind === "source" ? "Source records provide provenance and cannot be selected as a profile value."
    : data.evidenceState === "retracted" ? "This finding is retracted and cannot be used in the current profile."
    : error ? "Current profile evidence could not be fully verified."
    : "No source-verified profile field and exact value selector is available for this item. It can be retained or accepted as history only.";
  const messages = { available: "Accepted evidence and explicit profile selections are shown separately. History is not automatically the current profile.", empty: "The complete read found no accepted evidence of this kind.", error: "Current evidence is incomplete or could not be loaded.", unresolved: "Resolve the firm identity before comparing canonical evidence.", not_applicable: "This source is retained as provenance; it does not propose a canonical profile value." };
  return { currentValue: { state, message: messages[state] + (acceptedHistory.length > 25 ? " Showing the first 25 history records; open firm research and load all evidence for the full source trail. Conflict checks cover the complete read." : ""), firmRevision: detail?.firm.revision ?? null, complete: !error && Boolean(detail), historyCount: acceptedHistory.length, historyShown: Math.min(acceptedHistory.length, 25), historyDisplayComplete: acceptedHistory.length <= 25, acceptedHistory: acceptedHistory.slice(0, 25).map(({ id, table, data, dateLabel, sourceUrls, retractions }) => ({ id, table, data, dateLabel, sourceUrls, retractions })), selectedProfileValues: selectedProfileValues.map(({ id, table, data, retractions }) => ({ id, table, data, retractions })), fields: comparisonFields.map((field) => ({ ...field, current: field.current.slice(0, 25) })) }, conflicts, profileOmissionReason };
}
export function comparisonReadClient(client: ReadDatabase): ProspectEnrichmentReadClient {
  return { async read(input) {
    if (isProtectedGtaEnrichmentReadTable(input.table)) return await readProtectedGtaEnrichmentEvidence(client, input);
    let query = client.from(input.table).select(input.columns);
    for (const [key, value] of Object.entries(input.equals ?? {})) query = query.eq(key, value);
    if (input.in) query = query.in(input.in.column, [...input.in.values]);
    if (input.afterId) query = query.gt("id", input.afterId);
    const ordered = input.table === "prospect_enrichment_item_targets" ? query.order("item_id", { ascending: true }).order("target_table", { ascending: true }).order("target_id", { ascending: true }) : query.order("id", { ascending: true });
    return await ordered.limit(input.limit);
  } };
}
export async function readCurrentComparisons(input: { firmId: string | null; items: readonly InputItem[]; client: ReadDatabase }) {
  if (!input.firmId) return input.items.map((item) => compareResearchItem(item, null));
  try {
    const client = comparisonReadClient(input.client), first = await getProspectEnrichmentFirmDetail({ firmId: input.firmId, client });
    const wanted = new Set(input.items.flatMap((item) => tables[item.itemKind] ?? []));
    let count = first.sections.reduce((total, section) => total + section.items.length, 0), pages = 0;
    const sections = [];
    for (const section of first.sections) {
      const items = [...section.items], nextCursors = { ...section.nextCursors };
      for (const [table, firstCursor] of Object.entries(nextCursors)) {
        if (!wanted.has(table)) continue;
        let cursor: string | null = firstCursor; const seen = new Set<string>();
        while (cursor) {
          if (seen.has(cursor) || ++pages > 100 || count > 5000) throw new Error("Current comparison coverage limit exceeded.");
          seen.add(cursor);
          const page = await getProspectEnrichmentFirmHistory({ firmId: input.firmId, table, cursor, limit: 100, client });
          items.push(...page.items); count += page.items.length; cursor = page.nextCursor;
          if (count > 5000) throw new Error("Current comparison coverage limit exceeded.");
        }
        delete nextCursors[table];
      }
      sections.push({ ...section, items, nextCursors, incomplete: Boolean(section.errorId) || Object.keys(nextCursors).some((table) => wanted.has(table)) });
    }
    const after = await getProspectEnrichmentFirmDetail({ firmId: input.firmId, client });
    const detail = { ...first, sections, revisionStable: first.revisionStable && after.revisionStable && first.firm.revision === after.firm.revision };
    return input.items.map((item) => compareResearchItem(item, detail));
  } catch { return input.items.map((item) => compareResearchItem(item, null, true)); }
}
