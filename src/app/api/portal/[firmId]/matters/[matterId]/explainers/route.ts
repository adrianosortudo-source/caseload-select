/**
 * GET   /api/portal/[firmId]/matters/[matterId]/explainers
 *   → list explainer assignments for this matter + available
 *     articles for the matter's practice_area + stage.
 *
 * POST  /api/portal/[firmId]/matters/[matterId]/explainers
 *   body { article_id }
 *   → assign an explainer article to the matter. Lawyer / operator
 *     only. Idempotent: a duplicate assignment returns the existing
 *     row.
 *
 * DELETE /api/portal/[firmId]/matters/[matterId]/explainers
 *   body { article_id }
 *   → unassign an explainer article.
 *
 * Phase 1 ships with placeholder explainer slugs (published=false).
 * The operator authors the body content per
 * docs/explainer-content-runbook.md (when that runbook is written;
 * for tonight it's just markdown HTML in `body_html` and flipping
 * `published=true`).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getMatterById } from '@/lib/matter-stage';
import type { ExplainerArticle, MatterExplainerAssignment } from '@/lib/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }

  const [{ data: assignments }, { data: available }] = await Promise.all([
    supabase
      .from('matter_explainer_assignments')
      .select('*')
      .eq('matter_id', matterId),
    supabase
      .from('explainer_articles')
      .select('*')
      .or(`practice_area.eq.${matter.practice_area},practice_area.eq.general`)
      .eq('matter_stage', matter.matter_stage)
      .eq('published', true)
      .order('ordering', { ascending: true }),
  ]);

  return NextResponse.json({
    ok: true,
    matter_id: matterId,
    assignments: (assignments ?? []) as MatterExplainerAssignment[],
    available: (available ?? []) as ExplainerArticle[],
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { article_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.article_id) {
    return NextResponse.json({ error: 'body.article_id is required' }, { status: 400 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }

  // Idempotent assignment.
  const { data: existing } = await supabase
    .from('matter_explainer_assignments')
    .select('*')
    .eq('matter_id', matterId)
    .eq('article_id', body.article_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, already: true, assignment: existing });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('matter_explainer_assignments')
    .insert({
      matter_id: matterId,
      article_id: body.article_id,
      assigned_by_lawyer_id: session.lawyer_id ?? null,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, assignment: inserted });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: { article_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.article_id) {
    return NextResponse.json({ error: 'body.article_id is required' }, { status: 400 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }

  const { error: deleteErr } = await supabase
    .from('matter_explainer_assignments')
    .delete()
    .eq('matter_id', matterId)
    .eq('article_id', body.article_id);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, unassigned: body.article_id });
}
