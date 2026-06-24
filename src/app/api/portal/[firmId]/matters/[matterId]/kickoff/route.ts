/**
 * POST /api/portal/[firmId]/matters/[matterId]/kickoff
 *
 * S8 Phase 1 Story 14: Band A post-OTP routing pipeline composition.
 *
 * One-click operator action that composes the existing S03 + S08 +
 * S15 pieces into a single "kick off the matter" flow:
 *
 *   1. Send the welcome draft (if not already sent)
 *   2. Auto-assign the firm's published explainer articles tagged
 *      for this matter's practice_area + current stage
 *   3. Advance the matter stage from intake → retainer_pending
 *      (which fires the J6 retainer-awaiting journey cadence on
 *      the source lead)
 *   4. Generate a client invite magic link (returned in the
 *      response — the operator can also call the dedicated invite
 *      endpoint separately if they want a fresh link later)
 *
 * Each step is best-effort and independently reported in the
 * response so the operator can see exactly what landed and what
 * needs follow-up.
 *
 * Pre-conditions:
 *   - Matter must be at matter_stage='intake'
 *   - Matter must have primary_email (for the invite)
 *   - Matter must have welcome_draft_html (built at matter creation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession, generatePortalToken } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getMatterById, transitionMatterStage } from '@/lib/matter-stage';
import { insertMessage } from '@/lib/matter-messages';
import type { ExplainerArticle } from '@/lib/types';

const INVITE_TTL_HOURS = 48;

interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
  data?: Record<string, unknown>;
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

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }
  if (matter.matter_stage !== 'intake') {
    return NextResponse.json(
      {
        error: `kickoff only valid from intake stage; matter is currently ${matter.matter_stage}`,
      },
      { status: 422 },
    );
  }
  if (!matter.primary_email) {
    return NextResponse.json(
      { error: 'matter requires primary_email for kickoff (needed for invite)' },
      { status: 422 },
    );
  }

  const steps: StepResult[] = [];

  // ── Step 1: send welcome draft ────────────────────────────────────────
  // Codex re-audit follow-up (F7 kickoff): claim the send atomically BEFORE
  // inserting the client message. The previous read -> insert -> stamp pattern
  // let two concurrent kickoffs both observe unsent and both send the welcome.
  // The conditional UPDATE is the gate; release on insert failure.
  if (matter.welcome_draft_sent_at) {
    steps.push({
      step: 'welcome_send',
      ok: true,
      detail: 'already sent',
      data: { sent_at: matter.welcome_draft_sent_at },
    });
  } else {
    const bodyToSend = matter.welcome_draft_edited_html ?? matter.welcome_draft_html;
    if (!bodyToSend || !bodyToSend.trim()) {
      steps.push({ step: 'welcome_send', ok: false, detail: 'no draft body' });
    } else {
      const sentAt = new Date().toISOString();
      const { data: claimed, error: claimErr } = await supabase
        .from('client_matters')
        .update({ welcome_draft_sent_at: sentAt, welcome_draft_sent_body: bodyToSend })
        .eq('id', matterId)
        .is('welcome_draft_sent_at', null)
        .select('id');

      if (claimErr) {
        steps.push({ step: 'welcome_send', ok: false, detail: claimErr.message });
      } else if (!claimed || claimed.length === 0) {
        // Lost the race to a concurrent kickoff (or to welcome/send). Treat as
        // already sent; do NOT re-insert.
        steps.push({
          step: 'welcome_send',
          ok: true,
          detail: 'already sent (concurrent claim)',
        });
      } else {
        const msgResult = await insertMessage({
          matter_id: matterId,
          firm_id: firmId,
          channel_type: 'client',
          sender_role: 'admin',
          sender_lawyer_id: session.lawyer_id ?? null,
          body: bodyToSend,
        });
        if (msgResult.ok) {
          steps.push({
            step: 'welcome_send',
            ok: true,
            data: { sent_at: sentAt, message_id: msgResult.message.id },
          });
        } else {
          // Message insert failed; release the claim so a later send can retry.
          await supabase
            .from('client_matters')
            .update({ welcome_draft_sent_at: null, welcome_draft_sent_body: null })
            .eq('id', matterId);
          steps.push({ step: 'welcome_send', ok: false, detail: msgResult.error });
        }
      }
    }
  }

  // ── Step 2: auto-assign explainer articles ────────────────────────────
  const { data: existingAssignments } = await supabase
    .from('matter_explainer_assignments')
    .select('article_id')
    .eq('matter_id', matterId);
  const alreadyAssigned = new Set(
    (existingAssignments ?? []).map((a) => a.article_id),
  );

  const { data: candidateArticles } = await supabase
    .from('explainer_articles')
    .select('*')
    .or(`practice_area.eq.${matter.practice_area},practice_area.eq.general`)
    .eq('matter_stage', 'retainer_pending')
    .eq('published', true)
    .order('ordering', { ascending: true });

  const toAssign = ((candidateArticles ?? []) as ExplainerArticle[]).filter(
    (a) => !alreadyAssigned.has(a.id),
  );

  if (toAssign.length === 0) {
    steps.push({
      step: 'explainer_assign',
      ok: true,
      detail: 'no new explainers to assign (none published for retainer_pending or all already assigned)',
      data: { assigned_count: 0 },
    });
  } else {
    const { data: inserted, error: assignErr } = await supabase
      .from('matter_explainer_assignments')
      .insert(
        toAssign.map((a) => ({
          matter_id: matterId,
          article_id: a.id,
          assigned_by_lawyer_id: session.lawyer_id ?? null,
        })),
      )
      .select('id');
    if (assignErr) {
      steps.push({ step: 'explainer_assign', ok: false, detail: assignErr.message });
    } else {
      steps.push({
        step: 'explainer_assign',
        ok: true,
        data: {
          assigned_count: inserted?.length ?? 0,
          article_slugs: toAssign.map((a) => a.slug),
        },
      });
    }
  }

  // ── Step 3: advance stage intake → retainer_pending ───────────────────
  const transitionResult = await transitionMatterStage({
    matter_id: matterId,
    to: 'retainer_pending',
    actor_role: session.role === 'operator' ? 'operator' : 'admin',
    actor_id: session.lawyer_id ?? null,
    note: 'Kickoff (S14 composition route)',
  });
  if (transitionResult.ok) {
    steps.push({
      step: 'stage_advance',
      ok: true,
      data: { from: transitionResult.from, to: transitionResult.to },
    });
  } else {
    steps.push({
      step: 'stage_advance',
      ok: false,
      detail: transitionResult.error,
    });
  }

  // ── Step 4: generate client invite link ───────────────────────────────
  const inviteToken = generatePortalToken(firmId, {
    role: 'client',
    matter_id: matterId,
    client_email: matter.primary_email,
    ttlHours: INVITE_TTL_HOURS,
  });
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  const acceptUrl = `${origin}/portal/${firmId}/m/${matterId}/accept?token=${encodeURIComponent(inviteToken)}`;
  steps.push({
    step: 'invite_link',
    ok: true,
    data: { accept_url: acceptUrl, expires_in_hours: INVITE_TTL_HOURS },
  });

  const allOk = steps.every((s) => s.ok);
  return NextResponse.json({
    ok: allOk,
    matter_id: matterId,
    steps,
  });
}
