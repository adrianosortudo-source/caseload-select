/**
 * /api/admin/agency-crm/prospects/[id]
 * Operator-only. PATCH updates prospect fields, including advancing the stage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { updateProspect, isProspectStage, isUuid, DUPLICATE_PROSPECT_MESSAGE, type ProspectPatch } from '@/lib/agency-crm';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (body.stage !== undefined && !isProspectStage(body.stage)) {
    return NextResponse.json({ error: 'invalid stage' }, { status: 400 });
  }
  if ('fit_score' in body && body.fit_score !== null && !(typeof body.fit_score === 'number' && Number.isFinite(body.fit_score) && body.fit_score >= 0 && body.fit_score <= 100)) {
    return NextResponse.json({ error: 'fit_score must be a number between 0 and 100' }, { status: 400 });
  }

  const patch: ProspectPatch = {};
  if (typeof body.firm_name === 'string' && body.firm_name.trim() !== '') patch.firm_name = body.firm_name.trim();
  if ('contact_name' in body) patch.contact_name = strOrNull(body.contact_name);
  if ('contact_email' in body) patch.contact_email = strOrNull(body.contact_email);
  if ('contact_phone' in body) patch.contact_phone = strOrNull(body.contact_phone);
  if ('city' in body) patch.city = strOrNull(body.city);
  if ('practice_area' in body) patch.practice_area = strOrNull(body.practice_area);
  if ('source' in body) patch.source = strOrNull(body.source);
  if (isProspectStage(body.stage)) patch.stage = body.stage;
  if ('fit_score' in body) patch.fit_score = typeof body.fit_score === 'number' && Number.isFinite(body.fit_score) ? body.fit_score : null;
  if ('notes' in body) patch.notes = strOrNull(body.notes);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no valid fields to update' }, { status: 400 });
  }

  try {
    const prospect = await updateProspect(id, patch);
    if (!prospect) return NextResponse.json({ error: 'prospect not found' }, { status: 404 });
    return NextResponse.json({ prospect });
  } catch (e) {
    const message = (e as Error).message;
    // Renaming firm_name/city onto another prospect's dedupe_key (2026-07-06
    // constraint) is a conflict the operator can act on, not a server fault.
    if (message === DUPLICATE_PROSPECT_MESSAGE) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
