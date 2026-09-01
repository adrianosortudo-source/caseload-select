/**
 * /admin/cadence-rules
 *
 * Operator-facing list of cadence_rules (the in-house cadence engine's
 * journeys, SHADOW MODE only, never sends anything real). Each row links to
 * the per-rule editor. Global rows (firm_id null) can be overridden per firm
 * via "+ Override", which pre-fills a copy for a specific firm.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import Link from 'next/link';
import { listCadenceRules } from '@/lib/cadence-rule-admin';
import {
  parseTriggerConfig,
  STAGE_TRANSITION_OPTIONS,
  LEAD_STATUS_OPTIONS,
} from '@/lib/cadence-rule-form-pure';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function triggerLabel(triggerConfig: Record<string, unknown>): string {
  const parsed = parseTriggerConfig(triggerConfig);
  if (parsed.mode === 'stage_transition') {
    const opt = STAGE_TRANSITION_OPTIONS.find((o) => o.cadence_trigger === parsed.cadence_trigger);
    return opt ? opt.label : parsed.cadence_trigger;
  }
  const opt = LEAD_STATUS_OPTIONS.find((o) => o.status === parsed.status);
  return `Lead status: ${opt ? opt.label : parsed.status}`;
}

export default async function AdminCadenceRulesPage() {
  const rows = await listCadenceRules();

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
          <h1 className="text-2xl font-bold text-navy mt-1">Cadence rules</h1>
          <p className="text-sm text-black/55 max-w-3xl mt-2">
            The journeys the shadow cadence engine runs. Edit steps, create firm overrides, or add a new
            journey. Everything here stays shadow-only until the real-send flip.
          </p>
        </div>
        <Link
          href="/admin/cadence-rules/new"
          className="text-xs font-semibold uppercase tracking-wider px-4 py-2 border border-navy bg-navy text-white hover:bg-navy/90"
        >
          + New journey
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-black/8 px-6 py-10 text-center">
          <p className="text-sm text-black/60">No cadence rules found.</p>
        </div>
      ) : (
        <div className="bg-white border border-black/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-parchment-2 border-b border-black/10">
              <tr className="text-left text-black/50 uppercase tracking-wider">
                <th className="px-4 py-2 font-semibold">Cadence key</th>
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">Scope</th>
                <th className="px-4 py-2 font-semibold">Trigger</th>
                <th className="px-4 py-2 font-semibold text-right">Steps</th>
                <th className="px-4 py-2 font-semibold">Enabled</th>
                <th className="px-4 py-2 font-semibold text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-black/5 last:border-0 hover:bg-parchment/50">
                  <td className="px-4 py-2 align-middle font-mono text-black/70">{r.cadence_key}</td>
                  <td className="px-4 py-2 align-middle text-black/80">{r.name}</td>
                  <td className="px-4 py-2 align-middle text-black/70">
                    {r.firm_name ? `${r.firm_name} override` : 'Global default'}
                  </td>
                  <td className="px-4 py-2 align-middle text-black/70">{triggerLabel(r.trigger_config)}</td>
                  <td className="px-4 py-2 align-middle text-right tabular-nums text-black/60">{r.step_count}</td>
                  <td className="px-4 py-2 align-middle">
                    <EnabledChip enabled={r.enabled} />
                  </td>
                  <td className="px-4 py-2 align-middle text-right whitespace-nowrap">
                    <Link
                      href={`/admin/cadence-rules/${r.id}`}
                      className="text-xs uppercase tracking-wider font-semibold text-navy hover:underline"
                    >
                      Edit
                    </Link>
                    {r.firm_id === null && (
                      <>
                        <span className="mx-1.5 text-black/20">·</span>
                        <Link
                          href={`/admin/cadence-rules/new?copy_from=${r.id}`}
                          className="text-xs uppercase tracking-wider font-semibold text-navy hover:underline"
                        >
                          + Override
                        </Link>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EnabledChip({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex items-center rounded-none px-2 py-0.5 text-[10px] uppercase tracking-wider bg-emerald-50 text-emerald-700">
      Enabled
    </span>
  ) : (
    <span className="inline-flex items-center rounded-none px-2 py-0.5 text-[10px] uppercase tracking-wider bg-black/5 text-black/40">
      Disabled
    </span>
  );
}
