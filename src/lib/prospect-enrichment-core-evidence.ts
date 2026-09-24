import type { ProspectEnrichmentEnvelope, ProspectEnrichmentObservation, ProspectEnrichmentSource } from "./prospect-enrichment-contract";

export type ProspectEnrichmentCoreReference = { itemId: string; sourceId: string };
export type ProspectEnrichmentCoreEvidence = {
  firmName: { sourceId: string };
  city: ProspectEnrichmentCoreReference;
  officeCities: ProspectEnrichmentCoreReference[];
  websiteUrl: { sourceId: string | null };
  practiceAreas: ProspectEnrichmentCoreReference[];
  roster: ProspectEnrichmentCoreReference;
};
export type ProspectEnrichmentCoreBoundCandidate = {
  itemId: string; sourceId: string; observation: ProspectEnrichmentObservation; source: ProspectEnrichmentSource;
};
export type ProspectEnrichmentNewCoreOptions = {
  eligible: boolean; sourceRecordKey: string; firmName: string; holds: string[];
  firmNameSources: ProspectEnrichmentSource[]; cities: ProspectEnrichmentCoreBoundCandidate[];
  services: ProspectEnrichmentCoreBoundCandidate[]; rosters: ProspectEnrichmentCoreBoundCandidate[];
  websiteSources: ProspectEnrichmentSource[];
};
export type SourceBoundNewCoreInput = {
  id: string; firmName: string; city: string; officeCities: string[]; websiteUrl: string | null; practiceAreas: string[];
  observedLawyerCount: number | null; observedLawyerCountQualifier: "exact" | "at_least" | "unknown";
  observedLawyerCountDisplay: string; rosterSourceUrl: string; rosterCheckedAt: string;
  reconciliationStatus: "provisional_new"; legacyClusterLawyerCount: null; legacyCrosswalk: null;
  reconciliationNote: string; publicContacts: []; coreEvidence: ProspectEnrichmentCoreEvidence;
};
export class ProspectEnrichmentCoreEvidenceError extends Error {
  constructor(message: string) { super(message); this.name = "ProspectEnrichmentCoreEvidenceError"; }
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ProspectEnrichmentCoreEvidenceError(message);
}
export function prospectCoreObservationDate(value: { observedOn: string | null; observedAt: string | null }): string | null {
  if (value.observedOn && /^\d{4}-\d{2}-\d{2}$/.test(value.observedOn)) return value.observedOn;
  return value.observedAt && Number.isFinite(Date.parse(value.observedAt)) ? new Date(value.observedAt).toISOString().slice(0, 10) : null;
}
export function prospectCoreSourceDomain(value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
    ? url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") : null; } catch { return null; }
}
export function publicCoreSource(source: ProspectEnrichmentSource) {
  return source.policyState === "public-source" && source.missingProvenanceReason === null && prospectCoreSourceDomain(source.url) !== null;
}
export function collectProspectEnrichmentCoreOptions(input: {
  payload: ProspectEnrichmentEnvelope; items: readonly { itemId: string; clientItemId: string; sourceIds: readonly string[] }[];
  sourceRecordKey: string; identityHolds: readonly string[];
}): ProspectEnrichmentNewCoreOptions {
  const sources = input.payload.sources.filter(publicCoreSource);
  const bound: ProspectEnrichmentCoreBoundCandidate[] = [];
  let bindingBytes = 0;
  const limited = (): ProspectEnrichmentNewCoreOptions => ({ eligible: false, sourceRecordKey: input.sourceRecordKey,
    firmName: input.payload.subject.displayName, holds: [...input.identityHolds, "new_core_candidate_limit"],
    firmNameSources: [], cities: [], services: [], rosters: [], websiteSources: [] });
  for (const observation of input.payload.observations) {
    if (observation.evidenceState !== "asserted" || observation.missingProvenanceReason !== null) continue;
    const item = input.items.find((candidate) => candidate.clientItemId === "obs:" + observation.observationId);
    if (!item || item.sourceIds.length !== observation.sourceIds.length || item.sourceIds.some((id, index) => id !== observation.sourceIds[index])) continue;
    for (const sourceId of observation.sourceIds) {
      const source = sources.find((candidate) => candidate.sourceId === sourceId);
      if (source) {
        const candidate = { itemId: item.itemId, sourceId, observation, source };
        bindingBytes += new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
        if (bound.length >= 1000 || bindingBytes > 1_048_576) return limited();
        bound.push(candidate);
      }
    }
  }
  const firmNameSources = sources.filter((source) => source.excerpt?.includes(input.payload.subject.displayName));
  const cities = bound.filter((candidate) => candidate.observation.kind === "firm_fit"
    && typeof candidate.observation.data.office.city === "string" && candidate.observation.data.office.city.trim().length > 0);
  const services = bound.filter((candidate) => candidate.observation.kind === "service");
  const rosters = bound.filter((candidate) => candidate.observation.kind === "roster" && prospectCoreObservationDate(candidate.observation) !== null);
  const holds = [...input.identityHolds, ...(!firmNameSources.length ? ["new_core_name_source_missing"] : []),
    ...(!cities.length ? ["new_core_office_source_missing"] : []), ...(!rosters.length ? ["new_core_roster_source_missing"] : [])];
  const result = { eligible: holds.length === 0, sourceRecordKey: input.sourceRecordKey, firmName: input.payload.subject.displayName,
    holds, firmNameSources, cities, services, rosters, websiteSources: sources.filter((source) => prospectCoreObservationDate(source) !== null) };
  return new TextEncoder().encode(JSON.stringify(result)).byteLength > 2_097_152 ? limited() : result;
}
function selectBound(candidates: readonly ProspectEnrichmentCoreBoundCandidate[], ref: ProspectEnrichmentCoreReference, field: string) {
  check(ref && typeof ref.itemId === "string" && typeof ref.sourceId === "string", field + " requires the exact item and source IDs.");
  const found = candidates.find((candidate) => candidate.itemId === ref.itemId && candidate.sourceId === ref.sourceId);
  check(found, field + " is not supported by the selected package evidence.");
  return found;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const normalizeCity = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export function deriveProspectEnrichmentNewCoreInput(options: ProspectEnrichmentNewCoreOptions, coreEvidence: ProspectEnrichmentCoreEvidence, reconciliationNote: string): SourceBoundNewCoreInput {
  check(options.eligible, "New-firm creation remains on hold until identity and source evidence are complete.");
  check(coreEvidence && coreEvidence.firmName && coreEvidence.websiteUrl && Array.isArray(coreEvidence.officeCities) && Array.isArray(coreEvidence.practiceAreas),
    "Every new-firm field requires its source evidence selection.");
  check(options.firmNameSources.some((source) => source.sourceId === coreEvidence.firmName.sourceId),
    "The firm name must be present in the selected public-source excerpt.");
  const cityEvidence = selectBound(options.cities, coreEvidence.city, "Primary city");
  check(cityEvidence.observation.kind === "firm_fit" && cityEvidence.observation.data.office.city, "The primary office city is missing.");
  const city = cityEvidence.observation.data.office.city;
  check(coreEvidence.officeCities.length > 0 && coreEvidence.officeCities[0].itemId === coreEvidence.city.itemId
    && coreEvidence.officeCities[0].sourceId === coreEvidence.city.sourceId, "Office evidence must start with the explicitly selected primary city.");
  const offices = coreEvidence.officeCities.map((ref) => {
    const selected = selectBound(options.cities, ref, "Office cities");
    check(selected.observation.kind === "firm_fit" && selected.observation.data.office.city, "A selected office city is missing.");
    return { ref, city: selected.observation.data.office.city };
  });
  check(new Set(offices.map((office) => normalizeCity(office.city))).size === offices.length, "Select one source-bound observation per distinct office city.");
  const orderedOffices = [offices[0], ...offices.slice(1).sort((a, b) => compare(normalizeCity(a.city), normalizeCity(b.city)))];
  const services = coreEvidence.practiceAreas.map((ref) => {
    const selected = selectBound(options.services, ref, "Practice areas");
    check(selected.observation.kind === "service", "Practice areas require service evidence.");
    return { ref, name: selected.observation.data.name };
  });
  check(new Set(services.map((service) => service.name)).size === services.length, "Select one source-bound observation per exact service name.");
  services.sort((a, b) => compare(a.name, b.name));
  const roster = selectBound(options.rosters, coreEvidence.roster, "Roster");
  check(roster.observation.kind === "roster", "A roster observation is required.");
  const rosterCheckedAt = prospectCoreObservationDate(roster.observation);
  check(rosterCheckedAt && roster.source.url, "Roster evidence requires its exact date and public source URL.");
  let websiteUrl: string | null = null;
  if (coreEvidence.websiteUrl.sourceId !== null) {
    const website = options.websiteSources.find((source) => source.sourceId === coreEvidence.websiteUrl.sourceId);
    check(website && prospectCoreObservationDate(website) === rosterCheckedAt, "Website evidence must have the same observation date as the selected roster, or stay unselected.");
    websiteUrl = website.url;
  }
  check(typeof reconciliationNote === "string", "Write an operator reconciliation note.");
  const note = reconciliationNote.trim();
  check(note.length >= 40 && new TextEncoder().encode(note).byteLength <= 5000
    && note.includes(options.firmName) && orderedOffices.some((office) => note.includes(office.city)) && note.includes(rosterCheckedAt)
    && !/\b(todo|tbd|placeholder|lorem ipsum|default note|generic note)\b/i.test(note),
  "Write at least 40 characters explaining this new firm, including its exact name, a selected city and the roster date. Placeholder notes are not accepted.");
  return { id: options.sourceRecordKey, firmName: options.firmName, city, officeCities: orderedOffices.map((office) => office.city),
    websiteUrl, practiceAreas: services.map((service) => service.name), observedLawyerCount: roster.observation.data.lawyerCount,
    observedLawyerCountQualifier: roster.observation.data.countQualifier, observedLawyerCountDisplay: roster.observation.data.display,
    rosterSourceUrl: roster.source.url, rosterCheckedAt, reconciliationStatus: "provisional_new", legacyClusterLawyerCount: null,
    legacyCrosswalk: null, reconciliationNote: note, publicContacts: [], coreEvidence: { ...coreEvidence,
      officeCities: orderedOffices.map((office) => office.ref), practiceAreas: services.map((service) => service.ref) } };
}
