import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function RoutingRedirect() {
  const { data } = await supabaseAdmin
    .from("intake_firms")
    .select("id")
    .order("name")
    .limit(1)
    .maybeSingle();
  redirect(`/admin/firms/${data?.id ?? "eec1d25e-a047-4827-8e4a-6eb96becca2b"}/routing`);
}
