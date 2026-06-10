/**
 * POST /api/otp/verify
 *
 * Verifies a 6-digit OTP against the stored code in the session.
 * On success, marks the session otp_verified=true and clears the stored code.
 *
 * Band A/B/C: auto-promotes session to a pipeline lead (idempotent).
 *
 * NOTE: Retainer trigger has moved to POST /api/screen/round3.
 * Band A/B retainer now fires after Round 3 completes, not at OTP verify.
 * This ensures the lawyer receives both the memo and the retainer together.
 *
 * Body: { session_id: string; code: string }
 * Returns: { verified: true; band: string } | { verified: false; reason: "invalid" | "expired" }
 *          | { verified: false; reason: "locked" } with HTTP 410 after 5 failed
 *          attempts (the code is invalidated; request a new one via /api/otp/send)
 */

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import type { CpiBreakdown } from "@/lib/cpi-calculator";

// Brute-force cap (H6): a 6-digit code has a 1e6 keyspace, so unlimited
// tries inside the 15-minute TTL would be sweepable. Five wrong guesses
// burns the code; the lead requests a fresh one via /api/otp/send.
const MAX_OTP_ATTEMPTS = 5;

export async function POST(req: Request) {
  try {
    // Per-IP bucket as a second layer behind the per-code attempt cap.
    const ip = ipFromRequest(req);
    const rl = await checkRateLimit("otpVerify", ip);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate limited", retry_after_seconds: Math.ceil((rl.reset - Date.now()) / 1000) },
        { status: 429, headers: rateLimitHeaders(rl) }
      );
    }

    const body = await req.json() as { session_id?: string; code?: string };
    const { session_id, code } = body;

    if (!session_id || !code) {
      return NextResponse.json({ error: "session_id and code required" }, { status: 400 });
    }

    // Load session OTP fields + band + firm_id for retainer trigger
    const { data: session, error: sessionErr } = await supabase
      .from("intake_sessions")
      .select("id, otp_code, otp_expires_at, otp_verified, otp_attempts, band, firm_id, contact, practice_area, situation_summary, scoring")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Already verified  -  idempotent, return band so widget knows which step to show
    if (session.otp_verified) {
      return NextResponse.json({ verified: true, band: session.band });
    }

    // Demo-firm bypass: when the firm's name contains "[DEMO]", any 6-digit
    // code is accepted. Lets sales demos run end-to-end against production
    // without requiring email-based code verification. Real firms keep their
    // OTP enforcement intact because the bypass keys off firm name, not env.
    let isDemoFirm = false;
    if (session.firm_id) {
      const { data: firm } = await supabase
        .from("intake_firms")
        .select("name")
        .eq("id", session.firm_id)
        .maybeSingle();
      const firmName = (firm?.name as string | undefined) ?? "";
      isDemoFirm = /\[DEMO\]/i.test(firmName);
    }

    if (isDemoFirm && /^\d{6}$/.test(code.trim())) {
      // Skip code/expiry check  -  demo firm accepts any 6-digit code.
    } else {
      const attempts = (session.otp_attempts as number | null) ?? 0;

      // Locked: the attempt cap was hit on a prior call and the code was
      // invalidated. 410 (not 429) because retrying later cannot help;
      // the client must request a fresh code via /api/otp/send.
      if (attempts >= MAX_OTP_ATTEMPTS) {
        return NextResponse.json({ verified: false, reason: "locked" }, { status: 410 });
      }

      // Check expiry
      if (!session.otp_expires_at || new Date(session.otp_expires_at) < new Date()) {
        return NextResponse.json({ verified: false, reason: "expired" });
      }

      // Check code
      if (!session.otp_code || session.otp_code !== code.trim()) {
        const nextAttempts = attempts + 1;
        if (nextAttempts >= MAX_OTP_ATTEMPTS) {
          // Burn the code so even a correct guess is dead from here on.
          const { error: burnErr } = await supabase
            .from("intake_sessions")
            .update({ otp_code: null, otp_expires_at: null, otp_attempts: nextAttempts })
            .eq("id", session_id);
          if (burnErr) {
            // The response is "locked" either way, but a silently unburned
            // code would leave the brute-force cap unenforced in the DB.
            console.error(`[otp/verify] code burn failed for session ${session_id}:`, burnErr.message);
          }
          return NextResponse.json({ verified: false, reason: "locked" }, { status: 410 });
        }
        const { error: attemptErr } = await supabase
          .from("intake_sessions")
          .update({ otp_attempts: nextAttempts })
          .eq("id", session_id);
        if (attemptErr) {
          console.error(`[otp/verify] attempt increment failed for session ${session_id}:`, attemptErr.message);
        }
        return NextResponse.json({ verified: false, reason: "invalid" });
      }
    }

    // Mark verified, clear code
    await supabase
      .from("intake_sessions")
      .update({ otp_verified: true, otp_code: null, otp_expires_at: null, otp_attempts: 0 })
      .eq("id", session_id);

    // Non-fatal downstream triggers
    // Note: retainer trigger moved to /api/screen/round3 (fires after Round 3 completes)
    void promoteToLead(session);

    return NextResponse.json({ verified: true, band: session.band });
  } catch (err) {
    console.error("[otp/verify] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── Pipeline lead promotion (Band A/B/C) ─────────────────────────────────────
// Creates a lead in the CRM pipeline from the verified intake session.
// Idempotent  -  skips if a lead with this session's email + firm already exists.

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

  // session.scoring is written by validateAndFixScoring() in cpi-calculator.ts
  // and follows the CpiBreakdown shape (8 factors, fit max 40, value max 60).
  // Distinct from the form-path ScoringResult produced by computeScore().
  const scoring = (session.scoring as CpiBreakdown | null) ?? null;
  const cpiScore = scoring?.total ?? 0;

  const practiceArea = (session.practice_area as string) ?? null;
  const situationSummary = (session.situation_summary as string) ?? null;
  const sessionId = session.id as string;

  // Idempotency: check if a lead for this email + firm already exists.
  // (intake_session_id column migration may not yet be applied  -  email+firm is safe fallback.)
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

  // Explainability (v2.2) is intentionally left null here.
  //
  // cpi_confidence / cpi_explanation / cpi_missing_fields are computed by
  // computeScore() in src/lib/scoring.ts against a ScoringInput shape (raw
  // form fields: urgency, estimated_value, source, etc.). The CaseLoad
  // Screen path does NOT produce those raw inputs  -  GPT drives dynamic
  // questioning and writes numeric sub-scores into intake_sessions.scoring
  // via validateAndFixScoring(). Stamping a form-derived "low / medium /
  // high" on a GPT session would conflate two different metrics and would
  // misfire the incomplete-intake cron (which hunts cpi_confidence='low'
  // B/C leads to nudge  -  GPT sessions already completed 2-3 rounds of
  // dynamic questioning and are not "incomplete" in that sense).
  //
  // Form paths (src/app/api/leads, src/app/api/v1/leads) persist the
  // three fields from computeScore(). Admin / portal UI and the cron all
  // handle null gracefully on GPT-path leads.
  //
  // Sub-score persistence (scoring_model branch):
  // The five factors that overlap between the two engines  -  geo, legitimacy,
  // complexity, urgency, fee  -  are written into the matching columns so the
  // current admin score-bar UI renders something meaningful. fit_score and
  // value_score are deliberately left null: GPT's fit max is 40 and value max
  // is 60, but the admin UI labels those columns "/30" and "/65" respectively,
  // so populating them would show broken ratios like "35/30". The full native
  // GPT breakdown (including practice_score, referral_score, multi_practice_score,
  // cpi_fit, cpi_urgency, cpi_friction, fit_score, value_score) is preserved
  // in score_components JSONB; the source-aware helper in src/lib/score-components.ts
  // reads scoring_model and returns the correct ScoreRationaleInput.
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
    intake_session_id: sessionId,
    // Overlapping sub-scores (safe to populate: same semantic field, same range)
    geo_score:        scoring?.geo_score        ?? null,
    legitimacy_score: scoring?.legitimacy_score ?? null,
    complexity_score: scoring?.complexity_score ?? null,
    urgency_score:    scoring?.urgency_score    ?? null,
    fee_score:        scoring?.fee_score        ?? null,
    // Source-aware snapshot for the rationale UI once it becomes scoring_model-aware
    scoring_model:    scoring ? "gpt_cpi_v1" : null,
    score_components: scoring ?? null,
  });

  if (error) {
    console.error(`[otp/verify] Lead promotion failed for session ${sessionId}:`, error.message);
  } else {
    console.log(`[otp/verify] Lead promoted to pipeline for session ${sessionId} (Band ${band})`);
  }
}
