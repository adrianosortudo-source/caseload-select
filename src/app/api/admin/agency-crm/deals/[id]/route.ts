/**
 * /api/admin/agency-crm/deals/[id]
 * Operator-only. PATCH updates deal fields, including advancing the stage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { updateDeal, isDealStage, isUuid, type DealPatch } from '@/lib/agency-crm';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (body.stage !== undefined && !isDealStage(body.stage)) {
    return NextResponse.json({ error: 'invalid stage' }, { status: 400 });
  }

  const patch: DealPatch = {};
  if (typeof body.title === 'string' && body.title.trim() !== '') patch.title = body.title.trim();
  if (isDealStage(body.stage)) patch.stage = body.stage;
  if ('monthly_value' in body) patch.monthly_value = typeof body.monthly_value === 'number' && Number.isFinite(body.monthly_value) ? body.monthly_value : null;
  if ('expected_close' in body) patch.expected_close = typeof body.expected_close === 'string' && body.expected_close.trim() !== '' ? body.expected_close : null;
  if ('notes' in body) patch.notes = typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.trim() : null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no valid fields to update' }, { status: 400 });
  }

  try {
    const deal = await updateDeal(id, patch);
    if (!deal) return NextResponse.json({ error: 'deal not found' }, { status: 404 });
    return NextResponse.json({ deal });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
