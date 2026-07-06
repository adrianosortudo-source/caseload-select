'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  STAGE_TRANSITION_OPTIONS,
  LEAD_STATUS_OPTIONS,
  CADENCE_TOKENS,
  SAMPLE_TOKEN_VALUES,
  renumberSteps,
  runCopyChecks,
  type ParsedTrigger,
  type ExitConfigForm,
  type CadenceStepForm,
} from '@/lib/cadence-rule-form-pure';
import { interpolateTemplate } from '@/lib/cadence-rules-pure';

export interface CadenceRuleEditorFirmOption {
  id: string;
  name: string;
}

export interface CadenceRuleEditorInitial {
  cadence_key: string;
  name: string;
  trigger: ParsedTrigger;
  exit: ExitConfigForm;
  enabled: boolean;
  steps: CadenceStepForm[];
}

interface SaveStatus {
  kind: 'idle' | 'success' | 'error';
  message?: string;
  errors?: string[];
}

// Local, small, and stable: mirrors MATTER_STAGES from '@/lib/types' but kept
// inline here since only the key+label pairs are needed and importing the
// full MatterStage union/const gives us nothing extra for this checkbox list.
const MATTER_STAGE_OPTIONS: { key: string; label: string }[] = [
  { key: 'intake', label: 'Intake' },
  { key: 'retainer_pending', label: 'Retainer pending' },
  { key: 'active', label: 'Active' },
  { key: 'closing', label: 'Closing' },
  { key: 'closed', label: 'Closed' },
];

/**
 * Operator editor for one cadence_rule (in-house cadence engine, SHADOW MODE
 * only). Mirrors ExplainerEditor's structural conventions: dirty-tracking
 * against a baseline ref, the three inline style objects, the SaveStatus
 * pattern, and the Save-button dirty/clean styling.
 *
 * trigger_type is ALWAYS field_change (the runner only ever evaluates that
 * trigger class; threshold/time_relative are unwired stubs) so it is never
 * exposed as a UI choice here. The two functional shapes within field_change
 * are stage_transition (matter_stage_events sourced) and lead_status
 * (screened_leads sourced); exit_config is a no-op for lead_status runs since
 * those carry no matter_id.
 */
export default function CadenceRuleEditor({
  mode,
  id,
  initial,
  scopeLabel,
  firmOptions,
  initialFirmId,
}: {
  mode: 'create' | 'edit';
  id: string | null;
  initial: CadenceRuleEditorInitial;
  scopeLabel: string;
  firmOptions: CadenceRuleEditorFirmOption[];
  initialFirmId: string | null;
}) {
  const router = useRouter();

  const [cadenceKey, setCadenceKey] = useState(initial.cadence_key);
  const [name, setName] = useState(initial.name);
  const [trigger, setTrigger] = useState<ParsedTrigger>(initial.trigger);
  const [exit, setExit] = useState<ExitConfigForm>(initial.exit);
  const [enabled, setEnabled] = useState<boolean>(initial.enabled);
  const [steps, setSteps] = useState<CadenceStepForm[]>(initial.steps);
  const [selectedFirmId, setSelectedFirmId] = useState<string>(initialFirmId ?? '');

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Dirty-tracking baseline. cadence_key/name/enabled compare directly;
  // trigger/exit/steps compare via JSON.stringify (small plain-data shapes,
  // no functions, so this is safe and simplest).
  const baseline = useRef({
    cadence_key: initial.cadence_key,
    name: initial.name,
    trigger: JSON.stringify(initial.trigger),
    exit: JSON.stringify(initial.exit),
    enabled: initial.enabled,
    steps: JSON.stringify(initial.steps),
    firm_id: initialFirmId ?? '',
  });

  const dirty =
    cadenceKey !== baseline.current.cadence_key ||
    name !== baseline.current.name ||
    JSON.stringify(trigger) !== baseline.current.trigger ||
    JSON.stringify(exit) !== baseline.current.exit ||
    enabled !== baseline.current.enabled ||
    JSON.stringify(steps) !== baseline.current.steps ||
    (mode === 'create' && selectedFirmId !== baseline.current.firm_id);

  function clearStatus() {
    setStatus((s) => (s.kind === 'idle' ? s : { kind: 'idle' }));
  }

  function updateTriggerMode(nextMode: ParsedTrigger['mode']) {
    setTrigger((t) => ({ ...t, mode: nextMode }));
    // Exit conditions are inert for lead_status runs (no matter_id on the
    // run), so force them off when switching into that mode.
    if (nextMode === 'lead_status') {
      setExit((e) => ({ ...e, enabled: false }));
    }
    clearStatus();
  }

  function toggleExitStage(stageKey: string, checked: boolean) {
    setExit((e) => {
      const set = new Set(e.matter_stage_not_in);
      if (checked) set.add(stageKey);
      else set.delete(stageKey);
      return { ...e, matter_stage_not_in: Array.from(set) };
    });
    clearStatus();
  }

  function addStep() {
    setSteps((prev) => {
      const last = prev[prev.length - 1];
      const nextStep: CadenceStepForm = {
        step_number: prev.length + 1,
        delay_hours: (last?.delay_hours ?? 0) + 24,
        subject_template: '',
        body_template: '',
        active: true,
      };
      return [...prev, nextStep];
    });
    clearStatus();
  }

  function removeStep(index: number) {
    setSteps((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    clearStatus();
  }

  function updateStep(index: number, patch: Partial<CadenceStepForm>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    clearStatus();
  }

  const displaySteps = renumberSteps(steps);
  const complianceFindings = runCopyChecks(displaySteps);
  const findingsByStep = new Map<number, typeof complianceFindings>();
  for (const f of complianceFindings) {
    const list = findingsByStep.get(f.step_number) ?? [];
    list.push(f);
    findingsByStep.set(f.step_number, list);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setStatus({ kind: 'idle' });
    setDeleteError(null);
    try {
      const finalSteps = renumberSteps(steps);
      const body: Record<string, unknown> = {
        cadence_key: cadenceKey,
        name,
        trigger,
        exit,
        enabled,
        steps: finalSteps,
      };
      if (mode === 'create') {
        body.firm_id = selectedFirmId || null;
      }

      const url = mode === 'create' ? '/api/admin/cadence-rules' : `/api/admin/cadence-rules/${id}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        setStatus({
          kind: 'error',
          message: json.error === 'validation_failed' ? 'Could not save:' : json.error ?? `HTTP ${res.status}`,
          errors: json.errors,
        });
        return;
      }

      if (mode === 'create') {
        const newId = json.rule?.id ?? json.id;
        if (newId) {
          router.push(`/admin/cadence-rules/${newId}`);
        }
        return;
      }

      // Edit mode: adopt current form state as the new baseline so dirty clears.
      baseline.current = {
        cadence_key: cadenceKey,
        name,
        trigger: JSON.stringify(trigger),
        exit: JSON.stringify(exit),
        enabled,
        steps: JSON.stringify(finalSteps),
        firm_id: selectedFirmId,
      };
      setSteps(finalSteps);
      setStatus({ kind: 'success', message: 'Saved.' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Network error.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    const confirmed = window.confirm(
      'Delete this cadence rule? This cannot be undone unless it has zero shadow enrollments.',
    );
    if (!confirmed) return;
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/cadence-rules/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setDeleteError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push('/admin/cadence-rules');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {/* Cadence key */}
      <div>
        <label htmlFor="cr-key" style={fieldLabel}>Cadence key</label>
        <input
          id="cr-key"
          type="text"
          value={cadenceKey}
          onChange={(e) => { setCadenceKey(e.target.value); clearStatus(); }}
          disabled={mode === 'edit' || saving}
          style={textInputStyle}
        />
      </div>

      {/* Scope */}
      <div>
        <label style={fieldLabel}>Scope</label>
        {mode === 'create' ? (
          <select
            value={selectedFirmId}
            onChange={(e) => { setSelectedFirmId(e.target.value); clearStatus(); }}
            disabled={saving}
            style={selectStyle}
          >
            <option value="">Global default (applies to every firm without an override)</option>
            {firmOptions.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-black/70">{scopeLabel}</p>
        )}
      </div>

      {/* Name */}
      <div>
        <label htmlFor="cr-name" style={fieldLabel}>Name</label>
        <input
          id="cr-name"
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); clearStatus(); }}
          disabled={saving}
          style={textInputStyle}
        />
      </div>

      {/* Enabled */}
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem', color: '#222', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setEnabled(e.target.checked); clearStatus(); }}
            disabled={saving}
            style={{ accentColor: '#1E2F58' }}
          />
          Enabled
        </label>
      </div>

      {/* Trigger */}
      <fieldset className="border border-black/10 p-3 space-y-2">
        <legend style={fieldLabel}>Trigger</legend>
        <div className="flex items-center gap-4">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', color: '#222', cursor: 'pointer' }}>
            <input
              type="radio"
              name="cr-trigger-mode"
              checked={trigger.mode === 'stage_transition'}
              onChange={() => updateTriggerMode('stage_transition')}
              disabled={saving}
              style={{ accentColor: '#1E2F58' }}
            />
            Stage transition
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', color: '#222', cursor: 'pointer' }}>
            <input
              type="radio"
              name="cr-trigger-mode"
              checked={trigger.mode === 'lead_status'}
              onChange={() => updateTriggerMode('lead_status')}
              disabled={saving}
              style={{ accentColor: '#1E2F58' }}
            />
            Lead status change
          </label>
        </div>

        {trigger.mode === 'stage_transition' ? (
          <div>
            <label htmlFor="cr-stage-trigger" style={fieldLabel}>Stage transition</label>
            <select
              id="cr-stage-trigger"
              value={trigger.cadence_trigger}
              onChange={(e) => { setTrigger((t) => ({ ...t, cadence_trigger: e.target.value })); clearStatus(); }}
              disabled={saving}
              style={selectStyle}
            >
              {STAGE_TRANSITION_OPTIONS.map((o) => (
                <option key={o.cadence_trigger} value={o.cadence_trigger}>{o.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label htmlFor="cr-status-trigger" style={fieldLabel}>Lead status</label>
            <select
              id="cr-status-trigger"
              value={trigger.status}
              onChange={(e) => { setTrigger((t) => ({ ...t, status: e.target.value })); clearStatus(); }}
              disabled={saving}
              style={selectStyle}
            >
              {LEAD_STATUS_OPTIONS.map((o) => (
                <option key={o.status} value={o.status}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        <p className="text-xs text-black/50">Only these signals are wired into the cadence engine today.</p>
      </fieldset>

      {/* Exit condition */}
      <fieldset className="border border-black/10 p-3 space-y-2">
        <legend style={fieldLabel}>Exit condition</legend>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem', color: '#222', cursor: trigger.mode === 'lead_status' ? 'not-allowed' : 'pointer' }}>
          <input
            type="checkbox"
            checked={exit.enabled}
            onChange={(e) => { setExit((ex) => ({ ...ex, enabled: e.target.checked })); clearStatus(); }}
            disabled={saving || trigger.mode === 'lead_status'}
            style={{ accentColor: '#1E2F58' }}
          />
          Exit early if the matter&apos;s stage moves on
        </label>

        {trigger.mode === 'lead_status' ? (
          <p className="text-xs text-black/50">Exit conditions apply only to stage-transition cadences.</p>
        ) : (
          exit.enabled && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-6">
              {MATTER_STAGE_OPTIONS.map((s) => (
                <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: '#333', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={exit.matter_stage_not_in.includes(s.key)}
                    onChange={(e) => toggleExitStage(s.key, e.target.checked)}
                    disabled={saving}
                    style={{ accentColor: '#1E2F58' }}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          )
        )}
      </fieldset>

      {/* Token palette */}
      <div className="bg-parchment-2 border border-black/10 px-3 py-2 space-y-1">
        <p style={fieldLabel}>Available tokens</p>
        <div className="space-y-0.5">
          {CADENCE_TOKENS.map((t) => (
            <div key={t.token} className="text-xs text-black/70">
              <span className="font-mono text-navy">{'{' + t.token + '}'}</span>
              {': '}
              {t.description}
            </div>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        <p style={fieldLabel}>Steps</p>
        {displaySteps.map((step, index) => {
          const days = (step.delay_hours / 24).toFixed(1);
          const findings = findingsByStep.get(step.step_number) ?? [];
          const subjectPreview = interpolateTemplate(step.subject_template, SAMPLE_TOKEN_VALUES);
          const bodyPreview = interpolateTemplate(step.body_template, SAMPLE_TOKEN_VALUES);
          return (
            <div key={index} className="border border-black/10 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-navy">Step {step.step_number}</p>
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  disabled={saving || steps.length <= 1}
                  title={steps.length <= 1 ? 'At least one step is required.' : 'Remove this step'}
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    steps.length <= 1 ? 'text-black/25 cursor-not-allowed' : 'text-red-700 hover:underline'
                  }`}
                >
                  Remove
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div style={{ maxWidth: 140 }}>
                  <label style={fieldLabel}>Delay (hours)</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={step.delay_hours}
                    onChange={(e) => updateStep(index, { delay_hours: parseInt(e.target.value, 10) || 0 })}
                    disabled={saving}
                    style={textInputStyle}
                  />
                </div>
                <span className="text-xs text-black/50 mt-4">(~{days} days)</span>
              </div>

              <div>
                <label style={fieldLabel}>Subject</label>
                <input
                  type="text"
                  value={step.subject_template}
                  onChange={(e) => updateStep(index, { subject_template: e.target.value })}
                  disabled={saving}
                  style={textInputStyle}
                />
              </div>

              <div>
                <label style={fieldLabel}>Body</label>
                <textarea
                  value={step.body_template}
                  onChange={(e) => updateStep(index, { body_template: e.target.value })}
                  disabled={saving}
                  rows={3}
                  style={{ ...textInputStyle, resize: 'vertical' }}
                />
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#222', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={step.active}
                  onChange={(e) => updateStep(index, { active: e.target.checked })}
                  disabled={saving}
                  style={{ accentColor: '#1E2F58' }}
                />
                Active
              </label>

              <div className="bg-parchment-2 border border-black/10 px-3 py-2 text-xs text-black/60">
                <p className="font-semibold text-black/50 uppercase tracking-wider text-[10px] mb-1">Preview</p>
                <p className="font-bold text-black/80">{subjectPreview || <span className="italic text-black/35">(empty subject)</span>}</p>
                <p className="mt-1 whitespace-pre-wrap">{bodyPreview || <span className="italic text-black/35">(empty body)</span>}</p>
              </div>

              <div className="text-xs">
                {findings.length === 0 ? (
                  <p className="text-emerald-700">Step {step.step_number}: no issues found</p>
                ) : (
                  <ul className="space-y-0.5">
                    {findings.map((f, fi) => (
                      <li
                        key={fi}
                        className={f.severity === 'fail' ? 'text-red-700' : f.severity === 'warn' ? 'text-amber-700' : 'text-black/50'}
                      >
                        <span className="font-semibold">{f.rule}:</span> {f.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addStep}
          disabled={saving}
          className="text-xs font-semibold uppercase tracking-wider px-4 py-2 border border-navy text-navy hover:bg-navy/5 transition-colors"
        >
          Add step
        </button>
      </div>

      {/* Compliance check */}
      <div className="space-y-1">
        <p style={fieldLabel}>Compliance check</p>
        <div className="bg-parchment-2 border border-black/10 px-3 py-2 space-y-2">
          {displaySteps.map((step) => {
            const findings = findingsByStep.get(step.step_number) ?? [];
            return (
              <div key={step.step_number} className="text-xs">
                {findings.length === 0 ? (
                  <p className="text-emerald-700">Step {step.step_number}: no issues found</p>
                ) : (
                  <div>
                    <p className="text-black/60 font-semibold">Step {step.step_number}:</p>
                    <ul className="space-y-0.5 pl-3">
                      {findings.map((f, fi) => (
                        <li
                          key={fi}
                          className={f.severity === 'fail' ? 'text-red-700' : f.severity === 'warn' ? 'text-amber-700' : 'text-black/50'}
                        >
                          <span className="font-semibold">{f.rule}:</span> {f.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Save bar */}
      <div className="flex items-center gap-3 flex-wrap pt-1">
        <button
          type="submit"
          disabled={!dirty || saving}
          className={`text-xs font-semibold uppercase tracking-wider px-4 py-2 border transition-colors ${
            !dirty || saving
              ? 'border-black/15 bg-black/5 text-black/30 cursor-not-allowed'
              : 'border-navy bg-navy text-white hover:bg-navy/90'
          }`}
        >
          {saving ? 'Saving…' : 'Save cadence rule'}
        </button>
        {dirty && !saving && status.kind === 'idle' && (
          <span className="text-xs text-amber-700 uppercase tracking-wider">Unsaved changes</span>
        )}
        {status.kind === 'success' && <span className="text-xs text-emerald-700">{status.message}</span>}
        {status.kind === 'error' && (
          <div className="text-xs text-red-700">
            <span className="font-semibold">{status.message}</span>
            {status.errors && status.errors.length > 0 && (
              <ul className="list-disc ml-5 mt-1 space-y-0.5">
                {status.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}

        {mode === 'edit' && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              className="text-xs font-semibold uppercase tracking-wider text-red-700 hover:underline"
            >
              Delete cadence rule
            </button>
            {deleteError && <span className="text-xs text-red-700">{deleteError}</span>}
          </div>
        )}
      </div>
    </form>
  );
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontFamily: "'Oxanium', system-ui, sans-serif",
  fontSize: '0.66rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#888',
  marginBottom: 5,
};

const textInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '0.9rem',
  border: '1px solid #C4B49A',
  borderRadius: 4,
  background: '#fff',
  color: '#222',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '0.9rem',
  border: '1px solid #C4B49A',
  borderRadius: 4,
  background: '#fff',
  color: '#222',
  boxSizing: 'border-box',
};
