/**
 * POST /api/portal/[firmId]/messages/read
 * Lawyer marks the CaseLoad Connect channel read up to now.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { resolveLawyerActor, handleMarkRead } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const actor = await resolveLawyerActor(firmId, session.lawyer_id);
  if (!actor) return NextResponse.json({ error: 'lawyer identity required; sign in again' }, { status: 403 });
  return handleMarkRead(firmId, actor);
}
