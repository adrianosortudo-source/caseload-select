/**
 * GET /api/portal/[firmId]/sessions
 *
 * Returns recent intake sessions for the firm. Read-only. Requires portal session.
 *
 * Query params:
 *   limit  (default 10, max 25)
 *   status (filter: in_progress|complete|expired)
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest, { params }: { params: Promise<{ firmId: string }> }) {
  const session = await getPortalSession();
  const { firmId } = await params;

  if (!session || session.firm_id !== firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10"), 25);
  const status = url.searchParams.get("status");

  let query = supabase
    .from("intake_sessions")
    .select("id, channel, status, practice_area, band, otp_verified, crm_synced, situation_summary, created_at")
    .eq("firm_id", firmId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ sessions: data });
}
