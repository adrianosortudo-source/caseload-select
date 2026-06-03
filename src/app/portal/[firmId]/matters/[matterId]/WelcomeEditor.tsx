'use client';

import { useRef, useState } from 'react';
import RichTextEditor, { type RichTextEditorHandle } from '@/components/RichTextEditor';

/**
 * Lawyer-side welcome-draft editor (S8 Phase 2). Thin wrapper over the shared
 * RichTextEditor: this owns the save / reset / send flow; the editing surface +
 * toolbar live in RichTextEditor.
 *
 * Saved-output compatibility: the server SANITIZES on PATCH (lib/welcome-html
 * -sanitize) and returns the canonical HTML, which the editor adopts via
 * setHtml — so the lawyer always sees exactly what's stored/sent and nothing
 * reaches the client unsanitized. Explicit save (no autosave).
 */
export default function WelcomeEditor({
  firmId,
  matterId,
  originalHtml,
  initialEditedHtml,
  isSent,
}: {
  firmId: string;
  matterId: string;
  originalHtml: string;
  initialEditedHtml: string | null;
  isSent: boolean;
}) {
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = saving || sending;

  // Sent matters render read-only. (The matter page only mounts this editor
  // for unsent matters, so this is a defensive branch; the body shown is the
  // firm-authored draft, server-sanitized on save.)
  if (isSent) {
    return (
      <div>
        <p style={labelStyle}>Sent welcome (read-only)</p>
        <div
          style={readOnlyStyle}
          dangerouslySetInnerHTML={{ __html: initialEditedHtml ?? originalHtml ?? '' }}
        />
      </div>
    );
  }

  async function save(): Promise<boolean> {
    const html = editorRef.current?.getHtml() ?? '';
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/matters/${matterId}/welcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited_html: html }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Could not save. Please try again.');
        return false;
      }
      // Adopt the server's canonical sanitized HTML (clears dirty via setHtml).
      editorRef.current?.setHtml(typeof json.edited_html === 'string' ? json.edited_html : '');
      setSavedAt(new Date().toLocaleTimeString('en-CA', { timeStyle: 'short' }));
      return true;
    } catch (err) {
      setError(err instanceof Error ? `Network error: ${err.message}` : 'Network error.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function onSaveSubmit(e: React.FormEvent) {
    e.preventDefault();
    void save();
  }

  function onReset() {
    editorRef.current?.setHtml(originalHtml ?? '');
    setSavedAt(null);
    setError(null);
  }

  async function onSend() {
    if (dirty) {
      const ok = window.confirm(
        'You have unsaved edits. Save them and send the welcome to the client?',
      );
      if (!ok) return;
      const saved = await save();
      if (!saved) return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portal/${firmId}/matters/${matterId}/welcome/send`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Send failed.');
        setSending(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? `Network error: ${err.message}` : 'Network error.');
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSaveSubmit}>
      <p style={labelStyle}>Welcome message</p>

      <RichTextEditor
        ref={editorRef}
        initialHtml={initialEditedHtml ?? originalHtml ?? ''}
        disabled={busy}
        ariaLabel="Welcome message editor"
        onError={setError}
        onDirtyChange={(d) => {
          setDirty(d);
          if (d) setSavedAt(null);
        }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" disabled={!dirty || busy} style={primaryButtonStyle(!dirty || busy)}>
          {saving ? 'Saving…' : 'Save edits'}
        </button>
        <button type="button" onClick={onReset} disabled={busy} style={secondaryButtonStyle(busy)}>
          Reset to original
        </button>
        <button type="button" onClick={onSend} disabled={busy} style={sendButtonStyle(busy)}>
          {sending ? 'Sending…' : 'Send welcome'}
        </button>
        {dirty && !savedAt && (
          <span style={{ fontSize: '0.78rem', color: '#C97A4A', marginLeft: 4 }}>Unsaved edits</span>
        )}
        {savedAt && !dirty && (
          <span style={{ fontSize: '0.78rem', color: '#4a7d4a', marginLeft: 4 }}>✓ Saved at {savedAt}</span>
        )}
      </div>
      {error && (
        <p style={{ fontSize: '0.84rem', color: '#C97A4A', marginTop: 8 }}>{error}</p>
      )}
    </form>
  );
}

const labelStyle = {
  fontFamily: "'Oxanium', system-ui, sans-serif",
  fontSize: '0.66rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: '#888',
  marginBottom: 6,
};

const readOnlyStyle: React.CSSProperties = {
  width: '100%',
  padding: 12,
  fontSize: '0.9rem',
  border: '1px solid #E0DDD3',
  borderRadius: 4,
  background: '#FAFAF8',
  color: '#333',
  lineHeight: 1.55,
  boxSizing: 'border-box',
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? '#888' : '#1E2F58',
    color: '#fff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.86rem',
    fontWeight: 700,
    opacity: disabled ? 0.6 : 1,
  };
}

function secondaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    background: '#fff',
    color: '#1E2F58',
    border: '1px solid #1E2F58',
    padding: '8px 16px',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.86rem',
    fontWeight: 700,
    opacity: disabled ? 0.4 : 1,
  };
}

function sendButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? '#888' : '#C4B49A',
    color: '#0D1520',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.86rem',
    fontWeight: 800,
    opacity: disabled ? 0.6 : 1,
    marginLeft: 'auto',
  };
}
