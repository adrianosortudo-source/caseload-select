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
import { sendOperatorNotification } from "@/lib/firm-onboarding-notification";
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
  // Bar-of-call data for the authorized rep. Both are used by directory
  // submission prep. Year is a string on the wire to keep the form input
  // permissive; we coerce to integer at insert time.
  authorized_rep_year_of_call?: string | number | null;
  authorized_rep_province_of_call?: string;
  // Prior business names / d/b/a, free text. Used by directory cleanup work.
  previous_business_names?: string;
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
  // M365 admin fields were dropped from the form 2026-05-14 (Resend
  // handles outbound email via DNS, no Exchange Admin role needed
  // from the firm). The DB columns stay populated only for historical
  // submissions; new submissions never set them.
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
  additional_lawyers?: Array<{
    name?: string;
    email?: string;
    role?: string;
    year_of_call?: string | number | null;
    province_of_call?: string;
  }>;
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

// Operator-notification recipient now lives in
// src/lib/firm-onboarding-notification.ts. The previous hardcoded fallback
// (adriano@caseloadselect.ca) was undeliverable for the operator's actual
// inbox; the new fallback is adrianosortudo@gmail.com per the 2026-05-20
// audit. OPERATOR_NOTIFICATION_EMAIL is set in Vercel for Production and
// Development; set Preview via the dashboard (the CLI cannot add Preview
// env vars non-interactively).

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

  // Year-of-call is captured as a string in the form (the input is type=number
  // but values arrive serialized). Coerce to integer if the value parses
  // cleanly and lies in a plausible bar-call range; otherwise persist null.
  // SMALLINT in Postgres covers -32768..32767 — well past any plausible year.
  const toYearOfCall = (v: string | number | null | undefined): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
    if (!Number.isInteger(n)) return null;
    if (n < 1900 || n > 2100) return null;
    return n;
  };

  // Normalise the additional_lawyers JSONB so the stored shape always has
  // the five known keys and drops rows that are completely empty. Keeps
  // old `{name, email, role}` rows working without errors.
  const normaliseAdditionalLawyers = (
    rows: SubmitBody["additional_lawyers"]
  ): Array<{
    name: string;
    email: string;
    role: string;
    year_of_call: number | null;
    province_of_call: string;
  }> | null => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const cleaned = rows
      .map((l) => ({
        name: (l.name ?? "").trim(),
        email: (l.email ?? "").trim(),
        role: (l.role ?? "").trim(),
        year_of_call: toYearOfCall(l.year_of_call ?? null),
        province_of_call: (l.province_of_call ?? "").trim(),
      }))
      .filter(
        (l) =>
          l.name ||
          l.email ||
          l.role ||
          l.year_of_call !== null ||
          l.province_of_call,
      );
    return cleaned.length > 0 ? cleaned : null;
  };

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
      authorized_rep_year_of_call: toYearOfCall(body.authorized_rep_year_of_call),
      authorized_rep_province_of_call:
        body.authorized_rep_province_of_call?.trim() || null,
      previous_business_names: body.previous_business_names?.trim() || null,
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
      // M365 columns intentionally left out of new inserts (2026-05-14).
      // The DB column nullability handles this; historical rows stay
      // populated.
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
      additional_lawyers: normaliseAdditionalLawyers(body.additional_lawyers),
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

  // Fire operator notification. The helper persists delivery state on the
  // row (notification_sent_at / notification_error / notification_attempts /
  // notification_last_attempt_at) regardless of outcome. We do NOT fail the
  // user's submission if the email cannot send — the row already landed and
  // the operator can replay the notification from /admin/onboarding-submissions/[id]
  // once the underlying issue (Resend key revoked, sender domain unverified,
  // recipient inbox down, etc.) is resolved. The admin list page surfaces
  // failed/pending rows with a status badge so this never goes unnoticed
  // again.
  const notify = await sendOperatorNotification(inserted.id);

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    submitted_at: inserted.submitted_at,
    notification: notify.ok
      ? { status: "sent", sentTo: notify.sentTo }
      : { status: "failed", error: notify.error, sentTo: notify.sentTo },
  });
}

// The notification HTML builder + escape helper moved to
// src/lib/firm-onboarding-notification.ts so the retry endpoint can re-use
// the same builder. The route is now purely persistence + delegate-to-helper.
