/**
 * /portal/[firmId]/triage
 *
 * The lawyer's triage queue. Server component that pulls every screened lead
 * with status='triaging' for the current firm, sorted Band A → B → C, and
 * within each band by decision_deadline ascending (earliest first).
 *
 * Card hierarchy is NAP-first (Name + contact + Postal → primary; arrival
 * timestamp → secondary; matter type + channel → tertiary tags). The list
 * UI + the search/filter chrome live in <TriageQueueClient> so the lawyer
 * can search by lead name, phone, email, postal, lead ref, or matter type
 * with zero round-trip latency.
 *
 * Auth is handled by the parent layout (/portal/[firmId]/layout.tsx). If the
 * session does not match the firmId in the path, the layout redirects to
 * /portal/login before this component renders.
 */

import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sortTriageRows } from "@/lib/triage-sort";
import TriageRefresh from "@/components/portal/TriageRefresh";
import TriageQueueClient from "@/components/portal/TriageQueueClient";
import type { QueueCardRow } from "@/components/portal/TriageQueueCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  searchParams: Promise<{ band?: string; view?: string; q?: string; channel?: string }>;
}) {
  const { firmId } = await params;
  const { view: viewRaw } = await searchParams;
  const view: LifecycleView = viewRaw === "history" ? "history" : "active";

  // Active tab: single-status equality query. History tab: IN-list across the
  // three terminal statuses. Both queries return the same row shape.
  let query = supabase
    .from("screened_leads")
    .select(`
      lead_id, band, status, matter_type, practice_area,
      value_score, complexity_score, urgency_score, readiness_score,
      readiness_answered, whale_nurture, band_c_subtrack,
      decision_deadline, contact_name, contact_phone, contact_email,
      contact_postal_code, submitted_at, brief_json, slot_answers,
      intake_language
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

  const allRows = sortTriageRows((data ?? []) as QueueCardRow[]);
  const totalCount = allRows.length;

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
      <TriageQueueClient firmId={firmId} rows={allRows} view={view} />
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

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-red-200 px-6 py-6">
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}
