import { notFound } from "next/navigation";
import CandidateResearchProfile from "../../CandidateResearchProfile";
export const dynamic = "force-dynamic";
export default async function CandidatePage({ params, searchParams }: { params: Promise<{ candidateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { candidateId } = await params, query = await searchParams;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId)) notFound();
  const value = query.coverageRevision;
  if (value !== undefined && (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))) notFound();
  return <CandidateResearchProfile candidateId={candidateId} coverageRevision={value === undefined ? undefined : Number(value)} />;
}
