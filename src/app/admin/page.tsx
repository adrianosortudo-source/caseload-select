/**
 * /admin
 *
 * Operator console home. The cross-firm command center: what needs the
 * operator now, and is anything broken. Three sections:
 *
 *   1. Attention bar: failure / deadline chips that only light up when
 *      non-zero (expiring leads, failed notifications, failed webhooks,
 *      token expiry, unconfirmed voice).
 *   2. Firm board: one status card per firm (open leads, matters in
 *      flight, onboarding status, notification health, last intake).
 *   3. Operator backlog: onboarding submissions awaiting setup,
 *      deliverables awaiting sign-off, content pieces in progress.
 *
 * Server-rendered on each load. Auth enforced by /admin/layout.tsx.
 * Counts are computed from a small set of grouped reads; volume is low
 * at launch stage. If lead volume grows past a few thousand active rows,
 * convert the lead scan to server-side count() aggregates per firm.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  getOperatorUnreadByFirm,
  getOperatorChannelPreviews,
  type OperatorChannelPreview,
} from "@/lib/operator-firm-messaging";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface FirmRow {
  id: string;
  name: string | null;
  facebook_page_token_expires_at: string | null;
  whatsapp_cloud_token_expires_at: string | null;
  voice_api_token_expires_at: string | null;
}

interface LeadRow {
  firm_id: string;
  status: string;
  decision_deadline: string | null;
  submitted_at: string | null;
  notification_sent_at: string | null;
  notification_error: string | null;
}

interface MatterRow {
  firm_id: string;
  matter_stage: string;
}

interface OnboardingRow {
  id: string;
  legal_name: string | null;
  authorized_rep_name: string | null;
  form_type: string;
  submitted_at: string | null;
}

interface DeliverableRow {
  id: string;
  firm_id: string;
  title: string | null;
  status: string;
}

export default async function AdminHomePage() {
  const session = await getOperatorSession();
  if (!session) redirect("/portal/login?error=missing");

  const nowMs = Date.now();
  const sevenDaysAgoIso = new Date(nowMs - SEVEN_DAYS_MS).toISOString();

  const [
    firmsRes,
    leadsRes,
    webhookFailedRes,
    voiceUnconfirmedRes,
    mattersRes,
    onboardingRes,
    deliverablesRes,
    contentRes,
  ] = await Promise.all([
    supabase
      .from("intake_firms")
      // Demo / test-fixture firms (is_demo=true) are kept off the operator
      // console home so the firm board shows only live client firms. The demo
      // firms still exist and back /demo + /test-screen; they are simply not
      // surfaced here. Other operator firm pickers are unaffected.
      .select(
        "id, name, facebook_page_token_expires_at, whatsapp_cloud_token_expires_at, voice_api_token_expires_at",
      )
      .eq("is_demo", false)
      .order("name", { ascending: true })
      .returns<FirmRow[]>(),
    supabase
      .from("screened_leads")
      .select(
        "firm_id, status, decision_deadline, submitted_at, notification_sent_at, notification_error",
      )
      .eq("archived", false)
      .limit(2000)
      .returns<LeadRow[]>(),
    supabase
      .from("webhook_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase
      .from("unconfirmed_inquiries")
      .select("id", { count: "exact", head: true })
      .eq("channel", "voice")
      .gte("created_at", sevenDaysAgoIso),
    supabase.from("client_matters").select("firm_id, matter_stage").returns<MatterRow[]>(),
    supabase
      .from("firm_onboarding_intake")
      .select("id, legal_name, authorized_rep_name, form_type, submitted_at")
      .order("submitted_at", { ascending: false })
      .limit(50)
      .returns<OnboardingRow[]>(),
    supabase
      .from("content_deliverables")
      .select("id, firm_id, title, status")
      .in("status", ["in_review", "changes_requested"])
      .limit(50)
      .returns<DeliverableRow[]>(),
    supabase
      .from("content_pieces")
      .select("firm_id, status")
      .in("status", ["draft", "in_review", "changes_requested"])
      .returns<{ firm_id: string; status: string }[]>(),
  ]);

  const firms = firmsRes.data ?? [];
  const leads = leadsRes.data ?? [];
  const matters = mattersRes.data ?? [];
  const onboarding = onboardingRes.data ?? [];
  const deliverables = deliverablesRes.data ?? [];
  const contentPieces = contentRes.data ?? [];
  const webhookFailed = webhookFailedRes.count ?? 0;
  const voiceUnconfirmed = voiceUnconfirmedRes.count ?? 0;

  // CaseLoad Connect: per-firm unread + latest-message previews, best-effort.
  // Previews are scoped to the live (non-demo) firms shown above.
  const liveFirmIds = firms.map((f) => f.id);
  const [unreadByFirm, channelPreviews] = await Promise.all([
    getOperatorUnreadByFirm().catch(() => new Map<string, number>()),
    getOperatorChannelPreviews(liveFirmIds).catch(() => [] as OperatorChannelPreview[]),
  ]);
  const unreadMessagesTotal = Array.from(unreadByFirm.values()).reduce((s, n) => s + n, 0);
  const firstUnreadFirmId = firms.find((f) => (unreadByFirm.get(f.id) ?? 0) > 0)?.id ?? null;

  // Attention bar counts.
  const plus4hMs = nowMs + FOUR_HOURS_MS;
  const expiringSoon = leads.filter(
    (l) =>
      l.status === "triaging" &&
      l.decision_deadline != null &&
      new Date(l.decision_deadline).getTime() <= plus4hMs,
  ).length;
  const notifFailed = leads.filter((l) => l.notification_error && !l.notification_sent_at).length;
  const plus14dMs = nowMs + FOURTEEN_DAYS_MS;
  const tokensExpiring = firms.filter((f) =>
    [
      f.facebook_page_token_expires_at,
      f.whatsapp_cloud_token_expires_at,
      f.voice_api_token_expires_at,
    ].some((t) => t != null && new Date(t).getTime() <= plus14dMs),
  ).length;

  const attention: { label: string; count: number; href: string; tone: "alert" | "warn" | "info" }[] = [
    { label: "Leads expiring under 4h", count: expiringSoon, href: "/admin/triage", tone: "alert" },
    { label: "Notifications failed", count: notifFailed, href: "/admin/triage", tone: "alert" },
    { label: "Webhooks failed", count: webhookFailed, href: "/admin/webhook-outbox", tone: "alert" },
    { label: "Tokens expiring under 14d", count: tokensExpiring, href: "/admin/health", tone: "warn" },
    { label: "Unconfirmed voice (7d)", count: voiceUnconfirmed, href: "/admin/health", tone: "alert" },
    {
      label: "Unread firm messages",
      count: unreadMessagesTotal,
      // Link to the firm with unread mail, else the first firm's messages, so
      // the chip always opens a messages surface. The prior "/admin" fallback
      // made the chip a self-link (a dead end) whenever nothing was unread.
      href: (() => {
        const targetFirmId = firstUnreadFirmId ?? firms[0]?.id ?? null;
        return targetFirmId ? `/admin/firms/${targetFirmId}/messages` : "/admin";
      })(),
      tone: "info",
    },
  ];
  const totalAttention = attention.reduce((s, a) => s + a.count, 0);

  // Firm board.
  const onboardedNames = new Set(
    onboarding
      .map((o) => (o.legal_name ?? "").trim().toLowerCase())
      .filter((n) => n.length > 0),
  );

  const firmCards = firms.map((f) => {
    const firmLeads = leads.filter((l) => l.firm_id === f.id);
    const openTriaging = firmLeads.filter((l) => l.status === "triaging").length;
    const mattersInFlight = matters.filter(
      (m) => m.firm_id === f.id && m.matter_stage !== "closed",
    ).length;
    const notifUnhealthy = firmLeads.some((l) => l.notification_error && !l.notification_sent_at);
    const tokenWarn = [
      f.facebook_page_token_expires_at,
      f.whatsapp_cloud_token_expires_at,
      f.voice_api_token_expires_at,
    ].some((t) => t != null && new Date(t).getTime() <= plus14dMs);
    const lastIntakeMs = firmLeads
      .map((l) => (l.submitted_at ? new Date(l.submitted_at).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    const onboarded = onboardedNames.has((f.name ?? "").trim().toLowerCase());
    return {
      id: f.id,
      name: f.name ?? "Unnamed firm",
      openTriaging,
      mattersInFlight,
      notifUnhealthy,
      tokenWarn,
      onboarded,
      lastIntakeMs,
      unread: unreadByFirm.get(f.id) ?? 0,
    };
  });

  // Operator backlog.
  const firmNameById = new Map(firms.map((f) => [f.id, f.name ?? "Unnamed firm"] as const));
  const contentInProgress = contentPieces.length;

  // Console-home "Firm messages": latest conversation per live firm, unread
  // first then newest. firmNameById is built from the non-demo firm list, so
  // any demo-firm channel that slipped through is dropped here too.
  const messageRows = channelPreviews
    .filter((p) => firmNameById.has(p.firm_id))
    .map((p) => ({
      firmId: p.firm_id,
      firmName: firmNameById.get(p.firm_id)!,
      preview: p.preview,
      at: p.last_message_at,
      senderRole: p.sender_role,
      senderName: p.sender_name,
      unread: unreadByFirm.get(p.firm_id) ?? 0,
    }))
    .sort(
      (a, b) =>
        (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) ||
        (a.at < b.at ? 1 : a.at > b.at ? -1 : 0),
    );

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Console home</h1>
        <p className="mt-1 text-sm text-black/60">
          What needs you now, across every firm.
        </p>
      </div>

      {/* Attention bar */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-field-label">Attention</h2>
          {totalAttention === 0 && (
            <span className="text-xs text-green-pass font-semibold">All clear</span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {attention.map((a) => (
            <AttentionChip key={a.label} label={a.label} count={a.count} href={a.href} tone={a.tone} />
          ))}
        </div>
      </section>

      {/* Firm board */}
      <section>
        <h2 className="text-xs uppercase tracking-wider font-semibold text-field-label mb-2">
          Firms
        </h2>
        {firmCards.length === 0 ? (
          <div className="bg-white border border-border-brand px-6 py-10 text-center">
            <p className="text-sm text-black/60">No firms yet. Create one from the sidebar.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {firmCards.map((c) => (
              <FirmCard key={c.id} card={c} nowMs={nowMs} />
            ))}
          </div>
        )}
      </section>

      {/* Operator backlog */}
      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider font-semibold text-field-label">
          Your backlog
        </h2>

        {/* Firm messages (CaseLoad Connect, cross-firm) */}
        <BacklogCard
          title="Firm messages"
          count={messageRows.length}
          emptyText="No firm messages yet."
        >
          {messageRows.slice(0, 6).map((m) => (
            <Link
              key={m.firmId}
              href={`/admin/firms/${m.firmId}/messages`}
              className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border-brand hover:bg-parchment/60 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm text-navy font-semibold truncate">{m.firmName}</div>
                <div className="text-[11px] text-black/50 truncate">
                  {senderLabel(m.senderRole, m.senderName)}: {m.preview || "(no text)"}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {m.unread > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-navy text-white tabular-nums">
                    {m.unread}
                  </span>
                )}
                <span className="text-[11px] text-black/45 tabular-nums whitespace-nowrap">
                  {relativeTime(m.at, nowMs)}
                </span>
              </div>
            </Link>
          ))}
        </BacklogCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Onboarding submissions */}
          <BacklogCard
            title="Onboarding submissions"
            count={onboarding.length}
            href="/admin/onboarding-submissions"
            emptyText="No onboarding submissions yet."
          >
            {onboarding.slice(0, 6).map((o) => (
              <Link
                key={o.id}
                href={`/admin/onboarding-submissions/${o.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border-brand hover:bg-parchment/60 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm text-navy font-semibold truncate">
                    {o.legal_name ?? "Unnamed firm"}
                  </div>
                  <div className="text-[11px] text-black/50 truncate">
                    {o.form_type === "profile" ? "Firm profile" : "Registration"}
                    {o.authorized_rep_name ? ` · ${o.authorized_rep_name}` : ""}
                  </div>
                </div>
                <span className="text-[11px] text-black/45 tabular-nums whitespace-nowrap">
                  {relativeTime(o.submitted_at, nowMs)}
                </span>
              </Link>
            ))}
          </BacklogCard>

          {/* Deliverables awaiting sign-off */}
          <BacklogCard
            title="Deliverables awaiting sign-off"
            count={deliverables.length}
            emptyText="Nothing awaiting a firm signature."
          >
            {deliverables.slice(0, 6).map((d) => (
              <Link
                key={d.id}
                href={`/portal/${d.firm_id}/deliverables/${d.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border-brand hover:bg-parchment/60 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm text-navy font-semibold truncate">
                    {d.title ?? "Untitled deliverable"}
                  </div>
                  <div className="text-[11px] text-black/50 truncate">
                    {firmNameById.get(d.firm_id) ?? "Unknown firm"}
                  </div>
                </div>
                <StatusTag status={d.status} />
              </Link>
            ))}
          </BacklogCard>
        </div>

        <Link
          href="/admin/content-studio"
          className="block bg-white border border-border-brand px-4 py-3 hover:border-navy transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-navy font-semibold">Content pieces in progress</span>
            <span className="text-sm font-bold text-navy tabular-nums">{contentInProgress}</span>
          </div>
          <p className="text-[11px] text-black/50 mt-0.5">
            Pieces in draft, review, or changes-requested across the content studio.
          </p>
        </Link>
      </section>
    </div>
  );
}

function AttentionChip({
  label,
  count,
  href,
  tone,
}: {
  label: string;
  count: number;
  href: string;
  tone: "alert" | "warn" | "info";
}) {
  const active = count > 0;
  const activeClasses =
    tone === "warn"
      ? "bg-amber-50 border-amber-300 text-amber-900"
      : tone === "info"
      ? "bg-navy/10 border-navy/30 text-navy"
      : "bg-red-fail/10 border-red-fail/40 text-red-fail";
  return (
    <Link
      href={href}
      className={`border p-3 transition-colors ${
        active ? activeClasses : "bg-white border-border-brand text-muted hover:border-navy/30"
      }`}
    >
      <div className={`text-2xl font-display font-bold tabular-nums ${active ? "" : "text-black/30"}`}>
        {count}
      </div>
      <div className="text-[11px] uppercase tracking-wider font-semibold mt-1 leading-tight">
        {label}
      </div>
    </Link>
  );
}

interface FirmCardData {
  id: string;
  name: string;
  openTriaging: number;
  mattersInFlight: number;
  notifUnhealthy: boolean;
  tokenWarn: boolean;
  onboarded: boolean;
  lastIntakeMs: number;
  unread: number;
}

function FirmCard({ card, nowMs }: { card: FirmCardData; nowMs: number }) {
  const healthy = !card.notifUnhealthy && !card.tokenWarn;
  return (
    <div className="bg-white border border-border-brand p-4 hover:border-navy/40 transition-colors flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/admin/firms/${card.id}/triage`}
          className="text-sm font-display font-bold text-navy truncate hover:underline"
        >
          {card.name}
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          {card.unread > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-navy text-white tabular-nums">
              {card.unread}
            </span>
          )}
          <span
            aria-label={healthy ? "Healthy" : "Needs attention"}
            className={`mt-0.5 inline-block w-2.5 h-2.5 ${
              healthy ? "bg-green-pass" : "bg-red-fail"
            }`}
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Open leads" value={card.openTriaging} />
        <Metric label="Matters" value={card.mattersInFlight} />
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${
            card.onboarded
              ? "bg-green-pass/10 text-green-pass border-green-pass/30"
              : "bg-parchment-2 text-muted border-border-brand"
          }`}
        >
          {card.onboarded ? "Onboarded" : "No onboarding"}
        </span>
        {card.tokenWarn && (
          <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border bg-amber-50 text-amber-800 border-amber-200">
            Token expiring
          </span>
        )}
        {card.notifUnhealthy && (
          <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border bg-red-fail/10 text-red-fail border-red-fail/30">
            Notify failed
          </span>
        )}
      </div>
      <div className="mt-3 text-[11px] text-black/45">
        Last intake: {card.lastIntakeMs > 0 ? relativeTime(new Date(card.lastIntakeMs).toISOString(), nowMs) : "none yet"}
      </div>
      <div className="mt-3 pt-3 border-t border-border-brand grid grid-cols-3 gap-1.5">
        <CardLink href={`/admin/firms/${card.id}/triage`} label="Triage" />
        <CardLink
          href={`/admin/firms/${card.id}/messages`}
          label={card.unread > 0 ? `Messages (${card.unread})` : "Messages"}
        />
        <CardLink href={`/portal/${card.id}/files`} label="Files" />
      </div>
    </div>
  );
}

function CardLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-center text-[10px] uppercase tracking-wider font-semibold px-2 py-1.5 border border-navy/20 text-navy hover:bg-navy hover:text-white transition-colors"
    >
      {label}
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-parchment-2/60 border border-border-brand px-2.5 py-2">
      <div className="text-lg font-display font-bold text-navy tabular-nums leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted mt-1">{label}</div>
    </div>
  );
}

function BacklogCard({
  title,
  count,
  href,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  href?: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const heading = (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-sm font-semibold text-navy">{title}</span>
      <span className="text-xs font-bold text-navy tabular-nums">{count}</span>
    </div>
  );
  return (
    <div className="bg-white border border-border-brand">
      {href ? (
        <Link href={href} className="block hover:bg-parchment/60 transition-colors">
          {heading}
        </Link>
      ) : (
        heading
      )}
      {count === 0 ? (
        <p className="px-3 py-4 text-xs text-black/45 border-t border-border-brand">{emptyText}</p>
      ) : (
        children
      )}
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const label = status === "changes_requested" ? "Changes requested" : "In review";
  const classes =
    status === "changes_requested"
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : "bg-navy/10 text-navy border-navy/20";
  return (
    <span
      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border whitespace-nowrap ${classes}`}
    >
      {label}
    </span>
  );
}

function senderLabel(role: string, name: string | null): string {
  if (role === "operator") return "You";
  if (role === "system") return "System";
  return name?.trim() || "Lawyer";
}

function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "unknown";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const diff = nowMs - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
