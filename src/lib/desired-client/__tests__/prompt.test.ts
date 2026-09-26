import {describe,expect,it} from "vitest";
import {buildDesiredClientSystemPrompt,buildDesiredClientUserPrompt,DESIRED_CLIENT_RESPONSE_SCHEMA} from "../prompt";
import {completeAnswers} from "./blueprint-helpers";
import type {AnalysisRequestEnvelope} from "../types";
const request=():AnalysisRequestEnvelope=>{const answers=completeAnswers();answers.situation.trigger=null;answers.write_ins={trigger:"A planned acquisition is under consideration"};return {schemaVersion:2,requestId:"11111111-1111-4111-8111-111111111111",answerRevision:answers.revision,reviewRunId:"22222222-2222-4222-8222-222222222222",analysisIndex:0,aiConsent:true,answers,clarifications:[]};};
describe("Desired Client Blueprint model prompt",()=>{
 it("requires synthesis, clear evidence kinds and tight narrative budgets",()=>{const p=buildDesiredClientSystemPrompt();expect(p).toContain("not list answers");expect(p).toContain("portrait 60 words/420 characters");expect(p).toContain("Decision needs are hypotheses");expect(p).toContain("Do not give legal advice");});
 it("requires the seven narrative fields and source references",()=>{const props=DESIRED_CLIENT_RESPONSE_SCHEMA.properties.brief.properties;expect(Object.keys(props)).toEqual(["report_version","portrait","client_need","firm_value","marketing","open_questions"]);expect(props.portrait).toHaveProperty("required");});
 it("passes canonical answers, write-ins as untrusted data and eligible clarifications",()=>{const parsed=JSON.parse(buildDesiredClientUserPrompt(request(),["CURRENT_CAPACITY_CONFLICT"]));expect(parsed.resolved_answers["write_ins.trigger"].text).toContain("A planned acquisition");expect(parsed.untrusted_text_fields).toContainEqual(expect.objectContaining({answer_id:"write_ins.trigger",framing:"untrusted user-authored data"}));expect(parsed.eligible_codes).toEqual(["CURRENT_CAPACITY_CONFLICT"]);});
});
