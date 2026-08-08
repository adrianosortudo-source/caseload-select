/**
 * Builds the Resend brief for a Start a Conversation submission
 * (BUILD_PLAN_start_conversation_flow_v1.md section 2.6): "subject carries
 * name + firm + timeline; body lists the seven answers in order with the
 * "what prompted this" line first. It should read like a small sibling of
 * the Screen's lawyer brief, because that is the demo."
 *
 * Pure and dependency-free so it is unit-testable without a Resend client
 * or a live database.
 */

import { labelForValue } from './questions';
import { provinceLabel, type ValidStartConversationSubmission } from './validate';

function provinceLabelOrRaw(value: string): string {
  return provinceLabel(value) ?? value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildBriefSubject(submission: ValidStartConversationSubmission): string {
  const { contact, answers } = submission;
  const timelineLabel = labelForValue('timeline', answers.timeline) ?? answers.timeline;
  return `Start a conversation: ${contact.name} (${contact.firm_name}) - ${timelineLabel}`;
}

interface BriefRow {
  label: string;
  value: string;
}

function answerRows(submission: ValidStartConversationSubmission): BriefRow[] {
  const { answers } = submission;

  const practiceArea = labelForValue('practice_area', answers.practice_area) ?? answers.practice_area;
  const practiceAreaValue = answers.practice_area_other
    ? `${practiceArea} - ${answers.practice_area_other}`
    : practiceArea;

  const promptReason = labelForValue('prompt_reason', answers.prompt_reason) ?? answers.prompt_reason;
  const promptReasonValue = answers.prompt_reason_other
    ? `${promptReason} - ${answers.prompt_reason_other}`
    : promptReason;

  // "What prompted this" leads, per the plan's explicit ordering rule.
  return [
    { label: 'What prompted you to reach out now', value: promptReasonValue },
    { label: 'What kind of law does your firm practice', value: practiceAreaValue },
    { label: 'How many lawyers work at the firm', value: labelForValue('firm_size', answers.firm_size) ?? answers.firm_size },
    { label: 'Who decides on marketing spend at the firm', value: labelForValue('decision_role', answers.decision_role) ?? answers.decision_role },
    { label: 'When would you want the work to start', value: labelForValue('timeline', answers.timeline) ?? answers.timeline },
    { label: 'Name', value: submission.contact.name },
    { label: 'Firm name', value: submission.contact.firm_name },
    { label: 'Email', value: submission.contact.email },
    { label: 'Province', value: provinceLabelOrRaw(submission.contact.province) },
  ];
}

export function buildBriefHtml(submission: ValidStartConversationSubmission): string {
  const rows = answerRows(submission);
  const outcomeLine =
    submission.outcome === 'booking'
      ? 'Shown the booking screen (fits the outcome rule: decides or shares the spend decision, and wants to start this month or this quarter).'
      : 'Shown the reply-promise screen.';

  const rowsHtml = rows
    .map(
      (row) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5E6D82;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(
          row.label,
        )}</td><td style="padding:6px 0;color:#0D1520;font-size:14px;">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#F4F3EF;font-family:'DM Sans',Arial,sans-serif;color:#0D1520;">
  <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #E0DDD6;">
    <tr>
      <td style="padding:20px 24px;background:#1E2F58;color:#FFFFFF;font-family:Georgia,serif;font-size:16px;font-weight:700;">
        Start a conversation &mdash; new inquiry
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px;">
        <p style="margin:0 0 16px;font-size:13px;color:#5E6D82;">${escapeHtml(outcomeLine)}</p>
        <table role="presentation" width="100%" style="border-collapse:collapse;">
          ${rowsHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
