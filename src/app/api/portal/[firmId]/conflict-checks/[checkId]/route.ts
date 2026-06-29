/**
 * PATCH /api/portal/[firmId]/conflict-checks/[checkId]
 *
 * Disposition a conflict check: clear, waive, or block.
 * Body: { disposition: 'cleared' | 'waived' | 'blocked', notes?: string }
 *
 * Auth: portal session (lawyer or operator) scoped to firmId.
 * Returns the updated check row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

const VALID_DISPOSITIONS = ['cleared', 'waived', 'blocked'] as const;
type Disposition = (typeof VALID_DISPOSITIONS)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; checkId: string }> },
) {
  const { firmId, checkId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let body: { disposition?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { disposition, notes } = body;
  if (!disposition || !VALID_DISPOSITIONS.includes(disposition as Disposition)) {
    return NextResponse.json(
      { error: `disposition must be one of ${VALID_DISPOSITIONS.join(', ')}` },
      { status: 400 },
    );
  }

  // Verify check belongs to this firm and exists
  const { data: existing } = await supabase
    .from('screened_conflict_checks')
    .select('id, firm_id, check_status')
    .eq('id', checkId)
    .eq('firm_id', firmId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'conflict check not found' }, { status: 404 });
  }

  if (['cleared', 'waived', 'blocked'].includes(existing.check_status)) {
    return NextResponse.json(
      { error: `check is already dispositioned as '${existing.check_status}'` },
      { status: 409 },
    );
  }

  const actor =
    session.role === 'operator' ? 'operator' : (session.lawyer_id ?? 'lawyer');

  const { data: updated, error } = await supabase
    .from('screened_conflict_checks')
    .update({
      check_status: disposition as Disposition,
      disposition: disposition as Disposition,
      dispositioned_by: actor,
      dispositioned_at: new Date().toISOString(),
      notes: notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', checkId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ check: updated });
}
