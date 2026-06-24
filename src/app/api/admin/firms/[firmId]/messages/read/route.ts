/**
 * POST /api/admin/firms/[firmId]/messages/read
 * Operator marks the firm's channel read up to now.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { operatorActor, handleMarkRead } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return handleMarkRead(firmId, operatorActor());
}
