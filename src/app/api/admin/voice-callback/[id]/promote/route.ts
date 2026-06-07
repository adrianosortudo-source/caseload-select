/**
 * POST /api/admin/voice-callback/[id]/promote
 *
 * Operator-gated recovery route. Promotes a `voice_callback_requests` row
 * (a misrouted call that the reconciler sent to the callback table —
 * typically because the agent emitted a non-intake marker but the
 * server-side classifier saw new-matter content) into `screened_leads` so
 * the lawyer sees it in the triage queue.
 *
 * Doctrine (CLS reset, 2026-06-05):
 *   - The recovered lead MUST read EXACTLY like a normal CLS-produced
 *     screened lead. No hand-built brief_html. No hand-built scores. No
 *     synthetic matter summary. Only the audit-link voice_meta fields
 *     differ.
 *   - The engine pipeline is the shared `runVoicePipeline` helper. Both
 *     this route and `/api/voice-intake` call it; drift is impossible.
 *   - Contact-doctrine voice-reachability gate applies: a row with no
 *     callable phone AND no email is refused (422). Recovery does not
 *     bypass doctrine.
 *   - Idempotent. A row already promoted returns 409 with the existing
 *     `screened_lead_id`.
 *
 * Body:  none (the row id is the path parameter).
 * Auth:  operator session via `getOperatorSession()`.
 *
 * Responses:
 *   200 { promoted: true,  screened_lead_id, lead_id, band }
 *   401 { ok: false, error: 'unauthorized' }
 *   404 { ok: false, error: 'voice_callback_request not found' }
 *   404 { ok: false, error: 'firm not found' }
 *   409 { ok: false, error: 'already promoted', screened_lead_id }
 *   422 { ok: false, error: 'awaiting_contact', missing }
 *   500 on insert / pipeline failure.
 *
 * Linkage (two-way audit, locked by operator decision 2026-06-05):
 *   - new `screened_leads.slot_answers.voice_meta.recovered_from_callback`
 *     points back at the source `voice_callback_requests.id`
 *   - source `voice_callback_requests.promoted_to_screened_lead` (top-level
 *     column added by migration 20260605_voice_callback_promoted_link.sql)
 *     points forward at the new `screened_leads.id`
 *
 * What this route DOES NOT do:
 *   - It does not delete or otherwise modify the source callback row beyond
 *     setting the forward link. The audit row stays in place.
 *   - It does not re-classify the branch. The operator has already decided
 *     this is intake by clicking the promote affordance.
 *   - It does not run the LLM disabled / unconfirmed-voice operator alerts
 *     (those are intake-time concerns; this is recovery).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getOperatorSession } from '@/lib/portal-auth';
import {
  computeDecisionDeadline,
  computeWhaleNurture,
  computeInitialStatus,
  clampAxis,
} from '@/lib/intake-v2-derive';
import { notifyLawyersOfNewLead } from '@/lib/lead-notify';
import { waitUntil } from '@vercel/functions';
import { resolveFirmTimezone } from '@/lib/firm-timezone';
import { evaluateContactGate } from '@/lib/screen-engine/contact-doctrine';
import { runVoicePipeline } from '@/lib/voice-intake-pipeline';

interface CallbackRow {
  id: string;
  firm_id: string;
  branch: string;
  urgency: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  organization: string | null;
  message: string | null;
  raw_transcript: string | null;
  voice_meta: Record<string, unknown> | null;
  promoted_to_screened_lead: string | null;
  created_at: string;
}

interface FirmRow {
  id: string;
  name: string | null;
  location: string | null;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Operator gate.
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id: callbackId } = await params;

  // 2. Load the source row.
  const { data: callbackData, error: cbErr } = await supabase
    .from('voice_callback_requests')
    .select(
      'id, firm_id, branch, urgency, caller_name, caller_phone, organization, message, raw_transcript, voice_meta, promoted_to_screened_lead, created_at',
    )
    .eq('id', callbackId)
    .maybeSingle<CallbackRow>();

  if (cbErr) {
    return NextResponse.json(
      { ok: false, error: `callback row lookup failed: ${cbErr.message}` },
      { status: 500 },
    );
  }
  if (!callbackData) {
    return NextResponse.json(
      { ok: false, error: 'voice_callback_request not found' },
      { status: 404 },
    );
  }

  // 3. Idempotency — already promoted? Return 409 with the existing id so
  // operator / ops scripts can still navigate to it.
  if (callbackData.promoted_to_screened_lead) {
    return NextResponse.json(
      {
        ok: false,
        error: 'already promoted',
        screened_lead_id: callbackData.promoted_to_screened_lead,
      },
      { status: 409 },
    );
  }

  // 4. Need a transcript to run the engine.
  const rawTranscript = (callbackData.raw_transcript ?? '').trim();
  if (!rawTranscript) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'callback row has no raw_transcript; nothing for the engine to process',
      },
      { status: 422 },
    );
  }

  // 5. Load the firm for the timezone resolver (and the firm-not-found 404
  // before we run any engine work).
  const { data: firmData, error: firmErr } = await supabase
    .from('intake_firms')
    .select('id, name, location')
    .eq('id', callbackData.firm_id)
    .maybeSingle<FirmRow>();

  if (firmErr) {
    return NextResponse.json(
      { ok: false, error: `firm lookup failed: ${firmErr.message}` },
      { status: 500 },
    );
  }
  if (!firmData) {
    return NextResponse.json(
      { ok: false, error: 'firm not found' },
      { status: 404 },
    );
  }

  const firmTimezone = resolveFirmTimezone({ location: firmData.location });

  // 6. Run the SHARED voice intake pipeline. Same engine, same brief
  // renderer, same provenance promotion. The promoted lead reads exactly
  // like a /api/voice-intake lead.
  let pipeline;
  try {
    pipeline = await runVoicePipeline({
      rawTranscript,
      callerPhone: callbackData.caller_phone ?? null,
      callerName: callbackData.caller_name ?? null,
      firmTimezone,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `pipeline failed: ${msg}` },
      { status: 500 },
    );
  }

  const {
    state,
    report,
    briefHtml,
    llmMode,
    band,
    decisionDeadlineIso: pipelineDeadlineIso,
    whaleNurture: pipelineWhale,
  } = pipeline;

  // 7. Contact-doctrine voice-reachability gate — same rule as
  // /api/voice-intake (be5219d): a row needs phone OR email to count as
  // reachable. Recovery does not bypass doctrine.
  const voiceGate = evaluateContactGate({
    client_name: (state.slots['client_name'] as string | null | undefined) ?? null,
    client_email: (state.slots['client_email'] as string | null | undefined) ?? null,
    client_phone: (state.slots['client_phone'] as string | null | undefined) ?? null,
  });
  const voiceReachable = voiceGate.hasPhone || voiceGate.hasEmail;
  if (!voiceReachable) {
    return NextResponse.json(
      {
        ok: false,
        error: 'awaiting_contact',
        missing: voiceGate.missing,
      },
      { status: 422 },
    );
  }

  // 8. Derived flags. The pipeline already computed `decisionDeadlineIso` and
  // `whaleNurture` so the brief HTML and the persisted row never disagree on
  // the deadline (the brief's data-deadline-iso must equal
  // screened_leads.decision_deadline for the live-timer hydrator to read back
  // a sensible value). Reuse the pipeline's values verbatim.
  const now = new Date();
  const axes = report.four_axis;
  const decisionDeadline = new Date(pipelineDeadlineIso);
  const whaleNurture = pipelineWhale;
  const { status: initialStatus } = computeInitialStatus(state.matter_type);

  // 9. Build slot_answers. Identical shape to the live intake route, plus
  // recovery audit fields under voice_meta.
  const sourceVoiceMeta =
    (callbackData.voice_meta as Record<string, unknown> | null) ?? {};
  const slotAnswers = {
    slots: state.slots,
    slot_meta: state.slot_meta,
    slot_evidence: state.slot_evidence,
    channel: 'voice' as const,
    voice_meta: {
      // Original telephony / extraction context, preserved verbatim so the
      // brief reads the same as if the row had landed via /api/voice-intake.
      call_id: sourceVoiceMeta.call_id ?? null,
      call_duration_sec: sourceVoiceMeta.call_duration_sec ?? null,
      recording_url: sourceVoiceMeta.recording_url ?? null,
      caller_phone: callbackData.caller_phone,
      caller_name: callbackData.caller_name,
      caller_phone_source: sourceVoiceMeta.caller_phone_source ?? null,
      llm_mode: llmMode,
      // Original branch decision from the intake-time classifier, carried so
      // the audit trail of "why this was sent to callback originally" stays
      // visible even after promotion.
      branch_marker: sourceVoiceMeta.marker ?? null,
      classifier_branch: sourceVoiceMeta.classifier_branch ?? null,
      classifier_mode: sourceVoiceMeta.classifier_mode ?? null,
      classifier_reason: sourceVoiceMeta.classifier_reason ?? null,
      branch_reconciliation_reason: sourceVoiceMeta.reconciliation_reason ?? null,
      branch_operator_review: sourceVoiceMeta.operator_review ?? null,
      urgency_triggers: sourceVoiceMeta.urgency_triggers ?? null,
      // Recovery audit — the half of the two-way link that lives in JSONB.
      recovered_from_callback: callbackData.id,
      recovered_at: now.toISOString(),
      recovered_by: session.lawyer_id ?? null,
    },
  };

  // 10. Insert the new screened_lead. status_changed_by_role is 'operator'
  // (not 'system') because a human operator drove this insert; that's how
  // the row's lifecycle audit reads.
  const { data: inserted, error: insertErr } = await supabase
    .from('screened_leads')
    .insert({
      lead_id: state.lead_id,
      firm_id: callbackData.firm_id,
      screen_version: 2,
      status: initialStatus,
      status_changed_by: session.lawyer_id ?? 'operator',
      status_changed_by_role: 'operator',
      brief_json: report,
      brief_html: briefHtml,
      slot_answers: slotAnswers,
      band,
      matter_type: state.matter_type,
      practice_area: state.practice_area,
      value_score: clampAxis(axes.value),
      complexity_score: clampAxis(axes.complexity),
      urgency_score: clampAxis(axes.urgency),
      readiness_score: clampAxis(axes.readiness),
      readiness_answered: !!axes.readinessAnswered,
      whale_nurture: whaleNurture,
      band_c_subtrack: null,
      decision_deadline: decisionDeadline.toISOString(),
      contact_name:
        (state.slots['client_name'] as string | null | undefined) ??
        callbackData.caller_name ??
        null,
      contact_email:
        (state.slots['client_email'] as string | null | undefined) ?? null,
      contact_phone:
        (state.slots['client_phone'] as string | null | undefined) ??
        callbackData.caller_phone ??
        null,
      // Submission time stays the ORIGINAL call timestamp — that is when the
      // matter arrived; promotion is a recovery, not a new arrival.
      submitted_at: callbackData.created_at,
      intake_language: state.language ?? 'en',
      raw_transcript: callbackData.raw_transcript,
    })
    .select('id, lead_id, status, decision_deadline, whale_nurture')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Duplicate lead_id — engine generator collision. Surface and let the
      // operator retry; we don't silently overwrite.
      return NextResponse.json(
        { ok: false, error: 'duplicate_lead_id', lead_id: state.lead_id },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: `insert failed: ${insertErr.message}` },
      { status: 500 },
    );
  }

  // 11. Close the two-way audit link: write the forward pointer onto the
  // source callback row. If this update fails we still return 200 (the new
  // lead is the load-bearing artifact) but log it loudly.
  const { error: linkErr } = await supabase
    .from('voice_callback_requests')
    .update({ promoted_to_screened_lead: inserted.id })
    .eq('id', callbackData.id);
  if (linkErr) {
    console.error(
      `[voice-callback-promote] forward-link update failed callback=${callbackData.id} lead=${inserted.id} err=${linkErr.message}`,
    );
  }

  // 12. Fire the lawyer notification — same path as /api/voice-intake, so
  // the lawyer's inbox treats a recovered lead exactly like a fresh one.
  if (inserted.status === 'triaging' || inserted.status === 'declined') {
    waitUntil(
      notifyLawyersOfNewLead({
        firmId: callbackData.firm_id,
        leadId: inserted.lead_id,
        contactName:
          (state.slots['client_name'] as string | null | undefined) ??
          callbackData.caller_name ??
          null,
        matterType: state.matter_type,
        practiceArea: state.practice_area,
        band,
        decisionDeadlineIso: inserted.decision_deadline,
        whaleNurture: !!inserted.whale_nurture,
        intakeLanguage: state.language ?? 'en',
        channel: 'voice',
        lifecycleStatus: inserted.status as 'triaging' | 'declined',
      }).catch((err) => {
        console.error('[voice-callback-promote] notifyLawyersOfNewLead failed:', err);
      }),
    );
  }

  return NextResponse.json(
    {
      promoted: true,
      screened_lead_id: inserted.id,
      lead_id: inserted.lead_id,
      band,
    },
    { status: 200 },
  );
}
