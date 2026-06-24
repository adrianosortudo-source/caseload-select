/**
 * PATCH/DELETE /api/portal/[firmId]/messages/[messageId]
 * Lawyer edit / soft-delete of own CaseLoad Connect message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { resolveLawyerActor, handleEdit, handleDelete } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; messageId: string }> },
) {
  const { firmId, messageId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const actor = await resolveLawyerActor(firmId, session.lawyer_id);
  if (!actor) return NextResponse.json({ error: 'lawyer identity required; sign in again' }, { status: 403 });
  return handleEdit(firmId, actor, messageId, req);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; messageId: string }> },
) {
  const { firmId, messageId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const actor = await resolveLawyerActor(firmId, session.lawyer_id);
  if (!actor) return NextResponse.json({ error: 'lawyer identity required; sign in again' }, { status: 403 });
  return handleDelete(firmId, actor, messageId);
}
