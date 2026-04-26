/**
 * /analytics
 *
 * Filter Performance dashboard  -  operator view.
 * Covers the CaseLoad Screen intake funnel: sessions, bands, verification,
 * channel mix, and decline reasons. Matches the 7-page Monthly Filter
 * Performance Report format delivered to clients.
 *
 * Data: live from intake_sessions. No RPC required  -  all client-side queries.
 */

import PageHeader from "@/components/PageHeader";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const BAND_LABEL: Record<string, string> = {
  A: "Band A: Same-day consult",
  B: "Band B: Call within 1h",
  C: "Band C: Qualification needed",
  D: "Band D: Long-view nurture",
  E: "Band E: Auto-declined",
};

const BAND_COLOR: Record<string, string> = {
  A: "bg-emerald-500",
  B: "bg-lime-500",
  C: "bg-amber-500",
  D: "bg-orange-500",
  E: "bg-rose-500",
};

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs text-black/50 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
      {sub && <div className="text-xs text-black/50 mt-1">{sub}</div>}
    </div>
  );
}

function Bar({ label, count, max, colorClass }: { label: string; count: number; max: number; colorClass: string }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-48 text-xs text-black/60 truncate">{label}</div>
      <div className="flex-1 h-3 bg-black/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-12 text-right text-xs text-black/60">{count} ({pct}%)</div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

  const [
    allSessions,
    monthSessions,
    prevMonthSessions,
    completeSessions,
    firms,
  ] = await Promise.all([
    supabase.from("intake_sessions").select("id, band, channel, status, otp_verified, practice_area, created_at"),
    supabase.from("intake_sessions").select("id, band, channel, status, otp_verified, practice_area").gte("created_at", monthStart),
    supabase.from("intake_sessions").select("id, band").gte("created_at", prevMonthStart).lt("created_at", monthStart),
    supabase.from("intake_sessions").select("band, channel, otp_verified, practice_area").eq("status", "complete"),
    supabase.from("intake_firms").select("id, name"),
  ]);

  const all = allSessions.data ?? [];
  const thisMonth = monthSessions.data ?? [];
  const lastMonth = prevMonthSessions.data ?? [];
  const complete = completeSessions.data ?? [];

  // Band distribution (all time, complete sessions)
  const bandDist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const prevBandDist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const s of complete) {
    const b = s.band as string;
    if (b in bandDist) bandDist[b]++;
  }
  for (const s of lastMonth) {
    const b = s.band as string;
    if (b && b in prevBandDist) prevBandDist[b]++;
  }

  // Channel mix
  const channelDist: Record<string, number> = {};
  for (const s of all) {
    const ch = (s.channel as string) ?? "unknown";
    channelDist[ch] = (channelDist[ch] ?? 0) + 1;
  }

  // Practice area mix (complete only)
  const paDist: Record<string, number> = {};
  for (const s of complete) {
    const pa = (s.practice_area as string) ?? "Unknown";
    paDist[pa] = (paDist[pa] ?? 0) + 1;
  }
  const topPracticeAreas = Object.entries(paDist).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // KPIs
  const totalAll = all.length;
  const totalThisMonth = thisMonth.length;
  const totalLastMonth = lastMonth.length;
  const completedCount = complete.length;
  const verifiedCount = complete.filter((s) => s.otp_verified).length;
  const filteredCount = bandDist.E ?? 0;
  const qualifiedCount = (bandDist.A ?? 0) + (bandDist.B ?? 0);
  const completionRate = totalAll > 0 ? Math.round((completedCount / totalAll) * 100) : 0;
  const verifiedRate = completedCount > 0 ? Math.round((verifiedCount / completedCount) * 100) : 0;
  const filterRate = completedCount > 0 ? Math.round((filteredCount / completedCount) * 100) : 0;
  const mom = totalLastMonth > 0 ? Math.round(((totalThisMonth - totalLastMonth) / totalLastMonth) * 100) : null;
  const maxBand = Math.max(1, ...Object.values(bandDist));
  const maxChannel = Math.max(1, ...Object.values(channelDist));
  const maxPa = Math.max(1, ...topPracticeAreas.map(([, c]) => c));

  return (
    <div>
      <PageHeader
        title="Filter Performance"
        subtitle={`CaseLoad Screen analytics · ${now.toLocaleString("en-CA", { month: "long", year: "numeric" })}`}
      />
      <div className="p-8 space-y-6">

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Inquiries"
            value={totalAll}
            sub="All time"
          />
          <StatCard
            label="This Month"
            value={totalThisMonth}
            sub={mom !== null ? `${mom >= 0 ? "+" : ""}${mom}% vs last month` : "First month"}
          />
          <StatCard
            label="Screened"
            value={completedCount}
            sub={`${completionRate}% completion rate`}
          />
          <StatCard
            label="ID Verified"
            value={`${verifiedRate}%`}
            sub={`${verifiedCount} of ${completedCount} screened`}
          />
          <StatCard
            label="Qualified (A+B)"
            value={qualifiedCount}
            sub={completedCount > 0 ? `${Math.round((qualifiedCount / completedCount) * 100)}% of screened` : " - "}
          />
          <StatCard
            label="Filtered (Band E)"
            value={filteredCount}
            sub={`${filterRate}% auto-declined`}
          />
          <StatCard
            label="Active Firms"
            value={firms.data?.length ?? 0}
            sub="Configured in CaseLoad Screen"
          />
          <StatCard
            label="Channels"
            value={Object.keys(channelDist).length}
            sub={Object.keys(channelDist).join(" · ") || "None yet"}
          />
        </div>

        {/* Band distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="text-sm font-medium mb-1">Band Distribution: All Time</div>
            <div className="text-xs text-black/40 mb-4">Complete screened sessions only</div>
            <div className="space-y-2.5">
              {(["A", "B", "C", "D", "E"] as const).map((band) => (
                <Bar
                  key={band}
                  label={BAND_LABEL[band]}
                  count={bandDist[band] ?? 0}
                  max={maxBand}
                  colorClass={BAND_COLOR[band]}
                />
              ))}
            </div>
          </div>

          <div className="card p-5">
            <div className="text-sm font-medium mb-1">Band Distribution: Last Month</div>
            <div className="text-xs text-black/40 mb-4">For month-over-month comparison</div>
            <div className="space-y-2.5">
              {(["A", "B", "C", "D", "E"] as const).map((band) => (
                <Bar
                  key={band}
                  label={BAND_LABEL[band]}
                  count={prevBandDist[band] ?? 0}
                  max={Math.max(1, ...Object.values(prevBandDist))}
                  colorClass={BAND_COLOR[band]}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Channel mix + practice area */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="text-sm font-medium mb-4">Channel Mix</div>
            {Object.keys(channelDist).length === 0 ? (
              <p className="text-sm text-black/40">No sessions yet.</p>
            ) : (
              <div className="space-y-2.5">
                {Object.entries(channelDist)
                  .sort((a, b) => b[1] - a[1])
                  .map(([ch, count]) => (
                    <Bar key={ch} label={ch} count={count} max={maxChannel} colorClass="bg-navy" />
                  ))}
              </div>
            )}
          </div>

          <div className="card p-5">
            <div className="text-sm font-medium mb-1">Top Practice Areas</div>
            <div className="text-xs text-black/40 mb-4">Screened sessions only</div>
            {topPracticeAreas.length === 0 ? (
              <p className="text-sm text-black/40">No screened sessions yet.</p>
            ) : (
              <div className="space-y-2.5">
                {topPracticeAreas.map(([pa, count]) => (
                  <Bar key={pa} label={pa} count={count} max={maxPa} colorClass="bg-gold" />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Filter Activity */}
        <div className="card p-5">
          <div className="text-sm font-medium mb-1">Filter Activity Summary</div>
          <div className="text-xs text-black/40 mb-4">
            All-time · {totalAll} total inquiries · {completedCount} screened · {filteredCount} filtered (Band E)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {(["A", "B", "C", "D", "E"] as const).map((band) => {
              const count = bandDist[band] ?? 0;
              const pct = completedCount > 0 ? Math.round((count / completedCount) * 100) : 0;
              return (
                <div key={band} className="text-center p-3 rounded-lg bg-black/3 border border-black/5">
                  <div className={`text-2xl font-bold ${band === "A" ? "text-emerald-600" : band === "B" ? "text-lime-600" : band === "C" ? "text-amber-600" : band === "D" ? "text-orange-600" : "text-rose-600"}`}>
                    {count}
                  </div>
                  <div className="text-xs font-semibold mt-1">Band {band}</div>
                  <div className="text-xs text-black/40">{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
