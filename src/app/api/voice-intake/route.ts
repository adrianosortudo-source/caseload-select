/**
 * POST /api/voice-intake
 *
 * GHL Voice AI fires this webhook at call-end. The transcript is processed
 * server-side through the same screening engine every other channel uses;
 * the result lands in `screened_leads` with `channel='voice'` so the lawyer
 * triage portal renders it identically to web, SMS, WhatsApp, etc.
 *
 * Per CRM Bible DR-033 (Voice channel), this is Option B: GHL handles the
 * call mechanics (telephony, ASR, TTS), the engine handles screening. No
 * realtime voice agent in this iteration.
 *
 * Sibling to /api/intake-v2 — the same `screened_leads` row shape and the
 * same downstream lawyer-notification path. The difference: intake-v2
 * receives a pre-rendered brief from the Vite SPA, voice-intake builds the
 * brief on the server from a raw transcript.
 *
 * Body contract (from GHL Voice AI post-call webhook):
 *
 *   {
 *     caller_phone:      string,     // E.164 from caller ID
 *     caller_name?:      string,     // captured by Voice AI if asked
 *     transcript:        string,     // full call transcript
 *     recording_url?:    string,     // GHL recording URL
 *     call_duration_sec: number,
 *     call_id:           string,     // GHL-side call identifier
 *     firmId:            string,     // staging or client sub-account uuid
 *   }
 *
 * LLM extraction is best-effort. Failure to reach Gemini leaves the brief
 * regex-only; the row still persists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  computeDecisionDeadline,
  computeWhaleNurture,
  computeInitialStatus,
  clampAxis,
} from '@/lib/intake-v2-derive';
import { notifyLawyersOfNewLead } from '@/lib/lead-notify';
import { loadDeclineCandidates, resolveDecline } from '@/lib/decline-resolver';
import { buildDeclinedOosPayload, fireGhlWebhook, type LeadFacts } from '@/lib/ghl-webhook';
import { waitUntil } from '@vercel/functions';
import { initialiseState } from '@/lib/screen-engine/extractor';
import { runEvidencePass } from '@/lib/screen-engine/slotEvidence';
import { mergeLlmResults } from '@/lib/screen-engine/llm/extractor';
import { buildReport } from '@/lib/screen-engine/report';
import { computeBand } from '@/lib/screen-engine/band';
import { computeCoreCompleteness } from '@/lib/screen-engine/selector';
import { llmExtractServer } from '@/lib/screen-llm-server';
import { renderBriefHtmlServer } from '@/lib/screen-brief-html';
import type { EngineState, Band } from '@/lib/screen-engine/types';

// Practice-area display labels for the OOS decline copy interpolation.
// Mirrors the same constant in intake-v2/route.ts (duplicated rather than
// extracted to a shared file because the directive on this patch is "do
// not modify intake-v2"; if the duplicate ever drifts, the doctrine fix
// is to lift this into `lib/oos-area-labels.ts` and have both routes
// import from there).
const OOS_AREA_LABELS: Record<string, string> = {
  family: 'family law',
  immigration: 'immigration',
  employment: 'employment',
  criminal: 'criminal',
  personal_injury: 'personal injury',
  estates: 'wills and estates',
};

interface VoiceIntakeBody {
  caller_phone?: string;
  caller_name?: string;
  transcript?: string;
  recording_url?: string;
  call_duration_sec?: number;
  call_id?: string;
  firmId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Best-effort E.164 normalisation. The Voice AI webhook should already
 * deliver E.164, but defensive cleanup of common variants (spaces, dashes,
 * parens) lets noisy inputs land cleanly.
 */
function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip everything that isn't a digit or leading +
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`; // assume NANP for 10-digit
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  return cleaned;
}

function seedVoiceState(state: EngineState, callerPhone: string | null, callerName: string | null): EngineState {
  let s = state;
  if (callerPhone && !s.slots['client_phone']) {
    s = {
      ...s,
      slots: { ...s.slots, client_phone: callerPhone },
      slot_meta: {
        ...s.slot_meta,
        client_phone: { source: 'answered', confidence: 1.0 },
      },
    };
  }
  if (callerName && !s.slots['client_name']) {
    s = {
      ...s,
      slots: { ...s.slots, client_name: callerName },
      slot_meta: {
        ...s.slot_meta,
        client_name: { source: 'answered', confidence: 1.0 },
      },
    };
  }
  return s;
}

export async function POST(req: NextRequest) {
  let body: VoiceIntakeBody;
  try {
    body = (await req.json()) as VoiceIntakeBody;
  } catch {
    return NextResponse.json(
      { error: 'invalid JSON body' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const transcript = (body.transcript ?? '').trim();
  if (!transcript) {
    return NextResponse.json(
      { error: 'transcript is required' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // ── firmId resolution (same pattern as intake-v2) ──────────────────────
  const firmIdParam = (body.firmId ?? '').trim();

  if (!firmIdParam || firmIdParam === 'demo_firm') {
    return NextResponse.json(
      { persisted: false, mode: 'demo', reason: 'no firm context' },
      { status: 200, headers: CORS_HEADERS },
    );
  }

  if (!UUID_RE.test(firmIdParam)) {
    return NextResponse.json(
      { persisted: false, mode: 'demo', reason: 'firmId not a uuid' },
      { status: 200, headers: CORS_HEADERS },
    );
  }

  const { data: firm, error: firmErr } = await supabase
    .from('intake_firms')
    .select('id')
    .eq('id', firmIdParam)
    .maybeSingle();
  if (firmErr) {
    return NextResponse.json(
      { error: `firm lookup failed: ${firmErr.message}` },
      { status: 500, headers: CORS_HEADERS },
    );
  }
  if (!firm) {
    return NextResponse.json(
      { persisted: false, mode: 'demo', reason: 'firmId not found in intake_firms' },
      { status: 200, headers: CORS_HEADERS },
    );
  }

  // ── Engine pipeline ────────────────────────────────────────────────────
  const callerPhone = normalizePhone(body.caller_phone);
  const callerName = (body.caller_name ?? '').trim() || null;

  // 1. initialiseState — regex classification + raw signals
  let state = initialiseState(transcript);
  // 2. tag the channel before anything reads state.channel
  state = { ...state, channel: 'voice' };
  // 3. seed phone + name from caller ID
  state = seedVoiceState(state, callerPhone, callerName);
  // 4. evidence pass (regex deepening)
  state = runEvidencePass(transcript, state);

  // 5. LLM extraction (best-effort; failure does not abort)
  if (state.matter_type !== 'out_of_scope') {
    try {
      const llm = await llmExtractServer(transcript, state);
      const filledIds = Object.keys(llm.extracted).filter(
        (k) => llm.extracted[k] !== null && llm.extracted[k] !== '',
      );
      if (llm.mode === 'live' && filledIds.length > 0) {
        state = mergeLlmResults(state, llm.extracted);
      }
    } catch (err) {
      // best-effort; carry on with regex-only state
      console.warn('[voice-intake] llmExtractServer failed:', err);
    }
  }

  // ── Build the brief ─────────────────────────────────────────────────────
  const report = buildReport(state);
  const briefHtml = renderBriefHtmlServer(report, 'voice');
  const completeness = computeCoreCompleteness(state);
  const bandResult = computeBand(state);
  const band: Band | null = state.matter_type === 'out_of_scope' ? null : bandResult.band;

  // ── Derived flags (same helpers as intake-v2) ──────────────────────────
  const now = new Date();
  const axes = report.four_axis;
  const decisionDeadline = computeDecisionDeadline(axes.urgency, now);
  const whaleNurture = computeWhaleNurture(axes.value, axes.readiness);
  const { status: initialStatus, changedBy: initialChangedBy } =
    computeInitialStatus(state.matter_type);

  // ── Insert ──────────────────────────────────────────────────────────────
  const slotAnswers = {
    slots: state.slots,
    slot_meta: state.slot_meta,
    slot_evidence: state.slot_evidence,
    channel: 'voice' as const,
    voice_meta: {
      call_id: body.call_id ?? null,
      call_duration_sec: body.call_duration_sec ?? null,
      recording_url: body.recording_url ?? null,
      caller_phone: callerPhone,
      caller_name: callerName,
    },
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('screened_leads')
    .insert({
      lead_id: state.lead_id,
      firm_id: firmIdParam,
      screen_version: 2,
      status: initialStatus,
      status_changed_by: initialChangedBy,
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
      contact_name: state.slots['client_name'] ?? callerName ?? null,
      contact_email: state.slots['client_email'] ?? null,
      contact_phone: state.slots['client_phone'] ?? callerPhone ?? null,
      submitted_at: state.submitted_at ?? now.toISOString(),
    })
    .select('id, lead_id, status, decision_deadline, whale_nurture')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Duplicate lead_id — the engine's generator collided. Treat as
      // idempotent rather than re-running the engine.
      return NextResponse.json(
        { persisted: false, mode: 'duplicate', lead_id: state.lead_id },
        { status: 409, headers: CORS_HEADERS },
      );
    }
    return NextResponse.json(
      { error: `insert failed: ${insertErr.message}` },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  // ── OOS auto-decline webhook (parity with /api/intake-v2) ───────────────
  // Fired AFTER insert succeeds so the webhook never goes out for a row
  // that did not land. Same payload shape as intake-v2's declined_oos path
  // so the GHL workflow downstream sees an identical body regardless of
  // whether the source was web or voice. Best-effort delivery; failure
  // does not roll back the insert.
  if (state.matter_type === 'out_of_scope') {
    try {
      const practiceArea = state.practice_area;
      const candidates = await loadDeclineCandidates({
        firmId: firmIdParam,
        practiceArea,
        perLeadOverride: null,
      });
      const areaLabel = OOS_AREA_LABELS[practiceArea] ?? 'this practice area';
      const verdict = resolveDecline(candidates, 'oos', areaLabel);

      const facts: LeadFacts = {
        lead_id: state.lead_id,
        firm_id: firmIdParam,
        band: null,
        matter_type: state.matter_type,
        practice_area: practiceArea,
        submitted_at: state.submitted_at ?? now.toISOString(),
        contact_name: state.slots['client_name'] ?? callerName ?? null,
        contact_email: state.slots['client_email'] ?? null,
        contact_phone: state.slots['client_phone'] ?? callerPhone ?? null,
      };
      const payload = buildDeclinedOosPayload({
        facts,
        statusChangedAt: now,
        declineSubject: verdict.subject,
        declineBody: verdict.body,
        declineSource: verdict.source,
        detectedAreaLabel: areaLabel,
      });
      // Fire and forget. Observable via the firm's GHL inbox or (Phase 3)
      // the webhook_outbox table; never surfaced to the Voice AI caller.
      waitUntil(fireGhlWebhook(firmIdParam, payload));
    } catch (err) {
      // Webhook resolution or dispatch failed; the row still persists. Log
      // for Vercel function logs; do not abort the response.
      console.error('[voice-intake] declined_oos webhook failed:', err);
    }
  }

  // ── New-lead notification email (best-effort) ──────────────────────────
  if (inserted.status === 'triaging') {
    waitUntil(notifyLawyersOfNewLead({
      firmId: firmIdParam,
      leadId: inserted.lead_id,
      contactName: state.slots['client_name'] ?? callerName ?? null,
      matterType: state.matter_type,
      practiceArea: state.practice_area,
      band,
      decisionDeadlineIso: inserted.decision_deadline,
      whaleNurture: !!inserted.whale_nurture,
    }).catch((err) => {
      console.error('[voice-intake] notifyLawyersOfNewLead failed:', err);
    }));
  }

  return NextResponse.json(
    {
      persisted: true,
      mode: 'live',
      id: inserted.id,
      lead_id: inserted.lead_id,
      brief_id: inserted.id,
      status: inserted.status,
      decision_deadline: inserted.decision_deadline,
      whale_nurture: inserted.whale_nurture,
      completeness,
      band,
    },
    { status: 200, headers: CORS_HEADERS },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
