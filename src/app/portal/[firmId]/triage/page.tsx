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
import DecisionTimer from "@/components/portal/DecisionTimer";
import RefreshOnFocus from "@/components/portal/RefreshOnFocus";

interface QueueRow {
  lead_id: string;
  band: "A" | "B" | "C" | null;
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
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TriageQueuePage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const { data, error } = await supabase
    .from("screened_leads")
    .select(`
      lead_id, band, matter_type, practice_area,
      value_score, complexity_score, urgency_score, readiness_score,
      readiness_answered, whale_nurture, band_c_subtrack,
      decision_deadline, contact_name, submitted_at, brief_json
    `)
    .eq("firm_id", firmId)
    .eq("status", "triaging");

  if (error) {
    return (
      <ErrorState message={`Could not load the queue: ${error.message}`} />
    );
  }

  const rows = sortTriageRows((data ?? []) as QueueRow[]);

  return (
    <div className="space-y-6">
      <RefreshOnFocus />
      <Header count={rows.length} />
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.lead_id}>
              <QueueCard firmId={firmId} row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Lawyer triage</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Active queue</h1>
      </div>
      <div className="text-xs text-black/50 uppercase tracking-wider">
        {count === 0 ? "No leads waiting" : `${count} lead${count === 1 ? "" : "s"} waiting`}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-black/8 px-6 py-10 text-center">
      <p className="text-sm text-black/60">
        No leads currently in triage. New screenings land here as they arrive.
      </p>
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

function QueueCard({ firmId, row }: { firmId: string; row: QueueRow }) {
  const snapshot = row.brief_json?.matter_snapshot ?? matterLabel(row.matter_type);
  const subtrack = subtrackLabel(row.band_c_subtrack);
  const simplicity = row.complexity_score === null ? null : 10 - row.complexity_score;

  return (
    <Link
      href={`/portal/${firmId}/triage/${row.lead_id}`}
      className="block bg-white border border-black/10 hover:border-navy transition-colors"
    >
      <div className="px-5 py-4 grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-center">
        <BandBadge band={row.band} />

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
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
          <DecisionTimer
            deadlineIso={row.decision_deadline}
            submittedAtIso={row.submitted_at}
          />
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

function BandBadge({ band }: { band: "A" | "B" | "C" | null }) {
  const colour =
    band === "A" ? "bg-emerald-100 text-emerald-900 border-emerald-300"
    : band === "B" ? "bg-amber-100 text-amber-900 border-amber-300"
    : band === "C" ? "bg-stone-100 text-stone-700 border-stone-300"
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
