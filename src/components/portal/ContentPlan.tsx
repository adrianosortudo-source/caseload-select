"use client";

import { createContext, useContext, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ContentPeriod,
  ContentPlanSettings,
  ContentKind,
  DeliverableStatus,
  StrategyBrief,
} from "@/lib/types";
import {
  isCompleteStrategyBrief,
  STRATEGY_BRIEF_FIELDS,
  strategyBriefFieldValue,
} from "@/lib/strategy-brief";
import {
  groupByCanonicalFormat,
  CANONICAL_FORMATS,
  languageLabel,
  periodFormatAnchorId,
  planProgress,
  computeOverview,
  isPublished,
  PRE_APPROVED_LABEL,
  PUBLISHED_LABEL,
  type PlanDeliverable,
  type PlanOverview,
} from "@/lib/deliverables-pure";
import {
  buildContentArchiveIndex,
  searchContentArchive,
  type ContentArchiveEntry,
} from "@/lib/content-archive-pure";

const PLAN_STATUS: Record<DeliverableStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-parchment-2 text-muted border-border-brand" },
  in_review: { label: "Pending", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  changes_requested: {
    label: "Changes requested",
    cls: "bg-amber-50 text-amber-800 border-amber-200",
  },
  approved: { label: "Approved", cls: "bg-green-pass/10 text-green-pass border-green-pass/30" },
  archived: { label: "Archived", cls: "bg-parchment-2 text-muted border-border-brand" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "No date set";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${d.toLocaleString("en-CA", { month: "short" })} ${d.getFullYear()}`;
}

function fmtRange(s: string, e: string): string {
  const ds = new Date(`${s}T00:00:00`);
  const de = new Date(`${e}T00:00:00`);
  if (Number.isNaN(ds.getTime()) || Number.isNaN(de.getTime())) return `${s} to ${e}`;
  const mS = ds.toLocaleString("en-CA", { month: "long" });
  const mE = de.toLocaleString("en-CA", { month: "long" });
  const yS = ds.getFullYear();
  const yE = de.getFullYear();
  if (yS === yE && mS === mE) return `${ds.getDate()} to ${de.getDate()} ${mE} ${yE}`;
  if (yS === yE) return `${ds.getDate()} ${mS} to ${de.getDate()} ${mE} ${yE}`;
  return `${ds.getDate()} ${mS} ${yS} to ${de.getDate()} ${mE} ${yE}`;
}

/**
 * A period's identity in the plan. Numbered publishing weeks read "Week 3";
 * periods with no week number are not weeks at all (standing assets,
 * retroactive review passes) and fall back to their date range, which is
 * still the only honest thing to say about them.
 */
function periodLabel(period: ContentPeriod): string {
  return period.week_number != null
    ? `Week ${period.week_number}`
    : fmtRange(period.starts_on, period.ends_on);
}

const StandingAuthorizedIdsContext = createContext<ReadonlySet<string>>(new Set());

export default function ContentPlan({
  firmId,
  viewerRole,
  includeArchived,
  periods,
  deliverables,
  settings,
  standingAuthActive = false,
  standingAuthorizedDeliverableIds = [],
}: {
  firmId: string;
  viewerRole: "operator" | "lawyer";
  includeArchived: boolean;
  periods: ContentPeriod[];
  deliverables: PlanDeliverable[];
  settings: ContentPlanSettings | null;
  standingAuthActive?: boolean;
  /** Server-derived canonical standing authorization; omitted/unavailable fails closed. */
  standingAuthorizedDeliverableIds?: string[];
}) {
  const router = useRouter();
  const [showNewWeek, setShowNewWeek] = useState(false);
  const [showNewDeliverable, setShowNewDeliverable] = useState(false);
  const isOperator = viewerRole === "operator";

  const live = deliverables.filter((d) => d.status !== "archived");
  const unscheduled = live.filter((d) => !d.period_id);
  const archived = includeArchived ? deliverables.filter((d) => d.status === "archived") : [];
  const standingAuthorizedIds = new Set(standingAuthorizedDeliverableIds);
  const overview = computeOverview(live, { standingAuthorizedDeliverableIds: standingAuthorizedIds });

  const refresh = () => router.refresh();

  return (
    <StandingAuthorizedIdsContext.Provider value={standingAuthorizedIds}>
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-[color:var(--portal-accent)]">
            Content plan
          </p>
          <h1 className="text-2xl font-bold text-navy mt-1">This week&rsquo;s content</h1>
          <p className="text-sm text-black/55 mt-1 max-w-xl">
            {isOperator
              ? "Plan the week, post the pieces, and place them by format. The firm reads the theme and approves each one."
              : "Read each piece and approve it, or ask for changes. Click any row to open the draft."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isOperator && <Link
            href={
              includeArchived
                ? `/portal/${firmId}/deliverables`
                : `/portal/${firmId}/deliverables?archived=1`
            }
            className={`inline-flex items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors ${
              includeArchived
                ? "border-navy bg-navy text-white"
                : "border-border-brand bg-white text-black/70 hover:border-navy hover:text-navy"
            }`}
          >
            {includeArchived ? "Hide archived" : "Show archived"}
          </Link>}
          {isOperator && (
            <>
              <button
                onClick={() => setShowNewWeek((s) => !s)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border border-navy bg-white text-navy hover:bg-navy hover:text-white transition-colors"
              >
                {showNewWeek ? "Close" : "New week"}
              </button>
              <button
                onClick={() => setShowNewDeliverable((s) => !s)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border border-navy bg-navy text-white hover:bg-navy/90 transition-colors"
              >
                {showNewDeliverable ? "Close" : "New piece"}
              </button>
            </>
          )}
        </div>
      </div>

      <ReviewOverview
        overview={overview}
        periods={periods}
        isOperator={isOperator}
        firmId={firmId}
        settings={settings}
        onChanged={refresh}
      />

        {isOperator && <ContentArchive
        firmId={firmId}
        periods={periods}
        deliverables={deliverables}
        includeArchived={includeArchived}
          standingAuthActive={false}
        />}

      {isOperator && showNewWeek && (
        <PeriodForm
          firmId={firmId}
          onDone={() => {
            setShowNewWeek(false);
            refresh();
          }}
        />
      )}

      {isOperator && showNewDeliverable && (
        <NewDeliverableForm
          firmId={firmId}
          onCreated={(id) => router.push(`/portal/${firmId}/deliverables/${id}`)}
        />
      )}

      {periods.length === 0 && live.length === 0 && (
        <div className="bg-white border border-border-brand px-6 py-10 text-center text-sm text-black/60">
          {isOperator
            ? "No content yet. Create a week, then post the pieces that belong to it."
            : "No content planned yet. The operator will post the week's pieces here for your review."}
        </div>
      )}

      {periods.map((period) => {
        const items = live.filter((d) => d.period_id === period.id);
        const { approved, published, total } = planProgress(items);
        const groups = groupByCanonicalFormat(items);
        return (
          <PeriodCard
            key={period.id}
            firmId={firmId}
            isOperator={isOperator}
            period={period}
            approved={approved}
            published={published}
            total={total}
            groups={groups}
            periods={periods}
            onChanged={refresh}
            standingAuthActive={standingAuthActive}
          />
        );
      })}

      {unscheduled.length > 0 && (
        <section className="bg-white border border-border-brand">
          <div className="px-6 py-4 border-b border-border-brand/60 bg-parchment-2/40">
            <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[color:var(--portal-accent)]">
              Not yet in a week
            </p>
            <p className="text-base font-bold text-navy mt-0.5">Unscheduled</p>
          </div>
          <div className="px-3 py-3">
            {groupByCanonicalFormat(unscheduled).map((g) => (
              <FormatGroupBlock
                key={g.format ?? "_unfiled"}
                firmId={firmId}
                isOperator={isOperator}
                group={g}
                periods={periods}
                standingAuthActive={standingAuthActive}
                onChanged={refresh}
                anchorId={periodFormatAnchorId("unscheduled", g.format)}
                highlighted={false}
              />
            ))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section className="bg-white border border-border-brand">
          <div className="px-6 py-4 border-b border-border-brand/60">
            <p className="text-base font-bold text-muted">Archived</p>
          </div>
          <div className="px-3 py-3">
            {archived.map((d) => (
              <DeliverableRow
                key={d.id}
                firmId={firmId}
                isOperator={isOperator}
                item={d}
                periods={periods}
                onChanged={refresh}
                standingAuthActive={standingAuthActive}
              />
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-black/40">
        Each approval is recorded against a specific version with a timestamp and
        the signer&rsquo;s name, as a Law Society of Ontario Rule 4.2-1 compliance
        record. Posting a new version returns a piece to review.
      </p>
    </div>
    </StandingAuthorizedIdsContext.Provider>
  );
}

// ─── Review overview (whole-plan summary) ────────────────────────────────────

function ContentArchive({
  firmId,
  periods,
  deliverables,
  includeArchived,
  standingAuthActive,
}: {
  firmId: string;
  periods: ContentPeriod[];
  deliverables: PlanDeliverable[];
  includeArchived: boolean;
  standingAuthActive: boolean;
}) {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<(typeof CANONICAL_FORMATS)[number] | "all">("all");
  const [language, setLanguage] = useState("all");
  const [status, setStatus] = useState("all");
  const [periodId, setPeriodId] = useState("all");
  const entries = buildContentArchiveIndex(firmId, periods, deliverables, standingAuthActive);
  const results = searchContentArchive(entries, firmId, { query, format, language, status, periodId });
  const active = Boolean(query.trim()) || format !== "all" || language !== "all" || status !== "all" || periodId !== "all";
  const statusOptions = [...new Set(entries.map((entry) => entry.status))].sort();

  return (
    <section className="bg-white border border-border-brand px-5 py-4" aria-labelledby="content-archive-title">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[color:var(--portal-accent)]">Content archive</p>
          <h2 id="content-archive-title" className="text-base font-bold text-navy mt-0.5">Find this client&rsquo;s content</h2>
        </div>
        <p className="text-[11px] text-muted">Current and historical weekly packages{includeArchived ? ", including archived pieces" : ""}</p>
      </div>
      <form className="flex flex-wrap gap-2" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="sr-only" htmlFor="content-archive-search">Search this client&rsquo;s content archive</label>
        <input id="content-archive-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this client&rsquo;s complete content archive" className="flex-1 min-w-[220px] border border-border-brand px-3 py-2 text-sm bg-white" />
        <label className="sr-only" htmlFor="content-archive-format">Filter by format</label>
        <select id="content-archive-format" value={format} onChange={(event) => setFormat(event.target.value as typeof format)} className="border border-border-brand px-2 py-2 text-xs bg-white text-navy"><option value="all">All formats</option>{CANONICAL_FORMATS.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <label className="sr-only" htmlFor="content-archive-language">Filter by language</label>
        <select id="content-archive-language" value={language} onChange={(event) => setLanguage(event.target.value)} className="border border-border-brand px-2 py-2 text-xs bg-white text-navy"><option value="all">All languages</option><option value="EN">English</option><option value="PT">Portuguese</option></select>
        <label className="sr-only" htmlFor="content-archive-status">Filter by status</label>
        <select id="content-archive-status" value={status} onChange={(event) => setStatus(event.target.value)} className="border border-border-brand px-2 py-2 text-xs bg-white text-navy"><option value="all">All statuses</option>{statusOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <label className="sr-only" htmlFor="content-archive-week">Filter by week</label>
        <select id="content-archive-week" value={periodId} onChange={(event) => setPeriodId(event.target.value)} className="border border-border-brand px-2 py-2 text-xs bg-white text-navy"><option value="all">All weeks</option>{periods.map((period) => <option key={period.id} value={period.id}>{periodLabel(period)}{period.theme ? ` · ${period.theme}` : ""}</option>)}</select>
      </form>
      {!active ? <p className="text-[11px] text-muted mt-2">Search by title, week, format, language, or status. Results appear here without duplicating the full archive.</p> : <div className="mt-3 border-t border-border-brand/60" aria-live="polite"><p className="text-[11px] text-muted py-2">{results.length} result{results.length === 1 ? "" : "s"} in this client&rsquo;s archive</p>{results.length === 0 ? <p className="text-sm text-black/55 py-3">No content matches these filters.</p> : results.map((entry) => <ArchiveResult key={entry.deliverable.id} firmId={firmId} entry={entry} />)}</div>}
    </section>
  );
}

function ArchiveResult({ firmId, entry }: { firmId: string; entry: ContentArchiveEntry }) {
  const published = isPublished(entry.deliverable.published_at) && entry.deliverable.status !== "archived";
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border-brand/40 last:border-b-0">
      <div className="min-w-0"><Link href={`/portal/${firmId}/deliverables/${entry.deliverable.id}`} className="text-sm font-semibold text-navy hover:underline">{entry.deliverable.title}</Link><p className="text-[11px] text-muted mt-0.5">{entry.period ? `${periodLabel(entry.period)} · ${entry.period.theme ?? ""}` : "Unscheduled"} · {entry.format} · {entry.language} · {entry.status}</p></div>
      <Link href={`/portal/${firmId}/deliverables/${entry.deliverable.id}`} className="flex-none text-xs font-semibold text-navy hover:underline">{entry.deliverable.status === "approved" || published ? "Open" : "Review"} →</Link>
    </div>
  );
}

function daysUntil(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

function daysLabel(days: number, event: "review" | "publication"): string {
  if (days === 0) return event === "review" ? "due today" : "publishes today";
  if (days < 0) return `${-days} day${-days === 1 ? "" : "s"} overdue`;
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function signalContext(
  signal: NonNullable<PlanOverview["nextReview"]>,
  periods: ContentPeriod[],
): string {
  const period = signal.period_id
    ? periods.find((candidate) => candidate.id === signal.period_id)
    : null;
  return `${period ? periodLabel(period) : "Unscheduled"} · ${signal.format}`;
}

export function ReviewOverview({
  overview,
  periods,
  isOperator,
  firmId,
  settings,
  onChanged,
}: {
  overview: PlanOverview;
  periods: ContentPeriod[];
  isOperator: boolean;
  firmId: string;
  settings: ContentPlanSettings | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const {
    total,
    approved,
    pending,
    preapproved,
    published,
    changes,
    draft,
    weeks,
    byFormat,
    nextReview,
    nextRevision,
    nextPublish,
    unscheduledEmails,
  } = overview;
  if (total === 0) return null;
  const pct = Math.round((approved / total) * 100);
  const reviewDays = settings?.review_by ? daysUntil(settings.review_by) : null;
  const reviewUrgency =
    reviewDays === null
      ? "text-navy"
      : reviewDays <= 0
        ? "text-red-fail"
        : reviewDays <= 2
          ? "text-amber-800"
          : "text-navy";
  const publicationDays = nextPublish ? daysUntil(nextPublish.date) : null;
  const publicationUrgency =
    publicationDays === null
      ? "text-navy"
      : publicationDays <= 0
        ? "text-red-fail"
        : publicationDays <= 2
          ? "text-amber-800"
          : "text-navy";

  const askLine =
    settings?.ask ??
    (isOperator
      ? "The firm reads each piece and approves it or asks for changes. You see the live queue state here."
      : "Read each piece and approve it, or ask for changes. Click any row to open the draft.");

  return (
    <div className="bg-white border border-border-brand p-5 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-[color:var(--portal-accent)]">
          Review overview
        </p>
        <h2 className="text-lg font-bold text-navy mt-0.5">Review and publication are tracked separately</h2>
        <p className="text-sm text-black/55 mt-0.5 max-w-2xl whitespace-pre-line">{askLine}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="border border-border-brand bg-parchment-1/60 p-4" aria-labelledby="review-queue-heading">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-burgundy">Review queue</p>
              <h3 id="review-queue-heading" className="mt-1 text-base font-bold text-navy">
                {pending > 0
                  ? `${pending} piece${pending === 1 ? "" : "s"} need firm review`
                  : changes > 0
                    ? `${changes} piece${changes === 1 ? "" : "s"} need revision`
                    : "No review action is waiting"}
              </h3>
            </div>
            {settings?.review_by && (
              <div className="text-right flex-none">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-black/40">Review by</p>
                <p className={`text-sm font-semibold ${reviewUrgency}`}>{fmtDate(settings.review_by)}</p>
                {reviewDays !== null && <p className={`text-xs ${reviewUrgency}`}>{daysLabel(reviewDays, "review")}</p>}
              </div>
            )}
          </div>
          {nextReview && (
            <div className="mt-3 border-t border-border-brand/70 pt-3">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-black/45">
                {signalContext(nextReview, periods)}
              </p>
              <Link href={`/portal/${firmId}/deliverables/${nextReview.id}`} className="mt-1 block text-sm font-semibold leading-snug text-navy hover:underline">
                {nextReview.title}
              </Link>
            </div>
          )}
          {nextRevision && (
            <div className="mt-3 border-t border-border-brand/70 pt-3">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-800">
                Changes requested · {signalContext(nextRevision, periods)}
              </p>
              <Link href={`/portal/${firmId}/deliverables/${nextRevision.id}`} className="mt-1 block text-sm font-semibold leading-snug text-navy hover:underline">
                {nextRevision.title}
              </Link>
            </div>
          )}
        </section>

        <section className="border border-border-brand bg-white p-4" aria-labelledby="publication-schedule-heading">
          <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-burgundy">Publication schedule</p>
          {nextPublish ? (
            <>
              <div className="mt-1 flex items-start justify-between gap-3">
                <h3 id="publication-schedule-heading" className="text-base font-bold text-navy">Next confirmed publication</h3>
                <div className="text-right flex-none">
                  <p className={`text-sm font-semibold ${publicationUrgency}`}>{fmtDate(nextPublish.date)}</p>
                  {publicationDays !== null && <p className={`text-xs ${publicationUrgency}`}>{daysLabel(publicationDays, "publication")}</p>}
                </div>
              </div>
              <div className="mt-3 border-t border-border-brand/70 pt-3">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-black/45">
                  {signalContext(nextPublish, periods)}
                </p>
                <Link href={`/portal/${firmId}/deliverables/${nextPublish.id}`} className="mt-1 block text-sm font-semibold leading-snug text-navy hover:underline">
                  {nextPublish.title}
                </Link>
              </div>
            </>
          ) : (
            <h3 id="publication-schedule-heading" className="mt-1 text-base font-bold text-navy">No confirmed publication is due</h3>
          )}
          {unscheduledEmails > 0 && (
            <p className="mt-3 border-t border-border-brand/70 pt-3 text-[11px] leading-relaxed text-black/55">
              {unscheduledEmails} unpublished email{unscheduledEmails === 1 ? " is" : "s are"} excluded from deadline warnings until a sending date is confirmed.
            </p>
          )}
        </section>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-black/55">
            <span className="font-semibold text-navy">{approved}</span> of {total} approved
          </span>
          <span className="text-black/45">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-parchment-2 overflow-hidden">
          <div className="h-full bg-green-pass rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px]">
          {published > 0 && (
            <OverviewCount n={published} label="published" cls="text-blue-published" />
          )}
          <OverviewCount n={approved} label="approved" cls="text-green-pass" />
          <OverviewCount n={pending} label="pending" cls="text-amber-800" />
          {preapproved > 0 && (
            <OverviewCount n={preapproved} label="pre-approved" cls="text-green-pass" />
          )}
          {changes > 0 && (
            <OverviewCount n={changes} label="changes requested" cls="text-amber-800" />
          )}
          {isOperator && draft > 0 && <OverviewCount n={draft} label="draft" cls="text-muted" />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <OverviewStat n={total} label={`piece${total === 1 ? "" : "s"}`} />
        {weeks > 0 && <OverviewStat n={weeks} label={`week${weeks === 1 ? "" : "s"}`} />}
        {byFormat
          .filter((f) => f.format)
          .map((f) => (
            <OverviewStat key={f.format ?? "_"} n={f.count} label={f.format ?? ""} />
          ))}
      </div>

      {isOperator && (
        <div className="pt-1">
          <button
            onClick={() => setEditing((s) => !s)}
            className="text-[11px] font-semibold text-navy/70 hover:text-navy"
          >
            {editing
              ? "Close"
              : settings?.ask || settings?.review_by
                ? "Edit note and deadline"
                : "Add a note and deadline"}
          </button>
          {editing && (
            <SettingsForm
              firmId={firmId}
              settings={settings}
              onDone={() => {
                setEditing(false);
                onChanged();
              }}
            />
          )}
        </div>
      )}

    </div>
  );
}

function SettingsForm({
  firmId,
  settings,
  onDone,
}: {
  firmId: string;
  settings: ContentPlanSettings | null;
  onDone: () => void;
}) {
  const [ask, setAsk] = useState(settings?.ask ?? "");
  const [reviewBy, setReviewBy] = useState(settings?.review_by ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/content-plan-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ask: ask.trim() || null, review_by: reviewBy || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not save.");
        setSaving(false);
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 p-3 bg-parchment-2/50 border border-border-brand space-y-2">
      <div>
        <label className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1">
          Note to the firm
        </label>
        <textarea
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          rows={2}
          placeholder="e.g. Please clear this batch by Monday. Flag any source-policy concerns on quoted clauses."
          className="w-full text-sm border border-border-brand px-2 py-1.5 bg-white resize-y"
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1">
          Review by <span className="text-black/40 normal-case font-normal">(optional)</span>
        </label>
        <input
          type="date"
          value={reviewBy}
          onChange={(e) => setReviewBy(e.target.value)}
          className="text-sm border border-border-brand px-2 py-1.5 bg-white"
        />
      </div>
      {error && <p className="text-[11px] text-red-fail">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="px-3 py-1.5 text-xs font-semibold bg-navy text-white disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

function OverviewCount({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <span className={cls}>
      <span className="font-semibold">{n}</span> <span className="text-black/50">{label}</span>
    </span>
  );
}

function OverviewStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="bg-parchment-2 rounded px-3 py-1.5 whitespace-nowrap">
      <span className="font-bold text-navy">{n}</span>{" "}
      <span className="text-[12px] text-muted">{label}</span>
    </div>
  );
}

// ─── Period card ─────────────────────────────────────────────────────────────

function PeriodCard({
  firmId,
  isOperator,
  period,
  approved,
  published,
  total,
  groups,
  periods,
  onChanged,
  standingAuthActive,
}: {
  firmId: string;
  isOperator: boolean;
  period: ContentPeriod;
  approved: number;
  published: number;
  total: number;
  groups: ReturnType<typeof groupByCanonicalFormat>;
  periods: ContentPeriod[];
  onChanged: () => void;
  standingAuthActive: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [highlightedAnchor, setHighlightedAnchor] = useState<string | null>(null);
  // Once anything in the week has shipped, publication is the honest
  // headline. A week released under standing authorization never accrues
  // individual approvals, so an approval-only bar would sit at 0% forever
  // for a week that is fully published.
  const showPublished = published > 0;
  const done = showPublished ? published : approved;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section className="bg-white border border-border-brand">
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border-brand/60 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[color:var(--portal-accent)]">
            {periodLabel(period)}
          </p>
          {period.theme && (
            <h2 className="text-lg font-bold text-navy mt-1 leading-snug">{period.theme}</h2>
          )}
        </div>
        <div className="min-w-[170px]">
          <p className="text-xs text-black/55 text-right mb-1.5">
            <span className="font-semibold text-navy">{done}</span> of {total}{" "}
            {showPublished ? "published" : "approved"}
          </p>
          <div className="h-1.5 rounded-full bg-parchment-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${showPublished ? "bg-blue-published" : "bg-green-pass"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {isOperator && (
            <div className="flex items-center justify-end gap-2 mt-2 flex-wrap">
              <Link
                href={`/portal/${firmId}/deliverables/periods/${period.id}`}
                className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-semibold border border-border-brand bg-white text-navy hover:border-navy"
              >
                Package workspace
              </Link>
              <button
                onClick={() => setEditing((s) => !s)}
                className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-semibold border border-border-brand bg-white text-navy hover:border-navy"
              >
                {editing ? "Close editor" : "Edit package overview"}
              </button>
              <PackageToolsButton periodId={period.id} />
              <Link
                href={`/portal/${firmId}/publish-kit/${period.id}`}
                className="text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 border border-navy bg-navy text-white hover:bg-navy/90"
              >
                Open Publish Kit
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Placement (operator decision): the weekly strategic record leads the
          card, immediately after the header block and above Details / Why. */}
      <StrategyBriefSection brief={period.strategyBrief} approved={showPublished || approved > 0} />

      {isOperator && editing ? (
        <div className="px-6 py-4 border-b border-border-brand/60 bg-parchment-2/30">
          <PeriodForm
            firmId={firmId}
            period={period}
            onDone={() => {
              setEditing(false);
              onChanged();
            }}
          />
        </div>
      ) : null}

      <div className="px-3 py-3">
        <FormatJumpNav periodId={period.id} groups={groups} onJump={(anchorId) => {
          const target = document.getElementById(anchorId);
          if (!target) return;
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
          window.setTimeout(() => target.focus({ preventScroll: true }), reduced ? 0 : 200);
          setHighlightedAnchor(anchorId);
          window.setTimeout(() => setHighlightedAnchor((current) => current === anchorId ? null : current), 1400);
        }} />
        {total === 0 ? (
          <p className="px-3 py-4 text-sm text-black/45">No pieces in this week yet.</p>
        ) : (
          groups.map((g) => (
            <FormatGroupBlock
              key={g.format}
              firmId={firmId}
              isOperator={isOperator}
              group={g}
              periods={periods}
              onChanged={onChanged}
              standingAuthActive={standingAuthActive}
              anchorId={periodFormatAnchorId(period.id, g.format)}
              highlighted={highlightedAnchor === periodFormatAnchorId(period.id, g.format)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function StrategyBriefSection({
  brief,
  approved,
}: {
  brief: StrategyBrief | null | undefined;
  approved: boolean;
}) {
  const complete = isCompleteStrategyBrief(brief);
  return (
    <section className="px-6 py-4 border-b border-border-brand/60 bg-parchment-2/20">
      <h3 className="text-sm font-bold text-navy">Weekly strategic record</h3>
      <p className="text-[12px] text-black/65 leading-[1.45] mt-1 max-w-3xl">
        This brief records the strategic decision behind this week&rsquo;s {approved ? "approved" : "proposed"} content package. Every listed deliverable must support this approved reader, matter, and practical question.
      </p>
      {!complete && (
        <p className="text-sm text-amber-800 leading-relaxed mt-3">
          The strategy record is incomplete. The content remains available; complete all six fields in Edit package overview before marking this package ready for client release.
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 border-t border-border-brand/60 max-[900px]:grid-cols-1">
        {STRATEGY_BRIEF_FIELDS.map(([key, label]) => (
          <div
            key={key}
            className="grid grid-cols-[minmax(8rem,0.38fr)_1fr] items-start gap-x-3 gap-y-1 px-3 py-2 border-b border-border-brand/40 min-[901px]:odd:border-r max-[640px]:grid-cols-1"
          >
            <dt className="text-[10px] uppercase tracking-[0.08em] font-bold text-navy pt-0.5">
              {label}
            </dt>
            <dd className={strategyBriefFieldValue(brief, key).complete ? "text-[12px] text-black/75 leading-[1.45]" : "text-[11px] text-muted italic leading-[1.4]"}>
              {strategyBriefFieldValue(brief, key).complete ? strategyBriefFieldValue(brief, key).value : <><span className="not-italic text-navy/70">What belongs here: </span>{strategyBriefFieldValue(brief, key).value}</>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// Pulls the exact, already-stored deliverable content for this period via the
// operator-only content export. It never derives or changes client review.
function PackageToolsButton({ periodId }: { periodId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-semibold border border-border-brand bg-white text-navy hover:border-navy"
      >
        {open ? "Close tools" : "Package tools"}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 z-10 bg-white border border-border-brand shadow-sm flex flex-col min-w-[150px]">
          <a
            href={`/api/admin/content-periods/${periodId}/content-export?format=json`}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            className="px-3 py-2 text-xs font-semibold text-black/70 hover:bg-parchment-2 hover:text-navy whitespace-nowrap"
          >
            Export JSON
          </a>
          <a
            href={`/api/admin/content-periods/${periodId}/content-export?format=markdown`}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            className="px-3 py-2 text-xs font-semibold text-black/70 hover:bg-parchment-2 hover:text-navy border-t border-border-brand/60 whitespace-nowrap"
          >
            Export Markdown
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Format group + rows ─────────────────────────────────────────────────────

function FormatJumpNav({
  periodId,
  groups,
  onJump,
}: {
  periodId: string;
  groups: ReturnType<typeof groupByCanonicalFormat>;
  onJump: (anchorId: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <nav aria-label="This week's formats" className="flex flex-wrap items-center gap-2 border-b border-border-brand/60 pb-2">
      <span className="mr-1 text-[10px] uppercase tracking-[0.1em] font-semibold text-navy">
        This week&apos;s formats
      </span>
      {groups.map((group) => {
        const anchorId = periodFormatAnchorId(periodId, group.format);
        return (
          <a
            key={anchorId}
            href={`#${anchorId}`}
            onClick={(event) => {
              event.preventDefault();
              onJump(anchorId);
            }}
            className="border border-border-brand px-2 py-1 text-[11px] font-semibold text-navy hover:border-navy hover:bg-parchment-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            {group.format === "Checklists & downloadable resources" ? "Checklists & resources" : group.format} · {group.items.length}
          </a>
        );
      })}
    </nav>
  );
}

function FormatGroupBlock({
  firmId,
  isOperator,
  group,
  periods,
  onChanged,
  standingAuthActive,
  anchorId,
  highlighted,
}: {
  firmId: string;
  isOperator: boolean;
  group: ReturnType<typeof groupByCanonicalFormat>[number];
  periods: ContentPeriod[];
  onChanged: () => void;
  standingAuthActive: boolean;
  anchorId: string;
  highlighted: boolean;
}) {
  return (
    <div className="mb-1.5">
      <div
        id={anchorId}
        tabIndex={-1}
        className={`scroll-mt-4 flex items-center gap-2.5 px-3 pt-3 pb-1.5 transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy ${highlighted ? "bg-parchment-2/70" : ""}`}
      >
        <span className="text-[12px] font-bold uppercase tracking-[0.05em] text-navy">
          {group.format}
        </span>
        <span className="text-[11px] font-semibold text-muted bg-parchment-2 border border-border-brand rounded-full px-2 leading-5">
          {group.items.length}
        </span>
        <span className="flex-1 h-px bg-border-brand/60" />
      </div>
      {group.items.map((item) => (
        <DeliverableRow
          key={item.id}
          firmId={firmId}
          isOperator={isOperator}
          item={item}
          periods={periods}
          standingAuthActive={standingAuthActive}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function DeliverableRow({
  firmId,
  isOperator,
  item,
  periods,
  onChanged,
  standingAuthActive,
}: {
  firmId: string;
  isOperator: boolean;
  item: PlanDeliverable;
  periods: ContentPeriod[];
  onChanged: () => void;
  standingAuthActive: boolean;
}) {
  const standingAuthorizedIds = useContext(StandingAuthorizedIdsContext);
  const [placing, setPlacing] = useState(false);
  // A recorded published_at outranks every other label: once a piece is out,
  // that is the fact the row needs to carry. Below it, DR-107: an in_review
  // item pre-approved under standing authorization (not flagged
  // requires_individual_review) shows Pre-approved instead of Pending. Every
  // other status keeps its plain PLAN_STATUS entry.
  const published = isPublished(item.published_at) && item.status !== "archived";
  const st = published
    ? {
        label: PUBLISHED_LABEL,
        cls: "bg-blue-published/10 text-blue-published border-blue-published/30",
      }
    : item.status === "in_review" && standingAuthorizedIds.has(item.id)
      ? { label: PRE_APPROVED_LABEL, cls: "bg-green-pass/10 text-green-pass border-green-pass/30" }
      : PLAN_STATUS[item.status];
  // Report the date the piece actually went out when we have one. The old
  // rule keyed "Published" off status === "approved", which conflated lawyer
  // sign-off with publication -- a piece can be approved and unpublished, or
  // published under standing authorization while still in_review.
  const dated = published
    ? `Published ${fmtDate(item.published_at)}`
    : item.publish_date
      ? `Publishes ${fmtDate(item.publish_date)}`
      : "No publish date set";

  return (
    <div>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded hover:bg-parchment-2/50 transition-colors">
        <span className="flex-none w-8 text-center text-[10px] uppercase tracking-[0.08em] font-semibold text-muted" aria-label={`Language: ${languageLabel(item.locale)}`}>
          {languageLabel(item.locale)}
        </span>
        <Link href={`/portal/${firmId}/deliverables/${item.id}`} className="flex-1 min-w-0 group">
          <p className="text-[15px] font-medium text-black/85 leading-snug group-hover:text-navy">
            {item.kicker ? `${item.kicker} · ` : ""}
            {item.title}
          </p>
          <p className="text-[12.5px] text-muted mt-0.5">
            {dated}
            {item.format ? ` · ${item.format}` : ""}
          </p>
        </Link>
        <span
          className={`flex-none text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 border rounded-full whitespace-nowrap ${st.cls}`}
        >
          {st.label}
        </span>
        {isOperator && (
          <button
            onClick={() => setPlacing((s) => !s)}
            className="flex-none text-[11px] font-semibold text-navy/60 hover:text-navy"
            aria-label="Place this piece"
          >
            {placing ? "Close" : "Place"}
          </button>
        )}
        <Link
          href={`/portal/${firmId}/deliverables/${item.id}`}
          className="flex-none text-[13px] font-semibold text-navy hover:underline whitespace-nowrap"
        >
          {item.status === "approved" || published ? "Open" : "Review"} &rarr;
        </Link>
      </div>
      {isOperator && placing && (
        <PlacementControl
          firmId={firmId}
          item={item}
          periods={periods}
          onDone={() => {
            setPlacing(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ─── Operator: placement (week + format) ─────────────────────────────────────

function PlacementControl({
  firmId,
  item,
  periods,
  onDone,
}: {
  firmId: string;
  item: PlanDeliverable;
  periods: ContentPeriod[];
  onDone: () => void;
}) {
  const [periodId, setPeriodId] = useState(item.period_id ?? "");
  const [format, setFormat] = useState(item.format ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/deliverables/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "place",
          period_id: periodId || null,
          format: format.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not save.");
        setSaving(false);
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setSaving(false);
    }
  }

  return (
    <div className="mx-3 mb-2 p-3 bg-parchment-2/50 border border-border-brand flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1">
          Week
        </label>
        <select
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className="text-xs border border-border-brand px-2 py-1.5 bg-white min-w-[180px]"
        >
          <option value="">Unscheduled</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {periodLabel(p)}
              {p.theme ? ` · ${p.theme.slice(0, 30)}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[160px]">
        <label className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1">
          Format
        </label>
        <input
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          placeholder="e.g. Counsel Note"
          className="w-full text-xs border border-border-brand px-2 py-1.5 bg-white"
        />
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="px-3 py-1.5 text-xs font-semibold bg-navy text-white disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save"}
      </button>
      {error && <p className="w-full text-[11px] text-red-fail">{error}</p>}
    </div>
  );
}

// ─── Operator: new / edit week ───────────────────────────────────────────────

function PeriodForm({
  firmId,
  period,
  onDone,
}: {
  firmId: string;
  period?: ContentPeriod;
  onDone: () => void;
}) {
  const [startsOn, setStartsOn] = useState(period?.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(period?.ends_on ?? "");
  const [weekNumber, setWeekNumber] = useState(
    period?.week_number != null ? String(period.week_number) : "",
  );
  const [theme, setTheme] = useState(period?.theme ?? "");
  const [strategyBrief, setStrategyBrief] = useState<StrategyBrief>(
    period?.strategyBrief ?? {
      readerAndSituation: "",
      workSupported: "",
      whyThisWeek: "",
      practicalAngle: "",
      authorityAndEvidence: "",
      websiteAndConversionRole: "",
    },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!startsOn || !endsOn) {
      setError("Set the start and end dates.");
      return;
    }
    const trimmedWeek = weekNumber.trim();
    if (trimmedWeek && !/^\d+$/.test(trimmedWeek)) {
      setError("Week number must be a whole number, or left blank.");
      return;
    }
    if (!isCompleteStrategyBrief(strategyBrief)) {
      setError("Complete all six Weekly strategic record fields before saving this week.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      starts_on: startsOn,
      ends_on: endsOn,
      // Blank clears the number: the period is not a numbered publishing week.
      week_number: trimmedWeek ? Number(trimmedWeek) : null,
      theme: theme.trim() || null,
      strategy_brief: strategyBrief,
    };
    const url = period
      ? `/api/portal/${firmId}/periods/${period.id}`
      : `/api/portal/${firmId}/periods`;
    try {
      const res = await fetch(url, {
        method: period ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not save.");
        setSaving(false);
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!period) return;
    if (!confirm("Delete this week? Pieces in it become unscheduled.")) return;
    setSaving(true);
    try {
      await fetch(`/api/portal/${firmId}/periods/${period.id}`, { method: "DELETE" });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-white border border-border-brand p-4 space-y-3">
      <div className="flex gap-3 flex-wrap">
        <div>
          <label
            htmlFor="period-week-number"
            className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1"
          >
            Week number
          </label>
          <input
            id="period-week-number"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={weekNumber}
            onChange={(e) => setWeekNumber(e.target.value)}
            placeholder="3"
            className="text-sm border border-border-brand px-2 py-1.5 bg-white w-[110px]"
          />
          <p className="text-[11px] text-muted mt-1 max-w-[240px]">
            Leave blank for standing assets or a review pass: those are not
            numbered weeks.
          </p>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1">
            Week starts
          </label>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className="text-sm border border-border-brand px-2 py-1.5 bg-white"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1">
            Week ends
          </label>
          <input
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className="text-sm border border-border-brand px-2 py-1.5 bg-white"
          />
        </div>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1">
          Theme
        </label>
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder="e.g. Commercial leases, before the signature"
          className="w-full text-sm border border-border-brand px-3 py-2 bg-white"
        />
      </div>
      <fieldset className="border-t border-border-brand/60 pt-3 space-y-3">
        <legend className="text-[10px] uppercase tracking-wider font-semibold text-navy">
          Weekly strategic record
        </legend>
        <p className="text-xs text-black/55">
          Complete all six fields. The content remains accessible while this strategy record is being completed.
        </p>
        {STRATEGY_BRIEF_FIELDS.map(([key, label]) => {
          const inputId = `period-${period?.id ?? "new"}-strategy-${key}`;
          return (
            <div key={key}>
              <label
                htmlFor={inputId}
                className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1"
              >
                {label}
              </label>
              <textarea
                id={inputId}
                value={strategyBrief[key]}
                onChange={(e) =>
                  setStrategyBrief((current) => ({ ...current, [key]: e.target.value }))
                }
                rows={3}
                className="w-full text-sm border border-border-brand px-3 py-2 bg-white resize-y"
              />
            </div>
          );
        })}
      </fieldset>
      {error && <p className="text-xs text-red-fail">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm font-semibold bg-navy text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : period ? "Save week" : "Create week"}
        </button>
        {period && (
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="text-xs font-semibold text-red-fail/80 hover:text-red-fail"
          >
            Delete week
          </button>
        )}
      </div>
    </form>
  );
}

// ─── Operator: new deliverable ───────────────────────────────────────────────

function NewDeliverableForm({
  firmId,
  onCreated,
}: {
  firmId: string;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ContentKind>("text");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const KIND_LABELS: Record<ContentKind, string> = { text: "Text", image: "Image", pdf: "PDF" };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          content_kind: kind,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not create.");
        setSaving(false);
        return;
      }
      onCreated(json.deliverable.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-border-brand p-4 space-y-3">
      <div>
        <label className="block text-xs font-semibold text-navy mb-1">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Five clauses to read before signing a commercial lease"
          className="w-full border border-border-brand px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-navy mb-1">
          Description <span className="text-black/40 font-normal">(optional)</span>
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this is and where it will run"
          className="w-full border border-border-brand px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-navy mb-1">Type</label>
        <div className="flex gap-2">
          {(["text", "image", "pdf"] as ContentKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors ${
                kind === k
                  ? "border-navy bg-navy text-white"
                  : "border-border-brand bg-white text-black/60 hover:border-navy"
              }`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-fail">{error}</p>}
      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="px-4 py-2 text-sm font-semibold bg-navy text-white disabled:opacity-50"
      >
        {saving ? "Creating..." : "Create and add first version"}
      </button>
    </form>
  );
}
