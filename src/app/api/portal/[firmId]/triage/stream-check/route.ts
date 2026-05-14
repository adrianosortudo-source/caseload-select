/**
 * GET /api/portal/[firmId]/triage/stream-check
 *
 * Lightweight presence-check endpoint that the triage page polls every
 * 15 seconds while the tab is visible. Returns a small JSON blob:
 *
 *   { count: number, latest_updated_at: ISO timestamp | null }
 *
 * The client compares the returned values against what it saw on its
 * last poll. If either changed, it triggers `router.refresh()` to pull
 * the server-rendered queue. If neither changed, nothing happens — the
 * page stays static until the next focus or interval.
 *
 * Why this exists instead of Supabase Realtime:
 *   screened_leads is RLS-forced to service-role-only (Jim Manico audit
 *   confirmed this is the right posture). Browser Realtime would require
 *   either migrating to Supabase auth + adding firm-scoped policies, or
 *   running an SSE relay on a serverless function (Vercel function
 *   timeout fights long-lived streams). Polling is the pragmatic answer
 *   at current scale (single-digit leads per firm per day).
 *
 * Cost: one Postgres count + one max-aggregate per call. Cheap. Bypasses
 * the heavier queue rendering pipeline, so the 15-second interval is
 * comfortably inside any rate-limit budget.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getPortalSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;

  // Standard portal route guard (matches the triage page's auth shape).
  const session = await getPortalSession();
  if (!session || (session.role !== "operator" && session.firm_id !== firmId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Lifecycle filter — defaults to 'triaging' (the active queue) for
  // back-compat. The 2026-05-14 visibility doctrine added a Declined tab
  // to the portal, so the client now passes ?status=declined when that
  // tab is open. Anything else falls through to triaging.
  const statusParam = new URL(req.url).searchParams.get("status");
  const status: "triaging" | "declined" =
    statusParam === "declined" ? "declined" : "triaging";

  // Count rows + latest updated_at for the firm at this lifecycle state.
  // These two numbers fingerprint the queue's state cheaply; if neither
  // changes, the client doesn't refetch the full server-rendered page.
  const { count, error: countErr } = await supabase
    .from("screened_leads")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", firmId)
    .eq("status", status);

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }

  const { data: latestRow, error: latestErr } = await supabase
    .from("screened_leads")
    .select("updated_at")
    .eq("firm_id", firmId)
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
