/**
 * GET/POST /api/admin/firms/[firmId]/messages
 * Operator side of CaseLoad Connect. GET lists + marks read; POST sends.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { operatorActor, handleList, handleSend } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return handleList(firmId, operatorActor());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return handleSend(firmId, operatorActor(), req);
}
