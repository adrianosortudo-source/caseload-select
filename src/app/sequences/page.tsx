import PageHeader from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  const { data: seqs } = await supabase
    .from("email_sequences")
    .select("*")
    .order("scheduled_at", { ascending: true });
  const { data: leads } = await supabase.from("leads").select("id,name,email");
  const leadMap = Object.fromEntries((leads ?? []).map((l) => [l.id, l]));

  const grouped: Record<string, typeof seqs> = {};
  (seqs ?? []).forEach((s) => {
    grouped[s.lead_id] = grouped[s.lead_id] || [];
    grouped[s.lead_id]!.push(s);
  });

  return (
    <div>
      <PageHeader title="Email Sequences" subtitle="3-step nurture per lead." />
      <div className="p-8 space-y-4">
        {Object.keys(grouped).length === 0 && (
          <div className="card p-8 text-center text-black/40">
            No sequences yet. Create a lead to trigger one.
          </div>
        )}
        {Object.entries(grouped).map(([leadId, items]) => {
          const lead = leadMap[leadId];
          return (
            <div key={leadId} className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-medium">{lead?.name ?? "Unknown lead"}</div>
                  <div className="text-xs text-black/50">{lead?.email ?? "no email"}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {items!.map((s) => (
                  <div key={s.id} className="border border-black/10 rounded-lg p-3">
                    <div className="text-xs text-black/50">Step {s.step_number}</div>
                    <div className="text-sm font-medium capitalize mt-1">{s.status}</div>
                    <div className="text-[11px] text-black/50 mt-1">
                      {s.sent_at
                        ? `Sent ${new Date(s.sent_at).toLocaleString()}`
                        : s.scheduled_at
                        ? `Due ${new Date(s.scheduled_at).toLocaleString()}`
                        : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
