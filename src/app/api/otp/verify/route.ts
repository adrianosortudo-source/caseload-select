/**
 * POST /api/otp/verify
 *
 * Verifies a 6-digit OTP against the stored code in the session.
 * On success, marks the session otp_verified=true and clears the stored code.
 *
 * Band A/B: triggers retainer agreement generation.
 * Band A/B/C: auto-promotes session to a pipeline lead (idempotent).
 *
 * Body: { session_id: string; code: string }
 * Returns: { verified: true } | { verified: false; reason: "invalid" | "expired" }
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { triggerRetainerAgreement } from "@/lib/retainer";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { session_id?: string; code?: string };
    const { session_id, code } = body;

    if (!session_id || !code) {
      return NextResponse.json({ error: "session_id and code required" }, { status: 400 });
    }

    // Load session OTP fields + band + firm_id for retainer trigger
    const { data: session, error: sessionErr } = await supabase
      .from("intake_sessions")
      .select("id, otp_code, otp_expires_at, otp_verified, band, firm_id, contact, practice_area, situation_summary, scoring")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Already verified — re-trigger downstream (idempotent)
    if (session.otp_verified) {
      void triggerRetainerIfEligible(session_id, session.firm_id, session.band);
      return NextResponse.json({ verified: true });
    }

    // Check expiry
    if (!session.otp_expires_at || new Date(session.otp_expires_at) < new Date()) {
      return NextResponse.json({ verified: false, reason: "expired" });
    }

    // Check code
    if (!session.otp_code || session.otp_code !== code.trim()) {
      return NextResponse.json({ verified: false, reason: "invalid" });
    }

    // Mark verified, clear code
    await supabase
      .from("intake_sessions")
      .update({ otp_verified: true, otp_code: null, otp_expires_at: null })
      .eq("id", session_id);

    // Non-fatal downstream triggers
    void triggerRetainerIfEligible(session_id, session.firm_id, session.band);
    void promoteToLead(session);

    return NextResponse.json({ verified: true });
  } catch (err) {
    console.error("[otp/verify] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── Retainer trigger (Band A/B only) ─────────────────────────────────────────

async function triggerRetainerIfEligible(
  sessionId: string,
  firmId: string | null,
  band: string | null
): Promise<void> {
  if (!firmId || !band || !["A", "B"].includes(band)) return;

  try {
    const result = await triggerRetainerAgreement({ sessionId, firmId });
    if (result.skipped) {
      console.log(`[otp/verify] Retainer skipped for session ${sessionId}: ${result.reason}`);
    } else {
      console.log(`[otp/verify] Retainer generated for session ${sessionId}: agreement ${result.agreementId}`);
    }
  } catch (err) {
    console.error(`[otp/verify] Retainer generation failed for session ${sessionId}:`, err);
  }
}

// ── Pipeline lead promotion (Band A/B/C) ─────────────────────────────────────
// Creates a lead in the CRM pipeline from the verified intake session.
// Idempotent — skips if a lead with this session's email + firm already exists.

async function promoteToLead(session: Record<string, unknown>): Promise<void> {
  const band = session.band as string | null;
  if (!band || !["A", "B", "C"].includes(band)) return;

  const firmId = session.firm_id as string | null;
  if (!firmId) return;

  const contact = (session.contact as Record<string, unknown>) ?? {};
  const firstName = (contact.first_name as string) ?? "";
  const lastName = (contact.last_name as string) ?? "";
  const name = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
  const email = (contact.email as string) ?? null;
  const phone = (contact.phone as string) ?? null;

  const scoring = (session.scoring as Record<string, unknown>) ?? {};
  const cpiScore = (scoring.total as number) ?? 0;

  const practiceArea = (session.practice_area as string) ?? null;
  const situationSummary = (session.situation_summary as string) ?? null;
  const sessionId = session.id as string;

  // Idempotency: check if a lead for this email + firm already exists.
  // (intake_session_id column migration may not yet be applied — email+firm is safe fallback.)
  if (email) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("email", email)
      .eq("law_firm_id", firmId)
      .maybeSingle();

    if (existing) {
      console.log(`[otp/verify] Lead already exists for ${email} at firm ${firmId}, skipping`);
      return;
    }
  }

  const bandToStage: Record<string, string> = {
    A: "new_lead",
    B: "new_lead",
    C: "new_lead",
  };

  const { error } = await supabase.from("leads").insert({
    name,
    email,
    phone,
    case_type: practiceArea,
    description: situationSummary,
    law_firm_id: firmId,
    band,
    priority_band: band,
    cpi_score: cpiScore,
    priority_index: cpiScore,
    stage: bandToStage[band] ?? "new_lead",
    source: "caseload_screen",
  });

  if (error) {
    console.error(`[otp/verify] Lead promotion failed for session ${sessionId}:`, error.message);
  } else {
    console.log(`[otp/verify] Lead promoted to pipeline for session ${sessionId} (Band ${band})`);
  }
}
