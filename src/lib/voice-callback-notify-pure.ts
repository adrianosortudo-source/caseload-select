/**
 * Pure (I/O-free) builders for the voice operator notifications.
 *
 * Split out from `voice-callback-notify.ts` so the email composition logic can
 * be unit-tested directly. The I/O wrapper (`voice-callback-notify.ts`) carries
 * the `server-only` import + Resend/Supabase calls; this module is pure and
 * safe to import under vitest's node environment. Mirrors the
 * `lead-notify-pure.ts` / `lead-notify.ts` split convention.
 */

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

const PHONE_SOURCE_LABEL: Record<UnconfirmedVoiceNotifyArgs['callerPhoneSource'], string> = {
  body: 'from the call (caller ID)',
  'voice-ai-api': 'from the call (caller ID)',
  none: 'not captured',
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

  const rows: Array<[string, string | null]> = [
    ['Firm ID', args.firmId],
    ['Inquiry ID', args.inquiryId],
    ['Reason', args.reason],
    ['What is missing', missing],
    ['Caller name', args.callerName],
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
