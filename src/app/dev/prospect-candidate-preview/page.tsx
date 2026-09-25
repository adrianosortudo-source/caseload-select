import { Suspense } from "react";
import { notFound } from "next/navigation";
import CandidateResearchList from "@/app/admin/prospects/CandidateResearchList";
import ProspectResearchDetail from "@/app/admin/prospects/ProspectResearchDetail";
import CandidateResearchProfile from "@/app/admin/prospects/CandidateResearchProfile";
export const dynamic = "force-dynamic";
export default async function CandidatePreview({ searchParams }: { searchParams: Promise<{ candidateId?: string; firmId?: string }> }) {
  if (process.env.PROSPECT_QUALIFICATION_PREVIEW !== "1") notFound();
  const { candidateId, firmId } = await searchParams;
  if (candidateId && !/^81000000-0000-4000-8000-\d{12}$/.test(candidateId)) notFound();
  if (firmId && firmId !== "84000000-0000-4000-8000-000000000001") notFound();
  return <main className="min-h-screen bg-parchment p-3 sm:p-6"><Suspense fallback={<p>Loading synthetic research…</p>}>{firmId ? <ProspectResearchDetail firmId={firmId} initialData={{ firm: { id: firmId, displayName: "Synthetic verified firm", websiteUrl: null, sourceRecordKey: "synthetic-firm", revision: "synthetic-v1" }, sections: [], complete: true, revisionStable: true, profileChoices: [], readAt: "2026-09-24T17:00:00Z", rendererVersion: "prospect-enrichment/v1" }} /> : candidateId ? <CandidateResearchProfile candidateId={candidateId} /> : <CandidateResearchList />}</Suspense></main>;
}
