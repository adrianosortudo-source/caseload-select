'use client';

import { useEffect, useRef, useState } from 'react';
import { startMessaging, type MessagingTurn } from '@/app/tools/screen/parity/messaging-actions';
import type { MetaChannel } from '@/lib/channel-intake-processor';
import type { ParityReport } from '@/lib/screen-parity-messaging';

interface Props {
  channel: MetaChannel;
  practiceArea: string;
  comparison?: unknown;
  opening?: string;
  onReport: (brief: ParityReport) => void;
}

const labels = { whatsapp: 'WhatsApp', facebook: 'Facebook Messenger', instagram: 'Instagram Direct Messages' };

export default function ScreenParityMessaging({ channel, practiceArea, opening, onReport }: Props) {
  const [messages, setMessages] = useState<{ author: string; text: string }[]>([]);
  const [draft, setDraft] = useState(opening ?? '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const next = useRef<MessagingTurn['advance']>(undefined);
  const flight = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    revision.current++;
    next.current = undefined; flight.current = false;
    setMessages([]); setDraft(opening ?? ''); setBusy(false); setDone(false); setError('');
    return () => { revision.current++; };
  }, [channel, practiceArea, opening]);

  async function send() {
    const text = draft.trim();
    if (!text || flight.current || done) return;
    const version = revision.current;
    flight.current = true; setBusy(true); setError('');
    try {
      const result = next.current ? await next.current(text) : await startMessaging(channel, practiceArea, text);
      if (version !== revision.current) return;
      if (result.error) { setError(result.error); return; }
      setMessages(items => [...items, { author:'You', text }, ...result.replies.map(reply => ({author:'Screen', text:reply}))]);
      setDraft(''); next.current = result.advance;
      if (result.report) onReport(result.report);
      setDone(!result.advance);
    } catch {
      if (version === revision.current) setError('Your message could not be processed. Please try again.');
    } finally {
      if (version === revision.current) { flight.current = false; setBusy(false); }
    }
  }

  return <section aria-label={labels[channel]} className="mx-auto max-w-xl border border-[#c8c3bb] bg-white p-5 text-[#101923]">
    <h2 className="mb-4 text-xl font-bold">{labels[channel]}</h2>
    <div aria-live="polite">
      {messages.map((message,index) => <div key={index} className={message.author === 'You'
        ? 'ml-8 mb-3 bg-[#1e2f58] p-3 text-white' : 'mr-8 mb-3 bg-[#f4f3ef] p-3'}>
        <span className="block text-sm font-bold">{message.author}</span>
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>)}
    </div>
    {!done && <form onSubmit={event => { event.preventDefault(); void send(); }}>
      <label className="block font-semibold" htmlFor="parity-message">Your message</label>
      <textarea id="parity-message" className="my-2 block w-full border border-[#79756f] p-3" value={draft}
        rows={3} maxLength={4000} disabled={busy} onChange={event=>setDraft(event.target.value)} />
      <button type="submit" disabled={busy || !draft.trim()} className="min-h-11 bg-[#1e2f58] px-5 py-2 text-white disabled:opacity-60">
        {busy ? 'Reading your message…' : 'Send message'}
      </button>
    </form>}
    {error && <p role="alert" className="mt-3">{error}</p>}
  </section>;
}
