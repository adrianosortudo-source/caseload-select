/**
 * POST /api/portal/request-link
 *
 * Lawyer-initiated magic-link request. Lawyer enters their email at
 * /portal/login; this endpoint resolves only lawyer memberships, generates a
 * 48h HMAC token via the existing portal-auth utilities, and emails the link
 * via Resend. Operators use the separate /operator/login flow.
 *
 * Body: { email: string }
 *
 * Response is intentionally always 200 with `{ ok: true }` regardless of
 * whether the email matched a firm. Returning a different code on no-match
 * would let an attacker enumerate authorized lawyer emails. The email lands
 * (or doesn't) silently.
 *
 * To authorize a lawyer email for a firm, set
 *   intake_firms.branding.lawyer_email = "lawyer@firm.com"
 * during onboarding. This is a single-lawyer-per-firm MVP shape; the column
 * can be widened to an array (lawyer_emails) when 2-lawyer firms onboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePortalToken } from "@/lib/portal-auth";
import { buildMagicLinkUrl, renderMagicLinkEmail } from "@/lib/portal-magic-link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FirmRow {
  id: string;
  name: string | null;
  branding: { lawyer_email?: string; firm_name?: string } | null;
}

interface FirmLawyerRow {
  id: string;
  firm_id: string;
  email: string;
  role: "lawyer" | "admin" | "staff" | "operator";
  intake_firms: FirmRow | null;
}

export async function POST(req: NextRequest) {
  // Rate limit (APP-007): magic-link send is the highest-value enumeration
  // surface. Always returns 200 anyway (anti-enumeration), so we silently
  // drop the email send when the bucket is empty — attackers can't tell
  // throttled requests from successful ones. 5 requests per 10 minutes
  // per IP, generous for a legit lawyer typing their email twice.
  const ip = ipFromRequest(req);
  const rl = await checkRateLimit("requestLink", ip);
  if (!rl.ok) {
    // Silent drop — same response shape as a malformed email.
    return NextResponse.json({ ok: true });
  }

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ ok: true }); // silent
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: true }); // silent
  }

  // Resolve email → firm. Two paths:
  //
  //   1. firm_lawyers (canonical, multi-member + role-aware). Picks the most
  //      recently signed-in firm-side row when an email belongs to multiple
  //      firms. Lawyer, admin and staff all mint the same firm-scoped lawyer
  //      session role.
  //   2. intake_firms.branding.lawyer_email (legacy, backward compat).
  //      One-firm-per-email; defaults role='lawyer'.
  //
  // The role filter is deliberate. An email may belong to both an operator and
  // a firm-side row; this surface must never choose between them by sign-in
  // time. Any canonical membership suppresses the legacy fallback, so an
  // operator-only member cannot gain a lawyer token through stale branding.
  //
  // Embed hint (2026-06-05 fix): PostgREST detects TWO foreign-key
  // relationships between firm_lawyers and intake_firms:
  //   - firm_lawyers.firm_id            → intake_firms.id (the lawyer's firm)
  //   - intake_firms.default_lead_id    → firm_lawyers.id (firm's default lead;
  //                                       added by the /admin/routing work)
  // Without disambiguation the embed errors with "Could not embed because
  // more than one relationship was found", returns zero rows, and the route
  // silently 200s. We explicitly name the constraint to pick the
  // firm-of-this-lawyer direction.

  let firmId: string | null = null;
  let firmRow: FirmRow | null = null;
  let lawyerId: string | undefined;
  const { data: lawyerRows, error: lawyerLookupError } = await supabase
    .from("firm_lawyers")
    .select(
      "id, firm_id, email, role, intake_firms!firm_lawyers_firm_id_fkey!inner(id, name, branding)",
    )
    .ilike("email", email)
    .eq("disabled", false)
    .in("role", ["lawyer", "admin", "staff"])
    .order("last_signed_in_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .returns<FirmLawyerRow[]>();

  if (lawyerLookupError) {
    // Internal-only visibility. Never log the raw email (anti-enumeration /
    // privacy); the external response stays { ok: true } regardless.
    console.error(
      `[request-link] firm_lawyers lookup failed: ${lawyerLookupError.message}`,
    );
  }

  if (lawyerRows && lawyerRows.length > 0) {
    const row = lawyerRows[0];
    firmId = row.firm_id;
    firmRow = row.intake_firms;
    lawyerId = row.id;
  } else {
    // Only records with no canonical membership may use the legacy branding
    // field. Disabled rows and operator-only rows both suppress fallback.
    const { data: canonicalRows, error: canonicalLookupError } = await supabase
      .from("firm_lawyers")
      .select("id")
      .ilike("email", email)
      .limit(1);
    if (canonicalLookupError) {
      console.error(
        `[request-link] canonical membership lookup failed: ${canonicalLookupError.message}`,
      );
      return NextResponse.json({ ok: true });
    }
    if (canonicalRows && canonicalRows.length > 0) {
      return NextResponse.json({ ok: true });
    }

    // Legacy fallback: branding.lawyer_email
    const { data: firms, error: legacyLookupError } = await supabase
      .from("intake_firms")
      .select("id, name, branding")
      .filter("branding->>lawyer_email", "eq", email);
    if (legacyLookupError) {
      // Same no-raw-email rule as above.
      console.error(
        `[request-link] legacy firm lookup failed: ${legacyLookupError.message}`,
      );
    }
    if (firms && firms.length > 0) {
      firmRow = firms[0] as FirmRow;
      firmId = firmRow.id;
    }
  }

  if (!firmId || !firmRow) {
    return NextResponse.json({ ok: true }); // silent
  }

  const token = generatePortalToken(firmId, { role: "lawyer", lawyer_id: lawyerId });
  const magicLink = buildMagicLinkUrl(token, "lawyer");

  const firmName = firmRow.branding?.firm_name ?? firmRow.name ?? "your firm";
  const html = renderMagicLinkEmail({ firmName, magicLink, role: "lawyer" });

  try {
    await sendEmail(email, "CaseLoad Select sign-in link", html);
  } catch (err) {
    // Don't surface email failures to the caller. Operator can re-send via
    // /api/portal/generate if needed. Still log internally so a broken
    // send isn't invisible.
    console.error(
      `[request-link] email send failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return NextResponse.json({ ok: true });
}
