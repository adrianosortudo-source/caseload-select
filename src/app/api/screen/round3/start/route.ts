/**
 * POST /api/screen/round3/start
 *
 * Generates the filtered, context-aware Round 3 question list for this session.
 *
 * Previously this endpoint only marked round3_started_at. It now performs full
 * server-side question selection so the widget never runs the question bank
 * client-side without access to confirmed R1/R2 answers.
 *
 * Pipeline:
 *   1. Load session (band, practice_area, sub_type, scoring, situation_summary)
 *   2. Mark round3_started_at (only once — for stalled-round3 cron detection)
 *   3. Call getRound3Questions with the correct subType from the session record
 *   4. Apply excludeWhen gate against confirmed R1/R2 answers in scoring._confirmed
 *   5. If LLM_QUESTION_REWRITE is "on" or "shadow", call callRewriteModel with
 *      confirmed answers serialised as additional context
 *   6. Apply suppression and text rewrites from the model (mode="on" only)
 *   7. Return { ok: true; questions: Round3Question[] }
 *
 * Non-fatal: any failure returns { ok: true; questions: [] }.
 * The widget falls back to the static bank client-side when questions is empty.
 *
 * Body:   { session_id: string }
 * Returns: { ok: true; questions: Round3Question[] }
 */

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  getRound3Questions,
  qualifiesForRound3,
  type Round3Question,
} from "@/lib/round3";
import {
  callRewriteModel,
  buildRewriteMap,
  applyRewritesToQuestions,
  getRewriteMode,
} from "@/lib/llm-rewrite";
import type { Question } from "@/lib/screen-prompt";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a Round3Question to the minimal Question shape callRewriteModel
 * expects. Only id, text, category, options, and allow_free_text are needed
 * by the rewrite prompt builder.
 */
function r3ToQuestion(q: Round3Question): Question {
  return {
    id: q.id,
    text: q.text,
    category: q.category,
    options: (q.options ?? []).map(o => ({
      label: o.label,
      value: o.value,
      complexity_delta: 0,
    })),
    allow_free_text: q.allow_free_text ?? false,
  };
}

/**
 * Serialize confirmed R1/R2 answers into a block the rewrite model can read.
 * Skips implied sentinels so only real answered values are shown.
 */
function buildConfirmedContext(confirmed: Record<string, unknown>): string {
  const entries = Object.entries(confirmed)
    .filter(([, v]) => v !== "__implied__" && v !== undefined && v !== null)
    .map(([k, v]) => {
      const display = Array.isArray(v)
        ? (v as string[]).join(", ")
        : String(v);
      return `  ${k}: ${display}`;
    });
  if (entries.length === 0) return "";
  return `WHAT THE CLIENT HAS ALREADY CONFIRMED IN EARLIER QUESTIONS:\n${entries.join("\n")}`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json() as { session_id?: string };
    if (!body.session_id) return NextResponse.json({ ok: true, questions: [] });
    const session_id = body.session_id;

    // ── 1. Load session ──────────────────────────────────────────────────────
    const { data: session, error: sessionErr } = await supabase
      .from("intake_sessions")
      .select("id, band, practice_area, practice_sub_type, situation_summary, scoring, otp_verified, round3_started_at")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ ok: true, questions: [] });
    }

    if (!session.otp_verified || !qualifiesForRound3(session.band as string | null)) {
      return NextResponse.json({ ok: true, questions: [] });
    }

    // ── 2. Mark round3_started_at once ───────────────────────────────────────
    if (!session.round3_started_at) {
      void supabase
        .from("intake_sessions")
        .update({ round3_started_at: new Date().toISOString() })
        .eq("id", session_id)
        .is("round3_started_at", null)
        .then(() => { /* fire-and-forget */ });
    }

    // ── 3. Load question bank with correct subType ───────────────────────────
    const practiceArea = (session.practice_area as string | null) ?? null;
    const subType = (session.practice_sub_type as string | null) ?? null;
    const band = (session.band as string | null) ?? null;

    let questions: Round3Question[] = getRound3Questions(practiceArea, subType, band);
    if (questions.length === 0) {
      return NextResponse.json({ ok: true, questions: [] });
    }

    // ── 4. Apply excludeWhen against confirmed R1/R2 answers ─────────────────
    const scoring = (session.scoring as Record<string, unknown> | null) ?? {};
    const confirmed = (scoring._confirmed as Record<string, unknown> | null) ?? {};

    questions = questions.filter(q => {
      if (!q.excludeWhen) return true;
      for (const [depId, blockedValues] of Object.entries(q.excludeWhen)) {
        const answered = confirmed[depId];
        // Wildcard "*" — suppress when ANY answer exists for the dependency.
        // Used to dedupe R3 questions whose intent is fully covered by an R1/R2
        // question, regardless of which specific value the prospect picked.
        if (blockedValues.includes("*") && answered !== undefined && answered !== null && answered !== "") return false;
        if (typeof answered === "string" && blockedValues.includes(answered)) return false;
        if (Array.isArray(answered) && answered.some(v => blockedValues.includes(v as string))) return false;
      }
      return true;
    });

    if (questions.length === 0) {
      return NextResponse.json({ ok: true, questions: [] });
    }

    // ── 5-6. LLM rewrite pass (mode-gated, non-fatal) ────────────────────────
    const rewriteMode = getRewriteMode();
    if (rewriteMode === "on" || rewriteMode === "shadow") {
      try {
        const confirmedContext = buildConfirmedContext(confirmed);
        const situationRaw =
          typeof session.situation_summary === "string" ? session.situation_summary : "";
        const situation =
          confirmedContext.length > 0
            ? `${situationRaw}\n\n${confirmedContext}`
            : situationRaw;

        const candidates: Question[] = questions.map(r3ToQuestion);

        const rewriteResult = await callRewriteModel({
          candidates,
          subType,
          situation,
          timeoutMs: 10_000,
        });

        if (rewriteResult) {
          console.log("[round3/start] rewrite result", {
            mode: rewriteMode,
            suppressed: (rewriteResult.payload.suppressed_questions ?? []).length,
            rewritten: (rewriteResult.payload.questions_to_ask ?? []).length,
            resolved: (rewriteResult.payload.resolved_questions ?? []).length,
          });

          if (rewriteMode === "on") {
            // Apply suppression
            const suppressedIds = new Set(
              (rewriteResult.payload.suppressed_questions ?? []).map(s => s.id),
            );
            if (suppressedIds.size > 0) {
              questions = questions.filter(q => !suppressedIds.has(q.id));
            }

            // Apply validated text rewrites
            const candidateIds = new Set(candidates.map(c => c.id));
            const { map: rewriteMap } = buildRewriteMap(
              rewriteResult.payload.questions_to_ask,
              candidateIds,
            );
            if (rewriteMap.size > 0) {
              questions = applyRewritesToQuestions(questions, rewriteMap);
            }
          }
        }
      } catch (rewriteErr) {
        console.warn("[round3/start] rewrite call failed (non-fatal)", rewriteErr);
      }
    }

    // ── 7. Return filtered/rewritten questions ───────────────────────────────
    return NextResponse.json({ ok: true, questions });
  } catch (err) {
    // Non-fatal: the widget falls back to the static bank client-side
    console.error("[round3/start] caught exception", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: true, questions: [] });
  }
}
