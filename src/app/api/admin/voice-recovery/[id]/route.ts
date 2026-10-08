import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { appendVoiceRecoveryAuditEvent } from '@/lib/voice-recovery';

type Action = 'acknowledge' | 'assign' | 'follow_up' | 'resolve';
const FOLLOW_UP_STATES = new Set(['not_started', 'scheduled', 'attempted', 'completed', 'not_needed']);

/** Operator mutations for a recovery case. Promotion deliberately lives at
 * POST /[id]/promote so callers cannot accidentally promote via a generic
 * state update. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  let body: { action?: Action; follow_up_state?: string; follow_up_note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }
  if (!body.action || !['acknowledge', 'assign', 'follow_up', 'resolve'].includes(body.action)) {
    return NextResponse.json({ error: 'action must be acknowledge, assign, follow_up, or resolve' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const actor = session.lawyer_id ?? 'operator';
  const { data: existing, error: existingError } = await supabase
    .from('voice_recovery_cases')
    .select('id, follow_up_count, owner_name')
    .eq('id', id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: `recovery case lookup failed: ${existingError.message}` }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'voice recovery case not found' }, { status: 404 });
  let patch: Record<string, unknown>;
  if (body.action === 'acknowledge') {
    patch = { status: 'acknowledged', acknowledged_at: now, acknowledged_by: actor };
  } else if (body.action === 'assign') {
    // A bare assign is the UI's "Claim" action: authenticate first, then
    // attribute it to the session actor instead of trusting a body field.
    patch = { owner_name: actor, status: 'acknowledged', acknowledged_at: now, acknowledged_by: actor };
  } else if (body.action === 'follow_up') {
    const state = body.follow_up_state ?? 'attempted';
    if (!FOLLOW_UP_STATES.has(state)) return NextResponse.json({ error: 'invalid follow_up_state' }, { status: 400 });
    patch = {
      follow_up_state: state,
      follow_up_count: state === 'attempted' ? (existing.follow_up_count ?? 0) + 1 : existing.follow_up_count ?? 0,
      last_follow_up_at: now,
      last_follow_up_summary: body.follow_up_note?.trim() || null,
      status: 'acknowledged',
      acknowledged_at: now,
      acknowledged_by: actor,
    };
  } else {
    patch = {
      status: 'resolved',
      follow_up_state: 'completed',
      last_follow_up_summary: body.follow_up_note?.trim() || null,
      last_follow_up_at: body.follow_up_note?.trim() ? now : null,
    };
  }

  let update = supabase.from('voice_recovery_cases').update(patch).eq('id', id);
  // Claim is compare-and-set, not a read-then-write: two operators can click
  // Claim simultaneously, but only the row that is still unowned can change.
  if (body.action === 'assign') update = update.is('owner_name', null);
  const { data, error } = await update.select('*').maybeSingle();
  if (error) return NextResponse.json({ error: `recovery case update failed: ${error.message}` }, { status: 500 });
  if (!data && body.action === 'assign') {
    const { data: current, error: currentError } = await supabase
      .from('voice_recovery_cases')
      .select('owner_name')
      .eq('id', id)
      .maybeSingle();
    if (currentError) return NextResponse.json({ error: `recovery case ownership lookup failed: ${currentError.message}` }, { status: 500 });
    if (!current) return NextResponse.json({ error: 'voice recovery case not found' }, { status: 404 });
    return NextResponse.json(
      { error: 'voice recovery case already claimed', owner_name: current.owner_name },
      { status: 409 },
    );
  }
  if (!data) return NextResponse.json({ error: 'voice recovery case not found' }, { status: 404 });
  const auditEvent = body.action === 'acknowledge'
    ? 'acknowledged'
    : body.action === 'assign'
      ? 'assigned'
      : body.action === 'follow_up'
        ? 'follow_up'
        : 'resolved';
  await appendVoiceRecoveryAuditEvent({
    recoveryCaseId: id,
    eventType: auditEvent,
    actorType: 'operator',
    actorId: actor,
    detail: { action: body.action, owner: data.owner_name ?? actor, follow_up_state: body.follow_up_state ?? null },
  });
  return NextResponse.json({ ok: true, action: body.action, case: data });
}
