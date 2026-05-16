/**
 * channel-intake-processor — shared server-side engine pipeline for
 * inbound Meta channel webhooks (Messenger, Instagram, WhatsApp Cloud API).
 *
 * Two-phase architecture:
 *
 *   Phase A: contact-capture doctrine gate (2026-05-15). After running
 *            the engine, check `report.contact_complete`. If false, the
 *            row is NOT a screened lead — never reaches the lawyer.
 *
 *   Phase B: multi-turn follow-up. When the gate fails, send a follow-up
 *            via the channel's Send API asking for name + contact, and
 *            persist EngineState in `channel_intake_sessions` so the
 *            NEXT inbound from the same sender resumes mid-conversation.
 *            After `MAX_FOLLOW_UPS` attempts without contact, give up
 *            and move the data to `unconfirmed_inquiries`.
 *
 * Voice keeps its own route (`/api/voice-intake`) because it carries
 * non-Meta metadata (call_id, recording_url, call_duration_sec).
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
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
import { llmExtractServer } from '@/lib/screen-llm-server';
import { renderBriefHtmlServer } from '@/lib/screen-brief-html';
import type { EngineState, Band } from '@/lib/screen-engine/types';
import { evaluateContactGate } from '@/lib/screen-engine/contact-doctrine';
import { buildClosingMessage } from '@/lib/screen-engine/closing';
import { persistUnconfirmedInquiry } from '@/lib/unconfirmed-inquiry';
import {
  loadOpenChannelSession,
  createChannelSession,
  updateChannelSession,
  finalizeChannelSession,
} from '@/lib/channel-intake-session-store';
import { sendChannelMessage, buildContactCaptureFollowUp } from '@/lib/channel-send';

// ── Channel type ────────────────────────────────────────────────────────

export type MetaChannel = 'facebook' | 'instagram' | 'whatsapp';

const MAX_FOLLOW_UPS = 3;

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
  }

  // Evidence pass — regex deepening on the NEW turn text. Slot
  // extraction layer; does not re-classify matter_type / practice_area
  // (those are owned by initialiseState on turn 1 and preserved on resume).
  state = runEvidencePass(trimmed, state);

  // LLM extraction — best-effort, never aborts. Runs on the new turn text
  // and merges into existing state. On a resume turn, the LLM sees just
  // the new text; on first turn it sees the full inbound. The doctrine
  // rule in the system prompt (rule 9) primes the LLM to extract
  // client_name / client_email / client_phone aggressively.
  if (state.matter_type !== 'out_of_scope') {
    try {
      const llm = await llmExtractServer(trimmed, state);
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

  // ── Build the brief ─────────────────────────────────────────────────────
  const report = buildReport(state);
  const briefHtml = renderBriefHtmlServer(report, channel, state.language);
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
    if (priorFollowUpCount >= MAX_FOLLOW_UPS) {
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

  // ── Gate passed: finalise into screened_leads ──────────────────────────
  const now = new Date();
  const axes = report.four_axis;
  const decisionDeadline = computeDecisionDeadline(axes.urgency, now, state.matter_type);
  const whaleNurture = computeWhaleNurture(axes.value, axes.readiness);
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

  const slotAnswers = {
    slots: state.slots,
    slot_meta: state.slot_meta,
    slot_evidence: state.slot_evidence,
    channel,
    multi_turn: isResume,
    follow_up_count: priorFollowUpCount,
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

  // Finalise the multi-turn session if one was open.
  if (sessionId) {
    await finalizeChannelSession(sessionId);
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
