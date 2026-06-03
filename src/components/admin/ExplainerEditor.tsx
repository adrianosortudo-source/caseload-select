'use client';

import { useRef, useState } from 'react';
import RichTextEditor, { type RichTextEditorHandle } from '@/components/RichTextEditor';

export interface SelectOption {
  value: string;
  label: string;
}

interface ExplainerInitial {
  title: string;
  body_html: string;
  practice_area: string;
  matter_stage: string;
  ordering: number;
  published: boolean;
}

interface SaveStatus {
  kind: 'idle' | 'success' | 'error';
  message?: string;
  errors?: string[];
}

/**
 * Operator editor for one explainer_article (S8 Phase 2). Title + metadata
 * fields + the shared RichTextEditor for the body. Explicit save through
 * PATCH /api/admin/explainers/[id], which sanitizes body_html and returns the
 * canonical article; this component adopts it (so the operator sees exactly
 * what's stored). Dirty = any metadata change OR a body edit.
 */
export default function ExplainerEditor({
  id,
  initial,
  practiceAreaOptions,
  stageOptions,
}: {
  id: string;
  initial: ExplainerInitial;
  practiceAreaOptions: SelectOption[];
  stageOptions: SelectOption[];
}) {
  const editorRef = useRef<RichTextEditorHandle>(null);

  const [title, setTitle] = useState(initial.title);
  const [practiceArea, setPracticeArea] = useState(initial.practice_area);
  const [matterStage, setMatterStage] = useState(initial.matter_stage);
  const [ordering, setOrdering] = useState<number>(initial.ordering);
  const [published, setPublished] = useState<boolean>(initial.published);

  const [bodyDirty, setBodyDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });

  // Metadata baseline for dirty comparison; reset to canonical values on save.
  const baseline = useRef<Omit<ExplainerInitial, 'body_html'>>({
    title: initial.title,
    practice_area: initial.practice_area,
    matter_stage: initial.matter_stage,
    ordering: initial.ordering,
    published: initial.published,
  });

  const metaDirty =
    title !== baseline.current.title ||
    practiceArea !== baseline.current.practice_area ||
    matterStage !== baseline.current.matter_stage ||
    ordering !== baseline.current.ordering ||
    published !== baseline.current.published;
  const dirty = metaDirty || bodyDirty;

  function clearStatus() {
    setStatus((s) => (s.kind === 'idle' ? s : { kind: 'idle' }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setStatus({ kind: 'idle' });
    try {
      const res = await fetch(`/api/admin/explainers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body_html: editorRef.current?.getHtml() ?? '',
          practice_area: practiceArea,
          matter_stage: matterStage,
          ordering,
          published,
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
      // Adopt canonical saved values.
      const a = json.article as ExplainerInitial;
      setTitle(a.title);
      setPracticeArea(a.practice_area);
      setMatterStage(a.matter_stage);
      setOrdering(a.ordering);
      setPublished(a.published);
      baseline.current = {
        title: a.title,
        practice_area: a.practice_area,
        matter_stage: a.matter_stage,
        ordering: a.ordering,
        published: a.published,
      };
      editorRef.current?.setHtml(a.body_html ?? ''); // clears bodyDirty
      setStatus({ kind: 'success', message: a.published ? 'Saved and published.' : 'Saved as draft.' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Network error.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {/* Title */}
      <div>
        <label htmlFor="ex-title" style={fieldLabel}>Title</label>
        <input
          id="ex-title"
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            clearStatus();
          }}
          disabled={saving}
          style={textInputStyle}
        />
      </div>

      {/* Body */}
      <div>
        <span style={fieldLabel}>Body</span>
        <RichTextEditor
          ref={editorRef}
          initialHtml={initial.body_html}
          disabled={saving}
          ariaLabel="Explainer body editor"
          minHeight={320}
          onError={(m) => m && setStatus({ kind: 'error', message: m })}
          onDirtyChange={(d) => {
            setBodyDirty(d);
            if (d) clearStatus();
          }}
        />
      </div>

      {/* Metadata row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="ex-pa" style={fieldLabel}>Practice area</label>
          <select
            id="ex-pa"
            value={practiceArea}
            onChange={(e) => { setPracticeArea(e.target.value); clearStatus(); }}
            disabled={saving}
            style={selectStyle}
          >
            {practiceAreaOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ex-stage" style={fieldLabel}>Matter stage</label>
          <select
            id="ex-stage"
            value={matterStage}
            onChange={(e) => { setMatterStage(e.target.value); clearStatus(); }}
            disabled={saving}
            style={selectStyle}
          >
            {stageOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ex-order" style={fieldLabel}>Ordering</label>
          <input
            id="ex-order"
            type="number"
            min={0}
            step={1}
            value={Number.isFinite(ordering) ? ordering : 0}
            onChange={(e) => { setOrdering(parseInt(e.target.value, 10) || 0); clearStatus(); }}
            disabled={saving}
            style={{ ...textInputStyle, maxWidth: 120 }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem', color: '#222', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => { setPublished(e.target.checked); clearStatus(); }}
              disabled={saving}
              style={{ accentColor: '#1E2F58' }}
            />
            Published (visible to clients)
          </label>
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
          {saving ? 'Saving…' : 'Save explainer'}
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
