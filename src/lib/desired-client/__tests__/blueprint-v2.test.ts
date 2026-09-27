import { describe, expect, it } from "vitest";
import { emptyAnswers, buildStructuredBrief } from "../brief";
import { buildBlueprintViewModel } from "../blueprint";
import { formatBriefMarkdown, formatBriefText } from "../export";
import { validateAnalysisResult } from "../output";
import type { AnalysisResult, DesiredClientAnswers, DesiredClientStatement } from "../types";

function complete():DesiredClientAnswers{
 const a=emptyAnswers();a.focus={...a.focus,area:"business",work:"business_acquisitions",service_area:"Ontario",route:"established",certainty:"chosen"};
 a.situation={...a.situation,trigger:"business.transaction",timing:"planning",role:"business_owner"};
 a.client.goals=["understand"];a.client.decision_needs=["options"];a.client.concerns=["next"];
 a.value.reasons=["client_benefit","skills"];a.value.fee_effort="worthwhile";
 a.delivery.capacity="room";a.delivery.fit_signals=["scope"];a.direction.aim="more_current";a.direction.evidence=["repeated"];
 return a;
}
const s=(text:string,kind:DesiredClientStatement["kind"],...source_answer_ids:DesiredClientStatement["source_answer_ids"]):DesiredClientStatement=>({text,kind,source_answer_ids});
function result():AnalysisResult{return {clarification_code:null,brief:{report_version:"dcm-blueprint-v1",portrait:s("The firm wants more established acquisition work for business owners facing a planned transaction. They seek advice to understand their options, and the work fits the firm's skills and client focus.","preference","focus.work","situation.role","situation.trigger","client.goals","value.reasons","focus.route"),client_need:s("The client wants to understand the options and decide what to do. The firm has heard that they may not know what happens next.","experience","client.goals","client.concerns"),firm_value:s("The firm values client benefit and its skills. The fee is usually worthwhile, and current capacity supports more work.","experience","value.reasons","value.fee_effort","delivery.capacity"),marketing:{message:s("Understand your options before deciding what to do.","suggestion","client.goals"),content:s("What to clarify before deciding your next step.","suggestion","client.goals"),next_step:s("Request an initial conversation.","suggestion","client.goals")},open_questions:[]}};}
describe("Desired Client Blueprint v2",()=>{
 it("builds a coherent basic portrait and a non-active four-row Screen proposal",()=>{
  const a=complete(),brief=buildStructuredBrief(a),model=buildBlueprintViewModel(brief,a,{mode:"structured",generatedAt:"2026-09-26T12:00:00.000Z",wordingReviewed:false});
  expect(brief.report_version).toBe("dcm-blueprint-v1");expect(brief.portrait.text).toContain("owner or founder");expect(brief.portrait.text).toContain("business purchase");
  expect(model.screens.rows).toHaveLength(4);expect(model.screens.status).toBe("proposal");expect(model.screens.activation).toBe("not_activated");
 });
 it("accepts grounded narrative and rejects answer-list legacy structure and oversized text",()=>{
  const a=complete(),v=result();expect(validateAnalysisResult(v,a,[])).not.toBeNull();
  expect(validateAnalysisResult({...v,brief:{...v.brief,portrait:{...v.brief.portrait,text:"x".repeat(421)}}},a,[])).toBeNull();
  expect(validateAnalysisResult({...v,brief:{definition:v.brief.portrait}},a,[])).toBeNull();
 });
 it("exports the compact profile and full supporting detail separately",()=>{
  const a=complete(),saved={brief:buildStructuredBrief(a),sourceBriefRevision:a.revision,generatedAt:"2026-09-26T12:00:00.000Z",wordingReviewed:false,mode:"structured" as const};
  const compact=formatBriefText(saved,a),detail=formatBriefMarkdown(saved,a);
  expect(compact).toContain("Desired Client Blueprint");expect(compact).not.toContain("What would you like the lawyer to help you with?");
  expect(detail).toContain("Answers and sources");expect(detail).toContain("What would you like the lawyer to help you with?");
  expect(detail).toContain("do not activate scoring");
 });
});
