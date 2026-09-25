import { buildStructuredBrief, emptyAnswers } from "./brief";
import { getEligibleClarificationCodes, clarificationOption } from "./clarifications";
import { getMissingFieldsForStage, type StageId } from "./screens";
import type { AnalysisResult, ClarificationCode, DesiredClientAnswers, SavedBrief, PendingWorkComparison, WorkComparison } from "./types";
export type ToolView = "welcome" | "questions" | "comparison" | "review" | "clarification" | "brief";
export interface ToolState {
  view: ToolView; mode: "ai" | "structured" | null; answers: DesiredClientAnswers; stage: StageId;
  visitedStages: StageId[]; stagesToRevisit: StageId[]; comparisonStep: 1|2|3; comparisonDraft: PendingWorkComparison|null;
  savedBrief: SavedBrief|null; briefNeedsUpdate:boolean; reviewed: boolean; aiConsent: boolean; reviewRunId: string|null; requestCount: number;
  askedClarifications: ClarificationCode[]; activeClarification: ClarificationCode|null; dismissedCode: ClarificationCode|null;
  loading: boolean; retryAllowed:boolean; error: ""|"unavailable"|"invalid"|"changed"; storageMessage: ""|"unavailable"|"expired"|"invalid"; copyFailed: boolean;
}
const emptyMap = () => ({ FOCUS_UNCLEAR:null, CLIENT_GOAL_UNCLEAR:null, CURRENT_CAPACITY_CONFLICT:null, FEE_EFFORT_CONFLICT:null, EXPERIENCE_DIRECTION_CONFLICT:null });
export function initialToolState(): ToolState { return { view:"welcome", mode:null, answers:emptyAnswers(), stage:1, visitedStages:[], stagesToRevisit:[], comparisonStep:1, comparisonDraft:null, savedBrief:null, briefNeedsUpdate:false, reviewed:false, aiConsent:false, reviewRunId:null, requestCount:0, askedClarifications:[], activeClarification:null, dismissedCode:null, loading:false, retryAllowed:false, error:"", storageMessage:"", copyFailed:false }; }
export function enterTool(state:ToolState, mode:"ai"|"structured", restored?:{answers:DesiredClientAnswers;stage:StageId;savedBrief?:SavedBrief}):ToolState {
  return { ...initialToolState(), view:restored?.savedBrief?"brief":restored?.stage===7?"review":"questions", mode, answers:restored?.answers??emptyAnswers(), stage:restored?.stage??1,
    visitedStages:restored?[1,2,3,4,5,6,7].filter(n=>n<restored.stage) as StageId[]:[], savedBrief:restored?.savedBrief??null, reviewed:restored?.savedBrief?.wordingReviewed??false };
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
  if(answers.situation.role!=="other") answers.situation.role_other="";
  answers.revision=before.revision+1; answers.clarifications=emptyMap();
  return { ...s,answers,savedBrief:null,briefNeedsUpdate:!!s.savedBrief||s.briefNeedsUpdate,reviewed:false,reviewRunId:null,requestCount:0,askedClarifications:[],activeClarification:null,dismissedCode:null,loading:false,error:"",stagesToRevisit:areaChanged||workChanged?[2,3,4,5,6]:s.stagesToRevisit,view:"questions",stage:areaChanged||workChanged?1:s.stage };
}
export function updateComparisonDraft(s:ToolState, draft:PendingWorkComparison|null, step?:1|2|3):ToolState { return { ...s,comparisonDraft:draft,comparisonStep:step??s.comparisonStep,view:"comparison",error:"" }; }
export function commitComparison(s:ToolState, certainty:"chosen"|"provisional"):ToolState {
  const draft=s.comparisonDraft; if(!draft?.a||!draft.b||draft.a.work===draft.b.work) return s;
  const a=draft.a,b=draft.b;
  if([a.fee_effort,a.capacity,a.team_fit,a.evidence,b.fee_effort,b.capacity,b.team_fit,b.evidence].some(v=>!v)) return s;
  const complete=draft as WorkComparison; const before=s.answers, answers=structuredClone(before), selected=complete[complete.selected];
  answers.focus.work=selected.work; answers.focus.work_other=""; answers.focus.comparison=complete; answers.focus.certainty=certainty;
  if(answers.value.fee_effort===null) answers.value.fee_effort=selected.fee_effort;
  if(answers.delivery.capacity===null) answers.delivery.capacity=selected.capacity;
  answers.revision=before.revision+1; answers.clarifications=emptyMap();
  return { ...s,answers,view:"questions",stage:1,visitedStages:[1],stagesToRevisit:[2,3,4,5,6],comparisonDraft:null,savedBrief:null,briefNeedsUpdate:!!s.savedBrief||s.briefNeedsUpdate,reviewed:false,reviewRunId:null,requestCount:0,askedClarifications:[],activeClarification:null,dismissedCode:null,loading:false,error:"changed" };
}
export function beginReview(s:ToolState):ToolState { return canEnterStage(s,7)?{ ...s,view:"review",stage:7,savedBrief:null,reviewed:false,error:"",reviewRunId:null,requestCount:0,askedClarifications:[],activeClarification:null,dismissedCode:null }:s; }
export function createStructuredBrief(s:ToolState, now=new Date()):ToolState { if(!canEnterStage(s,7)) return s; return { ...s,view:"brief",stage:7,savedBrief:{brief:buildStructuredBrief(s.answers),sourceBriefRevision:s.answers.revision,generatedAt:now.toISOString(),wordingReviewed:false,mode:"structured"},briefNeedsUpdate:false,reviewed:false,error:"",activeClarification:null,reviewRunId:null,requestCount:0,askedClarifications:[],loading:false,retryAllowed:false }; }
export function beginAiRun(s:ToolState, createId:()=>string):ToolState {
  if(!canEnterStage(s,7)) return s;
  const answers=structuredClone(s.answers), cleared=Object.values(answers.clarifications).some(v=>v!==null);
  answers.clarifications=emptyMap(); if(cleared) answers.revision++;
  return { ...s,answers,aiConsent:true,reviewRunId:createId(),requestCount:1,askedClarifications:[],activeClarification:null,dismissedCode:null,savedBrief:null,briefNeedsUpdate:false,reviewed:false,loading:true,retryAllowed:false,error:"" };
}
export function recordAiAttempt(s:ToolState):ToolState { if(!s.reviewRunId||s.loading||!s.retryAllowed||s.requestCount>=3) return s; return { ...s,requestCount:s.requestCount+1,loading:true,retryAllowed:false,error:"" }; }
function fallbackBrief(s:ToolState, error:"unavailable"|"invalid",retryAllowed=false):ToolState { return { ...s,view:"brief",savedBrief:{brief:buildStructuredBrief(s.answers),sourceBriefRevision:s.answers.revision,generatedAt:new Date().toISOString(),wordingReviewed:false,mode:"structured"},briefNeedsUpdate:false,reviewed:false,activeClarification:null,loading:false,retryAllowed,error }; }
export function failAnalysis(s:ToolState, error:"unavailable"|"invalid",retryAllowed=false):ToolState { return fallbackBrief(s,error,retryAllowed); }
export function applyAnalysis(s:ToolState, result:AnalysisResult):ToolState {
  if(result.clarification_code && (s.requestCount>=3 || !getEligibleClarificationCodes(s.answers,s.askedClarifications).includes(result.clarification_code))) return fallbackBrief(s,"invalid");
  const savedBrief:SavedBrief={brief:result.brief,sourceBriefRevision:s.answers.revision,generatedAt:new Date().toISOString(),wordingReviewed:false,mode:"ai"};
  return { ...s,view:result.clarification_code?"clarification":"brief",savedBrief,briefNeedsUpdate:false,reviewed:false,activeClarification:result.clarification_code,loading:false,error:"" };
}
export function answerClarification(s:ToolState, choice:string):ToolState {
  const code=s.activeClarification; if(!code||!clarificationOption(code,choice)) return { ...s,error:"invalid" };
  if(choice==="open") return { ...s,view:"brief",dismissedCode:code,activeClarification:null,reviewRunId:null,loading:false,error:"" };
  if(code==="FOCUS_UNCLEAR"&&choice==="choose_specific") return { ...s,view:"questions",stage:1,reviewRunId:null,requestCount:0,askedClarifications:[],activeClarification:null,loading:false,error:"" };
  const answers=structuredClone(s.answers);
  answers.clarifications[code]=choice as NonNullable<DesiredClientAnswers["clarifications"][ClarificationCode]>;
  if(code==="CLIENT_GOAL_UNCLEAR") answers.client.goals=[choice as DesiredClientAnswers["client"]["goals"][number]];
  if(code==="CURRENT_CAPACITY_CONFLICT"&&choice==="limited_now") answers.delivery.capacity="limited";
  if(code==="EXPERIENCE_DIRECTION_CONFLICT"){ if(choice==="current_evidence") answers.focus.route="established"; else answers.direction.aim="new_area"; }
  answers.revision++;
  return { ...s,answers,askedClarifications:[...s.askedClarifications,code],activeClarification:null,savedBrief:null,briefNeedsUpdate:false,reviewed:false,requestCount:s.requestCount<3?s.requestCount+1:s.requestCount,loading:true,retryAllowed:false,error:"" };
}
export function markReviewed(s:ToolState, value:boolean):ToolState { if(!s.savedBrief||s.savedBrief.sourceBriefRevision!==s.answers.revision) return { ...s,error:"changed" }; return { ...s,reviewed:value,savedBrief:{...s.savedBrief,wordingReviewed:value} }; }
export function eligibleClarifications(s:ToolState){ return getEligibleClarificationCodes(s.answers,s.askedClarifications); }