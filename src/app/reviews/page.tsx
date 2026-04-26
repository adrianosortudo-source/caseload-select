import PageHeader from "@/components/PageHeader";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import ReviewsClient from "./ReviewsClient";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  // Load review requests with lead + firm names
  const [revRes, leadRes, firmRes, seqRes, tmplRes] = await Promise.all([
    supabase
      .from("review_requests")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("leads").select("id,name,email"),
    supabase.from("law_firm_clients").select("id,name"),
    // Count sent touches per lead for J9 sequences
    supabase
      .from("email_sequences")
      .select("lead_id, status")
      .in("status", ["sent", "scheduled", "skipped"]),
    supabase
      .from("sequence_templates")
      .select("id")
      .eq("trigger_event", "review_request")
      .maybeSingle(),
  ]);

  const reviews = revRes.data ?? [];
  const leadMap = Object.fromEntries(
    (leadRes.data ?? []).map((l) => [l.id, { name: l.name, email: l.email }])
  );
  const firmMap = Object.fromEntries(
    (firmRes.data ?? []).map((f) => [f.id, f.name])
  );

  // Count sent J9 touches per lead (via sequence steps belonging to the review_request template)
  // For simplicity, count all sent email_sequences rows per lead  - 
  // a lead in this table will have at most J9 rows at this stage.
  const touchesByLead: Record<string, { sent: number; total: number }> = {};
  if (tmplRes.data) {
    const templateId = tmplRes.data.id;

    // Get step IDs for J9 template
    const { data: steps } = await supabase
      .from("sequence_steps")
      .select("id")
      .eq("sequence_id", templateId);

    const j9StepIds = new Set((steps ?? []).map((s: { id: string }) => s.id));

    for (const seq of seqRes.data ?? []) {
      // We'd need sequence_step_id here  -  re-query with it
      void seq; // placeholder; we re-query below
    }

    // Re-query with sequence_step_id for accurate join
    const { data: j9Seqs } = await supabase
      .from("email_sequences")
      .select("lead_id, status, sequence_step_id")
      .in("sequence_step_id", [...j9StepIds]);

    for (const row of j9Seqs ?? []) {
      if (!touchesByLead[row.lead_id]) {
        touchesByLead[row.lead_id] = { sent: 0, total: j9StepIds.size };
      }
      if (row.status === "sent") touchesByLead[row.lead_id].sent++;
    }
  }

  const total = reviews.length;
  const completed = reviews.filter((r) => r.status === "completed").length;
  const pending = reviews.filter((r) => r.status === "pending").length;
  const conversionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const enriched = reviews.map((r) => ({
    ...r,
    lead_name: leadMap[r.lead_id]?.name ?? " - ",
    lead_email: leadMap[r.lead_id]?.email ?? null,
    firm_name: r.law_firm_id ? (firmMap[r.law_firm_id] ?? " - ") : " - ",
    touches: touchesByLead[r.lead_id] ?? { sent: 0, total: 3 },
  }));

  return (
    <div>
      <PageHeader
        title="Review Requests"
        subtitle="3-touch sequence triggered on Client Won. Mark as completed when the review goes live."
      />
      <div className="p-8 space-y-4">
        <div className="grid grid-cols-4 gap-4">
          <div className="card p-5">
            <div className="text-xs text-black/50 uppercase tracking-wide">Total</div>
            <div className="text-2xl font-semibold mt-2">{total}</div>
          </div>
          <div className="card p-5">
            <div className="text-xs text-black/50 uppercase tracking-wide">Pending</div>
            <div className="text-2xl font-semibold mt-2">{pending}</div>
          </div>
          <div className="card p-5">
            <div className="text-xs text-black/50 uppercase tracking-wide">Completed</div>
            <div className="text-2xl font-semibold mt-2">{completed}</div>
          </div>
          <div className="card p-5">
            <div className="text-xs text-black/50 uppercase tracking-wide">Conversion</div>
            <div className="text-2xl font-semibold mt-2">{conversionRate}%</div>
          </div>
        </div>

        <ReviewsClient reviews={enriched} />
      </div>
    </div>
  );
}
