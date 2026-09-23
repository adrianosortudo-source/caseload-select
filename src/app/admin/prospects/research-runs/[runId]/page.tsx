import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import ResearchRunList from "../../ResearchRunList";

export const dynamic = "force-dynamic";
export default async function ResearchRunPage({ params }: { params: Promise<{ runId: string }> }) {
  if (!await getOperatorSession()) redirect("/operator/login?error=missing");
  const { runId } = await params;
  return <ResearchRunList runId={runId} />;
}
