/**
 * GET /api/cron/cadence-runner
 *
 * Drives one tick of the SHADOW cadence engine (CRM Migration Plan Phase 2
 * rail 1). Enrolls matters into the J-series email cadences off their stage
 * transitions, and for every due touch records what it WOULD send into
 * outbound_messages with shadow = true. It dispatches nothing: no Resend, no
 * GHL change. GHL keeps running the real cadences for DRG. This is the data
 * source for the eventual shadow-vs-GHL diff before any rail cutover.
 *
 * Auth: Bearer CRON_SECRET / PG_CRON_TOKEN (same shape as the other crons).
 *
 * Optional query param: ?firmId=<uuid> scopes the tick to one firm.
 *
 * Scheduling: NOT yet wired into pg_cron. The engine is inert until the
 * migration (supabase/migrations-draft/20260703_cadence_engine_shadow.sql) is
 * applied; runCadenceEngine returns { applied: false } and no-ops when the
 * tables are absent, so this route is safe to deploy ahead of the migration.
 * Schedule it (and only then) once the shadow ledger has been eyeballed on a
 * manual run.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runCadenceEngine } from '@/lib/cadence-runner';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = req.nextUrl.searchParams.get('firmId') ?? undefined;

  try {
    const summary = await runCadenceEngine(firmId ? { firmId } : {});
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cadence-runner] tick failed', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
