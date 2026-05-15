/**
 * /admin/triage
 *
 * Operator-facing cross-firm triage queue. Pulls every screened lead with
 * status='triaging' across ALL firms, sorted Band A → B → C with deadline
 * tiebreaker. Each row shows the firm name + a click-through to the brief
 * at /portal/[firmId]/triage/[leadId] (operator sessions can view any
 * firm's portal pages — see the /portal/[firmId]/layout.tsx gate).
 *
 * Filters:
 *   ?firm_id=<uuid>  — narrow to a specific firm
 *   ?band=A|B|C      — narrow to a band
 *
 * Auth: getOperatorSession() in the parent layout. This page only renders
 * when an operator is signed in.
 */

import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { matterLabel, subtrackLabel } from "@/lib/screened-leads-labels";
import { sortTriageRows } from "@/lib/triage-sort";
import { channelLabel, channelBadgeClasses } from "@/lib/channel-labels";
import DecisionTimer from "@/components/portal/DecisionTimer";
import TriageRefresh from "@/components/portal/TriageRefresh";
import FirmFilter from "@/components/admin/FirmFilter";

interface QueueRow {
  lead_id: string;
  firm_id: string;
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  practice_area: string;
  value_score: number | null;
  complexity_score: number | null;
  urgency_score: number | null;
  readiness_score: number | null;
  readiness_answered: boolean;
  whale_nurture: boolean;
  band_c_subtrack: string | null;
  decision_deadline: string;
  contact_name: string | null;
  submitted_at: string;
  brief_json: { matter_snapshot?: string; fee_estimate?: string } | null;
  slot_answers: { channel?: string } | null;
  intake_firms: { id: string; name: string | null; branding: { firm_name?: string } | null } | null;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BandFilter = "all" | "A" | "B" | "C";
type LifecycleView = "active" | "declined";

export default async function AdminTriagePage({
  searchParams,
}: {
  searchParams: Promise<{ band?: string; firm_id?: string; status?: string }>;
}) {
  const { band: bandRaw, firm_id: firmIdRaw, status: statusRaw } = await searchParams;
  const bandFilter: BandFilter =
    bandRaw === "A" || bandRaw === "B" || bandRaw === "C" ? bandRaw : "all";
  const view: LifecycleView = statusRaw === "declined" ? "declined" : "active";
  const dbStatus = view === "declined" ? "declined" : "triaging";

  let query = supabase
    .from("screened_leads")
    .select(`
      lead_id, firm_id, band, matter_type, practice_area,
      value_score, complexity_score, urgency_score, readiness_score,
      readiness_answered, whale_nurture, band_c_subtrack,
      decision_deadline, contact_name, submitted_at, brief_json,
      slot_answers, intake_firms!inner(id, name, branding)
    `)
    .eq("status", dbStatus);

  if (firmIdRaw) query = query.eq("firm_id", firmIdRaw);

  const { data, error } = await query.returns<QueueRow[]>();

  if (error) return <ErrorState message={`Could not load the queue: ${error.message}`} />;

  // Off-tab count (cross-firm, no firm filter) for the tab strip totals so
  // the operator sees absolute counts on both tabs.
  const offTabStatus = view === "declined" ? "triaging" : "declined";
  const { count: offTabCount } = await supabase
    .from("screened_leads")
    .select("id", { count: "exact", head: true })
    .eq("status", offTabStatus);

  // Load all firms for the filter dropdown — small set, single query.
  const { data: firms } = await supabase
    .from("intake_firms")
    .select("id, name, branding")
    .order("name", { ascending: true });

  const allRows = sortTriageRows((data ?? []) as QueueRow[]);
  const totalCount = allRows.length;
  // Band filter is only meaningful on the Active tab — declined rows are
  // mostly band=null since the engine filters before band assignment.
  const rows = view === "declined" || bandFilter === "all"
    ? allRows
    : allRows.filter((r) => r.band === bandFilter);

  const counts = {
    all: totalCount,
    A: allRows.filter((r) => r.band === "A").length,
    B: allRows.filter((r) => r.band === "B").length,
    C: allRows.filter((r) => r.band === "C").length,
  };

  const activeCount = view === "declined" ? (offTabCount ?? 0) : totalCount;
  const declinedCount = view === "declined" ? totalCount : (offTabCount ?? 0);
  const streamCheckUrl = view === "declined"
    ? "/api/admin/triage/stream-check?status=declined"
    : "/api/admin/triage/stream-check";

  return (
    <div className="space-y-5">
      <TriageRefresh streamCheckUrl={streamCheckUrl} />
      <Header count={totalCount} view={view} />
      <LifecycleTabRow view={view} activeCount={activeCount} declinedCount={declinedCount} firmIdActive={firmIdRaw ?? null} />
      <FilterRow
        active={bandFilter}
        counts={counts}
        firms={(firms ?? []).map((f) => ({
          id: f.id as string,
          name: ((f.branding as { firm_name?: string } | null)?.firm_name ?? f.name ?? "Unknown firm") as string,
        }))}
        firmIdActive={firmIdRaw ?? null}
        view={view}
      />
      {rows.length === 0 ? (
        <EmptyState view={view} filtered={bandFilter !== "all" || !!firmIdRaw} />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={`${row.firm_id}:${row.lead_id}`}>
              <QueueCard row={row} view={view} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LifecycleTabRow({
  view,
  activeCount,
  declinedCount,
  firmIdActive,
}: {
  view: LifecycleView;
  activeCount: number;
  declinedCount: number;
  firmIdActive: string | null;
}) {
  function tabHref(v: LifecycleView): string {
    const params = new URLSearchParams();
    if (v === "declined") params.set("status", "declined");
    if (firmIdActive) params.set("firm_id", firmIdActive);
    const qs = params.toString();
    return qs ? `/admin/triage?${qs}` : "/admin/triage";
  }
  const tabs: Array<{ key: LifecycleView; label: string; count: number }> = [
    { key: "active", label: "Active", count: activeCount },
    { key: "declined", label: "Declined", count: declinedCount },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap border-b border-black/10 pb-3">
      {tabs.map((t) => {
        const isActive = view === t.key;
        return (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={`
              inline-flex items-center gap-2 px-4 py-2 sm:py-1.5 text-xs font-bold uppercase tracking-wider border transition-colors min-h-[40px] sm:min-h-0
              ${isActive
                ? "border-navy bg-navy text-white"
                : "border-black/20 bg-white text-black/80 hover:border-navy hover:text-navy"
              }
            `}
          >
            <span>{t.label}</span>
            <span className={`font-mono text-[10px] ${isActive ? "text-white/70" : "text-black/40"}`}>
              {t.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function FilterRow({
  active,
  counts,
  firms,
  firmIdActive,
  view,
}: {
  active: BandFilter;
  counts: Record<BandFilter, number>;
  firms: Array<{ id: string; name: string }>;
  firmIdActive: string | null;
  view: LifecycleView;
}) {
  // Band sub-filter is only meaningful on the Active (triaging) tab.
  // Declined rows are mostly band=null. Hide the band row entirely on
  // the Declined view.
  if (view === "declined") {
    return (
      <FirmFilter
        action="/admin/triage"
        firms={firms}
        active={firmIdActive}
        extraParams={[{ name: "status", value: "declined" }]}
      />
    );
  }
  const tabs: Array<{ key: BandFilter; label: string }> = [
    { key: "all", label: "All bands" },
    { key: "A", label: "Band A" },
    { key: "B", label: "Band B" },
    { key: "C", label: "Band C" },
  ];

  function bandHref(b: BandFilter): string {
    const params = new URLSearchParams();
    if (b !== "all") params.set("band", b);
    if (firmIdActive) params.set("firm_id", firmIdActive);
    const qs = params.toString();
    return qs ? `/admin/triage?${qs}` : "/admin/triage";
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap">
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <Link
              key={t.key}
              href={bandHref(t.key)}
              className={`
                inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors
                ${isActive
                  ? "border-navy bg-navy text-white"
                  : "border-black/15 bg-white text-black/70 hover:border-navy hover:text-navy"
                }
              `}
            >
              <span>{t.label}</span>
              <span className={`font-mono text-[10px] ${isActive ? "text-white/70" : "text-black/40"}`}>
                {counts[t.key]}
              </span>
            </Link>
          );
        })}
      </div>

      <FirmFilter
        action="/admin/triage"
        firms={firms}
        active={firmIdActive}
        extraParams={active !== "all" ? [{ name: "band", value: active }] : []}
      />
    </div>
  );
}

function Header({ count, view }: { count: number; view: LifecycleView }) {
  const title = view === "declined" ? "Auto-filtered cross-firm" : "Cross-firm triage";
  const totalNoun = view === "declined" ? "auto-filtered" : "waiting";
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">{title}</h1>
      </div>
      <div className="text-xs text-black/50 uppercase tracking-wider">
        {count === 0 ? "Nothing here yet" : `${count} lead${count === 1 ? "" : "s"} ${totalNoun}`}
      </div>
    </div>
  );
}

function EmptyState({ view, filtered }: { view: LifecycleView; filtered?: boolean }) {
  let message: string;
  if (view === "declined") {
    message = filtered
      ? "No auto-filtered leads match these filters. Try clearing them."
      : "No auto-filtered leads across any firm.";
  } else if (filtered) {
    message = "No leads match these filters. Try clearing them.";
  } else {
    message = "No leads currently in triage across any firm.";
  }
  return (
    <div className="bg-white border border-black/8 px-6 py-10 text-center">
      <p className="text-sm text-black/60">{message}</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-red-200 px-6 py-6">
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}

function QueueCard({ row, view }: { row: QueueRow; view: LifecycleView }) {
  const snapshot = row.brief_json?.matter_snapshot ?? matterLabel(row.matter_type);
  const subtrack = subtrackLabel(row.band_c_subtrack);
  const simplicity = row.complexity_score === null ? null : 10 - row.complexity_score;
  const channel = row.slot_answers?.channel ?? null;
  const firmName = row.intake_firms?.branding?.firm_name ?? row.intake_firms?.name ?? "Unknown firm";
  const isDeclined = view === "declined";

  return (
    <Link
      href={`/portal/${row.firm_id}/triage/${row.lead_id}`}
      className={`block bg-white border transition-colors ${
        isDeclined
          ? "border-black/10 hover:border-stone-400 opacity-80 hover:opacity-100"
          : "border-black/10 hover:border-navy"
      }`}
    >
      <div className="px-5 py-4 grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-center">
        <BandBadge band={row.band} />

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-bold bg-navy/5 text-navy px-2 py-0.5 border border-navy/15">
              {firmName}
            </span>
            {isDeclined && (
              <span className="text-[10px] uppercase tracking-wider font-bold bg-stone-100 text-stone-700 px-2 py-0.5 border border-stone-300">
                Auto-filtered
              </span>
            )}
            <span className="text-xs uppercase tracking-wider font-semibold text-black/60">
              {matterLabel(row.matter_type)}
            </span>
            {row.whale_nurture && (
              <span className="text-[10px] uppercase tracking-wider font-semibold bg-gold/20 text-navy px-2 py-0.5 border border-gold/40">
                Whale nurture
              </span>
            )}
            {subtrack && (
              <span className="text-[10px] uppercase tracking-wider font-semibold bg-parchment-2 text-black/70 px-2 py-0.5 border border-black/10">
                {subtrack}
              </span>
            )}
            {channel && (
              <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${channelBadgeClasses(channel)}`}>
                {channelLabel(channel)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-black/80 line-clamp-2">{snapshot}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-black/50">
            <span className="font-mono">{row.lead_id}</span>
            {row.contact_name && (
              <>
                <span aria-hidden>·</span>
                <span>{row.contact_name}</span>
              </>
            )}
            {row.brief_json?.fee_estimate && (
              <>
                <span aria-hidden>·</span>
                <span className="text-black/70">{row.brief_json.fee_estimate}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-start md:items-end gap-2 min-w-[140px]">
          {isDeclined ? (
            <span className="text-[10px] uppercase tracking-wider font-bold text-stone-500">
              No decision needed
            </span>
          ) : (
            <DecisionTimer
              deadlineIso={row.decision_deadline}
              submittedAtIso={row.submitted_at}
            />
          )}
          <AxisRow
            value={row.value_score}
            simplicity={simplicity}
            urgency={row.urgency_score}
            readiness={row.readiness_score}
            readinessAnswered={row.readiness_answered}
          />
        </div>
      </div>
    </Link>
  );
}

function BandBadge({ band }: { band: "A" | "B" | "C" | "D" | null }) {
  const colour =
    band === "A" ? "bg-emerald-100 text-emerald-900 border-emerald-300"
    : band === "B" ? "bg-amber-100 text-amber-900 border-amber-300"
    : band === "C" ? "bg-stone-100 text-stone-700 border-stone-300"
    : band === "D" ? "bg-slate-100 text-slate-700 border-slate-300"
                   : "bg-stone-50 text-stone-500 border-stone-200";
  return (
    <span
      className={`inline-flex items-center justify-center font-mono font-bold text-base w-10 h-10 border ${colour}`}
      aria-label={`Band ${band ?? "unrated"}`}
    >
      {band ?? "—"}
    </span>
  );
}

interface AxisRowProps {
  value: number | null;
  simplicity: number | null;
  urgency: number | null;
  readiness: number | null;
  readinessAnswered: boolean;
}

function AxisRow({ value, simplicity, urgency, readiness, readinessAnswered }: AxisRowProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-[11px] tabular-nums">
      <Axis label="Val" score={value} />
      <Axis label="Smp" score={simplicity} />
      <Axis label="Urg" score={urgency} />
      <Axis label="Rdy" score={readiness} muted={!readinessAnswered} />
    </div>
  );
}

function Axis({ label, score, muted = false }: { label: string; score: number | null; muted?: boolean }) {
  return (
    <div className={`flex items-center gap-1 ${muted ? "opacity-50" : ""}`}>
      <span className="uppercase tracking-wider font-semibold text-black/50">{label}</span>
      <span className="font-mono font-bold text-black/80">{score ?? "—"}/10</span>
    </div>
  );
}
