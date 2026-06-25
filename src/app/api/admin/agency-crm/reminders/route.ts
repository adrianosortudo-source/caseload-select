/**
 * /api/admin/agency-crm/reminders
 * Operator-only. Follow-up reminders, optionally tied to a prospect or deal.
 *   GET  ?open=true&prospect_id=<uuid>   list (open-only and/or by prospect)
 *   POST { due_at, note, prospect_id?, deal_id? }   create
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { listReminders, createReminder, isUuid, type ReminderInput } from '@/lib/agency-crm';

export async function GET(req: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const openOnly = url.searchParams.get('open') === 'true';
  const rawProspectId = url.searchParams.get('prospect_id');
  const prospectId = rawProspectId && rawProspectId.trim() !== '' ? rawProspectId : undefined;
  if (prospectId !== undefined && !isUuid(prospectId)) {
    return NextResponse.json({ error: 'invalid prospect_id' }, { status: 400 });
  }
  try {
    return NextResponse.json({ items: await listReminders({ openOnly, prospectId }) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const dueAt = typeof body.due_at === 'string' ? body.due_at : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!dueAt || Number.isNaN(Date.parse(dueAt))) return NextResponse.json({ error: 'due_at must be a valid date' }, { status: 400 });
  if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 });

  const prospectId = typeof body.prospect_id === 'string' && body.prospect_id.trim() !== '' ? body.prospect_id : null;
  const dealId = typeof body.deal_id === 'string' && body.deal_id.trim() !== '' ? body.deal_id : null;
  if (prospectId !== null && !isUuid(prospectId)) return NextResponse.json({ error: 'invalid prospect_id' }, { status: 400 });
  if (dealId !== null && !isUuid(dealId)) return NextResponse.json({ error: 'invalid deal_id' }, { status: 400 });

  const input: ReminderInput = {
    due_at: dueAt,
    note,
    prospect_id: prospectId,
    deal_id: dealId,
  };
  try {
    return NextResponse.json({ reminder: await createReminder(input) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
