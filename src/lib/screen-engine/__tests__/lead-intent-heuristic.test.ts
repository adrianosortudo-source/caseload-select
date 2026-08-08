import { describe, it, expect } from "vitest";
import {
  detectLeadIntentHeuristic,
  CONTACT_REQUEST_SIGNALS,
  CONTACT_REQUEST_LENGTH_GATE,
} from "../extractor";
import { initialiseState } from "../extractor";

/**
 * DR-112: deterministic, offline-safe lead-intent heuristic. The LLM's
 * __lead_intent field (llm/schema.ts) is authoritative whenever a live
 * extraction runs; this heuristic only covers offline / degraded mode
 * and the pre-extraction render pass. See the screenshot repro that
 * motivated this build: a lead typed "i want to speak to a lawyer" and
 * the widget's clarify retry showed generic "tell me more" copy with no
 * acknowledgment.
 */
describe("detectLeadIntentHeuristic (DR-112)", () => {
  it("classifies the screenshot repro inputs as contact_request", () => {
    expect(detectLeadIntentHeuristic("i want to speak to a lawyer")).toBe("contact_request");
    expect(detectLeadIntentHeuristic("i want to book a call with a lawyer")).toBe("contact_request");
    expect(detectLeadIntentHeuristic("I need a lawyer to help me")).toBe("contact_request");
  });

  it("classifies Portuguese contact-request phrasings", () => {
    expect(detectLeadIntentHeuristic("quero falar com um advogado")).toBe("contact_request");
    expect(detectLeadIntentHeuristic("preciso de uma advogada")).toBe("contact_request");
    expect(detectLeadIntentHeuristic("quero marcar uma consulta")).toBe("contact_request");
  });

  it("matches the pre-existing clarify-step-doctrine.test.ts input", () => {
    // 'I am looking for a lawyer' is one of the four inputs pinned by the
    // DR-071 invariant test (clarify-step-doctrine.test.ts). It never
    // classifies to a matter_type (stays 'unknown'), and it reads as a
    // meta-request, not a matter description.
    expect(detectLeadIntentHeuristic("I am looking for a lawyer")).toBe("contact_request");
  });

  it("returns 'unknown' for vague but non-meta input", () => {
    expect(detectLeadIntentHeuristic("something happened and I do not know what to do")).toBe("unknown");
    expect(detectLeadIntentHeuristic("my landlord is threatening me")).toBe("unknown");
  });

  it("returns 'unknown' for real case descriptions, even short ones", () => {
    expect(detectLeadIntentHeuristic("I got fired last week")).toBe("unknown");
    expect(detectLeadIntentHeuristic("my business partner owes me $50,000")).toBe("unknown");
  });

  it("returns 'unknown' for empty or null-ish input", () => {
    expect(detectLeadIntentHeuristic("")).toBe("unknown");
  });

  it("length-gates: a long text containing a contact phrase is not flagged", () => {
    const longText =
      "My business partner and I started a company two years ago and now there is a dispute " +
      "about who owns what percentage, and there are unpaid invoices from a vendor as well, " +
      "please call me to discuss further".padEnd(CONTACT_REQUEST_LENGTH_GATE + 20, ".");
    expect(longText.length).toBeGreaterThan(CONTACT_REQUEST_LENGTH_GATE);
    expect(detectLeadIntentHeuristic(longText)).toBe("unknown");
  });

  it("every listed signal round-trips through the detector", () => {
    for (const signal of CONTACT_REQUEST_SIGNALS) {
      expect(detectLeadIntentHeuristic(signal), `signal did not match: "${signal}"`).toBe(
        "contact_request",
      );
    }
  });
});

describe("initialiseState sets lead_intent (DR-112)", () => {
  it("sets lead_intent='contact_request' for a meta-request opener", () => {
    const state = initialiseState("i want to speak to a lawyer");
    expect(state.lead_intent).toBe("contact_request");
    expect(state.matter_type).toBe("unknown");
  });

  it("sets lead_intent='unknown' for a real case description", () => {
    const state = initialiseState("I got fired last week and have no severance offer");
    expect(state.lead_intent).toBe("unknown");
  });

  it("sets lead_intent='unknown' for vague non-meta input", () => {
    const state = initialiseState("I would like to learn more about how you can help me");
    expect(state.lead_intent).toBe("unknown");
    expect(state.matter_type).toBe("unknown");
  });
});
