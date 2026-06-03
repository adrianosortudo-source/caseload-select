'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Lawyer-side inline rich-text editor for the welcome draft (S8 Phase 2).
 *
 * Replaces the Phase 1 HTML-source textarea + separate preview with a single
 * WYSIWYG surface: a contenteditable region that IS the preview, plus a narrow
 * formatting toolbar (bold, italic, bulleted/numbered list, link, clear). The
 * lawyer edits visually; no HTML source.
 *
 * Saved-output compatibility: the editor emits the same tag set the generated
 * draft uses (p, ul/ol/li, a, br, strong/em). On save the server SANITIZES the
 * HTML authoritatively (lib/welcome-html-sanitize) and returns the canonical
 * result, which this component adopts — so the lawyer always sees exactly what
 * will be stored and sent, and nothing reaches the client unsanitized.
 *
 * Explicit save (no autosave). Send is unchanged: POST /welcome/send, with a
 * save-first confirm when there are unsaved edits.
 *
 * Implementation notes:
 * - The contenteditable is UNCONTROLLED: initialized imperatively via ref and
 *   never re-rendered from React state (that would fight the cursor). After a
 *   save/reset we set innerHTML imperatively and re-read it as the new baseline.
 * - Toolbar uses document.execCommand. It is deprecated but universally
 *   supported and zero-dependency, which fits a narrow first slice. A heavier
 *   editor (TipTap/Slate) is a later upgrade if formatting needs grow.
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
  const editorRef = useRef<HTMLDivElement>(null);
  // Browser-normalized canonical HTML (what's saved). Both sides of the dirty
  // comparison are read from the DOM so normalization doesn't cause false-dirty.
  const baselineRef = useRef<string>('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize the editor content once.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = initialEditedHtml ?? originalHtml ?? '';
    baselineRef.current = el.innerHTML;
  }, [initialEditedHtml, originalHtml]);

  const recomputeDirty = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    setDirty(el.innerHTML !== baselineRef.current);
    setSavedAt(null);
  }, []);

  function exec(command: string, value?: string) {
    if (isSent || saving || sending) return;
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    recomputeDirty();
  }

  function onLink() {
    if (isSent || saving || sending) return;
    const url = window.prompt('Link URL (https://… or mailto:…)');
    if (!url) return;
    const trimmed = url.trim();
    if (!/^(https?:|mailto:)/i.test(trimmed)) {
      setError('Links must start with https://, http://, or mailto:.');
      return;
    }
    setError(null);
    editorRef.current?.focus();
    document.execCommand('createLink', false, trimmed);
    recomputeDirty();
  }

  async function save(): Promise<boolean> {
    const el = editorRef.current;
    if (!el || isSent) return false;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/matters/${matterId}/welcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited_html: el.innerHTML }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Could not save. Please try again.');
        return false;
      }
      // Adopt the server's canonical sanitized HTML so the lawyer sees exactly
      // what's stored (and any disallowed markup they pasted is now gone).
      el.innerHTML = typeof json.edited_html === 'string' ? json.edited_html : '';
      baselineRef.current = el.innerHTML;
      setDirty(false);
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
    const el = editorRef.current;
    if (!el || isSent) return;
    el.innerHTML = originalHtml ?? '';
    baselineRef.current = el.innerHTML;
    setDirty(false);
    setSavedAt(null);
    setError(null);
  }

  async function onSend() {
    if (isSent) return;
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

  const busy = saving || sending;

  if (isSent) {
    return (
      <div>
        <p style={labelStyle}>Sent welcome (read-only)</p>
        <div ref={editorRef} style={readOnlyStyle} />
      </div>
    );
  }

  return (
    <form onSubmit={onSaveSubmit}>
      <p style={labelStyle}>Welcome message</p>

      <div style={toolbarStyle} role="toolbar" aria-label="Formatting">
        <ToolButton label="B" title="Bold" onClick={() => exec('bold')} disabled={busy} bold />
        <ToolButton label="I" title="Italic" onClick={() => exec('italic')} disabled={busy} italic />
        <Divider />
        <ToolButton label="• List" title="Bulleted list" onClick={() => exec('insertUnorderedList')} disabled={busy} />
        <ToolButton label="1. List" title="Numbered list" onClick={() => exec('insertOrderedList')} disabled={busy} />
        <Divider />
        <ToolButton label="Link" title="Add link to selected text" onClick={onLink} disabled={busy} />
        <ToolButton label="Clear" title="Clear formatting" onClick={() => exec('removeFormat')} disabled={busy} />
      </div>

      <div
        ref={editorRef}
        contentEditable={!busy}
        suppressContentEditableWarning
        onInput={recomputeDirty}
        spellCheck
        role="textbox"
        aria-multiline="true"
        aria-label="Welcome message editor"
        style={editorStyle(busy)}
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

function ToolButton({
  label,
  title,
  onClick,
  disabled,
  bold,
  italic,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled: boolean;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // Preserve the editor's text selection: don't let the button steal focus
      // before execCommand runs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: '#fff',
        color: '#1E2F58',
        border: '1px solid #C4B49A',
        borderRadius: 3,
        padding: '4px 9px',
        fontSize: '0.8rem',
        fontWeight: bold ? 800 : 600,
        fontStyle: italic ? 'italic' : 'normal',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        lineHeight: 1.2,
      }}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: '#E0DDD3', margin: '0 2px' }} />;
}

const labelStyle = {
  fontFamily: "'Oxanium', system-ui, sans-serif",
  fontSize: '0.66rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: '#888',
  marginBottom: 6,
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: 6,
  border: '1px solid #C4B49A',
  borderBottom: 'none',
  borderRadius: '4px 4px 0 0',
  background: '#F4F3EF',
  flexWrap: 'wrap',
};

function editorStyle(busy: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: 12,
    fontSize: '0.9rem',
    border: '1px solid #C4B49A',
    borderRadius: '0 0 4px 4px',
    background: busy ? '#FAFAF8' : '#fff',
    color: '#222',
    lineHeight: 1.55,
    minHeight: 260,
    boxSizing: 'border-box',
    overflow: 'auto',
    outline: 'none',
  };
}

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
