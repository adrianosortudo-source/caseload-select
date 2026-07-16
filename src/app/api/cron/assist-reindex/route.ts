/**
 * GET /api/cron/assist-reindex
 *
 * Weekly sweep: reindexes every firm that has at least one included
 * assist_corpus_pages row. Seeding is operator-triggered only (a new
 * firm's corpus starts empty; this cron never discovers new pages, it
 * only refreshes already-curated ones).
 *
 * Auth: Bearer CRON_SECRET or PG_CRON_TOKEN (lib/cron-auth.ts), same as
 * every other /api/cron/* route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { reindexFirm } from '@/lib/assist/corpus-ingest';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { data: firmRows, error } = await supabase
    .from('assist_corpus_pages')
    .select('firm_id')
    .eq('include', true);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const firmIds = Array.from(new Set((firmRows ?? []).map((r) => r.firm_id as string)));
  const results: Array<{ firm_id: string; pages_processed: number; pages_ok: number; pages_errored: number }> = [];

  for (const firmId of firmIds) {
    const summary = await reindexFirm(firmId);
    results.push({
      firm_id: firmId,
      pages_processed: summary.pages_processed,
      pages_ok: summary.pages_ok,
      pages_errored: summary.pages_errored,
    });
  }

  return NextResponse.json({ ok: true, firms_processed: firmIds.length, results });
}
