/**
 * GET /api/admin/validate-slots
 *
 * S10.5 — Demo Validation
 * Runs 10 real intake scenarios through the autoConfirmFromContext + selectNextQuestions
 * pipeline. Returns a JSON report showing:
 *   - How many slots regex extracted from each first message
 *   - How many questions selectNextQuestions serves after extraction
 *   - Baseline (no extraction) vs actual question count
 *   - Target: 2–3 questions served instead of 6–8
 *
 * No GPT calls. Pure server-side logic validation.
 */

import { NextResponse } from "next/server";
import { autoConfirmFromContext } from "@/lib/auto-confirm";
import { selectNextQuestions } from "@/lib/question-selector";
import { DEFAULT_QUESTION_MODULES } from "@/lib/default-question-modules";

// ── 10 test scenarios ─────────────────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "PI-01",
    pa: "pi",
    message: "I had a car accident on the 401 yesterday. I was driving and got rear-ended.",
    band: "B",
  },
  {
    id: "PI-02",
    pa: "pi",
    message: "I was hit by a car while walking across the street at a crosswalk this morning.",
    band: "B",
  },
  {
    id: "PI-03",
    pa: "pi",
    message: "I was a passenger in a vehicle that was t-boned at an intersection last month.",
    band: "B",
  },
  {
    id: "EMP-01",
    pa: "emp",
    message: "I was fired from my job last week without cause. I worked there for 8 years.",
    band: "B",
  },
  {
    id: "EMP-02",
    pa: "emp",
    message: "I just got terminated today — they said I was laid off due to restructuring.",
    band: "B",
  },
  {
    id: "EMP-03",
    pa: "emp",
    message: "I was constructively dismissed. Hostile work environment for 5 years, finally left.",
    band: "B",
  },
  {
    id: "FAM-01",
    pa: "fam",
    message: "My spouse and I separated last month. We're married, living in Ontario, no kids.",
    band: "B",
  },
  {
    id: "FAM-02",
    pa: "fam",
    message: "Going through a divorce. We have two children and my spouse refuses to agree on anything.",
    band: "B",
  },
  {
    id: "CRIM-01",
    pa: "crim",
    message: "I was pulled over for DUI last night and charged with impaired driving.",
    band: "B",
  },
  {
    id: "LLT-01",
    pa: "llt",
    message: "I am the landlord. My tenant hasn't paid rent in 3 months. I own the property.",
    band: "B",
  },
] as const;

// ── Baseline: how many questions the OLD slice(0,6) logic would have shown ────
function baselineQuestionCount(paId: string): number {
  const qs = DEFAULT_QUESTION_MODULES[paId];
  if (!qs) return 0;
  return Math.min(6, qs.questions.length); // Phase 2 was always first 6
}

export async function GET() {
  const results = SCENARIOS.map(scenario => {
    const qs = DEFAULT_QUESTION_MODULES[scenario.pa];
    if (!qs) {
      return { ...scenario, error: `No question set for PA: ${scenario.pa}` };
    }

    // Simulate what happens on turn 1 when PA is newly classified
    const baseline = baselineQuestionCount(scenario.pa);

    // Step 1: regex auto-confirm (the fast-path that runs post-classification)
    const autoConfirmed = autoConfirmFromContext(scenario.pa, scenario.message, {});

    // Step 2: priority-based question selection (S10.3)
    const batch = selectNextQuestions(qs.questions, scenario.pa, autoConfirmed, scenario.band);

    const autoConfirmCount = Object.keys(autoConfirmed).length;
    const questionsServed = batch.questions.length;
    const reduction = baseline - questionsServed;
    const reductionPct = baseline > 0 ? Math.round((reduction / baseline) * 100) : 0;

    return {
      id: scenario.id,
      pa: scenario.pa,
      message: scenario.message,
      baseline_questions: baseline,
      auto_confirmed_slots: autoConfirmed,
      auto_confirm_count: autoConfirmCount,
      questions_served: questionsServed,
      questions_asked: batch.questions.map(q => q.id),
      phase: batch.phase,
      reduction,
      reduction_pct: reductionPct,
      target_met: questionsServed <= 4, // target: ≤4 questions (ideally 2-3 with GPT extraction)
    };
  });

  const totalBaseline = results.reduce((sum, r) => sum + (("baseline_questions" in r ? (r.baseline_questions as number) : null) ?? 0), 0);
  const totalServed = results.reduce((sum, r) => sum + (("questions_served" in r ? (r.questions_served as number) : null) ?? 0), 0);
  const targetMet = results.filter(r => "target_met" in r && r.target_met).length;

  return NextResponse.json({
    summary: {
      scenarios: SCENARIOS.length,
      total_baseline_questions: totalBaseline,
      total_questions_served: totalServed,
      total_reduction: totalBaseline - totalServed,
      avg_baseline: Math.round(totalBaseline / SCENARIOS.length * 10) / 10,
      avg_served: Math.round(totalServed / SCENARIOS.length * 10) / 10,
      targets_met: `${targetMet}/${SCENARIOS.length}`,
      note: "Regex extraction only. GPT slot extraction (S10.2) fires on turn 2+ in widget mode and provides further reduction.",
    },
    scenarios: results,
  });
}
