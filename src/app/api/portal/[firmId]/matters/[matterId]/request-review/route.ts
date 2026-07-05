/**
 * POST /api/portal/[firmId]/matters/[matterId]/request-review
 *
 * Manual review-request trigger (WP-4, CaseLoad_CRM_Migration_Plan_v1.md §11
 * "Review automation"). Enrolls the matter into J9 (Google Review Request)
 * on demand, the same cadence the active -> closing stage transition already
 * enrolls automatically. A lawyer can ask for a review at any point in the
 * matter's life, not only at that one transition.
 *
 * Still shadow-only: enrollment writes a cadence_runs row; the next cadence
 * tick logs the would-be touches into outbound_messages with shadow=true.
 * Nothing dispatches from this route itself.
 *
 * Idempotent: a second call for a matter already enrolled in J9 returns
 * alreadyEnrolled: true rather than erroring or double-enrolling.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { getMatterById } from '@/lib/matter-stage';
import { enrollMatterInCadence } from '@/lib/cadence-runner';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }

  const result = await enrollMatterInCadence({
    matterId,
    firmId,
    screenedLeadId: matter.source_screened_lead_id,
    cadenceKey: 'J9',
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, alreadyEnrolled: result.alreadyEnrolled });
}
