/**
 * /admin/cadence-rules/new
 *
 * Create surface for a new cadence_rules row. Supports two entry points:
 * - Blank new journey (default trigger: first stage-transition option).
 * - "+ Override" from the list page (?copy_from=<globalRuleId>&firm_id=<id>),
 *   which pre-fills every field from the source global rule so the operator
 *   is editing a firm-specific copy, not starting from scratch.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import Link from 'next/link';
import { getCadenceRuleDetail, listFirmsForPicker } from '@/lib/cadence-rule-admin';
import {
  parseTriggerConfig,
  parseExitConfig,
  STAGE_TRANSITION_OPTIONS,
  type ParsedTrigger,
  type ExitConfigForm,
} from '@/lib/cadence-rule-form-pure';
import CadenceRuleEditor from '@/components/admin/CadenceRuleEditor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface CadenceStepForm {
  step_number: number;
  delay_hours: number;
  subject_template: string;
  body_template: string;
  active: boolean;
}

interface NewRuleInitial {
  cadence_key: string;
  name: string;
  trigger: ParsedTrigger;
  exit: ExitConfigForm;
  enabled: boolean;
  steps: CadenceStepForm[];
}

export default async function AdminNewCadenceRulePage({
  searchParams,
}: {
  searchParams: Promise<{ copy_from?: string; firm_id?: string }>;
}) {
  const { copy_from, firm_id } = await searchParams;

  const firmOptions = await listFirmsForPicker();

  let initial: NewRuleInitial = {
    cadence_key: '',
    name: '',
    trigger: {
      mode: 'stage_transition',
      cadence_trigger: STAGE_TRANSITION_OPTIONS[0].cadence_trigger,
      status: '',
    },
    exit: { enabled: false, matter_stage_not_in: [] },
    enabled: true,
    steps: [
      { step_number: 1, delay_hours: 0, subject_template: '', body_template: '', active: true },
    ],
  };
  let sourceName: string | null = null;

  if (copy_from) {
    const source = await getCadenceRuleDetail(copy_from);
    if (source) {
      sourceName = source.name;
      initial = {
        cadence_key: source.cadence_key,
        name: `${source.name} (copy)`,
        trigger: parseTriggerConfig(source.trigger_config),
        exit: parseExitConfig(source.exit_config),
        enabled: source.enabled,
        steps: source.steps.map((s) => ({ ...s })),
      };
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-xs text-black/40">
        <Link href="/admin/cadence-rules" className="hover:text-navy">Cadence rules</Link>
        <span className="mx-1.5">›</span>
        <span className="text-black/60">New</span>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">New cadence rule</p>
        <h1 className="text-2xl font-bold text-navy mt-1">
          {sourceName ? `Override: ${sourceName}` : 'New cadence rule'}
        </h1>
      </div>

      <CadenceRuleEditor
        mode="create"
        id={null}
        initial={initial}
        scopeLabel=""
        firmOptions={firmOptions}
        initialFirmId={firm_id ?? null}
      />
    </div>
  );
}
