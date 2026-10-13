import { listAgencyFollowupConsole } from "@/lib/agency-followup-service";
import AgencyFollowupClient from "./AgencyFollowupClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AgencyFollowupPage() {
  const data = await listAgencyFollowupConsole();
  return <AgencyFollowupClient initialData={data} />;
}
