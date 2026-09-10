import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { getAgencyProspectConversation, isProspectOperationsUuid } from '@/lib/prospect-operations';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!isProspectOperationsUuid(id)) return NextResponse.json({ error: 'A valid agency prospect id is required' }, { status: 400 });
  try {
    const conversation = await getAgencyProspectConversation(id);
    return conversation ? NextResponse.json({ conversation }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
