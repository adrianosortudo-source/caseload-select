import PageHeader from "@/components/PageHeader";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import Board from "./Board";
import type { Lead, LawFirm } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [leadsRes, firmsRes] = await Promise.all([
    supabase.from("leads").select("*").order("updated_at", { ascending: false }),
    supabase.from("law_firm_clients").select("*"),
  ]);
  const leads = (leadsRes.data ?? []) as Lead[];
  const firms = (firmsRes.data ?? []) as LawFirm[];

  return (
    <div>
      <PageHeader title="Lead Pipeline" subtitle="Drag cards between stages. Changes persist to Supabase." />
      <div className="p-6">
        {leadsRes.error && (
          <div className="card p-4 border-red-300 bg-red-50 text-sm text-red-700 mb-4">
            {leadsRes.error.message}
          </div>
        )}
        <Board leads={leads} firms={firms} />
      </div>
    </div>
  );
}
