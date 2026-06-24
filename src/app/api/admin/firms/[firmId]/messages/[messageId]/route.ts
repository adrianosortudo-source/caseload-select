/**
 * PATCH/DELETE /api/admin/firms/[firmId]/messages/[messageId]
 * Operator edit / soft-delete of own CaseLoad Connect message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { operatorActor, handleEdit, handleDelete } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; messageId: string }> },
) {
  const { firmId, messageId } = await params;
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return handleEdit(firmId, operatorActor(), messageId, req);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; messageId: string }> },
) {
  const { firmId, messageId } = await params;
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return handleDelete(firmId, operatorActor(), messageId);
}
