/**
 * POST /api/admin/onboarding-submissions/[id]/client-list/verify
 *
 * Operator-only. Marks a share_with_us client-list submission as imported
 * and verified in the firm's CRM, with an optional note. This is the gate
 * before the working copy may be deleted (client-list/delete-working-copy).
 *
 * Idempotent: calling again overwrites the verified timestamp and note, so
 * the operator can correct a note without a separate edit path.
 *
 * Auth: getOperatorSession() (same gate as /admin/*).
 *
 * Returns:
 *   200 { ok: true, verified_at }
 *   400 { ok: false, error }               // missing id, note too long, or wrong path
 *   401 { ok: false, error: "unauthorized" }
 *   404 { ok: false, error: "submission not found" }
 */

import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const MAX_NOTE_LENGTH = 2000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  let body: { note?: unknown } = {};
  try {
    body = (await req.json()) as { note?: unknown };
  } catch {
    // No body is fine; note is optional.
  }
  const noteRaw = typeof body.note === "string" ? body.note.trim() : "";
  if (noteRaw.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ ok: false, error: "note too long; max 2000 characters" }, { status: 400 });
  }
  const note = noteRaw.length > 0 ? noteRaw : null;

  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("firm_onboarding_intake")
    .select("id, client_list_path")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ ok: false, error: `lookup failed: ${lookupErr.message}` }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ ok: false, error: "submission not found" }, { status: 404 });
  }
  if (existing.client_list_path !== "share_with_us") {
    return NextResponse.json(
      { ok: false, error: "this submission is not on the share_with_us path" },
      { status: 400 },
    );
  }

  const verifiedAt = new Date().toISOString();
  const { error: updateErr } = await supabaseAdmin
    .from("firm_onboarding_intake")
    .update({ client_list_import_verified_at: verifiedAt, client_list_import_verified_note: note })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ ok: false, error: `update failed: ${updateErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, verified_at: verifiedAt });
}
