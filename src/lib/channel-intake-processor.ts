/**
 * channel-intake-processor — shared server-side engine pipeline for
 * inbound Meta channel webhooks (Messenger, Instagram, WhatsApp Cloud API).
 *
 * Three-phase architecture:
 *
 *   Phase A: contact-capture doctrine gate (2026-05-15). After running
 *            the engine, check `report.contact_complete`. If false, the
 *            row is NOT a screened lead — never reaches the lawyer.
 *
 *   Phase B: contact-capture multi-turn follow-up. When the gate fails,
 *            send a follow-up via the channel's Send API asking for name
 *            + contact, and persist EngineState in `channel_intake_sessions`
 *            so the NEXT inbound from the same sender resumes mid-conversation.
 *            After `MAX_FOLLOW_UPS` attempts without contact, give up and
 *            move the data to `unconfirmed_inquiries`.
 *
 *   Phase C: discovery follow-up loop (2026-05-16). When the contact gate
 *            passes but the engine still has discovery questions queued
 *            (`getNextStep` returns `continue`/`deepen`/`recover`), the
 *            processor asks `DISCOVERY_FOLLOW_UP_CAP` additional questions
 *            before finalising. Closes the "anemic brief" failure mode
 *            where channel-metadata pre-fill satisfied the contact gate on
 *            turn 1 and the engine never got to ask urgency / complexity /
 *            readiness slots. Counter lives in `state.discoveryFollowUpCount`
 *            (engine state field) so the existing `follow_up_count` column
 *            stays semantically scoped to contact-capture attempts.
 *
 * Voice keeps its own route (`/api/voice-intake`) because it carries
 * non-Meta metadata (call_id, recording_url, call_duration_sec).
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { resolveFirmTimezone } from '@/lib/firm-timezone';
import { notifyOperatorOfLlmDisabled } from '@/lib/voice-callback-notify';
import { shouldAlertLlmDisabled } from '@/lib/llm-health-alert';
import {
  computeDecisionDeadline,
  computeWhaleNurture,
  computeInitialStatus,
  clampAxis,
} from '@/lib/intake-v2-derive';
import { notifyLawyersOfNewLead } from '@/lib/lead-notify';
import { initialiseState } from '@/lib/screen-engine/extractor';
import { runEvidencePass } from '@/lib/screen-engine/slotEvidence';
import { mergeLlmResults } from '@/lib/screen-engine/llm/extractor';
import { buildReport } from '@/lib/screen-engine/report';
import { computeBand } from '@/lib/screen-engine/band';
import { getNextStep } from '@/lib/screen-engine/control';
import { llmExtractServer } from '@/lib/screen-llm-server';
import { renderBriefHtmlServer } from '@/lib/screen-brief-html';
import type { EngineState, Band, SlotDefinition } from '@/lib/screen-engine/types';
import { evaluateContactGate } from '@/lib/screen-engine/contact-doctrine';
import { buildClosingMessage } from '@/lib/screen-engine/closing';
import { persistUnconfirmedInquiry } from '@/lib/unconfirmed-inquiry';
import {
  loadOpenChannelSession,
  loadRecentFinalizedSession,
  createChannelSession,
  updateChannelSession,
  finalizeChannelSession,
} from '@/lib/channel-intake-session-store';
import {
  buildPostFinalizationFollowUpMessage,
  buildPostFinalizationDisambiguationMessage,
  looksLikeNewMatterIntent,
} from '@/lib/post-finalization-followup';
import {
  sendChannelMessage,
  buildContactCaptureFollowUp,
  buildContactCaptureExhaustedMessage,
} from '@/lib/channel-send';
import { applyContactExtractionToState } from '@/lib/contact-extraction';
import {
  applyNumericAnswerMapping,
  detectOutOfRangeDigitReply,
  buildOutOfRangeDigitReply,
} from '@/lib/numeric-option-mapping';
import { applyFreeTextFuzzyMatch } from '@/lib/free-text-fuzzy-match';
import { applyFreeTextAnswerMapping } from '@/lib/free-text-answer-mapping';
import {
  rerouteFromCorporateGeneral,
  rerouteFromRealEstateGeneral,
} from '@/lib/screen-engine/extractor';
import { getI18n, type I18nBundle } from '@/lib/screen-engine/i18n/loader';
import { getQuestionDisplayText, getOptionDisplayLabel } from '@/lib/screen-engine/i18n/display';
import type { SupportedLanguage } from '@/lib/screen-engine/types';

// ── Channel type ────────────────────────────────────────────────────────

export type MetaChannel = 'facebook' | 'instagram' | 'whatsapp';

const MAX_FOLLOW_UPS = 3;

// ── Discovery follow-up budget (Phase C) ─────────────────────────────────
//
// Number of additional questions the processor asks AFTER the contact-
// capture gate has passed, before finalising the lead. Doctrine update
// (2026-05-24): brief depth on Meta channels should match the web widget,
// not be capped at 3. The previous ceiling of 3 produced anemic briefs
// missing complexity / urgency / readiness signal on multi-slot matter
// types like corporate disputes (3 slots covers contact_complete +
// 2 enrichment questions only). The 12-question ceiling lets the engine
// walk the same depth as the web widget while bounding worst-case
// retention drop at 12 turns. Phase A contact-capture follow-ups are
// still capped at MAX_FOLLOW_UPS=3 (those are about getting the lead
// to share contact, not enrichment).
//
// Applied to whatsapp / facebook / instagram only. SMS and GBP are
// handled by the QUESTION_BUDGET_BY_CHANNEL map in engine/control.ts;
// voice is single-pass on the transcript.
const DISCOVERY_FOLLOW_UP_CAP = 12;
const DISCOVERY_CHANNELS = new Set<MetaChannel>(['whatsapp', 'facebook', 'instagram']);

/**
 * Render the prompt the lead reads for a discovery slot. Adds an option
 * list for single-select slots so the lead knows what answers map. The
 * processor then extracts the lead's free-text reply via the next turn's
 * regex/LLM pass; the lead does not need to type an option verbatim, but
 * surfacing the options gives the LLM a strong target on the resume turn.
 *
 * Language-aware (2026-06-08): the question text and option labels are
 * routed through `getQuestionDisplayText` and `getOptionDisplayLabel`
 * with the lead's detected language (`state.language`). When the bundle
 * for that language is missing or the slot is not yet translated, the
 * helpers cascade to English so the propagation contract holds even
 * during partial translation rollouts.
 */
function formatDiscoveryQuestion(
  slot: SlotDefinition,
  language: SupportedLanguage,
  i18n: I18nBundle,
): string {
  const base = getQuestionDisplayText(slot.id, slot.question, language, i18n).trim();
  if (slot.input_type !== 'single_select' || !slot.options || slot.options.length === 0) {
    return base;
  }
  const labels = slot.options
    .map((o, idx) => `${idx + 1}. ${getOptionDisplayLabel(o, slot.id, language, i18n)}`)
    .join('\n');
  return `${base}\n\n${labels}`;
}

// ── Sender metadata ─────────────────────────────────────────────────────

export interface MessengerSender {
  channel: 'facebook';
  /** PSID — Page-Scoped ID. Stable per (Page, user) pair. */
  senderPsid: string;
  senderName: string | null;
  messageMid: string;
  pageId: string;
}

export interface InstagramSender {
  channel: 'instagram';
  senderIgsid: string;
  senderName: string | null;
  messageMid: string;
  igBusinessAccountId: string;
}

export interface WhatsAppSender {
  channel: 'whatsapp';
  /** wa_id — Meta-side identifier (E.164 without leading +). */
  senderWaId: string;
  senderName: string | null;
  messageMid: string;
  phoneNumberId: string;
  displayPhoneNumber?: string | null;
}

export type ChannelSender = MessengerSender | InstagramSender | WhatsAppSender;

// ── Result ──────────────────────────────────────────────────────────────

export interface ProcessChannelInboundArgs {
  firmId: string;
  text: string;
  sender: ChannelSender;
}

export interface ProcessChannelInboundResult {
  persisted: boolean;
  leadId?: string;
  briefId?: string;
  status?: 'triaging' | 'declined';
  band?: Band | null;
  reason?: string;
  /** Set when a follow-up message was sent to the lead. */
  followUpSent?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Channel-specific sender identifier used as the session key. */
function getSenderId(sender: ChannelSender): string {
  switch (sender.channel) {
    case 'facebook':
      return sender.senderPsid;
    case 'instagram':
      return sender.senderIgsid;
    case 'whatsapp':
      return sender.senderWaId;
  }
}

/** Channel-specific metadata blob persisted with screened_leads / unconfirmed_inquiries. */
function buildChannelMeta(sender: ChannelSender): Record<string, unknown> {
  switch (sender.channel) {
    case 'facebook':
      return {
        page_id: sender.pageId,
        sender_psid: sender.senderPsid,
        message_mid: sender.messageMid,
        sender_name: sender.senderName,
      };
    case 'instagram':
      return {
        ig_business_account_id: sender.igBusinessAccountId,
        sender_igsid: sender.senderIgsid,
        message_mid: sender.messageMid,
        sender_name: sender.senderName,
      };
    case 'whatsapp':
      return {
        phone_number_id: sender.phoneNumberId,
        sender_wa_id: sender.senderWaId,
        message_mid: sender.messageMid,
        sender_name: sender.senderName,
        display_phone_number: sender.displayPhoneNumber ?? null,
      };
  }
}

/**
 * Drop sender contact fields into the engine state's slots. Mirrors
 * `seedVoiceState` in `/api/voice-intake`.
 *
 * Messenger / IG do not carry a phone number on inbound DMs. WhatsApp
 * carries `wa_id` which IS the phone number in E.164 form (no leading +).
 */
function seedSlots(state: EngineState, sender: ChannelSender): EngineState {
  let s = state;

  if (sender.senderName && !s.slots['client_name']) {
    s = {
      ...s,
      slots: { ...s.slots, client_name: sender.senderName },
      slot_meta: {
        ...s.slot_meta,
        client_name: { source: 'answered', confidence: 1.0 },
      },
    };
  }

  if (sender.channel === 'whatsapp' && sender.senderWaId && !s.slots['client_phone']) {
    const e164 = sender.senderWaId.startsWith('+')
      ? sender.senderWaId
      : `+${sender.senderWaId}`;
    s = {
      ...s,
      slots: { ...s.slots, client_phone: e164 },
      slot_meta: {
        ...s.slot_meta,
        client_phone: { source: 'answered', confidence: 1.0 },
      },
    };
  }

  return s;
}

// ── Main processor ──────────────────────────────────────────────────────

/**
 * Run the screen engine on an inbound channel message, branch on the
 * contact-capture doctrine, and either finalise into screened_leads OR
 * send a follow-up + persist state in channel_intake_sessions.
 *
 * Returns a structured result (not an HTTP response) so the receiver
 * can wrap the call in `waitUntil` and ACK 200 to Meta first.
 */
export async function processChannelInbound(
  args: ProcessChannelInboundArgs,
): Promise<ProcessChannelInboundResult> {
  const { firmId, text, sender } = args;
  const channel = sender.channel;
  const trimmed = text.trim();
  const senderId = getSenderId(sender);

  if (!trimmed) {
    return { persisted: false, reason: 'empty inbound text' };
  }

  // ── Resume-or-start ────────────────────────────────────────────────────
  // Phase B: if there's an open session for (firmId, channel, sender) the
  // lead is mid-conversation. Restore engine state, run the new turn
  // through the slot-extraction layers (evidence + LLM), and KEEP the
  // turn-1 classification (matter_type, practice_area, intent_family).
  const existing = await loadOpenChannelSession({ firmId, channel, senderId });

  let state: EngineState;
  let priorFollowUpCount = 0;
  let sessionId: string | undefined;
  let isResume = false;

  if (existing) {
    isResume = true;
    sessionId = existing.id;
    priorFollowUpCount = existing.follow_up_count;
    // Restore prior state. Stamp the channel defensively.
    state = { ...existing.engine_state, channel };
    // Append new turn text to the running transcript for audit.
    state = {
      ...state,
      input: state.input ? `${state.input}\n\n${trimmed}` : trimmed,
    };
  } else {
    // Fresh first turn — regex classification + raw signals.
    state = initialiseState(trimmed);
    state = { ...state, channel };
    state = seedSlots(state, sender);

    // ── Post-finalization follow-up check ─────────────────────────────
    // Before treating this as a brand-new intake, check if this sender
    // recently submitted an intake that already finalized. If yes AND
    // the new message carries no clear matter signal (matter_type
    // landed at 'unknown'), respond like a secretary would — instead
    // of triggering the contact-doctrine gate which would ask for
    // contact again and confuse the lead who already shared it.
    //
    // Genuinely-new matter descriptions DO bypass this branch: they
    // classify via the regex extractor to a specific matter type
    // (e.g. wrongful_dismissal) or to out_of_scope, not 'unknown'.
    // Only "unknown" replies — questions, thank-yous, status pings —
    // route through the secretary path.
    if (state.matter_type === 'unknown') {
      const recentFinalized = await loadRecentFinalizedSession({
        firmId,
        channel,
        senderId,
        withinDays: 7,
      });
      if (recentFinalized) {
        // Codex review follow-up: when the lead's reply hints at a NEW
        // matter ("another issue", "different problem", "new question"),
        // don't lock them into the secretary reply (which would be a
        // wrong answer about their old matter). Send a brief
        // disambiguation; the next inbound either describes the new
        // matter (regex picks up keywords → fresh intake) or signals
        // "same" (matter_type stays 'unknown' but
        // looksLikeNewMatterIntent doesn't match → secretary reply
        // fires the normal way).
        const isNewIntent = looksLikeNewMatterIntent(trimmed);
        const reply = isNewIntent
          ? buildPostFinalizationDisambiguationMessage(recentFinalized.engine_state)
          : buildPostFinalizationFollowUpMessage(recentFinalized.engine_state);
        const sendResult = await sendChannelMessage({
          firmId,
          sender,
          text: reply,
        });
        console.log(
          `[channel-intake] post-finalization ${isNewIntent ? 'disambiguation' : 'follow-up'} firm=${firmId} channel=${channel} prior_session=${recentFinalized.id} sent=${sendResult.sent}`,
        );
        return {
          persisted: false,
          reason: isNewIntent
            ? 'post_finalization_disambiguation'
            : 'post_finalization_followup',
          followUpSent: sendResult.sent,
        };
      }
    }
  }

  // Evidence pass — regex deepening on the NEW turn text. Slot
  // extraction layer; does not re-classify matter_type / practice_area
  // (those are owned by initialiseState on turn 1 and preserved on resume).
  state = runEvidencePass(trimmed, state);

  // Contact extraction — email + phone + (gated) bare-name from the
  // NEW turn text. Closes the multi-turn loop gap (2026-05-24): the bot
  // asks for contact when contact_complete is false, the lead replies
  // with bare contact info, but the engine had no path to capture it
  // (LLM excluded from contact slots, slot evidence has no patterns,
  // extractContactName only fires on turn 1 with an intro phrase). This
  // helper fills empty client_name / client_email / client_phone from
  // the turn text. Pre-filled slots (channel metadata, voice caller-ID,
  // turn-1 self-introduction) take precedence.
  state = applyContactExtractionToState(trimmed, state);

  // Out-of-range digit detection — BEFORE numeric mapping. When the
  // lead typed a digit that doesn't match any option ("11" for a
  // 5-option slot, or "0"), send a polite clarification and short-
  // circuit this turn. Without this, the engine would silently re-ask
  // the same question with no acknowledgment of the typo, which from
  // the lead's perspective looks like an infinite loop.
  if (isResume) {
    const oorDigit = detectOutOfRangeDigitReply(trimmed, state);
    if (oorDigit) {
      const clarificationText = buildOutOfRangeDigitReply(oorDigit);
      const sendResult = await sendChannelMessage({
        firmId,
        sender,
        text: clarificationText,
      });
      // Persist state UNCHANGED so the next inbound resumes from the
      // same getNextStep slot. follow_up_count is NOT incremented —
      // the lead's typo shouldn't count against the contact-capture
      // budget or the discovery budget.
      if (sessionId) {
        await updateChannelSession({
          sessionId,
          engineState: state,
          followUpCount: priorFollowUpCount,
        });
      }
      console.log(
        `[channel-intake] out-of-range digit "${oorDigit.digit}" for slot=${oorDigit.slot.id} (max=${oorDigit.maxOption}); sent clarification`,
      );
      return {
        persisted: false,
        reason: `out_of_range_digit: ${oorDigit.digit} for slot ${oorDigit.slot.id}`,
        followUpSent: sendResult.sent,
      };
    }
  }

  // Numeric-option mapping — when Phase C asks a numbered single_select
  // ("1. X / 2. Y / 3. Z") and the lead replies with a bare digit, the
  // LLM call on the new turn sees only "2" with no question context and
  // cannot extract. Loop. This helper maps the digit to the option
  // value of whichever slot getNextStep currently waits on. No-op if
  // the reply isn't a clean digit or the next-step slot isn't a
  // single_select.
  state = applyNumericAnswerMapping(trimmed, state);

  // Free-text fuzzy match — when Phase C asks a single_select and the
  // lead replies in natural language ("dont know" / "yes" / "no"), map
  // to the matching canonical option via applyAnswer. Same trick as
  // numeric mapping but for word sentinels. Without this, "dont know"
  // gets dropped by the LLM denylist (DR-025) and the engine re-asks.
  state = applyFreeTextFuzzyMatch(trimmed, state);

  // Free-text answer mapping — when Phase C asks a free_text slot
  // (e.g. business_location "Which city or region?"), the lead types
  // a short non-sentinel reply ("toronto"), and there's no path to
  // fill the slot. The LLM's strict NULL rule often returns null on
  // a bare 1-2 word reply, so the slot stays empty and the engine
  // re-asks. This adapter fills the current open free_text slot
  // with the trimmed reply via applyAnswer. Field-detected
  // 2026-05-27 on DRG Messenger lead L-2026-05-27-R2X.
  state = applyFreeTextAnswerMapping(trimmed, state);

  // LLM extraction — best-effort, never aborts. Runs on the new turn text
  // and merges into existing state. On a resume turn, the LLM sees just
  // the new text; on first turn it sees the full inbound. The doctrine
  // rule in the system prompt (rule 9) primes the LLM to extract
  // client_name / client_email / client_phone aggressively.
  // Hoisted so the LLM-disabled alert (#128, global across channels per the
  // fixes-are-global doctrine) can see what extraction returned.
  let llmMode: 'live' | 'disabled' | 'error' | 'degraded' | null = null;
  if (state.matter_type !== 'out_of_scope') {
    try {
      const llm = await llmExtractServer(trimmed, state);
      llmMode = llm.mode;
      const filledIds = Object.keys(llm.extracted).filter(
        (k) => llm.extracted[k] !== null && llm.extracted[k] !== '',
      );
      if (llm.mode === 'live' && filledIds.length > 0) {
        state = mergeLlmResults(state, llm.extracted);
      }
    } catch (err) {
      console.warn(`[channel-intake] llmExtractServer failed channel=${channel}:`, err);
    }
  }

  // Matter-type reroute after LLM merge — covers the case where Gemini
  // (not the numeric-option mapper) fills the routing slot. The engine
  // already side-effects on chip answers via applyAnswer (control.ts:
  // applyAnswer calls rerouteFromCorporateGeneral / rerouteFromRealEstate
  // General when the routing slot is filled). The numeric-option mapper
  // routes through applyAnswer too. But mergeLlmResults does NOT yet
  // invoke those side effects, so an LLM-only fill of corporate_problem
  // _type leaves matter_type at the routing catch-all. This explicit
  // call closes that gap until the engine fix lands (task #99 — teach
  // mergeLlmResults to side-effect like applyAnswer; needs sandbox sync).
  if (
    state.matter_type === 'corporate_general' &&
    typeof state.slots['corporate_problem_type'] === 'string' &&
    state.slots['corporate_problem_type']
  ) {
    state = rerouteFromCorporateGeneral(state, state.slots['corporate_problem_type']);
  }
  if (
    state.matter_type === 'real_estate_general' &&
    typeof state.slots['real_estate_problem_type'] === 'string' &&
    state.slots['real_estate_problem_type']
  ) {
    state = rerouteFromRealEstateGeneral(state, state.slots['real_estate_problem_type']);
  }

  // ── Build the brief ─────────────────────────────────────────────────────
  // Resolve firm timezone so submitted_at renders firm-local, matching the
  // voice + reclassify paths (#140). Best effort: missing firm/location falls
  // back to America/Toronto via resolveFirmTimezone(null).
  const { data: firmRow } = await supabase
    .from('intake_firms')
    .select('name, location, gemini_disabled_alert_sent_at')
    .eq('id', firmId)
    .maybeSingle();
  const firmTimezone = resolveFirmTimezone({ location: firmRow?.location ?? null });

  // #128 (global): GEMINI_API_KEY missing/invalid disables LLM extraction on
  // EVERY channel, not just voice. Alert the operator from the Meta pipeline
  // too, throttled per firm via the shared gemini_disabled_alert_sent_at column.
  // Awaited (best-effort) because this already runs inside the receiver's
  // waitUntil; a floating promise could be cut off when processing returns.
  if (
    llmMode === 'disabled' &&
    shouldAlertLlmDisabled(firmRow?.gemini_disabled_alert_sent_at ?? null)
  ) {
    const llmAlertStamp = new Date().toISOString();
    console.error(
      `[channel-intake][llm-disabled] GEMINI extraction disabled firm=${firmId} channel=${channel}`,
    );
    try {
      const sendResult = await notifyOperatorOfLlmDisabled({
        firmId,
        firmName: firmRow?.name ?? null,
        mode: 'disabled',
        channel,
        callId: null,
        occurredAtIso: llmAlertStamp,
      });
      if (sendResult.email === 'sent') {
        await supabase
          .from('intake_firms')
          .update({ gemini_disabled_alert_sent_at: llmAlertStamp })
          .eq('id', firmId);
      }
    } catch (err) {
      console.error('[channel-intake] notifyOperatorOfLlmDisabled failed:', err);
    }
  }

  const report = buildReport(state);

  // Compute the decision deadline up front so the renderer can stamp it onto
  // the cover decision band + sidebar Queue posture. The DB insert below
  // reuses the same value, so the live-timer hydrator reads back exactly
  // what the persisted column holds.
  const channelIntakeNow = new Date();
  const channelIntakeDeadline = computeDecisionDeadline(
    report.four_axis.urgency,
    channelIntakeNow,
    state.matter_type,
  );
  const channelIntakeWhale = computeWhaleNurture(
    report.four_axis.value,
    report.four_axis.readiness,
  );

  const briefHtml = renderBriefHtmlServer(
    report,
    channel,
    state.language,
    firmTimezone,
    state.matter_type,
    state.practice_area,
    {
      decisionDeadlineIso: channelIntakeDeadline.toISOString(),
      whaleNurture: channelIntakeWhale,
    },
  );
  const bandResult = computeBand(state);
  const band: Band | null = bandResult.band;

  // ── Contact-capture doctrine gate (2026-05-15) ──────────────────────────
  if (!report.contact_complete) {
    const channelMeta = buildChannelMeta(sender);
    const gate = evaluateContactGate({
      client_name: state.slots['client_name'] ?? null,
      client_email: state.slots['client_email'] ?? null,
      client_phone: state.slots['client_phone'] ?? null,
    });

    // Already exhausted the follow-up budget? Give up. Move to
    // unconfirmed_inquiries with reason='engine_refused' and finalise the
    // session so a future inbound starts fresh.
    //
    // Task #92 follow-up (2026-05-26): before the silent drop, send the
    // lead a graceful closing message so the conversation doesn't read
    // as a broken loop. Without this, the bot asks 3 times then goes
    // silent, which is exactly how the "OOS infinite loop" symptom
    // manifests in production logs (May 25 immigration row in
    // unconfirmed_inquiries with follow_up_attempts=0 + the prior
    // pattern of repeated asks). The graceful close is best-effort —
    // a send failure does not block the unconfirmed_inquiries persist
    // (the lead still moves to ops visibility either way).
    if (priorFollowUpCount >= MAX_FOLLOW_UPS) {
      try {
        const exhaustedText = buildContactCaptureExhaustedMessage(gate.missing ?? 'both');
        const exhaustedSend = await sendChannelMessage({
          firmId,
          sender,
          text: exhaustedText,
        });
        if (!exhaustedSend.sent) {
          console.warn(
            `[channel-intake] exhausted-message send failed firm=${firmId} channel=${channel}: ${exhaustedSend.reason ?? 'unknown'}`,
          );
        }
      } catch (err) {
        console.warn('[channel-intake] exhausted-message dispatch failed:', err);
      }
      await persistUnconfirmedInquiry({
        firmId,
        channel,
        senderId,
        senderMeta: channelMeta,
        rawTranscript: state.input ?? trimmed,
        matterType: state.matter_type,
        practiceArea: state.practice_area,
        intakeLanguage: state.language ?? 'en',
        reason: 'engine_refused',
        followUpAttempts: priorFollowUpCount,
      });
      if (sessionId) await finalizeChannelSession(sessionId);
      console.log(
        `[channel-intake] follow-up budget exhausted firm=${firmId} channel=${channel} attempts=${priorFollowUpCount} → engine_refused`,
      );
      return {
        persisted: false,
        reason: 'max_follow_ups_exhausted',
      };
    }

    // Send the follow-up question.
    const followUpText = buildContactCaptureFollowUp(gate.missing ?? 'both');
    const sendResult = await sendChannelMessage({
      firmId,
      sender,
      text: followUpText,
    });

    if (!sendResult.sent) {
      // Send failed (no token / Graph 4xx / network error). We cannot ask
      // the lead for contact, so fall back to unconfirmed_inquiries with
      // reason='no_contact_provided' and finalise (if a session existed).
      console.warn(
        `[channel-intake] follow-up send failed firm=${firmId} channel=${channel}: ${sendResult.reason ?? 'unknown'}`,
      );
      await persistUnconfirmedInquiry({
        firmId,
        channel,
        senderId,
        senderMeta: channelMeta,
        rawTranscript: state.input ?? trimmed,
        matterType: state.matter_type,
        practiceArea: state.practice_area,
        intakeLanguage: state.language ?? 'en',
        reason: 'no_contact_provided',
        followUpAttempts: priorFollowUpCount,
      });
      if (sessionId) await finalizeChannelSession(sessionId);
      return {
        persisted: false,
        reason: `send_failed: ${sendResult.reason ?? 'unknown'}`,
      };
    }

    // Send succeeded. Persist state in channel_intake_sessions so the
    // NEXT inbound from this sender resumes mid-conversation.
    const newCount = priorFollowUpCount + 1;
    if (sessionId) {
      await updateChannelSession({
        sessionId,
        engineState: state,
        followUpCount: newCount,
      });
    } else {
      await createChannelSession({
        firmId,
        channel,
        senderId,
        engineState: state,
        maxFollowUps: MAX_FOLLOW_UPS,
      });
    }
    console.log(
      `[channel-intake] follow-up sent firm=${firmId} channel=${channel} attempt=${newCount}/${MAX_FOLLOW_UPS} missing=${gate.missing}`,
    );
    return {
      persisted: false,
      reason: 'awaiting_contact',
      followUpSent: true,
    };
  }

  // ── Phase C: discovery follow-up loop ───────────────────────────────────
  // Contact-capture gate has passed. Before finalising, give the engine a
  // chance to ask 2-3 discovery questions on uncapped Meta channels. Cap
  // is enforced via `state.discoveryFollowUpCount`; out-of-scope and
  // single-turn channels (sms / gbp / voice) skip this phase. Skipped also
  // for out_of_scope: the bridgeText routing copy is already sufficient.
  const discoveryCount = state.discoveryFollowUpCount ?? 0;
  const inDiscoveryPhase =
    DISCOVERY_CHANNELS.has(channel) &&
    state.matter_type !== 'out_of_scope' &&
    discoveryCount < DISCOVERY_FOLLOW_UP_CAP;

  if (inDiscoveryPhase) {
    // Drive the engine to the next step. We do NOT set contactCaptureStarted
    // here: the engine's contact-capture branch demands all THREE contact
    // slots (name + phone + email) before falling through, which would
    // make the engine ask for email on whatsapp where phone is already
    // captured from sender metadata. The contact-doctrine gate above has
    // already confirmed name + (phone OR email), which is what counts as
    // a complete lead per `evaluateContactGate`. From here we want
    // discovery slots only.
    const nextStep = getNextStep(state);

    if (
      (nextStep.type === 'continue' ||
        nextStep.type === 'deepen' ||
        nextStep.type === 'recover') &&
      nextStep.slot
    ) {
      const language: SupportedLanguage = (state.language ?? 'en') as SupportedLanguage;
      const i18n = getI18n(language);
      const questionText = formatDiscoveryQuestion(nextStep.slot, language, i18n);
      const sendResult = await sendChannelMessage({
        firmId,
        sender,
        text: questionText,
      });

      if (sendResult.sent) {
        const newDiscoveryCount = discoveryCount + 1;
        const persistedState: EngineState = {
          ...state,
          contactCaptureStarted: true,
          discoveryFollowUpCount: newDiscoveryCount,
        };

        // Re-use the existing channel_intake_sessions store. The
        // follow_up_count column on the table continues to track the
        // contact-capture attempts (priorFollowUpCount); discovery count
        // lives inside engine_state. On resume, the processor reads
        // discoveryFollowUpCount from engine_state, not from the column.
        if (sessionId) {
          await updateChannelSession({
            sessionId,
            engineState: persistedState,
            followUpCount: priorFollowUpCount,
          });
        } else {
          await createChannelSession({
            firmId,
            channel,
            senderId,
            engineState: persistedState,
            maxFollowUps: MAX_FOLLOW_UPS,
          });
        }
        console.log(
          `[channel-intake] discovery question sent firm=${firmId} channel=${channel} attempt=${newDiscoveryCount}/${DISCOVERY_FOLLOW_UP_CAP} slot=${nextStep.slot.id}`,
        );
        return {
          persisted: false,
          reason: 'awaiting_discovery_answer',
          followUpSent: true,
        };
      }

      // Send failed: fall through to finalise. We have contact, the brief
      // is buildable; better to land a thin brief than to drop the lead.
      console.warn(
        `[channel-intake] discovery question send failed firm=${firmId} channel=${channel}: ${sendResult.reason ?? 'unknown'}; finalising with what we have`,
      );
    }
    // nextStep was stop / present_insight / clarify / capture_contact:
    // engine has nothing more to ask. Fall through to finalise.
  }

  // ── Gate passed (and discovery complete or skipped): finalise ──────────
  // Reuse the deadline + whale flag computed above (before the renderer call)
  // so the brief and the persisted row never disagree on the deadline.
  const now = channelIntakeNow;
  const axes = report.four_axis;
  const decisionDeadline = channelIntakeDeadline;
  const whaleNurture = channelIntakeWhale;
  const { status: initialStatus, changedBy: initialChangedBy } =
    computeInitialStatus(state.matter_type);

  // Channel-specific meta for slot_answers (audit, future re-render).
  const channelMetaForSlotAnswers = (() => {
    switch (sender.channel) {
      case 'facebook':
        return { messenger_meta: buildChannelMeta(sender) };
      case 'instagram':
        return { instagram_meta: buildChannelMeta(sender) };
      case 'whatsapp':
        return { whatsapp_meta: buildChannelMeta(sender) };
    }
  })();

  // multi_turn reflects ANY multi-turn activity — contact-capture
  // follow-ups OR discovery follow-ups. follow_up_count rolls up both
  // phases so the lawyer's audit blob shows the total turn count
  // regardless of which phase consumed them. Phase A tracking lives in
  // `priorFollowUpCount` (session column); Phase C tracking lives in
  // `discoveryFollowUpCount` (engine state).
  const discoveryTotal = state.discoveryFollowUpCount ?? 0;
  const totalFollowUps = priorFollowUpCount + discoveryTotal;
  const wasMultiTurn = isResume || totalFollowUps > 0;

  const slotAnswers = {
    slots: state.slots,
    slot_meta: state.slot_meta,
    slot_evidence: state.slot_evidence,
    channel,
    multi_turn: wasMultiTurn,
    follow_up_count: totalFollowUps,
    ...channelMetaForSlotAnswers,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('screened_leads')
    .insert({
      lead_id: state.lead_id,
      firm_id: firmId,
      screen_version: 2,
      status: initialStatus,
      status_changed_by: initialChangedBy,
      // APP-006 (Manico audit): record the actor TYPE separately from the
      // free-text actor identifier. 'system' for all channel intakes since
      // no human triggers the row creation — Meta's webhook does.
      status_changed_by_role: 'system',
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
      contact_name: state.slots['client_name'] ?? sender.senderName ?? null,
      contact_email: state.slots['client_email'] ?? null,
      contact_phone:
        state.slots['client_phone'] ??
        (sender.channel === 'whatsapp' ? `+${sender.senderWaId.replace(/^\+/, '')}` : null),
      submitted_at: state.submitted_at ?? now.toISOString(),
      intake_language: state.language ?? 'en',
      raw_transcript: state.input ?? trimmed,
    })
    .select('id, lead_id, status, decision_deadline, whale_nurture')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Duplicate lead_id — engine generator collided. Treat as idempotent.
      if (sessionId) await finalizeChannelSession(sessionId);
      return {
        persisted: false,
        reason: 'duplicate lead_id',
        leadId: state.lead_id,
      };
    }
    return {
      persisted: false,
      reason: `insert failed: ${insertErr.message}`,
    };
  }

  // Finalise the multi-turn session if one was open. PASS the
  // screened_leads.id so the row is tagged as "this finalization
  // produced a real brief." The post-finalization secretary mode
  // (DR-104) gates on screened_lead_id IS NOT NULL — without this
  // link, the abandoned-session paths above would be indistinguishable
  // from the successful path, and a returning lead from an abandoned
  // session would falsely be told a lawyer is reviewing their matter.
  if (sessionId) {
    await finalizeChannelSession(sessionId, inserted.id as string);
  }

  // ── Lead notification (best-effort) ────────────────────────────────────
  // Doctrine (2026-05-15): "The engine sorts attention, the lawyer decides
  // outcome." OOS leads now carry band='D' and status='triaging'; the
  // notification still fires so the lawyer sees the matter and can Refer /
  // Take / Pass. The decline-with-grace GHL cadence only fires on lawyer-
  // initiated Pass (or the deadline backstop), no longer at intake.
  if (inserted.status === 'triaging' || inserted.status === 'declined') {
    await notifyLawyersOfNewLead({
      firmId,
      leadId: inserted.lead_id as string,
      contactName: state.slots['client_name'] ?? sender.senderName ?? null,
      matterType: state.matter_type,
      practiceArea: state.practice_area,
      band,
      decisionDeadlineIso: inserted.decision_deadline as string,
      whaleNurture: !!inserted.whale_nurture,
      intakeLanguage: state.language ?? 'en',
      channel: sender.channel,
      lifecycleStatus: inserted.status as 'triaging' | 'declined',
    }).catch((err) => {
      console.error('[channel-intake] notifyLawyersOfNewLead failed:', err);
    });
  }

  // ── Closing acknowledgment (best-effort) ───────────────────────────────
  // The lead is saved; surface a 1-2 sentence confirmation on the same
  // channel so the conversation closes cleanly. This is what fires the
  // first outbound `pages_messaging` / `whatsapp_business_messaging` /
  // `instagram_basic` Send API call on single-turn intakes — App Review
  // needs to see this exercised. Channel-aware: web and voice return
  // empty (web has its own done page; voice closes verbally).
  //
  // Failure here MUST NOT unwind the persist. The brief is already in
  // screened_leads and the lawyer notification has already been queued.
  try {
    const closing = buildClosingMessage(state);
    if (closing) {
      const sendResult = await sendChannelMessage({
        firmId,
        sender,
        text: closing,
      });
      if (!sendResult.sent) {
        console.warn(
          `[channel-intake] closing message send failed firm=${firmId} channel=${channel}: ${sendResult.reason ?? 'unknown'}`,
        );
      }
    }
  } catch (err) {
    console.warn('[channel-intake] closing message dispatch failed:', err);
  }

  return {
    persisted: true,
    leadId: inserted.lead_id as string,
    briefId: inserted.id as string,
    status: inserted.status as 'triaging' | 'declined',
    band,
  };
}
