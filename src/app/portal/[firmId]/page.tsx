/**
 * /portal/[firmId]
 *
 * Read-only client portal dashboard. Shows:
 * - Band distribution (A-E) for the current month
 * - Total sessions and completion rate
 * - Recent intake sessions (last 10)
 * - Clio connection status and recent matters (if connected)
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { supabase } from "@/lib/supabase";
import { getClioMatters, isClioConnected } from "@/lib/clio";

const BAND_LABEL: Record<string, string> = {
  A: "Same-day consult",
  B: "Call within 1h",
  C: "Qualification needed",
  D: "Long-view nurture",
  E: "Auto-declined",
};

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
  proposal_sent: "Proposal Sent",
  client_won: "Retained",
  client_lost: "Lost",
};

export default async function PortalDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ clio?: string }>;
}) {
  const session = await getPortalSession();
  const { firmId } = await params;
  const { clio: clioStatus } = await searchParams;

  if (!session || session.firm_id !== firmId) {
    redirect("/portal/login");
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [sessionsAll, sessionsMonth, sessionsComplete, recentSessions, clioConnected] = await Promise.all([
    supabase.from("intake_sessions").select("id", { count: "exact", head: true }).eq("firm_id", firmId),
    supabase.from("intake_sessions").select("id", { count: "exact", head: true }).eq("firm_id", firmId).gte("created_at", monthStart.toISOString()),
    supabase.from("intake_sessions").select("band, otp_verified").eq("firm_id", firmId).eq("status", "complete"),
    supabase.from("intake_sessions").select("id, channel, status, practice_area, band, otp_verified, situation_summary, created_at").eq("firm_id", firmId).order("created_at", { ascending: false }).limit(10),
    isClioConnected(firmId),
  ]);

  const complete = sessionsComplete.data ?? [];
  const bandDist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  let verified = 0;
  for (const s of complete) {
    const b = s.band as keyof typeof bandDist;
    if (b in bandDist) bandDist[b]++;
    if (s.otp_verified) verified++;
  }

  const clioMatters = clioConnected ? await getClioMatters(firmId, 5) : [];
  const completedCount = complete.length;
  const verifiedRate = completedCount > 0 ? Math.round((verified / completedCount) * 100) : 0;

  return (
    <div className="space-y-8">
      {clioStatus === "connected" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800">
          Clio connected. Matter data will now appear in your portal.
        </div>
      )}
      {clioStatus === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
          Clio connection failed. Please try again or contact your operator.
        </div>
      )}

      {/* Nav */}
      <div className="flex gap-2">
        <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-navy text-white">Overview</span>
        <a
          href={`/portal/${firmId}/leads`}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-black/5 text-black/60 hover:bg-black/8 transition"
        >
          Pipeline
        </a>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Inquiries", value: sessionsAll.count ?? 0 },
          { label: "This Month", value: sessionsMonth.count ?? 0 },
          { label: "Screened", value: completedCount },
          { label: "ID Verified", value: `${verifiedRate}%` },
        ].map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-black/5 shadow-sm p-4">
            <div className="text-2xl font-bold text-navy">{m.value}</div>
            <div className="text-xs text-black/50 mt-1">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Band distribution */}
      <div className="bg-white rounded-xl border border-black/5 shadow-sm p-6">
        <h2 className="font-semibold text-navy mb-4 text-sm">Band Distribution (All Time)</h2>
        <div className="space-y-2">
          {(["A", "B", "C", "D", "E"] as const).map((band) => {
            const count = bandDist[band] ?? 0;
            const pct = completedCount > 0 ? Math.round((count / completedCount) * 100) : 0;
            return (
              <div key={band} className="flex items-center gap-3">
                <span className={`badge ${BAND_COLOR[band]} w-6 text-center font-bold`}>{band}</span>
                <div className="flex-1 bg-black/5 rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-navy transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-black/50 w-16 text-right">
                  {count} ({pct}%)
                </span>
                <span className="text-xs text-black/40 hidden sm:block w-40">{BAND_LABEL[band]}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent sessions */}
      <div className="bg-white rounded-xl border border-black/5 shadow-sm p-6">
        <h2 className="font-semibold text-navy mb-4 text-sm">Recent Inquiries</h2>
        {(recentSessions.data ?? []).length === 0 ? (
          <p className="text-sm text-black/40">No inquiries yet.</p>
        ) : (
          <div className="space-y-2">
            {(recentSessions.data ?? []).map((s) => (
              <div
                key={s.id}
                className="flex items-start gap-3 py-2 border-b border-black/5 last:border-0"
              >
                {s.band && (
                  <span className={`badge ${BAND_COLOR[s.band] ?? "bg-gray-100 text-gray-600"} shrink-0 font-bold`}>
                    {s.band}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-navy truncate">
                    {s.practice_area ?? "Practice area pending"}
                  </div>
                  {s.situation_summary && (
                    <div className="text-xs text-black/50 mt-0.5 line-clamp-1">{s.situation_summary}</div>
                  )}
                </div>
                <div className="text-xs text-black/40 shrink-0 text-right">
                  <div>{s.otp_verified ? "Verified" : "Unverified"}</div>
                  <div>{new Date(s.created_at as string).toLocaleDateString("en-CA")}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clio matters */}
      {clioConnected && clioMatters.length > 0 && (
        <div className="bg-white rounded-xl border border-black/5 shadow-sm p-6">
          <h2 className="font-semibold text-navy mb-4 text-sm">Recent Matters (Clio)</h2>
          <div className="space-y-2">
            {clioMatters.map((m) => (
              <div key={m.id} className="flex items-start gap-3 py-2 border-b border-black/5 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-navy truncate">{m.client?.name ?? "Unknown client"}</div>
                  <div className="text-xs text-black/50 mt-0.5">{m.practice_area?.name ?? "No practice area"} · {m.display_number}</div>
                </div>
                <span className={`badge shrink-0 ${m.status === "Open" ? "bg-emerald-100 text-emerald-700" : "bg-black/5 text-black/50"}`}>
                  {m.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clio connect CTA */}
      {!clioConnected && process.env.CLIO_CLIENT_ID && (
        <div className="bg-white rounded-xl border border-black/5 shadow-sm p-6 flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-navy text-sm">Connect Clio Manage</div>
            <p className="text-xs text-black/50 mt-1">
              View active matters alongside your intake data.
            </p>
          </div>
          <a
            href={`/api/clio/connect?firm_id=${firmId}`}
            className="btn-gold text-sm shrink-0"
          >
            Connect Clio
          </a>
        </div>
      )}
    </div>
  );
}
