/**
 * Voice intake engine pipeline — extracted from `/api/voice-intake/route.ts`
 * so a second caller can run the IDENTICAL engine + brief + gate logic
 * against a transcript without re-implementing it.
 *
 * Built for the operator-gated `/api/admin/voice-callback/[id]/promote`
 * route (CLS reset, 2026-06-05): when an operator promotes a
 * `voice_callback_requests` row into `screened_leads`, the recovered lead
 * MUST read exactly like a normal CLS-produced lead. Handcrafting brief
 * HTML or scores in SQL is forbidden; the only allowed path is the real
 * engine pipeline.
 *
 * Scope: this helper runs steps 2-10 of the live voice intake pipeline —
 *   2. initialiseState
 *   3. channel tag
 *   4. seedVoiceState (caller phone + name from caller-ID)
 *   5. runEvidencePass on the normalised transcript
 *   6. llmExtractServer (best-effort; carries on with regex-only state)
 *   7. recoverNameIfMissing (#122 defense-in-depth)
 *   8. buildReport
 *   9. promoteContactProvenance
 *   10. renderBriefHtmlServer
 *
 * It does NOT do:
 *   - HMAC verification, rate limiting, firm lookup, transcript fetching
 *     (webhook-only concerns)
 *   - Branch classification / reconciliation (the caller chooses the branch)
 *   - Persistence (the caller writes to screened_leads or voice_callback_requests)
 *   - Notifications (the caller fires lawyer-notify and operator alerts)
 *
 * The split keeps the route handlers thin and identical at the engine layer,
 * so a promoted lead is byte-identical to a fresh voice-intake lead in every
 * visible respect.
 */

import { initialiseState } from '@/lib/screen-engine/extractor';
import { runEvidencePass } from '@/lib/screen-engine/slotEvidence';
import { mergeLlmResults } from '@/lib/screen-engine/llm/extractor';
import { buildReport } from '@/lib/screen-engine/report';
import { computeBand } from '@/lib/screen-engine/band';
import { normalizeVoiceTranscript } from '@/lib/voice-transcript-normalization';
import { llmExtractServer } from '@/lib/screen-llm-server';
import { renderBriefHtmlServer } from '@/lib/screen-brief-html';
import { promoteContactProvenance } from '@/lib/promote-contact-provenance';
import { recoverNameIfMissing } from '@/lib/readback-detection';
import { computeDecisionDeadline, computeWhaleNurture } from '@/lib/intake-v2-derive';
import type { EngineState, LawyerReport, Band } from '@/lib/screen-engine/types';

export interface VoicePipelineInput {
  rawTranscript: string;
  callerPhone: string | null;
  callerName: string | null;
  firmTimezone: string;
  /**
   * Optional recording URL to surface in the brief's Queue posture sidebar.
   * Voice-only; absent for the promote-route replay path where the recording
   * may not be available.
   */
  recordingUrl?: string | null;
}

export interface VoicePipelineResult {
  state: EngineState;
  report: LawyerReport;
  briefHtml: string;
  /**
   * The decision-window deadline computed during this pipeline run. The
   * caller persists this as `screened_leads.decision_deadline` so the brief's
   * live-timer placeholder (data-deadline-iso on the cover + sidebar) reads
   * back exactly what the column holds.
   */
  decisionDeadlineIso: string;
  whaleNurture: boolean;
  normalizedTranscript: string;
  llmMode: 'live' | 'disabled' | 'error' | 'degraded' | null;
  band: Band | null;
  /**
   * True iff the contact-doctrine gate passes for this transcript. For
   * voice specifically, the route-layer reachability check (caller-ID phone
   * counts as reachable even when the name doesn't parse) is applied AT THE
   * ROUTE, not here. The route inspects `report.contact_complete` plus the
   * voice reachability gate from `/api/voice-intake` and decides.
   *
   * Surfaced here as a convenience so test harnesses can branch without
   * re-running the gate.
   */
  contactComplete: boolean;
}

/**
 * Same seeding function the live route uses for caller-ID auto-fill.
 * Exported so the promote route can call it identically.
 */
export function seedVoiceState(
  state: EngineState,
  callerPhone: string | null,
  callerName: string | null,
): EngineState {
  let s = state;
  // Provenance matches the live route's seeding (drift fixed 2026-06-11,
  // DR-069 pass): caller-ID phone is carrier reachability
  // ('system_metadata'), caller name is GHL contact-record identity
  // ('profile_metadata'). The previous 'answered' stamps overclaimed and
  // made replayed rows defeat the weak-name and provenance logic.
  if (callerPhone && !s.slots['client_phone']) {
    s = {
      ...s,
      slots: { ...s.slots, client_phone: callerPhone },
      slot_meta: {
        ...s.slot_meta,
        client_phone: { source: 'system_metadata', confidence: 1.0 },
      },
    };
  }
  if (callerName && !s.slots['client_name']) {
    s = {
      ...s,
      slots: { ...s.slots, client_name: callerName },
      slot_meta: {
        ...s.slot_meta,
        client_name: { source: 'profile_metadata', confidence: 1.0 },
      },
    };
  }
  return s;
}

/**
 * Run the voice intake engine pipeline against a transcript.
 *
 * Byte-identical to the live `/api/voice-intake` route's engine pipeline
 * (lines 507-616 in the route handler as of 2026-06-05). When the live
 * route's pipeline changes, this function changes with it in the same commit;
 * a second commit later means the promote route has drifted, which is the
 * exact failure mode the reset forbids.
 */
export async function runVoicePipeline(
  input: VoicePipelineInput,
): Promise<VoicePipelineResult> {
  const { rawTranscript, callerPhone, callerName, firmTimezone, recordingUrl } = input;

  // Voice-channel transcript repair (task #109): ASR corrections + readback
  // confirmation preservation. The ORIGINAL transcript is what the caller
  // persists for audit; the engine sees the normalised one.
  const { normalized: normalizedTranscript } = normalizeVoiceTranscript(rawTranscript);

  // 1. initialiseState — regex classification + raw signals
  let state = initialiseState(normalizedTranscript);
  // 2. tag the channel before anything reads state.channel
  state = { ...state, channel: 'voice' };
  // 3. seed phone + name from caller ID (idempotent for already-filled slots)
  state = seedVoiceState(state, callerPhone, callerName);
  // 4. evidence pass (regex deepening) on the NORMALISED transcript
  state = runEvidencePass(normalizedTranscript, state);

  // 5. LLM extraction (best-effort; failure does not abort the pipeline).
  // llmMode hoisted so the caller can record it in voice_meta + fire the
  // LLM-disabled operator alert (#128) when appropriate.
  let llmMode: VoicePipelineResult['llmMode'] = null;
  if (state.matter_type !== 'out_of_scope') {
    try {
      const llm = await llmExtractServer(normalizedTranscript, state);
      llmMode = llm.mode;
      const filledIds = Object.keys(llm.extracted).filter(
        (k) => llm.extracted[k] !== null && llm.extracted[k] !== '',
      );
      if (llm.mode === 'live' && filledIds.length > 0) {
        // allowGeneralPromotion (DR-069): replay of a single-pass voice
        // transcript, same rationale as the live route.
        state = mergeLlmResults(state, llm.extracted, { allowGeneralPromotion: true });
      }
    } catch (err) {
      console.warn('[voice-pipeline] llmExtractServer failed:', err);
    }
  }

  // 6. #122 + name-question recovery (defense-in-depth). If the engine
  // captured no client name but the transcript carries a recoverable one
  // (readback the caller affirmed, or a bare answer to "Can I get your
  // name?"), backfill it BEFORE the contact gate.
  const recoveredName = recoverNameIfMissing(
    state.slots['client_name'] as string | null,
    normalizedTranscript,
  );
  if (recoveredName) {
    state = {
      ...state,
      slots: { ...state.slots, client_name: recoveredName },
      slot_meta: {
        ...state.slot_meta,
        client_name: { source: 'answered', confidence: 1.0 },
      },
    };
  }

  // 7. Build the report and promote contact-fact provenance using readback
  // / spelling evidence from the transcript.
  const report = buildReport(state);
  report.resolved_facts_v2 = promoteContactProvenance(
    report.resolved_facts_v2,
    normalizedTranscript,
  );

  // 8a. Compute the decision deadline up front so the renderer can stamp it
  // onto the cover decision band + sidebar Queue posture. The caller (live
  // voice-intake route OR the promote route) persists this same value as
  // `decision_deadline` so the live-timer reads back exactly what is stored.
  const pipelineNow = new Date();
  const pipelineDeadline = computeDecisionDeadline(
    report.four_axis.urgency,
    pipelineNow,
    state.matter_type,
  );
  const pipelineWhale = computeWhaleNurture(
    report.four_axis.value,
    report.four_axis.readiness,
  );

  // 8b. Render the lawyer-facing brief (v2 cover layout; matter-aware).
  const briefHtml = renderBriefHtmlServer(
    report,
    'voice',
    state.language,
    firmTimezone,
    state.matter_type,
    state.practice_area,
    {
      decisionDeadlineIso: pipelineDeadline.toISOString(),
      whaleNurture: pipelineWhale,
      recordingUrl: recordingUrl ?? null,
    },
  );

  // 9. Band assignment + contact-doctrine result for the caller to inspect.
  const bandResult = computeBand(state);

  return {
    state,
    report,
    briefHtml,
    decisionDeadlineIso: pipelineDeadline.toISOString(),
    whaleNurture: pipelineWhale,
    normalizedTranscript,
    llmMode,
    band: bandResult.band,
    contactComplete: report.contact_complete,
  };
}
