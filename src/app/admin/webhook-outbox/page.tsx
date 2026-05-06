/**
 * /admin/webhook-outbox
 *
 * Operator-visible webhook delivery log. Server-renders the latest 100
 * webhook_outbox rows across all firms. Filters: firm_id, status. Each row
 * exposes a Retry button when status is 'pending' or 'failed'.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import FirmFilter from "@/components/admin/FirmFilter";
import OutboxRetryButton from "@/components/admin/OutboxRetryButton";
import Link from "next/link";

interface OutboxRow {
  id: string;
  lead_id: string;
  firm_id: string;
  action: "taken" | "passed" | "declined_oos" | "declined_backstop";
  idempotency_key: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  last_http_status: number | null;
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  failed_at: string | null;
}

interface FirmSlim {
  id: string;
  name: string | null;
  branding: { firm_name?: string } | null;
}

type StatusFilter = "all" | "pending" | "sent" | "failed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminWebhookOutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ firm_id?: string; status?: string }>;
}) {
  const { firm_id, status } = await searchParams;
  const statusFilter: StatusFilter =
    status === "pending" || status === "sent" || status === "failed" ? status : "all";

  let query = supabase
    .from("webhook_outbox")
    .select(`
      id, lead_id, firm_id, action, idempotency_key,
      status, attempts, max_attempts, next_attempt_at,
      last_error, last_http_status, webhook_url,
      created_at, updated_at, sent_at, failed_at
    `, { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(100);

  if (firm_id) query = query.eq("firm_id", firm_id);
  if (statusFilter !== "all") query = query.eq("status", statusFilter);

  const { data: rows, error } = await query.returns<OutboxRow[]>();
  if (error) return <ErrorState message={error.message} />;

  const { data: firms } = await supabase
    .from("intake_firms")
    .select("id, name, branding")
    .order("name", { ascending: true })
    .returns<FirmSlim[]>();

  const firmsList = (firms ?? []).map((f) => ({
    id: f.id,
    name: f.branding?.firm_name ?? f.name ?? "Unknown firm",
  }));
  const firmById = new Map(firmsList.map((f) => [f.id, f.name] as const));

  const items = rows ?? [];
  const counts = {
    all: items.length,
    pending: items.filter((r) => r.status === "pending").length,
    sent: items.filter((r) => r.status === "sent").length,
    failed: items.filter((r) => r.status === "failed").length,
  };

  return (
    <div className="space-y-5">
      <Header total={items.length} />

      <div className="flex items-center gap-3 flex-wrap">
        <StatusFilterRow active={statusFilter} counts={counts} firmId={firm_id ?? null} />
        <FirmFilter
          action="/admin/webhook-outbox"
          firms={firmsList}
          active={firm_id ?? null}
          extraParams={statusFilter !== "all" ? [{ name: "status", value: statusFilter }] : []}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState filtered={statusFilter !== "all" || !!firm_id} />
      ) : (
        <div className="bg-white border border-black/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-parchment-2 border-b border-black/10">
              <tr className="text-left text-black/50 uppercase tracking-wider">
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Firm</th>
                <th className="px-3 py-2 font-semibold">Lead / action</th>
                <th className="px-3 py-2 font-semibold">Attempts</th>
                <th className="px-3 py-2 font-semibold">Last attempt</th>
                <th className="px-3 py-2 font-semibold">Error</th>
                <th className="px-3 py-2 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-black/5 last:border-0 hover:bg-parchment/50">
                  <td className="px-3 py-2 align-top">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2 align-top text-black/70">
                    {firmById.get(row.firm_id) ?? "Unknown firm"}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Link
                      href={`/portal/${row.firm_id}/triage/${row.lead_id}`}
                      className="font-mono text-navy hover:underline"
                    >
                      {row.lead_id}
                    </Link>
                    <div className="text-[10px] uppercase tracking-wider text-black/50 mt-0.5">
                      {row.action}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-black/70 tabular-nums">
                    {row.attempts}/{row.max_attempts}
                  </td>
                  <td className="px-3 py-2 align-top text-black/60 tabular-nums">
                    {formatTime(row.sent_at ?? row.failed_at ?? row.next_attempt_at ?? row.updated_at)}
                  </td>
                  <td className="px-3 py-2 align-top text-black/70 max-w-[260px]">
                    {row.last_error ? (
                      <span className="truncate block" title={row.last_error}>
                        {row.last_http_status ? <span className="font-mono text-[10px] text-red-700 mr-2">[{row.last_http_status}]</span> : null}
                        {row.last_error}
                      </span>
                    ) : (
                      <span className="text-black/30">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    {row.status !== "sent" ? (
                      <OutboxRetryButton outboxId={row.id} />
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider text-black/30">delivered</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-black/40">
        Showing {items.length} most recent. Idempotency key format: <code>{`{lead_id}:{action}`}</code>. Backoff: 30s, 2m, 8m, 32m, 2h08m.
      </p>
    </div>
  );
}

function Header({ total }: { total: number }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Webhook outbox</h1>
      </div>
      <div className="text-xs text-black/50 uppercase tracking-wider">
        {total} row{total === 1 ? "" : "s"} in view
      </div>
    </div>
  );
}

function StatusFilterRow({
  active,
  counts,
  firmId,
}: {
  active: StatusFilter;
  counts: Record<StatusFilter, number>;
  firmId: string | null;
}) {
  const tabs: Array<{ key: StatusFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "sent", label: "Sent" },
    { key: "failed", label: "Failed" },
  ];
  function href(s: StatusFilter): string {
    const params = new URLSearchParams();
    if (s !== "all") params.set("status", s);
    if (firmId) params.set("firm_id", firmId);
    const qs = params.toString();
    return qs ? `/admin/webhook-outbox?${qs}` : "/admin/webhook-outbox";
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={href(t.key)}
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
  );
}

function StatusBadge({ status }: { status: OutboxRow["status"] }) {
  const colour =
    status === "sent" ? "bg-emerald-100 text-emerald-900 border-emerald-300"
    : status === "pending" ? "bg-amber-50 text-amber-900 border-amber-300"
    : "bg-red-50 text-red-900 border-red-300";
  return (
    <span
      className={`inline-flex items-center justify-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border ${colour}`}
    >
      {status}
    </span>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="bg-white border border-black/8 px-6 py-10 text-center">
      <p className="text-sm text-black/60">
        {filtered
          ? "No outbox rows match these filters."
          : "Outbox is empty. Webhook deliveries are logged here as they fire."}
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

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
