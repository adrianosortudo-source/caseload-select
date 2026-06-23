'use client';

import { useState, useRef, type FormEvent, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { MatterAttachment } from '@/lib/types';

/**
 * Client-side compose form for the client matter home page.
 *
 * On send: POST JSON to the messages endpoint, then call
 * router.refresh() so the server component re-fetches the thread
 * without a full page reload.
 *
 * Supports file attachments: files are uploaded to the upload endpoint
 * first, then the returned attachment metadata is included in the POST.
 */
export default function ComposeForm({
  firmId,
  matterId,
}: {
  firmId: string;
  matterId: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<MatterAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          setUploadError(json.error ?? 'Upload failed. Please try again.');
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
      const res = await fetch(
        `/api/portal/${firmId}/matters/${matterId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel_type: 'client',
            body: body.trim() || '(attachment)',
            attachments: pendingAttachments,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Could not send. Please try again.');
        setSending(false);
        return;
      }
      setBody('');
      setPendingAttachments([]);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Network error: ${err.message}`
          : 'Network error. Please try again.',
      );
      setSending(false);
    }
  }

  const canSend = (body.trim().length > 0 || pendingAttachments.length > 0) && !sending;

  return (
    <form onSubmit={onSubmit} style={{ marginTop: 18 }}>
      {pendingAttachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {pendingAttachments.map((a, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                background: '#fff',
                border: '1px solid #C4B49A',
                borderRadius: 4,
                fontSize: '0.82rem',
                color: '#444',
              }}
            >
              {a.name}
              <button
                type="button"
                onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#888',
                  padding: 0,
                  lineHeight: 1,
                  fontSize: '1rem',
                }}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a message to your lawyer..."
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button
          type="submit"
          disabled={!canSend}
          style={{
            background: !canSend ? '#888' : '#1E2F58',
            color: '#fff',
            border: 'none',
            padding: '10px 18px',
            borderRadius: 4,
            cursor: !canSend ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.92rem',
            fontWeight: 700,
            opacity: !canSend ? 0.6 : 1,
          }}
        >
          {sending ? 'Sending...' : 'Send to your lawyer'}
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending}
          style={{
            background: 'none',
            border: '1px solid #C4B49A',
            borderRadius: 4,
            padding: '9px 14px',
            cursor: (uploading || sending) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.86rem',
            color: '#666',
          }}
        >
          {uploading ? 'Uploading...' : 'Attach file'}
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
        <p style={{ fontSize: '0.84rem', color: '#C97A4A', marginTop: 6 }}>{uploadError}</p>
      )}
      {error ? (
        <p style={{ fontSize: '0.84rem', color: '#C97A4A', marginTop: 8, fontStyle: 'italic' }}>
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
