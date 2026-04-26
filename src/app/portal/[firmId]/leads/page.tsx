/**
 * /portal/[firmId]/leads
 *
 * Firm-facing leads pipeline view. Read-only. Shows all leads for
 * the firm with band, stage, case type, and date  -  no PII beyond
 * what the firm needs to see.
 *
 * Auth is handled by the parent [firmId]/layout.tsx.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const BAND_COLOR: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-blue-100 text-blue-800",
  C: "bg-yellow-100 text-yellow-800",
  D: "bg-orange-100 text-orange-800",
  E: "bg-red-100 text-red-800",
};

const STAGE_LABEL: Record<string, string> = {
  new_lead: "New Lead",
  contacted: "Contacted",
  qualified: "Qualified",
  consultation_scheduled: "Consult Booked",
  consultation_held: "Consult Held",
  no_show: "No Show",
  proposal_sent: "Proposal Sent",
  client_won: "Retained",
  client_lost: "Lost",
};

type LeadRow = {
  id: string;
  name: string;
  case_type: string | null;
  stage: string;
  band: string | null;
  priority_band: string | null;
  urgency: string | null;
  created_at: string;
  intake_session_id: string | null;
};

export default async function PortalLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ band?: string; stage?: string }>;
}) {
  const session = await getPortalSession();
  const { firmId } = await params;
  const { band: bandFilter, stage: stageFilter } = await searchParams;

  if (!session || session.firm_id !== firmId) {
    redirect("/portal/login");
  }

  let query = supabase
    .from("leads")
    .select("id, name, case_type, stage, band, priority_band, urgency, created_at, intake_session_id")
    .eq("law_firm_id", firmId)
    .order("created_at", { ascending: false });

  if (bandFilter) query = query.eq("band", bandFilter);
  if (stageFilter) query = query.eq("stage", stageFilter);

  const { data } = await query;
  const leads = (data ?? []) as LeadRow[];

  // Memo ready map: session_id → true (memo exists)
  const sessionIds = leads.map(l => l.intake_session_id).filter(Boolean) as string[];
  let memoReadySet = new Set<string>();
  if (sessionIds.length > 0) {
    const { data: memoRows } = await supabase
      .from("intake_sessions")
      .select("id")
      .in("id", sessionIds)
      .not("memo_generated_at", "is", null);
    memoReadySet = new Set((memoRows ?? []).map(r => r.id));
  }

  // Counts for filter tabs
  const { data: allLeads } = await supabase
    .from("leads")
    .select("band, stage")
    .eq("law_firm_id", firmId);

  const bandCounts: Record<string, number> = { all: allLeads?.length ?? 0 };
  for (const l of allLeads ?? []) {
    if (l.band) bandCounts[l.band] = (bandCounts[l.band] ?? 0) + 1;
  }

  const bandTabs = [
    { key: "all",  label: "All" },
    { key: "A",    label: "Band A" },
    { key: "B",    label: "Band B" },
    { key: "C",    label: "Band C" },
    { key: "D",    label: "Band D" },
    { key: "E",    label: "Band E" },
  ];

  const activeTab = bandFilter ?? "all";

  function buildHref(b: string | null, s: string | null) {
    const params = new URLSearchParams();
    if (b && b !== "all") params.set("band", b);
    if (s) params.set("stage", s);
    const qs = params.toString();
    return `/portal/${firmId}/leads${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-navy">Your Pipeline</h1>
          <p className="text-sm text-black/50 mt-1">{bandCounts.all} lead{bandCounts.all !== 1 ? "s" : ""} total</p>
        </div>
        <Link
          href={`/portal/${firmId}`}
          className="text-xs text-black/40 hover:text-black/70 transition"
        >
          ← Dashboard
        </Link>
      </div>

      {/* Band filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {bandTabs.map((tab) => (
          <a
            key={tab.key}
            href={buildHref(tab.key, stageFilter ?? null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === tab.key
                ? "bg-navy text-white"
                : "bg-black/5 text-black/60 hover:bg-black/8"
            }`}
          >
            {tab.label}
            {bandCounts[tab.key] != null && (
              <span className={`ml-1.5 ${activeTab === tab.key ? "text-white/60" : "text-black/30"}`}>
                {bandCounts[tab.key]}
              </span>
            )}
          </a>
        ))}
      </div>

      {/* Table */}
      {leads.length === 0 ? (
        <div className="bg-white rounded-xl border border-black/5 p-10 text-center text-black/40 text-sm">
          No leads match the selected filter.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-black/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/8 bg-black/[0.02] text-xs text-black/50">
                <th className="text-left px-4 py-3 font-medium">Client</th>
                <th className="text-left px-4 py-3 font-medium">Case type</th>
                <th className="text-left px-4 py-3 font-medium">Band</th>
                <th className="text-left px-4 py-3 font-medium">Stage</th>
                <th className="text-left px-4 py-3 font-medium">Memo</th>
                <th className="text-left px-4 py-3 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {leads.map((lead) => {
                const band = lead.priority_band ?? lead.band;
                const hasMemo = lead.intake_session_id ? memoReadySet.has(lead.intake_session_id) : false;
                const detailHref = `/portal/${firmId}/leads/${lead.id}`;
                return (
                  <tr key={lead.id} className="hover:bg-black/[0.01]">
                    <td className="px-4 py-3 font-medium text-black/80">
                      <Link href={detailHref} className="hover:text-navy hover:underline">
                        {lead.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-black/60 capitalize">
                      {lead.case_type ?? <span className="text-black/20"> - </span>}
                    </td>
                    <td className="px-4 py-3">
                      {band ? (
                        <span className={`badge font-bold ${BAND_COLOR[band] ?? "bg-black/5 text-black/40"}`}>
                          {band}
                        </span>
                      ) : (
                        <span className="text-black/20"> - </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-black/60">
                      {STAGE_LABEL[lead.stage] ?? lead.stage}
                    </td>
                    <td className="px-4 py-3">
                      {hasMemo ? (
                        <Link
                          href={detailHref}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 hover:bg-emerald-100"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                          Memo ready
                        </Link>
                      ) : (
                        <span className="text-black/20 text-xs"> - </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-black/50">
                      {new Date(lead.created_at).toLocaleDateString("en-CA")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
