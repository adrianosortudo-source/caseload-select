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
 * Scheduling: NOT yet wired into pg_cron, and still deliberately so.
 *
 * The migration has since landed as
 * supabase/migrations/20260703_cadence_engine_shadow.sql and IS applied to
 * prod (cadence_rules / cadence_runs / cadence_steps all exist, verified
 * 2026-08-07), so the earlier note here — that the engine stays inert until
 * the migration is applied, citing it under migrations-draft/ — is out of
 * date on both counts. runCadenceEngine still returns { applied: false } and
 * no-ops when the tables are absent, which is what made the route safe to
 * deploy ahead of the migration; that path is simply no longer the live one.
 *
 * So the engine is live-but-unscheduled rather than inert. With no
 * scheduler, no shadow ledger accumulates on its own: every tick has to be
 * triggered by hand. Unlike quiet-file-nudge, a manual run here is safe to
 * use as the check, because a shadow tick dispatches nothing. Schedule it
 * once that ledger has been eyeballed, ahead of any rail cutover.
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
