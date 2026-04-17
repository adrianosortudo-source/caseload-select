/**
 * POST /api/screen/round3
 *
 * Receives completed Round 3 answers from the intake widget.
 * Persists answers, marks round3_completed_at, triggers async memo generation,
 * and fires the retainer for Band A/B.
 *
 * Body:
 *   session_id: string
 *   answers: Record<string, unknown>   — question ID to answer value(s)
 *
 * Returns:
 *   { ok: true; memo_pending: true }
 *
 * Memo generation is async (non-blocking). The widget polls /api/memo/[sessionId]
 * or advances immediately — the memo badge appears in the portal when ready.
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { qualifiesForRound3 } from "@/lib/round3";
import { generateMemo } from "@/lib/memo";
import { triggerRetainerAgreement } from "@/lib/retainer";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { session_id?: string; answers?: Record<string, unknown> };
    const { session_id, answers } = body;

    if (!session_id) {
      return NextResponse.json({ error: "session_id required" }, { status: 400 });
    }

    // Load session
    const { data: session, error: sessionErr } = await supabase
      .from("intake_sessions")
      .select("id, firm_id, band, contact, practice_area, sub_type, situation_summary, scoring, otp_verified, round3_completed_at")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (!session.otp_verified) {
      return NextResponse.json({ error: "OTP not verified" }, { status: 403 });
    }

    if (!qualifiesForRound3(session.band as string | null)) {
      return NextResponse.json({ error: "Band does not qualify for Round 3" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Idempotent: if already completed, just return ok
    if (session.round3_completed_at) {
      return NextResponse.json({ ok: true, memo_pending: !!(session as Record<string, unknown>).memo_generated_at });
    }

    // Persist answers and mark complete
    await supabase
      .from("intake_sessions")
      .update({
        round3_answers: answers ?? {},
        round3_completed_at: now,
      })
      .eq("id", session_id);

    // Fire retainer for Band A/B (moved here from OTP verify)
    const band = session.band as string | null;
    const firmId = session.firm_id as string | null;

    if (firmId && (band === "A" || band === "B")) {
      void triggerRetainerAsync(session_id, firmId);
    }

    // Generate memo async — non-blocking so widget gets instant response
    const contact = (session.contact as Record<string, unknown>) ?? {};
    void generateMemoAsync({
      sessionId: session_id,
      firmId: firmId ?? "",
      contact: {
        first_name: contact.first_name as string | undefined,
        last_name: contact.last_name as string | undefined,
        phone: contact.phone as string | undefined,
        email: contact.email as string | undefined,
      },
      practiceArea: session.practice_area as string | null,
      subType: (session as Record<string, unknown>).sub_type as string | null,
      band: band ?? "C",
      cpiScore: ((session.scoring as Record<string, unknown>)?.total as number) ?? 0,
      cpiConfidence: ((session.scoring as Record<string, unknown>)?.confidence as string) ?? "low",
      situationSummary: session.situation_summary as string | null,
      round3Answers: answers ?? {},
    });

    return NextResponse.json({ ok: true, memo_pending: true });
  } catch (err) {
    console.error("[screen/round3] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── Async helpers ─────────────────────────────────────────────────────────────

async function generateMemoAsync(input: Parameters<typeof generateMemo>[0]): Promise<void> {
  try {
    await generateMemo(input);
    console.log(`[screen/round3] Memo generated for session ${input.sessionId}`);
  } catch (err) {
    console.error(`[screen/round3] Memo generation failed for session ${input.sessionId}:`, err);
  }
}

async function triggerRetainerAsync(sessionId: string, firmId: string): Promise<void> {
  try {
    const result = await triggerRetainerAgreement({ sessionId, firmId });
    if (result.skipped) {
      console.log(`[screen/round3] Retainer skipped for session ${sessionId}: ${result.reason}`);
    } else {
      console.log(`[screen/round3] Retainer triggered for session ${sessionId}: agreement ${result.agreementId}`);
    }
  } catch (err) {
    console.error(`[screen/round3] Retainer failed for session ${sessionId}:`, err);
  }
}
