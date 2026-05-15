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

  // Lifecycle filter. Two surfaces:
  //   ?view=active   (default) → status='triaging'
  //   ?view=history             → status IN ('passed','referred','declined')
  //
  // Back-compat: a single ?status=X is also honoured when X is one of the
  // valid lifecycle states. The triage queue page passes view=; other
  // callers (operator scripts, ad-hoc) can still pass status=.
  const url = new URL(req.url);
  const viewParam = url.searchParams.get("view");
  const statusParam = url.searchParams.get("status");
  const VALID_STATUSES = ["triaging", "taken", "passed", "declined", "referred"] as const;
  const isHistoryView = viewParam === "history";
  const singleStatus = VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])
    ? (statusParam as (typeof VALID_STATUSES)[number])
    : null;

  // Build the count query.
  let countQuery = supabase
    .from("screened_leads")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", firmId);
  if (isHistoryView) {
    countQuery = countQuery.in("status", ["passed", "referred", "declined"]);
  } else if (singleStatus) {
    countQuery = countQuery.eq("status", singleStatus);
  } else {
    countQuery = countQuery.eq("status", "triaging");
  }

  const { count, error: countErr } = await countQuery;

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }

  // Build the latest-updated-at fingerprint query with the same filter.
  let latestQuery = supabase
    .from("screened_leads")
    .select("updated_at")
    .eq("firm_id", firmId);
  if (isHistoryView) {
    latestQuery = latestQuery.in("status", ["passed", "referred", "declined"]);
  } else if (singleStatus) {
    latestQuery = latestQuery.eq("status", singleStatus);
  } else {
    latestQuery = latestQuery.eq("status", "triaging");
  }

  const { data: latestRow, error: latestErr } = await latestQuery
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
