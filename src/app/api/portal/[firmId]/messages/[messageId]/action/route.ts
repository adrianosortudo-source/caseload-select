/**
 * POST /api/portal/[firmId]/messages/[messageId]/action
 * Lawyer react / unreact / pin / unpin on a CaseLoad Connect message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { resolveLawyerActor, handleMessageAction } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; messageId: string }> },
) {
  const { firmId, messageId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const actor = await resolveLawyerActor(firmId, session.lawyer_id);
  if (!actor) return NextResponse.json({ error: 'lawyer identity required; sign in again' }, { status: 403 });
  return handleMessageAction(firmId, actor, messageId, req);
}
