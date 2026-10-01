import { describe, expect, it } from "vitest";
import { completeAnswers } from "./blueprint-helpers";
import { getWriteInAnswers } from "../write_ins";
import { getSourceDetails } from "../sources";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { buildBlueprintViewModel } from "../blueprint";
import { validateDraftAnswers } from "../validation";
describe("guided custom answers", () => {
  it("preserves write-ins in supporting answers without linking them to a separate specific-matter statement", () => { const a = completeAnswers(); a.situation.trigger = null; a.write_ins = { trigger: "An acquisition offer arrived", decision_needs: "A plain explanation of likely next steps", fit_signals: "The owner can share the transaction timeline" }; expect(validateDraftAnswers(a)).toBe(true); expect(getWriteInAnswers(a)).toHaveLength(3); expect(getSourceDetails("write_ins.trigger", a).answer).toBe("An acquisition offer arrived"); const brief = buildStructuredBlueprintV4(a); const model=buildBlueprintViewModel(brief,a,{mode:"structured",generatedAt:"2026-09-26T12:00:00Z",wordingReviewed:false}); expect(model.allAnswers.some(answer=>answer.answer==="An acquisition offer arrived")).toBe(true); expect(brief.client_and_matter.claims.some(claim=>claim.source_answer_ids.includes("write_ins.trigger"))).toBe(false); });
  it("rejects overlong write-ins and keeps user text out of interpretation instructions", () => { const a = completeAnswers(); a.write_ins = { fit_signals: "x".repeat(181) }; expect(validateDraftAnswers(a)).toBe(false); });
});
