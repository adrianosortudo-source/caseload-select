'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

/**
 * Shared inline rich-text editing surface (S8 Phase 2).
 *
 * A contenteditable region + a narrow formatting toolbar (bold, italic,
 * bulleted/numbered list, link, clear). Used by the lawyer welcome-draft editor
 * and the operator explainer-article editor. The surrounding chrome (save /
 * reset / send / metadata fields) lives in each wrapper; this component owns
 * only the editing surface and its dirty state.
 *
 * Contract:
 * - UNCONTROLLED: initialized imperatively via ref, never re-rendered from
 *   parent state (that would fight the cursor). The parent reads/writes content
 *   through the imperative handle (getHtml / setHtml) and learns about edits
 *   via onDirtyChange.
 * - Sanitization is NOT done here. The editor emits HTML; the server sanitizes
 *   authoritatively on save and the parent feeds the canonical result back via
 *   setHtml. Keeping the client free of a sanitizer keeps the bundle small.
 * - execCommand is deprecated but universally supported and zero-dependency,
 *   which fits a narrow first slice.
 */

export interface RichTextEditorHandle {
  /** Current editor HTML. */
  getHtml: () => string;
  /** Replace content and reset the dirty baseline to it (clears dirty). */
  setHtml: (html: string) => void;
  focus: () => void;
}

interface RichTextEditorProps {
  initialHtml: string;
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  /** Surface a link-scheme validation message to the parent. */
  onError?: (message: string | null) => void;
  ariaLabel?: string;
  minHeight?: number;
}

const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    { initialHtml, disabled = false, onDirtyChange, onError, ariaLabel = 'Rich text editor', minHeight = 260 },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    // Browser-normalized canonical HTML. Both sides of the dirty comparison are
    // read from the DOM so normalization never causes false-dirty.
    const baselineRef = useRef<string>('');

    // Initialize once.
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = initialHtml ?? '';
      baselineRef.current = el.innerHTML;
      // Intentionally run once: the editor is uncontrolled after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function recomputeDirty() {
      const el = editorRef.current;
      if (!el) return;
      onDirtyChange?.(el.innerHTML !== baselineRef.current);
    }

    useImperativeHandle(
      ref,
      () => ({
        getHtml: () => editorRef.current?.innerHTML ?? '',
        setHtml: (html: string) => {
          const el = editorRef.current;
          if (!el) return;
          el.innerHTML = html ?? '';
          baselineRef.current = el.innerHTML;
          onDirtyChange?.(false);
        },
        focus: () => editorRef.current?.focus(),
      }),
      [onDirtyChange],
    );

    function exec(command: string, value?: string) {
      if (disabled) return;
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      recomputeDirty();
    }

    function onLink() {
      if (disabled) return;
      const url = window.prompt('Link URL (https://… or mailto:…)');
      if (!url) return;
      const trimmed = url.trim();
      if (!/^(https?:|mailto:)/i.test(trimmed)) {
        onError?.('Links must start with https://, http://, or mailto:.');
        return;
      }
      onError?.(null);
      editorRef.current?.focus();
      document.execCommand('createLink', false, trimmed);
      recomputeDirty();
    }

    return (
      <div>
        <div style={toolbarStyle} role="toolbar" aria-label="Formatting">
          <ToolButton label="B" title="Bold" onClick={() => exec('bold')} disabled={disabled} bold />
          <ToolButton label="I" title="Italic" onClick={() => exec('italic')} disabled={disabled} italic />
          <Divider />
          <ToolButton label="• List" title="Bulleted list" onClick={() => exec('insertUnorderedList')} disabled={disabled} />
          <ToolButton label="1. List" title="Numbered list" onClick={() => exec('insertOrderedList')} disabled={disabled} />
          <Divider />
          <ToolButton label="Link" title="Add link to selected text" onClick={onLink} disabled={disabled} />
          <ToolButton label="Clear" title="Clear formatting" onClick={() => exec('removeFormat')} disabled={disabled} />
        </div>
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={recomputeDirty}
          spellCheck
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          style={editorStyle(disabled, minHeight)}
        />
      </div>
    );
  },
);

export default RichTextEditor;

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
      // Preserve the editor's selection: don't steal focus before execCommand.
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

function editorStyle(disabled: boolean, minHeight: number): React.CSSProperties {
  return {
    width: '100%',
    padding: 12,
    fontSize: '0.9rem',
    border: '1px solid #C4B49A',
    borderRadius: '0 0 4px 4px',
    background: disabled ? '#FAFAF8' : '#fff',
    color: '#222',
    lineHeight: 1.55,
    minHeight,
    boxSizing: 'border-box',
    overflow: 'auto',
    outline: 'none',
  };
}
