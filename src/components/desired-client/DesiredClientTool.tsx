"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { COMMON_COPY, STORAGE_COPY } from "@/lib/desired-client/copy";

import { buildDraftPreview } from "@/lib/desired-client/brief";
import { validateAnalysisResult } from "@/lib/desired-client/output";
import { getEligibleClarificationCodes } from "@/lib/desired-client/clarifications";
import { clearDraft, loadDraft, saveDraft, type DraftLoadResult } from "@/lib/desired-client/storage";
import { advanceStage, answerClarification, answerInterviewClarification, applyAnalysis, applyStructuredFallback, beginAiRun, canEnterStage, commitComparison, editAnswers, enterTool, failAnalysis, initialToolState, markReviewed, moveToStage, recordAiAttempt, recordClarificationAttempt, showInterviewClarification, type ToolState } from "@/lib/desired-client/state";
import { STAGE_DEFINITIONS, type StageId } from "@/lib/desired-client/screens";
import { isInterviewClarificationAskPrompt, normalizeInterviewClarificationContinuePrompt } from "@/lib/desired-client/interview-clarification-contract";
import type { AnalysisFailureEnvelope, AnalysisRequestEnvelope, AnalysisSuccessEnvelope, DesiredClientAnswers, InterviewClarificationRequestEnvelope, InterviewClarificationSuccessEnvelope, InterviewStage, PendingWorkComparison, SavedDraft } from "@/lib/desired-client/types";
import { WelcomeScreen } from "./WelcomeScreen";
import { ResumePanel } from "./ResumePanel";
import { GuidedQuestionStage } from "./GuidedQuestionStage";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { DraftPreview } from "./DraftPreview";
import { createDesiredClientEmbedBridge } from "@/lib/desired-client/embed";
import { ComparisonStep } from "./ComparisonStep";
import { ClarificationStep } from "./ClarificationStep";
import { ReviewStep } from "./ReviewStep";
import { BriefView } from "./BriefView";
import { InterviewClarificationStep } from "./InterviewClarificationStep";
import "./desired-client.css";

function noticeFor(status:DraftLoadResult["status"],migrated=false):string { if(migrated)return STORAGE_COPY.migrated;if(status==="expired")return STORAGE_COPY.expired;if(status==="corrupt")return STORAGE_COPY.invalid;if(status==="unavailable")return STORAGE_COPY.unavailable;return ""; }
export interface ClarificationRequestBudget { runId:string|null; count:number; }
export function aiAvailabilityFromProbe(responseOk:boolean,value:unknown):boolean|null {
  if(!responseOk||!value||typeof value!=="object"||Array.isArray(value)||!("enabled" in value)||typeof (value as {enabled?:unknown}).enabled!=="boolean")return null;
  return (value as {enabled:boolean}).enabled;
}
export function reserveClarificationRequest(budget:ClarificationRequestBudget,runId:string):boolean {
  if(budget.runId!==runId){budget.runId=runId;budget.count=0;}
  if(budget.count>=6)return false;
  budget.count+=1;return true;
}
export function showValidClarificationPrompt(state:ToolState,stage:InterviewStage,runId:string,prompt:unknown):ToolState|null {
  if(!isInterviewClarificationAskPrompt(prompt,stage,state.answers)||state.answers.interview.clarification_count>=3||state.answers.interview.clarified_stages.includes(stage))return null;
  const counted=recordClarificationAttempt(state,stage,runId);
  return counted.answers.interview.clarification_count===state.answers.interview.clarification_count+1?showInterviewClarification(counted,prompt):null;
}
export function advanceWithoutClarification(state:ToolState,runId:string,failure:false|"unavailable"|"limit"=false):ToolState {
  const advanced=advanceStage({...state,interviewRunId:runId,clarificationLoading:false});
  return failure?{...advanced,error:failure==="limit"?"clarificationLimitReached":"clarificationUnavailable"}:advanced;
}
export function clarificationNoticeFor(error:ToolState["error"],aiAvailable?:boolean|null):string {
  if(error==="focusChanged")return COMMON_COPY.workChanged;
  if(error==="clarificationLimitReached")return "This draft has reached its limit for AI follow-up checks. Your answers are saved, and you can continue without another AI follow-up.";
  if(error==="clarificationUnavailable"&&aiAvailable===false)return "AI follow-ups are unavailable. Your answers are saved. Continue below.";
  if(error==="clarificationUnavailable")return "AI could not complete a follow-up this time. Your answers are saved, and you can continue.";
  return "";
}
function isClarificationContinue(value:unknown):boolean { return normalizeInterviewClarificationContinuePrompt(value)!==null; }
export default function DesiredClientTool({embedded=false}:{embedded?:boolean}) {
 const [state,setState]=useState<ToolState>(initialToolState),[savedDraft,setSavedDraft]=useState<SavedDraft|null>(null),[notice,setNotice]=useState(""),[replacePrompt,setReplacePrompt]=useState(false),[clearPrompt,setClearPrompt]=useState(false);
  const [aiAvailable,setAiAvailable]=useState<boolean|null>(null);
  const [analysisReference,setAnalysisReference]=useState<string|null>(null);
 const stateRef=useRef(state),abortRef=useRef<AbortController|null>(null),initialized=useRef(false),embedBridge=useRef<ReturnType<typeof createDesiredClientEmbedBridge>>(null);
 const interviewRequestBudget=useRef<{runId:string|null;count:number}>({runId:null,count:0});
 const commit=useCallback((next:ToolState)=>{stateRef.current=next;setState(next);},[]);
 useEffect(()=>{if(initialized.current)return;initialized.current=true;try{const loaded=loadDraft(window.localStorage);setNotice(noticeFor(loaded.status,loaded.status==="ready"&&loaded.migrated));if(loaded.status==="ready")setSavedDraft(loaded.draft);if(loaded.status==="expired"||loaded.status==="corrupt")clearDraft(window.localStorage);}catch{setNotice(STORAGE_COPY.unavailable);}},[]);
 useEffect(()=>{const controller=new AbortController();void fetch("/api/tools/desired-client-matter/analyze",{method:"GET",cache:"no-store",signal:controller.signal}).then(async response=>{const value:unknown=await response.json();setAiAvailable(aiAvailabilityFromProbe(response.ok,value));}).catch(()=>{if(!controller.signal.aborted)setAiAvailable(null);});return()=>controller.abort();},[]);
 useEffect(()=>{if(state.view==="welcome"||!state.mode)return;try{const result=saveDraft(window.localStorage,state.answers,state.stage,state.savedBrief??undefined);if(result.status==="saved"){setSavedDraft(result.draft);if(state.storageMessage!=="saved")commit({...state,storageMessage:"saved"});}else if(state.storageMessage!==result.status)commit({...state,storageMessage:result.status});}catch{if(state.storageMessage!=="unavailable")commit({...state,storageMessage:"unavailable"});}},[state.answers,state.stage,state.savedBrief,state.mode,state.view,state.storageMessage,commit]);
 useEffect(()=>()=>{abortRef.current?.abort();},[]);
 useEffect(()=>{if(!embedded)return;const bridge=createDesiredClientEmbedBridge();if(!bridge)return;embedBridge.current=bridge;const root=document.querySelector(".dc-app");if(!(root instanceof HTMLElement))return;const stop=bridge.observeContent(root);return()=>{stop();embedBridge.current=null;};},[embedded]);
 useEffect(()=>{if(embedded)embedBridge.current?.announceStepChange();const frame=window.requestAnimationFrame(()=>{const heading=document.querySelector(".dc-app h1");if(!(heading instanceof HTMLElement))return;heading.setAttribute("tabindex","-1");heading.focus({preventScroll:true});if(!embedded&&state.view!=="welcome"){const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;heading.scrollIntoView({behavior:reduced?"auto":"smooth",block:"start"});}});return()=>window.cancelAnimationFrame(frame);},[embedded,state.view,state.stage,state.comparisonStep]);
 const start=(draft?:SavedDraft)=>{if(!draft&&savedDraft){setReplacePrompt(true);return;}abortRef.current?.abort();setNotice("");commit(enterTool(draft?{answers:draft.answers,stage:draft.currentStage as StageId,savedBrief:draft.savedBrief,reportNeedsRegeneration:draft.reportNeedsRegeneration}:undefined));};
 const updateAnswers=(edit:(a:import("@/lib/desired-client/types").DesiredClientAnswers)=>import("@/lib/desired-client/types").DesiredClientAnswers)=>{abortRef.current?.abort();commit(editAnswers(stateRef.current,edit));};
 const sendAnalysis=useCallback(async(snapshot:ToolState)=>{
   if(!snapshot.reviewRunId||snapshot.requestCount<1||snapshot.requestCount>3||!snapshot.loading)return;
    const requestId=crypto.randomUUID(),controller=new AbortController();abortRef.current=controller;setAnalysisReference(null);
    const reportFailure=(phase:string,status?:number,diagnostic?:{field:string;reason:string},code?:unknown)=>{
      setAnalysisReference(requestId);
      const safeDiagnostic=diagnostic&&/^[a-z0-9_.]{1,80}$/.test(diagnostic.field)&&/^[a-z0-9_]{1,80}$/.test(diagnostic.reason)?diagnostic:undefined;
      console.warn(JSON.stringify({event:"[desired-client] analysis request failed",requestId,stage:snapshot.stage,phase,...(typeof status==="number"?{status}:{}),...(typeof code==="string"&&/^[A-Z_]{1,40}$/.test(code)?{code}:{}),...(safeDiagnostic??{})}));
    };
   let timedOut=false;
   const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},27000);
   const request:AnalysisRequestEnvelope={schemaVersion:4,operation:"generate",requestId,answerRevision:snapshot.answers.revision,reviewRunId:snapshot.reviewRunId,analysisIndex:(snapshot.requestCount-1) as 0|1|2,aiConsent:true,answers:snapshot.answers,clarifications:[]};
   const sameRequest=(current:ToolState)=>current.reviewRunId===snapshot.reviewRunId&&current.answers.revision===snapshot.answers.revision&&current.requestCount===snapshot.requestCount;
   try{
     const response=await fetch("/api/tools/desired-client-matter/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request),signal:controller.signal});
     let payload:unknown;
     try{payload=await response.json();}catch{payload=null;}
     const current=stateRef.current;
     if(controller.signal.aborted||!sameRequest(current))return;
      if(!payload||typeof payload!=="object"||!("ok" in payload)) { reportFailure("response_shape",response.status);commit(failAnalysis(current,"invalid"));return; }
     if(!response.ok||payload.ok!==true){
        const failure=payload as Partial<AnalysisFailureEnvelope>;
        const code=failure.error?.code;
        reportFailure("api_error",response.status,failure.error?.diagnostic,code);
       if(code==="AI_DISABLED")setAiAvailable(false);
       const retry=(code==="AI_UNAVAILABLE"||code==="INVALID_AI_OUTPUT")&&current.requestCount<3;
       commit(failAnalysis(current,code==="INVALID_AI_OUTPUT"?"invalid":"unavailable",retry));return;
     }
     const success=payload as AnalysisSuccessEnvelope;
      if(success.requestId!==requestId||success.answerRevision!==request.answerRevision||success.reviewRunId!==request.reviewRunId){reportFailure("response_identity",response.status);commit(failAnalysis(current,"invalid",current.requestCount<3));return;}
      let validationFailure:{field:string;reason:string}|undefined;
      const result=validateAnalysisResult(success.result,current.answers,getEligibleClarificationCodes(current.answers,current.askedClarifications).slice(0,1),failure=>{validationFailure??={field:failure.field,reason:failure.reason};});
      if(!result){reportFailure("client_validation",response.status,validationFailure);commit(failAnalysis(current,"invalid",current.requestCount<3));return;}
     commit(applyAnalysis(current,result));
   }catch{
     const current=stateRef.current;
      if(sameRequest(current)&&(timedOut||!controller.signal.aborted)){reportFailure(timedOut?"timeout":"network");commit(failAnalysis(current,"unavailable",current.requestCount<3));}
   }finally{window.clearTimeout(timeout);if(abortRef.current===controller)abortRef.current=null;}
 },[commit]);
 const requestStageClarification=useCallback(async()=>{
    const current=stateRef.current,stage=current.stage;
    if(stage===7||current.view!=="questions")return;
   if(!current.answers.interview.ai_clarification_consent||current.answers.interview.clarification_count>=3||current.answers.interview.clarified_stages.includes(stage)){
     commit(advanceStage(current));return;
   }
   if(aiAvailable===false){commit(advanceWithoutClarification(current,current.interviewRunId??crypto.randomUUID(),"unavailable"));return;}
   const requestId=crypto.randomUUID(),interviewRunId=current.interviewRunId??crypto.randomUUID(),controller=new AbortController();abortRef.current?.abort();abortRef.current=controller;
   if(!reserveClarificationRequest(interviewRequestBudget.current,interviewRunId)){commit(advanceWithoutClarification(current,interviewRunId,"limit"));return;}
   commit({...current,interviewRunId,clarificationLoading:true,error:""});
   const request:InterviewClarificationRequestEnvelope={schemaVersion:4,operation:"clarify",requestId,answerRevision:current.answers.revision,interviewRunId,clarificationIndex:current.answers.interview.clarification_count as 0|1|2,stage,aiConsent:true,answers:current.answers};
   let timedOut=false;const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},22000);
   try{
     const response=await fetch("/api/tools/desired-client-matter/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request),signal:controller.signal});
     let payload:unknown;try{payload=await response.json();}catch{payload=null;}
     const live=stateRef.current;
     if(controller.signal.aborted||live.answers.revision!==current.answers.revision||live.stage!==stage||live.view!=="questions")return;
     if(response.ok&&payload&&typeof payload==="object"&&"ok" in payload&&payload.ok===true){
       const result=payload as InterviewClarificationSuccessEnvelope;
       if(Object.keys(result).length===5&&result.requestId===requestId&&result.answerRevision===request.answerRevision&&result.interviewRunId===interviewRunId){
         if(result.prompt?.outcome==="ask"){
           const shown=showValidClarificationPrompt(live,stage,interviewRunId,result.prompt);
           if(shown){commit(shown);return;}
         }
         if(isClarificationContinue(result.prompt)){commit(advanceWithoutClarification(live,interviewRunId));return;}
       }
     }
     if(payload&&typeof payload==="object"&&"error" in payload){
       const failure=payload as Partial<AnalysisFailureEnvelope>;
       if(failure.error?.code==="AI_DISABLED")setAiAvailable(false);
     }
     commit(advanceWithoutClarification(live,interviewRunId,"unavailable"));
   }catch{
     const live=stateRef.current;
     if(live.answers.revision===current.answers.revision&&live.stage===stage&&live.view==="questions")commit(advanceWithoutClarification(live,interviewRunId,"unavailable"));
   }finally{window.clearTimeout(timeout);if(abortRef.current===controller)abortRef.current=null;}
 },[aiAvailable,commit]);
 const prepareAI=(initial:boolean)=>{if(stateRef.current.loading)return;let next:ToolState;if(initial)next=beginAiRun(stateRef.current,()=>crypto.randomUUID());else next=recordAiAttempt(stateRef.current);if(next===stateRef.current||!next.loading)return;commit(next);void sendAnalysis(next);}; const onAnswerClarification=(choice:string)=>{const next=answerClarification(stateRef.current,choice);commit(next);if(next.loading&&next.reviewRunId)void sendAnalysis(next);};
 const onInterviewAnswer=(answer:string,choiceId?:string)=>commit(answerInterviewClarification(stateRef.current,answer,choiceId));
 const onInterviewSkip=()=>commit(answerInterviewClarification(stateRef.current,"",undefined,true));
 const clearStored=()=>{abortRef.current?.abort();try{if(!clearDraft(window.localStorage)){setNotice(STORAGE_COPY.unavailable);commit({...stateRef.current,storageMessage:"unavailable"});return false;}}catch{setNotice(STORAGE_COPY.unavailable);commit({...stateRef.current,storageMessage:"unavailable"});return false;}setSavedDraft(null);setNotice("");commit(initialToolState());return true;};
 const createAnother=()=>{clearStored();};
 const startReplacement=()=>{setReplacePrompt(false);const cleared=clearStored();if(cleared)commit(enterTool());};
 const resetNotice=()=>setNotice("");
 const navigateStage=(stage:StageId)=>{abortRef.current?.abort();const moved=moveToStage(stateRef.current,stage);commit({...moved,reviewRunId:null,loading:false,retryAllowed:false});};
 const editStage=(stage:1|2|3|4|5|6)=>navigateStage(stage);
 const nextStage=()=>{if(stateRef.current.clarificationLoading)return;void requestStageClarification();};
 const backStage=()=>{const s=stateRef.current;if(s.stage===1){commit({...s,view:"welcome",mode:null});return;}commit(moveToStage(s,(s.stage-1) as StageId));};
 const beginComparison=()=>commit({...stateRef.current,view:"comparison",comparisonStep:1,comparisonDraft:{a:null,b:null,selected:"a"}});
 const abandonComparison=()=>commit({...stateRef.current,view:"questions",comparisonDraft:null,comparisonStep:1});
 const comparisonDraft=(draft:PendingWorkComparison)=>commit({...stateRef.current,comparisonDraft:draft});
 const onCompareCommit=(side:"a"|"b",certainty:"chosen"|"provisional")=>commit(commitComparison({...stateRef.current,comparisonDraft:{...stateRef.current.comparisonDraft!,selected:side}},certainty));
 const onPrimary=()=>aiAvailable===false?createStructured():prepareAI(true);
 const retryAI=()=>prepareAI(false);
 const createStructured=()=>commit(applyStructuredFallback(stateRef.current));

 return <div className={`dc-app${embedded?" dc-app--embedded":""}`}>
   <div className="dc-main" data-ui-component-content="desired-client-app-main">
    {state.view!=="welcome"&&state.storageMessage&&<p className="dc-alert" role={state.storageMessage==="saved"?"status":"alert"} data-ui-copy="supporting">{state.storageMessage==="saved"?"Progress saved in this browser.":state.storageMessage==="invalid"?"Your latest answers could not be validated for saving. Your last valid saved draft is preserved.":STORAGE_COPY.unavailable}</p>}
    {state.view==="welcome"&&<><WelcomeScreen onStart={()=>start()} aiAvailable={aiAvailable}/><ResumePanel draft={savedDraft} onResume={()=>start(savedDraft??undefined)} onNew={()=>setReplacePrompt(true)} onClear={()=>setClearPrompt(true)} notice={notice} onNoticeDismiss={resetNotice}/></>}
    <ConfirmationDialog open={clearPrompt} onClose={()=>setClearPrompt(false)} labelledBy="dc-clear-title"><h2 id="dc-clear-title" data-ui-copy="heading">{STORAGE_COPY.clearConfirm}</h2><button className="dc-button dc-button--primary" onClick={()=>{if(clearStored())setClearPrompt(false);}}>{STORAGE_COPY.clear}</button><button className="dc-button dc-button--secondary" onClick={()=>setClearPrompt(false)}>{STORAGE_COPY.keep}</button></ConfirmationDialog>
    <ConfirmationDialog open={replacePrompt} onClose={()=>setReplacePrompt(false)} labelledBy="dc-replace-title"><h2 id="dc-replace-title" data-ui-copy="heading">{STORAGE_COPY.replaceConfirm}</h2><p data-ui-copy="body">{STORAGE_COPY.downloadBeforeReplace}</p><button className="dc-button dc-button--primary" onClick={startReplacement}>{STORAGE_COPY.replace}</button><button className="dc-button dc-button--secondary" onClick={()=>setReplacePrompt(false)}>{STORAGE_COPY.keep}</button></ConfirmationDialog>
    {(state.view==="questions"||state.view==="review")&&<nav className="dc-progress" aria-label="Progress" data-ui-component-content="desired-client-progress"><ol>{STAGE_DEFINITIONS.map(item=><li key={item.id}><button type="button" aria-current={state.stage===item.id?"step":undefined} disabled={!canEnterStage(state,item.id)} onClick={()=>navigateStage(item.id)} data-ui-copy="supporting">{item.label}</button></li>)}</ol></nav>}
    {state.view==="questions"&&<GuidedQuestionStage stage={state.stage} answers={state.answers} onEdit={updateAnswers} onBack={backStage} onNext={nextStage} onCompare={beginComparison} error={state.error==="changed"} notice={clarificationNoticeFor(state.error,aiAvailable)} aiAvailable={aiAvailable} preview={state.stage>3?<DraftPreview preview={buildDraftPreview(state.answers)}/>:undefined}/>}
    {state.view==="interviewClarification"&&state.interviewPrompt&&<InterviewClarificationStep prompt={state.interviewPrompt} onAnswer={onInterviewAnswer} onSkip={onInterviewSkip}/>}
    {state.view==="comparison"&&state.answers.focus.area&&<ComparisonStep area={state.answers.focus.area} draft={state.comparisonDraft} step={state.comparisonStep} onDraft={comparisonDraft} onStep={step=>commit({...stateRef.current,comparisonStep:step})} onBack={abandonComparison} onCommit={onCompareCommit}/>}
    {state.view==="clarification"&&state.activeClarification&&<ClarificationStep code={state.activeClarification} onAnswer={onAnswerClarification}/>}
     {state.view==="review"&&<ReviewStep answers={state.answers} onCreate={onPrimary} onRetry={retryAI} onCreateStructured={createStructured} onEdit={editStage} briefNeedsUpdate={state.briefNeedsUpdate} loading={state.loading} error={state.error==="clarificationUnavailable"||state.error==="clarificationLimitReached"?"":state.error} retryAllowed={state.retryAllowed} legacyBriefReplaced={state.legacyBriefReplaced} aiAvailable={aiAvailable!==false} reportNeedsRegeneration={state.reportNeedsRegeneration} failureReference={analysisReference}/>}
    {state.view==="brief"&&state.savedBrief&&<BriefView saved={state.savedBrief} answers={state.answers} dismissedCode={state.dismissedCode} reviewed={state.reviewed} onReview={value=>commit(markReviewed(stateRef.current,value))} onEdit={editStage} onAnother={createAnother} onClear={clearStored} storageWarning={state.storageMessage==="unavailable"}/>}
     {state.view==="brief"&&!state.savedBrief&&<ReviewStep answers={state.answers} onCreate={onPrimary} onRetry={retryAI} onCreateStructured={createStructured} onEdit={editStage} briefNeedsUpdate={state.briefNeedsUpdate} loading={state.loading} error={state.error==="clarificationUnavailable"||state.error==="clarificationLimitReached"?"":state.error} retryAllowed={state.retryAllowed} legacyBriefReplaced={state.legacyBriefReplaced} aiAvailable={aiAvailable!==false} reportNeedsRegeneration={state.reportNeedsRegeneration} failureReference={analysisReference}/>}
   </div>
   {embedded&&<a className="dc-open-window" href="/tools/desired-client-matter" target="_blank" rel="noreferrer">Open the tool in its own window</a>}
 </div>;
}
