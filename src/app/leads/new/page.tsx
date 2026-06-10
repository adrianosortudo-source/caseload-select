import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getOperatorSession } from "@/lib/portal-auth";
import NewLeadForm from "./Form";

export const dynamic = "force-dynamic";

export default async function NewLeadPage() {
  const session = await getOperatorSession();
  if (!session) redirect("/portal/login?error=missing");

  const { data: firms } = await supabase.from("law_firm_clients").select("id,name").order("name");
  return (
    <div>
      <PageHeader title="New Lead" subtitle="Creates the lead, scores it, and starts the 3-step sequence." />
      <div className="p-8 max-w-2xl">
        <NewLeadForm firms={firms ?? []} />
      </div>
    </div>
  );
}
