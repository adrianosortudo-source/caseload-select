/**
 * GET   /api/portal/[firmId]/config/folder-lock
 *   → returns the current client_files_locked state for the firm.
 *
 * PATCH /api/portal/[firmId]/config/folder-lock
 *   body { locked: boolean }
 *   → flips the firm-level client_files_locked toggle. When true,
 *     client sessions cannot mutate folder structure under
 *     firm_files (Story 10).
 *
 * Auth: firm session (admin / operator). Phase 1 doesn't gate by
 * sub-role within the firm because firm_lawyers role gating wires
 * in next session — for tonight, the portal cookie already proves
 * firm-side identity.
 *
 * The actual enforcement of client_files_locked happens in the
 * firm-files upload + delete routes, which check the firm flag
 * before permitting writes from a client-role session. (Phase 1
 * doesn't yet expose firm-files to client sessions — the toggle
 * lands now so when the client-files surface arrives in Phase 2
 * the gate is already wired.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { data: firm, error: fetchErr } = await supabase
    .from('intake_firms')
    .select('id, client_files_locked')
    .eq('id', firmId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!firm) {
    return NextResponse.json({ error: 'firm not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    firm_id: firmId,
    client_files_locked: !!firm.client_files_locked,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { locked?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body.locked !== 'boolean') {
    return NextResponse.json(
      { error: 'body.locked must be a boolean' },
      { status: 400 },
    );
  }

  const { error: updateErr } = await supabase
    .from('intake_firms')
    .update({ client_files_locked: body.locked })
    .eq('id', firmId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    firm_id: firmId,
    client_files_locked: body.locked,
  });
}
