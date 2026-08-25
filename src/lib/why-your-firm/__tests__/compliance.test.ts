import { describe, it, expect } from "vitest";
import { rulesTriggeredBy, COMPLIANCE_RULES, getRule, getPattern } from "../compliance";

describe("rulesTriggeredBy: should NOT fire (false-positive guards)", () => {
  it.each([
    "our marketing is never misleading",
    "we follow best practices on every file",
    "we make no guarantees about outcomes",
    "a Certified Specialist Program designation",
    "we act in the best interests of the client",
    "eleven of fourteen files were commercial leases",
    "we refer to other firms when a matter is not ours",
  ])("%s", (text) => {
    expect(rulesTriggeredBy(text)).toHaveLength(0);
  });
});

describe("rulesTriggeredBy: should fire", () => {
  it("R1 on an outcome guarantee", () => {
    const ids = rulesTriggeredBy("we guarantee a result or your money back").map((r) => r.id);
    expect(ids).toContain("R1");
  });

  it("R2 on specialist language", () => {
    const ids = rulesTriggeredBy("we are specialists in employment law").map((r) => r.id);
    expect(ids).toContain("R2");
  });

  it("R3 on a superlative, without matching inside 'misleading'", () => {
    const ids = rulesTriggeredBy("we are the best family lawyers in Toronto").map((r) => r.id);
    expect(ids).toContain("R3");
  });

  it("R4 on an unverifiable comparative", () => {
    const ids = rulesTriggeredBy("we are faster than other firms").map((r) => r.id);
    expect(ids).toContain("R4");
  });

  it("R5 on a vague quantity", () => {
    const ids = rulesTriggeredBy("hundreds of clients over many years").map((r) => r.id);
    expect(ids).toContain("R5");
  });

  it("is case-insensitive", () => {
    expect(rulesTriggeredBy("WE GUARANTEE A RESULT").map((r) => r.id)).toContain("R1");
  });
});

describe("rule table integrity", () => {
  it("has exactly five rules, R1 through R5", () => {
    expect(COMPLIANCE_RULES.map((r) => r.id).sort()).toEqual(["R1", "R2", "R3", "R4", "R5"]);
  });

  it("every rule carries at least three trigger examples in its own array", () => {
    for (const rule of COMPLIANCE_RULES) {
      expect(rule.textTriggers.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("R1 and R3 are blocked; R2, R4, R5 are converted", () => {
    expect(getRule("R1")?.verdict).toBe("blocked");
    expect(getRule("R3")?.verdict).toBe("blocked");
    expect(getRule("R2")?.verdict).toBe("converted");
    expect(getRule("R4")?.verdict).toBe("converted");
    expect(getRule("R5")?.verdict).toBe("converted");
  });

  it("R3 carries no conversion (no compliant version of a superlative)", () => {
    expect(getRule("R3")?.conversion).toBeNull();
  });

  it("no rule's own explanation or conversion text itself promises an outcome", () => {
    const outcomeWords = /\bwe (win|guarantee)\b/i;
    for (const rule of COMPLIANCE_RULES) {
      expect(rule.explanation).not.toMatch(outcomeWords);
      if (rule.conversion) expect(rule.conversion).not.toMatch(outcomeWords);
    }
  });
});

describe("statement patterns", () => {
  it("has exactly three patterns, P1 through P3", () => {
    expect(getPattern("P1")).toBeDefined();
    expect(getPattern("P2")).toBeDefined();
    expect(getPattern("P3")).toBeDefined();
  });

  it("every pattern's final slot is the proof line", () => {
    for (const id of ["P1", "P2", "P3"]) {
      const pattern = getPattern(id);
      expect(pattern?.slots.at(-1)).toBe("Your proof line");
    }
  });
});
