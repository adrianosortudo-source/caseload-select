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
import LeadRowActions from "@/components/admin/LeadRowActions";
import BulkArchiveControl from "@/components/admin/BulkArchiveControl";

interface QueueRow {
  id: string;
  lead_id: string;
  firm_id: string;
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
  notification_sent_at: string | null;
  notification_error: string | null;
  brief_json: { matter_snapshot?: string; fee_estimate?: string } | null;
  slot_answers: { channel?: string } | null;
  intake_firms: { id: string; name: string | null; branding: { firm_name?: string } | null } | null;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BandFilter = "all" | "A" | "B" | "C" | "D";
type LifecycleView = "active" | "history" | "archived";

const HISTORY_STATUSES = ["passed", "referred", "declined"] as const;

export default async function AdminTriagePage({
  searchParams,
}: {
  searchParams: Promise<{ band?: string; firm_id?: string; view?: string }>;
}) {
  const { band: bandRaw, firm_id: firmIdRaw, view: viewRaw } = await searchParams;
  const bandFilter: BandFilter =
    bandRaw === "A" || bandRaw === "B" || bandRaw === "C" || bandRaw === "D" ? bandRaw : "all";
  const view: LifecycleView =
    viewRaw === "history" ? "history" : viewRaw === "archived" ? "archived" : "active";

  let query = supabase
    .from("screened_leads")
    .select(`
      id, lead_id, firm_id, band, status, matter_type, practice_area,
      value_score, complexity_score, urgency_score, readiness_score,
      readiness_answered, whale_nurture, band_c_subtrack,
      decision_deadline, contact_name, submitted_at,
      notification_sent_at, notification_error, brief_json,
      slot_answers, intake_firms!inner(id, name, branding)
    `);
  if (view === "archived") {
    query = query.eq("archived", true);
  } else if (view === "history") {
    query = query.in("status", HISTORY_STATUSES as unknown as string[]).eq("archived", false);
  } else {
    query = query.eq("status", "triaging").eq("archived", false);
  }

  if (firmIdRaw) query = query.eq("firm_id", firmIdRaw);

  const { data, error } = await query.returns<QueueRow[]>();

  if (error) return <ErrorState message={`Could not load the queue: ${error.message}`} />;

  // Tab-strip counts for all three views, respecting the firm filter.
  async function countView(v: LifecycleView): Promise<number> {
    let q = supabase.from("screened_leads").select("id", { count: "exact", head: true });
    if (v === "archived") q = q.eq("archived", true);
    else if (v === "history") q = q.in("status", HISTORY_STATUSES as unknown as string[]).eq("archived", false);
    else q = q.eq("status", "triaging").eq("archived", false);
    if (firmIdRaw) q = q.eq("firm_id", firmIdRaw);
    const { count } = await q;
    return count ?? 0;
  }
  const [activeCount, historyCount, archivedCount] = await Promise.all([
    countView("active"),
    countView("history"),
    countView("archived"),
  ]);

  // Load all firms for the filter dropdown — small set, single query.
  const { data: firms } = await supabase
    .from("intake_firms")
    .select("id, name, branding")
    .order("name", { ascending: true });

  const allRows = sortTriageRows((data ?? []) as QueueRow[]);
  const totalCount = allRows.length;
  // Band filter is only meaningful on the Active tab.
  const rows = view !== "active" || bandFilter === "all"
    ? allRows
    : allRows.filter((r) => r.band === bandFilter);

  const counts = {
    all: totalCount,
    A: allRows.filter((r) => r.band === "A").length,
    B: allRows.filter((r) => r.band === "B").length,
    C: allRows.filter((r) => r.band === "C").length,
    D: allRows.filter((r) => r.band === "D").length,
  };

  const streamCheckUrl = view === "history"
    ? "/api/admin/triage/stream-check?view=history"
    : "/api/admin/triage/stream-check";

  return (
    <div className="space-y-5">
      <TriageRefresh streamCheckUrl={streamCheckUrl} />
      <Header count={totalCount} view={view} />
      <LifecycleTabRow view={view} activeCount={activeCount} historyCount={historyCount} archivedCount={archivedCount} firmIdActive={firmIdRaw ?? null} />
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
      {view === "history" && <BulkArchiveControl firmId={firmIdRaw ?? null} />}
      {rows.length === 0 ? (
        <EmptyState view={view} filtered={bandFilter !== "all" || !!firmIdRaw} />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={`${row.firm_id}:${row.lead_id}`}>
              <QueueCard row={row} view={view} />
              <LeadRowActions id={row.id} status={row.status} view={view} />
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
  historyCount,
  archivedCount,
  firmIdActive,
}: {
  view: LifecycleView;
  activeCount: number;
  historyCount: number;
  archivedCount: number;
  firmIdActive: string | null;
}) {
  function tabHref(v: LifecycleView): string {
    const params = new URLSearchParams();
    if (v !== "active") params.set("view", v);
    if (firmIdActive) params.set("firm_id", firmIdActive);
    const qs = params.toString();
    return qs ? `/admin/triage?${qs}` : "/admin/triage";
  }
  const tabs: Array<{ key: LifecycleView; label: string; count: number }> = [
    { key: "active", label: "Active", count: activeCount },
    { key: "history", label: "History", count: historyCount },
    { key: "archived", label: "Archived", count: archivedCount },
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
  // History rows span multiple statuses; the band filter would be too
  // ambiguous to apply uniformly. Hide the band row entirely on history.
  if (view !== "active") {
    return (
      <FirmFilter
        action="/admin/triage"
        firms={firms}
        active={firmIdActive}
        extraParams={[{ name: "view", value: view }]}
      />
    );
  }
  const tabs: Array<{ key: BandFilter; label: string }> = [
    { key: "all", label: "All bands" },
    { key: "A", label: "Band A" },
    { key: "B", label: "Band B" },
    { key: "C", label: "Band C" },
    { key: "D", label: "Band D" },
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
  const title = view === "history" ? "Cross-firm lead history" : "Cross-firm triage";
  const totalNoun = view === "history" ? "finalised" : "waiting";
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">{title}</h1>
      </div>
      <div className="text-xs text-black/50 uppercase tracking-wider">
        {/* Always a count summary. The empty case is covered by EmptyState in
            the body, so the prior "Nothing here yet" here was a duplicate. */}
        {`${count} lead${count === 1 ? "" : "s"} ${totalNoun}`}
      </div>
    </div>
  );
}

function EmptyState({ view, filtered }: { view: LifecycleView; filtered?: boolean }) {
  let message: string;
  if (view === "history") {
    message = filtered
      ? "No finalised leads match these filters. Try clearing them."
      : "No finalised leads across any firm yet.";
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
  const isFinalised = view !== "active";
  const statusChip = !isFinalised
    ? null
    : row.status === "passed"
    ? { label: "Passed", classes: "bg-parchment-2 text-muted border-border-brand" }
    : row.status === "referred"
    ? { label: "Referred", classes: "bg-navy text-white border-navy" }
    : row.status === "declined"
    ? { label: "Declined", classes: "text-red-fail border-red-fail bg-transparent" }
    : row.status === "taken"
    ? { label: "Taken", classes: "bg-green-pass text-white border-green-pass" }
    : row.status === "triaging"
    ? { label: "Triaging", classes: "bg-amber-50 text-amber-800 border-amber-200" }
    : null;

  return (
    <Link
      href={`/portal/${row.firm_id}/triage/${row.lead_id}`}
      className={`block bg-white border transition-colors ${
        isFinalised
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
            {statusChip && (
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border ${statusChip.classes}`}>
                {statusChip.label}
              </span>
            )}
            {view === "archived" && (
              <span className="text-[10px] uppercase tracking-wider font-bold bg-parchment-2 text-muted px-2 py-0.5 border border-border-brand">
                Archived
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
            <NotificationChip
              sentAt={row.notification_sent_at}
              error={row.notification_error}
            />
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
          {isFinalised ? (
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted">
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

/**
 * New-lead notification delivery state (DR-046 invariant 4). Derived from
 * the screened_leads notification columns: Sent when a successful send is
 * stamped, Failed when the last attempt errored, Pending otherwise (never
 * attempted, or pre-tracking historical rows). The title carries the error
 * text so a hover explains a failure without leaving the queue.
 */
function NotificationChip({ sentAt, error }: { sentAt: string | null; error: string | null }) {
  const state = sentAt
    ? { label: "Notify sent", classes: "bg-green-pass/10 text-green-pass border-green-pass/30" }
    : error
    ? { label: "Notify failed", classes: "bg-red-fail/10 text-red-fail border-red-fail/30" }
    : { label: "Notify pending", classes: "bg-parchment-2 text-muted border-border-brand" };
  return (
    <span
      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${state.classes}`}
      title={error ?? undefined}
    >
      {state.label}
    </span>
  );
}

function BandBadge({ band }: { band: "A" | "B" | "C" | "D" | null }) {
  const colour =
    band === "A" ? "bg-gold text-deep-black border-gold"
    : band === "B" ? "bg-navy text-white border-navy"
    : band === "C" ? "bg-muted text-white border-muted"
    : band === "D" ? "bg-transparent text-field-label border-muted"
                   : "bg-parchment-2 text-muted border-border-brand";
  return (
    <span
      className={`inline-flex items-center justify-center font-display font-bold text-base w-10 h-10 border ${colour}`}
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
