/**
 * Admin firms management — operator-only.
 *
 * POST /api/admin/firms   { name, location? } → create a law firm client
 *
 * Auth: requireOperator(). Closes Jim Manico audit APP-002 (the route
 * was unauthenticated; "admin UI is operator-only" is the UI assumption,
 * not the route's protection layer).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireOperator } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

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
