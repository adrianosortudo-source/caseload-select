/**
 * POST /api/admin/firms/[firmId]/messages/upload
 * Operator uploads an attachment for a CaseLoad Connect message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { handleUpload } from '@/lib/operator-firm-messaging-handlers';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  return handleUpload(firmId, req);
}
