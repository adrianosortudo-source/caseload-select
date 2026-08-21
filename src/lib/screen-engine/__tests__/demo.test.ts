import { describe, expect, it } from "vitest";
import { getNextStep } from "../control";
import { answerDemoState, buildDemoReport, startDemoState } from "../demo";

const FICTIONAL_INVOICE_DISPUTE =
  "Fictional scenario: I own a small Toronto design studio. A client has not paid a $28,000 invoice for completed work. The invoice was due two weeks ago, the client now disputes the scope, and I have the signed proposal, invoice, and email thread.";

describe("Screen demo local engine adapter", () => {
  it("builds an in-memory lawyer brief without contact capture", () => {
    let state = startDemoState(FICTIONAL_INVOICE_DISPUTE);

    // Walk only deterministic questions. The demo never invokes the LLM,
    // checkpoint, contact, consent, submit, or persistence paths.
    for (let turns = 0; turns < 12; turns += 1) {
      const next = getNextStep(state);
      if (!next.slot) break;
      state = answerDemoState(
        state,
        next.slot.id,
        next.slot.options?.[0]?.value ?? "Not sure",
      );
    }

    const report = buildDemoReport(state);

    expect(report.matter_snapshot).toContain("Commercial recovery");
    expect(report.lawyer_time_priority).toBeTruthy();
    expect(report.confidence_calibration).toBeTruthy();
    expect(report.resolved_facts_v2.length).toBeGreaterThan(0);
    expect(report.band_reasoning_bullets.length).toBeGreaterThan(0);
    expect(report.what_to_confirm.length).toBeGreaterThan(0);
    expect(report.call_openers.length).toBeGreaterThan(0);
    expect(report.contact_complete).toBe(false);
    expect(state.slots.client_name).toBeUndefined();
    expect(state.slots.client_email).toBeUndefined();
    expect(state.slots.client_phone).toBeUndefined();
  });
});
