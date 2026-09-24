import { Suspense } from "react";
import { notFound } from "next/navigation";
import CandidateResearchList from "@/app/admin/prospects/CandidateResearchList";
import CandidateResearchProfile from "@/app/admin/prospects/CandidateResearchProfile";
export const dynamic = "force-dynamic";
export default async function CandidatePreview({ searchParams }: { searchParams: Promise<{ candidateId?: string }> }) {
  if (process.env.PROSPECT_QUALIFICATION_PREVIEW !== "1") notFound();
  const { candidateId } = await searchParams;
  if (candidateId && !/^81000000-0000-4000-8000-\d{12}$/.test(candidateId)) notFound();
  return <main className="min-h-screen bg-parchment p-3 sm:p-6"><Suspense fallback={<p>Loading synthetic research…</p>}>{candidateId ? <CandidateResearchProfile candidateId={candidateId} /> : <CandidateResearchList />}</Suspense></main>;
}
