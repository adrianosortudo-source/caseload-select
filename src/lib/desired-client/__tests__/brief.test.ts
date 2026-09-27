import { describe,expect,it } from "vitest";
import { buildStructuredBrief,emptyAnswers } from "../brief";
import { buildBlueprintViewModel } from "../blueprint";
import { completeAnswers } from "./blueprint-helpers";
describe("basic Desired Client Blueprint",()=>{
 it("connects the client, trigger, goal and firm's preferred work in a coherent portrait",()=>{
  const a=completeAnswers(),brief=buildStructuredBrief(a);
  expect(brief.report_version).toBe("dcm-blueprint-v1");
  expect(brief.portrait.text).toMatch(/owner or founder.*business purchase.*planned/i);
  expect(brief.portrait.text).toContain("understand the options");
  expect(brief.marketing.message.text).toBe("Understand your options before deciding what to do.");
 });
 it("keeps unknowns explicit in a sparse draft rather than claiming invented facts",()=>{
  const a=emptyAnswers(),brief=buildStructuredBrief(a);
  expect(brief.portrait.text).toContain("still to be clarified");
  expect(brief.client_need.kind).toBe("unknown");
 });
 it("reconstructs a four-row proposal without activating or scoring it",()=>{
  const a=completeAnswers(),brief=buildStructuredBrief(a),model=buildBlueprintViewModel(brief,a,{mode:"structured",generatedAt:"2026-09-26T12:00:00Z",wordingReviewed:false});
  expect(model.screens.rows.map(row=>row.id)).toEqual(["matter_fit","value_delivery","timing","readiness"]);
  expect(model.screens.activation).toBe("not_activated");
  expect(model.screens.rows.flatMap(row=>row.questions).some(q=>"weight" in q)).toBe(false);
 });
});
