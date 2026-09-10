import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { createProspectActivity, validateActivityInput } from '@/lib/prospect-operations';

/** Operator-only manual activity logging. This endpoint never sends a message. */
export async function POST(request: NextRequest) {
  const session = await getOperatorSession();
  if (!session?.lawyer_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const input = validateActivityInput(payload);
  if (!input) return NextResponse.json({ error: 'Invalid activity payload' }, { status: 400 });
  try {
    return NextResponse.json({ activity: await createProspectActivity(input, session.lawyer_id) }, { status: 201 });
  } catch (error) {
    const message = (error as Error).message;
    if (/duplicate key|idempotency|external_event/i.test(message)) return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
