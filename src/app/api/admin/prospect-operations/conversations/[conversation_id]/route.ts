import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import {
  isProspectOperationsUuid,
  updateProspectConversationContactControls,
  validateProspectConversationContactControlsInput,
} from '@/lib/prospect-operations';

/** Operator-only contact-control update for an already-resolved conversation. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ conversation_id: string }> },
) {
  const session = await getOperatorSession();
  if (!session?.lawyer_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { conversation_id: conversationId } = await context.params;
  if (!isProspectOperationsUuid(conversationId)) {
    return NextResponse.json({ error: 'A valid conversation id is required' }, { status: 400 });
  }
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const input = validateProspectConversationContactControlsInput(payload);
  if (!input) return NextResponse.json({ error: 'Invalid contact-control payload' }, { status: 400 });
  try {
    return NextResponse.json(await updateProspectConversationContactControls(conversationId, input, session.lawyer_id));
  } catch (error) {
    const message = (error as Error).message;
    if (/provenance cannot be edited/i.test(message)) return NextResponse.json({ error: message }, { status: 409 });
    if (/conversation not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
