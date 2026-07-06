/**
 * PATCH  /api/admin/cadence-rules/[id]  -> update a cadence_rules row (+ steps).
 * DELETE /api/admin/cadence-rules/[id]  -> delete a cadence_rules row.
 *
 * Operator-gated (getOperatorSession). cadence_key is immutable on update:
 * the existing row's value is fetched and forced onto the input regardless of
 * what the client sends. Same field_change-only discipline as the collection
 * route: trigger_type is never accepted from the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { updateCadenceRule, deleteCadenceRule } from '@/lib/cadence-rule-admin';
import {
  validateRuleForm,
  renumberSteps,
  buildTriggerConfig,
  buildExitConfig,
  type ParsedTrigger,
  type ExitConfigForm,
  type CadenceStepForm,
  type RuleFormInput,
} from '@/lib/cadence-rule-form-pure';

export const dynamic = 'force-dynamic';

interface CadenceRulePatchBody {
  cadence_key?: unknown;
  name?: unknown;
  firm_id?: unknown;
  trigger?: unknown;
  exit?: unknown;
  enabled?: unknown;
  steps?: unknown;
}

function coerceTrigger(raw: unknown): ParsedTrigger {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const mode: ParsedTrigger['mode'] = obj.mode === 'lead_status' ? 'lead_status' : 'stage_transition';
  const cadence_trigger = typeof obj.cadence_trigger === 'string' ? obj.cadence_trigger : '';
  const status = typeof obj.status === 'string' ? obj.status : '';
  return { mode, cadence_trigger, status };
}

function coerceExit(raw: unknown): ExitConfigForm {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const enabled = obj.enabled === true;
  const matter_stage_not_in = Array.isArray(obj.matter_stage_not_in)
    ? obj.matter_stage_not_in.filter((v): v is string => typeof v === 'string')
    : [];
  return { enabled, matter_stage_not_in };
}

function coerceSteps(raw: unknown): CadenceStepForm[] {
  const arr = Array.isArray(raw) ? raw : [];
  const rawSteps: CadenceStepForm[] = arr.map((item) => {
    const obj = (item && typeof item === 'object') ? (item as Record<string, unknown>) : {};
    const delay_hours = typeof obj.delay_hours === 'number' ? obj.delay_hours : NaN;
    const subject_template = typeof obj.subject_template === 'string' ? obj.subject_template : '';
    const body_template = typeof obj.body_template === 'string' ? obj.body_template : '';
    const active = obj.active !== false;
    return {
      step_number: typeof obj.step_number === 'number' ? obj.step_number : 0,
      delay_hours,
      subject_template,
      body_template,
      active,
    };
  });
  return renumberSteps(rawSteps);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const { data: existing, error: fetchErr } = await supabase
    .from('cadence_rules')
    .select('id, cadence_key')
    .eq('id', id)
    .maybeSingle<{ id: string; cadence_key: string }>();

  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'rule not found' }, { status: 404 });
  }

  let body: CadenceRulePatchBody;
  try {
    body = (await req.json()) as CadenceRulePatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const trigger = coerceTrigger(body.trigger);
  const exit = coerceExit(body.exit);
  const steps = coerceSteps(body.steps);

  const input: RuleFormInput = {
    cadence_key: existing.cadence_key,
    name: typeof body.name === 'string' ? body.name.trim() : '',
    trigger,
    exit,
    enabled: body.enabled !== false,
    steps,
  };

  const errors = validateRuleForm(input);
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, error: 'validation_failed', errors }, { status: 400 });
  }

  const result = await updateCadenceRule(id, {
    cadence_key: input.cadence_key,
    name: input.name,
    firm_id: null,
    trigger_config: buildTriggerConfig(input.trigger),
    exit_config: buildExitConfig(input.exit),
    enabled: input.enabled,
    steps: input.steps.map((s) => ({
      step_number: s.step_number,
      delay_hours: s.delay_hours,
      subject_template: s.subject_template,
      body_template: s.body_template,
      active: s.active,
    })),
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: result.id });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const result = await deleteCadenceRule(id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
