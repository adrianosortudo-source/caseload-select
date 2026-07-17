// Content Performance -- attributed enquiry list (Phase 3 point 1/3
// supporting surface). Operator-only. Lists screened_leads that carry at
// least one attribution evidence row for this firm, optionally narrowed
// to one deliverable. Each row links to the lead's evidence timeline.

import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listCurrentAttributionForFirm } from "@/lib/content-attribution";
import { ATTRIBUTION_STATE_LABELS } from "@/lib/content-attribution-pure";

export const dynamic = "force-dynamic";

type LeadRow = { id: string; contact_name: string | null; band: string | null; matter_type: string | null };

export default async function AttributedLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const firmId = typeof sp.firm_id === "string" ? sp.firm_id : null;
  const deliverableId = typeof sp.deliverable_id === "string" ? sp.deliverable_id : null;

  if (!firmId) {
    return (
      <div>
        <PageHeader title="Attributed Enquiries" subtitle="Missing firm_id." />
      </div>
    );
  }

  const current = await listCurrentAttributionForFirm(firmId);
  const filtered = deliverableId ? current.filter((r) => r.deliverable_id === deliverableId) : current;

  const leadIds = filtered.map((r) => r.screened_lead_id);
  const { data: leadRows } = leadIds.length
    ? await supabase.from("screened_leads").select("id, contact_name, band, matter_type").in("id", leadIds)
    : { data: [] as LeadRow[] };
  const leadById = new Map(((leadRows ?? []) as LeadRow[]).map((l) => [l.id, l]));

  return (
    <div>
      <PageHeader
        title="Attributed Enquiries"
        subtitle={deliverableId ? "Filtered to one deliverable" : "All attributed enquiries for this firm"}
      />
      <div className="mt-6 rounded border border-black/8 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-black/50 border-b border-black/10 bg-black/[0.02]">
              <tr>
                <th className="text-left px-4 py-3">Lead</th>
                <th className="text-left">Matter type</th>
                <th className="text-left">Band</th>
                <th className="text-left">Attribution state</th>
                <th className="text-left">Evidence method</th>
                <th className="text-left">Matter stage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-black/40">
                    No attributed enquiries yet.
                  </td>
                </tr>
              )}
              {filtered.map((row) => {
                const lead = leadById.get(row.screened_lead_id);
                return (
                  <tr key={row.screened_lead_id} className="border-b border-black/5">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/content-studio/attribution/leads/${row.screened_lead_id}`}
                        className="text-sky-600 hover:underline font-medium"
                      >
                        {lead?.contact_name ?? "Unnamed"}
                      </Link>
                    </td>
                    <td className="text-black/60">{lead?.matter_type ?? "—"}</td>
                    <td className="text-black/60">{lead?.band ?? "—"}</td>
                    <td className="text-black/60">{ATTRIBUTION_STATE_LABELS[row.attribution_state]}</td>
                    <td className="text-black/60">{row.evidence_method}</td>
                    <td className="text-black/60">{row.matter_stage ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
