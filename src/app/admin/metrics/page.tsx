import { redirect } from "next/navigation";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const FALLBACK_FIRM = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
export const dynamic = "force-dynamic";

export default async function AdminMetricsRedirectPage() {
  const { data } = await supabase
    .from("intake_firms")
    .select("id")
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();
  const firmId = (data?.id as string | null) ?? FALLBACK_FIRM;
  redirect(`/admin/firms/${firmId}/metrics`);
}
