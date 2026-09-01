/**
 * Lawyer home - active clients (S8 Phase 1 Story 5).
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

import { requirePortalViewer } from '@/lib/portal-auth';
import { listActiveMattersForFirm } from '@/lib/matter-stage';
import { formatTimestamp } from '@/lib/firm-timezone';
import type { ClientMatter, MatterStage } from '@/lib/types';
import Link from 'next/link';

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
  // Operator-view contract (DR-076): admits operator read-only and fixes the
  // prior redirect to the non-existent /portal/[firmId]/login (a hard 404 that
  // also hit real lawyers arriving without a session).
  const viewer = await requirePortalViewer(firmId);

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
    <div style={pageStyle}>
      <header style={{ marginBottom: 32 }}>
        <p style={eyebrowStyle}>Lawyer Triage · Active Clients</p>
        <h1 style={titleStyle}>Your active clients</h1>
        <p style={subTitleStyle}>
          {matters.length} matter{matters.length === 1 ? '' : 's'} in flight. Closed matters are in the History tab.
        </p>
      </header>

      <section className="readable-prose mb-8 border border-black/10 bg-white p-5 sm:p-6" aria-labelledby="relationship-import-heading">
        <p className="font-display text-[0.68rem] uppercase tracking-[0.14em] text-[color:var(--portal-accent)]">Relationship database</p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 id="relationship-import-heading" className="measure-heading text-xl font-extrabold text-navy">Bring your existing contacts into CaseLoad Select</h2>
            <p className="mt-2 text-sm leading-6 text-black/60">
              Prepare and review the import here. The original CSV stays in your browser, possible duplicates are held for review, and no messages are sent.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <a href="/templates/caseload-select-relationship-import.csv" download className="border border-navy/20 px-4 py-2.5 text-sm font-bold text-navy outline-none hover:border-navy focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2">
              Download CSV template
            </a>
            <Link href={`/portal/${firmId}/clients/import`} className="bg-navy px-4 py-2.5 text-sm font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2">
              {viewer.isOperator ? 'Inspect secure import room' : 'Open secure import room'}
            </Link>
          </div>
        </div>
      </section>

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
    </div>
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
