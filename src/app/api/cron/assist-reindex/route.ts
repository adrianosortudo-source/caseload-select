/**
 * GET /api/cron/assist-reindex
 *
 * Daily sweep: reindexes ONE firm per invocation (Ses.18 audit F3), the
 * firm whose included pages have the oldest last_crawled_at (nulls, i.e.
 * never-crawled, first). Processing all firms in a single invocation does
 * not scale past 2-3 firms before hitting the function timeout; a real
 * reindex against a ~70-page corpus already runs minutes. With N firms and
 * a daily schedule, each firm refreshes roughly every N days.
 *
 * reindexFirm's own internal budget (see corpus-ingest.ts) additionally
 * caps how many pages a single run processes, so a firm whose corpus alone
 * exceeds the time budget degrades gracefully (partial refresh, oldest
 * pages first) rather than timing out mid-request.
 *
 * Seeding is operator-triggered only (a new firm's corpus starts empty;
 * this cron never discovers new pages, it only refreshes already-curated
 * ones).
 *
 * Auth: Bearer CRON_SECRET or PG_CRON_TOKEN (lib/cron-auth.ts), same as
 * every other /api/cron/* route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { reindexFirm } from '@/lib/assist/corpus-ingest';

export const dynamic = 'force-dynamic';
// Ses.18 audit F3: leaves headroom under the 300s function ceiling for the
// CRON_BUDGET_MS-bounded reindexFirm call plus response overhead.
export const maxDuration = 300;

// Leaves ~60s of headroom under maxDuration for the surrounding request
// lifecycle (cold start, response serialization, pg_net round trip).
const CRON_BUDGET_MS = 240_000;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { data: oldestPage, error } = await supabase
    .from('assist_corpus_pages')
    .select('firm_id')
    .eq('include', true)
    .order('last_crawled_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!oldestPage) {
    return NextResponse.json({ ok: true, firm_id: null, message: 'no firms with included pages' });
  }

  const firmId = oldestPage.firm_id as string;
  const summary = await reindexFirm(firmId, { budgetMs: CRON_BUDGET_MS });

  return NextResponse.json({
    ok: true,
    firm_id: firmId,
    pages_processed: summary.pages_processed,
    pages_ok: summary.pages_ok,
    pages_errored: summary.pages_errored,
    pages_skipped_budget: summary.pages_skipped_budget,
  });
}
