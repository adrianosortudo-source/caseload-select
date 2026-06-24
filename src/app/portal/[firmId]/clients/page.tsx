/**
 * Lawyer home — active clients (S8 Phase 1 Story 5).
 *
 * URL: /portal/[firmId]/clients
 *
 * The "what am I responsible for right now" page. Lists all
 * client_matters that are not closed, grouped by stage, sorted
 * by most-recently-updated within each stage. Each row links to
 * the matter detail (when that surface ships in Phase 1 Sessions
 * 4-7 fully).
 *
 * Triage queue stays at /portal/[firmId]/triage as before. This
 * page is the post-take view: matters in flight.
 */

import { redirect } from 'next/navigation';
import { getFirmSession } from '@/lib/portal-auth';
import { listActiveMattersForFirm } from '@/lib/matter-stage';
import { formatTimestamp } from '@/lib/firm-timezone';
import type { ClientMatter, MatterStage } from '@/lib/types';

const STAGE_ORDER: MatterStage[] = ['intake', 'retainer_pending', 'active', 'closing'];
const STAGE_LABEL: Record<MatterStage, string> = {
  intake: 'Intake',
  retainer_pending: 'Retainer pending',
  active: 'Active',
  closing: 'Closing',
  closed: 'Closed',
};

interface PageProps {
  params: Promise<{ firmId: string }>;
}

export default async function LawyerClientsHomePage({ params }: PageProps) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    redirect(`/portal/${firmId}/login`);
  }

  const matters = await listActiveMattersForFirm(firmId, { limit: 200 });

  const grouped: Record<MatterStage, ClientMatter[]> = {
    intake: [],
    retainer_pending: [],
    active: [],
    closing: [],
    closed: [],
  };
  for (const m of matters) grouped[m.matter_stage].push(m);

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: 32 }}>
        <p style={eyebrowStyle}>Lawyer Triage · Active Clients</p>
        <h1 style={titleStyle}>Your active clients</h1>
        <p style={subTitleStyle}>
          {matters.length} matter{matters.length === 1 ? '' : 's'} in flight. Closed matters are in the History tab.
        </p>
      </header>

      {STAGE_ORDER.map((stage) => {
        const rows = grouped[stage];
        if (rows.length === 0) return null;
        return (
          <section key={stage} style={stageSectionStyle}>
            <h2 style={stageTitleStyle}>{STAGE_LABEL[stage]} <span style={countBadgeStyle}>{rows.length}</span></h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {rows.map((m) => (
                <li key={m.id} style={rowStyle}>
                  <a href={`/portal/${firmId}/matters/${m.id}`} style={rowLinkStyle}>
                    <div>
                      <p style={rowTitleStyle}>{m.primary_name}</p>
                      <p style={rowSubStyle}>{m.practice_area} · {m.matter_type}</p>
                    </div>
                    <p style={rowTimeStyle}>
                      {formatTimestamp(m.updated_at, undefined, { dateStyle: 'medium' })}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {matters.length === 0 && (
        <p style={{ color: '#888', fontSize: '1rem', marginTop: 32 }}>
          No active clients yet. New matters appear here as soon as you take a Band A lead from the triage queue.
        </p>
      )}
    </main>
  );
}

const pageStyle = {
  maxWidth: 920,
  margin: '0 auto',
  padding: '40px 24px',
  fontFamily: "'Manrope', system-ui, sans-serif",
  color: '#0D1520',
} as const;

const eyebrowStyle = {
  fontFamily: "'Oxanium', system-ui, sans-serif",
  fontSize: '0.72rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: 'var(--portal-accent)',
  margin: 0,
};

const titleStyle = {
  fontSize: '1.8rem',
  fontWeight: 800 as const,
  color: '#1E2F58',
  margin: '8px 0 4px 0',
};

const subTitleStyle = {
  fontSize: '0.95rem',
  color: '#666',
  margin: 0,
};

const stageSectionStyle = {
  marginBottom: 32,
};

const stageTitleStyle = {
  fontSize: '1rem',
  fontWeight: 800 as const,
  color: '#1E2F58',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  borderBottom: '2px solid var(--portal-accent)',
  paddingBottom: 6,
  marginBottom: 12,
};

const countBadgeStyle = {
  display: 'inline-block',
  background: 'var(--portal-accent)',
  color: '#fff',
  fontSize: '0.78rem',
  padding: '2px 8px',
  borderRadius: 10,
  marginLeft: 8,
};

const rowStyle = {
  borderBottom: '1px solid #E0DDD3',
};

const rowLinkStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 0',
  textDecoration: 'none',
  color: 'inherit',
} as const;

const rowTitleStyle = {
  fontSize: '1.02rem',
  fontWeight: 700 as const,
  color: '#0D1520',
  margin: 0,
};

const rowSubStyle = {
  fontSize: '0.84rem',
  color: '#888',
  margin: '2px 0 0 0',
};

const rowTimeStyle = {
  fontSize: '0.78rem',
  color: '#888',
  margin: 0,
  whiteSpace: 'nowrap' as const,
};
