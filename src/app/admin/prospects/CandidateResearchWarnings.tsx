"use client";
import { researchLabel } from "./ResearchEvidence";
export function CandidateWarnings({ warnings, complete }: { warnings: readonly string[]; complete: boolean }) {
  if (complete && !warnings.length) return null;
  return <div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"><p className="font-semibold">Research coverage needs review</p><p>Some source records or sections remain incomplete. Their holds remain visible.</p>{warnings.length > 0 && <ul className="mt-2 list-inside list-disc break-words">{warnings.map((item, index) => <li key={index}>{researchLabel(item)}</li>)}</ul>}</div>;
}
