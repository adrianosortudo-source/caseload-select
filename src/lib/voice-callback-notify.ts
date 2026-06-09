import 'server-only';

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sendEmail } from '@/lib/email';
import {
  buildUnconfirmedVoiceEmail,
  buildVoiceCallbackEmail,
  type VoiceCallbackNotifyArgs,
  type UnconfirmedVoiceNotifyArgs,
  type OperatorEmailResult,
} from '@/lib/voice-callback-notify-pure';
import { buildLlmDisabledAlertEmail, type LlmDisabledAlertArgs } from '@/lib/llm-health-alert';

const FALLBACK_OPERATOR_EMAIL = 'adriano@caseloadselect.ca';

// Re-exported so existing consumers (route, tests) can keep importing the
// args type from this module after the builder moved to the pure file (#175).
export type { VoiceCallbackNotifyArgs } from '@/lib/voice-callback-notify-pure';

export interface VoiceCallbackNotifyResult {
  email: 'sent' | 'skipped' | 'error';
  sms: 'sent' | 'skipped' | 'error';
  errors: string[];
}

function resolveOperatorEmail(): string {
  return process.env.OPERATOR_NOTIFICATION_EMAIL || FALLBACK_OPERATOR_EMAIL;
}

async function sendUrgentSms(args: VoiceCallbackNotifyArgs): Promise<'sent' | 'skipped' | 'error'> {
  if (args.urgency !== 'urgent') return 'skipped';
  const webhook = process.env.OPERATOR_URGENT_SMS_WEBHOOK_URL;
  if (!webhook) return 'skipped';
  const text = `URGENT voice callback (${args.branch}) from ${args.callerName || 'unknown'} ${args.callerPhone || ''}: ${args.message.slice(0, 180)}`;
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: process.env.OPERATOR_URGENT_SMS_TO || null,
        text,
        request_id: args.id,
        firm_id: args.firmId,
      }),
    });
    return res.ok ? 'sent' : 'error';
  } catch {
    return 'error';
  }
}

export async function notifyOperatorOfVoiceCallback(
  args: VoiceCallbackNotifyArgs,
): Promise<VoiceCallbackNotifyResult> {
  const result: VoiceCallbackNotifyResult = { email: 'skipped', sms: 'skipped', errors: [] };
  const email = buildVoiceCallbackEmail(args);

  try {
    const dispatch = await sendEmail(resolveOperatorEmail(), email.subject, email.html);
    result.email = dispatch.skipped ? 'skipped' : 'sent';
  } catch (err) {
    result.email = 'error';
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  result.sms = await sendUrgentSms(args);
  if (result.sms === 'error') result.errors.push('urgent SMS dispatch failed');

  if (result.email === 'sent' || result.sms === 'sent') {
    const { error } = await supabase
      .from('voice_callback_requests')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', args.id);
    if (error) result.errors.push(`notified_at update failed: ${error.message}`);
  }

  return result;
}

// ── Unconfirmed voice intake (#125) ──────────────────────────────────────────
// A caller reached the voice line but the contact-capture gate rejected the
// intake: the brief had no name and no reachable contact, so it landed in
// unconfirmed_inquiries instead of the lawyer triage queue. On every other
// channel the engine can re-ask (multi-turn follow-up); on voice the call is
// already over. Without an alert the inbound call vanishes silently, which for
// a firm measured on signed cases is the worst failure mode. This notifies the
// operator so they can listen to the recording and call back manually.
//
// The email builder + arg/result types are pure (no I/O) and live in
// voice-callback-notify-pure.ts so they can be unit-tested without the
// server-only / Resend dependency. This is the I/O wrapper.

export async function notifyOperatorOfUnconfirmedVoiceIntake(
  args: UnconfirmedVoiceNotifyArgs,
): Promise<OperatorEmailResult> {
  const result: OperatorEmailResult = { email: 'skipped', errors: [] };
  const email = buildUnconfirmedVoiceEmail(args);

  try {
    const dispatch = await sendEmail(resolveOperatorEmail(), email.subject, email.html);
    result.email = dispatch.skipped ? 'skipped' : 'sent';
  } catch (err) {
    result.email = 'error';
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

// ── LLM extraction disabled (#128) ───────────────────────────────────────────
// Operator alert when llmExtractServer returns mode=disabled (GEMINI_API_KEY
// missing/invalid). The cooldown decision + email body are pure
// (lib/llm-health-alert.ts); this is the I/O wrapper. The caller is responsible
// for the suppression-window check and for stamping
// intake_firms.gemini_disabled_alert_sent_at after a successful send.

export async function notifyOperatorOfLlmDisabled(
  args: LlmDisabledAlertArgs,
): Promise<OperatorEmailResult> {
  const result: OperatorEmailResult = { email: 'skipped', errors: [] };
  const email = buildLlmDisabledAlertEmail(args);

  try {
    const dispatch = await sendEmail(resolveOperatorEmail(), email.subject, email.html);
    result.email = dispatch.skipped ? 'skipped' : 'sent';
  } catch (err) {
    result.email = 'error';
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}
