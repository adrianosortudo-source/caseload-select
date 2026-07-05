/**
 * GET /api/cron/cadence-dispatch
 *
 * Manual-trigger entry for the DORMANT real-send dispatch path
 * (cadence-dispatch.ts). Short-circuits to { attempted: false } unless
 * CADENCE_REAL_SEND_ENABLED='true' is set, which this sprint never adds to
 * Vercel. Not scheduled in pg_cron; nothing wires this to run on its own.
 *
 * Auth: Bearer CRON_SECRET / PG_CRON_TOKEN (same shape as the other crons).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { dispatchScheduledCadenceMessages } from '@/lib/cadence-dispatch';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await dispatchScheduledCadenceMessages();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cadence-dispatch] tick failed', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
