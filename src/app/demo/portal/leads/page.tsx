/**
 * /demo/portal/leads  -  Public demo of the firm-facing leads list.
 *
 * No auth. Uses the Hartwell Law PC demo firm via getDemoFirmId().
 * Mirrors /portal/[firmId]/leads with the KB-23 additions:
 *   - Band X tab (Needs Review)
 *   - "Why this band" column showing the AI reasoning preview
 *   - Amber row tint + band_x_reason on Band X rows
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getDemoFirmId } from "@/lib/demo-firm";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const BAND_COLOR: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-blue-100 text-blue-800",
  C: "bg-yellow-100 text-yellow-800",
  D: "bg-orange-100 text-orange-800",
  E: "bg-red-100 text-red-800",
  X: "bg-amber-100 text-amber-900 border border-amber-300",
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
  needs_review: "Needs Review",
};

type LeadRow = {
  id: string;
  name: string;
  case_type: string | null;
  stage: string;
  band: string | null;
  priority_band: string | null;
  cpi_score: number | null;
  priority_index: number | null;
  estimated_value: number | null;
  created_at: string;
  intake_session_id: string | null;
};

/** Compact dollar formatter. $42,500 -> "$42.5k", $1,250,000 -> "$1.25M". */
function formatCaseValue(value: number | null): string {
  if (value == null || value <= 0) return "—";
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(2)}M`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `$${value}`;
}

export default async function DemoPortalLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ band?: string; stage?: string }>;
}) {
  const firmId = await getDemoFirmId();
  if (!firmId) redirect("/demo");

  const { band: bandFilter, stage: stageFilter } = await searchParams;

  let query = supabase
    .from("leads")
    .select("id, name, case_type, stage, band, priority_band, cpi_score, priority_index, estimated_value, created_at, intake_session_id")
    .eq("law_firm_id", firmId)
    .order("created_at", { ascending: false });
  if (bandFilter) query = query.eq("band", bandFilter);
  if (stageFilter) query = query.eq("stage", stageFilter);

  const { data } = await query;
  const leads = (data ?? []) as LeadRow[];

  // Pull memo + reasoning in one batched call for the rendered subset.
  const sessionIds = leads.map(l => l.intake_session_id).filter(Boolean) as string[];
  const memoReadySet = new Set<string>();
  const reasoningBySession = new Map<string, string>();
  const bandXReasonBySession = new Map<string, string>();
  if (sessionIds.length > 0) {
    const { data: rows } = await supabase
      .from("intake_sessions")
      .select("id, memo_generated_at, scoring")
      .in("id", sessionIds);
    for (const row of rows ?? []) {
      if (row.memo_generated_at) memoReadySet.add(row.id as string);
      const scoring = (row.scoring as Record<string, unknown> | null) ?? null;
      if (!scoring) continue;
      const r = scoring._reasoning;
      if (typeof r === "string" && r.trim().length > 0) {
        reasoningBySession.set(row.id as string, r.trim());
      }
      const bxr = scoring._band_x_reason;
      if (typeof bxr === "string" && bxr.trim().length > 0) {
        bandXReasonBySession.set(row.id as string, bxr.trim());
      }
    }
  }

  // Counts for filter tabs (always all leads, regardless of current filter).
  const { data: allLeads } = await supabase
    .from("leads")
    .select("band")
    .eq("law_firm_id", firmId);
  const bandCounts: Record<string, number> = { all: allLeads?.length ?? 0 };
  for (const l of allLeads ?? []) {
    if (l.band) bandCounts[l.band] = (bandCounts[l.band] ?? 0) + 1;
  }

  const bandTabs: Array<{ key: string; label: string; emphasis?: "warning" }> = [
    { key: "all", label: "All" },
    { key: "A",   label: "Band A" },
    { key: "B",   label: "Band B" },
    { key: "C",   label: "Band C" },
    { key: "D",   label: "Band D" },
    { key: "E",   label: "Band E" },
    ...(bandCounts.X ? [{ key: "X", label: "Needs Review", emphasis: "warning" as const }] : []),
  ];
  const activeTab = bandFilter ?? "all";

  function buildHref(b: string | null, s: string | null) {
    const params = new URLSearchParams();
    if (b && b !== "all") params.set("band", b);
    if (s) params.set("stage", s);
    const qs = params.toString();
    return `/demo/portal/leads${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-navy">Your Pipeline</h1>
          <p className="text-sm text-black/50 mt-1">
            {bandCounts.all} lead{bandCounts.all !== 1 ? "s" : ""} total · Read-only
          </p>
        </div>
      </div>

      {/* Band filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {bandTabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const isWarning = tab.emphasis === "warning";
          const className = isActive
            ? isWarning
              ? "bg-amber-600 text-white"
              : "bg-navy text-white"
            : isWarning
              ? "bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100"
              : "bg-black/5 text-black/60 hover:bg-black/8";
          return (
            <a
              key={tab.key}
              href={buildHref(tab.key, stageFilter ?? null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${className}`}
            >
              {tab.label}
              {bandCounts[tab.key] != null && (
                <span className={`ml-1.5 ${
                  isActive ? "text-white/60" : isWarning ? "text-amber-700/60" : "text-black/30"
                }`}>
                  {bandCounts[tab.key]}
                </span>
              )}
            </a>
          );
        })}
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
                <th className="text-right px-4 py-3 font-medium">Score</th>
                <th className="text-right px-4 py-3 font-medium">Case value</th>
                <th className="text-left px-4 py-3 font-medium">Why this band</th>
                <th className="text-left px-4 py-3 font-medium">Stage</th>
                <th className="text-left px-4 py-3 font-medium">Memo</th>
                <th className="text-left px-4 py-3 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {leads.map((lead) => {
                const band = lead.priority_band ?? lead.band;
                const hasMemo = lead.intake_session_id ? memoReadySet.has(lead.intake_session_id) : false;
                const reasoning = lead.intake_session_id ? reasoningBySession.get(lead.intake_session_id) : null;
                const bandXReason = lead.intake_session_id ? bandXReasonBySession.get(lead.intake_session_id) : null;
                const isBandX = band === "X";
                const detailHref = `/demo/portal/leads/${lead.id}`;
                const reasoningPreview = reasoning
                  ? reasoning.length > 110 ? reasoning.slice(0, 107).trimEnd() + "..." : reasoning
                  : null;
                return (
                  <tr key={lead.id} className={`hover:bg-black/[0.01] ${isBandX ? "bg-amber-50/40" : ""}`}>
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
                          {band === "X" ? "Review" : band}
                        </span>
                      ) : (
                        <span className="text-black/20"> - </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums">
                      {(() => {
                        const score = lead.priority_index ?? lead.cpi_score;
                        if (score == null || isBandX) return <span className="text-black/20"> - </span>;
                        return <span className="font-semibold text-black/80">{score}</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums">
                      {isBandX ? (
                        <span className="text-black/20"> - </span>
                      ) : (
                        <span className="text-black/70">{formatCaseValue(lead.estimated_value)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-black/60 max-w-[320px]">
                      {isBandX && bandXReason ? (
                        <span className="italic text-amber-800/80">
                          {bandXReason.replace(/_/g, " ")}
                        </span>
                      ) : reasoningPreview ? (
                        <span className="leading-snug">{reasoningPreview}</span>
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
