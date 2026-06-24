/**
 * POST /api/portal/[firmId]/messages/upload
 * Lawyer uploads an attachment for a CaseLoad Connect message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { handleUpload } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  return handleUpload(firmId, req);
}
