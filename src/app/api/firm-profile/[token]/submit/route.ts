/**
 * POST /api/firm-profile/[token]/submit
 *
 * Receives a Firm Profile submission (Form 2) from /firm-profile/[token].
 * Writes a row to firm_onboarding_intake with form_type='profile' and fires
 * the operator notification. Sibling to the registration submit route; the
 * token is the credential, idempotency is not enforced (the operator decides
 * which row is canonical).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendOperatorNotification } from "@/lib/firm-onboarding-notification";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { validateClientListSubmission } from "@/lib/firm-onboarding-client-list";

interface ProfileBody {
  legal_name?: string;
  authorized_rep_email?: string;
  office_model?: string;
  firm_size?: string;
  annual_revenue_band?: string;
  second_contact?: string;
  ooo_pattern?: string;
  past_clients_active?: string | number | null;
  past_clients_mid?: string | number | null;
  past_clients_closed?: string | number | null;
  baseline_inquiry_volume?: string | number | null;
  fee_structure?: string;
  fee_exclusions?: string;
  fee_deal_variation?: string;
  fee_publish_preference?: string;
  payment_methods?: string[];
  esignature_tool?: string;
  marketing_crm?: string;
  brand_assets_status?: string;
  brand_assets_notes?: string;
  photos_status?: string;
  social_linkedin_personal?: string;
  social_instagram?: string;
  social_x?: string;
  social_facebook?: string;
  icp_want_more?: string;
  icp_decline?: string;
  review_comfort?: string;
  profile_notes?: string;
  signed_name?: string;
  signed_email?: string;
  customer_base_storage_path?: string | null;
  customer_base_original_name?: string | null;
  customer_base_size_bytes?: number | null;
  customer_base_mime_type?: string | null;
  client_list_path?: unknown;
  client_list_files?: unknown;
  client_list_attested?: unknown;
  client_list_self_upload_confirmed?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = ipFromRequest(req);
  const rl = await checkRateLimit("firmOnboarding", ip);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const { token } = await params;
  if (!token || token.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 400 });
  }

  let body: ProfileBody;
  try {
    body = (await req.json()) as ProfileBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.legal_name?.trim()) {
    return NextResponse.json({ ok: false, error: "legal_name is required" }, { status: 400 });
  }
  if (!body.signed_name?.trim()) {
    return NextResponse.json(
      { ok: false, error: "signature is required (type your full name at the bottom of the form)" },
      { status: 400 },
    );
  }

  const clientList = validateClientListSubmission(
    {
      client_list_path: body.client_list_path,
      client_list_files: body.client_list_files,
      client_list_attested: body.client_list_attested,
      client_list_self_upload_confirmed: body.client_list_self_upload_confirmed,
    },
    token,
  );
  if (!clientList.ok) {
    return NextResponse.json({ ok: false, error: clientList.error }, { status: 400 });
  }

  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const toInt = (v: string | number | null | undefined): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
    if (!Number.isInteger(n) || n < 0 || n > 2_000_000_000) return null;
    return n;
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("firm_onboarding_intake")
    .insert({
      submission_token: token,
      form_type: "profile",
      legal_name: body.legal_name.trim(),
      authorized_rep_email: body.authorized_rep_email?.trim() || null,
      office_model: body.office_model?.trim() || null,
      firm_size: body.firm_size?.trim() || null,
      annual_revenue_band: body.annual_revenue_band?.trim() || null,
      second_contact: body.second_contact?.trim() || null,
      ooo_pattern: body.ooo_pattern?.trim() || null,
      past_clients_active: toInt(body.past_clients_active),
      past_clients_mid: toInt(body.past_clients_mid),
      past_clients_closed: toInt(body.past_clients_closed),
      baseline_inquiry_volume: toInt(body.baseline_inquiry_volume),
      fee_structure: body.fee_structure?.trim() || null,
      fee_exclusions: body.fee_exclusions?.trim() || null,
      fee_deal_variation: body.fee_deal_variation?.trim() || null,
      fee_publish_preference: body.fee_publish_preference?.trim() || null,
      payment_methods:
        Array.isArray(body.payment_methods) && body.payment_methods.length > 0 ? body.payment_methods : null,
      esignature_tool: body.esignature_tool?.trim() || null,
      marketing_crm: body.marketing_crm?.trim() || null,
      brand_assets_status: body.brand_assets_status?.trim() || null,
      brand_assets_notes: body.brand_assets_notes?.trim() || null,
      photos_status: body.photos_status?.trim() || null,
      social_linkedin_personal: body.social_linkedin_personal?.trim() || null,
      social_instagram: body.social_instagram?.trim() || null,
      social_x: body.social_x?.trim() || null,
      social_facebook: body.social_facebook?.trim() || null,
      icp_want_more: body.icp_want_more?.trim() || null,
      icp_decline: body.icp_decline?.trim() || null,
      review_comfort: body.review_comfort?.trim() || null,
      profile_notes: body.profile_notes?.trim() || null,
      signed_name: body.signed_name.trim(),
      signed_email: body.signed_email?.trim() || body.authorized_rep_email?.trim() || null,
      customer_base_storage_path: body.customer_base_storage_path ?? null,
      customer_base_original_name: body.customer_base_original_name ?? null,
      customer_base_size_bytes: body.customer_base_size_bytes ?? null,
      customer_base_mime_type: body.customer_base_mime_type ?? null,
      client_list_path: clientList.value.path,
      client_list_files: clientList.value.files,
      client_list_attested_at: new Date().toISOString(),
      client_list_self_upload_confirmed: clientList.value.selfUploadConfirmed,
      consent_acknowledged: true,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
    .select("id, submission_token, submitted_at, legal_name")
    .single();

  if (insertErr) {
    return NextResponse.json({ ok: false, error: `insert failed: ${insertErr.message}` }, { status: 500 });
  }

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
