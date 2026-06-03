'use client';

import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react';
import type { MatterMessage } from '@/lib/types';
import { formatTimestamp } from '@/lib/firm-timezone';

/**
 * Lawyer-side dual-thread message panel with auto-refresh + inline
 * compose forms for both channels. Polls each channel every 30s for
 * new messages without disrupting an in-progress compose.
 *
 * Why polling, not Supabase Realtime: Realtime is the right answer
 * long-term but requires per-channel subscription plumbing (filter
 * by matter_id, RLS-aware auth, reconnect on backgrounded tab).
 * Phase 1 ships a 30-second poll which covers 95% of the UX win
 * for one tenth the implementation surface. Phase 2 upgrades when
 * the volume warrants.
 *
 * The poll is paused while the user has the compose textarea
 * focused (so a fresh fetch doesn't re-render and lose cursor
 * position mid-typing).
 */
export default function MessageThreads({
  firmId,
  matterId,
  initialClientMessages,
  initialInternalMessages,
}: {
  firmId: string;
  matterId: string;
  initialClientMessages: MatterMessage[];
  initialInternalMessages: MatterMessage[];
}) {
  const [clientMessages, setClientMessages] = useState(initialClientMessages);
  const [internalMessages, setInternalMessages] = useState(initialInternalMessages);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const [composeFocused, setComposeFocused] = useState(false);

  const fetchChannel = useCallback(
    async (channel: 'client' | 'internal'): Promise<MatterMessage[] | null> => {
      try {
        const res = await fetch(
          `/api/portal/${firmId}/matters/${matterId}/messages?channel=${channel}&limit=200`,
          { cache: 'no-store' },
        );
        if (!res.ok) return null;
        const json = await res.json();
        if (!json.ok) return null;
        return json.messages as MatterMessage[];
      } catch {
        return null;
      }
    },
    [firmId, matterId],
  );

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (composeFocused) return;
      const [c, i] = await Promise.all([fetchChannel('client'), fetchChannel('internal')]);
      if (cancelled) return;
      if (c) setClientMessages(c);
      if (i) setInternalMessages(i);
      setLastPolledAt(new Date().toLocaleTimeString('en-CA', { timeStyle: 'short' }));
    };
    const id = window.setInterval(tick, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [fetchChannel, composeFocused]);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <ThreadColumn
          title="Client thread"
          messages={clientMessages}
          firmId={firmId}
          matterId={matterId}
          channelType="client"
          onComposeFocus={() => setComposeFocused(true)}
          onComposeBlur={() => setComposeFocused(false)}
          onSent={(msg) => setClientMessages((prev) => [...prev, msg])}
        />
        <ThreadColumn
          title="Internal team"
          messages={internalMessages}
          firmId={firmId}
          matterId={matterId}
          channelType="internal"
          onComposeFocus={() => setComposeFocused(true)}
          onComposeBlur={() => setComposeFocused(false)}
          onSent={(msg) => setInternalMessages((prev) => [...prev, msg])}
        />
      </div>
      {lastPolledAt && (
        <p style={{ fontSize: '0.7rem', color: '#888', marginTop: 8, textAlign: 'right' }}>
          Threads refreshed at {lastPolledAt} {composeFocused ? '(paused while composing)' : ''}
        </p>
      )}
    </div>
  );
}

function ThreadColumn({
  title,
  messages,
  firmId,
  matterId,
  channelType,
  onComposeFocus,
  onComposeBlur,
  onSent,
}: {
  title: string;
  messages: MatterMessage[];
  firmId: string;
  matterId: string;
  channelType: 'client' | 'internal';
  onComposeFocus: () => void;
  onComposeBlur: () => void;
  onSent: (msg: MatterMessage) => void;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/matters/${matterId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_type: channelType, body: body.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Send failed.');
      } else {
        setBody('');
        onSent(json.message as MatterMessage);
      }
    } catch (err) {
      setError(err instanceof Error ? `Network error: ${err.message}` : 'Network error.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: '0.94rem', fontWeight: 700, margin: '0 0 8px 0', color: '#1E2F58' }}>
        {title} <span style={{ color: '#888', fontWeight: 400 }}>({messages.length})</span>
      </h3>
      <ul
        ref={listRef}
        style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 280, overflowY: 'auto' }}
      >
        {messages.length === 0 ? (
          <li style={{ color: '#888', fontSize: '0.86rem', fontStyle: 'italic' }}>
            No messages yet.
          </li>
        ) : (
          messages.map((m) => (
            <li
              key={m.id}
              style={{
                padding: '6px 0',
                borderBottom: '1px solid #E0DDD3',
                fontSize: '0.84rem',
              }}
            >
              <p style={{ margin: 0, color: '#888', fontSize: '0.72rem' }}>
                {m.sender_role === 'client' ? 'Client' : m.sender_role} ·{' '}
                {formatTimestamp(m.created_at, undefined, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </p>
              <div
                style={{ margin: '2px 0 0 0', color: '#222', lineHeight: 1.4 }}
                dangerouslySetInnerHTML={{
                  __html: m.body.includes('<')
                    ? m.body
                    : escapeHtml(m.body).replace(/\n/g, '<br>'),
                }}
              />
            </li>
          ))
        )}
      </ul>
      <form onSubmit={onSubmit} style={{ marginTop: 8 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={onComposeFocus}
          onBlur={onComposeBlur}
          placeholder={`Message to ${title.toLowerCase()}…`}
          required
          rows={2}
          disabled={sending}
          style={{
            width: '100%',
            padding: 6,
            fontFamily: 'inherit',
            fontSize: '0.86rem',
            border: '1px solid #C4B49A',
            borderRadius: 3,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          style={{
            background: sending ? '#888' : '#C4B49A',
            color: '#fff',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 3,
            cursor: sending || !body.trim() ? 'not-allowed' : 'pointer',
            fontSize: '0.82rem',
            fontWeight: 700,
            marginTop: 4,
            opacity: !body.trim() ? 0.5 : 1,
          }}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
        {error && (
          <p style={{ fontSize: '0.78rem', color: '#C97A4A', marginTop: 4 }}>{error}</p>
        )}
      </form>
    </div>
  );
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
