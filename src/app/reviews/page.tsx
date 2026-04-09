import PageHeader from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const [revRes, leadRes, firmRes] = await Promise.all([
    supabase.from("review_requests").select("*").order("sent_at", { ascending: false }),
    supabase.from("leads").select("id,name"),
    supabase.from("law_firm_clients").select("id,name"),
  ]);
  const reviews = revRes.data ?? [];
  const leadMap = Object.fromEntries((leadRes.data ?? []).map((l) => [l.id, l.name]));
  const firmMap = Object.fromEntries((firmRes.data ?? []).map((f) => [f.id, f.name]));

  const total = reviews.length;
  const opened = reviews.filter((r) => r.status === "opened" || r.status === "completed").length;
  const completed = reviews.filter((r) => r.status === "completed").length;

  return (
    <div>
      <PageHeader title="Review Requests" subtitle="Auto-triggered on Client Won." />
      <div className="p-8 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="text-xs text-black/50 uppercase">Total sent</div>
            <div className="text-2xl font-semibold mt-2">{total}</div>
          </div>
          <div className="card p-5">
            <div className="text-xs text-black/50 uppercase">Open rate</div>
            <div className="text-2xl font-semibold mt-2">
              {total > 0 ? Math.round((opened / total) * 100) : 0}%
            </div>
          </div>
          <div className="card p-5">
            <div className="text-xs text-black/50 uppercase">Completed</div>
            <div className="text-2xl font-semibold mt-2">{completed}</div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-black/50 border-b border-black/10 bg-black/[0.02]">
              <tr>
                <th className="text-left px-4 py-3">Lead</th>
                <th className="text-left">Firm</th>
                <th className="text-left">Status</th>
                <th className="text-right px-4">Sent</th>
              </tr>
            </thead>
            <tbody>
              {reviews.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-black/40">
                    No review requests yet.
                  </td>
                </tr>
              )}
              {reviews.map((r) => (
                <tr key={r.id} className="border-b border-black/5">
                  <td className="px-4 py-3">{leadMap[r.lead_id] ?? "—"}</td>
                  <td className="text-black/60">{r.law_firm_id ? firmMap[r.law_firm_id] ?? "—" : "—"}</td>
                  <td>
                    <span className="badge bg-gold/10 text-gold capitalize">{r.status}</span>
                  </td>
                  <td className="text-right px-4 text-black/60">
                    {new Date(r.sent_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
