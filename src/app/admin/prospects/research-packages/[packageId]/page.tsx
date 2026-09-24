import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import ResearchPackageReview from "../../ResearchPackageReview";

export const dynamic = "force-dynamic";
export default async function ResearchPackagePage({ params }: { params: Promise<{ packageId: string }> }) {
  if (!await getOperatorSession()) redirect("/operator/login?error=missing");
  const { packageId } = await params;
  return <ResearchPackageReview packageId={packageId} />;
}
