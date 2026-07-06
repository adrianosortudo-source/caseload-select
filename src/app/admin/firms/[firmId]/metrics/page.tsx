/**
 * /admin/firms/[firmId]/metrics
 *
 * Firm-scoped website + intake metrics. firmId from URL segment. Auth
 * enforced by /admin/layout.tsx.
 */

import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchGA4Metrics, isGA4Available, type GA4Report, type GA4TopEntry } from "@/lib/google-analytics";
import { fetchVercelProjectStatus, isVercelAvailable, type VercelProjectStatus } from "@/lib/vercel-analytics-api";
import { fetchIntakeFunnel, type IntakeFunnelReport, type TopEntry } from "@/lib/intake-funnel";

export const dynamic = "force-dynamic";

interface FirmRow {
  id: string;
  name: string;
  ga4_property_id: string | null;
  vercel_project_id: string | null;
}

export default async function FirmMetricsPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const { data: firmData } = await supabaseAdmin
    .from("intake_firms")
    .select("id, name, ga4_property_id, vercel_project_id")
    .eq("id", firmId)
    .maybeSingle();

  const firm = firmData as FirmRow | null;

  const [ga4, vercel, funnel] = await Promise.all([
    firm?.ga4_property_id ? fetchGA4Metrics(firm.ga4_property_id) : Promise.resolve(null),
    firm?.vercel_project_id ? fetchVercelProjectStatus(firm.vercel_project_id) : Promise.resolve(null),
    firm ? fetchIntakeFunnel(firm.id) : Promise.resolve(null),
  ]);

  const ga4Link = firm?.ga4_property_id
    ? `https://analytics.google.com/analytics/web/#/p${firm.ga4_property_id}/reports/`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Website metrics</h1>
        {firm && <p className="mt-1 text-sm text-black/60">{firm.name}</p>}
      </div>

      {!firm && (
        <EmptyState>Firm not found.</EmptyState>
      )}

      {firm && (
        <>
          <GA4Panel report={ga4} deepLink={ga4Link} propertyId={firm.ga4_property_id} />
          <FunnelPanel report={funnel} />
          <VercelPanel status={vercel} projectId={firm.vercel_project_id} />
        </>
      )}

      <p className="text-xs text-black/40 mt-4">
        Server-rendered on each load. GA4 and intake funnel cover the last 7 days with week-over-week delta.
      </p>
    </div>
  );
}

// ─── GA4 ────────────────────────────────────────────────────────────────────

function GA4Panel({ report, deepLink, propertyId }: { report: GA4Report | null; deepLink: string | null; propertyId: string | null }) {
  if (!propertyId) {
    return (
      <Panel title="Website traffic (GA4)" subtitle="Not configured">
        <EmptyState>
          Set <code className="text-[11px] font-mono bg-black/5 px-1">ga4_property_id</code> on this
          firm&apos;s <code className="text-[11px] font-mono bg-black/5 px-1">intake_firms</code> row
          to connect Google Analytics.
        </EmptyState>
      </Panel>
    );
  }
  if (!isGA4Available()) {
    return (
      <Panel title="Website traffic (GA4)" subtitle="Service account missing">
        <EmptyState>Set <code className="text-[11px] font-mono bg-black/5 px-1">GOOGLE_SERVICE_ACCOUNT_KEY</code> on Vercel to enable GA4 data.</EmptyState>
      </Panel>
    );
  }
  if (!report || !report.configured) {
    return (
      <Panel title="Website traffic (GA4)" subtitle="Auth failed">
        <EmptyState>GA4 property configured but auth failed. Verify the service account has Viewer access on property {propertyId}.</EmptyState>
      </Panel>
    );
  }
  return (
    <Panel
      title="Website traffic (GA4)"
      subtitle={
        <span className="inline-flex items-center gap-2">
          <span>Last 7 days</span>
          {deepLink && (
            <>
              <span aria-hidden>&middot;</span>
              <a href={deepLink} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline">
                Open in Google Analytics &rarr;
              </a>
            </>
          )}
        </span>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Sessions" value={fmt(report.sessions.value)} delta={report.sessions.delta} />
        <MetricCard label="Users" value={fmt(report.users.value)} delta={report.users.delta} />
        <MetricCard label="Pageviews" value={fmt(report.pageviews.value)} delta={report.pageviews.delta} />
        <MetricCard label="Engagement" value={`${(report.engagementRate.value * 100).toFixed(1)}%`} delta={report.engagementRate.delta} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        <TopList title="Top pages" items={report.topPages} labelKey="label" valueLabel="Views" />
        <TopList title="Top sources" items={report.topSources} labelKey="label" valueLabel="Sessions" />
      </div>
    </Panel>
  );
}

// ─── Intake funnel ─────────────────────────────────────────────────────────

const BAND_COLORS: Record<string, string> = {
  A: "bg-gold",
  B: "bg-navy",
  C: "bg-muted",
  D: "bg-field-label",
  unscored: "bg-black/20",
};

function FunnelPanel({ report }: { report: IntakeFunnelReport | null }) {
  if (!report) {
    return (
      <Panel title="Intake funnel" subtitle="Last 7 days"><EmptyState>No intake data available.</EmptyState></Panel>
    );
  }
  const total = report.bands.reduce((s, b) => s + b.count, 0);
  return (
    <Panel title="Intake funnel" subtitle="Last 7 days">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Screened leads" value={fmt(report.totalLeads.value)} delta={report.totalLeads.delta} />
        <MetricCard label="Taken" value={fmt(report.taken.value)} delta={report.taken.delta} />
        <MetricCard label="Passed" value={fmt(report.passed.value)} delta={report.passed.delta} />
        <MetricCard label="Take rate" value={`${(report.takeRate.value * 100).toFixed(0)}%`} delta={report.takeRate.delta} />
      </div>
      {total > 0 && (
        <div className="mt-4">
          <h3 className="text-[10px] uppercase tracking-wider font-semibold text-black/50 mb-2">Band distribution</h3>
          <div className="flex h-6 w-full overflow-hidden">
            {report.bands.map((b) => (
              <div key={b.band} className={`${BAND_COLORS[b.band] ?? "bg-black/20"} relative group`} style={{ width: `${(b.count / total) * 100}%` }} title={`Band ${b.band}: ${b.count}`}>
                {b.count / total > 0.08 && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">{b.band}</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-1.5 flex-wrap">
            {report.bands.map((b) => (
              <span key={b.band} className="text-[10px] text-black/50">
                <span className={`inline-block w-2 h-2 mr-0.5 align-middle ${BAND_COLORS[b.band] ?? "bg-black/20"}`} />
                {b.band}: {b.count} ({((b.count / total) * 100).toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        <CountList title="Top practice areas" items={report.topPracticeAreas} />
        <CountList title="Top matter types" items={report.topMatterTypes} />
      </div>
      {(report.mattersCreated.value > 0 || report.mattersByStage.length > 0) && (
        <div className="mt-4 border-t border-black/8 pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard label="Matters created" value={fmt(report.mattersCreated.value)} delta={report.mattersCreated.delta} />
          </div>
          {report.mattersByStage.length > 0 && (
            <div className="mt-3">
              <h3 className="text-[10px] uppercase tracking-wider font-semibold text-black/50 mb-2">Open matters by stage</h3>
              <div className="flex gap-3 flex-wrap">
                {report.mattersByStage.map((s) => (
                  <span key={s.stage} className="inline-flex items-center gap-1 bg-parchment border border-black/8 px-2.5 py-1 text-xs">
                    <span className="font-semibold text-navy">{s.count}</span>
                    <span className="text-black/50">{s.stage.replace(/_/g, " ")}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function CountList({ title, items }: { title: string; items: TopEntry[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider font-semibold text-black/50 mb-2">{title}</h3>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-black/70 min-w-0">{item.label.replace(/_/g, " ")}</span>
            <span className="font-mono text-black/60 tabular-nums shrink-0">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Vercel ─────────────────────────────────────────────────────────────────

function VercelPanel({ status, projectId }: { status: VercelProjectStatus | null; projectId: string | null }) {
  if (!projectId) {
    return (
      <Panel title="Deployment status (Vercel)" subtitle="Not configured">
        <EmptyState>Set <code className="text-[11px] font-mono bg-black/5 px-1">vercel_project_id</code> on this firm&apos;s row to connect Vercel.</EmptyState>
      </Panel>
    );
  }
  if (!isVercelAvailable()) {
    return (
      <Panel title="Deployment status (Vercel)" subtitle="Token missing">
        <EmptyState><code className="text-[11px] font-mono bg-black/5 px-1">VERCEL_API_TOKEN</code> is not set.</EmptyState>
      </Panel>
    );
  }
  if (!status || !status.configured) {
    return (
      <Panel title="Deployment status (Vercel)" subtitle="Unavailable">
        <EmptyState>Could not fetch deployment data.</EmptyState>
      </Panel>
    );
  }
  const deploy = status.latestDeploy;
  return (
    <Panel
      title={`Deployment status${status.projectName ? ` (${status.projectName})` : ""}`}
      subtitle={
        <span className="flex items-center gap-3">
          {status.deepLinks.analytics && <a href={status.deepLinks.analytics} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline">Analytics &rarr;</a>}
          {status.deepLinks.speedInsights && <a href={status.deepLinks.speedInsights} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline">Speed Insights &rarr;</a>}
          {status.deepLinks.deployments && <a href={status.deepLinks.deployments} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline">Deployments &rarr;</a>}
        </span>
      }
    >
      {deploy ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DlItem label="Status" value={deploy.state} tone={deploy.state === "READY" ? "green" : "amber"} />
          <DlItem label="URL" value={deploy.url} mono wrap />
          <DlItem label="Created" value={formatTime(deploy.created)} />
          <DlItem label="Ready" value={deploy.readyAt ? formatTime(deploy.readyAt) : "Pending"} />
        </div>
      ) : (
        <EmptyState>No production deployments found.</EmptyState>
      )}
    </Panel>
  );
}

// ─── Shared UI ──────────────────────────────────────────────────────────────

function Panel({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-border-brand p-4 sm:p-5 space-y-4">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold text-navy uppercase tracking-wider">{title}</h2>
        {subtitle && <span className="text-xs text-black/50">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

function MetricCard({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  return (
    <div className="border border-border-brand bg-parchment px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-black/50">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-navy mt-0.5">{value}</div>
      {delta !== null && (
        <div className={`text-xs font-semibold mt-1 ${delta >= 0 ? "text-green-pass" : "text-red-fail"}`}>
          {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}% vs prior week
        </div>
      )}
    </div>
  );
}

function TopList({ title, items, labelKey, valueLabel }: { title: string; items: GA4TopEntry[]; labelKey: "label"; valueLabel: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider font-semibold text-black/50 mb-2">{title}</h3>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-black/70 min-w-0">{item[labelKey]}</span>
            <span className="font-mono text-black/60 tabular-nums shrink-0">{fmt(item.value)} {valueLabel.toLowerCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DlItem({ label, value, mono, wrap, tone }: { label: string; value: string; mono?: boolean; wrap?: boolean; tone?: "green" | "amber" }) {
  const toneClass = tone === "green" ? "text-green-pass" : tone === "amber" ? "text-amber-700" : "text-black/70";
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider font-semibold text-black/50">{label}</dt>
      <dd className={`${mono ? "font-mono text-[11px]" : "text-xs"} ${toneClass} mt-0.5 ${wrap ? "break-all" : "truncate"}`}>{value}</dd>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-black/15 px-6 py-8 text-center text-sm text-black/50">{children}</div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-CA");
}

function formatTime(iso: string | null): string {
  if (!iso) return "n/a";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "n/a";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
