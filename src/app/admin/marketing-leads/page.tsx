/**
 * /admin/marketing-leads
 *
 * Operator-visible list of marketing lead-magnet captures (checklist
 * downloads today; any future non-matter marketing tool that writes to
 * marketing_lead_consent_log tomorrow) across all firms. Read-only: this
 * table's write path is exclusively /api/marketing-lead-intake, which owns
 * the write-ahead-consent invariant and the one-time ghl_contact_id
 * backfill (see the append-only guard trigger in the 20260727010000
 * migration). This page never writes to it.
 *
 * These are deliberately NOT screened_leads rows (no CPI score, no band,
 * nothing for a lawyer to Take/Pass), so they do not appear in
 * /admin/triage and should not be confused with it. A magnet download is a
 * marketing capture, not a matter.
 *
 * Journey progression after capture (welcome email, weekly nurture) lives
 * in GHL, not in this app. Rather than mirror that state here — which
 * would mean webhooks, a new events table, and permanent drift risk for a
 * capability GHL already renders well — each row links directly to the
 * contact's timeline in the firm's GHL location. Two firm/GHL identity
 * queries in Supabase; zero calls to the GHL API.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

interface MarketingLeadRow {
  id: string;
  firm_id: string;
  email: string;
  ghl_contact_id: string | null;
  source: string;
  asset: string | null;
  locale: string | null;
  consent_text_version: string;
  captured_at: string;
}

interface FirmSlim {
  id: string;
  name: string | null;
  branding: { firm_name?: string } | null;
  ghl_location_id: string | null;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminMarketingLeadsPage() {
  const { data: rows, error } = await supabase
    .from("marketing_lead_consent_log")
    .select(`
      id, firm_id, email, ghl_contact_id, source, asset, locale,
      consent_text_version, captured_at
    `)
    .order("captured_at", { ascending: false })
    .limit(200)
    .returns<MarketingLeadRow[]>();

  if (error) return <ErrorState message={error.message} />;

  const { data: firms } = await supabase
    .from("intake_firms")
    .select("id, name, branding, ghl_location_id")
    .returns<FirmSlim[]>();

  const firmById = new Map(
    (firms ?? []).map((f) => [
      f.id,
      {
        name: f.branding?.firm_name ?? f.name ?? "Unknown firm",
        ghlLocationId: f.ghl_location_id,
      },
    ] as const),
  );

  const items = rows ?? [];

  return (
    <div className="space-y-5">
      <Header total={items.length} />

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="bg-white border border-black/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-parchment-2 border-b border-black/10">
              <tr className="text-left text-black/50 uppercase tracking-wider">
                <th className="px-3 py-2 font-semibold">Captured</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Firm</th>
                <th className="px-3 py-2 font-semibold">Asset</th>
                <th className="px-3 py-2 font-semibold">Locale</th>
                <th className="px-3 py-2 font-semibold">Consent version</th>
                <th className="px-3 py-2 font-semibold text-right">GHL</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const firm = firmById.get(row.firm_id);
                return (
                  <tr key={row.id} className="border-b border-black/5 last:border-0 hover:bg-parchment/50">
                    <td className="px-3 py-2 align-top text-black/60 tabular-nums whitespace-nowrap">
                      {formatTime(row.captured_at)}
                    </td>
                    <td className="px-3 py-2 align-top text-black/80 break-all">
                      {row.email}
                    </td>
                    <td className="px-3 py-2 align-top text-black/70 whitespace-nowrap">
                      {firm?.name ?? "Unknown firm"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="font-mono text-[11px] text-black/70">
                        {row.asset ?? <span className="text-black/30">—</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <LocaleBadge locale={row.locale} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="font-mono text-[10px] text-black/50">
                        {row.consent_text_version}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                      <GhlCell contactId={row.ghl_contact_id} locationId={firm?.ghlLocationId ?? null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-black/40">
        Showing up to 200 most recent captures. Consent and capture events are written by
        /api/marketing-lead-intake and are immutable once logged; this page is read-only.
      </p>
    </div>
  );
}

function Header({ total }: { total: number }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Marketing leads</h1>
        <p className="text-xs text-black/50 mt-1">
          Checklist and lead-magnet captures across every firm. Rows link to the contact&rsquo;s
          journey in GHL.
        </p>
      </div>
      <div className="text-xs text-black/50 uppercase tracking-wider whitespace-nowrap">
        {total} row{total === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function LocaleBadge({ locale }: { locale: string | null }) {
  if (!locale) return <span className="text-black/30">—</span>;
  return (
    <span className="inline-flex items-center justify-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border border-black/15 bg-parchment text-black/60">
      {locale}
    </span>
  );
}

function GhlCell({ contactId, locationId }: { contactId: string | null; locationId: string | null }) {
  if (contactId && locationId) {
    const href = `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-navy hover:underline font-semibold"
      >
        Open in GHL
        <span aria-hidden>&rarr;</span>
      </a>
    );
  }
  if (contactId && !locationId) {
    // Contact exists in GHL but this firm has no ghl_location_id on file,
    // so a correct deep link cannot be built. Distinct from "not in GHL":
    // the capture succeeded, only the link is unavailable.
    return (
      <span className="text-[10px] uppercase tracking-wider text-black/40">
        In GHL (no location on file)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 border border-amber-300 bg-amber-50 text-amber-900">
      Not in GHL
    </span>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-black/8 px-6 py-10 text-center">
      <p className="text-sm text-black/60">
        No marketing leads captured yet.
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
