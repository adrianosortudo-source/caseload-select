'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  PROSPECT_STAGES,
  DEAL_STAGES,
  type AgencyProspect,
  type AgencyReminder,
  type AgencyDeal,
  type ProspectStage,
  type DealStage,
} from '@/lib/agency-crm-types';
import { parseProspectsPaste, type ParsedProspectsResult } from '@/lib/agency-prospect-paste';

type ImportResult = { ok: boolean; received: number; inserted: number; skipped: number; invalid: number; errors: string[] };
const EMPTY_PARSE: ParsedProspectsResult = { rows: [], withFirmName: 0, format: 'empty', error: null };

const STAGE_LABELS: Record<ProspectStage, string> = {
  new: 'New',
  researching: 'Researching',
  contacted: 'Contacted',
  diagnostic_sent: 'Diagnostic sent',
  pitched: 'Pitched',
  won: 'Won',
  lost: 'Lost',
};

const DEAL_LABELS: Record<DealStage, string> = {
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

const INPUT = 'border border-black/15 px-3 py-2 text-sm';
const PANEL = 'bg-white border border-black/10';

export default function AgencyCrmClient({
  initialProspects,
  initialReminders,
  initialDeals,
}: {
  initialProspects: AgencyProspect[];
  initialReminders: AgencyReminder[];
  initialDeals: AgencyDeal[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-prospect form
  const [firmName, setFirmName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [city, setCity] = useState('');
  const [practiceArea, setPracticeArea] = useState('');
  const [source, setSource] = useState('');

  // Add-reminder form
  const [remNote, setRemNote] = useState('');
  const [remDue, setRemDue] = useState('');
  const [remProspect, setRemProspect] = useState('');

  // Add-deal form
  const [dealProspect, setDealProspect] = useState('');
  const [dealTitle, setDealTitle] = useState('');
  const [dealValue, setDealValue] = useState('');

  // Bulk import
  const [importText, setImportText] = useState('');
  const [importParsed, setImportParsed] = useState<ParsedProspectsResult>(EMPTY_PARSE);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const prospectName = (id: string | null): string =>
    initialProspects.find((p) => p.id === id)?.firm_name ?? 'Unlinked';

  async function send(url: string, method: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `Request failed (${res.status})`);
      }
      router.refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addProspect(e: FormEvent) {
    e.preventDefault();
    if (!firmName.trim() || busy) return;
    const ok = await send('/api/admin/agency-crm/prospects', 'POST', {
      firm_name: firmName,
      contact_name: contactName || undefined,
      contact_email: contactEmail || undefined,
      city: city || undefined,
      practice_area: practiceArea || undefined,
      source: source || undefined,
    });
    if (ok) {
      setFirmName(''); setContactName(''); setContactEmail('');
      setCity(''); setPracticeArea(''); setSource('');
    }
  }

  async function addReminder(e: FormEvent) {
    e.preventDefault();
    if (!remNote.trim() || !remDue || busy) return;
    const ok = await send('/api/admin/agency-crm/reminders', 'POST', {
      note: remNote,
      due_at: new Date(remDue).toISOString(),
      prospect_id: remProspect || undefined,
    });
    if (ok) { setRemNote(''); setRemDue(''); setRemProspect(''); }
  }

  async function addDeal(e: FormEvent) {
    e.preventDefault();
    if (!dealProspect || !dealTitle.trim() || busy) return;
    const value = dealValue.trim() === '' ? undefined : Number(dealValue);
    if (value !== undefined && !Number.isFinite(value)) { setError('Monthly value must be a number'); return; }
    const ok = await send('/api/admin/agency-crm/deals', 'POST', {
      prospect_id: dealProspect,
      title: dealTitle,
      monthly_value: value,
    });
    if (ok) { setDealProspect(''); setDealTitle(''); setDealValue(''); }
  }

  function onImportTextChange(v: string) {
    setImportText(v);
    setImportParsed(parseProspectsPaste(v));
    setImportResult(null);
    setImportError(null);
  }

  async function runImport() {
    if (importParsed.withFirmName === 0 || busy) return;
    setBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch('/api/admin/agency-crm/prospects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: importParsed.rows }),
      });
      const j = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { error?: string };
      if (typeof j.inserted === 'number') {
        const result: ImportResult = {
          ok: j.ok ?? res.ok,
          received: j.received ?? 0,
          inserted: j.inserted,
          skipped: j.skipped ?? 0,
          invalid: j.invalid ?? 0,
          errors: j.errors ?? [],
        };
        setImportResult(result);
        if (result.ok && res.ok && result.errors.length === 0) {
          setImportText('');
          setImportParsed(EMPTY_PARSE);
        } else {
          // Partial failure: keep the pasted text so the operator can re-run (dedupe makes it safe).
          setImportError(j.error ?? `${result.errors.length} insert chunk(s) failed`);
        }
        router.refresh();
      } else {
        throw new Error(j.error ?? `Import failed (${res.status})`);
      }
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const openPipelineValue = initialDeals
    .filter((d) => d.stage === 'proposal' || d.stage === 'negotiation')
    .reduce((sum, d) => sum + (d.monthly_value ?? 0), 0);

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-white border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Bulk import */}
      <details className={`${PANEL} p-4`}>
        <summary className="text-xs uppercase tracking-wider font-semibold text-gold cursor-pointer">Bulk import prospects</summary>
        <p className="text-xs text-black/50 mt-2 max-w-3xl">
          Paste a JSON array or CSV with a header row. Recognized columns: firm_name (required), contact_name,
          contact_email, contact_phone, city, practice_area, source, stage, fit_score, notes. Duplicates (firm name plus
          city) are skipped. For the full toronto_law_firms export, run scripts/import-agency-prospects.mjs instead.
        </p>
        <textarea
          className={`${INPUT} w-full mt-3 font-mono text-xs`}
          rows={6}
          spellCheck={false}
          placeholder={'[{"firm_name":"Example Law","city":"Toronto","contact_email":"hello@example.ca"}]'}
          value={importText}
          onChange={(e) => onImportTextChange(e.target.value)}
        />
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <button
            type="button"
            onClick={runImport}
            disabled={busy || importParsed.withFirmName === 0}
            className="bg-navy text-white text-xs uppercase tracking-wider font-bold px-4 py-2 disabled:opacity-50"
          >
            {busy ? 'Importing' : `Import ${importParsed.withFirmName} prospect${importParsed.withFirmName === 1 ? '' : 's'}`}
          </button>
          {importText.trim() !== '' && importParsed.error && (
            <span className="text-xs text-red-700">{importParsed.error}</span>
          )}
          {importText.trim() !== '' && !importParsed.error && importParsed.withFirmName > 0 && (
            <span className="text-xs text-black/50">{importParsed.withFirmName} ready ({importParsed.format})</span>
          )}
          {importError && <span className="text-xs text-red-700">{importError}</span>}
          {importResult && (
            <span className={`text-xs ${importResult.ok ? 'text-black/60' : 'text-red-700'}`}>
              Inserted {importResult.inserted}, skipped {importResult.skipped}, invalid {importResult.invalid}.
            </span>
          )}
          {importResult && importResult.errors.length > 0 && (
            <span className="text-xs text-red-700 w-full">
              {importResult.errors.length} chunk error{importResult.errors.length === 1 ? '' : 's'}: {importResult.errors.join('; ')}
            </span>
          )}
        </div>
      </details>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Add prospect */}
        <form onSubmit={addProspect} className={`${PANEL} p-4 grid gap-3 sm:grid-cols-2`}>
          <div className="sm:col-span-2 text-xs uppercase tracking-wider font-semibold text-gold">Add a prospect</div>
          <input className={INPUT} placeholder="Firm name (required)" value={firmName} onChange={(e) => setFirmName(e.target.value)} />
          <input className={INPUT} placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <input className={INPUT} placeholder="Contact email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          <input className={INPUT} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <input className={INPUT} placeholder="Practice area" value={practiceArea} onChange={(e) => setPracticeArea(e.target.value)} />
          <input className={INPUT} placeholder="Source" value={source} onChange={(e) => setSource(e.target.value)} />
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy || !firmName.trim()} className="bg-navy text-white text-xs uppercase tracking-wider font-bold px-4 py-2 disabled:opacity-50">
              {busy ? 'Saving' : 'Add prospect'}
            </button>
          </div>
        </form>

        {/* Add reminder */}
        <form onSubmit={addReminder} className={`${PANEL} p-4 grid gap-3`}>
          <div className="text-xs uppercase tracking-wider font-semibold text-gold">Add a reminder</div>
          <input className={INPUT} placeholder="What to do" value={remNote} onChange={(e) => setRemNote(e.target.value)} />
          <input type="datetime-local" className={INPUT} value={remDue} onChange={(e) => setRemDue(e.target.value)} />
          <select className={INPUT} value={remProspect} onChange={(e) => setRemProspect(e.target.value)}>
            <option value="">No prospect</option>
            {initialProspects.map((p) => <option key={p.id} value={p.id}>{p.firm_name}</option>)}
          </select>
          <div>
            <button type="submit" disabled={busy || !remNote.trim() || !remDue} className="bg-navy text-white text-xs uppercase tracking-wider font-bold px-4 py-2 disabled:opacity-50">
              {busy ? 'Saving' : 'Add reminder'}
            </button>
          </div>
        </form>
      </div>

      {/* Pipeline */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PROSPECT_STAGES.map((stage) => {
          const inStage = initialProspects.filter((p) => p.stage === stage);
          return (
            <div key={stage} className={PANEL}>
              <div className="px-3 py-2 border-b border-black/10 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider font-bold text-navy">{STAGE_LABELS[stage]}</span>
                <span className="font-mono text-[10px] text-black/40">{inStage.length}</span>
              </div>
              <ul className="divide-y divide-black/5">
                {inStage.length === 0 ? (
                  <li className="px-3 py-3 text-xs text-black/40">Empty</li>
                ) : inStage.map((p) => (
                  <li key={p.id} className="px-3 py-3">
                    <div className="text-sm font-semibold text-navy">{p.firm_name}</div>
                    <div className="text-xs text-black/60 mt-0.5">
                      {[p.contact_name, p.city, p.practice_area].filter(Boolean).join(' · ') || 'No details yet'}
                    </div>
                    {p.source && <div className="text-[10px] uppercase tracking-wider text-black/40 mt-1">{p.source}</div>}
                    <div className="mt-2">
                      <label className="sr-only" htmlFor={`stage-${p.id}`}>Stage</label>
                      <select
                        id={`stage-${p.id}`}
                        value={p.stage}
                        disabled={busy}
                        onChange={(e) => send(`/api/admin/agency-crm/prospects/${p.id}`, 'PATCH', { stage: e.target.value })}
                        className="border border-black/15 text-xs px-2 py-1"
                      >
                        {PROSPECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Deals */}
      <div className={PANEL}>
        <div className="px-4 py-2 border-b border-black/10 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider font-bold text-navy">Deals</span>
          <span className="text-[11px] text-black/50">Open pipeline: C${openPipelineValue.toLocaleString()}/mo</span>
        </div>

        <form onSubmit={addDeal} className="px-4 py-3 border-b border-black/10 grid gap-2 sm:grid-cols-4 items-center">
          <select className={INPUT} value={dealProspect} onChange={(e) => setDealProspect(e.target.value)}>
            <option value="">Prospect…</option>
            {initialProspects.map((p) => <option key={p.id} value={p.id}>{p.firm_name}</option>)}
          </select>
          <input className={INPUT} placeholder="Title" value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} />
          <input className={INPUT} placeholder="C$/mo" value={dealValue} onChange={(e) => setDealValue(e.target.value)} inputMode="decimal" />
          <button type="submit" disabled={busy || !dealProspect || !dealTitle.trim()} className="bg-navy text-white text-xs uppercase tracking-wider font-bold px-4 py-2 disabled:opacity-50">
            {busy ? 'Saving' : 'Add deal'}
          </button>
        </form>

        {initialDeals.length === 0 ? (
          <p className="px-4 py-4 text-xs text-black/40">No deals yet.</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {initialDeals.map((d) => (
              <li key={d.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-navy">{d.title}</div>
                  <div className="text-xs text-black/50">
                    {prospectName(d.prospect_id)}{d.monthly_value != null ? ` · C$${d.monthly_value.toLocaleString()}/mo` : ''}
                  </div>
                </div>
                <select
                  value={d.stage}
                  disabled={busy}
                  onChange={(e) => send(`/api/admin/agency-crm/deals/${d.id}`, 'PATCH', { stage: e.target.value })}
                  className="border border-black/15 text-xs px-2 py-1"
                  aria-label="Deal stage"
                >
                  {DEAL_STAGES.map((s) => <option key={s} value={s}>{DEAL_LABELS[s]}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Open reminders */}
      <div className={PANEL}>
        <div className="px-4 py-2 border-b border-black/10 text-xs uppercase tracking-wider font-bold text-navy">
          Open reminders <span className="font-mono text-[10px] text-black/40">{initialReminders.length}</span>
        </div>
        {initialReminders.length === 0 ? (
          <p className="px-4 py-4 text-xs text-black/40">No open reminders.</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {initialReminders.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={false}
                  disabled={busy}
                  onChange={() => send(`/api/admin/agency-crm/reminders/${r.id}`, 'PATCH', { done: true })}
                  className="mt-1"
                  aria-label="Mark reminder done"
                />
                <div className="min-w-0">
                  <div className="text-sm text-black/80">{r.note}</div>
                  <div className="text-[11px] text-black/40 mt-0.5">
                    Due {new Date(r.due_at).toLocaleString()}
                    {r.prospect_id ? ` · ${prospectName(r.prospect_id)}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
