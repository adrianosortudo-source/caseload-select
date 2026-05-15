/**
 * /portal/[firmId]/triage
 *
 * The lawyer's triage queue. Server component that pulls every screened lead
 * with status='triaging' for the current firm, sorted Band A → B → C, and
 * within each band by decision_deadline ascending (earliest first).
 *
 * Each row exposes: band badge, matter type + practice area, four-axis
 * numbers, decision timer (live countdown), one-line snapshot, lead ID,
 * fee estimate, and (Phase 2) Take/Pass buttons. Take/Pass are deferred,
 * the row link goes to the brief view.
 *
 * Auth is handled by the parent layout (/portal/[firmId]/layout.tsx). If the
 * session does not match the firmId in the path, the layout redirects to
 * /portal/login before this component renders.
 */

import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { matterLabel, subtrackLabel } from "@/lib/screened-leads-labels";
import { sortTriageRows } from "@/lib/triage-sort";
import { intakeLanguageLabel } from "@/lib/intake-language-label";
import { channelLabel, channelBadgeClasses } from "@/lib/channel-labels";
import DecisionTimer from "@/components/portal/DecisionTimer";
import TriageRefresh from "@/components/portal/TriageRefresh";

interface QueueRow {
  lead_id: string;
  band: "A" | "B" | "C" | "D" | null;
  status: "triaging" | "taken" | "passed" | "declined" | "referred";
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
  intake_language: string | null;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BandFilter = "all" | "A" | "B" | "C" | "D";
/**
 * Two top-level views:
 *   active   — status='triaging' (default). The lawyer's primary surface.
 *              OOS leads land here as Band D (refer-eligible) per the
 *              2026-05-15 doctrine.
 *   history  — status IN ('passed', 'referred', 'declined'). All terminal
 *              dispositions. Lawyer audit trail across every finalised
 *              lead — passes, referrals, and (future) engine-spam declines.
 */
type LifecycleView = "active" | "history";

const HISTORY_STATUSES = ["passed", "referred", "declined"] as const;

export default async function TriageQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ band?: string; view?: string }>;
}) {
  const { firmId } = await params;
  const { band: bandRaw, view: viewRaw } = await searchParams;
  const bandFilter: BandFilter =
    bandRaw === "A" || bandRaw === "B" || bandRaw === "C" || bandRaw === "D" ? bandRaw : "all";
  const view: LifecycleView = viewRaw === "history" ? "history" : "active";

  // Active tab: single-status equality query. History tab: IN-list across the
  // three terminal statuses. Both queries return the same row shape.
  let query = supabase
    .from("screened_leads")
    .select(`
      lead_id, band, status, matter_type, practice_area,
      value_score, complexity_score, urgency_score, readiness_score,
      readiness_answered, whale_nurture, band_c_subtrack,
      decision_deadline, contact_name, submitted_at, brief_json,
      slot_answers, intake_language
    `)
    .eq("firm_id", firmId);
  query = view === "history"
    ? query.in("status", HISTORY_STATUSES as unknown as string[])
    : query.eq("status", "triaging");

  const { data, error } = await query;

  if (error) {
    return (
      <ErrorState message={`Could not load the queue: ${error.message}`} />
    );
  }

  // Off-tab count so the lifecycle tabs show absolute totals.
  let offTabQuery = supabase
    .from("screened_leads")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", firmId);
  offTabQuery = view === "history"
    ? offTabQuery.eq("status", "triaging")
    : offTabQuery.in("status", HISTORY_STATUSES as unknown as string[]);
  const { count: offTabCount } = await offTabQuery;

  const allRows = sortTriageRows((data ?? []) as QueueRow[]);
  const totalCount = allRows.length;
  // Band filter is meaningful only on the Active tab.
  const rows = view === "history" || bandFilter === "all"
    ? allRows
    : allRows.filter((r) => r.band === bandFilter);

  const counts = {
    all: totalCount,
    A: allRows.filter((r) => r.band === "A").length,
    B: allRows.filter((r) => r.band === "B").length,
    C: allRows.filter((r) => r.band === "C").length,
    D: allRows.filter((r) => r.band === "D").length,
  };

  const activeCount = view === "history" ? (offTabCount ?? 0) : totalCount;
  const historyCount = view === "history" ? totalCount : (offTabCount ?? 0);
  const streamCheckUrl = view === "history"
    ? `/api/portal/${firmId}/triage/stream-check?view=history`
    : `/api/portal/${firmId}/triage/stream-check`;

  return (
    <div className="space-y-5">
      <TriageRefresh streamCheckUrl={streamCheckUrl} />
      <Header count={totalCount} view={view} />
      <LifecycleTabRow firmId={firmId} view={view} activeCount={activeCount} historyCount={historyCount} />
      {view === "active" && (
        <BandFilterRow firmId={firmId} active={bandFilter} counts={counts} />
      )}
      {rows.length === 0 ? (
        <EmptyState view={view} filtered={view === "active" && bandFilter !== "all"} />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.lead_id}>
              <QueueCard firmId={firmId} row={row} view={view} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LifecycleTabRow({
  firmId,
  view,
  activeCount,
  historyCount,
}: {
  firmId: string;
  view: LifecycleView;
  activeCount: number;
  historyCount: number;
}) {
  const tabs: Array<{ key: LifecycleView; label: string; count: number; href: string }> = [
    { key: "active", label: "Active", count: activeCount, href: `/portal/${firmId}/triage` },
    { key: "history", label: "History", count: historyCount, href: `/portal/${firmId}/triage?view=history` },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap border-b border-black/10 pb-3">
      {tabs.map((t) => {
        const isActive = view === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
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

function BandFilterRow({
  firmId,
  active,
  counts,
}: {
  firmId: string;
  active: BandFilter;
  counts: Record<BandFilter, number>;
}) {
  const tabs: Array<{ key: BandFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "A",   label: "Band A" },
    { key: "B",   label: "Band B" },
    { key: "C",   label: "Band C" },
    { key: "D",   label: "Band D" },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tabs.map((t) => {
        const isActive = active === t.key;
        const href = t.key === "all"
          ? `/portal/${firmId}/triage`
          : `/portal/${firmId}/triage?band=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            className={`
              inline-flex items-center gap-2 px-3 py-2 sm:py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors min-h-[40px] sm:min-h-0
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
  );
}

function Header({ count, view }: { count: number; view: LifecycleView }) {
  const title = view === "history" ? "Lead history" : "Active queue";
  const eyebrow = view === "history" ? "Finalised leads" : "Lawyer triage";
  const totalNoun = view === "history" ? "finalised" : "waiting";
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">{eyebrow}</p>
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
  if (view === "history") {
    message = "No finalised leads yet. Leads you Take, Pass, or Refer land here.";
  } else if (filtered) {
    message = "No leads in this band currently in triage. Try clearing the filter.";
  } else {
    message = "No leads currently in triage. New screenings land here as they arrive.";
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

function QueueCard({
  firmId,
  row,
  view,
}: {
  firmId: string;
  row: QueueRow;
  view: LifecycleView;
}) {
  const snapshot = row.brief_json?.matter_snapshot ?? matterLabel(row.matter_type);
  const subtrack = subtrackLabel(row.band_c_subtrack);
  const simplicity = row.complexity_score === null ? null : 10 - row.complexity_score;
  const channel = row.slot_answers?.channel ?? null;
  const langLabel = intakeLanguageLabel(row.intake_language);
  const isHistory = view === "history";
  // Status chip label for History rows.
  const statusChip = !isHistory
    ? null
    : row.status === "passed"
    ? { label: "Passed", classes: "bg-stone-100 text-stone-700 border-stone-300" }
    : row.status === "referred"
    ? { label: "Referred", classes: "bg-slate-100 text-slate-700 border-slate-300" }
    : row.status === "declined"
    ? { label: "Declined", classes: "bg-stone-100 text-stone-700 border-stone-300" }
    : row.status === "taken"
    ? { label: "Taken", classes: "bg-emerald-100 text-emerald-900 border-emerald-300" }
    : null;

  return (
    <Link
      href={`/portal/${firmId}/triage/${row.lead_id}`}
      className={`block bg-white border transition-colors ${
        isHistory
          ? "border-black/10 hover:border-stone-400 opacity-80 hover:opacity-100"
          : "border-black/10 hover:border-navy"
      }`}
    >
      <div className="px-5 py-4 grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-center">
        <BandBadge band={row.band} />

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {statusChip && (
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border ${statusChip.classes}`}>
                {statusChip.label}
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
            {langLabel && (
              <span className="text-[10px] uppercase tracking-wider font-semibold bg-blue-50 text-blue-800 px-2 py-0.5 border border-blue-200">
                {langLabel}
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
          {/*
            DecisionTimer is only meaningful on triaging rows. History rows
            have a finalised disposition; show a static "Closed" stamp.
          */}
          {isHistory ? (
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
  // 2x2 grid on mobile, single row on md+
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
