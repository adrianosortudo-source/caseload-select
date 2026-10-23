import { htmlEscape } from '@/lib/voice-callback-notify-pure';

export interface VoiceRecoverySlaCandidate {
  status: string;
  acknowledged_at: string | null;
  sla_due_at: string | null;
  acknowledgement_sla_escalated_at: string | null;
}

/** A case is escalatable only while it remains genuinely unacknowledged. */
export function isVoiceRecoverySlaEscalationDue(
  row: VoiceRecoverySlaCandidate,
  now: Date = new Date(),
): boolean {
  if (row.status !== 'open' || row.acknowledged_at || row.acknowledgement_sla_escalated_at || !row.sla_due_at) return false;
  const dueAt = new Date(row.sla_due_at).getTime();
  return Number.isFinite(dueAt) && dueAt <= now.getTime();
}

export interface VoiceRecoverySlaEmailInput {
  caseId: string;
  firmId: string;
  firmName: string | null;
  callerName: string | null;
  disposition: string;
  urgency: string;
  slaDueAt: string;
  triageUrl: string;
}

export function buildVoiceRecoverySlaEmail(input: VoiceRecoverySlaEmailInput): { subject: string; html: string } {
  const firm = input.firmName ?? `Firm ${input.firmId}`;
  const caller = input.callerName ?? 'an unidentified caller';
  const subject = `[Action required] Voice recovery acknowledgement overdue - ${firm}`;
  const rows: Array<[string, string]> = [
    ['Firm', firm], ['Caller', caller], ['Disposition', input.disposition],
    ['Urgency', input.urgency], ['SLA due', input.slaDueAt], ['Recovery case', input.caseId],
  ];
  const table = rows.map(([label, value]) =>
    `<tr><td style="padding:6px 10px;color:#666;">${htmlEscape(label)}</td><td style="padding:6px 10px;"><strong>${htmlEscape(value)}</strong></td></tr>`,
  ).join('');
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:600px;">
      <h2 style="margin:0 0 12px;color:#8A3B2E;">Voice recovery acknowledgement overdue</h2>
      <p style="margin:0 0 12px;">A Voice AI recovery case remains unacknowledged after its service-level deadline. Review the transcript evidence and either acknowledge, record follow-up, resolve, or promote it when the facts support screening.</p>
      <table style="border-collapse:collapse;margin:0 0 16px;">${table}</table>
      <p style="margin:0;"><a href="${htmlEscape(input.triageUrl)}" style="display:inline-block;padding:12px 18px;background:#1E2F58;color:#fff;text-decoration:none;font-weight:700;">Open recovery queue</a></p>
      <p style="margin:16px 0 0;color:#666;font-size:12px;">This is one acknowledgement-SLA escalation. The case is stamped only after dispatch succeeds; retries use a stable delivery key.</p>
    </div>`,
  };
}
