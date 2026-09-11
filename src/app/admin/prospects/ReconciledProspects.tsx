"use client";

import { useEffect, useMemo, useState } from "react";
import {
  filterReconciledGtaProspects,
  lawyerCountRangeForBand,
  observedLawyerCountLabel,
  type LawyerCountBand,
  type EvidenceAvailability,
  type OwnerContactFilter,
  type PublicProspectContact,
  type ReconciledGtaProspect,
} from "@/lib/gta-prospect-records";
import {
  normalizedCityLabel,
  normalizedPracticeAreaLabel,
  uniqueNormalizedLabels,
} from "@/lib/prospect-display-normalization";
import type {
  AdvertisingActivityState,
  EvidenceFreshness,
  QualifiedProspectConfidence,
  QualifiedProspectImportReport,
} from "@/lib/qualified-gta-prospects";
import {
  reconciledProspectSourceLabel,
  type ReconciledProspectFallbackReason,
  type ReconciledProspectSource,
  type ReconciledProspectSourceCounts,
} from "./reconciled-prospects-source";
import {
  filterUnifiedProspectState,
  prospectIdentityState,
  prospectSources,
  type UnifiedIdentityState,
  type UnifiedProspectSource,
} from "./prospect-unified-view";
import ProspectActivityPanel from "../agency-crm/ProspectActivityPanel";
import { ProspectContactStatus } from "./ProspectContactStatus";
import {
  fetchSourceContactStates,
  GTA_PROSPECT_SOURCE_SYSTEM,
  type SourceContactStateMap,
} from "./prospect-contact-operations";

export type RecordsResponse = {
  records?: ReconciledGtaProspect[];
  source?: ReconciledProspectSource;
  sourceCounts?: ReconciledProspectSourceCounts;
  qualifiedImport?: QualifiedProspectImportReport;
  fallbackReason?: ReconciledProspectFallbackReason;
  error?: string;
};

type QuickView = "all" | "shared_registry" | "audit_ready" | "identity_review";
type CountFilter = "" | "2-3" | LawyerCountBand;
const PAGE_SIZE = 100;

const evidenceLabel: Record<EvidenceAvailability, string> = { observed: "Observed", none: "None found", unknown: "Unknown" };
const advertisingActivityLabel: Record<AdvertisingActivityState, string> = {
  observable_current: "Current activity",
  observable_recent: "Recent activity",
  observable_historical: "Historical activity",
};
const gbpOpportunityLabels: Record<string, string> = {
  public_name_consistency: "Public name consistency",
  cohort_relative_review_visibility: "Review visibility",
  category_consistency: "Category consistency",
  phone_route_consistency: "Phone route consistency",
};
const websiteOpportunityLabels: Record<string, string> = {
  public_identity_consistency: "Public identity",
  intake_path_consistency: "Intake path",
  content_quality: "Content quality",
  technical_path: "Technical path",
  public_site_review: "Public site review",
};
const freshnessLabels: Record<EvidenceFreshness, string> = {
  last_30_days: "Last 30 days",
  "31_to_180_days": "31 to 180 days",
  older_than_180_days: "Older than 180 days",
  unknown: "Date unknown",
};
const sourceLabels: Record<UnifiedProspectSource, string> = {
  shared_registry: "Shared registry",
  research_ledger: "Research ledger",
  reviewed_fixture: "Reviewed research",
  legacy_provenance: "Legacy provenance",
};
const identityLabels: Record<UnifiedIdentityState, string> = {
  linked: "Linked identity",
  reviewed_match: "Reviewed legacy match",
  review_needed: "Identity review needed",
  provisional: "Provisional identity",
};
const ownerContactLabels: Record<OwnerContactFilter, string> = {
  identified: "Owner identified",
  direct_owner_email: "Direct owner email",
  needs_direct_email: "Needs direct owner email",
};

function badgeClass(kind: UnifiedProspectSource | UnifiedIdentityState): string {
  if (kind === "shared_registry" || kind === "linked") return "border-green-200 bg-green-50 text-green-900";
  if (kind === "review_needed") return "border-amber-200 bg-amber-50 text-amber-900";
  if (kind === "legacy_provenance" || kind === "reviewed_match") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-black/10 bg-parchment/60 text-black/70";
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function EvidenceLink({ availability, href, label }: { availability: EvidenceAvailability; href: string | null; label: string }) {
  const content = `${label}: ${evidenceLabel[availability]}`;
  if (!href) return <span className="text-black/50">{content}</span>;
  return <a href={href} target="_blank" rel="noreferrer" className="text-navy underline underline-offset-2">{content}</a>;
}

function ownerRoleLabel(role: NonNullable<ReconciledGtaProspect["ownerContact"]>["ownerRole"]): string {
  return titleCase(role);
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-field-label">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded border border-border-brand bg-white px-3 py-2 text-sm text-black">
        {children}
      </select>
    </label>
  );
}

function contactRoleLabel(relationship: PublicProspectContact["relationship"]): string {
  return ({ owner: "Owner", founder: "Founder", principal: "Principal", named_lawyer: "Named lawyer", firm_inbox: "Firm inbox" })[relationship];
}

export default function ReconciledProspects({ initialData }: { initialData?: RecordsResponse } = {}) {
  const [records, setRecords] = useState<ReconciledGtaProspect[] | null>(initialData?.records ?? null);
  const [sourceDetails, setSourceDetails] = useState<Pick<RecordsResponse, "source" | "sourceCounts" | "qualifiedImport" | "fallbackReason"> | null>(initialData ? {
    source: initialData.source,
    sourceCounts: initialData.sourceCounts,
    qualifiedImport: initialData.qualifiedImport,
    fallbackReason: initialData.fallbackReason,
  } : null);
  const [error, setError] = useState<string | null>(null);
  const [quickView, setQuickView] = useState<QuickView>("all");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [countFilter, setCountFilter] = useState<CountFilter>("");
  const [customMinimum, setCustomMinimum] = useState("");
  const [customMaximum, setCustomMaximum] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [advertising, setAdvertising] = useState<EvidenceAvailability | "">("");
  const [gbp, setGbp] = useState<EvidenceAvailability | "">("");
  const [advertisingActivity, setAdvertisingActivity] = useState<AdvertisingActivityState | "">("");
  const [advertisingSourceType, setAdvertisingSourceType] = useState("");
  const [gbpOpportunityType, setGbpOpportunityType] = useState("");
  const [websiteOpportunityType, setWebsiteOpportunityType] = useState("");
  const [intakeChannel, setIntakeChannel] = useState("");
  const [lawyerCountConfidence, setLawyerCountConfidence] = useState<QualifiedProspectConfidence | "">("");
  const [freshness, setFreshness] = useState<EvidenceFreshness | "">("");
  const [cohortId, setCohortId] = useState("");
  const [hasOwner, setHasOwner] = useState<boolean | "">("");
  const [hasPublicEmail, setHasPublicEmail] = useState<boolean | "">("");
  const [source, setSource] = useState<UnifiedProspectSource | "">("");
  const [identity, setIdentity] = useState<UnifiedIdentityState | "">("");
  const [ownerContact, setOwnerContact] = useState<OwnerContactFilter | "">("");
  const [page, setPage] = useState(0);
  const [contactStates, setContactStates] = useState<SourceContactStateMap>(new Map());
  const [contactStateLoading, setContactStateLoading] = useState(false);
  const [contactStateError, setContactStateError] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<ReconciledGtaProspect | null>(null);
  const [contactRefreshToken, setContactRefreshToken] = useState(0);

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    fetch("/admin/prospects/reconciled")
      .then(async (response) => {
        const body = (await response.json()) as RecordsResponse;
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return {
          records: body.records ?? [], source: body.source ?? "fixture",
          sourceCounts: body.sourceCounts ?? { ledger: 0, fixture: body.records?.length ?? 0 },
          qualifiedImport: body.qualifiedImport, fallbackReason: body.fallbackReason,
        };
      })
      .then((result) => { if (!cancelled) { setRecords(result.records); setSourceDetails(result); } })
      .catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [initialData]);

  const values = useMemo(() => {
    const list = records ?? [];
    const dossiers = list.flatMap((record) => record.qualifiedDossier ? [record.qualifiedDossier] : []);
    return {
      cities: uniqueNormalizedLabels(list.flatMap((record) => record.officeCities), normalizedCityLabel),
      practiceAreas: uniqueNormalizedLabels(list.flatMap((record) => record.practiceAreas), normalizedPracticeAreaLabel),
      gbpOpportunities: [...new Set(dossiers.map((dossier) => dossier.gbpOpportunity.type))].sort(),
      advertisingSourceTypes: [...new Set(dossiers.flatMap((dossier) => dossier.advertisingActivity.sourceTypes))].sort(),
      websiteOpportunities: [...new Set(dossiers.flatMap((dossier) => dossier.websiteAndIntake.opportunityTypes))].sort(),
      intakeChannels: [...new Set(dossiers.flatMap((dossier) => dossier.websiteAndIntake.observedChannels))].sort(),
      cohorts: [...new Set(dossiers.map((dossier) => dossier.qualification.cohortId))].sort(),
    };
  }, [records]);

  const customRange = useMemo(() => {
    const minimum = customMinimum === "" ? null : Number(customMinimum);
    const maximum = customMaximum === "" ? null : Number(customMaximum);
    if (minimum === null && maximum === null) return { value: null, valid: true };
    if ((minimum !== null && (!Number.isInteger(minimum) || minimum < 1))
      || (maximum !== null && (!Number.isInteger(maximum) || maximum < 1))
      || (minimum !== null && maximum !== null && minimum > maximum)) return { value: null, valid: false };
    return { value: { min: minimum ?? 1, max: maximum }, valid: true };
  }, [customMinimum, customMaximum]);

  const selectedCountRange = useMemo(() => (
    countFilter === "2-3"
      ? { min: 2, max: 3 }
      : countFilter ? lawyerCountRangeForBand(countFilter) : customRange.value
  ), [countFilter, customRange]);

  const quickCounts = useMemo(() => {
    const list = records ?? [];
    const sharedRegistry = list.filter((record) => Boolean(record.qualifiedDossier)).length;
    const auditReady = list.filter((record) => record.qualifiedDossier?.audit.state === "ready").length;
    const identityReview = list.filter((record) => prospectIdentityState(record) === "review_needed").length;
    return { all: list.length, sharedRegistry, auditReady, identityReview };
  }, [records]);

  const filtered = useMemo(() => filterUnifiedProspectState(filterReconciledGtaProspects(records ?? [], {
    query, city, lawyerCountBand: countFilter === "unknown" ? "unknown" : "", lawyerCountRange: selectedCountRange, practiceArea, advertising, gbp, hasOwner, hasPublicEmail,
    advertisingActivity, gbpOpportunityType,
    advertisingSourceType, websiteOpportunityType, intakeChannel, lawyerCountConfidence, evidenceFreshness: freshness, cohortId, ownerContact,
  }), { source, identity, quickView }), [records, query, city, countFilter, selectedCountRange, practiceArea, advertising, gbp, hasOwner, hasPublicEmail, quickView, advertisingActivity, advertisingSourceType, gbpOpportunityType, websiteOpportunityType, intakeChannel, lawyerCountConfidence, freshness, cohortId, source, identity, ownerContact]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const displayedPage = Math.min(page, pageCount - 1);
  const visibleRecords = useMemo(() => filtered.slice(displayedPage * PAGE_SIZE, (displayedPage + 1) * PAGE_SIZE), [displayedPage, filtered]);
  const selectedOperationalContact = selectedContact?.publicContacts?.find((contact) => (
    (contact.relationship === "owner" || contact.relationship === "founder" || contact.relationship === "principal")
    && Boolean(contact.name)
  )) ?? null;

  useEffect(() => {
    const sourceRecordKeys = visibleRecords.map((record) => record.id).filter(Boolean);
    if (sourceRecordKeys.length === 0) {
      setContactStates(new Map());
      setContactStateError(null);
      return;
    }
    const controller = new AbortController();
    setContactStateLoading(true);
    setContactStateError(null);
    fetchSourceContactStates(GTA_PROSPECT_SOURCE_SYSTEM, sourceRecordKeys, controller.signal)
      .then((states) => setContactStates(states))
      .catch((cause: Error) => { if (cause.name !== "AbortError") { setContactStates(new Map()); setContactStateError(cause.message); } })
      .finally(() => { if (!controller.signal.aborted) setContactStateLoading(false); });
    return () => controller.abort();
  }, [contactRefreshToken, visibleRecords]);

  const filterChips = [
    query && { label: `Search: ${query}`, clear: () => setQuery("") }, city && { label: `City: ${city}`, clear: () => setCity("") },
    countFilter && { label: `Lawyers: ${countFilter === "2-3" ? "2 or 3" : lawyerCountRangeForBand(countFilter) ? countFilter.replace("-", " to ") : countFilter}`, clear: () => setCountFilter("") },
    !countFilter && customRange.value && { label: `Lawyers: ${customRange.value.min}${customRange.value.max === null ? "+" : ` to ${customRange.value.max}`}`, clear: () => { setCustomMinimum(""); setCustomMaximum(""); } },
    practiceArea && { label: `Practice: ${practiceArea}`, clear: () => setPracticeArea("") },
    advertising && { label: `Advertising evidence: ${evidenceLabel[advertising]}`, clear: () => setAdvertising("") },
    gbp && { label: `GBP evidence: ${evidenceLabel[gbp]}`, clear: () => setGbp("") },
    advertisingActivity && { label: advertisingActivityLabel[advertisingActivity], clear: () => setAdvertisingActivity("") },
    advertisingSourceType && { label: `Advertising source: ${titleCase(advertisingSourceType)}`, clear: () => setAdvertisingSourceType("") },
    gbpOpportunityType && { label: `GBP: ${gbpOpportunityLabels[gbpOpportunityType] ?? titleCase(gbpOpportunityType)}`, clear: () => setGbpOpportunityType("") },
    websiteOpportunityType && { label: `Website: ${websiteOpportunityLabels[websiteOpportunityType] ?? titleCase(websiteOpportunityType)}`, clear: () => setWebsiteOpportunityType("") },
    intakeChannel && { label: `Intake: ${intakeChannel}`, clear: () => setIntakeChannel("") },
    lawyerCountConfidence && { label: `Count confidence: ${titleCase(lawyerCountConfidence)}`, clear: () => setLawyerCountConfidence("") },
    freshness && { label: `Evidence: ${freshnessLabels[freshness]}`, clear: () => setFreshness("") },
    cohortId && { label: "Original qualified cohort", clear: () => setCohortId("") },
    hasOwner !== "" && { label: hasOwner ? "Owner identified" : "Owner not identified", clear: () => setHasOwner("") },
    hasPublicEmail !== "" && { label: hasPublicEmail ? "Email available" : "Email not available", clear: () => setHasPublicEmail("") },
    source && { label: `Source: ${sourceLabels[source]}`, clear: () => setSource("") },
    identity && { label: `Identity: ${identityLabels[identity]}`, clear: () => setIdentity("") },
    ownerContact && { label: `Owner contact: ${ownerContactLabels[ownerContact]}`, clear: () => setOwnerContact("") },
  ].filter(Boolean) as { label: string; clear: () => void }[];

  function clearFilters() {
    setQuery(""); setCity(""); setCountFilter(""); setCustomMinimum(""); setCustomMaximum(""); setPracticeArea(""); setAdvertising(""); setGbp("");
    setAdvertisingActivity(""); setAdvertisingSourceType(""); setGbpOpportunityType(""); setWebsiteOpportunityType(""); setIntakeChannel("");
    setLawyerCountConfidence(""); setFreshness(""); setCohortId(""); setHasOwner(""); setHasPublicEmail("");
    setSource(""); setIdentity(""); setOwnerContact("");
  }

  if (error) return <div className="rounded border border-red-fail/30 bg-white px-4 py-3 text-sm text-red-fail">Firm expansion records could not be loaded: {error}</div>;
  if (records === null) return <div className="rounded border border-black/10 bg-white px-4 py-3 text-sm text-black/50">Loading firm expansion records...</div>;

  return (
    <section aria-labelledby="reconciled-prospects-heading" className="rounded-lg border border-border-brand bg-white p-4 sm:p-5 [&_[data-ui-copy]]:text-pretty" data-ui-component-content="prospect-unified-list">
      <div className="mb-5 w-full">
        <p className="w-full text-xs font-semibold uppercase tracking-wider text-gold-on-light" data-ui-copy="supporting">Unified prospect workspace</p>
        <h2 id="reconciled-prospects-heading" className="mt-1 w-full text-xl font-bold text-navy" data-ui-copy="heading">All prospect records</h2>
        <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">Search shared firm identities, reviewed research records, and retained legacy crosswalks in one list. Open an audit when the supporting evidence is ready.</p>
        <p className="mt-2 w-full text-xs font-medium text-black/60" data-ui-copy="supporting">
          Source: {sourceDetails ? reconciledProspectSourceLabel({ source: sourceDetails.source ?? "fixture", sourceCounts: sourceDetails.sourceCounts ?? { ledger: 0, fixture: records.length }, fallbackReason: sourceDetails.fallbackReason }) : "reviewed source-controlled fixture"}, plus retained legacy directory provenance. Legacy rows remain unresolved until their firm identity is supported. Qualified cohort reconciliation: {sourceDetails?.qualifiedImport ? `${sourceDetails.qualifiedImport.updated} enriched, ${sourceDetails.qualifiedImport.added} added, ${sourceDetails.qualifiedImport.ambiguous} held for identity review` : "loading"}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Prospect record views">
        {([["all", "All records", quickCounts.all], ["shared_registry", "Shared registry", quickCounts.sharedRegistry], ["audit_ready", "Audit ready", quickCounts.auditReady], ["identity_review", "Identity review", quickCounts.identityReview]] as const).map(([value, label, count]) => (
          <button key={value} type="button" onClick={() => setQuickView(value)} aria-pressed={quickView === value} className={`rounded border px-3 py-2 text-left text-sm font-semibold transition ${quickView === value ? "border-navy bg-navy text-white" : "border-border-brand bg-parchment/50 text-navy hover:bg-parchment"}`}>
            <span className="block">{label}</span><span className={`mt-0.5 block text-xs ${quickView === value ? "text-white/75" : "text-black/50"}`}>{count} firms</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4" aria-label="Prospect record filters">
        <label className="text-xs font-semibold text-field-label">Search<input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full rounded border border-border-brand px-3 py-2 text-sm text-black" placeholder="Firm, domain, city, or practice area" /></label>
        <SelectField label="Record source" value={source} onChange={(value) => setSource(value as UnifiedProspectSource | "")}><option value="">All sources</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        <SelectField label="Identity status" value={identity} onChange={(value) => setIdentity(value as UnifiedIdentityState | "")}><option value="">All identity states</option>{Object.entries(identityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        <SelectField label="Owner contact" value={ownerContact} onChange={(value) => setOwnerContact(value as OwnerContactFilter | "")}><option value="">All owner-contact states</option>{Object.entries(ownerContactLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        <SelectField label="City" value={city} onChange={setCity}><option value="">All cities</option>{values.cities.map((value) => <option key={value} value={value}>{value}</option>)}</SelectField>
        <SelectField label="Observed lawyer count" value={countFilter} onChange={(value) => { setCountFilter(value as CountFilter); setCustomMinimum(""); setCustomMaximum(""); }}>
          <option value="">Any count</option><option value="1">1 lawyer</option><option value="2">2 lawyers</option><option value="3">3 lawyers</option><option value="2-3">2 or 3 lawyers</option><option value="4-5">4 to 5 lawyers</option><option value="6-10">6 to 10 lawyers</option><option value="11-20">11 to 20 lawyers</option><option value="21-50">21 to 50 lawyers</option><option value="51+">51 or more lawyers</option><option value="unknown">Count unknown</option>
        </SelectField>
        <SelectField label="Practice area" value={practiceArea} onChange={setPracticeArea}><option value="">All practice areas</option>{values.practiceAreas.map((value) => <option key={value} value={value}>{value}</option>)}</SelectField>
        <SelectField label="Advertising evidence" value={advertising} onChange={(value) => setAdvertising(value as EvidenceAvailability | "")}><option value="">Any availability</option><option value="observed">Observed</option><option value="none">None found</option><option value="unknown">Unknown</option></SelectField>
        <SelectField label="GBP evidence" value={gbp} onChange={(value) => setGbp(value as EvidenceAvailability | "")}><option value="">Any availability</option><option value="observed">Observed</option><option value="none">None found</option><option value="unknown">Unknown</option></SelectField>
      </div>

      <button type="button" onClick={() => setShowAdvanced((visible) => !visible)} aria-expanded={showAdvanced} className="mt-3 rounded border border-border-brand bg-white px-3 py-2 text-sm font-semibold text-navy hover:bg-parchment/50">{showAdvanced ? "Hide qualification filters" : "More qualification filters"}</button>
      {showAdvanced && (
        <div className="mt-3 grid gap-2 rounded border border-border-brand bg-parchment/30 p-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Advanced qualification filters">
          <SelectField label="Advertising activity" value={advertisingActivity} onChange={(value) => setAdvertisingActivity(value as AdvertisingActivityState | "")}><option value="">Any activity period</option>{Object.entries(advertisingActivityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
          <SelectField label="Advertising source type" value={advertisingSourceType} onChange={setAdvertisingSourceType}><option value="">All observed source types</option>{values.advertisingSourceTypes.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</SelectField>
          <SelectField label="GBP opportunity" value={gbpOpportunityType} onChange={setGbpOpportunityType}><option value="">All supported opportunities</option>{values.gbpOpportunities.map((value) => <option key={value} value={value}>{gbpOpportunityLabels[value] ?? titleCase(value)}</option>)}</SelectField>
          <SelectField label="Website opportunity" value={websiteOpportunityType} onChange={setWebsiteOpportunityType}><option value="">All website opportunities</option>{values.websiteOpportunities.map((value) => <option key={value} value={value}>{websiteOpportunityLabels[value] ?? titleCase(value)}</option>)}</SelectField>
          <SelectField label="Visible intake channel" value={intakeChannel} onChange={setIntakeChannel}><option value="">All observed channels</option>{values.intakeChannels.map((value) => <option key={value} value={value}>{value}</option>)}</SelectField>
          <SelectField label="Lawyer-count confidence" value={lawyerCountConfidence} onChange={(value) => setLawyerCountConfidence(value as QualifiedProspectConfidence | "")}><option value="">Any confidence</option><option value="high">High</option><option value="moderate">Moderate</option></SelectField>
          <SelectField label="Evidence freshness" value={freshness} onChange={(value) => setFreshness(value as EvidenceFreshness | "")}><option value="">Any observation age</option>{Object.entries(freshnessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
          <SelectField label="Research cohort" value={cohortId} onChange={setCohortId}><option value="">All cohorts</option>{values.cohorts.map((value) => <option key={value} value={value}>Qualified cohort, September 7, 2026</option>)}</SelectField>
          <SelectField label="Owner identified" value={hasOwner === "" ? "" : hasOwner ? "yes" : "no"} onChange={(value) => setHasOwner(value === "" ? "" : value === "yes")}><option value="">Any availability</option><option value="yes">Owner identified</option><option value="no">Owner not identified</option></SelectField>
          <SelectField label="Public email" value={hasPublicEmail === "" ? "" : hasPublicEmail ? "yes" : "no"} onChange={(value) => setHasPublicEmail(value === "" ? "" : value === "yes")}><option value="">Any availability</option><option value="yes">Email available</option><option value="no">Email not available</option></SelectField>
        </div>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-2" aria-label="Custom lawyer-count range">
        <label className="text-xs font-semibold text-field-label">Minimum lawyers<input type="number" min="1" inputMode="numeric" value={customMinimum} onChange={(event) => { setCountFilter(""); setCustomMinimum(event.target.value); }} className="mt-1 w-full rounded border border-border-brand px-3 py-2 text-sm text-black" placeholder="No minimum" /></label>
        <label className="text-xs font-semibold text-field-label">Maximum lawyers<input type="number" min="1" inputMode="numeric" value={customMaximum} onChange={(event) => { setCountFilter(""); setCustomMaximum(event.target.value); }} className="mt-1 w-full rounded border border-border-brand px-3 py-2 text-sm text-black" placeholder="No maximum" /></label>
      </div>
      {!customRange.valid && <p className="mt-2 text-xs text-red-fail">Use whole numbers of at least 1, with a minimum no greater than the maximum.</p>}

      {filterChips.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">{filterChips.map((chip) => <button key={chip.label} type="button" onClick={chip.clear} className="rounded-full border border-navy/20 bg-navy/5 px-3 py-1 text-xs font-medium text-navy">{chip.label} <span aria-hidden="true">x</span><span className="sr-only">, remove filter</span></button>)}<button type="button" onClick={clearFilters} className="px-2 py-1 text-xs font-semibold text-navy underline underline-offset-2">Clear filters</button></div>}
      <p className="mt-4 w-full text-sm text-black/60" aria-live="polite" data-ui-copy="supporting">{filtered.length} of {records.length} unified prospect records</p>

      {records.length === 0 ? <div className="mt-3 rounded border border-dashed border-border-brand bg-parchment/50 px-4 py-5 text-sm text-black/60">No reviewed expansion records have been added yet.</div> : filtered.length === 0 ? <div className="mt-3 rounded border border-dashed border-border-brand bg-parchment/50 px-4 py-5 text-sm text-black/60">No firms match the current view and filters.</div> : (
        <div className="mt-3 overflow-x-auto rounded border border-border-brand">
          <table className="w-full min-w-[1520px] border-collapse text-left text-sm">
            <thead className="bg-parchment text-xs uppercase tracking-wide text-field-label"><tr><th className="px-3 py-2">Firm</th><th className="px-3 py-2">Source and identity</th><th className="px-3 py-2">Lawyers</th><th className="px-3 py-2">Owner and email</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Principal opportunity</th><th className="px-3 py-2">Visible intake</th><th className="px-3 py-2">Evidence</th><th className="px-3 py-2">Review</th></tr></thead>
            <tbody>{visibleRecords.map((record) => {
              const dossier = record.qualifiedDossier;
              const identityState = prospectIdentityState(record);
              const contactState = contactStates.get(record.id);
              return <tr key={record.id} className="border-t border-border-brand align-top">
                <td className="px-3 py-3 font-semibold text-navy">{record.websiteUrl ? <a href={record.websiteUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{record.firmName}</a> : record.firmName}<span className="mt-1 block text-xs font-normal text-black/55">{record.city}</span>{record.canonicalDomain && <span className="mt-1 block text-xs font-normal text-black/55">{record.canonicalDomain}</span>}</td>
                <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{prospectSources(record).map((item) => <span key={item} className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${badgeClass(item)}`}>{sourceLabels[item]}</span>)}<span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${badgeClass(identityState)}`}>{identityLabels[identityState]}</span></div>{record.legacyCrosswalk && <span className="mt-2 block text-xs leading-5 text-black/60">{record.legacyCrosswalk}</span>}{record.reconciliationNote && <span className="mt-1 block text-xs leading-5 text-black/50">{record.reconciliationNote}</span>}</td>
                <td className="px-3 py-3"><span className="font-medium text-black/80">{observedLawyerCountLabel(record)}</span>{dossier && <><span className="mt-1 block text-xs text-black/55">{titleCase(dossier.lawyerCount.confidence)} confidence</span><span className="mt-1 block text-xs text-black/55">Observed {dossier.lawyerCount.observedAt.slice(0, 10)}</span></>}</td>
                <td className="px-3 py-3 text-xs leading-5 text-black/70">{(() => {
                  if (record.ownerContact) return <><span className="block font-semibold text-navy">{record.ownerContact.ownerName}</span><span className="block text-black/55">{ownerRoleLabel(record.ownerContact.ownerRole)}{record.ownerContact.ownershipConfidence === "leadership_only" ? " (leadership only)" : ""}</span>{record.ownerContact.emailAvailability === "direct_owner_email" && record.ownerContact.emailAddress ? <a href={`mailto:${record.ownerContact.emailAddress}`} className="mt-1 block text-navy underline underline-offset-2">{record.ownerContact.emailAddress}</a> : <span className="mt-1 block text-black/55">{record.ownerContact.emailAvailability === "firm_general_email" ? "Firm general email only" : "Direct email not available"}</span>}</>;
                  const contacts = record.publicContacts ?? [];
                  const owners = contacts.filter((contact) => contact.relationship === "owner" || contact.relationship === "founder");
                  const emails = contacts.filter((contact) => contact.email);
                  return <><span className="block font-semibold text-black/75">{owners.length > 0 ? owners.map((contact) => contact.name).filter(Boolean).join(", ") : "Owner not identified"}</span>{owners.map((contact, index) => <span key={`${contact.name}-${index}`} className="block text-black/55">{contactRoleLabel(contact.relationship)} · observed {contact.observedAt}</span>)}{emails.length > 0 ? emails.map((contact, index) => <span key={`${contact.email}-${index}`} className="mt-1 block break-all"><a href={`mailto:${contact.email ?? ""}`} className="text-navy underline underline-offset-2">{contact.email}</a><span className="ml-1 text-black/55">{contact.emailKind === "owner" ? "owner email" : contact.emailKind === "named_person" ? "named-person email" : "firm email"}</span>{contact.sourceUrl && <a href={contact.sourceUrl} target="_blank" rel="noreferrer" className="ml-1 text-navy underline underline-offset-2">source</a>}<span className="ml-1 text-black/55">observed {contact.observedAt}</span></span>) : <span className="mt-1 block text-black/55">Email not found</span>}</>;
                })()}</td>
                <td className="px-3 py-3"><ProspectContactStatus state={contactState} loading={contactStateLoading} error={contactStateError} sourceRecordKey={record.id} onOpenHistory={() => setSelectedContact(record)} /></td>
                <td className="px-3 py-3 text-black/75">{dossier ? <><span className="font-medium">GBP: {gbpOpportunityLabels[dossier.gbpOpportunity.type] ?? titleCase(dossier.gbpOpportunity.type)}</span><span className="mt-1 block text-xs text-black/55">Website: {dossier.websiteAndIntake.opportunityTypes.map((value) => websiteOpportunityLabels[value] ?? titleCase(value)).join(", ")}</span></> : <span className="text-black/50">Not assessed</span>}</td>
                <td className="px-3 py-3 text-xs leading-5 text-black/70">{dossier?.websiteAndIntake.observedChannels.join(", ") || "Not assessed"}</td>
                <td className="px-3 py-3 text-xs leading-5"><EvidenceLink availability={record.advertisingEvidence} href={record.advertisingSourceUrl} label="Advertising" /><br /><EvidenceLink availability={record.gbpEvidence} href={record.gbpSourceUrl} label="GBP" />{dossier && <span className="mt-1 block text-black/55">{dossier.evidenceIds.length} registered sources</span>}</td>
                <td className="px-3 py-3">{dossier ? <><a href={`/admin/prospects/audits/${encodeURIComponent(dossier.firmId)}`} className="inline-flex rounded bg-navy px-3 py-2 text-xs font-semibold text-white hover:bg-navy/90">Open audit</a><span className="mt-2 block text-xs text-black/55">Qualified and audit ready</span></> : <span className="text-xs text-black/50">Audit unavailable</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
      {selectedContact && <div className="mt-4"><ProspectActivityPanel
        prospectId={selectedContact.id}
        sourceSystem={GTA_PROSPECT_SOURCE_SYSTEM}
        sourceRecordKey={selectedContact.id}
        firmName={selectedContact.firmName}
        contactName={selectedOperationalContact?.name ?? null}
        contactEmail={selectedContact.publicContacts?.find((contact) => contact.email)?.email ?? null}
        provisionedPersonEmail={selectedOperationalContact?.email ?? null}
        sourceUrl={selectedContact.websiteUrl ?? selectedContact.rosterSourceUrl}
        sourcePayload={{ source_record_key: selectedContact.id, firm_name: selectedContact.firmName, city: selectedContact.city, canonical_domain: selectedContact.canonicalDomain }}
        provisioningBasis="Operator-confirmed GTA research source record. No identity match is inferred by this action."
        initialContactability={contactStates.get(selectedContact.id)?.contactability}
        initialNextAction={contactStates.get(selectedContact.id)?.next_action}
        initialNextActionDue={contactStates.get(selectedContact.id)?.next_action_due}
        open={Boolean(selectedContact)}
        onClose={() => setSelectedContact(null)}
        onActivitySaved={() => { setSelectedContact(null); setContactRefreshToken((current) => current + 1); }}
        onConversationUpdated={() => setContactRefreshToken((current) => current + 1)}
      /></div>}
      {filtered.length > PAGE_SIZE && <div className="mt-3 flex items-center justify-between gap-3 text-sm text-black/60">
        <span>Showing {displayedPage * PAGE_SIZE + 1}–{Math.min((displayedPage + 1) * PAGE_SIZE, filtered.length)}</span>
        <div className="flex gap-2"><button type="button" disabled={displayedPage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} className="rounded border border-border-brand px-3 py-2 font-semibold text-navy disabled:cursor-not-allowed disabled:opacity-50">Previous</button><button type="button" disabled={displayedPage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} className="rounded border border-border-brand px-3 py-2 font-semibold text-navy disabled:cursor-not-allowed disabled:opacity-50">Next</button></div>
      </div>}
    </section>
  );
}
