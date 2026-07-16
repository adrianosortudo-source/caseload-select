/**
 * GET   /api/admin/assist/[firmId]/pages
 *   -> the firm's curated corpus page list (DR-101), newest first.
 *
 * PATCH /api/admin/assist/[firmId]/pages
 *   body { pageId: string, include: boolean }
 *   -> toggles one page's include flag. Validates the page belongs to
 *      this firm before writing (never trust a client-supplied pageId
 *      across a firm boundary).
 *
 * Auth: getOperatorSession(), same operator gate as /admin/*.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { firmId } = await params;

  const { data, error } = await supabase
    .from('assist_corpus_pages')
    .select('id, url, title, include, exclude_reason, last_crawled_at, last_crawl_status')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pages: data ?? [] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { firmId } = await params;

  let body: { pageId?: unknown; include?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body.pageId !== 'string' || typeof body.include !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'body must be { pageId: string, include: boolean }' },
      { status: 400 },
    );
  }

  const { data: page, error: findErr } = await supabase
    .from('assist_corpus_pages')
    .select('id, firm_id')
    .eq('id', body.pageId)
    .maybeSingle();
  if (findErr) {
    return NextResponse.json({ ok: false, error: findErr.message }, { status: 500 });
  }
  if (!page || page.firm_id !== firmId) {
    return NextResponse.json({ ok: false, error: 'page not found for this firm' }, { status: 404 });
  }

  const { error: updateErr } = await supabase
    .from('assist_corpus_pages')
    .update({ include: body.include, updated_at: new Date().toISOString() })
    .eq('id', body.pageId);
  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pageId: body.pageId, include: body.include });
}
