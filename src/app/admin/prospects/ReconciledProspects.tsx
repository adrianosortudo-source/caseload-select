"use client";

import { useEffect, useMemo, useState } from "react";
import {
  filterReconciledGtaProspects,
  observedLawyerCountLabel,
  type EvidenceAvailability,
  type ReconciledGtaProspect,
} from "@/lib/gta-prospect-records";
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

export type RecordsResponse = {
  records?: ReconciledGtaProspect[];
  source?: ReconciledProspectSource;
  sourceCounts?: ReconciledProspectSourceCounts;
  qualifiedImport?: QualifiedProspectImportReport;
  fallbackReason?: ReconciledProspectFallbackReason;
  error?: string;
};

type QuickView = "all" | "qualified" | "audit_ready" | "needs_evidence";
type CountFilter = "" | "2" | "3" | "2-3";

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

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function EvidenceLink({ availability, href, label }: { availability: EvidenceAvailability; href: string | null; label: string }) {
  const content = `${label}: ${evidenceLabel[availability]}`;
  if (!href) return <span className="text-black/50">{content}</span>;
  return <a href={href} target="_blank" rel="noreferrer" className="text-navy underline underline-offset-2">{content}</a>;
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
      cities: [...new Set(list.flatMap((record) => record.officeCities))].sort(),
      practiceAreas: [...new Set(list.flatMap((record) => record.practiceAreas))].sort(),
      gbpOpportunities: [...new Set(dossiers.map((dossier) => dossier.gbpOpportunity.type))].sort(),
      advertisingSourceTypes: [...new Set(dossiers.flatMap((dossier) => dossier.advertisingActivity.sourceTypes))].sort(),
      websiteOpportunities: [...new Set(dossiers.flatMap((dossier) => dossier.websiteAndIntake.opportunityTypes))].sort(),
      intakeChannels: [...new Set(dossiers.flatMap((dossier) => dossier.websiteAndIntake.observedChannels))].sort(),
      cohorts: [...new Set(dossiers.map((dossier) => dossier.qualification.cohortId))].sort(),
    };
  }, [records]);

  const quickCounts = useMemo(() => {
    const list = records ?? [];
    const qualified = list.filter((record) => Boolean(record.qualifiedDossier)).length;
    const auditReady = list.filter((record) => record.qualifiedDossier?.audit.state === "ready").length;
    return { all: list.length, qualified, auditReady, needsEvidence: list.length - qualified };
  }, [records]);

  const filtered = useMemo(() => filterReconciledGtaProspects(records ?? [], {
    query, city, exactLawyerCount: countFilter, practiceArea, advertising, gbp,
    qualification: quickView === "qualified" ? "qualified" : quickView === "needs_evidence" ? "needs_evidence" : "",
    audit: quickView === "audit_ready" ? "ready" : "", advertisingActivity, gbpOpportunityType,
    advertisingSourceType, websiteOpportunityType, intakeChannel, lawyerCountConfidence, evidenceFreshness: freshness, cohortId,
  }), [records, query, city, countFilter, practiceArea, advertising, gbp, quickView, advertisingActivity, advertisingSourceType, gbpOpportunityType, websiteOpportunityType, intakeChannel, lawyerCountConfidence, freshness, cohortId]);

  const filterChips = [
    query && { label: `Search: ${query}`, clear: () => setQuery("") }, city && { label: `City: ${city}`, clear: () => setCity("") },
    countFilter && { label: `Lawyers: ${countFilter === "2-3" ? "2 or 3" : countFilter}`, clear: () => setCountFilter("") },
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
  ].filter(Boolean) as { label: string; clear: () => void }[];

  function clearFilters() {
    setQuery(""); setCity(""); setCountFilter(""); setPracticeArea(""); setAdvertising(""); setGbp("");
    setAdvertisingActivity(""); setAdvertisingSourceType(""); setGbpOpportunityType(""); setWebsiteOpportunityType(""); setIntakeChannel("");
    setLawyerCountConfidence(""); setFreshness(""); setCohortId("");
  }

  if (error) return <div className="rounded border border-red-fail/30 bg-white px-4 py-3 text-sm text-red-fail">Firm expansion records could not be loaded: {error}</div>;
  if (records === null) return <div className="rounded border border-black/10 bg-white px-4 py-3 text-sm text-black/50">Loading firm expansion records...</div>;

  return (
    <section aria-labelledby="reconciled-prospects-heading" className="rounded-lg border border-border-brand bg-white p-4 sm:p-5 [&_[data-ui-copy]]:text-pretty" data-ui-component-content="firm-expansion">
      <div className="mb-5 w-full">
        <p className="w-full text-xs font-semibold uppercase tracking-wider text-gold-on-light" data-ui-copy="supporting">Firm expansion</p>
        <h2 id="reconciled-prospects-heading" className="mt-1 w-full text-xl font-bold text-navy" data-ui-copy="heading">Reviewed GTA firm records</h2>
        <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">Use qualification evidence to find firms with a supported marketing opportunity, then open the firm audit for the underlying observations and limits.</p>
        <p className="mt-2 w-full text-xs font-medium text-black/60" data-ui-copy="supporting">
          Source: {sourceDetails ? reconciledProspectSourceLabel({ source: sourceDetails.source ?? "fixture", sourceCounts: sourceDetails.sourceCounts ?? { ledger: 0, fixture: records.length }, fallbackReason: sourceDetails.fallbackReason }) : "reviewed source-controlled fixture"}. Qualified cohort reconciliation: {sourceDetails?.qualifiedImport ? `${sourceDetails.qualifiedImport.updated} enriched, ${sourceDetails.qualifiedImport.added} added, ${sourceDetails.qualifiedImport.ambiguous} held for identity review` : "loading"}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Firm expansion views">
        {([["all", "All reviewed", quickCounts.all], ["qualified", "Qualified", quickCounts.qualified], ["audit_ready", "Audit ready", quickCounts.auditReady], ["needs_evidence", "Needs evidence", quickCounts.needsEvidence]] as const).map(([value, label, count]) => (
          <button key={value} type="button" onClick={() => setQuickView(value)} aria-pressed={quickView === value} className={`rounded border px-3 py-2 text-left text-sm font-semibold transition ${quickView === value ? "border-navy bg-navy text-white" : "border-border-brand bg-parchment/50 text-navy hover:bg-parchment"}`}>
            <span className="block">{label}</span><span className={`mt-0.5 block text-xs ${quickView === value ? "text-white/75" : "text-black/50"}`}>{count} firms</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3" aria-label="Firm record filters">
        <label className="text-xs font-semibold text-field-label">Search<input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full rounded border border-border-brand px-3 py-2 text-sm text-black" placeholder="Firm, city, website, or practice area" /></label>
        <SelectField label="City" value={city} onChange={setCity}><option value="">All cities</option>{values.cities.map((value) => <option key={value} value={value}>{value}</option>)}</SelectField>
        <SelectField label="Lawyer count" value={countFilter} onChange={(value) => setCountFilter(value as CountFilter)}><option value="">Any count</option><option value="2">Exactly 2 lawyers</option><option value="3">Exactly 3 lawyers</option><option value="2-3">2 or 3 lawyers</option></SelectField>
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
        </div>
      )}

      {filterChips.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">{filterChips.map((chip) => <button key={chip.label} type="button" onClick={chip.clear} className="rounded-full border border-navy/20 bg-navy/5 px-3 py-1 text-xs font-medium text-navy">{chip.label} <span aria-hidden="true">x</span><span className="sr-only">, remove filter</span></button>)}<button type="button" onClick={clearFilters} className="px-2 py-1 text-xs font-semibold text-navy underline underline-offset-2">Clear filters</button></div>}
      <p className="mt-4 w-full text-sm text-black/60" aria-live="polite" data-ui-copy="supporting">{filtered.length} of {records.length} reviewed firm records</p>

      {records.length === 0 ? <div className="mt-3 rounded border border-dashed border-border-brand bg-parchment/50 px-4 py-5 text-sm text-black/60">No reviewed expansion records have been added yet.</div> : filtered.length === 0 ? <div className="mt-3 rounded border border-dashed border-border-brand bg-parchment/50 px-4 py-5 text-sm text-black/60">No firms match the current view and filters.</div> : (
        <div className="mt-3 overflow-x-auto rounded border border-border-brand">
          <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
            <thead className="bg-parchment text-xs uppercase tracking-wide text-field-label"><tr><th className="px-3 py-2">Firm</th><th className="px-3 py-2">Qualification</th><th className="px-3 py-2">Lawyers</th><th className="px-3 py-2">Principal opportunity</th><th className="px-3 py-2">Visible intake</th><th className="px-3 py-2">Evidence</th><th className="px-3 py-2">Review</th></tr></thead>
            <tbody>{filtered.map((record) => {
              const dossier = record.qualifiedDossier;
              return <tr key={record.id} className="border-t border-border-brand align-top">
                <td className="px-3 py-3 font-semibold text-navy">{record.websiteUrl ? <a href={record.websiteUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{record.firmName}</a> : record.firmName}<span className="mt-1 block text-xs font-normal text-black/55">{record.city}</span>{record.canonicalDomain && <span className="mt-1 block text-xs font-normal text-black/55">{record.canonicalDomain}</span>}</td>
                <td className="px-3 py-3">{dossier ? <><span className="inline-flex rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-900">Qualified</span><span className="mt-1 block text-xs text-black/55">Audit ready</span></> : <><span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Needs evidence</span><span className="mt-1 block text-xs text-black/55">Qualification incomplete</span></>}</td>
                <td className="px-3 py-3"><span className="font-medium text-black/80">{observedLawyerCountLabel(record)}</span>{dossier && <><span className="mt-1 block text-xs text-black/55">{titleCase(dossier.lawyerCount.confidence)} confidence</span><span className="mt-1 block text-xs text-black/55">Observed {dossier.lawyerCount.observedAt.slice(0, 10)}</span></>}</td>
                <td className="px-3 py-3 text-black/75">{dossier ? <><span className="font-medium">GBP: {gbpOpportunityLabels[dossier.gbpOpportunity.type] ?? titleCase(dossier.gbpOpportunity.type)}</span><span className="mt-1 block text-xs text-black/55">Website: {dossier.websiteAndIntake.opportunityTypes.map((value) => websiteOpportunityLabels[value] ?? titleCase(value)).join(", ")}</span></> : <span className="text-black/50">Not assessed</span>}</td>
                <td className="px-3 py-3 text-xs leading-5 text-black/70">{dossier?.websiteAndIntake.observedChannels.join(", ") || "Not assessed"}</td>
                <td className="px-3 py-3 text-xs leading-5"><EvidenceLink availability={record.advertisingEvidence} href={record.advertisingSourceUrl} label="Advertising" /><br /><EvidenceLink availability={record.gbpEvidence} href={record.gbpSourceUrl} label="GBP" />{dossier && <span className="mt-1 block text-black/55">{dossier.evidenceIds.length} registered sources</span>}</td>
                <td className="px-3 py-3">{dossier ? <a href={`/admin/prospects/audits/${encodeURIComponent(dossier.firmId)}`} className="inline-flex rounded bg-navy px-3 py-2 text-xs font-semibold text-white hover:bg-navy/90">Open audit</a> : <span className="text-xs text-black/50">Audit unavailable</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
