/**
 * /admin/screen-metrics
 *
 * Operator-facing measurement dashboard for CaseLoad Screen 2.0 (qualification
 * audit item 10, 2026-07-02). No new tables: every metric here is computed
 * from screened_leads + unconfirmed_inquiries columns that already exist.
 *
 * Metrics: band distribution, take/pass/refer/declined by band, thin-brief
 * rate (share of scored rows at low confidence), inferred-classification
 * rate, missing-critical-fact rate, contact-capture rate, channel mix +
 * per-channel Band A/B rate + avg questions asked (surfaces the audit's
 * web-vs-voice completeness gap directly), source (UTM) quality, and
 * average lawyer response time.
 *
 * Archived rows are excluded by default: the 2026-07-02 audit archived 26
 * operator smoke-test rows precisely so this dashboard would not be built
 * on top of test data. ?firm_id=<uuid> narrows to one firm (reuses the
 * FirmFilter component already used on /admin/triage and /admin/routing).
 *
 * Auth: getOperatorSession() in the parent /admin/layout.tsx.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { computeScreenMetrics, type MetricsRow, type Band, type Status } from "@/lib/screen-metrics-pure";
import { channelLabel } from "@/lib/channel-labels";
import FirmFilter from "@/components/admin/FirmFilter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NOT_AVAILABLE = "N/A";

interface RawRow {
  band: Band;
  status: Status;
  matter_type: string;
  slot_answers: { channel?: string; questionHistory?: unknown[] } | null;
  score_confidence: string | null;
  score_completeness: number | string | null;
  score_missing_fields: unknown;
  brief_json: { matter_type_provenance?: string } | null;
  utm_source: string | null;
  submitted_at: string;
  status_changed_at: string | null;
}

function toMetricsRow(r: RawRow): MetricsRow {
  const missingFields = Array.isArray(r.score_missing_fields) ? r.score_missing_fields : [];
  const questionHistory = Array.isArray(r.slot_answers?.questionHistory)
    ? r.slot_answers!.questionHistory!
    : [];
  return {
    band: r.band,
    status: r.status,
    matter_type: r.matter_type,
    channel: r.slot_answers?.channel ?? null,
    score_confidence: r.score_confidence,
    score_completeness:
      r.score_completeness !== null && r.score_completeness !== undefined
        ? Number(r.score_completeness)
        : null,
    matter_type_provenance: r.brief_json?.matter_type_provenance ?? null,
    missing_field_count: missingFields.length,
    utm_source: r.utm_source,
    submitted_at: r.submitted_at,
    status_changed_at: r.status_changed_at,
    question_count: questionHistory.length,
  };
}

export default async function ScreenMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ firm_id?: string }>;
}) {
  const { firm_id: firmIdRaw } = await searchParams;

  let leadsQuery = supabase
    .from("screened_leads")
    .select(`
      band, status, matter_type, slot_answers, score_confidence,
      score_completeness, score_missing_fields, brief_json, utm_source,
      submitted_at, status_changed_at
    `)
    .eq("archived", false);
  if (firmIdRaw) leadsQuery = leadsQuery.eq("firm_id", firmIdRaw);

  let unconfirmedQuery = supabase
    .from("unconfirmed_inquiries")
    .select("id", { count: "exact", head: true });
  if (firmIdRaw) unconfirmedQuery = unconfirmedQuery.eq("firm_id", firmIdRaw);

  const [{ data: leadRows, error: leadsError }, { count: unconfirmedCount }] =
    await Promise.all([leadsQuery, unconfirmedQuery]);

  if (leadsError) {
    return <ErrorState message={`Could not load screen metrics: ${leadsError.message}`} />;
  }

  const { data: firms } = await supabase
    .from("intake_firms")
    .select("id, name, branding")
    .order("name", { ascending: true });

  const metrics = computeScreenMetrics(
    (leadRows ?? []).map((r) => toMetricsRow(r as RawRow)),
    unconfirmedCount ?? 0,
  );

  return (
    <div className="space-y-6">
      <Header firmIdRaw={firmIdRaw ?? null} totalLeads={metrics.totalLeads} />
      <FirmFilter
        action="/admin/screen-metrics"
        firms={(firms ?? []).map((f) => ({
          id: f.id as string,
          name: ((f.branding as { firm_name?: string } | null)?.firm_name ?? f.name ?? "Unknown firm") as string,
        }))}
        active={firmIdRaw ?? null}
      />

      {metrics.totalLeads === 0 ? (
        <EmptyState />
      ) : (
        <>
          <TopLineCards metrics={metrics} />
          <BandSection metrics={metrics} />
          <QualitySection metrics={metrics} />
          <ChannelSection metrics={metrics} />
          <SourceSection metrics={metrics} />
        </>
      )}
    </div>
  );
}

function Header({ firmIdRaw, totalLeads }: { firmIdRaw: string | null; totalLeads: number }) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Screen metrics</h1>
        <p className="text-xs text-black/50 mt-1">
          {firmIdRaw ? "Filtered to one firm" : "All firms"}, archived (smoke-test) rows excluded
        </p>
      </div>
      <div className="text-xs text-black/50 uppercase tracking-wider">
        {totalLeads} lead{totalLeads === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function pct(n: number | null): string {
  if (n === null) return NOT_AVAILABLE;
  return `${Math.round(n * 100)}%`;
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-black/10 px-4 py-4">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-black/40">{label}</div>
      <div className="mt-1 text-2xl font-display font-bold text-navy">{value}</div>
      {sub && <div className="mt-1 text-xs text-black/50">{sub}</div>}
    </div>
  );
}

function TopLineCards({ metrics }: { metrics: import("@/lib/screen-metrics-pure").ScreenMetrics }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card
        label="Contact-capture rate"
        value={pct(metrics.contactCaptureRate)}
        sub={`${metrics.totalLeads} captured, ${metrics.unconfirmedCount} rejected at the gate`}
      />
      <Card
        label="Thin-brief rate"
        value={pct(metrics.thinBriefRate)}
        sub={metrics.thinBriefScoredCount > 0 ? `of ${metrics.thinBriefScoredCount} scored leads` : "no scored leads yet"}
      />
      <Card
        label="Inferred classification"
        value={pct(metrics.inferredClassificationRate)}
        sub={metrics.provenanceTaggedCount > 0 ? `of ${metrics.provenanceTaggedCount} provenance-tagged leads` : "pre-DR-069 data"}
      />
      <Card
        label="Avg lawyer response"
        value={metrics.avgResponseHours !== null ? `${metrics.avgResponseHours.toFixed(1)}h` : NOT_AVAILABLE}
        sub={metrics.decidedCount > 0 ? `over ${metrics.decidedCount} decided leads` : "no decisions yet"}
      />
    </div>
  );
}

const BAND_ORDER = ["A", "B", "C", "D", "unrated"] as const;
const STATUS_ORDER: Status[] = ["taken", "passed", "referred", "declined", "triaging"];

function BandSection({ metrics }: { metrics: import("@/lib/screen-metrics-pure").ScreenMetrics }) {
  return (
    <section className="bg-white border border-black/10 px-5 py-5">
      <h2 className="text-sm font-bold text-navy uppercase tracking-wider mb-4">
        Band distribution and lawyer action
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-black/40 border-b border-black/10">
              <th className="py-2 pr-4">Band</th>
              <th className="py-2 pr-4">Count</th>
              {STATUS_ORDER.map((s) => (
                <th key={s} className="py-2 pr-4 capitalize">{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BAND_ORDER.map((band) => {
              const count = metrics.bandDistribution[band];
              if (count === 0) return null;
              return (
                <tr key={band} className="border-b border-black/5 last:border-0">
                  <td className="py-2 pr-4 font-bold">{band === "unrated" ? NOT_AVAILABLE : band}</td>
                  <td className="py-2 pr-4 font-mono">{count}</td>
                  {STATUS_ORDER.map((s) => (
                    <td key={s} className="py-2 pr-4 font-mono text-black/70">
                      {metrics.actionByBand[band][s]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QualitySection({ metrics }: { metrics: import("@/lib/screen-metrics-pure").ScreenMetrics }) {
  return (
    <section className="bg-white border border-black/10 px-5 py-5">
      <h2 className="text-sm font-bold text-navy uppercase tracking-wider mb-4">Brief quality</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card label="Thin-brief rate" value={pct(metrics.thinBriefRate)} sub="score_confidence = low" />
        <Card
          label="Missing critical fact"
          value={pct(metrics.missingCriticalFactRate)}
          sub="rows with 1+ missing scored field"
        />
        <Card
          label="Inferred classification"
          value={pct(metrics.inferredClassificationRate)}
          sub="matter_type_provenance = llm_inferred"
        />
      </div>
    </section>
  );
}

function ChannelSection({ metrics }: { metrics: import("@/lib/screen-metrics-pure").ScreenMetrics }) {
  return (
    <section className="bg-white border border-black/10 px-5 py-5">
      <h2 className="text-sm font-bold text-navy uppercase tracking-wider mb-1">Channel quality</h2>
      <p className="text-xs text-black/50 mb-4">
        Avg questions asked is meaningful on web and Meta channels (Messenger, Instagram, WhatsApp).
        Voice stays at 0 structurally: the current voice path is a single-pass post-call transcript
        analysis, not a live turn-by-turn conversation through this engine.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-black/40 border-b border-black/10">
              <th className="py-2 pr-4">Channel</th>
              <th className="py-2 pr-4">Leads</th>
              <th className="py-2 pr-4">Band A/B rate</th>
              <th className="py-2 pr-4">Avg questions asked</th>
            </tr>
          </thead>
          <tbody>
            {metrics.channelMix.map((c) => (
              <tr key={c.channel} className="border-b border-black/5 last:border-0">
                <td className="py-2 pr-4">{channelLabel(c.channel)}</td>
                <td className="py-2 pr-4 font-mono">{c.count}</td>
                <td className="py-2 pr-4 font-mono">{pct(c.bandARate)}</td>
                <td className="py-2 pr-4 font-mono">
                  {c.avgQuestionsAsked !== null ? c.avgQuestionsAsked.toFixed(1) : NOT_AVAILABLE}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SourceSection({ metrics }: { metrics: import("@/lib/screen-metrics-pure").ScreenMetrics }) {
  return (
    <section className="bg-white border border-black/10 px-5 py-5">
      <h2 className="text-sm font-bold text-navy uppercase tracking-wider mb-1">Source quality</h2>
      <p className="text-xs text-black/50 mb-4">
        Grouped by utm_source. &quot;none&quot; means the lead arrived with no UTM params (direct,
        organic, or a channel that does not pass them through).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-black/40 border-b border-black/10">
              <th className="py-2 pr-4">Source</th>
              <th className="py-2 pr-4">Leads</th>
              <th className="py-2 pr-4">Band A/B rate</th>
            </tr>
          </thead>
          <tbody>
            {metrics.sourceQuality.map((s) => (
              <tr key={s.source} className="border-b border-black/5 last:border-0">
                <td className="py-2 pr-4">{s.source}</td>
                <td className="py-2 pr-4 font-mono">{s.count}</td>
                <td className="py-2 pr-4 font-mono">{pct(s.bandABRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-black/8 px-6 py-10 text-center">
      <p className="text-sm text-black/60">No leads in this scope yet.</p>
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
