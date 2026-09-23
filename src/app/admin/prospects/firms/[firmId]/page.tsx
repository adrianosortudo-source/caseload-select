import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import ProspectResearchDetail from "../../ProspectResearchDetail";

export const dynamic = "force-dynamic";
export default async function ProspectResearchPage({ params }: { params: Promise<{ firmId: string }> }) {
  if (!await getOperatorSession()) redirect("/operator/login?error=missing");
  const { firmId } = await params;
  return <ProspectResearchDetail firmId={firmId} />;
}
