// Content Performance -- lead evidence timeline (Phase 3 point 3).
// Operator-only. Shows the full append-only evidence history for one
// screened lead: observed source and self-report shown separately,
// immutable/audited (every row carries who recorded it and when).
// Supports recording a new self-reported or operator-observed offline
// referral row, and syncing observed UTM/referrer evidence on demand.

import PageHeader from "@/components/PageHeader";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listEvidenceForLead } from "@/lib/content-attribution";
import { ATTRIBUTION_STATE_LABELS, EVIDENCE_METHOD_LABELS, SELF_REPORT_CATEGORY_LABELS } from "@/lib/content-attribution-pure";
import ContentAttributionEvidenceForm from "@/components/admin/ContentAttributionEvidenceForm";
import ContentAttributionSyncButton from "@/components/admin/ContentAttributionSyncButton";

export const dynamic = "force-dynamic";

type LeadRow = {
  id: string;
  firm_id: string;
  contact_name: string | null;
  matter_type: string | null;
  band: string | null;
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function LeadAttributionPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;

  const { data: leadData } = await supabase
    .from("screened_leads")
    .select("id, firm_id, contact_name, matter_type, band")
    .eq("id", leadId)
    .maybeSingle();
  const lead = leadData as LeadRow | null;

  if (!lead) {
    return (
      <div>
        <PageHeader title="Lead Attribution" subtitle="Lead not found." />
      </div>
    );
  }

  const evidence = await listEvidenceForLead(lead.firm_id, leadId);
  const supersededIds = new Set(evidence.map((e) => e.supersedes_evidence_id).filter((id): id is string => !!id));

  return (
    <div>
      <PageHeader
        title={lead.contact_name ?? "Unnamed lead"}
        subtitle={`${lead.matter_type ?? "Matter type unknown"} · Band ${lead.band ?? "—"}`}
      />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded border border-black/8 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Evidence Timeline</div>
                <div className="text-xs text-black/50 mt-1">Append-only. Oldest first.</div>
              </div>
              <ContentAttributionSyncButton leadId={leadId} />
            </div>
            <div className="divide-y divide-black/5">
              {evidence.length === 0 && (
                <div className="p-6 text-sm text-black/40">No attribution evidence recorded yet.</div>
              )}
              {evidence.map((e) => (
                <div key={e.id} className={`p-4 ${supersededIds.has(e.id) ? "opacity-50" : ""}`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-medium text-sm">{ATTRIBUTION_STATE_LABELS[e.attribution_state]}</div>
                    <div className="text-xs text-black/50">{formatTimestamp(e.created_at)}</div>
                  </div>
                  <div className="text-xs text-black/60 mt-1">
                    {EVIDENCE_METHOD_LABELS[e.evidence_method]}
                    {e.self_report_category && ` · ${SELF_REPORT_CATEGORY_LABELS[e.self_report_category]}`}
                    {supersededIds.has(e.id) && " · superseded by a later correction"}
                  </div>
                  {e.evidence_note && <div className="text-xs text-black/70 mt-2 italic">"{e.evidence_note}"</div>}
                  <div className="text-[11px] text-black/40 mt-2">
                    Recorded by {e.recorded_by_role}
                    {e.recorded_by_name ? ` (${e.recorded_by_name})` : ""} · observed {formatTimestamp(e.observed_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-sm font-medium mb-3">Record self-report or offline referral</div>
            <ContentAttributionEvidenceForm leadId={leadId} />
          </div>
        </div>
      </div>
    </div>
  );
}
