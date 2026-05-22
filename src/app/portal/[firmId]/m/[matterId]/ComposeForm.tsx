'use client';

import { useState, type FormEvent } from 'react';

/**
 * Client-side compose form for the client matter home page.
 *
 * Wraps a textarea + send button. On submit, posts JSON to the
 * matter messages endpoint (which expects JSON, not form-urlencoded).
 * On success, clears the textarea and refreshes the page so the new
 * message appears in the thread.
 *
 * The "in-flight" state disables the button and changes its label
 * to prevent double-submission. Errors surface inline with a clear
 * action ("Reply to this email and your lawyer will see it" — gives
 * the client a recovery path that doesn't depend on this surface
 * working).
 */
export default function ComposeForm({
  firmId,
  matterId,
}: {
  firmId: string;
  matterId: string;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portal/${firmId}/matters/${matterId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel_type: 'client', body: body.trim() }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Could not send. Please try again.');
        setSending(false);
        return;
      }
      // Success — clear the textarea and refresh the page so the new
      // message appears in the thread. window.location.reload is fine
      // here; the page is small and the alternative (next/router refresh
      // + revalidation plumbing) is more complex than it needs to be
      // for this single-matter view.
      setBody('');
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Network error: ${err.message}`
          : 'Network error. Please try again.',
      );
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ marginTop: 18 }}>
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a message to your lawyer…"
        required
        rows={4}
        disabled={sending}
        style={{
          width: '100%',
          padding: 10,
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: '0.94rem',
          border: '1px solid #C4B49A',
          borderRadius: 4,
          background: '#fff',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <button
        type="submit"
        disabled={sending || !body.trim()}
        style={{
          marginTop: 10,
          background: sending ? '#888' : '#1E2F58',
          color: '#fff',
          border: 'none',
          padding: '10px 18px',
          borderRadius: 4,
          cursor: sending || !body.trim() ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          fontSize: '0.92rem',
          fontWeight: 700,
          opacity: !body.trim() ? 0.6 : 1,
        }}
      >
        {sending ? 'Sending…' : 'Send to your lawyer'}
      </button>
      {error ? (
        <p
          style={{
            fontSize: '0.84rem',
            color: '#C97A4A',
            marginTop: 8,
            fontStyle: 'italic',
          }}
        >
          {error} You can also reply to your last email and your lawyer will see it.
        </p>
      ) : (
        <p style={{ fontSize: '0.78rem', color: '#888', marginTop: 6 }}>
          Replies usually arrive within one business day.
        </p>
      )}
    </form>
  );
}
