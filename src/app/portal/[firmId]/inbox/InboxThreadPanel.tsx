'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ChannelType, MatterMessage } from '@/lib/types';

interface Props {
  firmId: string;
  matterId: string;
}

export default function InboxThreadPanel({ firmId, matterId }: Props) {
  const [messages, setMessages] = useState<MatterMessage[]>([]);
  const [channel, setChannel] = useState<ChannelType>('client');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/matters/${matterId}/messages?channel=${channel}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load messages');
      setMessages(json.messages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [firmId, matterId, channel]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/matters/${matterId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_type: channel, body: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Send failed');
      setBody('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        {(['client', 'internal'] as ChannelType[]).map((c) => (
          <button
            key={c}
            onClick={() => setChannel(c)}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontWeight: 700,
              border: '1px solid rgba(0,0,0,0.12)',
              background: channel === c ? '#1E2F58' : 'transparent',
              color: channel === c ? '#fff' : 'rgba(0,0,0,0.6)',
              cursor: 'pointer',
            }}
          >
            {c === 'client' ? 'Client thread' : 'Internal notes'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading ? (
          <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>Loading&hellip;</p>
        ) : messages.length === 0 ? (
          <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>No messages on this channel yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 14, padding: '10px 12px', background: 'rgba(0,0,0,0.02)', borderLeft: '3px solid rgba(30,47,88,0.3)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1E2F58', textTransform: 'capitalize' }}>{m.sender_role}</div>
              {/* Bodies are sanitized server-side at write (sanitizeMessageHtml);
                  render the allowed rich subset the same way MessageThreads.tsx
                  does, so a welcome send does not show literal markup here. */}
              <div
                style={{ fontSize: 13, marginTop: 4 }}
                dangerouslySetInnerHTML={{ __html: m.body.replace(/\n/g, '<br>') }}
              />
              <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', marginTop: 6 }}>{new Date(m.created_at).toLocaleString()}</div>
            </div>
          ))
        )}
      </div>

      {error && <p style={{ padding: '0 20px', fontSize: 12, color: '#b91c1c' }}>{error}</p>}

      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, padding: '12px 20px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={channel === 'client' ? 'Reply to the client...' : 'Add an internal note...'}
          rows={2}
          style={{ flex: 1, padding: 8, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13, resize: 'vertical' }}
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          style={{
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            background: '#1E2F58',
            color: '#fff',
            border: 'none',
            cursor: sending ? 'default' : 'pointer',
            opacity: sending || !body.trim() ? 0.5 : 1,
            alignSelf: 'flex-end',
          }}
        >
          {sending ? 'Sending' : 'Send'}
        </button>
      </form>
    </div>
  );
}
