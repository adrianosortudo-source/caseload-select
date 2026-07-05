/**
 * POST /api/admin/firms/[firmId]/ghl-export
 *
 * Operator-triggered read-only pull of a firm's GHL contacts + conversations
 * (WP-8, CaseLoad_CRM_Migration_Plan_v1.md Phase 0: "Export contact +
 * conversation history"). Read-only against GHL; writes only to the two
 * ghl_export_* tables in this app's own database.
 *
 * Auth (operator scope, DR-063): Bearer CRON_SECRET / PG_CRON_TOKEN, or an
 * operator session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { isCronAuthorized } from '@/lib/cron-auth';
import { exportGhlHistoryForFirm } from '@/lib/ghl-export';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const cronAuthed = isCronAuthorized(req);
  const operatorSession = cronAuthed ? null : await getOperatorSession();
  if (!cronAuthed && !operatorSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const summary = await exportGhlHistoryForFirm(firmId);
  if (!summary.ok) {
    return NextResponse.json(summary, { status: 502 });
  }
  return NextResponse.json(summary);
}
