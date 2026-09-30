import { emptyAnswers } from "./brief";
import { buildStructuredBlueprint } from "./structured-blueprint";
import { validateAnalysisResult } from "./output";
import { getEligibleClarificationCodes, clarificationOption } from "./clarifications";
import { getMissingFieldsForStage, getMissingRequiredFields, type StageId } from "./screens";
import type { AnalysisResult, ClarificationCode, DesiredClientAnswers, SavedBrief, PendingWorkComparison, WorkComparison } from "./types";
export type ToolView = "welcome" | "questions" | "comparison" | "review" | "clarification" | "brief";
export interface ToolState {
  view: ToolView; mode: "ai" | "structured" | null; answers: DesiredClientAnswers; stage: StageId;
  visitedStages: StageId[]; stagesToRevisit: StageId[]; comparisonStep: 1|2|3; comparisonDraft: PendingWorkComparison|null;
  savedBrief: SavedBrief|null; briefNeedsUpdate:boolean; reviewed: boolean; aiConsent: boolean; reviewRunId: string|null; requestCount: number;
  askedClarifications: ClarificationCode[]; activeClarification: ClarificationCode|null; dismissedCode: ClarificationCode|null;
  loading: boolean; retryAllowed:boolean; error: ""|"unavailable"|"invalid"|"changed"|"focusChanged"; storageMessage: ""|"unavailable"|"expired"|"invalid"; copyFailed: boolean;
  legacyBriefReplaced:boolean;
}
const emptyMap = () => ({ CLIENT_MATTER_UNCLEAR:null, VALUE_EFFORT_CONFLICT:null, CAPACITY_CONFLICT:null, REPEATABILITY_UNPROVEN:null, OPPORTUNITY_UNSUPPORTED:null });
export function initialToolState(): ToolState { return { view:"welcome", mode:null, answers:emptyAnswers(), stage:1, visitedStages:[], stagesToRevisit:[], comparisonStep:1, comparisonDraft:null, savedBrief:null, briefNeedsUpdate:false, reviewed:false, aiConsent:false, reviewRunId:null, requestCount:0, askedClarifications:[], activeClarification:null, dismissedCode:null, loading:false, retryAllowed:false, error:"", storageMessage:"", copyFailed:false,legacyBriefReplaced:false }; }
export function enterTool(restored?:{answers:DesiredClientAnswers;stage:StageId;savedBrief?:SavedBrief}):ToolState {
  const savedBrief=restored?.savedBrief?.mode==="ai"?restored.savedBrief:null;
  const stage=restored?.stage??1;
  return { ...initialToolState(), view:savedBrief?"brief":stage===7?"review":"questions", mode:"ai", answers:restored?.answers??emptyAnswers(), stage,
    visitedStages:restored?[1,2,3,4,5,6,7].filter(n=>n<stage) as StageId[]:[], savedBrief, reviewed:savedBrief?.wordingReviewed??false, dismissedCode:savedBrief?.openClarificationCode??null,legacyBriefReplaced:restored?.savedBrief?.mode==="structured" };
}
export function canEnterStage(s:ToolState, stage:StageId):boolean {
  if(stage===7) return [1,2,3,4,5,6].every(n=>getMissingFieldsForStage(n as StageId,s.answers).length===0) && s.stagesToRevisit.length===0;
  return stage===1 || s.visitedStages.includes((stage-1) as StageId);
}
export function moveToStage(s:ToolState, stage:StageId):ToolState {
  if(!canEnterStage(s,stage)) return s;
  return { ...s, view:stage===7?"review":"questions", stage, visitedStages:[...new Set([...s.visitedStages,stage])].sort() as StageId[], stagesToRevisit:s.stagesToRevisit.filter(n=>n!==stage), error:"" };
}
export function advanceStage(s:ToolState):ToolState {
  if(getMissingFieldsForStage(s.stage,s.answers).length) return { ...s,error:"changed" };
  const next=s.stage===6?7:(s.stage+1) as StageId;
  return moveToStage({ ...s, visitedStages:[...new Set([...s.visitedStages,s.stage])] },next);
}
export function editAnswers(s:ToolState, edit:(answers:DesiredClientAnswers)=>DesiredClientAnswers):ToolState {
  const before=s.answers, answers=edit(structuredClone(before));
  const areaChanged=answers.focus.area!==before.focus.area, workChanged=answers.focus.work!==before.focus.work||answers.focus.work_other!==before.focus.work_other;
  if(areaChanged){ answers.focus.work=null; answers.focus.work_other=""; answers.focus.certainty=null; answers.situation.role=null; answers.situation.role_other=""; answers.situation.contact=null; answers.focus.comparison=null; }
  else if(workChanged){ answers.focus.comparison=null; if(answers.focus.work!=="other") answers.focus.work_other=""; if(answers.focus.work!==null) answers.focus.certainty="chosen"; }
  if (areaChanged || workChanged) {
    answers.focus.route = null;
    answers.situation.trigger = null;
    answers.situation.timing = null;
    answers.situation.role = null;
    answers.situation.role_other = "";
    answers.situation.contact = null;
    answers.client = { goals: [], concerns: [], decision_needs: [] };
    answers.client_context = { geography: "", relevant_circumstances: "", community_focus: "", language_service_needs: "", repeat_matter_pattern: "" };
    answers.value = { ...answers.value, reasons: [], fee_effort: null, collected_fee: null, team_hours: null, payment: null, currency: "", fee_amount: "", direct_cost_amount: "", amount_basis: null, amount_scope: null };
    answers.delivery = { ...answers.delivery, conditions: [], capacity: null, limit: null, fit_signals: [] };
    answers.opportunity = { sources: [], source_detail: "", period: "", enquiry_count: "", retained_count: "", conversion: "", acquisition_cost: "", uncertainty: "", data_basis: null };
    answers.repeatability = { success_measure: null, success_other: "", target: "", review_period: "", additional_matters: "", staffing_constraint: "" };
    answers.direction = { aim: null, evidence: [], less: null, less_note: "" };
    const writeIns = answers.write_ins ?? {};
    for (const key of Object.keys(writeIns)) if (key !== "aim") delete writeIns[key as keyof typeof writeIns];
    answers.write_ins = writeIns;
  }
  if(answers.situation.role!=="other") answers.situation.role_other="";
  answers.revision=before.revision+1; answers.clarifications=emptyMap();
  const changedStage:StageId = areaChanged || workChanged ? 2 : s.stage;
  const downstream = ([2,3,4,5,6] as StageId[]).filter((stage) => stage > changedStage && s.visitedStages.includes(stage));
  const visitedStages = s.visitedStages.filter((stage) => stage <= changedStage);
  return { ...s,answers,savedBrief:null,briefNeedsUpdate:!!s.savedBrief||s.briefNeedsUpdate,reviewed:false,reviewRunId:null,requestCount:0,askedClarifications:[],activeClarification:null,dismissedCode:null,loading:false,error:areaChanged||workChanged?"focusChanged":"",visitedStages,stagesToRevisit:[...new Set([...s.stagesToRevisit,...downstream])],view:"questions",stage:changedStage };
}
export function updateComparisonDraft(s:ToolState, draft:PendingWorkComparison|null, step?:1|2|3):ToolState { return { ...s,comparisonDraft:draft,comparisonStep:step??s.comparisonStep,view:"comparison",error:"" }; }
export function commitComparison(s:ToolState, certainty:"chosen"|"provisional"):ToolState {
  const draft=s.comparisonDraft; if(!draft?.a||!draft.b||draft.a.work===draft.b.work) return s;
  const a=draft.a,b=draft.b;
  if([a.fee_effort,a.capacity,a.team_fit,a.evidence,b.fee_effort,b.capacity,b.team_fit,b.evidence].some(v=>!v)) return s;
  const complete=draft as WorkComparison; const before=s.answers, answers=structuredClone(before), selected=complete[complete.selected];
  const workChanged = answers.focus.work !== selected.work;
  answers.focus.work=selected.work; answers.focus.work_other=""; answers.focus.comparison=complete; answers.focus.certainty=certainty;
  if (workChanged) {
    answers.situation.trigger = null;
    answers.client.decision_needs = [];
    answers.delivery.fit_signals = [];
    const writeIns = answers.write_ins ?? {};
    delete writeIns.trigger;
    delete writeIns.decision_needs;
    delete writeIns.fit_signals;
    answers.write_ins = writeIns;
  }
  if(answers.value.fee_effort===null) answers.value.fee_effort=selected.fee_effort;
  if(answers.delivery.capacity===null) answers.delivery.capacity=selected.capacity;
  answers.revision=before.revision+1; answers.clarifications=emptyMap();
  return { ...s,answers,view:"questions",stage:2,visitedStages:[1,2],stagesToRevisit:[3,4,5,6],comparisonDraft:null,savedBrief:null,briefNeedsUpdate:!!s.savedBrief||s.briefNeedsUpdate,reviewed:false,reviewRunId:null,requestCount:0,askedClarifications:[],activeClarification:null,dismissedCode:null,loading:false,error:workChanged?"focusChanged":"changed" };
}
export function beginReview(s:ToolState):ToolState { return canEnterStage(s,7)?{ ...s,view:"review",stage:7,savedBrief:null,reviewed:false,error:"",reviewRunId:null,requestCount:0,askedClarifications:[],activeClarification:null,dismissedCode:null }:s; }
export function beginAiRun(s:ToolState, createId:()=>string):ToolState {
  if(!canEnterStage(s,7)) return s;
  const answers=structuredClone(s.answers), cleared=Object.values(answers.clarifications).some(v=>v!==null);
  answers.clarifications=emptyMap(); if(cleared) answers.revision++;
  return { ...s,answers,aiConsent:true,reviewRunId:createId(),requestCount:1,askedClarifications:[],activeClarification:null,dismissedCode:null,savedBrief:null,briefNeedsUpdate:false,reviewed:false,loading:true,retryAllowed:false,error:"" };
}
export function recordAiAttempt(s:ToolState):ToolState { if(!s.reviewRunId||s.loading||!s.retryAllowed||s.requestCount>=3) return s; return { ...s,view:"review",stage:7,requestCount:s.requestCount+1,loading:true,retryAllowed:false,error:"" }; }
export function failAnalysis(s:ToolState, error:"unavailable"|"invalid",retryAllowed=false):ToolState { return { ...s,view:"review",mode:"ai",savedBrief:null,briefNeedsUpdate:false,reviewed:false,activeClarification:null,loading:false,retryAllowed,error }; }
export function applyAnalysis(s:ToolState, result:AnalysisResult):ToolState {
  if(result.clarification_code && (s.requestCount>=3 || !getEligibleClarificationCodes(s.answers,s.askedClarifications).includes(result.clarification_code))) return failAnalysis(s,"invalid");
  const savedBrief:SavedBrief={brief:result.brief,sourceBriefRevision:s.answers.revision,generatedAt:new Date().toISOString(),wordingReviewed:false,mode:"ai",...(result.clarification_code?{openClarificationCode:result.clarification_code}:{})};
  return { ...s,view:result.clarification_code?"clarification":"brief",savedBrief,briefNeedsUpdate:false,reviewed:false,activeClarification:result.clarification_code,loading:false,error:"",legacyBriefReplaced:false };
}
export function applyStructuredFallback(s:ToolState):ToolState {
  if (s.loading || getMissingRequiredFields(s.answers).length > 0) return s;
  const result = validateAnalysisResult({ brief: buildStructuredBlueprint(s.answers), clarification_code: null }, s.answers, []);
  if (!result) return failAnalysis(s, "invalid");
  const savedBrief: SavedBrief = {
    brief: result.brief, sourceAnswersVersion: "dcm-v3.0", sourceAnswersSnapshot: structuredClone(s.answers),
    sourceBriefRevision: s.answers.revision, generatedAt: new Date().toISOString(), wordingReviewed: false, mode: "structured",
  };
  return { ...s, view: "brief", mode: "structured", savedBrief, briefNeedsUpdate: false, reviewed: false, loading: false, retryAllowed: false, error: "", legacyBriefReplaced: false };
}
export function answerClarification(s:ToolState, choice:string):ToolState {
  const code=s.activeClarification; if(!code) return { ...s,error:"invalid" };
  const canonical=clarificationOption(code,choice);
  const custom=!canonical&&choice.trim().length>0&&choice.length<=220;
  if(!canonical&&!custom) return { ...s,error:"invalid" };
  if(choice==="open"||choice==="skip"||s.requestCount>=3) return { ...s,view:"brief",dismissedCode:code,activeClarification:null,reviewRunId:null,loading:false,error:"" };
  if(code==="CLIENT_MATTER_UNCLEAR"&&choice==="choose_specific") return { ...s,view:"questions",stage:2,reviewRunId:null,requestCount:0,askedClarifications:[],activeClarification:null,loading:false,error:"" };
  const answers=structuredClone(s.answers);
  answers.clarifications[code]=choice as NonNullable<DesiredClientAnswers["clarifications"][ClarificationCode]>;
  if(code==="CAPACITY_CONFLICT"&&choice==="limited_now") answers.delivery.capacity="limited";
  answers.revision++;
  return { ...s,answers,askedClarifications:[...s.askedClarifications,code],activeClarification:null,savedBrief:null,briefNeedsUpdate:false,reviewed:false,requestCount:s.requestCount<3?s.requestCount+1:s.requestCount,view:"review",stage:7,loading:true,retryAllowed:false,error:"" };
}
export function markReviewed(s:ToolState, value:boolean):ToolState { if(!s.savedBrief||s.savedBrief.sourceBriefRevision!==s.answers.revision) return { ...s,error:"changed" }; return { ...s,reviewed:value,savedBrief:{...s.savedBrief,wordingReviewed:value} }; }
export function eligibleClarifications(s:ToolState){ return getEligibleClarificationCodes(s.answers,s.askedClarifications); }
