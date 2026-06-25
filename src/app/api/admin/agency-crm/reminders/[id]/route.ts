/**
 * /api/admin/agency-crm/reminders/[id]
 * Operator-only. PATCH toggles done, or edits due_at / note.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { updateReminder, isUuid, type ReminderPatch } from '@/lib/agency-crm';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const patch: ReminderPatch = {};
  if (typeof body.done === 'boolean') patch.done = body.done;
  if (typeof body.due_at === 'string' && !Number.isNaN(Date.parse(body.due_at))) patch.due_at = body.due_at;
  if (typeof body.note === 'string' && body.note.trim() !== '') patch.note = body.note.trim();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no valid fields to update' }, { status: 400 });
  }
  try {
    const reminder = await updateReminder(id, patch);
    if (!reminder) return NextResponse.json({ error: 'reminder not found' }, { status: 404 });
    return NextResponse.json({ reminder });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
