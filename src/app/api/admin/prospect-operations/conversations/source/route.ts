import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import {
  getProspectSourceConversation,
  updateProspectConversationContactControls,
  validateProspectConversationContactControlsInput,
} from '@/lib/prospect-operations';

function validSourceSystem(value: string | null): value is string {
  return Boolean(value && /^[a-z][a-z0-9_]{0,119}$/.test(value.trim()));
}

function parseBoundedInteger(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/** Operator-only conversation lookup that preserves the requested source's history. */
export async function GET(request: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sourceSystem = request.nextUrl.searchParams.get('source_system');
  const sourceRecordKey = request.nextUrl.searchParams.get('source_record_key');
  const limit = parseBoundedInteger(request.nextUrl.searchParams.get('limit'), 50, 1, 100);
  const offset = parseBoundedInteger(request.nextUrl.searchParams.get('offset'), 0, 0, 100_000);
  if (!validSourceSystem(sourceSystem) || !sourceRecordKey?.trim() || sourceRecordKey.trim().length > 300 || limit === null || offset === null) {
    return NextResponse.json({ error: 'A valid source_system and source_record_key are required' }, { status: 400 });
  }
  try {
    const conversation = await getProspectSourceConversation(sourceSystem.trim(), sourceRecordKey.trim(), { limit, offset });
    return conversation ? NextResponse.json({ conversation }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** Updates only controls for the conversation attached to this immutable source record. */
export async function PATCH(request: NextRequest) {
  const session = await getOperatorSession();
  if (!session?.lawyer_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Invalid contact-control payload' }, { status: 400 });
  const row = payload as Record<string, unknown>;
  const sourceSystem = typeof row.source_system === 'string' ? row.source_system.trim() : '';
  const sourceRecordKey = typeof row.source_record_key === 'string' ? row.source_record_key.trim() : '';
  if (!validSourceSystem(sourceSystem) || !sourceRecordKey || sourceRecordKey.length > 300) {
    return NextResponse.json({ error: 'A valid source_system and source_record_key are required' }, { status: 400 });
  }
  const input = validateProspectConversationContactControlsInput(row);
  if (!input) return NextResponse.json({ error: 'Invalid contact-control payload' }, { status: 400 });
  try {
    const conversation = await getProspectSourceConversation(sourceSystem, sourceRecordKey);
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const controls = await updateProspectConversationContactControls(conversation.id, input, session.lawyer_id);
    return NextResponse.json(controls);
  } catch (error) {
    const message = (error as Error).message;
    if (/provenance cannot be edited/i.test(message)) return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
