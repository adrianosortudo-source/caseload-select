import Link from "next/link";
import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import ResearchInbox from "../ResearchInbox";
import ResearchRunList from "../ResearchRunList";

export const dynamic = "force-dynamic";

export default async function ProspectResearchPage() {
  if (!await getOperatorSession()) redirect("/operator/login?error=missing");

  return <main className="space-y-6">
    <header className="space-y-2">
      <Link href="/admin/prospects" className="text-sm text-navy underline">Back to prospect list</Link>
      <h1 className="text-2xl font-bold text-navy">Prospect research</h1>
      <p className="text-sm text-black/60">Review every staged finding and reconcile each run with its full source inventory and verified Admin visibility.</p>
    </header>
    <ResearchInbox />
    <ResearchRunList />
  </main>;
}
