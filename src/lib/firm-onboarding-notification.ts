/**
 * Operator notification for firm-onboarding submissions.
 *
 * Two responsibilities:
 *   1. Build the operator-facing notification email (subject + HTML).
 *   2. Send it via Resend AND persist the delivery outcome on the
 *      firm_onboarding_intake row, so a failed send is recoverable.
 *
 * The submit route used to fire-and-forget the email inside a try/catch
 * that swallowed errors and returned 200 to the form. A DRG Law submission
 * on 2026-05-15 landed in the database fine but the operator never got the
 * email (recipient inbox was unverified at the time; the route logged a
 * line to Vercel's short-retention stream which was gone by the time we
 * noticed). This module ends that pattern. Every attempt updates the row:
 *
 *   notification_sent_at         (set on success, NULL otherwise)
 *   notification_error           (set on failure, cleared on success)
 *   notification_attempts        (incremented every attempt)
 *   notification_last_attempt_at (every attempt)
 *
 * The submit route uses this on insert. The operator-only retry endpoint
 * /api/admin/onboarding-submissions/[id]/retry-notification uses it to
 * replay a failed or pending notification on demand.
 *
 * The recipient defaults to OPERATOR_NOTIFICATION_EMAIL. If that env var
 * is missing, we fall back to adrianosortudo@gmail.com (the canonical
 * operator inbox per the 2026-05-20 audit). The previous fallback
 * (adriano@caseloadselect.ca) was undeliverable for the operator's actual
 * inbox and is retired.
 */

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";

// Canonical operator inbox. If you change this, also update the Vercel env
// var OPERATOR_NOTIFICATION_EMAIL across Production / Preview / Development.
const FALLBACK_OPERATOR_EMAIL = "adrianosortudo@gmail.com";

export type SendNotificationResult =
  | { ok: true; messageId: string | undefined; sentTo: string; replay: boolean }
  | { ok: false; error: string; sentTo: string; replay: boolean };

export interface SendOptions {
  /**
   * If true, the subject is prefixed with `[REPLAY]` and the HTML includes
   * a callout banner explaining this is a re-send. Used by the admin
   * retry endpoint so the operator can tell a replay from a fresh
   * notification at a glance.
   */
  replay?: boolean;
  /**
   * Override the recipient. Used in ad-hoc replays. Falls back to the
   * env var, then to FALLBACK_OPERATOR_EMAIL.
   */
  recipient?: string;
}

/**
 * Fetches the submission, builds the notification email, sends via Resend,
 * and persists the outcome on the row. Always resolves (never throws) so
 * the caller can decide what to surface.
 */
export async function sendOperatorNotification(
  submissionId: string,
  opts: SendOptions = {},
): Promise<SendNotificationResult> {
  const recipient =
    opts.recipient || process.env.OPERATOR_NOTIFICATION_EMAIL || FALLBACK_OPERATOR_EMAIL;
  const replay = Boolean(opts.replay);

  // Fetch the row. service_role bypasses RLS.
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("firm_onboarding_intake")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();

  if (fetchErr || !row) {
    const error = fetchErr?.message ?? `submission ${submissionId} not found`;
    return { ok: false, error, sentTo: recipient, replay };
  }

  const submission = row as OnboardingSubmissionRecord;
  const { subject, html } = buildOperatorNotificationEmail(submission, { replay });

  let sendErr: string | null = null;
  let messageId: string | undefined;
  try {
    const result = await sendEmail(recipient, subject, html);
    if ("skipped" in result && result.skipped) {
      sendErr = "RESEND_API_KEY missing — email not configured";
    } else if ("id" in result) {
      messageId = result.id;
    }
  } catch (err) {
    sendErr = err instanceof Error ? err.message : String(err);
  }

  // Persist outcome regardless of success or failure. Best-effort — if the
  // UPDATE itself fails (extremely rare) we still return the send result so
  // the caller knows what happened.
  const nowIso = new Date().toISOString();
  const update = sendErr
    ? {
        notification_error: sendErr,
        notification_attempts: (submission.notification_attempts ?? 0) + 1,
        notification_last_attempt_at: nowIso,
      }
    : {
        notification_sent_at: nowIso,
        notification_error: null,
        notification_attempts: (submission.notification_attempts ?? 0) + 1,
        notification_last_attempt_at: nowIso,
      };

  const { error: updateErr } = await supabaseAdmin
    .from("firm_onboarding_intake")
    .update(update)
    .eq("id", submissionId);
  if (updateErr) {
    // Surface the row-update failure but do not lose the send outcome.
    console.error(
      `[firm-onboarding-notification] state update failed id=${submissionId}: ${updateErr.message}`,
    );
  }

  if (sendErr) {
    console.error(
      `[firm-onboarding-notification] send failed id=${submissionId} to=${recipient}: ${sendErr}`,
    );
    return { ok: false, error: sendErr, sentTo: recipient, replay };
  }

  console.log(
    `[firm-onboarding-notification] sent id=${submissionId} to=${recipient} messageId=${messageId ?? "(none)"} replay=${replay}`,
  );
  return { ok: true, messageId, sentTo: recipient, replay };
}

// ── notification HTML + subject builder ─────────────────────────────────

/**
 * Shape of the firm_onboarding_intake row this module reads. Loose: only
 * the fields the email uses are listed, and all are optional / nullable
 * to be forgiving across schema migrations.
 */
export interface OnboardingSubmissionRecord {
  id: string;
  submission_token: string;
  submitted_at: string;
  legal_name: string | null;
  business_number: string | null;
  business_address: string | null;
  business_website: string | null;
  business_email: string | null;
  authorized_rep_name: string | null;
  authorized_rep_title: string | null;
  authorized_rep_email: string | null;
  authorized_rep_phone: string | null;
  // Bar-of-call data for the authorized rep, used by directory submission
  // prep. Captured by the 2026-05-20 directory-prep migration.
  authorized_rep_year_of_call: number | string | null;
  authorized_rep_province_of_call: string | null;
  // Prior business names / d/b/a, free text. Captured by the same migration.
  previous_business_names: string | null;
  booking_url: string | null;
  office_hours: string | null;
  additional_lawyers:
    | Array<{
        name?: string | null;
        email?: string | null;
        role?: string | null;
        year_of_call?: number | string | null;
        province_of_call?: string | null;
      }>
    | null;
  practice_areas: string[] | null;
  practice_areas_other: string | null;
  service_area: string | null;
  service_area_other: string | null;
  out_of_scope_notes: string | null;
  existing_website_form_url: string | null;
  existing_phone_lines: string | null;
  practice_management_system: string | null;
  practice_management_system_other: string | null;
  pms_integration_preference: string | null;
  sms_vertical: string | null;
  sms_sender_phone_preference: string | null;
  intake_channels: string[] | null;
  whatsapp_number_decision: string | null;
  whatsapp_display_name: string | null;
  whatsapp_business_verification_doc_note: string | null;
  verification_doc_storage_path: string | null;
  verification_doc_original_name: string | null;
  verification_doc_size_bytes: number | null;
  has_facebook_account: boolean | null;
  has_meta_business_manager: boolean | null;
  meta_business_manager_url: string | null;
  will_add_operator_as_admin: boolean | null;
  meta_admin_status: string | null;
  meta_admin_blocker_note: string | null;
  gbp_admin_status: string | null;
  gbp_admin_blocker_note: string | null;
  linkedin_admin_status: string | null;
  linkedin_admin_blocker_note: string | null;
  signed_name: string | null;
  signed_email: string | null;
  consent_acknowledged: boolean | null;
  notes: string | null;
  notification_sent_at?: string | null;
  notification_attempts?: number | null;
  notification_error?: string | null;
}

export function buildOperatorNotificationEmail(
  r: OnboardingSubmissionRecord,
  opts: { replay?: boolean } = {},
): { subject: string; html: string } {
  const firmName = r.legal_name ?? r.submission_token;
  const subjectPrefix = opts.replay ? "[REPLAY] " : "";
  const subject = `${subjectPrefix}New firm onboarding submission · ${firmName}`;
  const html = renderHtml(r, { replay: Boolean(opts.replay) });
  return { subject, html };
}

function renderHtml(
  r: OnboardingSubmissionRecord,
  opts: { replay: boolean },
): string {
  const row = (label: string, value: string | null | undefined) =>
    value
      ? `<tr><td style="padding:6px 12px;border-bottom:1px solid #E4E2DB;font-weight:600;color:#1E2F58;width:35%;">${esc(label)}</td><td style="padding:6px 12px;border-bottom:1px solid #E4E2DB;color:#3F3C36;">${esc(value)}</td></tr>`
      : "";
  const submittedFmt = new Date(r.submitted_at).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
  });
  const adminUrl = `https://app.caseloadselect.ca/admin/onboarding-submissions/${encodeURIComponent(r.id)}`;
  const replayBanner = opts.replay
    ? `<p style="margin:0 0 6px;font-size:13px;background:#FFF4D6;border:1px solid #E2C66B;padding:10px 12px;color:#5C4A12;"><b>REPLAY:</b> this is a re-send of an earlier notification that did not deliver. The form was submitted at ${esc(submittedFmt)} Toronto time.</p>`
    : "";

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#F4F3EF;padding:24px;color:#3F3C36;">
<div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E2DB;">
<div style="background:#1E2F58;padding:20px 24px;">
<p style="margin:0;font-size:13px;color:rgba(255,255,255,0.7);letter-spacing:0.08em;text-transform:uppercase;">CaseLoad Select &middot; Operator notification${opts.replay ? " (REPLAY)" : ""}</p>
<h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#FFFFFF;">New firm onboarding submission</h1>
</div>
<div style="padding:24px;">
${replayBanner}
<p style="margin:14px 0 12px;font-size:15px;"><b>${esc(r.legal_name ?? r.submission_token)}</b> just submitted the firm onboarding form.</p>
<p style="margin:0 0 20px;font-size:13px;color:#6B665E;">
  Submission id: <code>${esc(r.id)}</code><br>
  Submission token: <code>${esc(r.submission_token)}</code><br>
  Received: ${esc(submittedFmt)}
</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 1 &middot; Business identity</td></tr>
${row("Legal name", r.legal_name)}
${row("Business Number", r.business_number)}
${row("Address", r.business_address)}
${row("Website", r.business_website)}
${row("Business email", r.business_email)}
${row("Authorized rep", r.authorized_rep_name)}
${row("Title", r.authorized_rep_title)}
${row("Rep email", r.authorized_rep_email)}
${row("Rep phone", r.authorized_rep_phone)}
${row("Rep bar of call", prettifyYearProvince(r.authorized_rep_year_of_call, r.authorized_rep_province_of_call))}
${row("Previous business names", r.previous_business_names)}
${row("Calendar booking URL", r.booking_url)}
${row("Office hours", r.office_hours)}
${row("Additional lawyers", prettifyAdditionalLawyers(r.additional_lawyers))}

<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 2 &middot; Practice scope</td></tr>
${row("Practice areas", prettifyPracticeAreas(r.practice_areas))}
${row("Other areas", r.practice_areas_other)}
${row("Service area", prettifyServiceArea(r.service_area, r.service_area_other))}
${row("Out of scope", r.out_of_scope_notes)}

<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 3 &middot; Existing systems + migration</td></tr>
${row("Current website form", r.existing_website_form_url)}
${row("Existing phone lines", r.existing_phone_lines)}
${row("Practice management system", prettifyPMS(r.practice_management_system, r.practice_management_system_other))}
${row("PMS integration preference", prettifyPMSIntegration(r.pms_integration_preference))}

<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 4 &middot; SMS</td></tr>
${row("Vertical", r.sms_vertical)}
${row("Phone preference", r.sms_sender_phone_preference)}

<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 5 &middot; Intake channels + WhatsApp</td></tr>
${row("Channels selected", prettifyChannels(r.intake_channels))}
${row("Number decision", r.whatsapp_number_decision)}
${row("Display name", r.whatsapp_display_name)}
${row("Verification doc type", r.whatsapp_business_verification_doc_note)}
${
  r.verification_doc_storage_path
    ? row(
        "Verification doc uploaded",
        `${r.verification_doc_original_name ?? "(file)"} (${r.verification_doc_size_bytes ? Math.round((r.verification_doc_size_bytes / 1024) * 10) / 10 : "?"} KB) — storage path: ${r.verification_doc_storage_path}`,
      )
    : ""
}

<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 6 &middot; Meta Business Manager</td></tr>
${row("Has FB account", boolToWord(r.has_facebook_account))}
${row("Has Meta Business Manager", boolToWord(r.has_meta_business_manager))}
${row("MBM URL", r.meta_business_manager_url)}
${row("Will add operator as admin", boolToWord(r.will_add_operator_as_admin))}
${row("Meta admin status", prettifyStatus(r.meta_admin_status))}
${row("Meta admin blocker", r.meta_admin_blocker_note)}

<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 7 &middot; Google Business Profile manager</td></tr>
${row("GBP Manager status", prettifyStatus(r.gbp_admin_status))}
${row("GBP Manager blocker", r.gbp_admin_blocker_note)}

<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 8 &middot; LinkedIn Company Page admin</td></tr>
${row("LinkedIn admin status", prettifyStatus(r.linkedin_admin_status))}
${row("LinkedIn admin blocker", r.linkedin_admin_blocker_note)}

${
  r.notes
    ? `<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Notes from the rep</td></tr>${row("Notes", r.notes)}`
    : ""
}

<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Signature</td></tr>
${row("Signed by", r.signed_name)}
${row("Signature email", r.signed_email)}
${row("Signed at", submittedFmt)}
</table>
<p style="margin:24px 0 0;font-size:13px;color:#6B665E;line-height:1.6;">
  Admin link: <a href="${adminUrl}">${esc(adminUrl)}</a> (signed download URL for the verification doc regenerates on each page load, 1h TTL).
</p>
</div>
<div style="background:#0D1520;padding:14px 24px;">
<p style="margin:0;font-size:11px;color:rgba(255,255,255,0.55);">CaseLoad Select &middot; Sign Better Cases</p>
</div></div></body></html>`;
}

function boolToWord(v: boolean | null | undefined): string | null {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return null;
}

function prettifyStatus(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === "not_started") return "Not started yet";
  if (v === "in_progress") return "In progress";
  if (v === "granted") return "Done — access granted";
  if (v === "blocked") return "Blocked";
  return v;
}

function prettifyChannels(v: string[] | null | undefined): string | null {
  if (!v || v.length === 0) return null;
  const labels: Record<string, string> = {
    whatsapp: "WhatsApp",
    sms: "SMS",
    voice: "Voice",
    instagram_dm: "Instagram DM",
    facebook_messenger: "Facebook Messenger",
    gbp_chat: "Google Business Profile chat",
    discuss: "Discuss together",
  };
  return v.map((k) => labels[k] ?? k).join(", ");
}

function prettifyYearProvince(
  year: number | string | null | undefined,
  province: string | null | undefined,
): string | null {
  const parts: string[] = [];
  if (year !== null && year !== undefined && String(year).trim() !== "") {
    parts.push(`Called ${year}`);
  }
  if (province?.trim()) parts.push(province.trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

function prettifyAdditionalLawyers(
  v: OnboardingSubmissionRecord["additional_lawyers"],
): string | null {
  if (!v || v.length === 0) return null;
  const rendered = v
    .filter((l) => (l.name && String(l.name).trim()) || (l.email && String(l.email).trim()))
    .map((l) => {
      const head = `${l.name ?? "(no name)"} <${l.email ?? "(no email)"}>`;
      const tail: string[] = [];
      if (l.year_of_call) tail.push(`called ${l.year_of_call}`);
      if (l.province_of_call) tail.push(String(l.province_of_call));
      return tail.length > 0 ? `${head} — ${tail.join(", ")}` : head;
    });
  return rendered.length > 0 ? rendered.join("; ") : null;
}

function prettifyPracticeAreas(v: string[] | null | undefined): string | null {
  if (!v || v.length === 0) return null;
  const labels: Record<string, string> = {
    family: "Family Law",
    civil_litigation: "Civil Litigation",
    real_estate: "Real Estate Law",
    corporate: "Corporate & Commercial",
    wills_estates: "Wills & Estates",
    employment: "Employment Law",
    immigration: "Immigration & Refugee",
    personal_injury: "Personal Injury",
    criminal: "Criminal Defence",
    landlord_tenant: "Landlord & Tenant",
    tax: "Tax Law",
    insurance: "Insurance Law",
    construction: "Construction Law",
    intellectual_property: "Intellectual Property",
    administrative: "Administrative & Regulatory",
  };
  return v.map((k) => labels[k] ?? k).join(", ");
}

function prettifyServiceArea(
  v: string | null | undefined,
  other: string | null | undefined,
): string | null {
  if (!v) return null;
  const labels: Record<string, string> = {
    toronto_core: "Toronto core (downtown + 416)",
    gta: "Greater Toronto Area",
    ontario_wide: "Ontario-wide",
    cross_border: "Cross-border (Ontario + other jurisdictions)",
    other: other?.trim() || "Other / multi-province",
  };
  return labels[v] ?? v;
}

function prettifyPMS(
  v: string | null | undefined,
  other: string | null | undefined,
): string | null {
  if (!v) return null;
  const labels: Record<string, string> = {
    clio: "Clio",
    practice_panther: "PracticePanther",
    mycase: "MyCase",
    cosmolex: "CosmoLex",
    leap: "LEAP",
    pclaw: "PCLaw",
    soluno: "Soluno",
    other: other?.trim() || "Other",
    none: "None / spreadsheets / file folders",
  };
  return labels[v] ?? v;
}

function prettifyPMSIntegration(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === "yes") return "Yes, integrate at go-live";
  if (v === "not_now") return "Not now — run side-by-side and revisit";
  if (v === "discuss") return "Discuss scope together";
  return v;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
