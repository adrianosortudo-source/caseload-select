'use client';

import { useState, useRef, type FormEvent } from 'react';

/**
 * Lawyer-side inline editor for the welcome draft.
 *
 * Edits land in `client_matters.welcome_draft_edited_html` via PATCH.
 * The original `welcome_draft_html` is preserved separately so the
 * lawyer can reset back to it. Send happens via the existing
 * /welcome/send endpoint (POST) — this component does NOT send;
 * it only edits and saves.
 *
 * Why a plain textarea, not a rich-text editor: the body is already
 * HTML (built by buildWelcomeDraft on the server) and the lawyer
 * typically edits one or two lines (the signature, a salutation
 * tweak). A full rich-text editor adds complexity (DOMPurify
 * config, sanitisation gates, contenteditable quirks) for a
 * marginal UX win. A textarea showing the HTML source is enough
 * for Phase 1; Phase 2 can upgrade to a real editor if real usage
 * demands it.
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
  const [body, setBody] = useState(initialEditedHtml ?? originalHtml);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const hasEdits = body !== originalHtml;

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSent) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portal/${firmId}/matters/${matterId}/welcome`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ edited_html: body }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Could not save. Please try again.');
        setSaving(false);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString('en-CA', { timeStyle: 'short' }));
    } catch (err) {
      setError(err instanceof Error ? `Network error: ${err.message}` : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  function onReset() {
    setBody(originalHtml);
    setSavedAt(null);
    setError(null);
  }

  async function onSend() {
    if (isSent) return;
    if (hasEdits && !savedAt) {
      // Auto-save edits before sending so the sent body reflects the latest state.
      const ok = window.confirm(
        'You have unsaved edits. Save them and send the welcome to the client?',
      );
      if (!ok) return;
      setSaving(true);
      try {
        const res = await fetch(
          `/api/portal/${firmId}/matters/${matterId}/welcome`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edited_html: body }),
          },
        );
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error ?? 'Could not save edits before send.');
          setSaving(false);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? `Network error: ${err.message}` : 'Network error.');
        setSaving(false);
        return;
      }
      setSaving(false);
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
    <form onSubmit={onSave}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <p style={labelStyle}>Edit (HTML source)</p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={isSent || saving || sending}
            rows={16}
            style={textareaStyle}
          />
        </div>
        <div>
          <p style={labelStyle}>Preview (what the client sees)</p>
          <div
            ref={previewRef}
            style={previewStyle}
            dangerouslySetInnerHTML={{ __html: body }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {!isSent && (
          <>
            <button
              type="submit"
              disabled={!hasEdits || saving || sending}
              style={primaryButtonStyle(!hasEdits || saving || sending)}
            >
              {saving ? 'Saving…' : 'Save edits'}
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={!hasEdits || saving || sending}
              style={secondaryButtonStyle(!hasEdits || saving || sending)}
            >
              Reset to original
            </button>
            <button
              type="button"
              onClick={onSend}
              disabled={saving || sending}
              style={sendButtonStyle(saving || sending)}
            >
              {sending ? 'Sending…' : 'Send welcome'}
            </button>
            {savedAt && (
              <span style={{ fontSize: '0.78rem', color: '#4a7d4a', marginLeft: 8 }}>
                ✓ Saved at {savedAt}
              </span>
            )}
          </>
        )}
      </div>
      {error && (
        <p style={{ fontSize: '0.84rem', color: '#C97A4A', marginTop: 8 }}>
          {error}
        </p>
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
  marginBottom: 4,
};

const textareaStyle = {
  width: '100%',
  padding: 10,
  fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Source Code Pro', Menlo, monospace",
  fontSize: '0.78rem',
  border: '1px solid #C4B49A',
  borderRadius: 4,
  background: '#fff',
  resize: 'vertical' as const,
  boxSizing: 'border-box' as const,
  minHeight: 240,
};

const previewStyle = {
  width: '100%',
  padding: 12,
  fontSize: '0.88rem',
  border: '1px solid #E0DDD3',
  borderRadius: 4,
  background: '#fff',
  color: '#222',
  lineHeight: 1.5,
  minHeight: 240,
  boxSizing: 'border-box' as const,
  overflow: 'auto' as const,
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
