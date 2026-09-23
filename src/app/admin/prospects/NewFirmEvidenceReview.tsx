"use client";

import { useState } from "react";
import {
  deriveProspectEnrichmentNewCoreInput, prospectCoreObservationDate,
  type ProspectEnrichmentCoreBoundCandidate, type ProspectEnrichmentCoreReference,
  type ProspectEnrichmentNewCoreOptions, type SourceBoundNewCoreInput,
} from "@/lib/prospect-enrichment-core-evidence";
import { ResearchError, ResearchJson, ResearchSource, researchButton, researchInput } from "./ResearchEvidence";

const key = (value: ProspectEnrichmentCoreReference) => value.itemId + "|" + value.sourceId;
const ref = (value: string): ProspectEnrichmentCoreReference => { const [itemId, sourceId] = value.split("|"); return { itemId, sourceId }; };
const boundLabel = (value: ProspectEnrichmentCoreBoundCandidate) => {
  const item = value.observation;
  const name = item.kind === "firm_fit" ? item.data.office.city : item.kind === "service" ? item.data.name : item.kind === "roster" ? item.data.display : item.kind;
  return name + " · " + (prospectCoreObservationDate(item) ?? "Date unknown") + " · " + value.sourceId;
};
function BoundEvidence({ label, candidate }: { label: string; candidate: ProspectEnrichmentCoreBoundCandidate | undefined }) {
  if (!candidate) return null;
  return <article className="min-w-0 space-y-3 rounded-md border border-border-brand p-3">
    <h4 className="text-sm font-semibold text-navy">{label}</h4>
    <ResearchJson value={{ itemId: candidate.itemId, sourceId: candidate.sourceId, observedAt: candidate.observation.observedAt, observedOn: candidate.observation.observedOn, value: candidate.observation.data }} />
    <ResearchSource source={candidate.source} />
  </article>;
}

export default function NewFirmEvidenceReview({ options, disabled, onChange }: {
  options: ProspectEnrichmentNewCoreOptions; disabled: boolean; onChange: (value: SourceBoundNewCoreInput | null) => void;
}) {
  const [nameSource, setNameSource] = useState(""), [city, setCity] = useState(""), [roster, setRoster] = useState("");
  const [offices, setOffices] = useState<string[]>([]), [services, setServices] = useState<string[]>([]), [website, setWebsite] = useState("");
  const [note, setNote] = useState(""), [reviewed, setReviewed] = useState(false);
  const [prepared, setPrepared] = useState<SourceBoundNewCoreInput | null>(null), [error, setError] = useState<string | null>(null);
  function invalidate() { setPrepared(null); setReviewed(false); setError(null); onChange(null); }
  const cityCandidate = options.cities.find((candidate) => key(candidate) === city);
  const rosterCandidate = options.rosters.find((candidate) => key(candidate) === roster);
  const rosterDate = rosterCandidate ? prospectCoreObservationDate(rosterCandidate.observation) : null;
  const selectedNameSource = options.firmNameSources.find((source) => source.sourceId === nameSource);
  const selectedWebsite = options.websiteSources.find((source) => source.sourceId === website);
  const cityName = cityCandidate?.observation.kind === "firm_fit" ? cityCandidate.observation.data.office.city : null;
  const normalize = (value: string | null) => value?.trim().toLowerCase().replace(/\s+/g, " ");
  const extraCities = options.cities.filter((candidate) => candidate.observation.kind === "firm_fit" && normalize(candidate.observation.data.office.city) !== normalize(cityName));
  function prepare() {
    try {
      if (!reviewed) throw new Error("Review the source evidence for every selected field before preparing the new firm.");
      const value = deriveProspectEnrichmentNewCoreInput(options, { firmName: { sourceId: nameSource }, city: ref(city),
        officeCities: [ref(city), ...offices.map(ref)], websiteUrl: { sourceId: website || null },
        practiceAreas: services.map(ref), roster: ref(roster) }, note);
      setPrepared(value); setError(null); onChange(value);
    } catch (cause) { setPrepared(null); onChange(null); setError(cause instanceof Error ? cause.message : "The selected source evidence is incomplete."); }
  }
  return <section className="min-w-0 space-y-4" data-ui-component-content="new-firm-evidence-review">
    <h3 className="w-full text-base font-semibold text-navy" data-ui-copy="heading">Select evidence for the new firm</h3>
    <p className="w-full text-sm text-black/60" data-ui-copy="supporting">Each value comes from its selected source. Review the evidence and explain why this is a separate firm.</p>
    {!options.eligible && <ResearchError message="New-firm creation remains on hold because identity or source evidence is incomplete." />}
    {error && <ResearchError message={error} />}
    <fieldset disabled={disabled || !options.eligible} className="min-w-0 space-y-4">
      <legend className="sr-only">Source-bound firm fields</legend>
      <label className="block text-sm font-semibold">Firm-name source<select className={researchInput + " mt-2"} value={nameSource} onChange={(event) => { invalidate(); setNameSource(event.target.value); }}>
        <option value="">Select the public excerpt containing {options.firmName}</option>
        {options.firmNameSources.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.sourceId} · {source.url}</option>)}
      </select></label>
      {selectedNameSource && <ResearchSource source={selectedNameSource} />}
      <label className="block text-sm font-semibold">Primary office city<select className={researchInput + " mt-2"} value={city} onChange={(event) => { invalidate(); setCity(event.target.value); setOffices([]); }}>
        <option value="">Select a source-supported city</option>{options.cities.map((candidate) => <option key={key(candidate)} value={key(candidate)}>{boundLabel(candidate)}</option>)}
      </select></label>
      <BoundEvidence label="Primary office evidence" candidate={cityCandidate} />
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Additional office cities</legend>
        {extraCities.map((candidate) => <label key={key(candidate)} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={offices.includes(key(candidate))} onChange={(event) => {
          invalidate(); const name = candidate.observation.kind === "firm_fit" ? normalize(candidate.observation.data.office.city) : null;
          setOffices((current) => event.target.checked ? [...current.filter((value) => { const other = options.cities.find((item) => key(item) === value); return other?.observation.kind !== "firm_fit" || normalize(other.observation.data.office.city) !== name; }), key(candidate)] : current.filter((value) => value !== key(candidate)));
        }} /><span>{boundLabel(candidate)}</span></label>)}
        {!extraCities.length && <p className="text-sm text-black/60">No additional supported office city is available.</p>}
      </fieldset>
      {offices.map((value) => <BoundEvidence key={value} label="Additional office evidence" candidate={options.cities.find((candidate) => key(candidate) === value)} />)}
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Verified service names</legend>
        {options.services.map((candidate) => <label key={key(candidate)} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={services.includes(key(candidate))} onChange={(event) => {
          invalidate(); const name = candidate.observation.kind === "service" ? candidate.observation.data.name : null;
          setServices((current) => event.target.checked ? [...current.filter((value) => { const other = options.services.find((item) => key(item) === value); return other?.observation.kind !== "service" || other.observation.data.name !== name; }), key(candidate)] : current.filter((value) => value !== key(candidate)));
        }} /><span>{boundLabel(candidate)}</span></label>)}
        {!options.services.length && <p className="text-sm text-black/60">No service evidence is available. The practice-area list will remain empty.</p>}
      </fieldset>
      {services.map((value) => <BoundEvidence key={value} label="Service evidence" candidate={options.services.find((candidate) => key(candidate) === value)} />)}
      <label className="block text-sm font-semibold">Roster observation<select className={researchInput + " mt-2"} value={roster} onChange={(event) => { invalidate(); setRoster(event.target.value); setWebsite(""); }}>
        <option value="">Select the exact roster count and date</option>{options.rosters.map((candidate) => <option key={key(candidate)} value={key(candidate)}>{boundLabel(candidate)}</option>)}
      </select></label>
      <BoundEvidence label="Roster evidence" candidate={rosterCandidate} />
      <label className="block text-sm font-semibold">Website source<select className={researchInput + " mt-2"} value={website} disabled={!rosterDate} onChange={(event) => { invalidate(); setWebsite(event.target.value); }}>
        <option value="">Keep website unselected</option>{options.websiteSources.filter((source) => prospectCoreObservationDate(source) === rosterDate).map((source) => <option key={source.sourceId} value={source.sourceId}>{source.sourceId} · {source.url}</option>)}
      </select></label>
      <p className="text-sm text-black/60">Only website evidence recorded on the selected roster date can initialize this field.</p>
      {selectedWebsite && <ResearchSource source={selectedWebsite} />}
      <label className="block text-sm font-semibold">Reconciliation note<textarea className={researchInput + " mt-2"} rows={4} value={note} onChange={(event) => { invalidate(); setNote(event.target.value); }} /></label>
      <p className="text-sm text-black/60">Write at least 40 characters including the exact firm name, a selected city and the roster date. Explain why this is a separate firm.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={reviewed} onChange={(event) => { setReviewed(event.target.checked); setPrepared(null); onChange(null); }} /><span>I reviewed the source evidence for every selected field.</span></label>
      <button type="button" className={researchButton} disabled={!reviewed || !nameSource || !city || !roster || !note.trim()} onClick={prepare}>Prepare source-bound firm values</button>
    </fieldset>
    {prepared && <div className="space-y-3"><p role="status" className="text-sm font-semibold">New-firm values are ready for the exact package review.</p><ResearchJson value={prepared} /></div>}
  </section>;
}
