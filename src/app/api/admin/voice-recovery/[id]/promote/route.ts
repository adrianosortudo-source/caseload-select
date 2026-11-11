import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { resolveFirmTimezone } from '@/lib/firm-timezone';
import { runVoicePipeline } from '@/lib/voice-intake-pipeline';
import { evaluateContactGate } from '@/lib/screen-engine/contact-doctrine';
import { clampAxis, computeInitialStatus } from '@/lib/intake-v2-derive';
import { notifyLawyersOfNewLead } from '@/lib/lead-notify';
import { waitUntil } from '@vercel/functions';
import { appendVoiceRecoveryAuditEvent } from '@/lib/voice-recovery';

interface RecoveryCase {
  id: string;
  firm_id: string;
  caller_name: string | null;
  observed_caller_id: string | null;
  raw_transcript: string | null;
  recording_url: string | null;
  ghl_call_event_id: string;
  ghl_contact_id: string | null;
  evidence: Record<string, unknown> | null;
  promoted_screened_lead_id: string | null;
  created_at: string;
}

/** Promotes one explicitly selected recovery case via the same voice engine
 * and brief renderer as fresh intake. It never handcrafts a lead. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { data: recovery, error: recoveryError } = await supabase
    .from('voice_recovery_cases')
    .select('id, firm_id, caller_name, observed_caller_id, raw_transcript, recording_url, ghl_call_event_id, ghl_contact_id, evidence, promoted_screened_lead_id, created_at')
    .eq('id', id)
    .maybeSingle<RecoveryCase>();
  if (recoveryError) return NextResponse.json({ error: `recovery case lookup failed: ${recoveryError.message}` }, { status: 500 });
  if (!recovery) return NextResponse.json({ error: 'voice recovery case not found' }, { status: 404 });
  if (recovery.promoted_screened_lead_id) {
    return NextResponse.json({ error: 'already promoted', screened_lead_id: recovery.promoted_screened_lead_id }, { status: 409 });
  }
  // Repair the only recoverable partial-failure shape: the screened lead was
  // inserted but the forward-link write failed. This lookup makes a retry
  // idempotent instead of creating a second screened lead.
  const { data: previouslyInserted } = await supabase
    .from('screened_leads')
    .select('id, lead_id, band')
    .eq('firm_id', recovery.firm_id)
    .eq('slot_answers->voice_meta->>recovered_from_voice_recovery_case', recovery.id)
    .maybeSingle();
  if (previouslyInserted) {
    await supabase.from('voice_recovery_cases')
      .update({ promoted_screened_lead_id: previouslyInserted.id, status: 'resolved', follow_up_state: 'completed' })
      .eq('id', recovery.id)
      .is('promoted_screened_lead_id', null);
    await appendVoiceRecoveryAuditEvent({ recoveryCaseId: recovery.id, eventType: 'reconciled', actorType: 'operator', actorId: session.lawyer_id ?? 'operator', detail: { repaired_promotion_link: previouslyInserted.id } });
    return NextResponse.json({ ok: true, action: 'promote', recovered_link: true, screened_lead_id: previouslyInserted.id, lead_id: previouslyInserted.lead_id, band: previouslyInserted.band });
  }
  if (!(recovery.raw_transcript ?? '').trim()) {
    return NextResponse.json({ error: 'recovery case has no transcript to screen' }, { status: 422 });
  }
  const { data: firm, error: firmError } = await supabase
    .from('intake_firms').select('id, location').eq('id', recovery.firm_id).maybeSingle();
  if (firmError) return NextResponse.json({ error: `firm lookup failed: ${firmError.message}` }, { status: 500 });
  if (!firm) return NextResponse.json({ error: 'firm not found' }, { status: 404 });

  const pipeline = await runVoicePipeline({
    rawTranscript: recovery.raw_transcript!,
    callerPhone: recovery.observed_caller_id,
    callerName: recovery.caller_name,
    firmTimezone: resolveFirmTimezone({ location: firm.location }),
    recordingUrl: recovery.recording_url,
  });
  const { state, report, briefHtml, band, llmMode, decisionDeadlineIso, whaleNurture } = pipeline;
  const gate = evaluateContactGate({
    client_name: (state.slots.client_name as string | null | undefined) ?? null,
    client_email: (state.slots.client_email as string | null | undefined) ?? null,
    client_phone: (state.slots.client_phone as string | null | undefined) ?? null,
  });
  if (!gate.hasPhone && !gate.hasEmail) {
    return NextResponse.json({ error: 'awaiting_contact', missing: gate.missing }, { status: 422 });
  }
  const axes = report.four_axis;
  const { status } = computeInitialStatus(state.matter_type);
  const slot_answers = {
    slots: state.slots,
    slot_meta: state.slot_meta,
    slot_evidence: state.slot_evidence,
    channel: 'voice',
    questionHistory: state.questionHistory,
    voice_meta: {
      call_id: recovery.ghl_contact_id,
      ghl_contact_id: recovery.ghl_contact_id,
      ghl_call_event_id: recovery.ghl_call_event_id,
      recording_url: recovery.recording_url,
      llm_mode: llmMode,
      recovered_from_voice_recovery_case: recovery.id,
      recovered_at: new Date().toISOString(),
      recovered_by: session.lawyer_id ?? 'operator',
      recovery_evidence: recovery.evidence ?? {},
    },
  };
  const { data: inserted, error: insertError } = await supabase
    .from('screened_leads')
    .insert({
      lead_id: state.lead_id,
      firm_id: recovery.firm_id,
      screen_version: 2,
      status,
      status_changed_by: session.lawyer_id ?? 'operator',
      status_changed_by_role: 'operator',
      brief_json: report,
      brief_html: briefHtml,
      slot_answers,
      band,
      matter_type: state.matter_type,
      practice_area: state.practice_area,
      value_score: clampAxis(axes.value), complexity_score: clampAxis(axes.complexity), urgency_score: clampAxis(axes.urgency), readiness_score: clampAxis(axes.readiness),
      readiness_answered: !!axes.readinessAnswered,
      whale_nurture: whaleNurture,
      band_c_subtrack: null,
      decision_deadline: decisionDeadlineIso,
      contact_name: (state.slots.client_name as string | null | undefined) ?? recovery.caller_name,
      contact_email: (state.slots.client_email as string | null | undefined) ?? null,
      contact_phone: (state.slots.client_phone as string | null | undefined) ?? recovery.observed_caller_id,
      submitted_at: recovery.created_at,
      intake_language: state.language ?? 'en',
      raw_transcript: recovery.raw_transcript,
    })
    .select('id, lead_id, status, decision_deadline, whale_nurture').single();
  if (insertError) return NextResponse.json({ error: `screened lead insert failed: ${insertError.message}` }, { status: insertError.code === '23505' ? 409 : 500 });

  const { error: linkError } = await supabase.from('voice_recovery_cases')
    .update({ promoted_screened_lead_id: inserted.id, status: 'resolved', follow_up_state: 'completed' })
    .eq('id', recovery.id);
  if (linkError) {
    // The screened lead is durable. The retry path above can repair the link
    // without duplicating it, so tell the caller exactly what remains.
    return NextResponse.json({ ok: false, error: `promotion link failed: ${linkError.message}`, retryable: true, screened_lead_id: inserted.id, lead_id: inserted.lead_id }, { status: 202 });
  }
  await appendVoiceRecoveryAuditEvent({ recoveryCaseId: recovery.id, eventType: 'promoted', actorType: 'operator', actorId: session.lawyer_id ?? 'operator', detail: { screened_lead_id: inserted.id, lead_id: inserted.lead_id } });
  if (inserted.status === 'triaging' || inserted.status === 'declined') {
    waitUntil(notifyLawyersOfNewLead({
      firmId: recovery.firm_id, leadId: inserted.lead_id,
      contactName: (state.slots.client_name as string | null | undefined) ?? recovery.caller_name,
      matterType: state.matter_type, practiceArea: state.practice_area, band,
      decisionDeadlineIso: inserted.decision_deadline, whaleNurture: !!inserted.whale_nurture,
      intakeLanguage: state.language ?? 'en', channel: 'voice', lifecycleStatus: inserted.status as 'triaging' | 'declined',
    }).catch((err) => console.error('[voice-recovery-promote] notify failed:', err)));
  }
  return NextResponse.json({ ok: true, action: 'promote', screened_lead_id: inserted.id, lead_id: inserted.lead_id, band });
}
