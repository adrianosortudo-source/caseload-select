"use client";

import { useState } from "react";
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";
import { ResearchJson } from "./ResearchEvidence";

export function ReconciledIntakeEvidence({ record }: { record: ReconciledGtaProspect }) {
  const intake = record.supplementalEvidence?.websiteIntake;
  return <div className="space-y-2">
    {record.qualifiedDossier && <div><span className="font-semibold">Dossier channels</span><ResearchJson value={record.qualifiedDossier.websiteAndIntake.observedChannels} /></div>}
    {intake && <div><span className="block font-semibold">Observed {intake.observedOn}</span><ResearchJson value={intake.channels} />
      {intake.readWarning && <div role="status" className="mt-2 rounded border border-amber-200 bg-amber-50 p-2"><span className="font-semibold">Intake evidence held for review</span><p>Unrecognized source data is retained in the research profile.</p></div>}
    </div>}
    {!record.qualifiedDossier && !intake && <span>Not assessed</span>}
  </div>;
}

/** Available for every returned source record, including records without a firm UUID. */
export default function ReconciledResearchProfile({ record }: { record: ReconciledGtaProspect }) {
  const [expanded, setExpanded] = useState(false);
  return <details onToggle={event => setExpanded(event.currentTarget.open)} className="mt-3 min-w-0" data-testid="retained-research-profile">
    <summary className="cursor-pointer text-xs font-semibold text-navy">Research profile</summary>
    {expanded && <div className="mt-3 space-y-3" data-ui-component-content="research-retained-profile">
      <p className="w-full text-pretty text-xs text-black/60" data-ui-copy="supporting">Retained research for this source record. Selection does not remove its evidence.</p>
      {record.supplementalEvidence?.websiteIntake?.readWarning && <p role="status" className="text-xs font-semibold text-amber-900">Intake evidence held for review. Original values remain below.</p>}
      <ResearchJson value={record} />
    </div>}
  </details>;
}
