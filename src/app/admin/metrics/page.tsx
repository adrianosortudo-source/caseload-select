import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchGA4Metrics, isGA4Available, type GA4Report, type GA4TopEntry } from "@/lib/google-analytics";
import { fetchVercelProjectStatus, isVercelAvailable, type VercelProjectStatus } from "@/lib/vercel-analytics-api";
import FirmFilter from "@/components/admin/FirmFilter";

export const dynamic = "force-dynamic";

interface FirmRow {
  id: string;
  name: string;
  ga4_property_id: string | null;
  vercel_project_id: string | null;
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const firmId = typeof sp.firm_id === "string" ? sp.firm_id : null;

  const { data: firms } = await supabaseAdmin
    .from("intake_firms")
    .select("id, name, ga4_property_id, vercel_project_id")
    .order("name");

  const firmList = (firms ?? []) as FirmRow[];
  const selected = firmId ? firmList.find((f) => f.id === firmId) : firmList[0];

  const [ga4, vercel] = await Promise.all([
    selected?.ga4_property_id
      ? fetchGA4Metrics(selected.ga4_property_id)
      : Promise.resolve(null),
    selected?.vercel_project_id
      ? fetchVercelProjectStatus(selected.vercel_project_id)
      : Promise.resolve(null),
  ]);

  const ga4Link = selected?.ga4_property_id
    ? `https://analytics.google.com/analytics/web/#/p${selected.ga4_property_id}/reports/`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
          <h1 className="text-2xl font-bold text-navy mt-1">Website metrics</h1>
        </div>
        <FirmFilter
          action="/admin/metrics"
          firms={firmList.map((f) => ({ id: f.id, name: f.name }))}
          active={selected?.id ?? null}
        />
      </div>

      {!selected && (
        <EmptyState>No firms configured. Add a firm via Portal access first.</EmptyState>
      )}

      {selected && (
        <>
          <GA4Panel report={ga4} deepLink={ga4Link} propertyId={selected.ga4_property_id} />
          <VercelPanel status={vercel} projectId={selected.vercel_project_id} />
        </>
      )}

      <p className="text-xs text-black/40 mt-4">
        Server-rendered on each load. GA4 data covers the last 7 days with week-over-week delta. Vercel shows the latest production deployment.
      </p>
    </div>
  );
}

// ─── GA4 ────────────────────────────────────────────────────────────────────

function GA4Panel({
  report,
  deepLink,
  propertyId,
}: {
  report: GA4Report | null;
  deepLink: string | null;
  propertyId: string | null;
}) {
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
        <EmptyState>
          Set <code className="text-[11px] font-mono bg-black/5 px-1">GOOGLE_SERVICE_ACCOUNT_KEY</code> (base64-encoded
          service account JSON) on Vercel to enable GA4 data.
        </EmptyState>
      </Panel>
    );
  }

  if (!report || !report.configured) {
    return (
      <Panel title="Website traffic (GA4)" subtitle="Auth failed">
        <EmptyState>
          GA4 property configured but auth failed. Verify the service account has Viewer access on property {propertyId}.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title="Website traffic (GA4)"
      subtitle={
        deepLink ? (
          <a href={deepLink} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline">
            Open in Google Analytics &rarr;
          </a>
        ) : (
          "Last 7 days"
        )
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Sessions" value={fmt(report.sessions.value)} delta={report.sessions.delta} />
        <MetricCard label="Users" value={fmt(report.users.value)} delta={report.users.delta} />
        <MetricCard label="Pageviews" value={fmt(report.pageviews.value)} delta={report.pageviews.delta} />
        <MetricCard
          label="Engagement"
          value={`${(report.engagementRate.value * 100).toFixed(1)}%`}
          delta={report.engagementRate.delta}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        <TopList title="Top pages" items={report.topPages} labelKey="label" valueLabel="Views" />
        <TopList title="Top sources" items={report.topSources} labelKey="label" valueLabel="Sessions" />
      </div>
    </Panel>
  );
}

// ─── Vercel ─────────────────────────────────────────────────────────────────

function VercelPanel({
  status,
  projectId,
}: {
  status: VercelProjectStatus | null;
  projectId: string | null;
}) {
  if (!projectId) {
    return (
      <Panel title="Deployment status (Vercel)" subtitle="Not configured">
        <EmptyState>
          Set <code className="text-[11px] font-mono bg-black/5 px-1">vercel_project_id</code> on this
          firm&apos;s <code className="text-[11px] font-mono bg-black/5 px-1">intake_firms</code> row
          to connect Vercel.
        </EmptyState>
      </Panel>
    );
  }

  if (!isVercelAvailable()) {
    return (
      <Panel title="Deployment status (Vercel)" subtitle="Token missing">
        <EmptyState>
          <code className="text-[11px] font-mono bg-black/5 px-1">VERCEL_API_TOKEN</code> is not set.
        </EmptyState>
      </Panel>
    );
  }

  if (!status || !status.configured) {
    return (
      <Panel title="Deployment status (Vercel)" subtitle="Unavailable">
        <EmptyState>Could not fetch deployment data. Check the project ID and token.</EmptyState>
      </Panel>
    );
  }

  const deploy = status.latestDeploy;

  return (
    <Panel
      title={`Deployment status${status.projectName ? ` (${status.projectName})` : ""}`}
      subtitle={
        <span className="flex items-center gap-3">
          {status.deepLinks.analytics && (
            <a href={status.deepLinks.analytics} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline">
              Analytics &rarr;
            </a>
          )}
          {status.deepLinks.speedInsights && (
            <a href={status.deepLinks.speedInsights} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline">
              Speed Insights &rarr;
            </a>
          )}
          {status.deepLinks.deployments && (
            <a href={status.deepLinks.deployments} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline">
              Deployments &rarr;
            </a>
          )}
        </span>
      }
    >
      {deploy ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DlItem label="Status" value={deploy.state} tone={deploy.state === "READY" ? "emerald" : "amber"} />
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

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-black/8 p-4 sm:p-5 space-y-4">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold text-navy uppercase tracking-wider">{title}</h2>
        {subtitle && <span className="text-xs text-black/50">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number | null;
}) {
  return (
    <div className="border border-black/8 bg-parchment px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-black/50">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-navy mt-0.5">{value}</div>
      {delta !== null && (
        <div className={`text-xs font-semibold mt-1 ${delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
          {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}% vs prior week
        </div>
      )}
    </div>
  );
}

function TopList({
  title,
  items,
  labelKey,
  valueLabel,
}: {
  title: string;
  items: GA4TopEntry[];
  labelKey: "label";
  valueLabel: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider font-semibold text-black/50 mb-2">{title}</h3>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-black/70 min-w-0">{item[labelKey]}</span>
            <span className="font-mono text-black/60 tabular-nums shrink-0">
              {fmt(item.value)} {valueLabel.toLowerCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DlItem({
  label,
  value,
  mono,
  wrap,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
  tone?: "emerald" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-black/70";
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider font-semibold text-black/50">{label}</dt>
      <dd className={`${mono ? "font-mono text-[11px]" : "text-xs"} ${toneClass} mt-0.5 ${wrap ? "break-all" : "truncate"}`}>
        {value}
      </dd>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-black/15 px-6 py-8 text-center text-sm text-black/50">
      {children}
    </div>
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
