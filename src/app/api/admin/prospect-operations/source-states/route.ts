import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { listProspectSourceContactStates } from '@/lib/prospect-operations';

function validSourceSystem(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,119}$/.test(value.trim());
}

/** Operator-only batch status lookup for any immutable prospect source system. */
export async function POST(request: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Invalid source-state payload' }, { status: 400 });
  const row = payload as Record<string, unknown>;
  if (!validSourceSystem(row.source_system)
    || !Array.isArray(row.source_record_keys)
    || row.source_record_keys.length > 100
    || row.source_record_keys.some((key) => typeof key !== 'string' || !key.trim() || key.trim().length > 300)) {
    return NextResponse.json({ error: 'Invalid source-state payload' }, { status: 400 });
  }
  try {
    const states = await listProspectSourceContactStates(
      row.source_system.trim(),
      row.source_record_keys.map((key) => (key as string).trim()),
    );
    return NextResponse.json({ states: states });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
