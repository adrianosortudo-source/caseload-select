/**
 * POST /api/firm-onboarding/[token]/submit
 *
 * Receives a submission from the public firm onboarding form at
 * /firm-onboarding/[token]. Writes the row to firm_onboarding_intake
 * and fires a notification email to the operator via Resend.
 *
 * The token is the credential. Anyone with the URL can submit. Idempotency
 * is intentionally not enforced server-side — if a rep submits twice we
 * keep both rows; the operator decides which is canonical.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";

interface SubmitBody {
  legal_name?: string;
  business_number?: string;
  business_address?: string;
  business_website?: string;
  business_email?: string;
  authorized_rep_name?: string;
  authorized_rep_title?: string;
  authorized_rep_email?: string;
  authorized_rep_phone?: string;
  sms_vertical?: string;
  sms_sender_phone_preference?: string;
  whatsapp_number_decision?: string;
  whatsapp_display_name?: string;
  whatsapp_business_verification_doc_note?: string;
  // Verification doc upload (populated by /api/firm-onboarding/[token]/upload
  // when the rep picks a file; null if they skipped).
  verification_doc_storage_path?: string | null;
  verification_doc_original_name?: string | null;
  verification_doc_size_bytes?: number | null;
  verification_doc_mime_type?: string | null;
  has_facebook_account?: string;
  has_meta_business_manager?: string;
  meta_business_manager_url?: string;
  will_add_operator_as_admin?: string;
  // Access-grant status tracking (one of: not_started, in_progress, granted, blocked)
  meta_admin_status?: string;
  meta_admin_blocker_note?: string;
  gbp_admin_status?: string;
  gbp_admin_blocker_note?: string;
  linkedin_admin_status?: string;
  linkedin_admin_blocker_note?: string;
  m365_admin_status?: string;
  m365_admin_blocker_note?: string;
  // Channel mix the firm wants (subset of: whatsapp, sms, voice,
  // instagram_dm, facebook_messenger, gbp_chat, discuss). Web is implied.
  intake_channels?: string[];
  // Typed signature at the bottom of the form (now the consent gesture).
  signed_name?: string;
  signed_email?: string;
  consent_acknowledged?: boolean;
  notes?: string;
  booking_url?: string;
  // Section 1 extensions
  office_hours?: string;
  additional_lawyers?: Array<{ name: string; email: string; role?: string }>;
  // Section 2: Practice scope
  practice_areas?: string[];
  practice_areas_other?: string;
  service_area?: string;
  service_area_other?: string;
  out_of_scope_notes?: string;
  // Section 3: Existing systems + PMS
  existing_website_form_url?: string;
  existing_phone_lines?: string;
  practice_management_system?: string;
  practice_management_system_other?: string;
  pms_integration_preference?: string;
}

const OPERATOR_EMAIL = process.env.OPERATOR_NOTIFICATION_EMAIL ?? "adriano@caseloadselect.ca";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // Rate limit (APP-007). 10 per hour per IP. The token gates content
  // access but not request frequency; tight bucket forces an attacker
  // to slow-roll guesses. Also caps the operator-notification email
  // spam that every successful POST triggers.
  const ip = ipFromRequest(req);
  const rl = await checkRateLimit('firmOnboarding', ip);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: 'rate limited' },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { token } = await params;

  if (!token || token.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 400 });
  }

  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  // The typed signature at the bottom of the form is the consent gesture.
  // Either signed_name OR consent_acknowledged must be present (the former
  // sets the latter on the client, but accept either to keep older clients
  // working).
  if (!body.signed_name?.trim() && !body.consent_acknowledged) {
    return NextResponse.json(
      { ok: false, error: "signature is required (type your full name at the bottom of the form)" },
      { status: 400 }
    );
  }

  if (!body.legal_name || !body.authorized_rep_email) {
    return NextResponse.json(
      { ok: false, error: "legal_name and authorized_rep_email are required" },
      { status: 400 }
    );
  }

  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const toBool = (v: string | undefined): boolean | null =>
    v === "yes" ? true : v === "no" ? false : null;

  const { data: inserted, error: insertErr } = await supabase
    .from("firm_onboarding_intake")
    .insert({
      submission_token: token,
      legal_name: body.legal_name ?? null,
      business_number: body.business_number ?? null,
      business_address: body.business_address ?? null,
      business_website: body.business_website ?? null,
      business_email: body.business_email ?? null,
      authorized_rep_name: body.authorized_rep_name ?? null,
      authorized_rep_title: body.authorized_rep_title ?? null,
      authorized_rep_email: body.authorized_rep_email ?? null,
      authorized_rep_phone: body.authorized_rep_phone ?? null,
      sms_vertical: body.sms_vertical ?? null,
      sms_sender_phone_preference: body.sms_sender_phone_preference ?? null,
      whatsapp_number_decision: body.whatsapp_number_decision ?? null,
      whatsapp_display_name: body.whatsapp_display_name ?? null,
      whatsapp_business_verification_doc_note:
        body.whatsapp_business_verification_doc_note ?? null,
      verification_doc_storage_path: body.verification_doc_storage_path ?? null,
      verification_doc_original_name: body.verification_doc_original_name ?? null,
      verification_doc_size_bytes: body.verification_doc_size_bytes ?? null,
      verification_doc_mime_type: body.verification_doc_mime_type ?? null,
      has_facebook_account: toBool(body.has_facebook_account),
      has_meta_business_manager:
        body.has_meta_business_manager === "yes"
          ? true
          : body.has_meta_business_manager === "no"
            ? false
            : null,
      meta_business_manager_url: body.meta_business_manager_url ?? null,
      will_add_operator_as_admin:
        body.will_add_operator_as_admin === "yes" ? true : null,
      meta_admin_status: body.meta_admin_status || null,
      meta_admin_blocker_note: body.meta_admin_blocker_note || null,
      gbp_admin_status: body.gbp_admin_status || null,
      gbp_admin_blocker_note: body.gbp_admin_blocker_note || null,
      linkedin_admin_status: body.linkedin_admin_status || null,
      linkedin_admin_blocker_note: body.linkedin_admin_blocker_note || null,
      m365_admin_status: body.m365_admin_status || null,
      m365_admin_blocker_note: body.m365_admin_blocker_note || null,
      intake_channels:
        Array.isArray(body.intake_channels) && body.intake_channels.length > 0
          ? body.intake_channels
          : null,
      signed_name: body.signed_name?.trim() || null,
      signed_email: body.signed_email?.trim() || body.authorized_rep_email || null,
      consent_acknowledged: true,
      notes: body.notes ?? null,
      booking_url: body.booking_url?.trim() || null,
      office_hours: body.office_hours?.trim() || null,
      additional_lawyers:
        Array.isArray(body.additional_lawyers) && body.additional_lawyers.length > 0
          ? body.additional_lawyers.filter((l) => l.name?.trim() || l.email?.trim())
          : null,
      practice_areas:
        Array.isArray(body.practice_areas) && body.practice_areas.length > 0
          ? body.practice_areas
          : null,
      practice_areas_other: body.practice_areas_other?.trim() || null,
      service_area: body.service_area?.trim() || null,
      service_area_other: body.service_area_other?.trim() || null,
      out_of_scope_notes: body.out_of_scope_notes?.trim() || null,
      existing_website_form_url: body.existing_website_form_url?.trim() || null,
      existing_phone_lines: body.existing_phone_lines?.trim() || null,
      practice_management_system: body.practice_management_system?.trim() || null,
      practice_management_system_other:
        body.practice_management_system_other?.trim() || null,
      pms_integration_preference: body.pms_integration_preference?.trim() || null,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
    .select("id, submission_token, submitted_at, legal_name, authorized_rep_email")
    .single();

  if (insertErr) {
    return NextResponse.json(
      { ok: false, error: `insert failed: ${insertErr.message}` },
      { status: 500 }
    );
  }

  // Fire operator notification. Best-effort; we still return success even if
  // the email fails (the row landed; operator can poll the table).
  try {
    const subject = `New firm onboarding submission · ${body.legal_name ?? token}`;
    const html = buildNotificationHtml({
      firmName: body.legal_name ?? token,
      token,
      submittedAt: inserted.submitted_at as string,
      body,
    });
    await sendEmail(OPERATOR_EMAIL, subject, html);
  } catch (err) {
    console.error("[firm-onboarding] notification email failed:", err);
  }

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    submitted_at: inserted.submitted_at,
  });
}

function buildNotificationHtml({
  firmName,
  token,
  submittedAt,
  body,
}: {
  firmName: string;
  token: string;
  submittedAt: string;
  body: SubmitBody;
}): string {
  const row = (label: string, value: string | undefined | null) =>
    value
      ? `<tr><td style="padding:6px 12px;border-bottom:1px solid #E4E2DB;font-weight:600;color:#1E2F58;width:35%;">${escapeHtml(label)}</td><td style="padding:6px 12px;border-bottom:1px solid #E4E2DB;color:#3F3C36;">${escapeHtml(value)}</td></tr>`
      : "";

  const yesNo = (v: string | undefined) =>
    v === "yes" ? "Yes" : v === "no" ? "No" : v === "not_sure" ? "Not sure" : v === "discuss" ? "Discuss" : v ?? "";

  const prettifyStatus = (v: string | undefined | null): string | null => {
    if (!v) return null;
    if (v === "not_started") return "Not started yet";
    if (v === "in_progress") return "In progress";
    if (v === "granted") return "Done — access granted";
    if (v === "blocked") return "Blocked";
    return v;
  };

  const prettifyChannels = (v: string[] | undefined | null): string | null => {
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
  };

  const prettifyAdditionalLawyers = (
    v: Array<{ name: string; email: string; role?: string }> | undefined | null
  ): string | null => {
    if (!v || v.length === 0) return null;
    return v
      .filter((l) => l.name?.trim() || l.email?.trim())
      .map((l) => `${l.name ?? "(no name)"} <${l.email ?? "(no email)"}>`)
      .join(", ");
  };

  const prettifyPracticeAreas = (v: string[] | undefined | null): string | null => {
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
  };

  const prettifyServiceArea = (
    v: string | undefined | null,
    other: string | undefined | null
  ): string | null => {
    if (!v) return null;
    const labels: Record<string, string> = {
      toronto_core: "Toronto core (downtown + 416)",
      gta: "Greater Toronto Area",
      ontario_wide: "Ontario-wide",
      cross_border: "Cross-border (Ontario + other jurisdictions)",
      other: other?.trim() || "Other / multi-province",
    };
    return labels[v] ?? v;
  };

  const prettifyPMS = (
    v: string | undefined | null,
    other: string | undefined | null
  ): string | null => {
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
  };

  const prettifyPMSIntegration = (v: string | undefined | null): string | null => {
    if (!v) return null;
    if (v === "yes") return "Yes, integrate at go-live";
    if (v === "not_now") return "Not now — run side-by-side and revisit";
    if (v === "discuss") return "Discuss scope together";
    return v;
  };

  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background:#F4F3EF; padding:24px; color:#3F3C36;">
  <div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E2DB;">
    <div style="background:#1E2F58;padding:20px 24px;">
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.7);letter-spacing:0.08em;text-transform:uppercase;">CaseLoad Select &middot; Operator notification</p>
      <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;color:#FFFFFF;">New firm onboarding submission</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 12px;font-size:15px;">
        <b>${escapeHtml(firmName)}</b> just submitted the firm onboarding form.
      </p>
      <p style="margin:0 0 20px;font-size:13px;color:#6B665E;">
        Submission token: <code>${escapeHtml(token)}</code><br>
        Received: ${escapeHtml(new Date(submittedAt).toLocaleString("en-CA", { timeZone: "America/Toronto" }))}
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 1 · Business identity</td></tr>
        ${row("Legal name", body.legal_name)}
        ${row("Business Number", body.business_number)}
        ${row("Address", body.business_address)}
        ${row("Website", body.business_website)}
        ${row("Business email", body.business_email)}
        ${row("Authorized rep", body.authorized_rep_name)}
        ${row("Title", body.authorized_rep_title)}
        ${row("Rep email", body.authorized_rep_email)}
        ${row("Rep phone", body.authorized_rep_phone)}
        ${row("Calendar booking URL", body.booking_url)}
        ${row("Office hours", body.office_hours)}
        ${row("Additional lawyers", prettifyAdditionalLawyers(body.additional_lawyers))}

        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 2 · Practice scope</td></tr>
        ${row("Practice areas", prettifyPracticeAreas(body.practice_areas))}
        ${row("Other areas", body.practice_areas_other)}
        ${row("Service area", prettifyServiceArea(body.service_area, body.service_area_other))}
        ${row("Out of scope", body.out_of_scope_notes)}

        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 3 · Existing systems + migration</td></tr>
        ${row("Current website form", body.existing_website_form_url)}
        ${row("Existing phone lines", body.existing_phone_lines)}
        ${row("Practice management system", prettifyPMS(body.practice_management_system, body.practice_management_system_other))}
        ${row("PMS integration preference", prettifyPMSIntegration(body.pms_integration_preference))}
        ${row("Calendar booking URL", body.booking_url)}

        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 4 · SMS</td></tr>
        ${row("Vertical", body.sms_vertical)}
        ${row("Phone preference", body.sms_sender_phone_preference)}

        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 5 · Intake channels + WhatsApp</td></tr>
        ${row("Channels selected", prettifyChannels(body.intake_channels))}
        ${row("Number decision", body.whatsapp_number_decision)}
        ${row("Display name", body.whatsapp_display_name)}
        ${row("Verification doc type", body.whatsapp_business_verification_doc_note)}
        ${
          body.verification_doc_storage_path
            ? row(
                "Verification doc uploaded",
                `${body.verification_doc_original_name ?? "(file)"} (${body.verification_doc_size_bytes ? Math.round((body.verification_doc_size_bytes / 1024) * 10) / 10 : "?"} KB) — storage path: ${body.verification_doc_storage_path}`
              )
            : ""
        }

        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 6 · Meta Business Manager</td></tr>
        ${row("Has FB account", yesNo(body.has_facebook_account))}
        ${row("Has Meta Business Manager", yesNo(body.has_meta_business_manager))}
        ${row("MBM URL", body.meta_business_manager_url)}
        ${row("Will add operator as admin", yesNo(body.will_add_operator_as_admin))}
        ${row("Meta admin status", prettifyStatus(body.meta_admin_status))}
        ${row("Meta admin blocker", body.meta_admin_blocker_note)}

        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 7 · Google Business Profile manager</td></tr>
        ${row("GBP Manager status", prettifyStatus(body.gbp_admin_status))}
        ${row("GBP Manager blocker", body.gbp_admin_blocker_note)}

        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 8 · LinkedIn Company Page admin</td></tr>
        ${row("LinkedIn admin status", prettifyStatus(body.linkedin_admin_status))}
        ${row("LinkedIn admin blocker", body.linkedin_admin_blocker_note)}

        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Section 9 · Microsoft 365 Exchange admin</td></tr>
        ${row("M365 admin status", prettifyStatus(body.m365_admin_status))}
        ${row("M365 admin blocker", body.m365_admin_blocker_note)}

        ${
          body.notes
            ? `<tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Notes</td></tr>${row("Rep notes", body.notes)}`
            : ""
        }

        <tr><td colspan="2" style="padding:14px 12px 6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C4B49A;font-weight:700;">Signature</td></tr>
        ${row("Signed by", body.signed_name)}
        ${row("Signature email", body.signed_email)}
        ${row("Signed at", new Date(submittedAt).toLocaleString("en-CA", { timeZone: "America/Toronto" }))}
      </table>

      <p style="margin:24px 0 0;font-size:13px;color:#6B665E;line-height:1.6;">
        Next steps: review the data, generate the DRG-side artifacts (intake_firms row, GHL sub-account configuration, A2P brand registration, Meta Business + WABA registration), and reach back out to ${escapeHtml(body.authorized_rep_name ?? "the rep")} when you are ready to schedule the technical setup session.
      </p>
    </div>
    <div style="background:#0D1520;padding:14px 24px;">
      <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.55);">CaseLoad Select &middot; Sign Better Cases</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
