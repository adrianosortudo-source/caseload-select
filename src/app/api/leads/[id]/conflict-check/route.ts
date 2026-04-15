/**
 * /api/leads/[id]/conflict-check
 *
 * GET  — returns the latest conflict check result for a lead
 * POST — runs a new conflict check (or override an existing potential_conflict)
 *
 * POST body:
 *   {}                               — run fresh check
 *   { override_reason: "..." }       — override a potential_conflict result
 *
 * Auth: none — operator-only internal app, same trust level as the rest of the pipeline.
 * Override action (setting override_reason) is intentionally restricted to
 * potential_conflict only; confirmed_conflict cannot be self-overridden.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { runConflictCheck, getLatestConflictCheck } from "@/lib/conflict-check";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const check = await getLatestConflictCheck(id);

  if (!check) {
    return NextResponse.json({ check: null, message: "No conflict check run yet." });
  }

  return NextResponse.json({ check });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { override_reason?: string };

  // Fetch the lead
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, name, email, phone, law_firm_id")
    .eq("id", id)
    .single();

  if (error || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Override path: applies to an existing potential_conflict result
  if (body.override_reason) {
    const existing = await getLatestConflictCheck(id);
    if (!existing) {
      return NextResponse.json(
        { error: "No conflict check to override. Run a check first." },
        { status: 400 }
      );
    }
    if (existing.result === "confirmed_conflict") {
      return NextResponse.json(
        { error: "confirmed_conflict cannot be overridden via API. Contact Adriano." },
        { status: 400 }
      );
    }
    if (existing.result === "clear") {
      return NextResponse.json({ message: "Check is already clear. No override needed.", check: existing });
    }

    // Write override onto the existing row
    await supabase
      .from("conflict_checks")
      .update({ override_reason: body.override_reason, reviewed_by: "operator" })
      .eq("id", existing.id);

    return NextResponse.json({
      message: "Potential conflict overridden. Lead may now advance to consultation.",
      check_id: existing.id,
    });
  }

  // Fresh check path
  const result = await runConflictCheck({
    id: lead.id,
    name: lead.name,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    law_firm_id: lead.law_firm_id ?? null,
  });

  return NextResponse.json({
    result: result.result,
    checked_via: result.checked_via,
    matches: result.matches,
    check_id: result.check_id,
    allowed: result.result === "clear",
    message:
      result.result === "clear"
        ? "No conflicts found. Lead may advance to consultation."
        : result.result === "potential_conflict"
        ? "Potential conflict found. Review matches and override to proceed."
        : "Confirmed conflict of interest. Lead cannot advance without manual review.",
  });
}
