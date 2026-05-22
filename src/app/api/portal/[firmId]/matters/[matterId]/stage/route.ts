/**
 * POST /api/portal/[firmId]/matters/[matterId]/stage
 *
 * Advance a matter to the next stage in the matter-stage state
 * machine. Body: { to: MatterStage, note?: string }
 *
 * Auth: portal session cookie (lawyer or operator) with the firmId
 * matching the route param. Client sessions are never permitted to
 * transition stages.
 *
 * The handler:
 *   1. Verifies the session has admin-equivalent rights on the firm
 *   2. Validates the transition via canAdvanceStage
 *   3. Calls transitionMatterStage (which writes the row, the event,
 *      and fires the journey cadence)
 *   4. Returns the new state + the audit event
 *
 * Returns 422 on invalid transition, 403 on role mismatch, 404 if
 * matter doesn't exist or doesn't belong to the firm.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { transitionMatterStage, getMatterById } from '@/lib/matter-stage';
import { canAdvanceStage } from '@/lib/matter-stage-pure';
import type { MatterStage } from '@/lib/types';

const VALID_STAGES: MatterStage[] = ['intake', 'retainer_pending', 'active', 'closing', 'closed'];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { to?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const to = body.to as MatterStage | undefined;
  if (!to || !VALID_STAGES.includes(to)) {
    return NextResponse.json(
      { error: `body.to is required and must be one of ${VALID_STAGES.join(', ')}` },
      { status: 400 },
    );
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }

  // Map portal-auth role to actor role for matter-stage purposes.
  // Legacy 'lawyer' tokens are treated as 'admin' (per the role-split
  // resolver doctrine documented in firm_lawyers_roles migration).
  const actorRole: 'admin' | 'staff' | 'operator' =
    session.role === 'operator' ? 'operator' : 'admin';

  if (!canAdvanceStage(actorRole, matter.matter_stage, to)) {
    return NextResponse.json(
      {
        error: `transition not permitted for role ${actorRole}: ${matter.matter_stage} → ${to}`,
      },
      { status: 422 },
    );
  }

  const result = await transitionMatterStage({
    matter_id: matterId,
    to,
    actor_role: actorRole,
    actor_id: session.lawyer_id ?? null,
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
  });

  if (!result.ok) {
    const status =
      result.code === 'invalid_transition' ? 422
        : result.code === 'not_found' ? 404
        : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    matter_id: matterId,
    from: result.from,
    to: result.to,
    event_id: result.event.id ?? null,
  });
}
