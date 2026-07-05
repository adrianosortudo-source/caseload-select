/**
 * Cadence real-send dispatch path. DORMANT.
 *
 * This module exists so the flip from shadow to real sends has somewhere to
 * land later, per CaseLoad_CRM_Migration_Plan_v1.md Phase 2 (diff first,
 * cut second). It is built and tested now; nothing in this sprint enables it.
 *
 * Three independent gates, all must pass:
 *   1. intake_firms.cadence_real_send = true for the firm (per-firm opt-in,
 *      defaults false, never flipped in this sprint).
 *   2. process.env.CADENCE_REAL_SEND_ENABLED === 'true' (global kill switch;
 *      this env var is never added to Vercel in this sprint, so gate 2 alone
 *      keeps the whole path inert regardless of gate 1).
 *   3. The lead's CASL consent, evaluated again at dispatch time via
 *      comms-gate.ts (defense in depth: a row already carries a consent
 *      verdict from write time, but consent can be withdrawn between write
 *      and dispatch).
 *
 * cadence-runner.ts checks gate 1 (and calls isRealSendEnabledForFirm, which
 * also checks gate 2) to decide whether a ledger row is written as
 * shadow=true/status=shadow_logged (today, always) or shadow=false/
 * status=scheduled (only if some future operator flips both gates). This
 * module is what would actually dispatch a shadow=false/status=scheduled row;
 * today no such row can ever exist, so dispatchScheduledCadenceMessages always
 * finds nothing to do.
 *
 * Deliverability cap: no more than MAX_SENDS_PER_SUBJECT_PER_DAY real sends to
 * the same matter/lead in a rolling 24h window, per the plan's failure-mode
 * gate on cadence spam (synthesis Section 9, Hudlow/Yildirim).
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sendEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms-dispatch';
import { isConsentGated, type LeadConsentState, type CommChannel } from '@/lib/comms-gate';

export const MAX_SENDS_PER_SUBJECT_PER_DAY = 3;

/**
 * The global kill switch. Checked independently of the per-firm flag so a
 * misconfigured firm row can never cause a real send on its own.
 */
export function isRealSendGloballyEnabled(): boolean {
  return process.env.CADENCE_REAL_SEND_ENABLED === 'true';
}

/**
 * Both gates a firm must clear before the runner writes a dispatchable
 * (non-shadow) ledger row for it.
 */
export function isRealSendEnabledForFirm(firmCadenceRealSend: boolean): boolean {
  return firmCadenceRealSend === true && isRealSendGloballyEnabled();
}

/**
 * Whether one more send to this subject today would exceed the deliverability
 * cap. `sentTodayCount` is the count of 'sent' outbound_messages rows for the
 * same matter_id or screened_lead_id in the last 24h.
 */
export function exceedsDeliverabilityCap(sentTodayCount: number): boolean {
  return sentTodayCount >= MAX_SENDS_PER_SUBJECT_PER_DAY;
}

interface ScheduledMessageRow {
  id: string;
  firm_id: string;
  matter_id: string | null;
  screened_lead_id: string | null;
  channel: 'email' | 'sms';
  recipient_email: string | null;
  subject: string | null;
  body: string | null;
}

interface LeadConsentRow {
  id: string;
  contact_phone: string | null;
  email_consent_status: string | null;
  sms_consent_status: string | null;
  six_month_expiry_date: string | null;
}

export interface DispatchSummary {
  ok: boolean;
  attempted: boolean; // false when the global gate is closed (the normal state today)
  sent: number;
  failed: number;
  capped: number;
  blocked: number;
}

const GATE_CLOSED_SUMMARY: DispatchSummary = {
  ok: true, attempted: false, sent: 0, failed: 0, capped: 0, blocked: 0,
};

/**
 * Dispatches due, real-send-eligible outbound_messages rows.
 *
 * Short-circuits immediately (attempted: false) unless the global env gate is
 * open. This is the outermost gate: even if a firm's cadence_real_send flag
 * were mistakenly true, nothing sends without the env var, which this sprint
 * never adds to Vercel.
 */
export async function dispatchScheduledCadenceMessages(
  opts: { now?: Date } = {},
): Promise<DispatchSummary> {
  if (!isRealSendGloballyEnabled()) return GATE_CLOSED_SUMMARY;

  const now = opts.now ?? new Date();
  const summary: DispatchSummary = { ok: true, attempted: true, sent: 0, failed: 0, capped: 0, blocked: 0 };

  const { data: rows, error } = await supabase
    .from('outbound_messages')
    .select('id, firm_id, matter_id, screened_lead_id, channel, recipient_email, subject, body')
    .eq('shadow', false)
    .eq('status', 'scheduled')
    .limit(500);
  if (error) return { ...summary, ok: false };

  const messages = (rows ?? []) as ScheduledMessageRow[];
  if (messages.length === 0) return summary;

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  for (const msg of messages) {
    const subjectKey = msg.matter_id ?? msg.screened_lead_id;
    if (subjectKey) {
      const { count } = await supabase
        .from('outbound_messages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gte('sent_at', dayAgo)
        .eq(msg.matter_id ? 'matter_id' : 'screened_lead_id', subjectKey);
      if (exceedsDeliverabilityCap(count ?? 0)) {
        summary.capped += 1;
        await supabase.from('outbound_messages').update({ status: 'failed' }).eq('id', msg.id);
        continue;
      }
    }

    if (!msg.screened_lead_id) {
      summary.blocked += 1;
      continue;
    }
    const { data: lead } = await supabase
      .from('screened_leads')
      .select('id, contact_phone, email_consent_status, sms_consent_status, six_month_expiry_date')
      .eq('id', msg.screened_lead_id)
      .maybeSingle();
    const consentState: LeadConsentState = {
      email_consent_status: ((lead as LeadConsentRow | null)?.email_consent_status ?? null) as LeadConsentState['email_consent_status'],
      sms_consent_status: ((lead as LeadConsentRow | null)?.sms_consent_status ?? null) as LeadConsentState['sms_consent_status'],
      six_month_expiry_date: (lead as LeadConsentRow | null)?.six_month_expiry_date ?? null,
    };
    const channel: CommChannel = msg.channel;
    if (!isConsentGated(consentState, channel, now)) {
      summary.blocked += 1;
      await supabase.from('outbound_messages').update({ status: 'failed' }).eq('id', msg.id);
      continue;
    }

    try {
      if (channel === 'sms') {
        const phone = (lead as LeadConsentRow | null)?.contact_phone;
        if (!phone) {
          summary.blocked += 1;
          await supabase.from('outbound_messages').update({ status: 'failed' }).eq('id', msg.id);
          continue;
        }
        await sendSms(phone, msg.body ?? '');
      } else {
        if (!msg.recipient_email) {
          summary.blocked += 1;
          await supabase.from('outbound_messages').update({ status: 'failed' }).eq('id', msg.id);
          continue;
        }
        await sendEmail(msg.recipient_email, msg.subject ?? '', msg.body ?? '');
      }
      summary.sent += 1;
      await supabase.from('outbound_messages').update({ status: 'sent', sent_at: now.toISOString() }).eq('id', msg.id);
    } catch {
      summary.failed += 1;
      await supabase.from('outbound_messages').update({ status: 'failed' }).eq('id', msg.id);
    }
  }

  return summary;
}
