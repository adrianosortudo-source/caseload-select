import { describe, expect, it } from "vitest";
import {
  isCompleteStrategyBrief,
  parseStrategyBrief,
  STRATEGY_BRIEF_FIELDS,
} from "@/lib/strategy-brief";

const complete = {
  readerAndSituation: "A real reader in a real situation.",
  workSupported: "The approved work this package supports.",
  whyThisWeek: "The reason this topic matters now.",
  practicalAngle: "The practical mechanism the content will explain.",
  authorityAndEvidence: "The approved sources and evidence.",
  websiteAndConversionRole: "The website path and next step.",
};

describe("strategy brief contract", () => {
  it("accepts exactly six non-empty fields", () => {
    expect(STRATEGY_BRIEF_FIELDS).toHaveLength(6);
    expect(isCompleteStrategyBrief(complete)).toBe(true);
    expect(parseStrategyBrief(complete)).toEqual(complete);
  });

  it("rejects a missing or blank field", () => {
    expect(isCompleteStrategyBrief({ ...complete, practicalAngle: " " })).toBe(false);
    expect(parseStrategyBrief({ ...complete, practicalAngle: " " })).toBe("invalid");
  });

  it("rejects extra keys so the six-field shape stays exact", () => {
    expect(parseStrategyBrief({ ...complete, extra: "not allowed" })).toBe("invalid");
  });

  it("treats a missing historical brief as incomplete without throwing", () => {
    expect(parseStrategyBrief(null)).toBeNull();
    expect(isCompleteStrategyBrief(null)).toBe(false);
  });
});
