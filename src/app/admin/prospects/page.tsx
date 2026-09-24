/**
 * /admin/prospects
 *
 * Operator console home for the GTA prospect list. Auth is enforced by the
 * parent /admin layout; imports and AI staging each retain their own server
 * authorization boundary.
 */
import Link from "next/link";
import { Suspense } from "react";
import CandidateResearchList from "./CandidateResearchList";
import AiDraftInbox from "./AiDraftInbox";
import GtaProspectImport from "./GtaProspectImport";
import ProspectArchiveUpdate from "./ProspectArchiveUpdate";
import ProspectingControlPlaneRegistry from "./ProspectingControlPlaneRegistry";
import ReconciledProspects from "./ReconciledProspects";
import SupplementalEvidenceImport from "./SupplementalEvidenceImport";

export const dynamic = "force-dynamic";

export default function ProspectsPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Prospect list</h1>
        <p className="text-sm text-black/50 mt-1">Search shared registry firms, reviewed research rows, and retained legacy provenance in one place.</p>
        <Link href="/admin/prospects/brazilian" className="mt-3 inline-flex rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90">Open Brazilian lawyer research overlay</Link>
        <Link href="/admin/prospects/research" className="mt-3 ml-2 inline-flex rounded-md border border-navy px-3 py-2 text-sm font-semibold text-navy hover:bg-parchment">Open research updates and run reconciliation</Link>
      </div>

      <AiDraftInbox />

      <GtaProspectImport />

      <SupplementalEvidenceImport />

      <ProspectArchiveUpdate />

      <ProspectingControlPlaneRegistry />

      <Suspense fallback={<p>Loading candidate research…</p>}><CandidateResearchList /></Suspense>

      <ReconciledProspects />

      <div className="rounded-lg border border-border-brand bg-white px-4 py-3 text-sm text-black/60">
        The original LSO-derived artifact remains read-only for historical reference. <Link href="/admin/prospects/view" target="_blank" className="font-semibold text-navy underline underline-offset-2">Open archived legacy directory</Link>
      </div>
    </div>
  );
}
