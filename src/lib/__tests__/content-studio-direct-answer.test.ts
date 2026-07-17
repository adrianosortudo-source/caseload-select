import { describe, it, expect } from "vitest";
import {
  parseDirectAnswerMetadata,
  isDirectAnswerDecisionExpected,
  countSentences,
  DIRECT_ANSWER_DECISION_FORMATS,
  DIRECT_ANSWER_EXEMPT_FORMATS,
} from "../content-studio-direct-answer";

describe("parseDirectAnswerMetadata", () => {
  it("returns null for missing, non-object, or malformed input", () => {
    expect(parseDirectAnswerMetadata(undefined)).toBeNull();
    expect(parseDirectAnswerMetadata(null)).toBeNull();
    expect(parseDirectAnswerMetadata("not an object")).toBeNull();
    expect(parseDirectAnswerMetadata({})).toBeNull();
    expect(parseDirectAnswerMetadata({ applicability: "sometimes" })).toBeNull();
  });

  it("parses a well-formed required decision", () => {
    const parsed = parseDirectAnswerMetadata({
      applicability: "required",
      text: "  A shareholder agreement is a contract.  ",
      classification: "binding_rule",
      jurisdiction_scope: "Ontario",
      source_status: "mapped",
      source_refs: ["OBCA s. 108", "", "  "],
      source_exemption_reason: null,
      not_applicable_reason: null,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.applicability).toBe("required");
    expect(parsed?.text).toBe("A shareholder agreement is a contract.");
    expect(parsed?.classification).toBe("binding_rule");
    // Blank/whitespace-only entries in source_refs are dropped.
    expect(parsed?.source_refs).toEqual(["OBCA s. 108"]);
  });

  it("degrades unknown classification/source_status to null rather than throwing", () => {
    const parsed = parseDirectAnswerMetadata({
      applicability: "optional",
      classification: "made_up_value",
      source_status: "made_up_value",
    });
    expect(parsed?.classification).toBeNull();
    expect(parsed?.source_status).toBeNull();
  });

  it("normalizes an empty/whitespace text to null", () => {
    const parsed = parseDirectAnswerMetadata({ applicability: "not_applicable", text: "   " });
    expect(parsed?.text).toBeNull();
  });
});

describe("isDirectAnswerDecisionExpected", () => {
  it("is true for long-form, reader-orientation formats", () => {
    for (const format of DIRECT_ANSWER_DECISION_FORMATS) {
      expect(isDirectAnswerDecisionExpected(format)).toBe(true);
    }
  });

  it("is false for exempt (short/promotional/reactive) formats", () => {
    for (const format of DIRECT_ANSWER_EXEMPT_FORMATS) {
      expect(isDirectAnswerDecisionExpected(format)).toBe(false);
    }
  });

  it("is false for null/undefined/unknown format", () => {
    expect(isDirectAnswerDecisionExpected(null)).toBe(false);
    expect(isDirectAnswerDecisionExpected(undefined)).toBe(false);
    expect(isDirectAnswerDecisionExpected("some_future_format")).toBe(false);
  });
});

describe("countSentences", () => {
  it("counts terminal-punctuated sentences", () => {
    expect(countSentences("One sentence.")).toBe(1);
    expect(countSentences("One. Two! Three?")).toBe(3);
  });

  it("ignores trailing whitespace and empty fragments", () => {
    expect(countSentences("One sentence.   ")).toBe(1);
    expect(countSentences("")).toBe(0);
  });

  it("does not choke on abbreviations, imperfect but bounded behavior", () => {
    // Heuristic, not grammar-aware: this over-counts, which is fine, since
    // the caller only warns (never fails) on a high sentence count.
    expect(countSentences("R.S.O. 1990, c. L.7 governs this.")).toBeGreaterThan(1);
  });
});
