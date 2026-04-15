import PageHeader from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";
import { STAGES, BANDS } from "@/lib/types";
import { BAND_COLORS } from "@/lib/cpi";

export const dynamic = "force-dynamic";

// ── Types returned by the RPC ──────────────────────────────────────────────
interface DashboardStats {
  total_leads: number;
  qualified_leads: number;
  client_won: number;
  client_lost: number;
  overdue_leads: number;
  active_firms: number;
  avg_cpi: number;
  avg_value: number;
  revenue_forecast: number;
  review_open_rate: number;
  by_stage: { stage: string; count: number }[];
  by_band: { band: string; count: number }[];
  by_case_type: { case_type: string; count: number }[];
  firms: {
    id: string;
    name: string;
    location: string | null;
    status: string;
    lead_count: number;
    won_count: number;
    pipeline_value: number;
  }[];
}

async function getStats(): Promise<{ stats: DashboardStats | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_dashboard_stats");
  if (error) return { stats: null, error: error.message };
  return { stats: data as DashboardStats, error: null };
}

// ── KPI card ──────────────────────────────────────────────────────────────
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs text-black/50 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
      {sub && <div className="text-xs text-black/50 mt-1">{sub}</div>}
    </div>
  );
}

// ── Bar row helper ─────────────────────────────────────────────────────────
function Bar({ label, count, max, colorClass }: { label: string; count: number; max: number; colorClass: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xs text-black/60 capitalize">{label}</div>
      <div className="flex-1 h-3 bg-black/5 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass}`} style={{ width: `${(count / max) * 100}%` }} />
      </div>
      <div className="w-8 text-right text-xs">{count}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default async function Dashboard() {
  const { stats, error } = await getStats();

  if (!stats) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Live KPIs from Supabase" />
        <div className="p-8">
          <div className="card p-4 border-red-300 bg-red-50 text-sm text-red-700">
            {error ?? "Failed to load dashboard stats."}
            {error?.includes("get_dashboard_stats") && (
              <span> — Run <code>supabase/migrations/005_dashboard_rpc.sql</code> in Supabase SQL Editor.</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Derived values ──────────────────────────────────────────────────────
  const closed = stats.client_won + stats.client_lost;
  const wonRate = closed > 0 ? Math.round((stats.client_won / closed) * 100) : 0;
  const wonRateVsTotal = stats.total_leads > 0
    ? Math.round((stats.client_won / stats.total_leads) * 100)
    : 0;

  // Stage bars — preserve canonical order from STAGES constant
  const stageMap = Object.fromEntries(stats.by_stage.map((s) => [s.stage, s.count]));
  const byStage = STAGES.map((s) => ({ label: s.label, count: stageMap[s.key] ?? 0 }));
  const maxStage = Math.max(1, ...byStage.map((b) => b.count));

  // Band bars — canonical A→E order
  const bandMap = Object.fromEntries(stats.by_band.map((b) => [b.band, b.count]));
  const byBand = BANDS.map((b) => ({ band: b, count: bandMap[b] ?? 0 }));
  const maxBand = Math.max(1, ...byBand.map((b) => b.count));
  const BAND_FILL: Record<string, string> = {
    A: "bg-emerald-500",
    B: "bg-lime-500",
    C: "bg-amber-500",
    D: "bg-orange-500",
    E: "bg-rose-500",
  };

  // Case type bars
  const maxType = Math.max(1, ...(stats.by_case_type ?? []).map((t) => t.count));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Live KPIs from Supabase" />
      <div className="p-8 space-y-6">

        {/* ── KPI grid ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Total Leads" value={String(stats.total_leads)} />
          <Kpi
            label="Qualified Leads"
            value={String(stats.qualified_leads)}
            sub={`${stats.total_leads > 0 ? Math.round((stats.qualified_leads / stats.total_leads) * 100) : 0}% of total`}
          />
          <Kpi
            label="Client Won Rate"
            value={`${wonRateVsTotal}%`}
            sub={`${wonRate}% of closed · ${stats.client_won} won`}
          />
          <Kpi
            label="Overdue Follow-ups"
            value={String(stats.overdue_leads)}
            sub=">72h no movement"
          />
          <Kpi label="Review Open Rate" value={`${stats.review_open_rate}%`} />
          <Kpi label="Active Firm Clients" value={String(stats.active_firms)} />
          <Kpi
            label="Revenue Forecast"
            value={`$${Math.round(stats.revenue_forecast).toLocaleString()}`}
            sub="qualified + proposal · weighted by score"
          />
          <Kpi label="Avg CPI" value={String(stats.avg_cpi)} sub="0–100" />
        </div>

        {/* ── Charts ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          <div className="card p-5">
            <div className="text-sm font-medium mb-4">Leads by Stage</div>
            <div className="space-y-2">
              {byStage.map((s) => (
                <Bar key={s.label} label={s.label} count={s.count} max={maxStage} colorClass="bg-gold" />
              ))}
            </div>
          </div>

          <div className="card p-5">
            <div className="text-sm font-medium mb-4">CPI Band Distribution</div>
            <div className="space-y-2">
              {byBand.map((b) => (
                <Bar
                  key={b.band}
                  label={BAND_COLORS[b.band as keyof typeof BAND_COLORS]?.label ?? b.band}
                  count={b.count}
                  max={maxBand}
                  colorClass={BAND_FILL[b.band] ?? "bg-gray-400"}
                />
              ))}
            </div>
          </div>

          <div className="card p-5 lg:col-span-2">
            <div className="text-sm font-medium mb-4">Top Case Types</div>
            <div className="space-y-2">
              {(stats.by_case_type ?? []).map((t) => (
                <Bar key={t.case_type} label={t.case_type} count={t.count} max={maxType} colorClass="bg-navy" />
              ))}
            </div>
          </div>
        </div>

        {/* ── Law Firm Health ───────────────────────────────────────────── */}
        <div className="card p-5">
          <div className="text-sm font-medium mb-4">Law Firm Health</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-black/50 border-b border-black/10">
              <tr>
                <th className="text-left py-2">Firm</th>
                <th className="text-left">Location</th>
                <th className="text-right">Leads</th>
                <th className="text-right">Won</th>
                <th className="text-right">Pipeline $</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {stats.firms.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-black/40">
                    No firms yet. Add one from Law Firm Clients.
                  </td>
                </tr>
              )}
              {stats.firms.map((f) => (
                <tr key={f.id} className="border-b border-black/5">
                  <td className="py-2">{f.name}</td>
                  <td className="text-black/60">{f.location ?? "—"}</td>
                  <td className="text-right">{f.lead_count}</td>
                  <td className="text-right">{f.won_count}</td>
                  <td className="text-right">${Number(f.pipeline_value).toLocaleString()}</td>
                  <td className="text-right">
                    <span className="badge bg-black/5">{f.status}</span>
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
