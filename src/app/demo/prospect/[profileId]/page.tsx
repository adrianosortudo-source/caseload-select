import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import { ProspectDemoStandaloneClient } from "./ProspectDemoStandaloneClient";

export const metadata = {
  title: "Prospect intake demonstration | CaseLoad Select",
  robots: { index: false, follow: false },
};

export default async function ProspectDemoStandalonePage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  if (!await getOperatorSession()) {
    redirect("/operator/login?error=missing");
  }

  const { profileId } = await params;
  return <ProspectDemoStandaloneClient profileId={profileId} />;
}
