/**
 * Why Your Firm · Assist, pure-function tests
 *
 * Only the two pure functions are exercised here. runAssist reaches the
 * network and is deliberately not covered: the shape guarantees that keep a
 * malformed model response away from the lawyer all live in toAssistResult,
 * which is where the risk is.
 */

import { describe, it, expect } from "vitest";
import { validateAssistBody, toAssistResult, MAX_CONCERNS } from "../assist";
import { CATEGORIES } from "../differentiators";
import { COMPLIANCE_RULES } from "../compliance";

const GOOD_CLAIM = "We act for restaurant owners on lease disputes.";

describe("validateAssistBody: accepts", () => {
  it("a claim on its own", () => {
    const result = validateAssistBody({ claim: GOOD_CLAIM });
    expect(result).toEqual({ valid: true, value: { claim: GOOD_CLAIM } });
  });

  it("a claim with a proof line, trimming both", () => {
    const result = validateAssistBody({ claim: `  ${GOOD_CLAIM}  `, proof: "  Eleven of fourteen files.  " });
    expect(result).toEqual({
      valid: true,
      value: { claim: GOOD_CLAIM, proof: "Eleven of fourteen files." },
    });
  });

  it("an explicitly undefined proof", () => {
    const result = validateAssistBody({ claim: GOOD_CLAIM, proof: undefined });
    expect(result).toEqual({ valid: true, value: { claim: GOOD_CLAIM } });
  });

  it("a whitespace-only proof, dropping it rather than failing", () => {
    const result = validateAssistBody({ claim: GOOD_CLAIM, proof: "   " });
    expect(result).toEqual({ valid: true, value: { claim: GOOD_CLAIM } });
  });

  it("a claim at exactly the 500 character cap", () => {
    const claim = "a".repeat(500);
    expect(validateAssistBody({ claim })).toEqual({ valid: true, value: { claim } });
  });

  it("a proof at exactly the 500 character cap", () => {
    const proof = "b".repeat(500);
    expect(validateAssistBody({ claim: GOOD_CLAIM, proof })).toEqual({
      valid: true,
      value: { claim: GOOD_CLAIM, proof },
    });
  });
});

describe("validateAssistBody: rejects", () => {
  it("a missing claim", () => {
    const result = validateAssistBody({});
    expect(result.valid).toBe(false);
  });

  it("an empty claim", () => {
    expect(validateAssistBody({ claim: "" }).valid).toBe(false);
  });

  it("a whitespace-only claim", () => {
    expect(validateAssistBody({ claim: "   \n\t  " }).valid).toBe(false);
  });

  it("a non-string claim", () => {
    expect(validateAssistBody({ claim: 42 }).valid).toBe(false);
  });

  it("a claim over 500 characters after trimming", () => {
    expect(validateAssistBody({ claim: `  ${"a".repeat(501)}  ` }).valid).toBe(false);
  });

  it("a proof over 500 characters", () => {
    expect(validateAssistBody({ claim: GOOD_CLAIM, proof: "b".repeat(501) }).valid).toBe(false);
  });

  it("a non-string proof", () => {
    expect(validateAssistBody({ claim: GOOD_CLAIM, proof: 7 }).valid).toBe(false);
  });

  it("a null proof, rather than coercing it", () => {
    expect(validateAssistBody({ claim: GOOD_CLAIM, proof: null }).valid).toBe(false);
  });

  it.each([null, undefined, "a string body", 42, [{ claim: GOOD_CLAIM }]])(
    "a non-object body: %s",
    (body) => {
      expect(validateAssistBody(body).valid).toBe(false);
    },
  );

  it("carries a reason on every rejection", () => {
    const result = validateAssistBody({ claim: "" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.length).toBeGreaterThan(0);
  });
});

describe("toAssistResult: accepts", () => {
  it("a valid payload", () => {
    const result = toAssistResult({
      tightenedClaim: GOOD_CLAIM,
      category: "client_niche",
      concerns: [{ ruleId: "R3", note: "A ranking word asks the reader to accept a ranking nobody measured." }],
    });
    expect(result).toEqual({
      tightenedClaim: GOOD_CLAIM,
      category: "client_niche",
      concerns: [{ ruleId: "R3", note: "A ranking word asks the reader to accept a ranking nobody measured." }],
    });
  });

  it("an empty concerns list", () => {
    const result = toAssistResult({ tightenedClaim: GOOD_CLAIM, category: "practice_focus", concerns: [] });
    expect(result?.concerns).toEqual([]);
  });

  it("every category id the tool carries", () => {
    for (const category of CATEGORIES) {
      const result = toAssistResult({ tightenedClaim: GOOD_CLAIM, category: category.id, concerns: [] });
      expect(result?.category).toBe(category.id);
    }
  });

  it("every rule id the filter carries", () => {
    for (const rule of COMPLIANCE_RULES) {
      const result = toAssistResult({
        tightenedClaim: GOOD_CLAIM,
        category: "practice_focus",
        concerns: [{ ruleId: rule.id, note: "in play" }],
      });
      expect(result?.concerns).toEqual([{ ruleId: rule.id, note: "in play" }]);
    }
  });

  it("trimming the suggestion and the notes", () => {
    const result = toAssistResult({
      tightenedClaim: `  ${GOOD_CLAIM}  `,
      category: "fees_clarity",
      concerns: [{ ruleId: "R1", note: "  no lawyer can promise how a matter ends  " }],
    });
    expect(result?.tightenedClaim).toBe(GOOD_CLAIM);
    expect(result?.concerns[0]?.note).toBe("no lawyer can promise how a matter ends");
  });
});

describe("toAssistResult: rejects", () => {
  it("an unknown category", () => {
    expect(
      toAssistResult({ tightenedClaim: GOOD_CLAIM, category: "billing_practices", concerns: [] }),
    ).toBeNull();
  });

  it("a non-string category", () => {
    expect(toAssistResult({ tightenedClaim: GOOD_CLAIM, category: 3, concerns: [] })).toBeNull();
  });

  it("an empty tightenedClaim", () => {
    expect(toAssistResult({ tightenedClaim: "", category: "practice_focus", concerns: [] })).toBeNull();
  });

  it("a whitespace-only tightenedClaim", () => {
    expect(toAssistResult({ tightenedClaim: "   ", category: "practice_focus", concerns: [] })).toBeNull();
  });

  it("a missing tightenedClaim", () => {
    expect(toAssistResult({ category: "practice_focus", concerns: [] })).toBeNull();
  });

  it("concerns that are not an array", () => {
    expect(
      toAssistResult({ tightenedClaim: GOOD_CLAIM, category: "practice_focus", concerns: "R1" }),
    ).toBeNull();
  });

  it.each([null, undefined, "a string", 42, []])("a non-object payload: %s", (payload) => {
    expect(toAssistResult(payload)).toBeNull();
  });
});

describe("toAssistResult: concerns are filtered, never fatal", () => {
  it("drops unknown rule ids while keeping the valid ones", () => {
    const result = toAssistResult({
      tightenedClaim: GOOD_CLAIM,
      category: "responsiveness",
      concerns: [
        { ruleId: "R9", note: "a rule this build does not carry" },
        { ruleId: "R2", note: "specialist is a designation, not a description" },
        { ruleId: "outcome", note: "not an id at all" },
        { ruleId: "R5", note: "a vague quantity reads as a claim but cannot be checked" },
      ],
    });
    expect(result?.concerns.map((c) => c.ruleId)).toEqual(["R2", "R5"]);
  });

  it("drops entries with an empty, whitespace-only, or non-string note", () => {
    const result = toAssistResult({
      tightenedClaim: GOOD_CLAIM,
      category: "responsiveness",
      concerns: [
        { ruleId: "R1", note: "" },
        { ruleId: "R2", note: "   " },
        { ruleId: "R3", note: 4 },
        { ruleId: "R4", note: "a comparative claim needs a basis you could produce" },
      ],
    });
    expect(result?.concerns).toEqual([
      { ruleId: "R4", note: "a comparative claim needs a basis you could produce" },
    ]);
  });

  it("drops entries that are not objects", () => {
    const result = toAssistResult({
      tightenedClaim: GOOD_CLAIM,
      category: "responsiveness",
      concerns: [null, "R1", 3, ["R2", "note"], { ruleId: "R1", note: "kept" }],
    });
    expect(result?.concerns).toEqual([{ ruleId: "R1", note: "kept" }]);
  });

  it("caps the list at five", () => {
    const result = toAssistResult({
      tightenedClaim: GOOD_CLAIM,
      category: "credentials_history",
      concerns: Array.from({ length: 9 }, (_, i) => ({ ruleId: "R1", note: `note ${i + 1}` })),
    });
    expect(result?.concerns).toHaveLength(MAX_CONCERNS);
    expect(result?.concerns.at(-1)?.note).toBe("note 5");
  });

  it("counts only kept entries against the cap", () => {
    const result = toAssistResult({
      tightenedClaim: GOOD_CLAIM,
      category: "credentials_history",
      concerns: [
        { ruleId: "R9", note: "dropped" },
        { ruleId: "R1", note: "one" },
        { ruleId: "bogus", note: "dropped" },
        { ruleId: "R2", note: "two" },
      ],
    });
    expect(result?.concerns.map((c) => c.note)).toEqual(["one", "two"]);
  });
});
