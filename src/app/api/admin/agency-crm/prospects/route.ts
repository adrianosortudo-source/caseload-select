/**
 * /api/admin/agency-crm/prospects
 * Operator-only. Layer B agency CRM: prospect firms in the retainer sales pipeline.
 *   GET  ?stage=<ProspectStage>   list (optional stage filter)
 *   POST { firm_name, ... }       create
 */
import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { listProspectsPage, createProspect, isProspectStage, DUPLICATE_PROSPECT_MESSAGE, type ProspectInput } from '@/lib/agency-crm';

export async function GET(req: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const stageParam = sp.get('stage');
  const stage = isProspectStage(stageParam) ? stageParam : undefined;
  const search = sp.get('q') ?? sp.get('search');

  // Bounded page + exact total + search. Previously this returned an unbounded
  // listProspects(), silently capped by PostgREST at ~1000 rows with 5,648
  // prospects seeded (Codex audit 2026-07-07, finding 4). limit/offset are
  // clamped inside listProspectsPage; a non-numeric value falls back to the
  // default rather than NaN.
  const limitRaw = Number(sp.get('limit'));
  const offsetRaw = Number(sp.get('offset'));

  try {
    const page = await listProspectsPage({
      stage,
      search,
      limit: sp.get('limit') != null && Number.isFinite(limitRaw) ? limitRaw : undefined,
      offset: sp.get('offset') != null && Number.isFinite(offsetRaw) ? offsetRaw : undefined,
    });
    // `items` retained for backward compatibility; total/limit/offset added.
    return NextResponse.json(page);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const firmName = typeof body.firm_name === 'string' ? body.firm_name.trim() : '';
  if (!firmName) return NextResponse.json({ error: 'firm_name is required' }, { status: 400 });
  if (body.stage !== undefined && !isProspectStage(body.stage)) {
    return NextResponse.json({ error: 'invalid stage' }, { status: 400 });
  }
  if (body.fit_score !== undefined && body.fit_score !== null && !(typeof body.fit_score === 'number' && Number.isFinite(body.fit_score) && body.fit_score >= 0 && body.fit_score <= 100)) {
    return NextResponse.json({ error: 'fit_score must be a number between 0 and 100' }, { status: 400 });
  }

  const input: ProspectInput = {
    firm_name: firmName,
    contact_name: str(body.contact_name),
    contact_email: str(body.contact_email),
    contact_phone: str(body.contact_phone),
    city: str(body.city),
    practice_area: str(body.practice_area),
    source: str(body.source),
    stage: isProspectStage(body.stage) ? body.stage : undefined,
    fit_score: num(body.fit_score),
    notes: str(body.notes),
  };
  try {
    return NextResponse.json({ prospect: await createProspect(input) }, { status: 201 });
  } catch (e) {
    const message = (e as Error).message;
    // The dedupe_key constraint (2026-07-06) blocks a manual add that
    // duplicates an existing prospect's name+city; that is a conflict the
    // operator can act on, not a server fault.
    if (message === DUPLICATE_PROSPECT_MESSAGE) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
