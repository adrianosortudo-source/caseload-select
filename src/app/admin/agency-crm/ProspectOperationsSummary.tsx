'use client';

import { useEffect, useState } from 'react';
import type { ProspectContactReport } from '@/lib/prospect-operations-types';
import { PROSPECT_OPERATIONS_CHANGED_EVENT } from './prospect-operations-events';

const EMPTY_REPORT: ProspectContactReport = {
  as_of: '',
  conversations: 0,
  unique_firms: 0,
  unique_people: 0,
  eligible_conversations: 0,
  suppressed_conversations: 0,
  unknown_contactability: 0,
  not_contacted: 0,
  awaiting_reply: 0,
  replied: 0,
  unreachable: 0,
  declined: 0,
  meeting_scheduled: 0,
  completed: 0,
  messages_sent: 0,
  human_replies: 0,
  automated_replies: 0,
  bounces: 0,
  meetings: 0,
};

const STATS: Array<{ key: keyof ProspectContactReport; label: string }> = [
  { key: 'conversations', label: 'Conversations' },
  { key: 'awaiting_reply', label: 'Awaiting reply' },
  { key: 'human_replies', label: 'Human reply events' },
  { key: 'messages_sent', label: 'Messages logged' },
  { key: 'bounces', label: 'Bounces' },
  { key: 'meetings', label: 'Meetings' },
];

export default function ProspectOperationsSummary() {
  const [report, setReport] = useState<ProspectContactReport>(EMPTY_REPORT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const refresh = () => setRefreshToken((current) => current + 1);
    window.addEventListener(PROSPECT_OPERATIONS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PROSPECT_OPERATIONS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/admin/prospect-operations/report')
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Could not load contact report (${response.status})`);
        return payload as { report?: ProspectContactReport };
      })
      .then((payload) => {
        if (!cancelled && payload.report) setReport(payload.report);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshToken]);

  return (
    <section className="bg-white border border-black/10" data-ui-component-content="prospect-operations-summary">
      <div className="px-4 py-3 border-b border-black/10">
        <div>
          <h2 className="text-xs uppercase tracking-[0.14em] font-semibold text-navy" data-ui-copy="heading">Contact activity</h2>
          <p className="text-xs text-black/50 mt-1" data-ui-copy="supporting">Counts come from confirmed activity records.</p>
          <p className="text-xs text-black/50 mt-1" data-ui-copy="supporting">Reply events and replied conversations are counted separately.</p>
        </div>
        {error && <p className="mt-2 text-xs text-red-700" data-ui-copy="supporting">{error}</p>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {STATS.map((stat) => (
          <div key={stat.key} className="px-4 py-3 border-b border-r border-black/10 last:border-r-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-black/45" data-ui-copy="supporting">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-navy tabular-nums" data-ui-copy="heading">{loading ? '…' : report[stat.key]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
