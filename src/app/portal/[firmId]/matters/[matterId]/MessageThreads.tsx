'use client';

import { useEffect, useState, useRef, useCallback, type FormEvent, type ChangeEvent } from 'react';
import type { MatterMessage, MatterAttachment } from '@/lib/types';
import { formatTimestamp } from '@/lib/firm-timezone';

/**
 * Lawyer-side dual-thread message panel.
 *
 * Features in this version:
 *   - 30-second polling (paused while composing)
 *   - Threaded replies: root messages show a Reply button; replies
 *     render indented beneath their parent
 *   - File attachments: pick file(s) to upload before sending; rendered
 *     as signed links in the thread
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
          Threads refreshed at {lastPolledAt}{composeFocused ? ' (paused while composing)' : ''}
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
  const [replyingTo, setReplyingTo] = useState<MatterMessage | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<MatterAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  // Group for threaded display.
  const rootMessages = messages.filter((m) => !m.parent_message_id);
  const repliesByParent = new Map<string, MatterMessage[]>();
  for (const m of messages) {
    if (m.parent_message_id) {
      const list = repliesByParent.get(m.parent_message_id) ?? [];
      list.push(m);
      repliesByParent.set(m.parent_message_id, list);
    }
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    e.target.value = '';
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(
          `/api/portal/${firmId}/matters/${matterId}/messages/upload`,
          { method: 'POST', body: fd },
        );
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setUploadError(json.error ?? 'Upload failed. Try again.');
        } else {
          setPendingAttachments((prev) => [...prev, json.attachment as MatterAttachment]);
        }
      }
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim() && pendingAttachments.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/matters/${matterId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_type: channelType,
          body: body.trim() || '(attachment)',
          attachments: pendingAttachments,
          parent_message_id: replyingTo?.id ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Send failed.');
      } else {
        setBody('');
        setPendingAttachments([]);
        setReplyingTo(null);
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
        {title} <span style={{ color: '#888', fontWeight: 400 }}>({rootMessages.length})</span>
      </h3>
      <ul
        ref={listRef}
        style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 320, overflowY: 'auto' }}
      >
        {rootMessages.length === 0 ? (
          <li style={{ color: '#888', fontSize: '0.86rem', fontStyle: 'italic' }}>
            No messages yet.
          </li>
        ) : (
          rootMessages.map((m) => (
            <li key={m.id} style={{ padding: '6px 0', borderBottom: '1px solid #E0DDD3' }}>
              <MessageRow m={m} onReply={() => setReplyingTo(m)} />
              {(repliesByParent.get(m.id) ?? []).map((reply) => (
                <div
                  key={reply.id}
                  style={{
                    marginLeft: 16,
                    paddingLeft: 10,
                    borderLeft: '2px solid #E0DDD3',
                    marginTop: 4,
                  }}
                >
                  <MessageRow m={reply} onReply={null} />
                </div>
              ))}
            </li>
          ))
        )}
      </ul>

      <form onSubmit={onSubmit} style={{ marginTop: 8 }}>
        {replyingTo && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              background: '#F4F3EF',
              borderRadius: 3,
              marginBottom: 4,
              fontSize: '0.76rem',
              color: '#666',
            }}
          >
            <span>Replying to: {replyingTo.body.slice(0, 40)}{replyingTo.body.length > 40 ? '...' : ''}</span>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#888',
                fontSize: '0.9rem',
                padding: '0 2px',
              }}
            >
              x
            </button>
          </div>
        )}

        {pendingAttachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
            {pendingAttachments.map((a, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  background: '#F4F3EF',
                  border: '1px solid #C4B49A',
                  borderRadius: 3,
                  fontSize: '0.76rem',
                  color: '#444',
                }}
              >
                {a.name}
                <button
                  type="button"
                  onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 0, lineHeight: 1 }}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={onComposeFocus}
          onBlur={onComposeBlur}
          placeholder={`${replyingTo ? 'Write a reply...' : `Message to ${title.toLowerCase()}...`}`}
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <button
            type="submit"
            disabled={sending || (!body.trim() && pendingAttachments.length === 0)}
            style={{
              background: sending ? '#888' : '#C4B49A',
              color: '#fff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: 3,
              cursor: (sending || (!body.trim() && pendingAttachments.length === 0)) ? 'not-allowed' : 'pointer',
              fontSize: '0.82rem',
              fontWeight: 700,
              opacity: (!body.trim() && pendingAttachments.length === 0) ? 0.5 : 1,
            }}
          >
            {sending ? 'Sending...' : replyingTo ? 'Reply' : 'Send'}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending}
            title="Attach file"
            style={{
              background: 'none',
              border: '1px solid #C4B49A',
              borderRadius: 3,
              padding: '5px 8px',
              cursor: (uploading || sending) ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              color: '#666',
            }}
          >
            {uploading ? 'Uploading...' : 'Attach'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
        </div>

        {uploadError && (
          <p style={{ fontSize: '0.76rem', color: '#C97A4A', marginTop: 3 }}>{uploadError}</p>
        )}
        {error && (
          <p style={{ fontSize: '0.78rem', color: '#C97A4A', marginTop: 4 }}>{error}</p>
        )}
      </form>
    </div>
  );
}

function MessageRow({
  m,
  onReply,
}: {
  m: MatterMessage;
  onReply: (() => void) | null;
}) {
  return (
    <div style={{ fontSize: '0.84rem' }}>
      <p style={{ margin: 0, color: '#888', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{m.sender_role === 'client' ? 'Client' : m.sender_role}</span>
        <span>·</span>
        <span>
          {formatTimestamp(m.created_at, undefined, {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#C4B49A',
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: 0,
            }}
          >
            Reply
          </button>
        )}
      </p>
      <div
        style={{ margin: '2px 0 0 0', color: '#222', lineHeight: 1.4 }}
        dangerouslySetInnerHTML={{
          __html: m.body.includes('<')
            ? m.body
            : escapeHtml(m.body).replace(/\n/g, '<br>'),
        }}
      />
      {m.attachments?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {m.attachments.map((a, i) => (
            a.signed_url ? (
              <a
                key={i}
                href={a.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  background: '#F4F3EF',
                  border: '1px solid #E0DDD3',
                  borderRadius: 3,
                  fontSize: '0.74rem',
                  color: '#1E2F58',
                  textDecoration: 'none',
                }}
              >
                {a.name}{a.size ? ` (${Math.round(a.size / 1024)} KB)` : ''}
              </a>
            ) : (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  padding: '2px 7px',
                  background: '#F4F3EF',
                  border: '1px solid #E0DDD3',
                  borderRadius: 3,
                  fontSize: '0.74rem',
                  color: '#888',
                }}
              >
                {a.name}
              </span>
            )
          ))}
        </div>
      )}
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
