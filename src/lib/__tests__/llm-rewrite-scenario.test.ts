/**
 * LLM Rewrite Scenario Test: "my boss fired me after I complained"
 *
 * Proves the end-to-end wiring of the rewrite feature against the real
 * emp_dismissal question set. Simulates a realistic GPT payload for the
 * scenario that motivated the feature and walks it through the full
 * pipeline: candidate pool → resolved/suppressed appliers → rewrite map
 * → text overlay. Asserts the invariants we promised (frozen ids and
 * option values, LSO rejections, auto-resolve gated by confidence, etc.)
 * so the behaviour is proven without needing live GPT + Supabase.
 */

import { describe, it, expect } from "vitest";
import {
  candidatesFromQuestionSet,
  applyResolvedQuestions,
  applySuppressedQuestions,
  buildRewriteMap,
  applyRewritesToQuestions,
  buildRewritePromptChunk,
  type RewritePayload,
} from "../llm-rewrite";
import { DEFAULT_QUESTION_MODULES } from "../default-question-modules";

const EMP_DISMISSAL = DEFAULT_QUESTION_MODULES["emp_dismissal"];

/**
 * Simulated GPT response for the prompt:
 *   "my boss fired me after I complained about how he was treating me"
 *
 * This is what we want the model to produce once it reasons over the
 * candidate pool. The test confirms that if GPT returns a payload of
 * this shape, our post-processing applies it correctly.
 */
const SIMULATED_GPT_PAYLOAD: RewritePayload = {
  resolved_questions: [
    {
      id: "emp_dis_q1",
      inferred_value: "yes",
      evidence: "client said 'my boss fired me', which implies an employee relationship",
      confidence: 0.95,
    },
  ],
  questions_to_ask: [
    {
      id: "emp_dis_q31",
      rewritten_text:
        "You said you were fired after complaining about how your boss treated you. What reason did they give for the termination?",
      rationale: "anchors on the client's own narrative of reprisal",
    },
    {
      id: "emp_dis_q16",
      rewritten_text: "When did they let you go?",
      rationale: "simplified, second person",
    },
    {
      id: "emp_dis_q32",
      rewritten_text: "Have you signed any severance agreement or release since being let go?",
      rationale: "keeps canonical phrasing but ties to the client's situation",
    },
    {
      id: "emp_dis_q47",
      rewritten_text: "How long had you worked there before they let you go?",
      rationale: "past tense to match fired-state",
    },
  ],
  suppressed_questions: [],
};

describe("llm-rewrite scenario: 'my boss fired me after I complained'", () => {
  it("candidate pool includes all 8 emp_dismissal questions when nothing confirmed", () => {
    const confirmed: Record<string, unknown> = {};
    const candidates = candidatesFromQuestionSet(EMP_DISMISSAL.questions, confirmed);
    expect(candidates.length).toBe(8);
    expect(candidates.map(q => q.id)).toEqual([
      "emp_dis_q1",
      "emp_dis_q2",
      "emp_dis_q16",
      "emp_dis_q17",
      "emp_dis_q31",
      "emp_dis_q32",
      "emp_dis_q46",
      "emp_dis_q47",
    ]);
  });

  it("prompt chunk lists the pool and the rewrite contract", () => {
    const candidates = candidatesFromQuestionSet(EMP_DISMISSAL.questions, {});
    const chunk = buildRewritePromptChunk(candidates, "emp_dismissal");
    expect(chunk).toContain("CANDIDATE QUESTIONS (emp_dismissal)");
    expect(chunk).toContain("[emp_dis_q1]");
    expect(chunk).toContain("[emp_dis_q47]");
    expect(chunk).toContain("resolved_questions");
    expect(chunk).toContain("questions_to_ask");
    expect(chunk).toContain("suppressed_questions");
    // Contract rules must make it into the prompt
    expect(chunk).toContain("No outcome promises");
    expect(chunk).toContain("No em dashes");
  });

  it("applies the 'yes' resolution for emp_dis_q1 at 0.95 confidence", () => {
    const confirmed: Record<string, unknown> = {};
    const result = applyResolvedQuestions(
      SIMULATED_GPT_PAYLOAD.resolved_questions,
      EMP_DISMISSAL.questions,
      confirmed,
    );
    expect(result.applied).toBe(1);
    expect(confirmed["emp_dis_q1"]).toBe("yes");
    expect(result.log[0].status).toBe("applied");
  });

  it("suppressed_questions empty for this scenario (no implied no-longer-relevant questions)", () => {
    const confirmed: Record<string, unknown> = {};
    const result = applySuppressedQuestions(
      SIMULATED_GPT_PAYLOAD.suppressed_questions,
      EMP_DISMISSAL.questions,
      confirmed,
    );
    expect(result.applied).toBe(0);
    expect(confirmed).toEqual({});
  });

  it("builds a rewrite map for all 4 rewritten questions (all pass LSO)", () => {
    const candidateIds = new Set(EMP_DISMISSAL.questions.map(q => q.id));
    const { map, log } = buildRewriteMap(
      SIMULATED_GPT_PAYLOAD.questions_to_ask,
      candidateIds,
    );
    expect(map.size).toBe(4);
    expect(map.get("emp_dis_q31")).toContain("You said you were fired");
    expect(log.filter(l => l.status === "applied").length).toBe(4);
    expect(log.filter(l => l.status === "rejected").length).toBe(0);
  });

  it("overlays rewrites onto shaped widget questions, preserving id and options", () => {
    const candidateIds = new Set(EMP_DISMISSAL.questions.map(q => q.id));
    const { map } = buildRewriteMap(SIMULATED_GPT_PAYLOAD.questions_to_ask, candidateIds);

    // Simulate the shaped next_questions that would come out of selectNextQuestions
    const shaped = EMP_DISMISSAL.questions
      .filter(q => ["emp_dis_q16", "emp_dis_q31", "emp_dis_q32", "emp_dis_q47"].includes(q.id))
      .map(q => ({
        id: q.id,
        text: q.text, // canonical
        options: q.options ?? [],
      }));

    const originalQ31Text = shaped.find(q => q.id === "emp_dis_q31")!.text;
    const originalQ31Options = shaped.find(q => q.id === "emp_dis_q31")!.options;

    applyRewritesToQuestions(shaped, map);

    const q31 = shaped.find(q => q.id === "emp_dis_q31")!;
    // Text was rewritten with client's narrative
    expect(q31.text).not.toBe(originalQ31Text);
    expect(q31.text).toContain("complaining about how your boss treated you");
    // Id is frozen
    expect(q31.id).toBe("emp_dis_q31");
    // Option values are frozen, still the canonical set
    expect(q31.options).toBe(originalQ31Options);
    expect(q31.options.map(o => o.value)).toEqual([
      "no_reason",
      "restructure",
      "performance",
      "just_cause",
    ]);
  });

  it("rejects an LSO-violating rewrite from the same payload without affecting safe ones", () => {
    const candidateIds = new Set(EMP_DISMISSAL.questions.map(q => q.id));
    const pollutedPayload: RewritePayload["questions_to_ask"] = [
      ...(SIMULATED_GPT_PAYLOAD.questions_to_ask ?? []),
      {
        id: "emp_dis_q46",
        rewritten_text:
          "You have a strong case. What was your job title and seniority level?",
        rationale: "(model slipped an outcome claim)",
      },
    ];

    const { map, log } = buildRewriteMap(pollutedPayload, candidateIds);

    // 4 safe rewrites still apply
    expect(map.size).toBe(4);
    // The polluted one is rejected with a denylist reason
    expect(map.has("emp_dis_q46")).toBe(false);
    const rejection = log.find(l => l.id === "emp_dis_q46");
    expect(rejection?.status).toBe("rejected");
    expect(rejection?.reason).toMatch(/case strength claim/);
  });

  it("does not auto-resolve when confidence is below 0.8", () => {
    const confirmed: Record<string, unknown> = {};
    const weak: RewritePayload["resolved_questions"] = [
      {
        id: "emp_dis_q31",
        inferred_value: "no_reason",
        evidence: "maybe, the client didn't mention a specific reason",
        confidence: 0.6,
      },
    ];
    const result = applyResolvedQuestions(weak, EMP_DISMISSAL.questions, confirmed);
    expect(result.applied).toBe(0);
    expect(confirmed["emp_dis_q31"]).toBeUndefined();
    expect(result.log[0].reason).toBe("low confidence");
  });

  it("rejects a resolved value not in the canonical option set even at 0.95 confidence", () => {
    const confirmed: Record<string, unknown> = {};
    const bogus: RewritePayload["resolved_questions"] = [
      {
        id: "emp_dis_q31",
        inferred_value: "retaliation", // not a valid option value
        confidence: 0.95,
      },
    ];
    const result = applyResolvedQuestions(bogus, EMP_DISMISSAL.questions, confirmed);
    expect(result.applied).toBe(0);
    expect(result.log[0].reason).toBe("value not in option set");
  });

  it("full scenario walkthrough: pool → resolve → suppress → rewrite → overlay", () => {
    // Starting state: nothing confirmed yet, turn 2 of the conversation
    const confirmed: Record<string, unknown> = {};

    // Step 1: candidate pool
    const candidates = candidatesFromQuestionSet(EMP_DISMISSAL.questions, confirmed);
    expect(candidates.length).toBe(8);

    // Step 2: apply resolved (emp_dis_q1 = yes)
    const resolveResult = applyResolvedQuestions(
      SIMULATED_GPT_PAYLOAD.resolved_questions,
      candidates,
      confirmed,
    );
    expect(resolveResult.applied).toBe(1);
    expect(confirmed["emp_dis_q1"]).toBe("yes");

    // Step 3: apply suppressions (none in this scenario)
    const suppressResult = applySuppressedQuestions(
      SIMULATED_GPT_PAYLOAD.suppressed_questions,
      candidates,
      confirmed,
    );
    expect(suppressResult.applied).toBe(0);

    // Step 4: build rewrite map
    const candidateIds = new Set(candidates.map(q => q.id));
    const { map } = buildRewriteMap(SIMULATED_GPT_PAYLOAD.questions_to_ask, candidateIds);
    expect(map.size).toBe(4);

    // Step 5: overlay on the still-unanswered shaped questions
    const remainingIds = candidates
      .filter(q => !(q.id in confirmed))
      .map(q => q.id);
    expect(remainingIds).not.toContain("emp_dis_q1"); // already resolved

    const shaped = candidates
      .filter(q => remainingIds.includes(q.id))
      .slice(0, 4) // simulate server picking top 4
      .map(q => ({ id: q.id, text: q.text, options: q.options ?? [] }));

    applyRewritesToQuestions(shaped, map);

    // Every shaped question that had a rewrite should carry the new text
    for (const q of shaped) {
      const rewritten = map.get(q.id);
      if (rewritten) {
        expect(q.text).toBe(rewritten);
      }
    }
  });
});
