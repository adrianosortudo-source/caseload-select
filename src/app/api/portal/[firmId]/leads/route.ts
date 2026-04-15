/**
 * GET /api/portal/[firmId]/leads
 *
 * Returns paginated leads for the firm. Read-only. Requires portal session cookie.
 *
 * Query params:
 *   limit  (default 20, max 50)
 *   offset (default 0)
 *   band   (filter by band: A|B|C|D|E)
 *   stage  (filter by pipeline stage)
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
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");
  const band = url.searchParams.get("band");
  const stage = url.searchParams.get("stage");

  let query = supabase
    .from("leads")
    .select("id, name, case_type, stage, band, cpi_score, urgency, created_at", { count: "exact" })
    .eq("law_firm_id", firmId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (band) query = query.eq("band", band);
  if (stage) query = query.eq("stage", stage);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ leads: data, total: count, limit, offset });
}
