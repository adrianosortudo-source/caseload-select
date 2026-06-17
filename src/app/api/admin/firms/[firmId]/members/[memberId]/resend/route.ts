/**
 * POST /api/admin/firms/[firmId]/members/[memberId]/resend
 *
 * Operator-only. Send a fresh 48h magic-link sign-in email to a member.
 * Refuses disabled members. Returns { ok, sent } where sent reflects whether
 * the email dispatch succeeded (Resend may be unconfigured in some envs).
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { resendMemberLink } from "@/lib/firm-members";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; memberId: string }> },
) {
  const { firmId, memberId } = await params;
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id, name, firm_name:branding->>firm_name")
    .eq("id", firmId)
    .maybeSingle<{ id: string; name: string | null; firm_name: string | null }>();

  const firmName = firm?.firm_name ?? firm?.name ?? "your firm";

  const result = await resendMemberLink({ firmId, memberId, firmName });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({ ok: true, sent: result.sent });
}
