import 'server-only';

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sendEmail } from '@/lib/email';
import type { VoiceCallbackBranch, VoiceUrgency } from '@/lib/voice-branch-classifier';

const FALLBACK_OPERATOR_EMAIL = 'adriano@caseloadselect.ca';

export interface VoiceCallbackNotifyArgs {
  id: string;
  firmId: string;
  branch: VoiceCallbackBranch;
  urgency: VoiceUrgency;
  callerName: string | null;
  callerPhone: string | null;
  organization: string | null;
  message: string;
  callId: string | null;
  operatorReview: boolean;
  reason: string;
}

export interface VoiceCallbackNotifyResult {
  email: 'sent' | 'skipped' | 'error';
  sms: 'sent' | 'skipped' | 'error';
  errors: string[];
}

function resolveOperatorEmail(): string {
  return process.env.OPERATOR_NOTIFICATION_EMAIL || FALLBACK_OPERATOR_EMAIL;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function branchLabel(branch: VoiceCallbackBranch): string {
  return branch
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildEmail(args: VoiceCallbackNotifyArgs): { subject: string; html: string } {
  const urgentPrefix = args.urgency === 'urgent' ? 'URGENT: ' : '';
  const subject = `${urgentPrefix}Voice callback: ${branchLabel(args.branch)}`;
  const rows: Array<[string, string | null]> = [
    ['Firm ID', args.firmId],
    ['Request ID', args.id],
    ['Branch', args.branch],
    ['Urgency', args.urgency],
    ['Operator review', args.operatorReview ? 'yes' : 'no'],
    ['Reason', args.reason],
    ['Caller name', args.callerName],
    ['Caller phone', args.callerPhone],
    ['Organization', args.organization],
    ['Call ID', args.callId],
  ];

  const rowHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 10px;color:#666;">${htmlEscape(label)}</td><td style="padding:6px 10px;"><strong>${htmlEscape(value || 'Not provided')}</strong></td></tr>`,
    )
    .join('');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
      <h2 style="margin:0 0 12px;">${htmlEscape(subject)}</h2>
      <p style="margin:0 0 12px;">This is an operator-only callback request. It is not in the lawyer lead queue.</p>
      <table style="border-collapse:collapse;margin:0 0 16px;">${rowHtml}</table>
      <h3 style="margin:16px 0 8px;">Message</h3>
      <p style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:12px;">${htmlEscape(args.message || 'No message captured.')}</p>
    </div>
  `;
  return { subject, html };
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
  const email = buildEmail(args);

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
