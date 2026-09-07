"use client";

import { useEffect, useMemo, useState } from "react";
import {
  filterReconciledGtaProspects,
  LAWYER_COUNT_BANDS,
  lawyerCountBand,
  lawyerCountBandLabel,
  observedLawyerCountLabel,
  type EvidenceAvailability,
  type LawyerCountBand,
  type ReconciledGtaProspect,
} from "@/lib/gta-prospect-records";

type RecordsResponse = { records?: ReconciledGtaProspect[]; error?: string };

const evidenceLabel: Record<EvidenceAvailability, string> = {
  observed: "Observed",
  none: "None found",
  unknown: "Unknown",
};

const reconciliationLabel: Record<ReconciledGtaProspect["reconciliationStatus"], string> = {
  provisional_new: "Provisional new",
  update_existing: "Existing record update",
  new_pending_identity: "New, identity pending",
  duplicate: "Duplicate",
  unresolved: "Unresolved",
};

function EvidenceLink({ availability, href, label }: { availability: EvidenceAvailability; href: string | null; label: string }) {
  const content = `${label}: ${evidenceLabel[availability]}`;
  if (!href) return <span className="text-black/50">{content}</span>;
  return <a href={href} target="_blank" rel="noreferrer" className="text-navy underline underline-offset-2">{content}</a>;
}

export default function ReconciledProspects() {
  const [records, setRecords] = useState<ReconciledGtaProspect[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [selectedLawyerCountBand, setSelectedLawyerCountBand] = useState<LawyerCountBand | "">("");
  const [practiceArea, setPracticeArea] = useState("");
  const [advertising, setAdvertising] = useState<EvidenceAvailability | "">("");
  const [gbp, setGbp] = useState<EvidenceAvailability | "">("");

  useEffect(() => {
    let cancelled = false;
    fetch("/admin/prospects/reconciled")
      .then(async (response) => {
        const body = (await response.json()) as RecordsResponse;
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body.records ?? [];
      })
      .then((nextRecords) => { if (!cancelled) setRecords(nextRecords); })
      .catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, []);

  const cities = useMemo(() => [...new Set((records ?? []).map((record) => record.city))].sort(), [records]);
  const practiceAreas = useMemo(
    () => [...new Set((records ?? []).flatMap((record) => record.practiceAreas))].sort(),
    [records],
  );
  const filtered = useMemo(
    () => filterReconciledGtaProspects(records ?? [], { query, city, lawyerCountBand: selectedLawyerCountBand, practiceArea, advertising, gbp }),
    [records, query, city, selectedLawyerCountBand, practiceArea, advertising, gbp],
  );

  if (error) {
    return <div className="rounded border border-red-fail/30 bg-white px-4 py-3 text-sm text-red-fail">Reconciled firm records could not be loaded: {error}</div>;
  }
  if (records === null) {
    return <div className="rounded border border-black/10 bg-white px-4 py-3 text-sm text-black/50">Loading reconciled firm records…</div>;
  }

  return (
    <section aria-labelledby="reconciled-prospects-heading" className="rounded-lg border border-border-brand bg-white p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-on-light">Firm expansion</p>
        <h2 id="reconciled-prospects-heading" className="mt-1 text-xl font-bold text-navy">Reviewed GTA firm records</h2>
        <p className="mt-1 text-sm text-black/60">Firm-level public roster evidence, reconciled separately from the older LSO address-cluster list.</p>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" aria-label="Firm record filters">
        <label className="text-xs font-semibold text-field-label">Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full rounded border border-border-brand px-3 py-2 text-sm text-black" placeholder="Firm, city, website, or practice area" />
        </label>
        <label className="text-xs font-semibold text-field-label">City
          <select value={city} onChange={(event) => setCity(event.target.value)} className="mt-1 w-full rounded border border-border-brand bg-white px-3 py-2 text-sm text-black"><option value="">All cities</option>{cities.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        </label>
        <label className="text-xs font-semibold text-field-label">Lawyer count
          <select value={selectedLawyerCountBand} onChange={(event) => setSelectedLawyerCountBand(event.target.value as LawyerCountBand | "")} className="mt-1 w-full rounded border border-border-brand bg-white px-3 py-2 text-sm text-black"><option value="">Any count</option>{LAWYER_COUNT_BANDS.map((band) => <option key={band} value={band}>{lawyerCountBandLabel(band)}</option>)}</select>
        </label>
        <label className="text-xs font-semibold text-field-label">Practice area
          <select value={practiceArea} onChange={(event) => setPracticeArea(event.target.value)} className="mt-1 w-full rounded border border-border-brand bg-white px-3 py-2 text-sm text-black"><option value="">All practice areas</option>{practiceAreas.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        </label>
        <label className="text-xs font-semibold text-field-label">Advertising evidence
          <select value={advertising} onChange={(event) => setAdvertising(event.target.value as EvidenceAvailability | "")} className="mt-1 w-full rounded border border-border-brand bg-white px-3 py-2 text-sm text-black"><option value="">Any availability</option><option value="observed">Observed</option><option value="none">None found</option><option value="unknown">Unknown</option></select>
        </label>
        <label className="text-xs font-semibold text-field-label">GBP evidence
          <select value={gbp} onChange={(event) => setGbp(event.target.value as EvidenceAvailability | "")} className="mt-1 w-full rounded border border-border-brand bg-white px-3 py-2 text-sm text-black"><option value="">Any availability</option><option value="observed">Observed</option><option value="none">None found</option><option value="unknown">Unknown</option></select>
        </label>
      </div>

      <p className="mt-4 text-sm text-black/60" aria-live="polite">{filtered.length} of {records.length} reviewed firm records</p>

      {records.length === 0 ? (
        <div className="mt-3 rounded border border-dashed border-border-brand bg-parchment/50 px-4 py-5 text-sm text-black/60">No reviewed expansion records have been added yet. The reconciliation batch will populate this section without changing the legacy list below.</div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-border-brand">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead className="bg-parchment text-xs uppercase tracking-wide text-field-label">
              <tr><th className="px-3 py-2">Firm</th><th className="px-3 py-2">Roster count</th><th className="px-3 py-2">Location</th><th className="px-3 py-2">Roster source</th><th className="px-3 py-2">Reconciliation</th><th className="px-3 py-2">Optional evidence</th></tr>
            </thead>
            <tbody>
              {filtered.map((record) => (
                <tr key={record.id} className="border-t border-border-brand align-top">
                  <td className="px-3 py-3 font-semibold text-navy">{record.websiteUrl ? <a href={record.websiteUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{record.firmName}</a> : record.firmName}<span className="mt-1 block text-xs font-normal text-black/55">{record.practiceAreas.join(", ") || "Practice area unknown"}</span></td>
                  <td className="px-3 py-3"><span className="font-medium text-black/80">{observedLawyerCountLabel(record)}</span><span className="mt-1 block text-xs text-black/55">Band: {lawyerCountBandLabel(lawyerCountBand(record.observedLawyerCount))}</span></td>
                  <td className="px-3 py-3 text-black/75">{record.city}</td>
                  <td className="px-3 py-3">{record.rosterSourceUrl ? <a href={record.rosterSourceUrl} target="_blank" rel="noreferrer" className="text-navy underline underline-offset-2">Public roster</a> : <span className="text-black/50">Not recorded</span>}<span className="mt-1 block text-xs text-black/55">Checked {record.rosterCheckedAt}</span></td>
                  <td className="px-3 py-3"><span className="text-black/75">{reconciliationLabel[record.reconciliationStatus]}</span>{record.legacyClusterLawyerCount !== null && <span className="mt-1 block text-xs text-black/55">Legacy cluster: {record.legacyClusterLawyerCount}</span>}{record.reconciliationNote && <span className="mt-1 block text-xs text-black/55">{record.reconciliationNote}</span>}</td>
                  <td className="px-3 py-3 text-xs leading-5"><EvidenceLink availability={record.advertisingEvidence} href={record.advertisingSourceUrl} label="Advertising" /><br /><EvidenceLink availability={record.gbpEvidence} href={record.gbpSourceUrl} label="GBP" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
