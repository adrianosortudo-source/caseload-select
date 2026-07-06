/**
 * /admin/cadence-rules/[id]
 *
 * Per-rule editor surface. Loads the cadence_rules row (plus its steps) and
 * mounts the client CadenceRuleEditor (trigger, exit condition, steps).
 * Save goes through the API routes backing CadenceRuleEditor.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import Link from 'next/link';
import { getCadenceRuleDetail } from '@/lib/cadence-rule-admin';
import { parseTriggerConfig, parseExitConfig } from '@/lib/cadence-rule-form-pure';
import CadenceRuleEditor from '@/components/admin/CadenceRuleEditor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminCadenceRuleEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const rule = await getCadenceRuleDetail(id);

  if (!rule) {
    return <ErrorState message={`No cadence rule found for id ${id}.`} />;
  }

  const scopeLabel = rule.firm_id
    ? `Override for ${rule.firm_name ?? 'Unknown firm'}`
    : 'Global default (applies to every firm without an override)';

  const initial = {
    cadence_key: rule.cadence_key,
    name: rule.name,
    trigger: parseTriggerConfig(rule.trigger_config),
    exit: parseExitConfig(rule.exit_config),
    enabled: rule.enabled,
    steps: rule.steps,
  };

  return (
    <div className="space-y-5">
      <div className="text-xs text-black/40">
        <Link href="/admin/cadence-rules" className="hover:text-navy">Cadence rules</Link>
        <span className="mx-1.5">›</span>
        <span className="text-black/60">{rule.name}</span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gold">Edit cadence rule</p>
          <h1 className="text-2xl font-bold text-navy mt-1">{rule.name}</h1>
          <p className="text-[11px] font-mono text-black/35 mt-1">{rule.cadence_key}</p>
        </div>
      </div>

      <CadenceRuleEditor
        mode="edit"
        id={rule.id}
        initial={initial}
        scopeLabel={scopeLabel}
        firmOptions={[]}
        initialFirmId={null}
      />
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
