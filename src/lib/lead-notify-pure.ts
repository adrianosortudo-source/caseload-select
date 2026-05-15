/**
 * Pure builders for the "new lead in triage" email.
 *
 * Server-only I/O (recipient resolution, Resend dispatch) lives in
 * lib/lead-notify.ts. Anything testable in isolation lives here.
 *
 * The email is sent once per lead, fan-out across every firm_lawyers row
 * with role='lawyer' for the firm. Operators rely on /admin/triage instead,
 * so they are intentionally NOT in the recipient list (cuts down noise for
 * the operator who would otherwise get one email per firm per lead).
 */

import { matterLabel, practiceAreaLabel } from "@/lib/screened-leads-labels";
import { formatRemaining } from "@/lib/decision-timer";
import { intakeLanguageLabel } from "@/lib/intake-language-label";
import { channelLabel } from "@/lib/channel-labels";

/**
 * Lifecycle status that drives the email's visual treatment AND subject prefix.
 *
 *   triaging — standard new-lead notification. Lawyer decides Take / Pass /
 *              (for Band D) Refer within the decision window. Band D leads
 *              get a "refer opportunity" subject + body so the lawyer
 *              recognises them at a glance.
 *   declined — reserved for future engine-spam / abuse handling. Not
 *              reached from the routine intake path as of 2026-05-15.
 *              Copy explains what happened and how to override.
 *
 * Doctrine (CRM Bible 2026-05-15, supersedes 2026-05-14): "The engine
 * sorts attention, the lawyer decides outcome." Out-of-scope matters
 * land as Band D triaging (not declined). The `declined` branch in this
 * file is dormant intake-path-wise but kept for future spam-block use.
 */
export type LifecycleStatus = "triaging" | "declined";

export interface NewLeadEmailInput {
  firmName: string;
  firstName: string;            // contact first name; "this lead" if unknown
  matterType: string;
  practiceArea: string;
  band: "A" | "B" | "C" | "D" | null;
  decisionDeadlineIso: string;
  whaleNurture: boolean;
  briefUrl: string;             // absolute URL to /portal/[firmId]/triage/[leadId]
  intakeLanguage?: string | null; // ISO 639-1 code; omitted / null for English
  /** Inbound channel. Omit or null for web (default, no suffix in subject). */
  channel?: string | null;
  /** Defaults to 'triaging' for backward compat with older callers. */
  lifecycleStatus?: LifecycleStatus;
  now?: Date;
}

export interface NewLeadEmail {
  subject: string;
  html: string;
}

/**
 * Subject line. Three shapes:
 *
 *   triaging, Band A/B/C:
 *     Priority A — Sarah · Wrongful dismissal
 *     Priority B — this lead · Real Estate Litigation
 *     New lead — Mike · Contract Dispute  (when band is null)
 *
 *   triaging, Band D (refer-eligible OOS):
 *     Priority D — Mike · Refer opportunity · Family Law
 *
 *   declined (dormant; reserved for engine-spam):
 *     [Auto-filtered] Sarah · matter flagged as Family Law
 *
 * The Band D subject leads with the practice area the engine detected so
 * the lawyer sees at a glance whether they have a colleague to refer to.
 */
export function buildNewLeadSubject(input: NewLeadEmailInput): string {
  const { firstName, matterType, practiceArea, band, lifecycleStatus, channel } = input;
  const matter = matterLabel(matterType);
  const area = practiceAreaLabel(practiceArea);
  const channelSuffix = (channel && channel !== 'web')
    ? ` (via ${channelLabel(channel)})`
    : '';
  if (lifecycleStatus === "declined") {
    return `[Auto-filtered] ${firstName} · matter flagged as ${area}${channelSuffix}`;
  }
  if (band === "D") {
    return `Priority D — ${firstName} · Refer opportunity · ${area}${channelSuffix}`;
  }
  const prefix = band ? `Priority ${band}` : "New lead";
  return `${prefix} — ${firstName} · ${matter}${channelSuffix}`;
}

/**
 * HTML body. Mirrors the visual treatment of the magic-link email so the
 * inbox looks coherent: navy header band, manrope headline, oxanium label
 * stripe, single CTA pill in navy.
 *
 * Hard rules from the brand book applied:
 *  - No em dashes in copy. Spaced en dashes ("—" used in subject is a long
 *    dash but rendered with regular hyphen + spaces in body for safety).
 *  - No italic emphasis.
 *  - No banned AI-pattern vocabulary.
 *  - Decision deadline is shown in relative time ("23h 12m") rather than
 *    a wall-clock; the lawyer cares about how long they have, not when.
 */
export function buildNewLeadHtml(input: NewLeadEmailInput): string {
  const {
    firmName,
    firstName,
    matterType,
    practiceArea,
    band,
    decisionDeadlineIso,
    whaleNurture,
    briefUrl,
    intakeLanguage,
    channel,
    lifecycleStatus = "triaging",
    now = new Date(),
  } = input;

  const matter = matterLabel(matterType);
  const area = practiceAreaLabel(practiceArea);
  const langLabel = intakeLanguageLabel(intakeLanguage ?? null);
  const langNote = langLabel
    ? `<div style="margin-top:6px;font-size:12px;color:#1E3A5F;font-family:'Oxanium',Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;">Intake language: ${escapeHtml(langLabel)} · Brief translated to English</div>`
    : "";
  const channelNote = (channel && channel !== 'web')
    ? `<div style="margin-top:6px;font-size:12px;color:#1E3A5F;font-family:'Oxanium',Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;">Inbound via: ${escapeHtml(channelLabel(channel))}</div>`
    : "";

  // Three distinct visual treatments share the navy header band and brand
  // chrome so the inbox looks coherent, but eyebrow / status panel / CTA
  // differ. The Band D treatment is the new "refer opportunity" surface;
  // declined is retained for future engine-spam / abuse use (dormant
  // intake-path-wise as of 2026-05-15).
  const isDeclined = lifecycleStatus === "declined";
  const isBandD = !isDeclined && band === "D";

  const eyebrow = isDeclined
    ? "Auto-filtered lead"
    : isBandD
    ? "New refer-eligible lead"
    : "New lead in triage";
  const eyebrowColor = isDeclined ? "#7A4A20" : isBandD ? "#3F5878" : "#7A6638";

  // The status panel content varies per treatment.
  let statusPanel: string;
  if (isDeclined) {
    statusPanel = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7A4A20;">Auto-filtered</td>
        <td align="right" style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C5850;">${escapeHtml(area)}</td>
      </tr>
    </table>
    <div style="margin-top:10px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;line-height:1.5;color:#0D1520;">
      The screen engine flagged this matter as out of scope. If the engine got it wrong, open the brief and move the lead back to triage.
    </div>
    ${channelNote}
    ${langNote}`;
  } else if (isBandD) {
    const remainingMs = new Date(decisionDeadlineIso).getTime() - now.getTime();
    const remaining = formatRemaining(remainingMs);
    statusPanel = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#3F5878;">Priority D · Refer-eligible</td>
        <td align="right" style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C5850;">${escapeHtml(area)}</td>
      </tr>
    </table>
    <div style="margin-top:10px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;line-height:1.5;color:#0D1520;">
      The screen engine classified this matter as outside your practice areas. Decision window: <strong style="font-weight:700;color:#1E2F58;">${escapeHtml(remaining)}</strong> to Refer to a colleague, Take (if the engine misclassified), or Pass.
    </div>
    ${channelNote}
    ${langNote}`;
  } else {
    const remainingMs = new Date(decisionDeadlineIso).getTime() - now.getTime();
    const remaining = formatRemaining(remainingMs);
    const bandLine = band ? `Priority ${band}` : "Awaiting band";
    const whaleNote = whaleNurture
      ? `<div style="margin-top:6px;font-size:12px;color:#7A6638;font-family:'Oxanium',Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;">High value, low readiness · whale nurture flag</div>`
      : "";
    statusPanel = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C5850;">${escapeHtml(bandLine)}</td>
        <td align="right" style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5C5850;">${escapeHtml(area)}</td>
      </tr>
    </table>
    <div style="margin-top:10px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;line-height:1.5;color:#0D1520;">
      Decision window: <strong style="font-weight:700;color:#1E2F58;">${escapeHtml(remaining)}</strong> left to Take or Pass before the backstop fires the decline-with-grace cadence.
    </div>
    ${channelNote}
    ${langNote}
    ${whaleNote}`;
  }

  const bodyParagraph = "The brief is rendered in your portal queue. Open it, scan the case file, decide.";
  const ctaLabel = isDeclined ? "Review the brief" : "Open the brief";

  return `<!doctype html>
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
              <div style="font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${eyebrowColor};">${escapeHtml(eyebrow)}</div>
              <div style="margin-top:8px;font-family:'Manrope',Arial,sans-serif;font-weight:800;font-size:24px;line-height:1.2;color:#1E2F58;">${escapeHtml(firstName)} · ${escapeHtml(matter)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F3EF;border:1px solid #E4E2DB;">
                <tr>
                  <td style="padding:14px 16px;">
                    ${statusPanel}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3F3C36;">
                ${escapeHtml(bodyParagraph)}
              </p>
              <p style="margin:0;">
                <a href="${escapeAttr(briefUrl)}" style="display:inline-block;background:#1E2F58;color:#FFFFFF;text-decoration:none;font-family:'Oxanium',Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;padding:13px 24px;">${escapeHtml(ctaLabel)}</a>
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
</html>`;
}

export function buildNewLeadEmail(input: NewLeadEmailInput): NewLeadEmail {
  return {
    subject: buildNewLeadSubject(input),
    html: buildNewLeadHtml(input),
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]!));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/**
 * Pull a sensible "first name" from a contact_name field. If the contact
 * gave a full name we use the first token. If they gave nothing or only
 * whitespace, we fall back to "this lead" so the subject still parses.
 */
export function deriveFirstName(contactName: string | null | undefined): string {
  const trimmed = (contactName ?? "").trim();
  if (!trimmed) return "this lead";
  const first = trimmed.split(/\s+/)[0];
  // Lower-case if it looks like an all-caps shout; otherwise leave as-is.
  if (first === first.toUpperCase() && first.length > 1) {
    return first.charAt(0) + first.slice(1).toLowerCase();
  }
  return first;
}
