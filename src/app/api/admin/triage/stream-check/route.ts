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

  // Lifecycle filter — view=active (default, triaging) or view=history
  // (passed/referred/declined). See portal stream-check for the full
  // doctrine (2026-05-15 Band D refactor). Back-compat: ?status=X also
  // accepted when X is a valid lifecycle state.
  const url = new URL(req.url);
  const viewParam = url.searchParams.get("view");
  const statusParam = url.searchParams.get("status");
  const VALID_STATUSES = ["triaging", "taken", "passed", "declined", "referred"] as const;
  const isHistoryView = viewParam === "history";
  const singleStatus = VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])
    ? (statusParam as (typeof VALID_STATUSES)[number])
    : null;

  let countQuery = supabase
    .from("screened_leads")
    .select("id", { count: "exact", head: true });
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

  let latestQuery = supabase
    .from("screened_leads")
    .select("updated_at");
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
