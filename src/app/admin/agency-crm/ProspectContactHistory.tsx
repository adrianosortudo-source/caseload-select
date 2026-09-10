'use client';

import { useState } from 'react';
import type { ProspectConversationSummary } from '@/lib/prospect-operations-types';

export function ProspectContactHistory({ agencyProspectId }: { agencyProspectId: string }) {
  const [conversation, setConversation] = useState<ProspectConversationSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState('message_sent');
  const [channel, setChannel] = useState('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/admin/prospect-operations/conversations/agency/${agencyProspectId}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Unable to load contact history');
      setConversation(json.conversation);
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !conversation) await load();
  }

  async function logActivity(event: React.FormEvent) {
    event.preventDefault();
    if (!conversation) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/admin/prospect-operations/activities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversation.id, kind, channel, subject, body,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'Unable to save activity');
      setSubject(''); setBody(''); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <section className="mt-2" data-ui-component-content="prospect-contact-history">
      <button type="button" onClick={toggle} className="text-[10px] uppercase tracking-wider font-semibold text-navy underline underline-offset-2">
        {open ? 'Hide contact history' : 'Contact history'}
      </button>
      {open && (
        <div className="mt-2 border-t border-black/10 pt-2 space-y-2" data-ui-copy="prospect-contact-history-copy">
          {loading && !conversation && <p className="text-xs text-black/50">Loading contact history…</p>}
          {error && <p className="text-xs text-red-700">{error}</p>}
          {conversation && (
            <>
              <p className="text-xs text-black/70">
                <span className="font-semibold">{conversation.status.replaceAll('_', ' ')}</span>
                {' · '}{conversation.history_coverage.replaceAll('_', ' ')}
              </p>
              <ol className="space-y-1">
                {conversation.activities.length === 0 ? <li className="text-xs text-black/50">No contact activity recorded.</li> : conversation.activities.map((activity) => (
                  <li key={activity.id} className="text-xs text-black/70">
                    <span className="font-semibold">{activity.kind.replaceAll('_', ' ')}</span>
                    {' · '}{new Date(activity.occurred_at).toLocaleDateString()}
                    {activity.subject ? ` · ${activity.subject}` : ''}
                  </li>
                ))}
              </ol>
              <form onSubmit={logActivity} className="grid gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <select value={kind} onChange={(event) => setKind(event.target.value)} className="border border-black/15 px-2 py-1 text-xs" aria-label="Activity type">
                    <option value="message_sent">Message sent</option><option value="human_reply">Human reply</option><option value="automated_reply">Automated reply</option><option value="bounce">Bounce</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="note">Note</option>
                  </select>
                  <select value={channel} onChange={(event) => setChannel(event.target.value)} className="border border-black/15 px-2 py-1 text-xs" aria-label="Channel">
                    <option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="phone">Phone</option><option value="video">Video</option><option value="other">Other</option>
                  </select>
                </div>
                <input value={subject} onChange={(event) => setSubject(event.target.value)} className="border border-black/15 px-2 py-1 text-xs" placeholder="Subject or short note" />
                <textarea value={body} onChange={(event) => setBody(event.target.value)} className="border border-black/15 px-2 py-1 text-xs" rows={3} placeholder="Paste the message or response" />
                <button disabled={loading} className="justify-self-start bg-navy px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50">Log activity</button>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}
