/**
 * POST /api/admin/firms/[firmId]/messages/[messageId]/action
 * Operator react / unreact / pin / unpin on a CaseLoad Connect message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { operatorActor, handleMessageAction } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; messageId: string }> },
) {
  const { firmId, messageId } = await params;
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return handleMessageAction(firmId, operatorActor(), messageId, req);
}
