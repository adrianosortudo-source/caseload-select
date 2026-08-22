import { describe, expect, it } from "vitest";
import { parseScreenFunnelEventV1 } from "@/lib/screen-funnel-schema";

const BASE = {
  schemaVersion: 1,
  eventId: "11111111-1111-4111-8111-111111111111",
  flowId: "22222222-2222-4222-8222-222222222222",
  sequence: 0,
  contextToken: "signed.context",
  event: "question_answered",
  stage: "discovery",
  stepIndex: 1,
  questionCount: 1,
  answerMode: "listed_option",
  locale: "en",
  viewport: "desktop",
  elapsedMs: 20,
} as const;

describe("Screen funnel event payload", () => {
  it("accepts the exact content-free allowlist", () => {
    expect(parseScreenFunnelEventV1(BASE)).toEqual(BASE);
  });

  it.each([
    ["opening", "a visitor supplied description"],
    ["questionId", "routing_question"],
    ["slotId", "corporate_dispute_problem_type"],
    ["matterType", "business"],
    ["practiceArea", "corporate"],
    ["band", "A"],
    ["report", "content"],
    ["leadId", "lead-123"],
    ["referrer", "https://example.test"],
    ["ip", "203.0.113.1"],
    ["engineState", { answers: ["content"] }],
  ])("rejects forbidden property %s", (property, value) => {
    expect(parseScreenFunnelEventV1({ ...BASE, [property]: value })).toBeNull();
  });

  it("rejects unknown nested values and arrays", () => {
    expect(parseScreenFunnelEventV1({ ...BASE, metadata: { anything: "no" } })).toBeNull();
    expect(parseScreenFunnelEventV1({ ...BASE, locale: ["en"] })).toBeNull();
  });

  it("requires answer mode only for answered questions", () => {
    expect(parseScreenFunnelEventV1({ ...BASE, event: "question_presented", answerMode: "skip" })).toBeNull();
    const withoutAnswerMode = { ...BASE } as Record<string, unknown>;
    delete withoutAnswerMode.answerMode;
    expect(parseScreenFunnelEventV1(withoutAnswerMode)).toBeNull();
  });

  it("enforces event-stage and numeric contracts", () => {
    expect(parseScreenFunnelEventV1({ ...BASE, stage: "review" })).toBeNull();
    expect(parseScreenFunnelEventV1({ ...BASE, questionCount: 9 })).toBeNull();
    expect(parseScreenFunnelEventV1({ ...BASE, elapsedMs: 7_200_001 })).toBeNull();
  });
});
