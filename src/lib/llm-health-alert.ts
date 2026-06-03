/**
 * LLM-extraction-disabled operator alert (#128).
 *
 * `llmExtractServer` returns mode='disabled' when GEMINI_API_KEY is missing or
 * invalid. In that state the screen engine falls back to regex-only extraction:
 * briefs are shallower, fields get missed, and on contact-sparse transcripts the
 * contact-capture gate can fail outright. None of that is visible to the
 * operator without an explicit signal, so the intake routes emit one.
 *
 * Pure logic only — no DB or email I/O — mirroring the lead-notify-pure /
 * token-expiry split so the cooldown decision and email composition are
 * unit-testable. The I/O wrapper (notifyOperatorOfLlmDisabled in
 * voice-callback-notify.ts) does the Resend send + suppression-column stamp.
 *
 * Throttle: the alert is suppressed per firm for LLM_DISABLED_ALERT_SUPPRESSION
 * _HOURS after a successful send (intake_firms.gemini_disabled_alert_sent_at),
 * so a sustained outage does not email once per inbound call. Mirrors the
 * token-expiry ALERT_SUPPRESSION_DAYS pattern, scaled to hours because a dead
 * LLM key is more urgent than an expiring token.
 */

import { htmlEscape } from '@/lib/voice-callback-notify-pure';

export const LLM_DISABLED_ALERT_SUPPRESSION_HOURS = 6;

const MS_PER_HOUR = 3_600_000;

/**
 * True when an LLM-disabled alert should fire now: never alerted before, the
 * stored timestamp is unparseable (treat as never), or the suppression window
 * has elapsed since the last send. Pure; the route passes
 * intake_firms.gemini_disabled_alert_sent_at and `now`.
 */
export function shouldAlertLlmDisabled(
  alertSentAtIso: string | null | undefined,
  now: Date = new Date(),
  suppressionHours: number = LLM_DISABLED_ALERT_SUPPRESSION_HOURS,
): boolean {
  if (!alertSentAtIso) return true;
  const last = new Date(alertSentAtIso).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= suppressionHours * MS_PER_HOUR;
}

export interface LlmDisabledAlertArgs {
  firmId: string;
  firmName: string | null;
  /** The mode llmExtractServer returned. Alerts fire for 'disabled'. */
  mode: 'disabled' | 'error' | 'degraded' | 'live';
  /** Channel that observed the disabled mode (e.g. 'voice'). */
  channel: string;
  callId: string | null;
  /** ISO timestamp of when the disabled mode was observed. */
  occurredAtIso: string;
}

export function buildLlmDisabledAlertEmail(args: LlmDisabledAlertArgs): {
  subject: string;
  html: string;
} {
  const firmLabel = args.firmName ?? `Firm ${args.firmId}`;
  const subject = `Screen engine LLM is disabled — briefs degraded (${firmLabel})`;

  const rows: Array<[string, string | null]> = [
    ['Firm', firmLabel],
    ['Firm ID', args.firmId],
    ['Channel', args.channel],
    ['LLM mode', args.mode],
    ['Call ID', args.callId],
    ['Observed at', args.occurredAtIso],
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
      <p style="margin:0 0 12px;">The screen engine tried to run LLM extraction and got back <strong>mode=disabled</strong>. This means GEMINI_API_KEY is missing or invalid on the server. While it stays disabled, every brief falls back to regex-only extraction: shallower briefs, missed fields, and on contact-sparse calls the contact-capture gate can reject otherwise-valid leads.</p>
      <p style="margin:0 0 12px;font-weight:bold;color:#1E2F58;">Set or rotate GEMINI_API_KEY in Vercel and redeploy, then run a test intake to confirm mode returns to live.</p>
      <table style="border-collapse:collapse;margin:0 0 16px;">${rowHtml}</table>
      <p style="margin:0;color:#666;font-size:13px;">Repeat alerts are suppressed for ${LLM_DISABLED_ALERT_SUPPRESSION_HOURS} hours so a sustained outage does not email once per call.</p>
    </div>
  `;
  return { subject, html };
}
