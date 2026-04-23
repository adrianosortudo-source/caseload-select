/**
 * Admin firms management  -  no CRON_SECRET needed (admin UI is operator-only).
 *
 * POST /api/admin/firms   { name, location? } → create a law firm client
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const { name, location } = await req.json() as { name?: string; location?: string };
  if (!name || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const { error } = await supabase.from("law_firm_clients").insert({
    name: name.trim(),
    location: location?.trim() || null,
    status: "active",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
