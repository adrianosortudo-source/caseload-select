import { describe, expect, it } from "vitest";
import { classify } from "../extractor";

describe("employer pay and release classification", () => {
  it("keeps an employer's pay offer and release in the employment lane without inventing dismissal", () => {
    const result = classify("I worked for my employer for seven years and received a written offer of eight weeks of pay in exchange for signing a release. I have not signed; the offer says I must respond by November 20, 2026.");
    expect(result.practice_area).toBe("employment");
    expect(result.matter_type).toBe("employment_general");
  });
  it("does not route an ordinary property offer to employment", () => {
    const result = classify("I received an offer to buy my property and need to release the deposit.");
    expect(result.practice_area).not.toBe("employment");
  });
});
