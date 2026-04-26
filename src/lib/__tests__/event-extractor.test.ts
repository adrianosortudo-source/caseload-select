import { describe, it, expect } from "vitest";
import { extractEvents } from "../event-extractor";

describe("event-extractor  -  5-case corpus", () => {
  it("case 1: marriage + deportation", () => {
    const msg = "I am marrying a Canadian citizen but I was deported 2 years ago";
    const events = extractEvents(msg);
    const types = events.map(e => e.type).sort();
    expect(types).toEqual(["deportation", "marriage_to_citizen"]);

    const deportation = events.find(e => e.type === "deportation")!;
    expect(deportation.time_resolved).toBe(true);
    expect(deportation.time_type).toBe("trigger");
    expect(deportation.time).toMatch(/2 years ago/i);

    const marriage = events.find(e => e.type === "marriage_to_citizen")!;
    expect(marriage.time_resolved).toBe(false);
    expect(marriage.time_type).toBeNull();
  });

  it("case 2: termination + unpaid overtime (overtime is duration, not trigger)", () => {
    const msg = "I was fired last week but I also had an issue with unpaid overtime for the past year";
    const events = extractEvents(msg);
    const types = events.map(e => e.type).sort();
    expect(types).toEqual(["termination", "unpaid_overtime"]);

    const termination = events.find(e => e.type === "termination")!;
    expect(termination.time_resolved).toBe(true);
    expect(termination.time_type).toBe("trigger");
    expect(termination.time).toMatch(/last week/i);

    const overtime = events.find(e => e.type === "unpaid_overtime")!;
    expect(overtime.time_resolved).toBe(false);
    expect(overtime.time_type).toBe("duration");
    expect(overtime.time).toMatch(/past year/i);
  });

  it("case 3: real estate defect, time not resolved", () => {
    const msg = "I bought a house and after closing I found water damage that wasn't disclosed";
    const events = extractEvents(msg);
    const defects = events.filter(e => e.type === "real_estate_defect");
    expect(defects.length).toBeGreaterThanOrEqual(1);
    expect(defects.every(e => e.time_resolved === false)).toBe(true);
  });

  it("case 4: debt owed, time resolved (March 2024)", () => {
    const msg = "I loaned money to a friend in March 2024 and they won't repay";
    const events = extractEvents(msg);
    const debts = events.filter(e => e.type === "debt_owed");
    expect(debts.length).toBeGreaterThanOrEqual(1);
    const loaned = debts.find(e => /loaned/i.test(e.source_text))!;
    expect(loaned.time_resolved).toBe(true);
    expect(loaned.time_type).toBe("trigger");
  });

  it("case 5: MVA, time resolved, other driver fault known", () => {
    const msg = "I was in a car accident last month and the other driver ran a red light";
    const events = extractEvents(msg);
    expect(events).toHaveLength(1);
    const mva = events[0];
    expect(mva.type).toBe("mva");
    expect(mva.time_resolved).toBe(true);
    expect(mva.time_type).toBe("trigger");
    expect(mva.time).toMatch(/last month/i);
    expect(mva.attributes.known).toContain("ran_red_light");
    expect(mva.attributes.known).toContain("other_driver_fault");
  });
});

describe("event-extractor  -  P1 fixes", () => {
  it("multi-match: same event type can appear multiple times", () => {
    const msg = "I was fired last year and was fired again last week";
    const events = extractEvents(msg);
    const terminations = events.filter(e => e.type === "termination");
    expect(terminations.length).toBeGreaterThanOrEqual(2);
  });

  it("negation: 'I was never fired' does not emit termination", () => {
    const events = extractEvents("I was never fired and I never got terminated");
    expect(events.filter(e => e.type === "termination")).toHaveLength(0);
  });

  it("negation: 'I was not in a car accident' does not emit mva", () => {
    const events = extractEvents("I was not in a car accident last month");
    expect(events.filter(e => e.type === "mva")).toHaveLength(0);
  });

  it("dedupe: overlapping patterns on same phrase emit one event", () => {
    const events = extractEvents("I was deported 2 years ago");
    expect(events.filter(e => e.type === "deportation")).toHaveLength(1);
  });

  it("regression: all 5 original cases still produce expected event types", () => {
    expect(extractEvents("I am marrying a Canadian citizen but I was deported 2 years ago").map(e => e.type).sort())
      .toEqual(["deportation", "marriage_to_citizen"]);
    expect(extractEvents("I was fired last week but I also had an issue with unpaid overtime for the past year").map(e => e.type).sort())
      .toEqual(["termination", "unpaid_overtime"]);
    expect(extractEvents("I bought a house and after closing I found water damage that wasn't disclosed").map(e => e.type))
      .toContain("real_estate_defect");
    expect(extractEvents("I loaned money to a friend in March 2024 and they won't repay").map(e => e.type))
      .toContain("debt_owed");
    expect(extractEvents("I was in a car accident last month and the other driver ran a red light").map(e => e.type))
      .toContain("mva");
  });
});
