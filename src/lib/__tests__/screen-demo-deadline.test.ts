import { describe, expect, it } from "vitest";
import { demoDeadlineProposal } from "../screen-demo-deadline";
import { confirmDemoFacts, demoCapturedFacts } from "../screen-demo-confirmation";
import { startDemoState } from "../screen-demo";
import { isUserAnswered, selectNextSlot } from "../screen-engine/selector";

const now = new Date(2026, 10, 8, 12);
const input = "My employer dismissed me after I worked there for seven years. It offered eight weeks of severance pay in exchange for signing a release. I have not signed. The offer says I must respond by November 20, 2026.";
describe("demo deadline confirmation", () => {
  it("proposes the stated date, requires confirmation and does not repeat it", () => {
    const state = startDemoState(input);
    expect(state.matter_type).toBe("severance_review");
    const fact = demoCapturedFacts(state, now).find((item) => item.id === "severance_deadline");
    expect(fact).toMatchObject({ label: "Deadline to respond (November 20, 2026)", value: "Yes, within the next month", source: "inferred" });
    expect(isUserAnswered(state, "severance_deadline")).toBe(false);
    const confirmed = confirmDemoFacts(state, {}, now);
    expect(isUserAnswered(confirmed, "severance_deadline")).toBe(true);
    expect(demoCapturedFacts(confirmed, now).find((item) => item.id === "severance_deadline")?.label).toBe("Deadline to respond (November 20, 2026)");
    expect(confirmed.slot_meta.severance_deadline.evidence).toContain("November 20, 2026");
    expect(selectNextSlot(confirmed)?.id).not.toBe("severance_deadline");
  });
  it.each([
    "I must respond by February 30, 2026.",
    "I must respond by November 20.",
    "I must respond by November 20, 2026 or December 1, 2026.",
    "I do not have to respond by November 20, 2026.",
    "I don't have to respond by November 20, 2026.",
    "I may respond by November 20, 2026.",
    "I must respond by December 20, 2026.",
    "The contract was dated November 20, 2026.",
  ])("does not fabricate a window for %s", (text) => {
    expect(demoDeadlineProposal(text, now)).toBeNull();
  });
  it("uses the reference calendar date and handles a passed deadline", () => {
    expect(demoDeadlineProposal("I must respond by May 20, 2026.", new Date(2026, 4, 8, 12))?.value).toBe("Yes, within the next month");
    expect(demoDeadlineProposal("I may need to respond by May 20, 2026.", new Date(2026, 4, 8, 12))).toBeNull();
    expect(demoDeadlineProposal("I have not signed, but I must respond by November 20, 2026.", now)?.value).toBe("Yes, within the next month");
    expect(demoDeadlineProposal("I must respond by November 7, 2026.", now)?.value).toBe("The deadline has already passed");
    expect(demoDeadlineProposal("I must respond by November 10, 2026.", now)?.value).toBe("Yes, in the next few days");
    expect(demoDeadlineProposal("I must respond by November 14, 2026.", now)?.value).toBe("Yes, within the next week");
  });
});
