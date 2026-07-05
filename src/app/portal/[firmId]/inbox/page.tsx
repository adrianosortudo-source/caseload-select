/**
 * Unified staff inbox (CaseLoad_CRM_Migration_Plan_v1.md §4 "Unified staff
 * inbox" gap). One threaded view across every non-closed matter's messages,
 * sorted by most recent activity, with an inline detail pane so a lawyer or
 * operator reads and replies without leaving the page.
 *
 * Reply delivery rides the existing matter_messages send path (insertMessage,
 * the same digest notification pipeline every other message uses); no new
 * live send rail is introduced here.
 *
 * Session: firm-side only (lawyer / operator). Client sessions never reach
 * this surface.
 */

import Link from 'next/link';
import { requirePortalViewer } from '@/lib/portal-auth';
import { listInboxThreadsForFirm } from '@/lib/staff-inbox';
import { previewBody } from '@/lib/staff-inbox-pure';
import { formatTimestamp } from '@/lib/firm-timezone';
import InboxThreadPanel from './InboxThreadPanel';
import type { MatterStage } from '@/lib/types';

const STAGE_LABEL: Record<MatterStage, string> = {
  intake: 'Intake',
  retainer_pending: 'Retainer pending',
  active: 'Active',
  closing: 'Closing',
  closed: 'Closed',
};

interface PageProps {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ matter?: string }>;
}

export default async function StaffInboxPage({ params, searchParams }: PageProps) {
  const { firmId } = await params;
  const { matter: selectedMatterId } = await searchParams;
  await requirePortalViewer(firmId);

  const threads = await listInboxThreadsForFirm(firmId);
  const activeMatterId = selectedMatterId ?? threads[0]?.matter.id ?? null;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', minHeight: 480 }}>
      <aside style={{ width: 340, borderRight: '1px solid rgba(0,0,0,0.08)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '16px 16px 8px' }}>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: '#8a7a5c' }}>
            Inbox
          </p>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E2F58', marginTop: 4 }}>
            {threads.length} conversation{threads.length === 1 ? '' : 's'}
          </h1>
        </div>
        {threads.length === 0 ? (
          <p style={{ padding: '0 16px', fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>
            No open matters yet. Threads appear here once a lead is taken.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {threads.map((t) => {
              const isActive = t.matter.id === activeMatterId;
              return (
                <li key={t.matter.id}>
                  <Link
                    href={`/portal/${firmId}/inbox?matter=${t.matter.id}`}
                    style={{
                      display: 'block',
                      padding: '10px 16px',
                      borderBottom: '1px solid rgba(0,0,0,0.05)',
                      background: isActive ? 'rgba(30,47,88,0.06)' : 'transparent',
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#1E2F58' }}>{t.matter.primary_name}</span>
                      <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>{formatTimestamp(t.lastActivityAt)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>
                      {STAGE_LABEL[t.matter.matter_stage]} &middot; {t.matter.matter_type.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.lastMessage ? previewBody(t.lastMessage.body) : 'No messages yet'}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section style={{ flex: 1, overflowY: 'auto' }}>
        {activeMatterId ? (
          <InboxThreadPanel firmId={firmId} matterId={activeMatterId} />
        ) : (
          <div style={{ padding: 24, color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>Select a conversation.</div>
        )}
      </section>
    </div>
  );
}
