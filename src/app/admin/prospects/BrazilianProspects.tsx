"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BRAZILIAN_LAWYER_PROSPECTS,
  BUCKET_LABELS,
  OWNER_AUTHORITY_LABELS,
  RESEARCH_ELIGIBILITY_LABELS,
  filterBrazilianProspects,
  type DomainRelationshipState,
  type OwnerAuthorityCode,
  type ProspectBucket,
  type ProspectResearch,
} from "@/lib/prospect-intelligence";
import ProspectActivityPanel from "../agency-crm/ProspectActivityPanel";
import { ProspectContactStatus } from "./ProspectContactStatus";
import {
  BRAZILIAN_PROSPECT_SOURCE_SYSTEM,
  fetchSourceContactStates,
  type SourceContactStateMap,
} from "./prospect-contact-operations";

const buckets: Array<ProspectBucket | "all"> = ["all", "explicit", "portuguese", "affiliation_review", "dnc"];
const ownerCodes: Array<OwnerAuthorityCode | "all"> = ["all", "O1", "O2", "O3", "O4", "O5"];
const empty = "Not recorded";

const domainStateLabels: Record<DomainRelationshipState, string> = {
  current_primary: "Current primary",
  professional_profile: "Professional profile",
  contact_source: "Contact source",
  regulator: "Regulator",
  directory: "Directory",
  historic: "Historic",
  unresolved: "Relationship unresolved",
};

const formatState = (value: string) => value.replaceAll("_", " ");

export default function BrazilianProspects() {
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<ProspectBucket | "all">("explicit");
  const [ownerCode, setOwnerCode] = useState<OwnerAuthorityCode | "all">("all");
  const [contactStates, setContactStates] = useState<SourceContactStateMap>(new Map());
  const [contactStateLoading, setContactStateLoading] = useState(false);
  const [contactStateError, setContactStateError] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<ProspectResearch | null>(null);
  const [contactRefreshToken, setContactRefreshToken] = useState(0);
  const rows = useMemo(() => {
    const filtered = bucket === "all" ? filterBrazilianProspects(query) : filterBrazilianProspects(query, bucket);
    return ownerCode === "all" ? filtered : filtered.filter((row) => row.cohort.ownerAuthority === ownerCode);
  }, [bucket, ownerCode, query]);

  useEffect(() => {
    const sourceRecordKeys = rows.map((row) => row.sourceRecordId ?? "").filter(Boolean);
    if (sourceRecordKeys.length === 0) {
      setContactStates(new Map());
      setContactStateError(null);
      return;
    }
    const controller = new AbortController();
    setContactStateLoading(true);
    setContactStateError(null);
    fetchSourceContactStates(BRAZILIAN_PROSPECT_SOURCE_SYSTEM, sourceRecordKeys, controller.signal)
      .then((states) => setContactStates(states))
      .catch((cause: Error) => { if (cause.name !== "AbortError") { setContactStates(new Map()); setContactStateError(cause.message); } })
      .finally(() => { if (!controller.signal.aborted) setContactStateLoading(false); });
    return () => controller.abort();
  }, [contactRefreshToken, rows]);
  const reset = () => {
    setQuery("");
    setBucket("explicit");
    setOwnerCode("all");
  };
  const verifiedOwnerCount = BRAZILIAN_LAWYER_PROSPECTS.filter((row) => row.cohort.ownerAuthority === "O1" || row.cohort.ownerAuthority === "O2").length;
  const authorityReviewCount = BRAZILIAN_LAWYER_PROSPECTS.filter((row) => row.cohort.ownerAuthority === "O4" && row.bucket !== "dnc").length;

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border border-gold/30 bg-white p-4"
        data-ui-component-content="owner-research-overview"
      >
        <p className="text-sm text-black/60" data-ui-copy="body">
          Research overlay only. It has no CRM import, send action, or contact enrichment. Owner-cohort eligibility is separate from the legacy Brazil-connection selection, and every record stays on hold until owner authority is evidence-reviewed.
        </p>
        <p className="mt-2 text-xs text-black/55" data-ui-copy="supporting">
          <span className="font-semibold">Evidence legend:</span> B1 self-identified Brazilian or Brazilian-Canadian; B2 Brazil-qualified or professionally connected; B3 firm explicitly serves Brazilian clients; B4 Portuguese-speaking only, with the Brazil link unconfirmed.
        </p>
        <dl className="mt-3 grid gap-2 text-xs text-black/60 sm:grid-cols-3">
          <div className="rounded-md bg-parchment p-3">
            <dt className="font-semibold text-navy">Reviewed records</dt>
            <dd className="mt-1 text-lg font-bold text-navy">{BRAZILIAN_LAWYER_PROSPECTS.length}</dd>
          </div>
          <div className="rounded-md bg-parchment p-3">
            <dt className="font-semibold text-navy">Verified owners or operators</dt>
            <dd className="mt-1 text-lg font-bold text-navy">{verifiedOwnerCount}</dd>
          </div>
          <div className="rounded-md bg-parchment p-3">
            <dt className="font-semibold text-navy">Owner-authority reviews required</dt>
            <dd className="mt-1 text-lg font-bold text-navy">{authorityReviewCount}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Prospect categories">
          {buckets.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={bucket === item}
              onClick={() => setBucket(item)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${bucket === item ? "bg-navy text-white" : "bg-parchment text-navy"}`}
            >
              {item === "all" ? `All (${BRAZILIAN_LAWYER_PROSPECTS.length})` : `${BUCKET_LABELS[item]} (${BRAZILIAN_LAWYER_PROSPECTS.filter((row) => row.bucket === item).length})`}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)_auto] md:items-end">
          <div>
            <label className="block text-xs font-semibold text-navy" htmlFor="prospect-search">Search person, firm, ID, or mapped domain</label>
            <input
              id="prospect-search"
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="For example, Sakuraba or faurilaw"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-navy" htmlFor="owner-authority-filter">Owner authority</label>
            <select
              id="owner-authority-filter"
              className="mt-1 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm"
              value={ownerCode}
              onChange={(event) => setOwnerCode(event.target.value as OwnerAuthorityCode | "all")}
            >
              {ownerCodes.map((code) => <option key={code} value={code}>{code === "all" ? "All authority states" : `${code}: ${OWNER_AUTHORITY_LABELS[code]}`}</option>)}
            </select>
          </div>
          <button type="button" onClick={reset} className="rounded-md border border-navy px-3 py-2 text-sm font-semibold text-navy">Reset filters</button>
        </div>
      </div>
      <p className="text-xs text-black/50">{rows.length} matching record{rows.length === 1 ? "" : "s"}</p>
      <div className="overflow-x-auto rounded-xl border border-black/10 bg-white" tabIndex={0} aria-label="Brazilian lawyer research results; scroll horizontally on small screens">
        <table className="w-full min-w-[1320px] text-left text-sm">
          <thead className="bg-parchment text-xs uppercase tracking-wide text-black/55">
            <tr>
              <th className="p-3">Person and firm</th>
              <th className="p-3">Owner research state</th>
              <th className="p-3">Evidence and unknowns</th>
              <th className="p-3">Public contact and provenance</th>
              <th className="p-3">Contact</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-black/10 align-top">
                <td className="p-3">
                  <p className="font-semibold text-navy">{row.name}</p>
                  <p className="text-black/60">{row.firm}</p>
                  <p className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${row.bucket === "dnc" ? "bg-red-100 text-red-800" : row.bucket === "explicit" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{BUCKET_LABELS[row.bucket]}</p>
                  <dl className="mt-2 space-y-1 text-xs text-black/60">
                    <div><dt className="inline font-semibold">Person ID: </dt><dd className="inline">{row.cohort.canonicalPersonId}</dd></div>
                    <div><dt className="inline font-semibold">Firm ID: </dt><dd className="inline">{row.cohort.canonicalFirmId}</dd></div>
                    <div><dt className="inline font-semibold">Source record: </dt><dd className="inline">{row.sourceRecordId ?? empty}</dd></div>
                  </dl>
                </td>
                <td className="p-3">
                  <p className="font-semibold text-navy">{row.cohort.ownerAuthority}: {OWNER_AUTHORITY_LABELS[row.cohort.ownerAuthority]}</p>
                  <dl className="mt-2 space-y-1 text-xs text-black/60">
                    <div><dt className="inline font-semibold">Eligibility: </dt><dd className="inline">{RESEARCH_ELIGIBILITY_LABELS[row.cohort.researchEligibility]}</dd></div>
                    <div><dt className="inline font-semibold">Research state: </dt><dd className="inline capitalize">{formatState(row.cohort.researchState)}</dd></div>
                    <div><dt className="inline font-semibold">Interview state: </dt><dd className="inline capitalize">{formatState(row.cohort.interviewState)}</dd></div>
                    <div><dt className="inline font-semibold">Authority evidence: </dt><dd className="inline">{row.cohort.ownerAuthorityEvidence.length ? row.cohort.ownerAuthorityEvidence.join(", ") : empty}</dd></div>
                  </dl>
                </td>
                <td className="p-3">
                  <p className="font-semibold">Connection evidence: {row.evidence}</p>
                  <p className="mt-1 text-xs text-black/60">Cohort evidence confidence: <span className="font-semibold capitalize">{formatState(row.cohort.evidenceConfidence)}</span></p>
                  {row.portugueseBrazilConnection && <p className="mt-1 text-xs text-black/60">{row.portugueseBrazilConnection.statement} <a className="text-blue-700 underline" href={row.portugueseBrazilConnection.evidenceSource} target="_blank" rel="noreferrer">View evidence</a></p>}
                  {row.cohort.explicitUnknowns.length > 0 && <p className="mt-2 text-xs text-black/55"><span className="font-semibold">Explicit unknowns:</span> {row.cohort.explicitUnknowns.join(" ")}</p>}
                  {row.publicContact?.practiceAreas.length ? <p className="mt-2 text-xs text-black/55"><span className="font-semibold">Practice areas:</span> {row.publicContact.practiceAreas.join(" · ")}</p> : null}
                </td>
                <td className="p-3 text-xs">
                  <p>Website: {row.website ? <a className="break-all text-blue-700 underline" href={row.website} target="_blank" rel="noreferrer">{row.website}</a> : empty}</p>
                  <p>Email: {row.email ?? empty}</p>
                  <p>Phone: {row.phone ?? empty}</p>
                  <p>LSO: {row.publicContact?.lsoNumber ?? empty} {row.publicContact?.lsoSourceUrl && <a className="text-blue-700 underline" href={row.publicContact.lsoSourceUrl} target="_blank" rel="noreferrer">View source</a>}</p>
                  <div className="mt-2">
                    <p className="font-semibold">Contact-source provenance</p>
                    {row.cohort.contactSourceProvenance.length ? <ul className="mt-1 space-y-1">{row.cohort.contactSourceProvenance.map((entry) => <li key={`${entry.field}:${entry.value}`}><span className="capitalize">{entry.field}</span>: {entry.sourceUrl ? <a className="break-all text-blue-700 underline" href={entry.sourceUrl} target="_blank" rel="noreferrer">source</a> : empty} <span className="text-black/50">({formatState(entry.confidence)})</span></li>)}</ul> : <p>{empty}</p>}
                  </div>
                  <div className="mt-2">
                    <p className="font-semibold">Mapped domains and relationships</p>
                    {row.cohort.domainRelationships.length ? <ul className="mt-1 space-y-1">{row.cohort.domainRelationships.map((relationship) => <li key={relationship.url}><a className="break-all text-blue-700 underline" href={relationship.url} target="_blank" rel="noreferrer">{relationship.host}</a> <span className="text-black/50">({domainStateLabels[relationship.state]})</span></li>)}</ul> : <p>{empty}</p>}
                  </div>
                </td>
                <td className="p-3"><ProspectContactStatus
                  state={row.sourceRecordId ? contactStates.get(row.sourceRecordId) : undefined}
                  loading={contactStateLoading && Boolean(row.sourceRecordId)}
                  error={contactStateError}
                  sourceRecordKey={row.sourceRecordId}
                  onOpenHistory={() => setSelectedContact(row)}
                /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedContact && selectedContact.sourceRecordId && <div className="mt-4"><ProspectActivityPanel
        prospectId={selectedContact.sourceRecordId}
        sourceSystem={BRAZILIAN_PROSPECT_SOURCE_SYSTEM}
        sourceRecordKey={selectedContact.sourceRecordId}
        firmName={selectedContact.firm}
        contactName={selectedContact.name}
        contactEmail={selectedContact.email ?? null}
        sourceUrl={selectedContact.website ?? selectedContact.cohort.domainRelationships.find((relationship) => relationship.state === "current_primary" || relationship.state === "professional_profile" || relationship.state === "contact_source")?.url ?? null}
        sourcePayload={{ source_record_key: selectedContact.sourceRecordId, person_id: selectedContact.cohort.canonicalPersonId, firm_id: selectedContact.cohort.canonicalFirmId, person_name: selectedContact.name, firm_name: selectedContact.firm }}
        provisioningBasis={`Operator-confirmed Brazilian owner-cohort source record. Authority evidence: ${selectedContact.cohort.ownerAuthorityEvidence.join('; ') || 'reviewed cohort record'}. No identity match is inferred by this action.`}
        initialContactability={contactStates.get(selectedContact.sourceRecordId)?.contactability}
        initialNextAction={contactStates.get(selectedContact.sourceRecordId)?.next_action}
        initialNextActionDue={contactStates.get(selectedContact.sourceRecordId)?.next_action_due}
        open={Boolean(selectedContact)}
        onClose={() => setSelectedContact(null)}
        onActivitySaved={() => { setSelectedContact(null); setContactRefreshToken((current) => current + 1); }}
        onConversationUpdated={() => setContactRefreshToken((current) => current + 1)}
      /></div>}
    </div>
  );
}
