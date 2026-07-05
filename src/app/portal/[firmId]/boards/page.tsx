/**
 * /portal/[firmId]/boards
 *
 * The three productized dashboard boards (WP-5, CaseLoad_CRM_Migration_Plan_v1.md
 * §6.1 note 3): Triage, Pipeline, Health. Server-rendered; the tab switch and
 * Save-As form are client-side (BoardTabs.tsx) but the underlying data is
 * fetched once at request time.
 *
 * Session: firm-side only (lawyer / operator).
 */

import { requirePortalViewer } from '@/lib/portal-auth';
import { computeAllBoardsForFirm, listDashboardViews } from '@/lib/dashboard-boards';
import BoardTabs from './BoardTabs';

interface PageProps {
  params: Promise<{ firmId: string }>;
}

export default async function BoardsPage({ params }: PageProps) {
  const { firmId } = await params;
  const { session } = await requirePortalViewer(firmId);

  const [boards, savedViews] = await Promise.all([
    computeAllBoardsForFirm(firmId),
    listDashboardViews(firmId, session.lawyer_id ?? null),
  ]);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px' }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: '#8a7a5c' }}>
        Boards
      </p>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E2F58', marginTop: 4, marginBottom: 20 }}>
        Triage, Pipeline, Health
      </h1>
      <BoardTabs firmId={firmId} boards={boards} savedViews={savedViews} />
    </div>
  );
}
