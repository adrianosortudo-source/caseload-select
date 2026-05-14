/**
 * channel-intake-processor — shared server-side engine pipeline for
 * inbound Meta channel webhooks (Messenger, Instagram, WhatsApp Cloud API).
 *
 * The voice-intake route at /api/voice-intake established the pattern for
 * running the screen engine server-side: initialiseState → seed sender →
 * evidence pass → LLM extraction → buildReport → render brief HTML → insert
 * into `screened_leads`. This helper extracts that pipeline so all three
 * Meta channels (and voice, in a future refactor) call ONE function instead
 * of repeating ~250 lines of glue per route.
 *
 * What this does NOT do:
 *
 *   - Verify HMAC. Each Meta channel uses the same `x-hub-signature-256`
 *     header signed with `META_APP_SECRET`, but verification happens at the
 *     route boundary BEFORE the body is parsed. See `lib/meta-webhook-auth`.
 *   - Resolve firm. Caller passes `firmId`; resolution happens at the route
 *     boundary via `lib/firm-resolver`. Different channels carry different
 *     asset IDs (Page ID vs IG Business ID vs Phone Number ID); the resolver
 *     hides that detail from this processor.
 *   - Dedup. Meta retries on non-200; if the route ACKs 200 quickly (within
 *     ~1-2s) and runs this in `waitUntil`, retries are rare. A future patch
 *     can add a `(channel, message_id)` dedup table; for now, double-fires
 *     could produce duplicate `screened_leads` rows. Documented in the
 *     receiver TODOs.
 *   - Send-back. The engine currently produces a brief from a SINGLE inbound
 *     message (single-shot mode). Multi-turn conversational follow-up via
 *     Meta's Send APIs is out of scope for the Meta App Review demo and
 *     lands in a follow-up patch (`channel-send.ts`).
 *
 * Channel naming follows the engine's `Channel` type (defined in
 * `lib/screen-engine/types`): `facebook` | `instagram` | `whatsapp`. The
 * longer CRM-Bible DR-022 surface names (facebook_messenger,
 * instagram_dm) are NOT used here because the engine and the brief
 * renderer expect the compact names. Persistence in screened_leads
 * uses the same compact form (consistent with voice-intake's `channel:
 * 'voice'`).
 *
 * Voice keeps its own route for now because it carries non-Meta metadata
 * — call_id, recording_url, call_duration_sec — that doesn't generalise.
 * A future refactor can fold voice into this helper too.
 */

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
import { OOS_AREA_LABELS } from '@/lib/oos-area-labels';
import { initialiseState } from '@/lib/screen-engine/extractor';
import { runEvidencePass } from '@/lib/screen-engine/slotEvidence';
import { mergeLlmResults } from '@/lib/screen-engine/llm/extractor';
import { buildReport } from '@/lib/screen-engine/report';
import { computeBand } from '@/lib/screen-engine/band';
import { llmExtractServer } from '@/lib/screen-llm-server';
import { renderBriefHtmlServer } from '@/lib/screen-brief-html';
import type { EngineState, Band } from '@/lib/screen-engine/types';

// ── Channel type ────────────────────────────────────────────────────────
// Matches the engine's `Channel` type (lib/screen-engine/types). The
// `Channel` union also has 'web' | 'sms' | 'gbp' | 'voice' — those are
// handled elsewhere; the Meta channels are this helper's scope.

export type MetaChannel = 'facebook' | 'instagram' | 'whatsapp';

// ── Sender metadata ─────────────────────────────────────────────────────
// Channel-specific shape so callers cannot drop a Messenger PSID into a
// WhatsApp field by accident. The processor only USES the universal bits
// (senderId, senderName, phone if present) but keeping the discriminator
// preserves channel context in logs and persisted JSON.

export interface MessengerSender {
  channel: 'facebook';
  /** PSID — Page-Scoped ID. Stable per (Page, user) pair. */
  senderPsid: string;
  /** Set if we have a profile-API result; usually null without an extra call. */
  senderName: string | null;
  /** Messenger message ID, for future dedup. */
  messageMid: string;
  /** Page ID the user messaged. */
  pageId: string;
}

export interface InstagramSender {
  channel: 'instagram';
  /** IG-scoped sender ID. Stable per (IG account, user) pair. */
  senderIgsid: string;
  senderName: string | null;
  messageMid: string;
  /** IG Business Account ID the user DM'd. */
  igBusinessAccountId: string;
}

export interface WhatsAppSender {
  channel: 'whatsapp';
  /** wa_id — Meta-side identifier for the WhatsApp user (E.164-like). */
  senderWaId: string;
  /** WhatsApp profile name if the contacts[] block carried it. */
  senderName: string | null;
  /** WhatsApp message ID, for future dedup. */
  messageMid: string;
  /** WhatsApp Cloud API Phone Number ID the user texted. */
  phoneNumberId: string;
  /** Display phone number (humans-readable) if known. */
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
  /** L-YYYY-MM-DD-XXX engine identifier (if a row was created). */
  leadId?: string;
  /** screened_leads.id (uuid PK). */
  briefId?: string;
  status?: 'triaging' | 'declined';
  band?: Band | null;
  /** Set when persisted=false. */
  reason?: string;
}

// ── Channel-specific seeding ────────────────────────────────────────────

/**
 * Drop sender contact fields into the engine state's slots so the brief
 * shows them. Mirrors the seedVoiceState() helper in /api/voice-intake.
 *
 * Messenger / IG do not carry a phone number on inbound DMs. WhatsApp
 * carries the sender's `wa_id` which IS the phone number in E.164 form
 * (without the leading +).
 */
function seedSlots(state: EngineState, sender: ChannelSender): EngineState {
  let s = state;

  // Name — only set if we have one AND the slot is empty.
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

  // Phone — only WhatsApp carries one inbound. wa_id is the digits, no '+'.
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
 * Run the screen engine on an inbound channel message and persist the result.
 *
 * Returns a structured result rather than an HTTP response so the caller
 * (the route handler) can wrap the call in `waitUntil` and ACK 200 to Meta
 * before this finishes. Meta requires a fast 200; the engine pipeline
 * (especially the LLM call) takes 5-15s.
 *
 * Channel processor is best-effort: if the LLM extraction fails the brief
 * is still built from regex-extracted slots, and the row still lands. The
 * only failure path that bails is a DB insert error (returned in result).
 */
export async function processChannelInbound(
  args: ProcessChannelInboundArgs,
): Promise<ProcessChannelInboundResult> {
  const { firmId, text, sender } = args;
  const channel = sender.channel;
  const trimmed = text.trim();

  if (!trimmed) {
    return { persisted: false, reason: 'empty inbound text' };
  }

  // ── Engine pipeline (parity with /api/voice-intake) ────────────────────

  // 1. Regex classification + raw signals.
  let state = initialiseState(trimmed);

  // 2. Stamp the channel BEFORE anything reads state.channel.
  state = { ...state, channel };

  // 3. Seed slots from sender metadata.
  state = seedSlots(state, sender);

  // 4. Evidence pass (regex deepening).
  state = runEvidencePass(trimmed, state);

  // 5. LLM extraction — best-effort, never aborts.
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
  const band: Band | null = state.matter_type === 'out_of_scope' ? null : bandResult.band;

  // ── Derived flags (same helpers as intake-v2 + voice-intake) ───────────
  const now = new Date();
  const axes = report.four_axis;
  const decisionDeadline = computeDecisionDeadline(axes.urgency, now);
  const whaleNurture = computeWhaleNurture(axes.value, axes.readiness);
  const { status: initialStatus, changedBy: initialChangedBy } =
    computeInitialStatus(state.matter_type);

  // ── Channel-specific meta for slot_answers (audit, future re-render) ───
  const channelMeta = (() => {
    switch (sender.channel) {
      case 'facebook':
        return {
          messenger_meta: {
            page_id: sender.pageId,
            sender_psid: sender.senderPsid,
            message_mid: sender.messageMid,
            sender_name: sender.senderName,
          },
        };
      case 'instagram':
        return {
          instagram_meta: {
            ig_business_account_id: sender.igBusinessAccountId,
            sender_igsid: sender.senderIgsid,
            message_mid: sender.messageMid,
            sender_name: sender.senderName,
          },
        };
      case 'whatsapp':
        return {
          whatsapp_meta: {
            phone_number_id: sender.phoneNumberId,
            sender_wa_id: sender.senderWaId,
            message_mid: sender.messageMid,
            sender_name: sender.senderName,
            display_phone_number: sender.displayPhoneNumber ?? null,
          },
        };
    }
  })();

  // ── Insert into screened_leads ─────────────────────────────────────────
  const slotAnswers = {
    slots: state.slots,
    slot_meta: state.slot_meta,
    slot_evidence: state.slot_evidence,
    channel,
    ...channelMeta,
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
      raw_transcript: trimmed,
    })
    .select('id, lead_id, status, decision_deadline, whale_nurture')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Duplicate lead_id — engine generator collided. Treat as idempotent.
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

  // ── OOS auto-decline webhook (parity with /api/intake-v2, voice-intake) ─
  // Fired AFTER insert succeeds so the webhook never goes out for a row
  // that did not land. Same payload shape so GHL workflows downstream
  // process channel-sourced OOS identically to web/voice OOS.
  if (state.matter_type === 'out_of_scope') {
    try {
      const practiceArea = state.practice_area;
      const candidates = await loadDeclineCandidates({
        firmId,
        practiceArea,
        perLeadOverride: null,
      });
      const areaLabel = OOS_AREA_LABELS[practiceArea] ?? 'this practice area';
      const verdict = resolveDecline(candidates, 'oos', areaLabel);

      const facts: LeadFacts = {
        lead_id: state.lead_id,
        firm_id: firmId,
        band: null,
        matter_type: state.matter_type,
        practice_area: practiceArea,
        submitted_at: state.submitted_at ?? now.toISOString(),
        contact_name: state.slots['client_name'] ?? sender.senderName ?? null,
        contact_email: state.slots['client_email'] ?? null,
        contact_phone:
          state.slots['client_phone'] ??
          (sender.channel === 'whatsapp'
            ? `+${sender.senderWaId.replace(/^\+/, '')}`
            : null),
        intake_language: state.language ?? 'en',
      };
      const payload = buildDeclinedOosPayload({
        facts,
        statusChangedAt: now,
        declineSubject: verdict.subject,
        declineBody: verdict.body,
        declineSource: verdict.source,
        detectedAreaLabel: areaLabel,
      });
      // Fire-and-forget. Logged in webhook_outbox; never surfaced to Meta.
      // No waitUntil here: the caller already wraps processChannelInbound in
      // waitUntil at the route boundary, so this nested promise is awaited
      // by the same outer waitUntil.
      await fireGhlWebhook(firmId, payload).catch((err) => {
        console.error('[channel-intake] declined_oos webhook failed:', err);
      });
    } catch (err) {
      console.error('[channel-intake] declined_oos resolution failed:', err);
    }
  }

  // ── Lead notification (best-effort) ────────────────────────────────────
  // Doctrine (2026-05-14): "The system filters attention, never visibility."
  // Both 'triaging' and 'declined' notify the lawyer. Subject + body copy
  // differ so the lawyer's inbox makes the distinction obvious without
  // forcing them to open every auto-filtered message. See
  // `lib/lead-notify-pure.ts` for the rendering split.
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
      lifecycleStatus: inserted.status as 'triaging' | 'declined',
    }).catch((err) => {
      console.error('[channel-intake] notifyLawyersOfNewLead failed:', err);
    });
  }

  return {
    persisted: true,
    leadId: inserted.lead_id as string,
    briefId: inserted.id as string,
    status: inserted.status as 'triaging' | 'declined',
    band,
  };
}
