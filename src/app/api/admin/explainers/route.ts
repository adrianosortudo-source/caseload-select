/**
 * GET /api/admin/explainers
 *   -> all explainer_articles, ordered for the operator list. Operator-gated.
 *
 * explainer_articles are global (no firm_id) — shared client-education content
 * assigned to matters elsewhere. This is the read side of the authoring surface
 * (S8 Phase 2); the per-article edit lives at /api/admin/explainers/[id].
 *
 * Auth: getOperatorSession() (same gate as /admin/*).
 */

import { NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { ExplainerArticle } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('explainer_articles')
    .select('id, slug, title, body_html, practice_area, matter_stage, ordering, published, created_at, updated_at')
    .order('practice_area', { ascending: true })
    .order('ordering', { ascending: true })
    .order('title', { ascending: true })
    .returns<ExplainerArticle[]>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, articles: data ?? [] });
}
