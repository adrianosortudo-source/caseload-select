/**
 * /admin/cadence-shadow
 *
 * The operator eyeball surface for the shadow cadence engine (CaseLoad_CRM_
 * Migration_Plan_v1.md Phase 2 rail 1). Shows what the in-house cadence
 * engine WOULD have sent (outbound_messages, shadow=true), broken down by
 * cadence and consent verdict, plus a day-by-day diff against an operator-
 * uploaded export of GHL's actual sends (ghl_send_imports).
 *
 * This page never triggers a send. It is read-only observability plus a CSV
 * import action. Auth: getOperatorSession() in /admin/layout.tsx.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import FirmFilter from "@/components/admin/FirmFilter";
import CadenceShadowImportForm from "@/components/admin/CadenceShadowImportForm";
import { computeShadowVsGhlDiff, type DiffInputRow } from "@/lib/ghl-send-import-pure";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface OutboundRow {
  cadence_key: string | null;
  status: string;
  consent_verdict: string;
  scheduled_for: string | null;
  created_at: string;
}

interface ImportRow {
  cadence_key: string | null;
  sent_at: string | null;
}

export default async function CadenceShadowPage({
  searchParams,
}: {
  searchParams: Promise<{ firm_id?: string }>;
}) {
  const { firm_id } = await searchParams;

  const { data: firms } = await supabase
    .from("intake_firms")
    .select("id, name, branding")
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string | null; branding: { firm_name?: string } | null }>>();

  const firmsList = (firms ?? []).map((f) => ({
    id: f.id,
    name: f.branding?.firm_name ?? f.name ?? "Unknown firm",
  }));

  let outbound: OutboundRow[] = [];
  let imports: ImportRow[] = [];

  if (firm_id) {
    const { data: outRows } = await supabase
      .from("outbound_messages")
      .select("cadence_key, status, consent_verdict, scheduled_for, created_at")
      .eq("firm_id", firm_id)
      .order("created_at", { ascending: false })
      .limit(2000)
      .returns<OutboundRow[]>();
    outbound = outRows ?? [];

    const { data: impRows } = await supabase
      .from("ghl_send_imports")
      .select("cadence_key, sent_at")
      .eq("firm_id", firm_id)
      .limit(5000)
      .returns<ImportRow[]>();
    imports = impRows ?? [];
  }

  const counts = {
    total: outbound.length,
    shadow_logged: outbound.filter((r) => r.status === "shadow_logged").length,
    suppressed: outbound.filter((r) => r.status === "suppressed").length,
    scheduled: outbound.filter((r) => r.status === "scheduled").length,
    sent: outbound.filter((r) => r.status === "sent").length,
    failed: outbound.filter((r) => r.status === "failed").length,
    consent_allowed: outbound.filter((r) => r.consent_verdict === "allowed").length,
    consent_blocked: outbound.filter((r) => r.consent_verdict === "blocked").length,
  };

  const byCadence = new Map<string, { logged: number; suppressed: number }>();
  for (const r of outbound) {
    const key = r.cadence_key ?? "unknown";
    const entry = byCadence.get(key) ?? { logged: 0, suppressed: 0 };
    if (r.status === "suppressed") entry.suppressed += 1;
    else entry.logged += 1;
    byCadence.set(key, entry);
  }

  const shadowDiffInput: DiffInputRow[] = outbound
    .filter((r) => r.status === "shadow_logged" || r.status === "sent")
    .map((r) => ({ cadence_key: r.cadence_key, sent_or_scheduled_for: r.scheduled_for ?? r.created_at }));
  const ghlDiffInput: DiffInputRow[] = imports
    .filter((r): r is { cadence_key: string | null; sent_at: string } => !!r.sent_at)
    .map((r) => ({ cadence_key: r.cadence_key, sent_or_scheduled_for: r.sent_at }));
  const diffBuckets = firm_id ? computeShadowVsGhlDiff(shadowDiffInput, ghlDiffInput) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
          <h1 className="text-2xl font-bold text-navy mt-1">Cadence shadow ledger</h1>
          <p className="text-xs text-black/50 mt-1">
            What the in-house cadence engine would send. Shadow only, nothing dispatches. GHL keeps running the real cadences.
          </p>
        </div>
        <FirmFilter action="/admin/cadence-shadow" firms={firmsList} active={firm_id ?? null} />
      </div>

      {!firm_id ? (
        <div className="bg-white border border-black/8 px-6 py-10 text-center">
          <p className="text-sm text-black/60">Select a firm to view its shadow ledger.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile label="Shadow logged" value={counts.shadow_logged} />
            <SummaryTile label="Suppressed (consent)" value={counts.suppressed} />
            <SummaryTile label="Real sends (dormant)" value={counts.scheduled + counts.sent} />
            <SummaryTile label="Failed" value={counts.failed} />
          </div>

          <div className="bg-white border border-black/10 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-parchment-2 border-b border-black/10">
                <tr className="text-left text-black/50 uppercase tracking-wider">
                  <th className="px-3 py-2 font-semibold">Cadence</th>
                  <th className="px-3 py-2 font-semibold text-right">Logged</th>
                  <th className="px-3 py-2 font-semibold text-right">Suppressed</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byCadence.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => (
                  <tr key={key} className="border-b border-black/5 last:border-0">
                    <td className="px-3 py-2 font-mono">{key}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.logged}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.suppressed}</td>
                  </tr>
                ))}
                {byCadence.size === 0 && (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-black/40">No shadow rows yet for this firm.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-bold text-navy">Shadow vs. GHL diff</h2>
            <p className="text-xs text-black/50">
              Upload a CSV export of GHL&apos;s actual cadence sends for this firm (columns: cadence_key, sent_at required; matter_id, screened_lead_id, step_number, recipient_email, subject optional).
            </p>
            <CadenceShadowImportForm firmId={firm_id} />

            <div className="bg-white border border-black/10 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-parchment-2 border-b border-black/10">
                  <tr className="text-left text-black/50 uppercase tracking-wider">
                    <th className="px-3 py-2 font-semibold">Day</th>
                    <th className="px-3 py-2 font-semibold">Cadence</th>
                    <th className="px-3 py-2 font-semibold text-right">Shadow</th>
                    <th className="px-3 py-2 font-semibold text-right">GHL</th>
                    <th className="px-3 py-2 font-semibold text-right">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {diffBuckets.map((b) => (
                    <tr key={`${b.day}:${b.cadence_key}`} className="border-b border-black/5 last:border-0">
                      <td className="px-3 py-2 tabular-nums">{b.day}</td>
                      <td className="px-3 py-2 font-mono">{b.cadence_key}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.shadow_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.ghl_count}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${b.delta === 0 ? "text-black/40" : "text-amber-700"}`}>
                        {b.delta > 0 ? `+${b.delta}` : b.delta}
                      </td>
                    </tr>
                  ))}
                  {diffBuckets.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-black/40">No GHL export imported yet. Upload one above to compare.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-black/10 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-black/50 font-semibold">{label}</p>
      <p className="text-2xl font-bold text-navy mt-1 tabular-nums">{value}</p>
    </div>
  );
}
