import {describe,expect,it} from "vitest";
import {validateAnalysisResult} from "../output";
import {completeAnswers,validBlueprint} from "./blueprint-helpers";
describe("AI Blueprint output contract",()=>{
 it("accepts a grounded seven-slot profile",()=>expect(validateAnalysisResult(validBlueprint(),completeAnswers(),[])).not.toBeNull());
 it("rejects the answer-list schema and extra keys",()=>{
  const old={brief:{definition:{},client_goals:[],firm_reasons:[],delivery_conditions:[],evidence:[],open_questions:[],marketing:{},work_to_promote_less:[]},clarification_code:null};
  expect(validateAnalysisResult(old,completeAnswers(),[])).toBeNull();
  const extra=validBlueprint() as unknown as Record<string,unknown>;extra.extra=true;
  expect(validateAnalysisResult(extra,completeAnswers(),[])).toBeNull();
 });
 it("enforces slot budgets, valid sources, and suggestion-only marketing",()=>{
  const a=completeAnswers(),large=structuredClone(validBlueprint());large.brief.portrait.text="x ".repeat(61);
  expect(validateAnalysisResult(large,a,[])).toBeNull();
  const fabricated=structuredClone(validBlueprint());fabricated.brief.portrait.source_answer_ids=["focus.industry" as never];
  expect(validateAnalysisResult(fabricated,a,[])).toBeNull();
  const unsuggested=structuredClone(validBlueprint());unsuggested.brief.marketing.message.kind="preference";
  expect(validateAnalysisResult(unsuggested,a,[])).toBeNull();
 });
 it("requires unknown-source language to remain an open question",()=>{
  const a=completeAnswers(),candidate=structuredClone(validBlueprint());candidate.brief.portrait.source_answer_ids.push("situation.contact");
  expect(validateAnalysisResult(candidate,a,[])).toBeNull();
 });
});
