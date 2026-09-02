/**
 * POST /api/operator/request-link
 *
 * Dedicated operator magic-link request. The lookup is intentionally limited
 * to active firm_lawyers rows with role='operator'. If the same email also has
 * a lawyer membership, that row cannot influence the operator sign-in result.
 *
 * The response is always { ok: true } to prevent account enumeration.
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePortalToken } from "@/lib/portal-auth";
import { buildMagicLinkUrl, renderMagicLinkEmail } from "@/lib/portal-magic-link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/email";
import { checkRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { isLocalOrPreviewHost, isOperatorHost } from "@/lib/app-origins";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FirmRow {
  id: string;
  name: string | null;
  branding: { firm_name?: string } | null;
}

interface OperatorRow {
  id: string;
  firm_id: string;
  role: "operator";
  intake_firms: FirmRow | null;
}

export async function POST(req: NextRequest) {
  const hostname = req.nextUrl?.hostname ?? new URL(req.url).hostname;
  if (!isLocalOrPreviewHost(hostname) && !isOperatorHost(hostname)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ip = ipFromRequest(req);
  const rl = await checkRateLimit("requestLink", ip);
  if (!rl.ok) {
    return NextResponse.json({ ok: true });
  }

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ ok: true });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: true });
  }

  const { data: operatorRows, error: operatorLookupError } = await supabase
    .from("firm_lawyers")
    .select(
      "id, firm_id, role, intake_firms!firm_lawyers_firm_id_fkey!inner(id, name, branding)",
    )
    .ilike("email", email)
    .eq("disabled", false)
    .eq("role", "operator")
    .order("last_signed_in_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .returns<OperatorRow[]>();

  if (operatorLookupError) {
    console.error(
      `[operator-request-link] operator lookup failed: ${operatorLookupError.message}`,
    );
  }

  const operator = operatorRows?.[0];
  const firm = operator?.intake_firms;
  if (!operator || !firm) {
    return NextResponse.json({ ok: true });
  }

  const token = generatePortalToken(operator.firm_id, {
    role: "operator",
    lawyer_id: operator.id,
  });
  const magicLink = buildMagicLinkUrl(token, "operator");
  const firmName = firm.branding?.firm_name ?? firm.name ?? "CaseLoad Select";
  const html = renderMagicLinkEmail({ firmName, magicLink, role: "operator" });

  try {
    await sendEmail(email, "CaseLoad Select operator sign-in link", html);
  } catch (err) {
    console.error(
      `[operator-request-link] email send failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return NextResponse.json({ ok: true });
}
