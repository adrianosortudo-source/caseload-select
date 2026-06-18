/**
 * POST /api/admin/intake-firms
 *
 * Operator-only. Create a new firm in intake_firms (the Screen 2.0 firm table
 * that powers the triage portal, Portal access, onboarding, and firm_lawyers).
 * Distinct from POST /api/admin/firms, which writes the legacy
 * law_firm_clients table used by the old /firms admin UI.
 *
 * Only the name is required; every other column has a default. Tokens,
 * channel config, branding theme, and routing are filled in later during
 * setup. Returns the new firm so the caller can select it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ error: "name is too long (max 200 characters)" }, { status: 400 });
  }

  // Soft duplicate guard: a case-insensitive name match is almost always an
  // accidental re-create. The operator can pick the existing firm instead.
  const { data: existing } = await supabase
    .from("intake_firms")
    .select("id")
    .ilike("name", name)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: "A firm with this name already exists. Pick it from the list instead." },
      { status: 409 },
    );
  }

  const { data: inserted, error } = await supabase
    .from("intake_firms")
    .insert({ name, branding: { firm_name: name } })
    .select("id, name")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ firm: { id: inserted.id, name: inserted.name } }, { status: 201 });
}
