import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import { validatedProspectListReturnPath } from "@/lib/gta-prospect-return-path";
import ProspectResearchDetail from "../../ProspectResearchDetail";

export const dynamic = "force-dynamic";
export default async function ProspectResearchPage({ params, searchParams }: { params: Promise<{ firmId: string }>; searchParams: Promise<{ returnTo?: string | string[] }> }) {
  if (!await getOperatorSession()) redirect("/operator/login?error=missing");
  const { firmId } = await params;
  const { returnTo } = await searchParams;
  return <ProspectResearchDetail firmId={firmId} returnTo={validatedProspectListReturnPath(returnTo)} />;
}
