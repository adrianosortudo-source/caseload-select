import { Suspense } from "react";
import CandidateResearchList from "../CandidateResearchList";
export const dynamic = "force-dynamic";
export default function CandidatesPage() {
  return <Suspense fallback={<p>Loading candidate research…</p>}><CandidateResearchList /></Suspense>;
}
