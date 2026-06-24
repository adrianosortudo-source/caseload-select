/**
 * GET/POST /api/portal/[firmId]/messages
 * Lawyer side of CaseLoad Connect. GET lists + marks read; POST sends.
 * Firm-session gated: only the firm's lawyers, never clients or operators.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { resolveLawyerActor, handleList, handleSend } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const actor = await resolveLawyerActor(firmId, session.lawyer_id);
  if (!actor) return NextResponse.json({ error: 'lawyer identity required; sign in again' }, { status: 403 });
  return handleList(firmId, actor);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const actor = await resolveLawyerActor(firmId, session.lawyer_id);
  if (!actor) return NextResponse.json({ error: 'lawyer identity required; sign in again' }, { status: 403 });
  return handleSend(firmId, actor, req);
}
