/**
 * GET/POST /api/portal/[firmId]/boards
 *
 * The three productized dashboard boards (WP-5, CaseLoad_CRM_Migration_Plan_v1.md
 * §6.1 note 3): Triage (queue health), Pipeline (matters by stage), Health
 * (system-level signal: consent coverage, channel mix, shadow cadence volume,
 * notification failures). "View" is the query primitive; GET also returns
 * saved views visible to this actor (firm-wide defaults plus their own), and
 * POST lets a lawyer Save-As a personal copy.
 *
 * Auth: portal session cookie, lawyer or operator only (DR-063).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPortalSession } from '@/lib/portal-auth';
import { denyWriteIfPreview } from '@/lib/preview-guard';
import { computeAllBoardsForFirm, listDashboardViews, saveDashboardView } from '@/lib/dashboard-boards';

function isAuthorized(session: { firm_id: string; role: string } | null, firmId: string): boolean {
  return !!session && session.role !== 'client' && (session.role === 'operator' || session.firm_id === firmId);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getPortalSession();
  if (!isAuthorized(session, firmId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [boards, views] = await Promise.all([
    computeAllBoardsForFirm(firmId),
    listDashboardViews(firmId, session!.lawyer_id ?? null),
  ]);

  return NextResponse.json({ ...boards, savedViews: views });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getPortalSession();
  if (!isAuthorized(session, firmId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  const body = (await req.json()) as { board_key?: string; name?: string; filters?: Record<string, unknown> };
  const boardKey = body.board_key;
  const name = (body.name ?? '').trim();
  if (boardKey !== 'triage' && boardKey !== 'pipeline' && boardKey !== 'health') {
    return NextResponse.json({ error: 'board_key must be triage, pipeline, or health' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const result = await saveDashboardView({
    firmId,
    owner: session!.lawyer_id ?? null,
    boardKey,
    name,
    filters: body.filters ?? {},
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, view: result.view });
}
