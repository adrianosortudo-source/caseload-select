import { describe, it, expect } from "vitest";
import {
  QUESTIONS,
  resolveOutcome,
  isValidValue,
  labelForValue,
  optionRevealsText,
  questionById,
} from "../questions";

describe("QUESTIONS", () => {
  it("has exactly five questions in the approved order", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual([
      "practice_area",
      "firm_size",
      "prompt_reason",
      "decision_role",
      "timeline",
    ]);
  });

  it("carries the approved verbatim prompts", () => {
    expect(questionById("practice_area").prompt).toBe("What kind of law does your firm practice?");
    expect(questionById("firm_size").prompt).toBe("How many lawyers work at the firm?");
    expect(questionById("prompt_reason").prompt).toBe("What prompted you to reach out now?");
    expect(questionById("decision_role").prompt).toBe("Who decides on marketing spend at the firm?");
    expect(questionById("timeline").prompt).toBe("When would you want the work to start?");
  });
});

describe("isValidValue / labelForValue", () => {
  it("accepts every listed option value", () => {
    for (const q of QUESTIONS) {
      for (const opt of q.options) {
        expect(isValidValue(q.id, opt.value)).toBe(true);
        expect(labelForValue(q.id, opt.value)).toBe(opt.label);
      }
    }
  });

  it("rejects an unlisted value", () => {
    expect(isValidValue("practice_area", "tax_law")).toBe(false);
    expect(labelForValue("practice_area", "tax_law")).toBeNull();
  });
});

describe("optionRevealsText", () => {
  it("is true only for the 'something_else' options", () => {
    expect(optionRevealsText("practice_area", "something_else")).toBe(true);
    expect(optionRevealsText("practice_area", "family")).toBe(false);
    expect(optionRevealsText("prompt_reason", "something_else")).toBe(true);
    expect(optionRevealsText("prompt_reason", "too_few_inquiries")).toBe(false);
  });

  it("is false for questions with no free-text option at all", () => {
    expect(optionRevealsText("firm_size", "just_me")).toBe(false);
    expect(optionRevealsText("decision_role", "i_do")).toBe(false);
    expect(optionRevealsText("timeline", "this_month")).toBe(false);
  });
});

describe("resolveOutcome (section 2.6 outcome rule)", () => {
  it("returns booking when the visitor decides alone and wants to start this month", () => {
    expect(resolveOutcome({ decision_role: "i_do", timeline: "this_month" })).toBe("booking");
  });

  it("returns booking when the visitor shares the decision and wants to start this quarter", () => {
    expect(resolveOutcome({ decision_role: "i_share", timeline: "this_quarter" })).toBe("booking");
  });

  it("returns reply when someone else decides, even with an immediate timeline", () => {
    expect(resolveOutcome({ decision_role: "someone_else", timeline: "this_month" })).toBe("reply");
  });

  it("returns reply when the visitor decides but is just researching", () => {
    expect(resolveOutcome({ decision_role: "i_do", timeline: "researching" })).toBe("reply");
  });

  it("returns reply when both conditions fail", () => {
    expect(resolveOutcome({ decision_role: "someone_else", timeline: "researching" })).toBe("reply");
  });

  it("never returns anything other than booking or reply (no automatic decline)", () => {
    const decisionValues = QUESTIONS.find((q) => q.id === "decision_role")!.options.map((o) => o.value);
    const timelineValues = QUESTIONS.find((q) => q.id === "timeline")!.options.map((o) => o.value);
    for (const decision_role of decisionValues) {
      for (const timeline of timelineValues) {
        const outcome = resolveOutcome({ decision_role, timeline });
        expect(["booking", "reply"]).toContain(outcome);
      }
    }
  });
});
