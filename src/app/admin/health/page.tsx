/**
 * /admin/health
 *
 * Operator-only system health page. Surfaces four signals the operator wants
 * at a glance:
 *
 *   1. pg_cron jobs        - last run, 24h success rate, paired pg_net response
 *   2. Webhook outbox      - pending vs failed counts, recent failure
 *   3. Deploy info         - commit SHA, deploy URL, environment from Vercel env
 *   4. Env vars + intake   - presence checks for required keys + screened_leads activity
 *
 * Cron data comes from public.get_cron_health() (SECURITY DEFINER, joins
 * cron.job + cron.job_run_details + net._http_response).
 *
 * Auth: /admin/layout.tsx already gates this route with getOperatorSession().
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface CronJobHealth {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  command: string;
  last_run_start: string | null;
  last_run_end: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
  last_run_runid: number | null;
  last_http_status: number | null;
  last_http_error: string | null;
  last_http_timed_out: boolean | null;
  last_http_created: string | null;
  runs_24h: number;
  succeeded_24h: number;
  failed_24h: number;
}

interface OutboxCounts {
  pending: number;
  sent: number;
  failed: number;
}

interface IntakeActivity {
  total: number;
  last_24h: number;
  last_lead_at: string | null;
}

interface RecentOutboxFailure {
  id: string;
  firm_id: string;
  lead_id: string;
  action: string;
  last_error: string | null;
  last_http_status: number | null;
  failed_at: string | null;
  updated_at: string;
  attempts: number;
}

const REQUIRED_ENV_VARS = [
  // Supabase
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  // Auth + cron tokens
  "PORTAL_SECRET",
  "CRON_SECRET",
  // App config
  "NEXT_PUBLIC_APP_DOMAIN",
  // Gemini (engine)
  "GEMINI_API_KEY",
  // Resend (transactional email)
  "RESEND_API_KEY",
  // Meta (webhooks — added 2026-05-13 in Block 1)
  "META_APP_SECRET",
  "META_MESSENGER_VERIFY_TOKEN",
  "META_INSTAGRAM_VERIFY_TOKEN",
] as const;

export default async function AdminHealthPage() {
  // Fetch all health signals in parallel
  const [cron, outboxCounts, outboxFailures, intake] = await Promise.all([
    fetchCronHealth(),
    fetchOutboxCounts(),
    fetchRecentOutboxFailures(),
    fetchIntakeActivity(),
  ]);

  const deploy = {
    commit_sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    commit_message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    deploy_url: process.env.VERCEL_URL ?? null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
  };

  const envChecks = REQUIRED_ENV_VARS.map((name) => ({
    name,
    present: !!process.env[name],
  }));

  return (
    <div className="space-y-6">
      <Header />

      {/* Cron jobs */}
      <Panel title="Scheduled jobs (pg_cron)" subtitle={`${cron.length} active`}>
        {cron.length === 0 ? (
          <EmptyState>No scheduled jobs registered.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {cron.map((job) => (
              <CronCard key={job.jobid} job={job} />
            ))}
          </div>
        )}
      </Panel>

      {/* Webhook outbox */}
      <Panel
        title="Webhook outbox"
        subtitle={
          <Link href="/admin/webhook-outbox" className="text-navy hover:underline">
            Open full log →
          </Link>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <CountTile label="Pending" value={outboxCounts.pending} colour="amber" />
          <CountTile label="Sent" value={outboxCounts.sent} colour="emerald" />
          <CountTile label="Failed" value={outboxCounts.failed} colour="red" />
        </div>
        {outboxFailures.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-xs uppercase tracking-wider font-semibold text-black/50">
              Most recent failures
            </div>
            <div className="bg-parchment-2 border border-red-200 divide-y divide-red-100">
              {outboxFailures.map((f) => (
                <div key={f.id} className="px-3 py-2 text-xs">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <Link
                      href={`/portal/${f.firm_id}/triage/${f.lead_id}`}
                      className="font-mono text-navy hover:underline"
                    >
                      {f.lead_id.slice(0, 8)}…
                    </Link>
                    <span className="text-[10px] uppercase tracking-wider text-black/50">
                      {f.action} · attempt {f.attempts}
                    </span>
                    <span className="text-[10px] tabular-nums text-black/40">
                      {formatTime(f.failed_at ?? f.updated_at)}
                    </span>
                  </div>
                  {f.last_error && (
                    <p className="mt-1 text-black/70 break-words">
                      {f.last_http_status ? (
                        <span className="font-mono text-[10px] text-red-700 mr-2">[{f.last_http_status}]</span>
                      ) : null}
                      {f.last_error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* Deploy info */}
      <Panel title="Production deploy">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <DlItem
            label="Environment"
            value={deploy.environment}
            mono={false}
            tone={deploy.environment === "production" ? "emerald" : "amber"}
          />
          <DlItem
            label="Branch"
            value={deploy.branch ?? "—"}
            mono
          />
          <DlItem
            label="Commit"
            value={deploy.commit_sha ?? "—"}
            mono
          />
          <DlItem
            label="Deploy URL"
            value={deploy.deploy_url ? `https://${deploy.deploy_url}` : "—"}
            mono
            wrap
          />
          {deploy.commit_message && (
            <div className="sm:col-span-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-black/50">
                Latest commit
              </div>
              <p className="text-black/70 mt-0.5 break-words">{deploy.commit_message.split("\n")[0]}</p>
            </div>
          )}
        </dl>
      </Panel>

      {/* Env vars + intake activity */}
      <Panel title="Runtime checks">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-black/50 mb-2">
              Required env vars
            </div>
            <ul className="space-y-1">
              {envChecks.map((e) => (
                <li key={e.name} className="flex items-center gap-2 text-xs">
                  {e.present ? (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 font-bold">
                      ✓
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-100 text-red-700 font-bold">
                      ✗
                    </span>
                  )}
                  <code className="text-[11px] text-black/70">{e.name}</code>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-black/40">
              Values not displayed. Add missing keys in Vercel Project Settings → Environment Variables.
            </p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-black/50 mb-2">
              Intake activity (screened_leads)
            </div>
            <dl className="space-y-2">
              <div className="flex items-baseline justify-between">
                <dt className="text-xs text-black/60">Total all-time</dt>
                <dd className="text-lg font-bold text-navy tabular-nums">{intake.total}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-xs text-black/60">Last 24 hours</dt>
                <dd className="text-lg font-bold text-navy tabular-nums">{intake.last_24h}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-xs text-black/60">Most recent lead</dt>
                <dd className="text-xs text-black/70 tabular-nums">
                  {intake.last_lead_at ? formatTime(intake.last_lead_at) : "—"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </Panel>

      <p className="text-xs text-black/40">
        Server-rendered on each load. Cron data joins <code>cron.job</code> + <code>cron.job_run_details</code> + <code>net._http_response</code> via <code>public.get_cron_health()</code>.
      </p>
    </div>
  );
}

// ─── Data fetchers ──────────────────────────────────────────────────────────

async function fetchCronHealth(): Promise<CronJobHealth[]> {
  const { data, error } = await supabase.rpc("get_cron_health");
  if (error || !Array.isArray(data)) return [];
  return data as CronJobHealth[];
}

async function fetchOutboxCounts(): Promise<OutboxCounts> {
  const [pending, sent, failed] = await Promise.all([
    countOutbox("pending"),
    countOutbox("sent"),
    countOutbox("failed"),
  ]);
  return { pending, sent, failed };
}

async function countOutbox(status: "pending" | "sent" | "failed"): Promise<number> {
  const { count, error } = await supabase
    .from("webhook_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) return 0;
  return count ?? 0;
}

async function fetchRecentOutboxFailures(): Promise<RecentOutboxFailure[]> {
  const { data, error } = await supabase
    .from("webhook_outbox")
    .select("id, firm_id, lead_id, action, last_error, last_http_status, failed_at, updated_at, attempts")
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error || !data) return [];
  return data as RecentOutboxFailure[];
}

async function fetchIntakeActivity(): Promise<IntakeActivity> {
  // Total + last 24h via two count queries. Most recent via single-row select.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count: total }, { count: last24 }, recent] = await Promise.all([
    supabase.from("screened_leads").select("id", { count: "exact", head: true }),
    supabase.from("screened_leads").select("id", { count: "exact", head: true }).gte("created_at", cutoff),
    supabase
      .from("screened_leads")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    total: total ?? 0,
    last_24h: last24 ?? 0,
    last_lead_at: (recent.data as { created_at: string } | null)?.created_at ?? null,
  };
}

// ─── UI ─────────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">System health</h1>
      </div>
      <div className="text-xs text-black/40">
        Refreshed {formatTime(new Date().toISOString())}
      </div>
    </div>
  );
}

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
        {subtitle && (
          <span className="text-xs text-black/50">{subtitle}</span>
        )}
      </header>
      {children}
    </section>
  );
}

function CronCard({ job }: { job: CronJobHealth }) {
  const succeededAll = job.runs_24h > 0 && job.failed_24h === 0;
  const hasFailures = job.failed_24h > 0;
  const httpHealthy = job.last_http_status !== null && job.last_http_status >= 200 && job.last_http_status < 300;
  const overall: "green" | "amber" | "red" =
    hasFailures || !httpHealthy
      ? "red"
      : succeededAll
        ? "green"
        : "amber";

  return (
    <div className="border border-black/10 bg-parchment p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold text-sm text-navy truncate">{job.jobname}</div>
          <code className="text-[10px] text-black/50 font-mono">{job.schedule}</code>
        </div>
        <StatusDot tone={overall} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Last run" value={job.last_run_status ?? "—"} tone={job.last_run_status === "succeeded" ? "neutral" : "red"} />
        <Metric label="24h ok" value={`${job.succeeded_24h}/${job.runs_24h}`} tone={hasFailures ? "red" : "neutral"} />
        <Metric label="Last HTTP" value={job.last_http_status?.toString() ?? "—"} tone={httpHealthy ? "neutral" : "red"} />
      </div>
      <div className="text-[10px] text-black/50 tabular-nums">
        {job.last_run_start ? formatTime(job.last_run_start) : "Never run"}
      </div>
      {(job.last_http_error || job.last_run_status === "failed") && (
        <div className="bg-red-50 border border-red-200 px-2 py-1 text-[11px] text-red-800 break-words">
          {job.last_http_error ?? job.last_run_message ?? "Last run failed"}
        </div>
      )}
    </div>
  );
}

function StatusDot({ tone }: { tone: "green" | "amber" | "red" }) {
  const colour =
    tone === "green" ? "bg-emerald-500"
    : tone === "amber" ? "bg-amber-400"
    : "bg-red-500";
  return <span className={`w-2.5 h-2.5 rounded-full inline-block shrink-0 ${colour}`} aria-hidden />;
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "neutral" | "red" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-black/40">{label}</div>
      <div className={`font-mono ${tone === "red" ? "text-red-700" : "text-black/80"}`}>{value}</div>
    </div>
  );
}

function CountTile({ label, value, colour }: { label: string; value: number; colour: "amber" | "emerald" | "red" }) {
  const bgClass =
    colour === "emerald" ? "bg-emerald-50 border-emerald-200 text-emerald-900"
    : colour === "amber" ? "bg-amber-50 border-amber-200 text-amber-900"
    : "bg-red-50 border-red-200 text-red-900";
  return (
    <div className={`border ${bgClass} px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
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
    tone === "emerald" ? "text-emerald-700"
    : tone === "amber" ? "text-amber-700"
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

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
