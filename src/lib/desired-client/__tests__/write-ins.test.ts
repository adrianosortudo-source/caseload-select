import {describe,expect,it} from "vitest";
import {completeAnswers} from "./blueprint-helpers";
import {getWriteInAnswers} from "../write_ins";
import {getSourceDetails} from "../sources";
import {buildStructuredBrief} from "../brief";
import {validateDraftAnswers} from "../validation";
describe("guided custom answers",()=>{
 it("preserves trigger, decision-need and fit-signal write-ins in source details",()=>{const a=completeAnswers();a.situation.trigger=null;a.write_ins={trigger:"An acquisition offer arrived",decision_needs:"A plain explanation of likely next steps",fit_signals:"The owner can share the transaction timeline"};expect(validateDraftAnswers(a)).toBe(true);expect(getWriteInAnswers(a)).toHaveLength(3);expect(getSourceDetails("write_ins.trigger",a).answer).toBe("An acquisition offer arrived");const brief=buildStructuredBrief(a);expect(brief.portrait.text).toContain("acquisition offer arrived");});
 it("rejects overlong write-ins and keeps the supplied text out of interpretation instructions",()=>{const a=completeAnswers();a.write_ins={fit_signals:"x".repeat(181)};expect(validateDraftAnswers(a)).toBe(false);});
});
