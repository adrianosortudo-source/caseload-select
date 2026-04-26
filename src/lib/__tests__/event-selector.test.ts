import { describe, it, expect } from "vitest";
import { extractEvents } from "../event-extractor";
import { selectEvent } from "../event-selector";

describe("event-selector  -  5-case corpus", () => {
  it("case 1: marriage_to_citizen wins (unresolved beats resolved deportation)", () => {
    const msg = "I am marrying a Canadian citizen but I was deported 2 years ago";
    const events = extractEvents(msg);
    const selected = selectEvent(events);
    expect(selected).not.toBeNull();
    expect(selected!.type).toBe("marriage_to_citizen");
  });

  it("case 2: unpaid_overtime wins (duration = unresolved beats resolved termination)", () => {
    const msg = "I was fired last week but I also had an issue with unpaid overtime for the past year";
    const events = extractEvents(msg);
    const selected = selectEvent(events);
    expect(selected).not.toBeNull();
    expect(selected!.type).toBe("unpaid_overtime");
  });

  it("case 3: real_estate_defect selected (only event)", () => {
    const msg = "I bought a house and after closing I found water damage that wasn't disclosed";
    const events = extractEvents(msg);
    const selected = selectEvent(events);
    expect(selected).not.toBeNull();
    expect(selected!.type).toBe("real_estate_defect");
  });

  it("case 4: debt_owed selected (resolved, requires time)", () => {
    const msg = "I loaned money to a friend in March 2024 and they won't repay";
    const events = extractEvents(msg);
    const selected = selectEvent(events);
    expect(selected).not.toBeNull();
    expect(selected!.type).toBe("debt_owed");
  });

  it("case 5: mva selected (only event)", () => {
    const msg = "I was in a car accident last month and the other driver ran a red light";
    const events = extractEvents(msg);
    const selected = selectEvent(events);
    expect(selected).not.toBeNull();
    expect(selected!.type).toBe("mva");
  });
});

describe("event-selector  -  edge cases", () => {
  it("returns null for empty array", () => {
    expect(selectEvent([])).toBeNull();
  });

  it("returns null when all events below confidence threshold", () => {
    const lowConfidence = [
      { type: "mva", source_text: "car accident", time: null, time_type: null,
        time_resolved: false, attributes: { known: [] }, confidence: 0.3, position: 0 },
    ];
    expect(selectEvent(lowConfidence)).toBeNull();
  });

  it("tie-break: earlier position wins at equal score", () => {
    const events = [
      { type: "mva", source_text: "car accident", time: null, time_type: null,
        time_resolved: false, attributes: { known: [] }, confidence: 0.9, position: 50 },
      { type: "slip_fall", source_text: "slipped and fell", time: null, time_type: null,
        time_resolved: false, attributes: { known: [] }, confidence: 0.9, position: 10 },
    ];
    const selected = selectEvent(events);
    expect(selected!.type).toBe("slip_fall");
  });

  it("unresolved always beats resolved regardless of REQUIRES_TIME", () => {
    const events = [
      { type: "debt_owed", source_text: "loaned money", time: "March 2024", time_type: "trigger" as const,
        time_resolved: true, attributes: { known: [] }, confidence: 0.95, position: 0 },
      { type: "marriage_to_citizen", source_text: "marrying a Canadian", time: null, time_type: null,
        time_resolved: false, attributes: { known: [] }, confidence: 0.9, position: 5 },
    ];
    const selected = selectEvent(events);
    expect(selected!.type).toBe("marriage_to_citizen");
  });
});
