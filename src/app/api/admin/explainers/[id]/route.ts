/**
 * GET   /api/admin/explainers/[id]  -> one explainer_article.
 * PATCH /api/admin/explainers/[id]  -> save title, body_html (sanitized),
 *        practice_area, matter_stage, ordering, published.
 *
 * Operator-gated (getOperatorSession). body_html is sanitized server-side via
 * lib/explainer-html-sanitize before storage — it's rendered into the client
 * portal, so it never lands unsanitized regardless of the editor or a direct
 * API call. The save returns the canonical sanitized body so the editor adopts
 * it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sanitizeExplainerHtml } from '@/lib/explainer-html-sanitize';
import { MATTER_STAGES, type MatterStage, type ExplainerArticle } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MATTER_STAGE_KEYS = new Set<string>(MATTER_STAGES.map((s) => s.key));

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const { data, error } = await supabase
    .from('explainer_articles')
    .select('id, slug, title, body_html, practice_area, matter_stage, ordering, published, created_at, updated_at')
    .eq('id', id)
    .maybeSingle<ExplainerArticle>();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'explainer not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, article: data });
}

interface ExplainerPatchBody {
  title?: unknown;
  body_html?: unknown;
  practice_area?: unknown;
  matter_stage?: unknown;
  ordering?: unknown;
  published?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let body: ExplainerPatchBody;
  try {
    body = (await req.json()) as ExplainerPatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  // Validate. Lightweight + honest: title required, matter_stage must be a real
  // stage, ordering an integer, published a boolean. practice_area is accepted
  // as any non-empty string (the UI constrains it to known areas; we don't
  // block an existing row's value). body_html is sanitized, never validated for
  // "correctness".
  const errors: string[] = [];

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) errors.push('Title is required.');

  const practiceArea = typeof body.practice_area === 'string' ? body.practice_area.trim() : '';
  if (!practiceArea) errors.push('Practice area is required.');

  const matterStage = typeof body.matter_stage === 'string' ? body.matter_stage : '';
  if (!MATTER_STAGE_KEYS.has(matterStage)) errors.push('Matter stage is not a valid stage.');

  if (typeof body.ordering !== 'number' || !Number.isInteger(body.ordering) || body.ordering < 0) {
    errors.push('Ordering must be a non-negative whole number.');
  }

  if (typeof body.published !== 'boolean') errors.push('Published must be true or false.');

  if (typeof body.body_html !== 'string') errors.push('Body is required.');

  if (errors.length > 0) {
    return NextResponse.json({ ok: false, error: 'validation_failed', errors }, { status: 400 });
  }

  const sanitizedBody = sanitizeExplainerHtml(body.body_html as string);

  const { data: updated, error: updateErr } = await supabase
    .from('explainer_articles')
    .update({
      title,
      body_html: sanitizedBody,
      practice_area: practiceArea,
      matter_stage: matterStage as MatterStage,
      ordering: body.ordering as number,
      published: body.published as boolean,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, slug, title, body_html, practice_area, matter_stage, ordering, published, created_at, updated_at')
    .maybeSingle<ExplainerArticle>();

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'explainer not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, article: updated });
}
