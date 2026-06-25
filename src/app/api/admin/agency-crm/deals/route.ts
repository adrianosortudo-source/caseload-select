/**
 * /api/admin/agency-crm/deals
 * Operator-only. Retainer sales opportunities attached to a prospect.
 *   GET  ?prospect_id=<uuid>   list (optional filter)
 *   POST { prospect_id, title, ... }   create
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { listDeals, createDeal, isDealStage, isUuid, type DealInput } from '@/lib/agency-crm';

export async function GET(req: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rawProspectId = new URL(req.url).searchParams.get('prospect_id');
  const prospectId = rawProspectId && rawProspectId.trim() !== '' ? rawProspectId : undefined;
  if (prospectId !== undefined && !isUuid(prospectId)) {
    return NextResponse.json({ error: 'invalid prospect_id' }, { status: 400 });
  }
  try {
    return NextResponse.json({ items: await listDeals(prospectId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const prospectId = typeof body.prospect_id === 'string' ? body.prospect_id : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!prospectId) return NextResponse.json({ error: 'prospect_id is required' }, { status: 400 });
  if (!isUuid(prospectId)) return NextResponse.json({ error: 'invalid prospect_id' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
  if (body.stage !== undefined && !isDealStage(body.stage)) {
    return NextResponse.json({ error: 'invalid stage' }, { status: 400 });
  }

  const input: DealInput = {
    prospect_id: prospectId,
    title,
    stage: isDealStage(body.stage) ? body.stage : undefined,
    monthly_value: typeof body.monthly_value === 'number' && Number.isFinite(body.monthly_value) ? body.monthly_value : null,
    expected_close: typeof body.expected_close === 'string' && body.expected_close.trim() !== '' ? body.expected_close : null,
    notes: typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.trim() : null,
  };
  try {
    return NextResponse.json({ deal: await createDeal(input) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
