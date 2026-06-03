'use client';

/**
 * Operator routing config editor (#144). Edits the live per-firm routing
 * fields: a per-practice-area lead lawyer, a firm fallback lead, and a flat
 * default-assignee list. Honest about unconfigured states and the real
 * resolution order, and shows a live "what happens now" target per practice
 * area using the SAME resolver the take path uses (firm-routing-pure).
 *
 * Explicit save (no autosave). Surfaces dirty / saving / success / error.
 */

import { useMemo, useState } from 'react';
import {
  ROUTING_PRACTICE_AREAS,
  resolveMatterLeadWithSource,
  type FirmRoutingConfig,
} from '@/lib/firm-routing-pure';
import { practiceAreaLabel } from '@/lib/screened-leads-labels';

export interface LawyerOption {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
}

interface RoutingConfig {
  default_lead_by_practice_area: Record<string, string>;
  default_lead_id: string | null;
  default_assignees: string[];
}

interface SaveStatus {
  kind: 'idle' | 'success' | 'error';
  message?: string;
  errors?: string[];
}

function normalize(c: RoutingConfig): string {
  const pa: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.default_lead_by_practice_area)) {
    if (v && v.trim()) pa[k] = v.trim();
  }
  const keys = Object.keys(pa).sort();
  const paStr = keys.map((k) => `${k}=${pa[k]}`).join(',');
  const assignees = [...c.default_assignees].filter(Boolean).sort().join(',');
  return `${paStr}|${c.default_lead_id ?? ''}|${assignees}`;
}

export default function RoutingConfigPanel({
  firmId,
  firmName,
  lawyers,
  initialConfig,
}: {
  firmId: string;
  firmName: string;
  lawyers: LawyerOption[];
  initialConfig: RoutingConfig;
}) {
  const [paLeads, setPaLeads] = useState<Record<string, string>>(
    initialConfig.default_lead_by_practice_area,
  );
  const [fallbackLead, setFallbackLead] = useState<string>(initialConfig.default_lead_id ?? '');
  const [assignees, setAssignees] = useState<string[]>(initialConfig.default_assignees);
  const [baseline, setBaseline] = useState<string>(() => normalize(initialConfig));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });

  const lawyerName = useMemo(() => {
    const m = new Map(lawyers.map((l) => [l.id, l.name] as const));
    return (id: string | null | undefined) => (id ? m.get(id) ?? 'Unknown lawyer' : null);
  }, [lawyers]);

  const current: RoutingConfig = {
    default_lead_by_practice_area: paLeads,
    default_lead_id: fallbackLead || null,
    default_assignees: assignees,
  };
  const dirty = normalize(current) !== baseline;
  const hasLawyers = lawyers.length > 0;
  const liveConfig: FirmRoutingConfig = current;

  function setPaLead(pa: string, id: string) {
    setStatus({ kind: 'idle' });
    setPaLeads((prev) => {
      const next = { ...prev };
      if (id) next[pa] = id;
      else delete next[pa];
      return next;
    });
  }

  function toggleAssignee(id: string) {
    setStatus({ kind: 'idle' });
    setAssignees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    setSaving(true);
    setStatus({ kind: 'idle' });
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/routing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_lead_by_practice_area: paLeads,
          default_lead_id: fallbackLead || null,
          default_assignees: assignees,
        }),
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
      const saved: RoutingConfig = {
        default_lead_by_practice_area: json.config?.default_lead_by_practice_area ?? {},
        default_lead_id: json.config?.default_lead_id ?? null,
        default_assignees: json.config?.default_assignees ?? [],
      };
      setPaLeads(saved.default_lead_by_practice_area);
      setFallbackLead(saved.default_lead_id ?? '');
      setAssignees(saved.default_assignees);
      setBaseline(normalize(saved));
      setStatus({ kind: 'success', message: 'Routing saved. Applies to new matters from now on.' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Network error.' });
    } finally {
      setSaving(false);
    }
  }

  if (!hasLawyers) {
    return (
      <div className="bg-white border border-amber-300 px-6 py-6">
        <p className="text-sm text-amber-900 font-semibold">No lawyers on this firm yet.</p>
        <p className="text-sm text-black/60 mt-1">
          Routing assigns a lead lawyer + assignees from this firm&apos;s <code>firm_lawyers</code> rows.
          Add at least one lawyer to <strong>{firmName}</strong> before configuring routing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-black/60 max-w-3xl">
        How a new matter is routed when a lead is taken for <strong>{firmName}</strong>. A matter&apos;s
        lead lawyer is the <strong>practice-area default</strong> if one is set, otherwise the{' '}
        <strong>firm fallback lead</strong>, otherwise no lead is assigned. Default assignees are added to
        every new matter. Changes apply to <strong>new matters only</strong>; matters already taken keep the
        lawyer assigned at the time.
      </p>

      {/* Firm fallback lead */}
      <section className="bg-white border border-black/10">
        <SectionHead title="Firm fallback lead" />
        <div className="px-4 py-4 space-y-2">
          <p className="text-xs text-black/50">
            Used for any practice area without its own default below (and for unclassified leads).
          </p>
          <LawyerSelect
            value={fallbackLead}
            lawyers={lawyers}
            unsetLabel="Not configured — no lead assigned when no PA default matches"
            onChange={(id) => {
              setStatus({ kind: 'idle' });
              setFallbackLead(id);
            }}
          />
          {!fallbackLead && (
            <p className="text-xs text-amber-700">
              With no fallback lead, a taken matter whose practice area has no default below is created with
              <strong> no lead lawyer</strong>.
            </p>
          )}
        </div>
      </section>

      {/* Practice-area leads */}
      <section className="bg-white border border-black/10">
        <SectionHead title="Practice-area leads" />
        <table className="w-full text-xs">
          <thead className="bg-parchment-2 border-b border-black/10">
            <tr className="text-left text-black/50 uppercase tracking-wider">
              <th className="px-4 py-2 font-semibold w-[34%]">Practice area</th>
              <th className="px-4 py-2 font-semibold">Lead lawyer</th>
              <th className="px-4 py-2 font-semibold w-[30%]">A lead taken now goes to</th>
            </tr>
          </thead>
          <tbody>
            {ROUTING_PRACTICE_AREAS.map((pa) => {
              const resolved = resolveMatterLeadWithSource(liveConfig, pa);
              return (
                <tr key={pa} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-2 align-middle text-black/80">{practiceAreaLabel(pa)}</td>
                  <td className="px-4 py-2 align-middle">
                    <LawyerSelect
                      value={paLeads[pa] ?? ''}
                      lawyers={lawyers}
                      unsetLabel="Not configured"
                      onChange={(id) => setPaLead(pa, id)}
                    />
                  </td>
                  <td className="px-4 py-2 align-middle">
                    {resolved.source === 'none' ? (
                      <span className="text-amber-700">No lead assigned</span>
                    ) : resolved.source === 'firm_fallback' ? (
                      <span className="text-black/55">
                        {lawyerName(resolved.leadId)}{' '}
                        <span className="text-black/35">(firm fallback)</span>
                      </span>
                    ) : (
                      <span className="text-black/70">{lawyerName(resolved.leadId)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Default assignees */}
      <section className="bg-white border border-black/10">
        <SectionHead title="Default assignees" />
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-black/50">
            Snapshotted onto every new matter, regardless of practice area. Independent of the lead lawyer.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {lawyers.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-xs text-black/75 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assignees.includes(l.id)}
                  onChange={() => toggleAssignee(l.id)}
                  className="accent-navy"
                />
                <span>
                  {l.name}
                  {l.role && l.role !== 'lawyer' ? (
                    <span className="text-black/35 ml-1 uppercase tracking-wider text-[10px]">{l.role}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          {assignees.length === 0 && (
            <p className="text-xs text-black/45">
              No default assignees. New matters start with only the lead lawyer (if any).
            </p>
          )}
        </div>
      </section>

      {/* Save bar */}
      <div className="flex items-center gap-3 flex-wrap sticky bottom-0 bg-parchment/95 py-3 -mx-1 px-1 border-t border-black/10">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className={`text-xs font-semibold uppercase tracking-wider px-4 py-2 border transition-colors ${
            !dirty || saving
              ? 'border-black/15 bg-black/5 text-black/30 cursor-not-allowed'
              : 'border-navy bg-navy text-white hover:bg-navy/90'
          }`}
        >
          {saving ? 'Saving…' : 'Save routing'}
        </button>
        {dirty && !saving && status.kind === 'idle' && (
          <span className="text-xs text-amber-700 uppercase tracking-wider">Unsaved changes</span>
        )}
        {status.kind === 'success' && (
          <span className="text-xs text-emerald-700">{status.message}</span>
        )}
        {status.kind === 'error' && (
          <div className="text-xs text-red-700">
            <span className="font-semibold">{status.message}</span>
            {status.errors && status.errors.length > 0 && (
              <ul className="list-disc ml-5 mt-1 space-y-0.5">
                {status.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <div className="px-4 py-2.5 border-b border-black/8 bg-parchment/40">
      <h2 className="text-xs uppercase tracking-wider font-semibold text-navy">{title}</h2>
    </div>
  );
}

function LawyerSelect({
  value,
  lawyers,
  unsetLabel,
  onChange,
}: {
  value: string;
  lawyers: LawyerOption[];
  unsetLabel: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs px-2 py-1.5 border border-black/15 bg-white text-black/80 focus:outline-none focus:border-navy w-full max-w-sm"
    >
      <option value="">{unsetLabel}</option>
      {lawyers.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
          {l.title ? ` — ${l.title}` : ''}
        </option>
      ))}
    </select>
  );
}
