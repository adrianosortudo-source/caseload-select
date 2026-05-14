/**
 * GET /api/admin/triage/stream-check
 *
 * Operator-scoped variant of /api/portal/[firmId]/triage/stream-check.
 * Returns aggregate state across ALL firms for the admin triage queue.
 *
 * Same shape: { count, latest_updated_at }. Same purpose: cheap
 * polling fingerprint so the operator console's triage list refreshes
 * only when there's something new.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getOperatorSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Lifecycle filter — see portal stream-check for the 2026-05-14 doctrine
  // background. Defaults to 'triaging' for back-compat; the admin triage
  // page passes ?status=declined when the Declined tab is open.
  const statusParam = new URL(req.url).searchParams.get("status");
  const status: "triaging" | "declined" =
    statusParam === "declined" ? "declined" : "triaging";

  const { count, error: countErr } = await supabase
    .from("screened_leads")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }

  const { data: latestRow, error: latestErr } = await supabase
    .from("screened_leads")
    .select("updated_at")
    .eq("status", status)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) {
    return NextResponse.json({ error: latestErr.message }, { status: 500 });
  }

  return NextResponse.json({
    count: count ?? 0,
    latest_updated_at: latestRow?.updated_at ?? null,
  });
}
