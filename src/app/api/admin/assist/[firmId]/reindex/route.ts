/**
 * POST /api/admin/assist/[firmId]/reindex
 *
 * body { seed?: boolean, siteUrl?: string }
 *
 * seed=true first discovers pages from the firm's sitemap.xml (siteUrl
 * explicit, else the firm's custom_domain) and inserts any newly found URLs
 * into assist_corpus_pages per the DR-101 default seed-exclude rules. Then
 * (always) reindexes every currently-included page: fetch, extract, chunk,
 * embed, replace chunks.
 *
 * Auth: getOperatorSession(), same operator gate as /admin/*.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { seedPagesFromSitemap, reindexFirm } from '@/lib/assist/corpus-ingest';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { firmId } = await params;

  const { data: firm, error: firmErr } = await supabase
    .from('intake_firms')
    .select('id, custom_domain')
    .eq('id', firmId)
    .maybeSingle();
  if (firmErr) {
    return NextResponse.json({ ok: false, error: firmErr.message }, { status: 500 });
  }
  if (!firm) {
    return NextResponse.json({ ok: false, error: 'firm not found' }, { status: 404 });
  }

  let body: { seed?: unknown; siteUrl?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // No body is fine (reindex-only call); malformed JSON is treated the same.
  }

  const wantsSeed = body.seed === true;
  let seedResult = null;

  if (wantsSeed) {
    const siteUrl = typeof body.siteUrl === 'string' && body.siteUrl.trim()
      ? body.siteUrl.trim()
      : firm.custom_domain
        ? `https://${firm.custom_domain}`
        : null;
    if (!siteUrl) {
      return NextResponse.json(
        { ok: false, error: 'siteUrl required: firm has no custom_domain configured and none was provided in the request body' },
        { status: 422 },
      );
    }
    seedResult = await seedPagesFromSitemap(firmId, siteUrl);
  }

  const reindexResult = await reindexFirm(firmId);

  return NextResponse.json({ ok: true, firm_id: firmId, seed: seedResult, reindex: reindexResult });
}
