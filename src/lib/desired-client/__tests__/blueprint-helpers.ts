import { emptyAnswers } from "../brief";
import type { AnalysisResult, DesiredClientAnswers, DesiredClientStatement } from "../types";
export function completeAnswers():DesiredClientAnswers{
 const a=emptyAnswers();a.revision=3;
 a.focus={...a.focus,area:"business",work:"business_acquisitions",service_area:"Ontario",route:"established",certainty:"chosen"};
 a.situation={...a.situation,trigger:"business.transaction",timing:"planning",role:"business_owner"};
 a.client.goals=["understand"];a.client.concerns=["next"];a.client.decision_needs=["options"];
 a.value.reasons=["client_benefit","skills"];a.value.fee_effort="worthwhile";
 a.delivery.capacity="room";a.delivery.fit_signals=["scope"];a.direction.aim="more_current";a.direction.evidence=["repeated"];
 return a;
}
export const statement=(text:string,kind:DesiredClientStatement["kind"],...source_answer_ids:DesiredClientStatement["source_answer_ids"]):DesiredClientStatement=>({text,kind,source_answer_ids});
export function validBlueprint():AnalysisResult{return {clarification_code:null,brief:{report_version:"dcm-blueprint-v1",
 portrait:statement("The firm wants more established acquisition work for business owners facing a planned transaction. They seek advice to understand their options, and the work fits the firm's client focus.","preference","focus.work","situation.role","situation.trigger","client.goals","focus.route"),
 client_need:statement("The client wants to understand the options and decide what to do. The firm has heard that they may not know what happens next.","experience","client.goals","client.concerns"),
 firm_value:statement("The firm values client benefit and its skills. The fee is usually worthwhile, and current capacity supports more work.","experience","value.reasons","value.fee_effort","delivery.capacity"),
 marketing:{message:statement("Understand your options before deciding what to do.","suggestion","client.goals"),content:statement("What to clarify before deciding your next step.","suggestion","client.goals"),next_step:statement("Request an initial conversation.","suggestion","client.goals")},open_questions:[]}};}
