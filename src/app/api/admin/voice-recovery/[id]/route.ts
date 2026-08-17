import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

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
    .select('id, follow_up_count')
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

  const { data, error } = await supabase
    .from('voice_recovery_cases')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: `recovery case update failed: ${error.message}` }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'voice recovery case not found' }, { status: 404 });
  return NextResponse.json({ ok: true, action: body.action, case: data });
}
