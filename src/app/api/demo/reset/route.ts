/**
 * POST /api/demo/reset
 *
 * Wipes all leads and intake_sessions for the Hartwell Law PC [DEMO] firm.
 * Keeps the firm record itself intact (no re-provisioning needed).
 *
 * Auth: x-admin-secret header must match ADMIN_API_SECRET env var.
 *
 * Usage:
 *   curl -X POST https://your-domain.com/api/demo/reset \
 *     -H "x-admin-secret: YOUR_SECRET"
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const DEMO_FIRM_NAME = "Hartwell Law PC [DEMO]";

export async function POST(req: Request) {
  const secret = req.headers.get("x-admin-secret");
  if (!secret || secret !== process.env.ADMIN_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve demo firm ID
  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id")
    .eq("name", DEMO_FIRM_NAME)
    .single();

  if (!firm) {
    return NextResponse.json({ error: "Demo firm not found" }, { status: 404 });
  }

  const firmId = firm.id as string;

  // Delete in parallel
  const [leadsResult, sessionsResult] = await Promise.all([
    supabase.from("leads").delete().eq("law_firm_id", firmId),
    supabase.from("intake_sessions").delete().eq("firm_id", firmId),
  ]);

  const leadsError   = leadsResult.error?.message ?? null;
  const sessionsError = sessionsResult.error?.message ?? null;

  if (leadsError || sessionsError) {
    return NextResponse.json({
      error: "Partial failure",
      leadsError,
      sessionsError,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    firmId,
    message: "Demo firm data wiped — leads and sessions deleted.",
  });
}
