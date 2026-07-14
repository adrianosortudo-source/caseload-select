"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ContentPeriod,
  ContentPlanSettings,
  ContentKind,
  DeliverableStatus,
} from "@/lib/types";
import {
  groupByFormat,
  planProgress,
  computeOverview,
  type PlanDeliverable,
  type PlanOverview,
} from "@/lib/deliverables-pure";
import PublicationReadinessSummary from "@/components/portal/PublicationReadinessSummary";
import { sliceReadinessForPeriod, type DeliverableReadiness } from "@/lib/publication-readiness";

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

export interface PlanReadinessProp {
  summary: { active: number; ready: number; blocked: number; excluded: number };
  items: DeliverableReadiness[];
  titles: Record<string, string>;
}

export default function ContentPlan({
  firmId,
  viewerRole,
  includeArchived,
  periods,
  deliverables,
  settings,
  planReadiness,
}: {
  firmId: string;
  viewerRole: "operator" | "lawyer";
  includeArchived: boolean;
  periods: ContentPeriod[];
  deliverables: PlanDeliverable[];
  settings: ContentPlanSettings | null;
  planReadiness?: PlanReadinessProp;
}) {
  const router = useRouter();
  const [showNewWeek, setShowNewWeek] = useState(false);
  const [showNewDeliverable, setShowNewDeliverable] = useState(false);
  const isOperator = viewerRole === "operator";

  const live = deliverables.filter((d) => d.status !== "archived");
  const unscheduled = live.filter((d) => !d.period_id);
  const archived = includeArchived ? deliverables.filter((d) => d.status === "archived") : [];
  const overview = computeOverview(live);

  const refresh = () => router.refresh();

  return (
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
          <Link
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
          </Link>
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
        isOperator={isOperator}
        firmId={firmId}
        settings={settings}
        onChanged={refresh}
        planReadiness={planReadiness}
      />

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
        const { approved, total } = planProgress(items);
        const groups = groupByFormat(items);
        // Slice the whole-plan readiness set down to this period's own
        // deliverables. Reuses the ids already computed above rather than
        // adding a second period-scoped data load; sliceReadinessForPeriod
        // keeps the per-period counts using the exact same rules as the
        // whole-plan summary (see publication-readiness.test.ts for the
        // proof this slicing is correct, and
        // PublicationReadinessSummary.test.tsx for the proof the resulting
        // periodId reaches the rendered "download manifest" link).
        const periodDeliverableIds = new Set(items.map((d) => d.id));
        const sliced = sliceReadinessForPeriod(planReadiness?.items ?? [], periodDeliverableIds);
        const periodReadiness: PlanReadinessProp | undefined = planReadiness
          ? { summary: sliced.summary, items: sliced.items, titles: planReadiness.titles }
          : undefined;
        return (
          <PeriodCard
            key={period.id}
            firmId={firmId}
            isOperator={isOperator}
            period={period}
            approved={approved}
            total={total}
            groups={groups}
            periods={periods}
            onChanged={refresh}
            periodReadiness={periodReadiness}
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
            {groupByFormat(unscheduled).map((g) => (
              <FormatGroupBlock
                key={g.format ?? "_unfiled"}
                firmId={firmId}
                isOperator={isOperator}
                group={g}
                periods={periods}
                onChanged={refresh}
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
  );
}

// ─── Review overview (whole-plan summary) ────────────────────────────────────

function daysUntil(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

function daysLabel(days: number): string {
  if (days === 0) return "publishes today";
  if (days < 0) return `${-days} day${-days === 1 ? "" : "s"} overdue`;
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function ReviewOverview({
  overview,
  isOperator,
  firmId,
  settings,
  onChanged,
  planReadiness,
}: {
  overview: PlanOverview;
  isOperator: boolean;
  firmId: string;
  settings: ContentPlanSettings | null;
  onChanged: () => void;
  planReadiness?: PlanReadinessProp;
}) {
  const [editing, setEditing] = useState(false);
  const { total, approved, pending, changes, draft, weeks, byFormat, nextPublish } = overview;
  if (total === 0) return null;
  const pct = Math.round((approved / total) * 100);
  const waiting = pending + changes;

  // Deadline: an operator-set "review by" wins; otherwise the soonest publish.
  const deadlineDate = settings?.review_by ?? nextPublish?.date ?? null;
  const deadlineLabel = settings?.review_by ? "Review by" : "Next to publish";
  const days = deadlineDate ? daysUntil(deadlineDate) : null;
  const urgency =
    days === null ? "text-navy" : days <= 0 ? "text-red-fail" : days <= 2 ? "text-amber-800" : "text-navy";

  const askLine =
    settings?.ask ??
    (isOperator
      ? "The firm reads each piece and approves it or asks for changes. You see the live queue state here."
      : "Read each piece and approve it, or ask for changes. Click any row to open the draft.");

  return (
    <div className="bg-white border border-border-brand p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-[color:var(--portal-accent)]">
            Review overview
          </p>
          <h2 className="text-lg font-bold text-navy mt-0.5">
            {waiting > 0
              ? `${waiting} piece${waiting === 1 ? "" : "s"} need your review`
              : "Everything is reviewed"}
          </h2>
          <p className="text-sm text-black/55 mt-0.5 max-w-xl whitespace-pre-line">{askLine}</p>
        </div>
        {deadlineDate && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-black/40">
              {deadlineLabel}
            </p>
            <p className={`text-sm font-semibold ${urgency}`}>{fmtDate(deadlineDate)}</p>
            {days !== null && <p className={`text-xs ${urgency}`}>{daysLabel(days)}</p>}
            {!settings?.review_by && nextPublish && (
              <p className="text-[11px] text-muted mt-0.5 max-w-[230px] truncate">
                {nextPublish.title}
              </p>
            )}
          </div>
        )}
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
          <OverviewCount n={approved} label="approved" cls="text-green-pass" />
          <OverviewCount n={pending} label="pending" cls="text-amber-800" />
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

      {planReadiness && (
        <PublicationReadinessSummary
          firmId={firmId}
          isOperator={isOperator}
          readiness={{ summary: planReadiness.summary, items: planReadiness.items }}
          titles={planReadiness.titles}
        />
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
  total,
  groups,
  periods,
  onChanged,
  periodReadiness,
}: {
  firmId: string;
  isOperator: boolean;
  period: ContentPeriod;
  approved: number;
  total: number;
  groups: ReturnType<typeof groupByFormat>;
  periods: ContentPeriod[];
  onChanged: () => void;
  periodReadiness?: PlanReadinessProp;
}) {
  const [editing, setEditing] = useState(false);
  const pct = total > 0 ? Math.round((approved / total) * 100) : 0;

  return (
    <section className="bg-white border border-border-brand">
      <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border-brand/60 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[color:var(--portal-accent)]">
            {fmtRange(period.starts_on, period.ends_on)}
          </p>
          {period.theme && (
            <h2 className="text-lg font-bold text-navy mt-1 leading-snug">{period.theme}</h2>
          )}
        </div>
        <div className="min-w-[170px]">
          <p className="text-xs text-black/55 text-right mb-1.5">
            <span className="font-semibold text-navy">{approved}</span> of {total} approved
          </p>
          <div className="h-1.5 rounded-full bg-parchment-2 overflow-hidden">
            <div className="h-full bg-green-pass rounded-full" style={{ width: `${pct}%` }} />
          </div>
          {isOperator && (
            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={() => setEditing((s) => !s)}
                className="text-[11px] font-semibold text-navy/70 hover:text-navy"
              >
                {editing ? "Close" : "Edit week"}
              </button>
            </div>
          )}
        </div>
      </div>

      {periodReadiness && (
        <div className="px-6 py-3 border-b border-border-brand/60">
          <PublicationReadinessSummary
            firmId={firmId}
            isOperator={isOperator}
            readiness={{ summary: periodReadiness.summary, items: periodReadiness.items }}
            titles={periodReadiness.titles}
            periodId={period.id}
          />
        </div>
      )}

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
      ) : (
        (period.details || period.rationale) && (
          <div className="px-6 py-4 border-b border-border-brand/60 space-y-2.5">
            {period.details && <MetaRow label="Details" value={period.details} />}
            {period.rationale && <MetaRow label="Why" value={period.rationale} />}
          </div>
        )
      )}

      <div className="px-3 py-3">
        {total === 0 ? (
          <p className="px-3 py-4 text-sm text-black/45">No pieces in this week yet.</p>
        ) : (
          groups.map((g) => (
            <FormatGroupBlock
              key={g.format ?? "_unfiled"}
              firmId={firmId}
              isOperator={isOperator}
              group={g}
              periods={periods}
              onChanged={onChanged}
            />
          ))
        )}
      </div>
    </section>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex-none w-14 text-[10px] uppercase tracking-[0.1em] font-semibold text-navy pt-0.5">
        {label}
      </span>
      <span className="flex-1 text-sm text-black/75 leading-relaxed">{value}</span>
    </div>
  );
}

// ─── Format group + rows ─────────────────────────────────────────────────────

function FormatGroupBlock({
  firmId,
  isOperator,
  group,
  periods,
  onChanged,
}: {
  firmId: string;
  isOperator: boolean;
  group: ReturnType<typeof groupByFormat>[number];
  periods: ContentPeriod[];
  onChanged: () => void;
}) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-2.5 px-3 pt-3 pb-1.5">
        <span className="text-[12px] font-bold uppercase tracking-[0.05em] text-navy">
          {group.format ?? "No format set"}
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
}: {
  firmId: string;
  isOperator: boolean;
  item: PlanDeliverable;
  periods: ContentPeriod[];
  onChanged: () => void;
}) {
  const [placing, setPlacing] = useState(false);
  const st = PLAN_STATUS[item.status];
  const dated = item.publish_date
    ? `${item.status === "approved" ? "Published" : "Publishes"} ${fmtDate(item.publish_date)}`
    : "No publish date set";

  return (
    <div>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded hover:bg-parchment-2/50 transition-colors">
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
          {item.status === "approved" ? "Open" : "Review"} &rarr;
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
              {fmtRange(p.starts_on, p.ends_on)}
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
  const [theme, setTheme] = useState(period?.theme ?? "");
  const [details, setDetails] = useState(period?.details ?? "");
  const [rationale, setRationale] = useState(period?.rationale ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!startsOn || !endsOn) {
      setError("Set the start and end dates.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      starts_on: startsOn,
      ends_on: endsOn,
      theme: theme.trim() || null,
      details: details.trim() || null,
      rationale: rationale.trim() || null,
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
      <div>
        <label className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1">
          Details
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          placeholder="The topics and angles this week covers."
          className="w-full text-sm border border-border-brand px-3 py-2 bg-white resize-y"
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider font-semibold text-navy mb-1">
          Why{" "}
          <span className="text-black/40 normal-case font-normal">
            (brand relevance + search intent)
          </span>
        </label>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={3}
          placeholder="The strategic reason these pieces were chosen this week."
          className="w-full text-sm border border-border-brand px-3 py-2 bg-white resize-y"
        />
      </div>
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
