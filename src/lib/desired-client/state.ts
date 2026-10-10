import { emptyAnswers } from "./brief";
import { buildStructuredBlueprintV4 } from "./structured-blueprint";
import { validateAnalysisResult } from "./output";
import { isBoundedMultilineText } from "./validation";
import { getEligibleClarificationCodes, clarificationOption } from "./clarifications";
import { getMissingFieldsForStage, getMissingRequiredFields, type StageId } from "./screens";
import { interviewClarificationSourceFingerprint, type AnalysisResult, type ClarificationCode, type DesiredClientAnswers, type InterviewClarificationAnswer, type InterviewClarificationPrompt, type SavedBrief, type PendingWorkComparison, type WorkComparison } from "./types";
import { INTERVIEW_CLARIFICATION_LIMITS } from "./interview-clarification-contract";
export type ToolView = "welcome" | "questions" | "comparison" | "review" | "clarification" | "interviewClarification" | "brief";
export interface ToolState {
  view: ToolView; mode: "ai" | "structured" | null; answers: DesiredClientAnswers; stage: StageId;
  visitedStages: StageId[]; stagesToRevisit: StageId[]; comparisonStep: 1|2|3; comparisonDraft: PendingWorkComparison|null;
  savedBrief: SavedBrief|null; briefNeedsUpdate:boolean; reviewed: boolean; aiConsent: boolean; reviewRunId: string|null; requestCount: number; providerCallsUsed:number; providerCallLimit:number;
  reportNeedsRegeneration: boolean;
  askedClarifications: ClarificationCode[]; activeClarification: ClarificationCode|null; dismissedCode: ClarificationCode|null;
  interviewRunId:string|null; interviewPrompt:Extract<InterviewClarificationPrompt,{outcome:"ask"}>|null; clarificationLoading:boolean;
  loading: boolean; retryAllowed:boolean; error: ""|"unavailable"|"invalid"|"structuredInvalid"|"changed"|"focusChanged"|"clarificationUnavailable"|"clarificationLimitReached"|"providerCallLimitReached"; storageMessage: ""|"saved"|"unavailable"|"expired"|"invalid"; copyFailed: boolean;
  legacyBriefReplaced:boolean;
}
const emptyMap = () => ({ CLIENT_MATTER_UNCLEAR:null, VALUE_EFFORT_CONFLICT:null, CAPACITY_CONFLICT:null, REPEATABILITY_UNPROVEN:null, OPPORTUNITY_UNSUPPORTED:null });
function savedBriefMatchesAnswers(saved:SavedBrief|null,answers:DesiredClientAnswers):boolean {
  if(!saved||saved.sourceBriefRevision!==answers.revision)return false;
  const snapshot=saved.sourceAnswersSnapshot;
  if(snapshot&&typeof snapshot==="object"&&!Array.isArray(snapshot)&&"schema_version" in snapshot&&(snapshot as {schema_version?:unknown}).schema_version==="dcm-v3.3")return JSON.stringify(snapshot)===JSON.stringify(answers);
  return true;
}
export function initialToolState(): ToolState { return { view:"welcome", mode:null, answers:emptyAnswers(), stage:1, visitedStages:[], stagesToRevisit:[], comparisonStep:1, comparisonDraft:null, savedBrief:null, briefNeedsUpdate:false, reviewed:false, aiConsent:false, reviewRunId:null, requestCount:0, providerCallsUsed:0, providerCallLimit:3, reportNeedsRegeneration:false, askedClarifications:[], activeClarification:null, dismissedCode:null, interviewRunId:null, interviewPrompt:null, clarificationLoading:false, loading:false, retryAllowed:false, error:"", storageMessage:"", copyFailed:false,legacyBriefReplaced:false }; }
export function enterTool(restored?:{answers:DesiredClientAnswers;stage:StageId;savedBrief?:SavedBrief;reportNeedsRegeneration?:boolean}):ToolState {
  const rawAnswers=restored?.answers??emptyAnswers();
  const answers=rawAnswers.interview.ai_clarification_consent
    ? { ...rawAnswers, interview: { ...rawAnswers.interview, ai_clarification_consent:false } }
    : rawAnswers;
  const rawBrief=restored?.savedBrief;
  const rawSnapshot=rawBrief?.sourceAnswersSnapshot;
  const snapshot=rawSnapshot&&typeof rawSnapshot==="object"&&!Array.isArray(rawSnapshot)?rawSnapshot as Record<string,unknown>:null;
  const snapshotInterview=snapshot?.interview&&typeof snapshot.interview==="object"&&!Array.isArray(snapshot.interview)?snapshot.interview as Record<string,unknown>:null;
  const restoredBrief=rawBrief&&snapshot&&snapshotInterview?.ai_clarification_consent===true
    ? { ...rawBrief, sourceAnswersSnapshot: { ...snapshot, interview: { ...snapshotInterview, ai_clarification_consent:false } } }
    : rawBrief;
  const savedBrief=restoredBrief&&savedBriefMatchesAnswers(restoredBrief,answers)?restoredBrief:undefined;
  const reportNeedsRegeneration=restored?.reportNeedsRegeneration===true||(restoredBrief!==undefined&&!savedBrief);
  const stage=restored?.stage??1;
  return { ...initialToolState(), view:savedBrief?"brief":stage===7?"review":"questions", mode:savedBrief?.mode??"ai", answers, stage,
    // A saved report proves the interview reached review. Its persisted stage
    // may be an earlier section opened for editing just before a reload.
    visitedStages:(savedBrief?[1,2,3,4,5,6,7]:restored?[1,2,3,4,5,6,7].filter(n=>n<stage):[]) as StageId[], savedBrief:savedBrief??null, briefNeedsUpdate:reportNeedsRegeneration, reviewed:savedBrief&&!reportNeedsRegeneration?savedBrief.wordingReviewed:false, reportNeedsRegeneration, dismissedCode:savedBrief?.openClarificationCode??null,legacyBriefReplaced:false };
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
    answers.client = { ...answers.client, goals: [], goal_detail: "", concerns: [], decision_needs: [], decision_context: "", pathway_basis: null, choice_priorities: [], choice_detail: "", choice_basis: null };
    answers.client_context = { ...answers.client_context, geography: "", relevant_circumstances: "", community_focus: "", language_service_needs: "", repeat_matter_pattern: "", discovery_behaviour: "" };
    answers.value = { ...answers.value, reasons: [], fee_effort: null, collected_fee: null, team_hours: null, payment: null, payment_context: "", payment_context_basis: null, currency: "", fee_amount: "", direct_cost_amount: "", amount_basis: null, amount_scope: null };
    answers.delivery = { ...answers.delivery, conditions: [], capacity: null, limit: null, fit_signals: [] };
    answers.opportunity = { sources: [], source_detail: "", period: "", enquiry_count: "", retained_count: "", conversion: "", acquisition_cost: "", uncertainty: "", data_basis: null };
    answers.repeatability = { success_measure: null, success_other: "", target: "", review_period: "", additional_matters: "", staffing_constraint: "" };
    // Stage 1 records the firm's practice direction and marketing trade-offs.
    // Those preferences still apply when the user chooses or changes a
    // specific matter in Stage 2, so keep them while clearing matter-specific
    // downstream answers.
    answers.practice.experience = null;
    answers.practice.development_needs = [];
    answers.practice.capability = "";
    answers.practice.client_strength = null;
    answers.practice.client_strength_effect = "";
    answers.practice.client_strength_support = "";
    const writeIns = answers.write_ins ?? {};
    for (const key of Object.keys(writeIns)) if (key !== "aim") delete writeIns[key as keyof typeof writeIns];
    answers.write_ins = writeIns;
  }
  if(answers.situation.role!=="other") answers.situation.role_other="";
  if(JSON.stringify(answers)===JSON.stringify(before))return { ...s,error:"" };
  answers.revision=before.revision+1; answers.clarifications=emptyMap();
  if (areaChanged || workChanged) { answers.interview.followups=[]; answers.interview.clarification_count=0; answers.interview.clarified_stages=[]; }
  const changedStage:StageId = areaChanged || workChanged ? 2 : s.stage;
  const downstream = ([2,3,4,5,6] as StageId[]).filter((stage) => stage > changedStage && s.visitedStages.includes(stage));
  const visitedStages = s.visitedStages.filter((stage) => stage <= changedStage);
  return { ...s,answers,savedBrief:null,briefNeedsUpdate:!!s.savedBrief||s.briefNeedsUpdate,reviewed:false,reportNeedsRegeneration:s.reportNeedsRegeneration||!!s.savedBrief,reviewRunId:null,requestCount:0,providerCallsUsed:0,askedClarifications:[],activeClarification:null,dismissedCode:null,interviewRunId:areaChanged||workChanged?null:s.interviewRunId,interviewPrompt:null,clarificationLoading:false,loading:false,error:areaChanged||workChanged?"focusChanged":"",visitedStages,stagesToRevisit:[...new Set([...s.stagesToRevisit,...downstream])],view:"questions",stage:changedStage };
}
export function recordClarificationAttempt(s:ToolState, stage:1|2|3|4|5|6, runId:string):ToolState {
  const answers=structuredClone(s.answers);
  if (answers.interview.clarification_count >= 3 || answers.interview.clarified_stages.includes(stage)) return s;
  answers.interview.clarification_count += 1;
  answers.interview.clarified_stages = [...answers.interview.clarified_stages, stage];
  return { ...s, answers, interviewRunId:runId, clarificationLoading:false, error:"" };
}
export function showInterviewClarification(s:ToolState, prompt:Extract<InterviewClarificationPrompt,{outcome:"ask"}>):ToolState {
  return { ...s, view:"interviewClarification", interviewPrompt:prompt, clarificationLoading:false };
}
export function answerInterviewClarification(s:ToolState, answer:string, choiceId?:string, skipped=false):ToolState {
  const prompt=s.interviewPrompt; if(!prompt) return s;
  if(!skipped&&!isBoundedMultilineText(answer,INTERVIEW_CLARIFICATION_LIMITS.answerCharacters)) return s;
  const record:InterviewClarificationAnswer={id:prompt.id,stage:prompt.stage,purpose:prompt.purpose,source_answer_ids:prompt.source_answer_ids,source_answer_fingerprint:interviewClarificationSourceFingerprint(s.answers,prompt.source_answer_ids),question:prompt.question,answer:skipped?"":answer.replace(/\r\n?/g,"\n").trim(),...(choiceId?{choiceId}:{}),skipped,reflection:prompt.reflection};
  const answers=structuredClone(s.answers); answers.interview.followups=[...answers.interview.followups,record]; answers.revision++;
  const next=advanceStage({ ...s, answers, view:"questions", interviewPrompt:null, clarificationLoading:false });
  return { ...next, savedBrief:null, briefNeedsUpdate:!!s.savedBrief||s.briefNeedsUpdate, reviewed:false, reportNeedsRegeneration:s.reportNeedsRegeneration||!!s.savedBrief, reviewRunId:null, requestCount:0, providerCallsUsed:0, askedClarifications:[], error:"" };
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
    answers.focus.route = null;
    answers.practice.experience = null;
    answers.practice.capability = "";
    answers.practice.development_needs = [];
    const writeIns = answers.write_ins ?? {};
    delete writeIns.trigger;
    delete writeIns.decision_needs;
    delete writeIns.fit_signals;
    answers.write_ins = writeIns;
  }
  if(answers.value.fee_effort===null) answers.value.fee_effort=selected.fee_effort;
  if(answers.delivery.capacity===null) answers.delivery.capacity=selected.capacity;
  answers.revision=before.revision+1; answers.clarifications=emptyMap();
  return { ...s,answers,view:"questions",stage:2,visitedStages:[1,2],stagesToRevisit:[3,4,5,6],comparisonDraft:null,savedBrief:null,briefNeedsUpdate:!!s.savedBrief||s.briefNeedsUpdate,reviewed:false,reportNeedsRegeneration:s.reportNeedsRegeneration||!!s.savedBrief,reviewRunId:null,requestCount:0,providerCallsUsed:0,askedClarifications:[],activeClarification:null,dismissedCode:null,loading:false,error:workChanged?"focusChanged":"changed" };
}
export function beginReview(s:ToolState):ToolState { return canEnterStage(s,7)?{ ...s,view:s.savedBrief?"brief":"review",stage:7,reviewed:s.reportNeedsRegeneration?false:s.reviewed,error:"",reviewRunId:null,requestCount:0,providerCallsUsed:0,askedClarifications:[],activeClarification:null,dismissedCode:null }:s; }
export function beginAiRun(s:ToolState, createId:()=>string):ToolState {
  if(!canEnterStage(s,7)) return s;
  const currentBrief=s.savedBrief&&savedBriefMatchesAnswers(s.savedBrief,s.answers)?s.savedBrief:null;
  const reportNeedsRegeneration=s.reportNeedsRegeneration||(s.savedBrief!==null&&!currentBrief);
  return { ...s,view:currentBrief?"brief":"review",aiConsent:true,reviewRunId:createId(),requestCount:1,providerCallsUsed:0,askedClarifications:[],activeClarification:null,dismissedCode:null,savedBrief:currentBrief,briefNeedsUpdate:reportNeedsRegeneration,reviewed:reportNeedsRegeneration?false:s.reviewed,reportNeedsRegeneration,loading:true,retryAllowed:false,error:"" };
}
export function recordAiAttempt(s:ToolState):ToolState { if(!s.reviewRunId||s.loading||!s.retryAllowed||s.requestCount>=3||s.providerCallsUsed>=s.providerCallLimit) return s; return { ...s,view:s.savedBrief?"brief":"review",stage:7,requestCount:s.requestCount+1,loading:true,retryAllowed:false,error:"" }; }
export function failAnalysis(s:ToolState, error:"unavailable"|"invalid"|"providerCallLimitReached",retryAllowed=false):ToolState { return { ...s,view:s.savedBrief?"brief":"review",mode:"ai",savedBrief:s.savedBrief,briefNeedsUpdate:s.reportNeedsRegeneration||s.briefNeedsUpdate,reviewed:s.reportNeedsRegeneration?false:s.reviewed,activeClarification:null,loading:false,retryAllowed,error }; }
export function applyAnalysis(s:ToolState, result:AnalysisResult):ToolState {
  if(result.clarification_code && (s.providerCallsUsed>=s.providerCallLimit || !getEligibleClarificationCodes(s.answers,s.askedClarifications).includes(result.clarification_code))) return failAnalysis(s,"invalid");
  const recovered = result.recoveredSections?.length === 1 && result.recoveredSections[0] === "why_firm_wants_work";
  const savedBrief:SavedBrief={brief:result.brief,sourceAnswersVersion:"dcm-v3.3",sourceAnswersSnapshot:structuredClone(s.answers),sourceBriefRevision:s.answers.revision,generatedAt:new Date().toISOString(),wordingReviewed:false,mode:"ai",...(recovered?{recoveredSections:["why_firm_wants_work"]}:{}),...(result.clarification_code?{openClarificationCode:result.clarification_code}:{})};
  return { ...s,view:result.clarification_code?"clarification":"brief",savedBrief,briefNeedsUpdate:false,reviewed:false,reportNeedsRegeneration:false,activeClarification:result.clarification_code,loading:false,error:"",legacyBriefReplaced:false };
}
export function applyStructuredFallback(s:ToolState):ToolState {
  if (s.loading || getMissingRequiredFields(s.answers).length > 0) return s;
  const result = validateAnalysisResult({ brief: buildStructuredBlueprintV4(s.answers), clarification_code: null }, s.answers, []);
  if (!result) return { ...s, loading: false, retryAllowed: false, error: "structuredInvalid" };
  const savedBrief: SavedBrief = {
    brief: result.brief, sourceAnswersVersion: "dcm-v3.3", sourceAnswersSnapshot: structuredClone(s.answers),
    sourceBriefRevision: s.answers.revision, generatedAt: new Date().toISOString(), wordingReviewed: false, mode: "structured",
  };
  return { ...s, view: "brief", mode: "structured", savedBrief, briefNeedsUpdate: false, reviewed: false, reportNeedsRegeneration: false, loading: false, retryAllowed: false, error: "", legacyBriefReplaced: false };
}
export function answerClarification(s:ToolState, choice:string):ToolState {
  const code=s.activeClarification; if(!code) return { ...s,error:"invalid" };
  const canonical=clarificationOption(code,choice);
  const custom=!canonical&&choice.trim().length>0&&choice.length<=220;
  if(!canonical&&!custom) return { ...s,error:"invalid" };
  if(choice==="open"||choice==="skip"||s.requestCount>=s.providerCallLimit) return { ...s,view:s.savedBrief?"brief":"review",dismissedCode:code,activeClarification:null,reviewRunId:null,loading:false,error:"" };
  if(code==="CLIENT_MATTER_UNCLEAR"&&choice==="choose_specific") return { ...s,view:"questions",stage:2,reviewRunId:null,requestCount:0,askedClarifications:[],activeClarification:null,loading:false,error:"" };
  const answers=structuredClone(s.answers);
  answers.clarifications[code]=choice as NonNullable<DesiredClientAnswers["clarifications"][ClarificationCode]>;
  if(code==="CAPACITY_CONFLICT"&&choice==="limited_now") answers.delivery.capacity="limited";
  answers.revision++;
  return { ...s,answers,askedClarifications:[...s.askedClarifications,code],activeClarification:null,savedBrief:s.savedBrief,briefNeedsUpdate:!!s.savedBrief||s.briefNeedsUpdate,reviewed:false,reportNeedsRegeneration:s.reportNeedsRegeneration||!!s.savedBrief,requestCount:s.requestCount<s.providerCallLimit?s.requestCount+1:s.requestCount,view:s.savedBrief?"brief":"review",stage:7,loading:true,retryAllowed:false,error:"" };
}
export function markReviewed(s:ToolState, value:boolean):ToolState { if(!s.savedBrief||s.savedBrief.sourceBriefRevision!==s.answers.revision) return { ...s,error:"changed" }; return { ...s,reviewed:value,savedBrief:{...s.savedBrief,wordingReviewed:value} }; }
export function eligibleClarifications(s:ToolState){ return getEligibleClarificationCodes(s.answers,s.askedClarifications); }
