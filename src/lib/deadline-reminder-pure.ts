/**
 * Pure logic for the decision-deadline reminder email (audit finding F1,
 * 2026-07-02): 37 of the first 44 DRG leads expired to declined via the
 * backstop because nobody worked the queue inside the decision window.
 * The reminder is the software half of the fix; the operator conversation
 * is the human half.
 *
 * Eligibility (isReminderDue):
 *   - status is 'triaging' and no reminder was sent yet
 *   - the deadline is ahead of now but inside REMINDER_WINDOW_MS (12h)
 *   - the row is at least MIN_ROW_AGE_MS (12h) old, so short-window leads
 *     (12h deadlines at urgency >= 8) never get a reminder minutes after
 *     the new-lead email said the same thing
 *
 * The email reuses the new-lead subject builder with a [Reminder] prefix so
 * inbox threading groups the pair, and the same brand shell (navy header,
 * Oxanium eyebrow, single CTA) so the inbox stays coherent.
 */

import {
  buildNewLeadSubject,
  deriveFirstName,
  type NewLeadEmailInput,
} from "@/lib/lead-notify-pure";
import { matterLabel, practiceAreaLabel } from "@/lib/screened-leads-labels";
import { formatRemaining } from "@/lib/decision-timer";

export const REMINDER_WINDOW_MS = 12 * 60 * 60 * 1000;
export const MIN_ROW_AGE_MS = 12 * 60 * 60 * 1000;

export interface ReminderCandidateRow {
  status: string;
  deadline_reminder_sent_at: string | null;
  decision_deadline: string | null;
  created_at: string;
}

export function isReminderDue(row: ReminderCandidateRow, now: Date): boolean {
  if (row.status !== "triaging") return false;
  if (row.deadline_reminder_sent_at !== null) return false;
  if (!row.decision_deadline) return false;

  const deadlineMs = new Date(row.decision_deadline).getTime();
  const createdMs = new Date(row.created_at).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(createdMs)) return false;

  const remaining = deadlineMs - nowMs;
  if (remaining <= 0) return false; // past deadline: backstop territory
  if (remaining > REMINDER_WINDOW_MS) return false; // too early
  if (nowMs - createdMs < MIN_ROW_AGE_MS) return false; // fresh lead, new-lead email still current
  return true;
}

export interface ReminderEmailInput {
  firmName: string;
  contactName: string | null;
  matterType: string;
  practiceArea: string;
  band: "A" | "B" | "C" | "D" | null;
  decisionDeadlineIso: string;
  briefUrl: string;
  channel?: string | null;
  now?: Date;
}

export interface ReminderEmail {
  subject: string;
  html: string;
}

export function buildDeadlineReminderEmail(input: ReminderEmailInput): ReminderEmail {
  const {
    firmName,
    contactName,
    matterType,
    practiceArea,
    band,
    decisionDeadlineIso,
    briefUrl,
    channel,
    now = new Date(),
  } = input;

  const firstName = deriveFirstName(contactName);
  const subjectBase = buildNewLeadSubject({
    firmName,
    firstName,
    matterType,
    practiceArea,
    band,
    decisionDeadlineIso,
    whaleNurture: false,
    briefUrl,
    channel: channel ?? null,
    lifecycleStatus: "triaging",
  } satisfies NewLeadEmailInput);

  const remaining = formatRemaining(
    new Date(decisionDeadlineIso).getTime() - now.getTime(),
  );
  const matter = matterLabel(matterType);
  const area = practiceAreaLabel(practiceArea);
  const bandLine = band ? `Priority ${band}` : "Awaiting band";
  const isBandD = band === "D";
  const closingLine = isBandD
    ? "the backstop marks it passed and the decline-with-grace cadence goes out"
    : "the backstop declines it and the decline-with-grace cadence goes out";

  return {
    subject: `[Reminder] ${subjectBase}`,
    html: `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F4F3EF;font-family:'DM Sans',Arial,sans-serif;color:#0D1520;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3EF;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E4E2DB;">
          <tr>
            <td style="background:#0D1520;padding:18px 28px;border-bottom:2px solid #C4B49A;">
              <div style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#C4B49A;">CaseLoad Select · ${escapeHtml(firmName)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 4px;">
              <div style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8A3B2E;">Decision window closing</div>
              <div style="margin-top:8px;font-family:'Manrope',Arial,sans-serif;font-weight:800;font-size:24px;line-height:1.2;color:#1E2F58;">${escapeHtml(firstName)} · ${escapeHtml(matter)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3EF;border:1px solid #E4E2DB;">
                <tr>
                  <td style="padding:14px 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8A3B2E;">${escapeHtml(bandLine)} · Still in triage</td>
                        <td align="right" style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C5850;">${escapeHtml(area)}</td>
                      </tr>
                    </table>
                    <div style="margin-top:10px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;line-height:1.5;color:#0D1520;">
                      This lead arrived earlier and has not been actioned. <strong style="font-weight:700;color:#1E2F58;">${escapeHtml(remaining)}</strong> left on the decision window. If it expires, ${escapeHtml(closingLine)}.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3F3C36;">
                Open the brief and decide: Take, Pass${isBandD ? ", or Refer" : ""}. A one-minute decision now beats an automated decline.
              </p>
              <p style="margin:0;">
                <a href="${escapeHtml(briefUrl)}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;text-decoration:none;font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;padding:13px 24px;">Open the brief</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#EFEDE6;padding:14px 28px;border-top:1px solid #E4E2DB;font-size:11px;color:#9B9690;font-family:'Oxanium',Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;">
              caseloadselect.ca
            </td>
          </tr>
        </table>
        <div style="margin-top:14px;font-size:11px;line-height:1.5;color:#9B9690;font-family:'DM Sans',Arial,sans-serif;max-width:560px;text-align:left;">
          You are receiving this because you are listed as a lawyer for ${escapeHtml(firmName)} in CaseLoad Select. To stop these notifications, ask your operator to remove your row from the firm.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]!));
}
