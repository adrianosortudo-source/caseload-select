import { describe, it, expect } from "vitest";
import { generateQuestion } from "../event-question-generator";
import type { ExtractedEvent } from "../event-extractor";

function makeEvent(overrides: Partial<ExtractedEvent> & { type: string }): ExtractedEvent {
  return {
    source_text: "test",
    time: null,
    time_type: null,
    time_resolved: false,
    attributes: { known: [] },
    confidence: 0.9,
    position: 0,
    ...overrides,
  };
}

describe("generateQuestion  -  WHEN gap (time not resolved)", () => {
  it("slip_fall: asks when", () => {
    const q = generateQuestion(makeEvent({ type: "slip_fall" }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/when/);
  });

  it("mva: asks when", () => {
    const q = generateQuestion(makeEvent({ type: "mva" }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/when/);
  });

  it("termination: asks when", () => {
    const q = generateQuestion(makeEvent({ type: "termination" }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/when/);
  });

  it("deportation: asks when removal took effect", () => {
    const q = generateQuestion(makeEvent({ type: "deportation" }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/when|removal/);
  });

  it("debt_owed: asks when money was loaned", () => {
    const q = generateQuestion(makeEvent({ type: "debt_owed" }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/when|loan/);
  });
});

describe("generateQuestion  -  resolved event, next gap", () => {
  it("slip_fall resolved: asks about incident report", () => {
    const q = generateQuestion(makeEvent({
      type: "slip_fall",
      time: "three weeks ago",
      time_type: "trigger",
      time_resolved: true,
    }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/report|manager|owner/);
  });

  it("mva resolved, no fault known: asks driver/passenger/pedestrian", () => {
    const q = generateQuestion(makeEvent({
      type: "mva",
      time: "last month",
      time_type: "trigger",
      time_resolved: true,
      attributes: { known: [] },
    }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/driver|passenger|pedestrian/);
  });

  it("mva resolved, fault known: asks about medical treatment", () => {
    const q = generateQuestion(makeEvent({
      type: "mva",
      time: "last month",
      time_type: "trigger",
      time_resolved: true,
      attributes: { known: ["ran_red_light"] },
    }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/medical|treatment/);
  });

  it("termination resolved: asks reason given", () => {
    const q = generateQuestion(makeEvent({
      type: "termination",
      time: "last week",
      time_type: "trigger",
      time_resolved: true,
    }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/reason/);
  });

  it("debt_owed resolved: asks about written agreement", () => {
    const q = generateQuestion(makeEvent({
      type: "debt_owed",
      time: "March 2024",
      time_type: "trigger",
      time_resolved: true,
    }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/written|agreement|contract|record/);
  });

  it("marriage_to_citizen: asks current immigration status", () => {
    const q = generateQuestion(makeEvent({
      type: "marriage_to_citizen",
      time: null,
      time_resolved: false,
    }));
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/status|immigration|canada/);
  });
});

describe("generateQuestion  -  pronoun rewrite", () => {
  it("no pronouns in mva output", () => {
    const q = generateQuestion(makeEvent({
      type: "mva",
      time: "last Tuesday",
      time_type: "trigger",
      time_resolved: true,
      attributes: { known: ["other_driver_fault"] },
    }));
    expect(q).not.toBeNull();
    expect(q).not.toMatch(/\b(they|them|their|he|she|him|his|her)\b/i);
  });

  it("no pronouns in termination output", () => {
    const q = generateQuestion(makeEvent({
      type: "termination",
      time: "last week",
      time_type: "trigger",
      time_resolved: true,
    }));
    expect(q).not.toBeNull();
    expect(q).not.toMatch(/\b(they|them|their|he|she|him|his|her)\b/i);
  });

  it("no pronouns in slip_fall output", () => {
    const q = generateQuestion(makeEvent({ type: "slip_fall" }));
    expect(q).not.toBeNull();
    expect(q).not.toMatch(/\b(they|them|their|he|she|him|his|her)\b/i);
  });

  it("no pronouns in debt_owed output", () => {
    const q = generateQuestion(makeEvent({ type: "debt_owed" }));
    expect(q).not.toBeNull();
    expect(q).not.toMatch(/\b(they|them|their|he|she|him|his|her)\b/i);
  });
});

describe("generateQuestion  -  multi-instance disambiguation", () => {
  it("two terminations: asks which incident to focus on", () => {
    const event = makeEvent({ type: "termination", time: "last year", time_type: "trigger", time_resolved: true, position: 0 });
    const event2 = makeEvent({ type: "termination", time: "last week", time_type: "trigger", time_resolved: true, position: 40 });
    const q = generateQuestion(event, [event, event2]);
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).toMatch(/which|focus/);
  });

  it("single instance: no disambiguation question", () => {
    const event = makeEvent({ type: "termination", time: "last week", time_type: "trigger", time_resolved: true });
    const q = generateQuestion(event, [event]);
    expect(q).not.toBeNull();
    expect(q!.toLowerCase()).not.toMatch(/which.*focus/);
  });
});

describe("generateQuestion  -  unknown type", () => {
  it("returns null for unrecognised event type", () => {
    const q = generateQuestion(makeEvent({ type: "unknown_event_xyz" }));
    expect(q).toBeNull();
  });
});
