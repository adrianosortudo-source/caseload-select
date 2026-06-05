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
 *     caller_phone:        string,   // E.164 from caller ID
 *     caller_name?:        string,   // captured by Voice AI if asked
 *     transcript_full?:    string,   // full call transcript ({{transcript_generated.call_transcript}})
 *     transcript_summary?: string,   // GHL's call summary ({{contact.call_summary}})
 *     transcript?:         string,   // legacy field (pre-2026-05-21); accepted for backwards compat
 *     recording_url?:      string,   // GHL recording URL
 *     call_duration_sec?:  number,
 *     call_id?:            string,   // GHL-side call identifier
 *     firmId:              string,   // staging or client sub-account uuid
 *   }
 *
 * Transcript resolution (2026-05-21): the workflow now triggers on the
 * "Transcript Generated" event (per GHL docs at help.gohighlevel.com/...
 * /workflow-trigger-transcript-generated), which exposes the full
 * verbatim transcript via `{{transcript_generated.call_transcript}}`. The
 * older `{{contact.call_summary}}` variable is a paraphrased summary that
 * strips digits (phone numbers, dates) the engine needs for the
 * contact-doctrine gate (DR-038). Resolution order is:
 *   1. transcript_full  (preferred — full verbatim)
 *   2. transcript_summary (fallback — paraphrased)
 *   3. transcript (legacy field for old deployments)
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
import { waitUntil } from '@vercel/functions';
import { initialiseState } from '@/lib/screen-engine/extractor';
import { runEvidencePass } from '@/lib/screen-engine/slotEvidence';
import { mergeLlmResults } from '@/lib/screen-engine/llm/extractor';
import { buildReport } from '@/lib/screen-engine/report';
import { normalizeVoiceTranscript } from '@/lib/voice-transcript-normalization';
import { computeBand } from '@/lib/screen-engine/band';
import { computeCoreCompleteness } from '@/lib/screen-engine/selector';
import { llmExtractServer } from '@/lib/screen-llm-server';
import { renderBriefHtmlServer } from '@/lib/screen-brief-html';
import { resolveFirmTimezone } from '@/lib/firm-timezone';
import { promoteContactProvenance } from '@/lib/promote-contact-provenance';
import { recoverNameIfMissing } from '@/lib/readback-detection';
import { evaluateContactGate } from '@/lib/screen-engine/contact-doctrine';
import type { EngineState, Band } from '@/lib/screen-engine/types';
import {
  verifyVoiceWebhookSignature,
  shouldRejectVoiceRequest,
  isHmacRequired,
  VOICE_SIGNATURE_HEADER,
} from '@/lib/voice-webhook-auth';
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from '@/lib/rate-limit';
import { persistUnconfirmedInquiry } from '@/lib/unconfirmed-inquiry';
import { fetchVoiceAITranscript } from '@/lib/ghl-voice-ai-api';
import {
  buildVoiceCallbackMessage,
  reconcileVoiceBranch,
} from '@/lib/voice-branch-classifier';
import { classifyVoiceBranchServer } from '@/lib/voice-branch-classifier-server';
import {
  notifyOperatorOfVoiceCallback,
  notifyOperatorOfUnconfirmedVoiceIntake,
  notifyOperatorOfLlmDisabled,
} from '@/lib/voice-callback-notify';
import { shouldAlertLlmDisabled } from '@/lib/llm-health-alert';

interface VoiceIntakeBody {
  caller_phone?: string;
  caller_name?: string;
  transcript_full?: string;
  transcript_summary?: string;
  transcript?: string; // legacy field; pre-2026-05-21 deployments
  recording_url?: string;
  call_duration_sec?: number;
  call_id?: string;
  firmId?: string;
}

/**
 * Resolve which transcript text to feed the engine. Prefer full verbatim
 * (from the Transcript Generated trigger) over GHL's call_summary
 * paraphrase, falling back to the legacy `transcript` field.
 *
 * GHL renders unresolved variables as empty strings or the literal
 * placeholder text — both are treated as "missing" here. We also reject
 * strings that are obviously placeholder noise (just braces, just the
 * variable token) so a misconfigured webhook doesn't poison the engine.
 */
function resolveTranscript(body: VoiceIntakeBody): {
  text: string;
  source: 'full' | 'summary' | 'legacy' | 'none';
} {
  const candidates: Array<{ text: string; source: 'full' | 'summary' | 'legacy' }> = [
    { text: (body.transcript_full ?? '').trim(), source: 'full' },
    { text: (body.transcript_summary ?? '').trim(), source: 'summary' },
    { text: (body.transcript ?? '').trim(), source: 'legacy' },
  ];
  for (const c of candidates) {
    if (!c.text) continue;
    // Skip if GHL rendered the literal template placeholder (variable not
    // resolved). Catches `{{transcript_generated.call_transcript}}`,
    // `{{contact.call_summary}}`, and similar.
    if (/^\{\{[^{}]+\}\}$/.test(c.text)) continue;
    // Skip if GHL rendered the variable as the literal string "null" or
    // "undefined" — observed on 2026-05-21 PM when a web-call test fired
    // the Transcript Generated trigger but the transcription pipeline
    // had not populated the call_transcript field. Treating these as
    // missing lets the resolver fall through to the next source instead
    // of feeding "null" into the engine as the transcript.
    const lower = c.text.toLowerCase();
    if (lower === 'null' || lower === 'undefined' || lower === '(null)') continue;
    return c;
  }
  return { text: '', source: 'none' };
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
  // Rate limit (APP-007). Same shape and bucket size as /api/intake-v2.
  // 429 with Retry-After on bucket exhaustion. Fail-open until Upstash
  // env vars are configured.
  const ip = ipFromRequest(req);
  const rl = await checkRateLimit('intake', ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate limited', retry_after_seconds: Math.ceil((rl.reset - Date.now()) / 1000) },
      { status: 429, headers: { ...CORS_HEADERS, ...rateLimitHeaders(rl) } },
    );
  }

  // Read the raw body FIRST. HMAC verification requires byte-exact input;
  // parsing JSON and re-serializing would change whitespace and break the
  // hash. We then re-parse from the raw string ourselves.
  const rawBody = await req.text();
  let body: VoiceIntakeBody;
  try {
    body = JSON.parse(rawBody) as VoiceIntakeBody;
  } catch {
    return NextResponse.json(
      { error: 'invalid JSON body' },
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
    .select('id, name, voice_api_token, ghl_location_id, location, gemini_disabled_alert_sent_at')
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

  // ── Transcript resolution: API-first, body-fallback ───────────────────
  //
  // Primary path: list call logs for the GHL contact via the Voice AI
  // Public API and take the most recent one. The list response includes
  // the full verbatim `transcript` field inline; no per-call round-trip
  // needed. Workflow custom values do not reliably expose the verbatim
  // transcript (variable rendering produces literal placeholders, empty
  // strings, or paraphrases — confirmed empirically 2026-05-21 PM), so
  // this server-side fetch is the only reliable way to get digits and
  // exact phrasing the engine needs for the contact-doctrine gate
  // (DR-038).
  //
  // Identifiers used:
  //   - contactId    ← `call_id` from the webhook body (which is
  //                    `{{contact.id}}` from the GHL workflow). This is
  //                    the GHL contact id, NOT the dashboard call-log
  //                    id. Listing by contactId sidesteps the call-log
  //                    id format problem entirely.
  //   - locationId   ← per-firm `intake_firms.ghl_location_id`.
  //   - token        ← per-firm `intake_firms.voice_api_token` (PIT).
  //
  // Fallback path: if any of the three identifiers is missing, or the
  // API fetch fails for any reason, fall through to
  // `resolveTranscript(body)` which picks the best of transcript_full
  // / transcript_summary / legacy transcript fields. The summary is
  // strictly degraded (paraphrased, digits stripped) but at least lets
  // the engine attempt matter classification and avoid silent drops.
  let transcript = '';
  let transcriptSource: 'voice-ai-api' | 'full' | 'summary' | 'legacy' | 'none' = 'none';
  let apiFetchTelemetry: string = 'skipped';
  // API-fetched caller phone, used as fallback when body.caller_phone is
  // empty because GHL's `{{contact.phone}}` template did not resolve.
  // Field-detected 2026-05-31 (Adriano test call landed as
  // "Guest Visitor 001" with body.caller_phone empty; the Voice AI Public
  // API's `fromNumber` still carried the correct caller-ID digits).
  let apiCallerPhone: string | null = null;

  const contactId = (body.call_id ?? '').trim();
  const firmRow = firm as {
    name?: string | null;
    voice_api_token?: string | null;
    ghl_location_id?: string | null;
    location?: string | null;
    gemini_disabled_alert_sent_at?: string | null;
  };
  const firmToken = firmRow.voice_api_token ?? null;
  const firmLocationId = firmRow.ghl_location_id ?? null;
  // Resolve the firm's display timezone for the brief (#138). Stored
  // timestamps are UTC; the lawyer brief renders on read in firm-local time.
  const firmTimezone = resolveFirmTimezone({ location: firmRow.location });

  if (contactId && firmToken && firmLocationId) {
    const apiResult = await fetchVoiceAITranscript(contactId, firmLocationId, firmToken);
    if (apiResult.ok) {
      transcript = apiResult.transcript;
      transcriptSource = 'voice-ai-api';
      apiCallerPhone = apiResult.callerPhone ?? null;
      apiFetchTelemetry = `ok len=${apiResult.transcript.length} callLogId=${apiResult.callLogId ?? 'unknown'} fromNumber=${apiResult.callerPhone ? 'present' : 'absent'}`;
    } else {
      apiFetchTelemetry = `fail reason=${apiResult.reason}${apiResult.status ? ` status=${apiResult.status}` : ''}${apiResult.detail ? ` detail=${apiResult.detail.slice(0, 200)}` : ''}`;
    }
  } else {
    const missing: string[] = [];
    if (!contactId) missing.push('contact_id');
    if (!firmToken) missing.push('firm_token');
    if (!firmLocationId) missing.push('firm_location_id');
    apiFetchTelemetry = `skipped reason=missing:${missing.join(',')}`;
  }

  if (!transcript) {
    const fallback = resolveTranscript(body);
    if (fallback.text) {
      transcript = fallback.text;
      transcriptSource = fallback.source;
    }
  }

  if (!transcript) {
    console.warn(`[voice-intake] no transcript available firm=${firmIdParam} api=${apiFetchTelemetry}`);
    return NextResponse.json(
      { error: 'transcript is required (no transcript via Voice AI API, no usable transcript field in body)' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  console.log(`[voice-intake] transcript source=${transcriptSource} length=${transcript.length} api=${apiFetchTelemetry}`);

  // ── HMAC verification (Codex audit HIGH #7) ───────────────────────────
  // GHL Voice AI is expected to send X-CLS-Voice-Signature: sha256=<hex>
  // over the raw body, computed with the firm-specific shared secret
  // stored in intake_firms.voice_webhook_secret. Until that column
  // exists, until per-firm secrets are populated, and until
  // VOICE_HMAC_REQUIRED=true is set globally, this verification is in
  // "soft enforce" mode — it logs signature mismatches but does not
  // reject. See src/lib/voice-webhook-auth.ts for the full rollout
  // posture.
  const signature = req.headers.get(VOICE_SIGNATURE_HEADER);
  const verifyResult = await verifyVoiceWebhookSignature({
    firmId: firmIdParam,
    rawBody,
    signatureHeader: signature,
  });
  const required = isHmacRequired();
  const gate = shouldRejectVoiceRequest(verifyResult, required);
  if (gate.reject) {
    console.warn(
      `[voice-intake] signature gate rejected firm=${firmIdParam} required=${required} reason=${gate.reason}`,
    );
    return NextResponse.json(
      { error: 'voice webhook signature rejected', reason: gate.reason },
      { status: 401, headers: CORS_HEADERS },
    );
  }
  if (verifyResult.mode === 'verified') {
    // Log success at info-level only on the first verified call per cold
    // start (cheap signal that the wiring works for this firm).
    console.log(`[voice-intake] signature verified firm=${firmIdParam}`);
  } else if (verifyResult.mode === 'mismatch' || verifyResult.mode === 'malformed_signature') {
    // Soft-fail: log the mismatch even though we proceed, so the operator
    // can spot rollout problems while VOICE_HMAC_REQUIRED is still off.
    console.warn(
      `[voice-intake] signature soft-fail firm=${firmIdParam} mode=${verifyResult.mode} reason=${verifyResult.reason}`,
    );
  }

  // ── Engine pipeline ────────────────────────────────────────────────────
  // Caller phone resolution: prefer body.caller_phone (from the GHL workflow
  // webhook), fall back to the Voice AI Public API's `fromNumber` when the
  // body field is empty. The fallback covers the case where GHL's
  // `{{contact.phone}}` template did not resolve at workflow-execution time
  // (typically because the inbound contact was created as "Guest Visitor
  // 001" without the phone field populated on the contact record).
  // Field-detected 2026-05-31 — without this fallback the contact-capture
  // doctrine gate rejects every voice call from new contacts with
  // reason=no_contact_provided.
  const bodyCallerPhone = normalizePhone(body.caller_phone);
  const callerPhone = bodyCallerPhone ?? normalizePhone(apiCallerPhone);
  const callerName = (body.caller_name ?? '').trim() || null;
  // Transport-origin provenance for the caller phone: did it arrive on the
  // webhook body, get fetched from the Voice AI API, or never resolve? Recorded
  // in voice_meta on ALL THREE persistence paths (callback request, unconfirmed
  // inquiry, screened lead) so an operator triaging any voice row can see how
  // the number was obtained. This is distinct from the conversational provenance
  // on resolved_facts_v2 (stated / confirmed-after-readback / spelled).
  const callerPhoneSource: 'body' | 'voice-ai-api' | 'none' = bodyCallerPhone
    ? 'body'
    : apiCallerPhone
      ? 'voice-ai-api'
      : 'none';
  if (!bodyCallerPhone && callerPhone) {
    console.log(`[voice-intake] caller_phone fallback firm=${firmIdParam} source=voice-ai-api`);
  }

  // Voice-channel transcript repair (task #109, Codex pushback 2026-05-27):
  // apply ASR corrections (state→estate, "planning a bill"→"planning a will")
  // and confirmation preservation (bot canonical-readback + human "yes" →
  // synthetic confirmation line) before the engine classifier runs. Lives
  // outside src/lib/screen-engine/ so the engine remains byte-for-byte
  // mirrored with the sandbox (DR-033). The ORIGINAL transcript still
  // persists to `raw_transcript` for audit; only the engine's classifier
  // input is normalised.
  const { normalized: normalizedTranscript, changes: normalizationChanges } =
    normalizeVoiceTranscript(transcript);
  if (normalizationChanges.length > 0) {
    console.log(
      `[voice-intake] transcript-normalization applied: ${normalizationChanges.length} change(s) — ${normalizationChanges.map((c) => c.detail).join(' | ')}`,
    );
  }

  // ── Multi-intent voice front desk (DR-054 candidate) ──────────────────
  // The public voice line is not intake-only. The GHL agent emits a coarse
  // RECORD_BRANCH marker, and the app independently classifies the transcript.
  // Non-intake calls persist to voice_callback_requests, never screened_leads.
  const appBranch = await classifyVoiceBranchServer(normalizedTranscript);
  const branchDecision = reconcileVoiceBranch({
    transcript: normalizedTranscript,
    classifierBranch: appBranch.branch,
    strictMissingMarker: process.env.VOICE_ROUTER_STRICT_MARKER === 'true',
  });

  if (branchDecision.route === 'callback') {
    const callbackBranch = branchDecision.callbackBranch ?? 'unclear';
    const callbackMessage = buildVoiceCallbackMessage(normalizedTranscript);
    const voiceMeta = {
      call_id: body.call_id ?? null,
      call_duration_sec: body.call_duration_sec ?? null,
      recording_url: body.recording_url ?? null,
      caller_phone_source: callerPhoneSource,
      transcript_source: transcriptSource,
      api_fetch: apiFetchTelemetry,
      marker: branchDecision.marker?.value ?? null,
      marker_raw: branchDecision.marker?.raw ?? null,
      classifier_branch: branchDecision.classifierBranch,
      classifier_mode: appBranch.mode,
      classifier_reason: appBranch.reason ?? null,
      reconciliation_reason: branchDecision.reason,
      operator_review: branchDecision.operatorReview,
      urgency_triggers: branchDecision.urgencyTriggers,
    };

    const { data: callbackRow, error: callbackErr } = await supabase
      .from('voice_callback_requests')
      .insert({
        firm_id: firmIdParam,
        call_id: body.call_id ?? null,
        branch: callbackBranch,
        urgency: branchDecision.urgency,
        caller_name: callerName,
        caller_phone: callerPhone,
        organization: null,
        message: callbackMessage,
        raw_transcript: transcript,
        voice_meta: voiceMeta,
      })
      .select('id')
      .single();

    if (callbackErr) {
      return NextResponse.json(
        { error: `voice callback insert failed: ${callbackErr.message}` },
        { status: 500, headers: CORS_HEADERS },
      );
    }

    waitUntil(notifyOperatorOfVoiceCallback({
      id: callbackRow.id,
      firmId: firmIdParam,
      branch: callbackBranch,
      urgency: branchDecision.urgency,
      callerName,
      callerPhone,
      organization: null,
      message: callbackMessage,
      callId: body.call_id ?? null,
      operatorReview: branchDecision.operatorReview,
      reason: branchDecision.reason,
    }).catch((err) => {
      console.error('[voice-router] notifyOperatorOfVoiceCallback failed:', err);
    }));

    return NextResponse.json(
      {
        persisted: true,
        mode: 'callback',
        id: callbackRow.id,
        branch: callbackBranch,
        urgency: branchDecision.urgency,
        operator_review: branchDecision.operatorReview,
        reason: branchDecision.reason,
      },
      { status: 200, headers: CORS_HEADERS },
    );
  }

  // 1. initialiseState — regex classification + raw signals
  let state = initialiseState(normalizedTranscript);
  // 2. tag the channel before anything reads state.channel
  state = { ...state, channel: 'voice' };
  // 3. seed phone + name from caller ID
  state = seedVoiceState(state, callerPhone, callerName);
  // 4. evidence pass (regex deepening) — use the NORMALIZED transcript so
  // slot extraction sees "estate planning" / "planning a will" rather than
  // the raw ASR-corrupted "state planning" / "planning a bill". Codex
  // pushback 2026-05-27: classification was already on normalized text but
  // slot extraction was leaking the raw transcript, which could mis-fill
  // downstream fields (e.g. miss an estate-related slot entirely).
  state = runEvidencePass(normalizedTranscript, state);

  // 5. LLM extraction (best-effort; failure does not abort) — same
  // rationale: feed the normalized transcript so Gemini extracts against
  // the corrected text, not the raw ASR output.
  // llmMode is hoisted so the brief metadata + the LLM-disabled alert (#128)
  // can both see what the extractor returned. null = LLM was not attempted
  // (out_of_scope) or threw before returning a mode.
  let llmMode: 'live' | 'disabled' | 'error' | 'degraded' | null = null;
  if (state.matter_type !== 'out_of_scope') {
    try {
      const llm = await llmExtractServer(normalizedTranscript, state);
      llmMode = llm.mode;
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

  // #128: alert the operator when LLM extraction is disabled (GEMINI_API_KEY
  // missing/invalid). Every brief degrades to regex-only until it's fixed, with
  // no other signal. Throttled per firm via intake_firms.gemini_disabled_alert
  // _sent_at so a sustained outage doesn't email once per inbound call.
  // Fires before the contact gate so it covers both the screened-lead and the
  // unconfirmed-inquiry outcomes. Best-effort, non-blocking.
  if (llmMode === 'disabled' && shouldAlertLlmDisabled(firmRow.gemini_disabled_alert_sent_at)) {
    const llmAlertStamp = new Date().toISOString();
    console.error(
      `[voice-intake][llm-disabled] GEMINI extraction disabled firm=${firmIdParam} call=${body.call_id ?? 'unknown'}`,
    );
    waitUntil(
      (async () => {
        const sendResult = await notifyOperatorOfLlmDisabled({
          firmId: firmIdParam,
          firmName: firmRow.name ?? null,
          mode: 'disabled',
          channel: 'voice',
          callId: body.call_id ?? null,
          occurredAtIso: llmAlertStamp,
        });
        if (sendResult.email === 'sent') {
          await supabase
            .from('intake_firms')
            .update({ gemini_disabled_alert_sent_at: llmAlertStamp })
            .eq('id', firmIdParam);
        }
      })().catch((err) => {
        console.error('[voice-intake] notifyOperatorOfLlmDisabled failed:', err);
      }),
    );
  }

  // Defense-in-depth name recovery (#122 + 2026-06-04). If the engine captured
  // no client name, recover one from the transcript before the contact gate so
  // a caller who DID give their name isn't dropped on an extraction miss (the
  // exact Call #1 failure: LLM degraded, no readback, bare "Adriana" un-parsed).
  // Two signals, strongest first: a bot readback the caller cleanly affirmed
  // (rank 5, promoted to confirmed_by_caller_after_readback below), or the bare
  // answer to the bot's name question (stays "stated during call"). Only fills
  // an empty slot, never overwrites or invents (recoverNameIfMissing returns
  // null on any doubt). seedVoiceState's 'answered' source floors it at
  // explicit_from_caller; promoteContactProvenance upgrades only when readback
  // evidence exists.
  const recoveredName = recoverNameIfMissing(
    state.slots['client_name'] as string | null,
    normalizedTranscript,
  );
  if (recoveredName) {
    console.log(
      `[voice-intake] recovered missing client name (readback or name-question) firm=${firmIdParam} call=${body.call_id ?? 'unknown'}`,
    );
    state = {
      ...state,
      slots: { ...state.slots, client_name: recoveredName },
      slot_meta: {
        ...state.slot_meta,
        client_name: { source: 'answered', confidence: 1.0 },
      },
    };
  }

  // ── Build the brief ─────────────────────────────────────────────────────
  const report = buildReport(state);
  // #137 phase 2 / #139: promote contact-fact provenance using transcript
  // readback/spelling evidence (e.g. bot read the name back + caller said
  // "yes" -> "Confirmed by caller"; caller spelled the surname ->
  // "Spelled by caller"). Voice is the only channel with bot turns in the
  // transcript; the detector returns 'none' otherwise. Floor stays
  // "Stated during call" when no confirmation evidence exists.
  report.resolved_facts_v2 = promoteContactProvenance(
    report.resolved_facts_v2,
    normalizedTranscript,
  );
  const briefHtml = renderBriefHtmlServer(
    report,
    'voice',
    state.language,
    firmTimezone,
    state.matter_type,
    state.practice_area,
  );
  const completeness = computeCoreCompleteness(state);
  const bandResult = computeBand(state);
  // OOS now carries band='D' per the 2026-05-15 doctrine flip; the engine
  // assigns the band, the route doesn't override it.
  const band: Band | null = bandResult.band;

  // ── Contact-capture gate — voice reachability doctrine (2026-06-04) ────
  // The shared contact doctrine (contact-doctrine.ts, mirrored to the sandbox)
  // is "name AND reachability". For VOICE specifically we relax it to
  // "reachability is enough": a call with a caller-ID phone (or a captured
  // email) belongs in the lawyer queue even when the NAME never parsed. The
  // lawyer gets the name on the callback, and reachability-over-completeness
  // is the v2.0 voice doctrine. Only a voice call with NO way to reach the
  // caller (blocked caller-ID AND no spoken number AND no email) is an
  // unconfirmed inquiry. The shared gate for web/Meta is untouched.
  //
  // Trigger: DRG voice smoke 2026-06-04 (inquiry 3aff8961). A will-drafting
  // caller with a caller-ID number was dropped to unconfirmed_inquiries purely
  // because the name did not extract (the agent asked it, the caller said it,
  // but llm_mode=degraded and there was no readback). Fix A recovers the name
  // in that exact shape; this gate is the safety net for every other
  // name-miss so a reachable lead never becomes an operator chore.
  const voiceGate = evaluateContactGate({
    client_name: (state.slots['client_name'] as string | null | undefined) ?? null,
    client_email: (state.slots['client_email'] as string | null | undefined) ?? null,
    client_phone: (state.slots['client_phone'] as string | null | undefined) ?? null,
  });
  const voiceReachable = voiceGate.hasPhone || voiceGate.hasEmail;
  if (!voiceReachable) {
    const unconfirmed = await persistUnconfirmedInquiry({
      firmId: firmIdParam,
      channel: 'voice',
      senderId: callerPhone ?? null,
      senderMeta: {
        call_id: body.call_id ?? null,
        call_duration_sec: body.call_duration_sec ?? null,
        recording_url: body.recording_url ?? null,
        caller_name: callerName,
        // Both the body field AND the API fallback so the operator can see
        // which path resolved (or both null) when triaging unconfirmed
        // inquiries. Added 2026-05-31 after the fromNumber fallback work.
        caller_phone: callerPhone,
        caller_phone_source: callerPhoneSource,
        // #128: a disabled LLM can itself cause the contact gate to fail
        // (regex missed the name), so record what extraction ran.
        llm_mode: llmMode,
      },
      rawTranscript: transcript,
      matterType: state.matter_type,
      practiceArea: state.practice_area,
      intakeLanguage: state.language ?? 'en',
      reason: 'no_contact_provided',
    });
    // #125: alert the operator. On every other channel the engine re-asks for
    // contact; on voice the call is already over, so an unconfirmed inbound
    // would otherwise vanish silently. Best-effort, non-blocking — never holds
    // up the webhook ACK, never affects the persisted row. Operator inbox only
    // (adriano@caseloadselect.ca), never the lawyer queue.
    waitUntil(
      notifyOperatorOfUnconfirmedVoiceIntake({
        inquiryId: unconfirmed.id ?? null,
        firmId: firmIdParam,
        callId: body.call_id ?? null,
        callerName,
        callerPhone,
        callerPhoneSource,
        recordingUrl: body.recording_url ?? null,
        callDurationSec: body.call_duration_sec ?? null,
        matterType: state.matter_type,
        practiceArea: state.practice_area,
        intakeLanguage: state.language ?? 'en',
        reason: 'no_contact_provided',
        transcript,
      }).catch((err) => {
        console.error('[voice-intake] notifyOperatorOfUnconfirmedVoiceIntake failed:', err);
      }),
    );
    return NextResponse.json(
      {
        persisted: false,
        reason: 'awaiting_contact',
      },
      { status: 200, headers: CORS_HEADERS },
    );
  }

  // ── Derived flags (same helpers as intake-v2) ──────────────────────────
  const now = new Date();
  const axes = report.four_axis;
  const decisionDeadline = computeDecisionDeadline(axes.urgency, now, state.matter_type);
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
      // Transport-origin provenance for the phone (#126). The callback and
      // unconfirmed paths already record this; the screened_leads path is the
      // one the lawyer brief is built from, so it carries it too.
      caller_phone_source: callerPhoneSource,
      // What extraction actually ran (#128). 'disabled' means the brief is
      // regex-only because GEMINI_API_KEY was missing/invalid.
      llm_mode: llmMode,
      branch_marker: branchDecision.marker?.value ?? null,
      classifier_branch: branchDecision.classifierBranch,
      classifier_mode: appBranch.mode,
      classifier_reason: appBranch.reason ?? null,
      branch_reconciliation_reason: branchDecision.reason,
      branch_operator_review: branchDecision.operatorReview,
      urgency_triggers: branchDecision.urgencyTriggers,
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
      // APP-006: see intake-v2/route.ts companion comment.
      status_changed_by_role: "system",
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
      intake_language: state.language ?? 'en',
      raw_transcript: transcript,
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

  // ── Lead notification email (best-effort) ──────────────────────────────
  // Doctrine (2026-05-15): "The engine sorts attention, the lawyer decides
  // outcome." OOS voice calls now carry band='D' and status='triaging' so
  // the lawyer can Refer / Take / Pass. The decline-with-grace GHL cadence
  // fires only on lawyer-initiated Pass or the deadline backstop.
  //
  // Dev vs prod dispatch policy (added 2026-06-04, mirrors /api/intake-v2):
  //   - Production: waitUntil() lets the email continue after the response
  //     returns. Vercel keeps the function instance alive for it.
  //   - Non-production (local Next.js dev): waitUntil() is unreliable
  //     because the dev server (especially Turbopack on Windows / D: with
  //     constant HMR restarts) tears down in-flight work before the Resend
  //     call lands. To keep operator parity between dev and prod, await the
  //     call directly in dev — guarantees the email completes before the
  //     request closes.
  if (inserted.status === 'triaging' || inserted.status === 'declined') {
    const notifyPromise = notifyLawyersOfNewLead({
      firmId: firmIdParam,
      leadId: inserted.lead_id,
      contactName: state.slots['client_name'] ?? callerName ?? null,
      matterType: state.matter_type,
      practiceArea: state.practice_area,
      band,
      decisionDeadlineIso: inserted.decision_deadline,
      whaleNurture: !!inserted.whale_nurture,
      intakeLanguage: state.language ?? 'en',
      channel: 'voice',
      lifecycleStatus: inserted.status as 'triaging' | 'declined',
    }).catch((err) => {
      console.error('[voice-intake] notifyLawyersOfNewLead failed:', err);
    });

    if (process.env.NODE_ENV === 'production') {
      waitUntil(notifyPromise);
    } else {
      // Block the response until the email completes — only in dev.
      await notifyPromise;
    }
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
