/**
 * Pure (I/O-free) builders for the voice operator notifications.
 *
 * Split out from `voice-callback-notify.ts` so the email composition logic can
 * be unit-tested directly. The I/O wrapper (`voice-callback-notify.ts`) carries
 * the `server-only` import + Resend/Supabase calls; this module is pure and
 * safe to import under vitest's node environment. Mirrors the
 * `lead-notify-pure.ts` / `lead-notify.ts` split convention.
 */

import type { VoiceCallbackBranch, VoiceUrgency } from '@/lib/voice-branch-classifier';

export function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Unconfirmed voice intake (#125) ──────────────────────────────────────────

export interface UnconfirmedVoiceNotifyArgs {
  /** unconfirmed_inquiries row id, when the insert succeeded. */
  inquiryId: string | null;
  firmId: string;
  callId: string | null;
  callerName: string | null;
  /** Provenance of callerName (#175). Defaults to 'caller_id_only' if unset by an older caller. */
  callerNameSource?: VoiceNameSource;
  callerPhone: string | null;
  callerPhoneSource: 'body' | 'voice-ai-api' | 'none';
  recordingUrl: string | null;
  callDurationSec: number | null;
  matterType: string | null;
  practiceArea: string | null;
  intakeLanguage: string | null;
  reason: string;
  transcript: string | null;
}

export interface OperatorEmailResult {
  email: 'sent' | 'skipped' | 'error';
  errors: string[];
}

const TRANSCRIPT_LIMIT = 1200;

export const PHONE_SOURCE_LABEL: Record<UnconfirmedVoiceNotifyArgs['callerPhoneSource'], string> = {
  body: 'from the call (caller ID)',
  'voice-ai-api': 'from the call (caller ID)',
  none: 'not captured',
};

/**
 * Provenance of the caller NAME on a voice operator alert (#175).
 *
 * Reachability (the phone) and identity (the name) are separate certainties.
 * The phone is carrier-provided caller ID. The name may be carrier / contact-
 * record metadata that the caller never actually said. The wrong-number
 * callback email was presenting a metadata-derived name as a flat fact; this
 * taxonomy makes the email tell the truth.
 *
 *  - 'stated_on_call'  the caller spoke the name (or affirmed a readback); the
 *                      engine recorded a user-grounded slot source.
 *  - 'caller_id_only'  from caller ID / contact record; the caller did NOT
 *                      state it on this call (e.g. a wrong-number call where
 *                      the agent short-circuits before any name ask, or a
 *                      metadata-only seed).
 *  - 'unverified'      from the call or caller ID, not verified by the firm
 *                      (callback branches other than wrong-number, where the
 *                      agent may have asked but nothing confirms it).
 *  - 'none'            no name at all.
 */
export type VoiceNameSource = 'stated_on_call' | 'caller_id_only' | 'unverified' | 'none';

export const NAME_SOURCE_LABEL: Record<VoiceNameSource, string> = {
  stated_on_call: 'stated on the call',
  caller_id_only: 'from caller ID, the caller did not state a name on this call',
  unverified: 'from the call or caller ID, not verified by the firm',
  none: '',
};

export function describeMissingContact(
  callerName: string | null,
  callerPhone: string | null,
): string {
  const missing: string[] = [];
  if (!callerName) missing.push('the caller name');
  if (!callerPhone) missing.push('a callback number');
  if (missing.length === 0) return 'contact details could not be confirmed';
  return `missing ${missing.join(' and ')}`;
}

export function buildUnconfirmedVoiceEmail(args: UnconfirmedVoiceNotifyArgs): {
  subject: string;
  html: string;
} {
  const phoneSuffix = args.callerPhone ? ` (${htmlEscape(args.callerPhone)})` : '';
  const subject = `Voice intake needs follow-up${args.callerPhone ? ` — ${args.callerPhone}` : ''}`;
  const missing = describeMissingContact(args.callerName, args.callerPhone);

  const nextAction = args.callerPhone
    ? `Caller ID captured a number${phoneSuffix}. Call back to complete the intake.`
    : args.recordingUrl
      ? 'No callback number was captured. Listen to the recording for a way to reach the caller.'
      : 'No callback number and no recording were captured. This inbound call cannot be recovered automatically.';

  const durationLabel = args.callDurationSec != null ? `${args.callDurationSec}s` : null;

  const nameSource: VoiceNameSource = args.callerNameSource ?? 'caller_id_only';
  const nameSourceLabel =
    args.callerName && nameSource !== 'none' ? NAME_SOURCE_LABEL[nameSource] : null;

  const rows: Array<[string, string | null]> = [
    ['Firm ID', args.firmId],
    ['Inquiry ID', args.inquiryId],
    ['Reason', args.reason],
    ['What is missing', missing],
    ['Caller name', args.callerName],
    ['Name source', nameSourceLabel],
    ['Caller phone', args.callerPhone],
    ['Phone source', PHONE_SOURCE_LABEL[args.callerPhoneSource]],
    ['Likely matter', args.matterType],
    ['Likely practice area', args.practiceArea],
    ['Language', args.intakeLanguage],
    ['Call ID', args.callId],
    ['Call duration', durationLabel],
  ];

  const rowHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 10px;color:#666;">${htmlEscape(label)}</td><td style="padding:6px 10px;"><strong>${htmlEscape(value || 'Not provided')}</strong></td></tr>`,
    )
    .join('');

  const recordingHtml = args.recordingUrl
    ? `<p style="margin:0 0 12px;"><a href="${htmlEscape(args.recordingUrl)}" style="color:#1E2F58;">Listen to the call recording</a></p>`
    : '';

  const fullTranscript = (args.transcript ?? '').trim();
  const transcriptSnippet = fullTranscript.slice(0, TRANSCRIPT_LIMIT);
  const transcriptHtml = transcriptSnippet
    ? `<h3 style="margin:16px 0 8px;">Transcript excerpt</h3>
       <p style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:12px;color:#333;">${htmlEscape(transcriptSnippet)}${
         fullTranscript.length > TRANSCRIPT_LIMIT ? '\n[...truncated]' : ''
       }</p>`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
      <h2 style="margin:0 0 12px;">${htmlEscape(subject)}</h2>
      <p style="margin:0 0 12px;">A caller reached the voice line but the intake could not be confirmed (${htmlEscape(missing)}), so it did not enter the lawyer lead queue. This is an operator-only alert.</p>
      <p style="margin:0 0 12px;font-weight:bold;color:#1E2F58;">${htmlEscape(nextAction)}</p>
      ${recordingHtml}
      <table style="border-collapse:collapse;margin:0 0 16px;">${rowHtml}</table>
      ${transcriptHtml}
    </div>
  `;
  return { subject, html };
}

// ── Voice callback request (wrong number / existing client / other) ──────────

export interface VoiceCallbackNotifyArgs {
  id: string;
  firmId: string;
  branch: VoiceCallbackBranch;
  urgency: VoiceUrgency;
  callerName: string | null;
  /** Provenance of callerName (#175). Identity is separate from reachability. */
  callerNameSource: VoiceNameSource;
  callerPhone: string | null;
  callerPhoneSource: 'body' | 'voice-ai-api' | 'none';
  organization: string | null;
  message: string;
  callId: string | null;
  operatorReview: boolean;
  reason: string;
}

export function branchLabel(branch: VoiceCallbackBranch): string {
  return branch
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildVoiceCallbackEmail(args: VoiceCallbackNotifyArgs): {
  subject: string;
  html: string;
} {
  const urgentPrefix = args.urgency === 'urgent' ? 'URGENT: ' : '';
  const subject = `${urgentPrefix}Voice callback: ${branchLabel(args.branch)}`;

  // Identity provenance (#175). The phone is carrier caller ID (reachability);
  // the name may be caller-ID / contact-record metadata the caller never said.
  // Show the name's source so the operator does not read a metadata name as a
  // confirmed identity. nameUnverified gates the clarifying intro sentence.
  const nameSourceLabel =
    args.callerName && args.callerNameSource !== 'none'
      ? NAME_SOURCE_LABEL[args.callerNameSource]
      : null;
  const nameUnverified =
    !!args.callerName &&
    (args.callerNameSource === 'caller_id_only' || args.callerNameSource === 'unverified');

  const rows: Array<[string, string | null]> = [
    ['Firm ID', args.firmId],
    ['Request ID', args.id],
    ['Branch', args.branch],
    ['Urgency', args.urgency],
    ['Operator review', args.operatorReview ? 'yes' : 'no'],
    ['Reason', args.reason],
    ['Caller name', args.callerName],
    ['Name source', nameSourceLabel],
    ['Caller phone', args.callerPhone],
    ['Phone source', PHONE_SOURCE_LABEL[args.callerPhoneSource]],
    ['Organization', args.organization],
    ['Call ID', args.callId],
  ];

  const rowHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 10px;color:#666;">${htmlEscape(label)}</td><td style="padding:6px 10px;"><strong>${htmlEscape(value || 'Not provided')}</strong></td></tr>`,
    )
    .join('');

  const provenanceNote = nameUnverified
    ? `<p style="margin:0 0 12px;color:#8a6d3b;">The caller name below is ${htmlEscape(NAME_SOURCE_LABEL[args.callerNameSource])}. Treat it as a lead on the caller ID, not a confirmed identity.</p>`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
      <h2 style="margin:0 0 12px;">${htmlEscape(subject)}</h2>
      <p style="margin:0 0 12px;">This is an operator-only callback request. It is not in the lawyer lead queue.</p>
      ${provenanceNote}
      <table style="border-collapse:collapse;margin:0 0 16px;">${rowHtml}</table>
      <h3 style="margin:16px 0 8px;">Message</h3>
      <p style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:12px;">${htmlEscape(args.message || 'No message captured.')}</p>
    </div>
  `;
  return { subject, html };
}
