import { describe, expect, it } from "vitest";
import { completeAnswers } from "./blueprint-helpers";
import { getWriteInAnswers } from "../write_ins";
import { getSourceDetails } from "../sources";
import { buildStructuredBlueprint } from "../structured-blueprint";
import { validateDraftAnswers } from "../validation";
describe("guided custom answers", () => {
  it("preserves write-ins in the synthesized matter card and linked source details", () => { const a = completeAnswers(); a.situation.trigger = null; a.write_ins = { trigger: "An acquisition offer arrived", decision_needs: "A plain explanation of likely next steps", fit_signals: "The owner can share the transaction timeline" }; expect(validateDraftAnswers(a)).toBe(true); expect(getWriteInAnswers(a)).toHaveLength(3); expect(getSourceDetails("write_ins.trigger", a).answer).toBe("An acquisition offer arrived"); const brief = buildStructuredBlueprint(a); expect(brief.desired_client_matter.claims.map((claim) => claim.text).join(" ")).toContain("acquisition offer arrived"); expect(brief.desired_client_matter.claims.some((claim) => claim.source_answer_ids.includes("write_ins.trigger"))).toBe(true); });
  it("rejects overlong write-ins and keeps user text out of interpretation instructions", () => { const a = completeAnswers(); a.write_ins = { fit_signals: "x".repeat(181) }; expect(validateDraftAnswers(a)).toBe(false); });
});
