"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { STORAGE_COPY } from "@/lib/desired-client/copy";

import { buildDraftPreview, buildStructuredBrief } from "@/lib/desired-client/brief";
import { validateAnalysisResult } from "@/lib/desired-client/output";
import { getEligibleClarificationCodes } from "@/lib/desired-client/clarifications";
import { clearDraft, loadDraft, saveDraft, type DraftLoadResult } from "@/lib/desired-client/storage";
import { advanceStage, answerClarification, applyAnalysis, beginAiRun, canEnterStage, commitComparison, createStructuredBrief, editAnswers, enterTool, failAnalysis, initialToolState, markReviewed, moveToStage, recordAiAttempt, type ToolState } from "@/lib/desired-client/state";
import { STAGE_DEFINITIONS, type StageId } from "@/lib/desired-client/screens";
import type { AnalysisFailureEnvelope, AnalysisRequestEnvelope, AnalysisSuccessEnvelope, PendingWorkComparison, SavedDraft } from "@/lib/desired-client/types";
import { WelcomeScreen } from "./WelcomeScreen";
import { ResumePanel } from "./ResumePanel";
import { QuestionStage } from "./QuestionStage";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { DraftPreview } from "./DraftPreview";
import { createDesiredClientEmbedBridge } from "@/lib/desired-client/embed";
import { ComparisonStep } from "./ComparisonStep";
import { ClarificationStep } from "./ClarificationStep";
import { ReviewStep } from "./ReviewStep";
import { BriefView } from "./BriefView";
import "./desired-client.css";

function noticeFor(status:DraftLoadResult["status"]):string { if(status==="expired")return STORAGE_COPY.expired;if(status==="corrupt")return STORAGE_COPY.invalid;if(status==="unavailable")return STORAGE_COPY.unavailable;return ""; }
export default function DesiredClientTool({embedded=false}:{embedded?:boolean}) {
 const [state,setState]=useState<ToolState>(initialToolState),[savedDraft,setSavedDraft]=useState<SavedDraft|null>(null),[notice,setNotice]=useState(""),[replacePrompt,setReplacePrompt]=useState(false),[clearPrompt,setClearPrompt]=useState(false),[pendingMode,setPendingMode]=useState<"ai"|"structured"|null>(null);
 const stateRef=useRef(state),abortRef=useRef<AbortController|null>(null),initialized=useRef(false),embedBridge=useRef<ReturnType<typeof createDesiredClientEmbedBridge>>(null);
 const commit=useCallback((next:ToolState)=>{stateRef.current=next;setState(next);},[]);
 useEffect(()=>{if(initialized.current)return;initialized.current=true;try{const loaded=loadDraft(window.localStorage);setNotice(noticeFor(loaded.status));if(loaded.status==="ready")setSavedDraft(loaded.draft);if(loaded.status==="expired"||loaded.status==="corrupt")clearDraft(window.localStorage);}catch{setNotice(STORAGE_COPY.unavailable);}},[]);
 useEffect(()=>{if(state.view==="welcome"||!state.mode)return;try{const saved=saveDraft(window.localStorage,state.answers,state.stage,state.savedBrief??undefined);if(saved){setSavedDraft(saved);if(state.storageMessage){commit({...state,storageMessage:""});}}else if(!state.storageMessage)commit({...state,storageMessage:"unavailable"});}catch{if(!state.storageMessage)commit({...state,storageMessage:"unavailable"});}},[state.answers,state.stage,state.savedBrief,state.mode,state.storageMessage,commit]);
 useEffect(()=>()=>{abortRef.current?.abort();},[]);
 useEffect(()=>{if(!embedded)return;const bridge=createDesiredClientEmbedBridge();if(!bridge)return;embedBridge.current=bridge;const root=document.querySelector(".dc-app");if(!(root instanceof HTMLElement))return;const stop=bridge.observeContent(root);return()=>{stop();embedBridge.current=null;};},[embedded]);
 useEffect(()=>{if(embedded)embedBridge.current?.announceStepChange();const frame=window.requestAnimationFrame(()=>{const heading=document.querySelector(".dc-app h1");if(!(heading instanceof HTMLElement))return;heading.setAttribute("tabindex","-1");heading.focus({preventScroll:true});if(!embedded&&state.view!=="welcome"){const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;heading.scrollIntoView({behavior:reduced?"auto":"smooth",block:"start"});}});return()=>window.cancelAnimationFrame(frame);},[embedded,state.view,state.stage,state.comparisonStep]);
 const start=(mode:"ai"|"structured",draft?:SavedDraft)=>{if(!draft&&savedDraft){setPendingMode(mode);setReplacePrompt(true);return;}abortRef.current?.abort();setNotice("");commit(enterTool(stateRef.current,mode,draft?{answers:draft.answers,stage:draft.currentStage as StageId,savedBrief:draft.savedBrief}:undefined));};
 const updateAnswers=(edit:(a:import("@/lib/desired-client/types").DesiredClientAnswers)=>import("@/lib/desired-client/types").DesiredClientAnswers)=>{abortRef.current?.abort();commit(editAnswers(stateRef.current,edit));};
 const sendAnalysis=useCallback(async(snapshot:ToolState)=>{
   if(!snapshot.reviewRunId||snapshot.requestCount<1||snapshot.requestCount>3||!snapshot.loading)return;
   const requestId=crypto.randomUUID(),controller=new AbortController();abortRef.current=controller;
   let timedOut=false;
   const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},16000);
   const request:AnalysisRequestEnvelope={schemaVersion:2,requestId,answerRevision:snapshot.answers.revision,reviewRunId:snapshot.reviewRunId,analysisIndex:(snapshot.requestCount-1) as 0|1|2,aiConsent:true,answers:snapshot.answers,clarifications:snapshot.askedClarifications.map(code=>({code,answer:String(snapshot.answers.clarifications[code])}))};
   const sameRequest=(current:ToolState)=>current.reviewRunId===snapshot.reviewRunId&&current.answers.revision===snapshot.answers.revision&&current.requestCount===snapshot.requestCount;
   try{
     const response=await fetch("/api/tools/desired-client-matter/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request),signal:controller.signal});
     let payload:unknown;
     try{payload=await response.json();}catch{payload=null;}
     const current=stateRef.current;
     if(controller.signal.aborted||!sameRequest(current))return;
     if(!payload||typeof payload!=="object"||!("ok" in payload)) { commit(failAnalysis(current,"invalid"));return; }
     if(!response.ok||payload.ok!==true){
       const failure=payload as Partial<AnalysisFailureEnvelope>;
       const code=failure.error?.code;
       const retry=code==="AI_UNAVAILABLE"&&current.requestCount<3;
       commit(failAnalysis(current,code==="INVALID_AI_OUTPUT"?"invalid":"unavailable",retry));return;
     }
     const success=payload as AnalysisSuccessEnvelope;
     if(success.requestId!==requestId||success.answerRevision!==request.answerRevision||success.reviewRunId!==request.reviewRunId){commit(failAnalysis(current,"invalid"));return;}
     const result=validateAnalysisResult(success.result,current.answers,getEligibleClarificationCodes(current.answers,current.askedClarifications));
     if(!result){commit(failAnalysis(current,"invalid"));return;}
     commit(applyAnalysis(current,result));
   }catch{
     const current=stateRef.current;
     if(sameRequest(current)&&(timedOut||!controller.signal.aborted))commit(failAnalysis(current,"unavailable",current.requestCount<3));
   }finally{window.clearTimeout(timeout);if(abortRef.current===controller)abortRef.current=null;}
 },[commit]);
 const prepareAI=(initial:boolean)=>{if(stateRef.current.loading)return;let next:ToolState;if(initial)next=beginAiRun(stateRef.current,()=>crypto.randomUUID());else next=recordAiAttempt(stateRef.current);if(next===stateRef.current||!next.loading)return;commit(next);void sendAnalysis(next);}; const onAnswerClarification=(choice:string)=>{const next=answerClarification(stateRef.current,choice);commit(next);if(next.loading&&next.reviewRunId)void sendAnalysis(next);};
 const clearStored=()=>{abortRef.current?.abort();try{if(!clearDraft(window.localStorage)){setNotice(STORAGE_COPY.unavailable);commit({...stateRef.current,storageMessage:"unavailable"});return false;}}catch{setNotice(STORAGE_COPY.unavailable);commit({...stateRef.current,storageMessage:"unavailable"});return false;}setSavedDraft(null);setNotice("");commit(initialToolState());return true;};
 const createAnother=()=>{clearStored();};
 const startReplacement=()=>{setReplacePrompt(false);const cleared=clearStored();if(cleared&&pendingMode){commit(enterTool(initialToolState(),pendingMode));setPendingMode(null);}};
 const resetNotice=()=>setNotice("");
 const navigateStage=(stage:StageId)=>{abortRef.current?.abort();const moved=moveToStage(stateRef.current,stage);commit({...moved,reviewRunId:null,loading:false,retryAllowed:false});};
 const editStage=(stage:1|2|3|4|5|6)=>navigateStage(stage);
 const nextStage=()=>commit(advanceStage(stateRef.current));
 const backStage=()=>{const s=stateRef.current;if(s.stage===1){commit({...s,view:"welcome",mode:null});return;}commit(moveToStage(s,(s.stage-1) as StageId));};
 const beginComparison=()=>commit({...stateRef.current,view:"comparison",comparisonStep:1,comparisonDraft:{a:null,b:null,selected:"a"}});
 const abandonComparison=()=>commit({...stateRef.current,view:"questions",comparisonDraft:null,comparisonStep:1});
 const comparisonDraft=(draft:PendingWorkComparison)=>commit({...stateRef.current,comparisonDraft:draft});
 const onCompareCommit=(side:"a"|"b",certainty:"chosen"|"provisional")=>commit(commitComparison({...stateRef.current,comparisonDraft:{...stateRef.current.comparisonDraft!,selected:side}},certainty));
 const useAiFromReview=()=>{abortRef.current?.abort();commit({...stateRef.current,mode:"ai"});prepareAI(true);};
 const createStructured=()=>{abortRef.current?.abort();commit(createStructuredBrief({...stateRef.current,mode:"structured"}));};
 const onPrimary=()=>{if(stateRef.current.mode==="structured")createStructured();else prepareAI(true);};
 const retryAI=()=>prepareAI(false);

 return <div className={`dc-app${embedded?" dc-app--embedded":""}`}>
   <div className="dc-main" data-ui-component-content="desired-client-app-main">
    {state.view==="welcome"&&<><WelcomeScreen onChooseMode={mode=>start(mode)}/><ResumePanel draft={savedDraft} onResume={mode=>start(mode,savedDraft??undefined)} onNew={()=>{setPendingMode(null);setReplacePrompt(true);}} onClear={()=>setClearPrompt(true)} notice={notice} onNoticeDismiss={resetNotice}/></>}
    <ConfirmationDialog open={clearPrompt} onClose={()=>setClearPrompt(false)} labelledBy="dc-clear-title"><h2 id="dc-clear-title" data-ui-copy="heading">{STORAGE_COPY.clearConfirm}</h2><button className="dc-button dc-button--primary" onClick={()=>{if(clearStored())setClearPrompt(false);}}>{STORAGE_COPY.clear}</button><button className="dc-button dc-button--secondary" onClick={()=>setClearPrompt(false)}>{STORAGE_COPY.keep}</button></ConfirmationDialog>
    <ConfirmationDialog open={replacePrompt} onClose={()=>setReplacePrompt(false)} labelledBy="dc-replace-title"><h2 id="dc-replace-title" data-ui-copy="heading">{STORAGE_COPY.replaceConfirm}</h2><p data-ui-copy="body">{STORAGE_COPY.downloadBeforeReplace}</p><button className="dc-button dc-button--primary" onClick={startReplacement}>{STORAGE_COPY.replace}</button><button className="dc-button dc-button--secondary" onClick={()=>setReplacePrompt(false)}>{STORAGE_COPY.keep}</button></ConfirmationDialog>
    {(state.view==="questions"||state.view==="review")&&<nav className="dc-progress" aria-label="Progress" data-ui-component-content="desired-client-progress"><ol>{STAGE_DEFINITIONS.map(item=><li key={item.id}><button type="button" aria-current={state.stage===item.id?"step":undefined} disabled={!canEnterStage(state,item.id)} onClick={()=>navigateStage(item.id)} data-ui-copy="supporting">{item.label}</button></li>)}</ol></nav>}
    {state.view==="questions"&&<QuestionStage stage={state.stage} answers={state.answers} onEdit={updateAnswers} onBack={backStage} onNext={nextStage} onCompare={beginComparison} error={state.error==="changed"} preview={state.stage>3?<DraftPreview preview={buildDraftPreview(state.answers)}/>:undefined}/>}
    {state.view==="comparison"&&state.answers.focus.area&&<ComparisonStep area={state.answers.focus.area} draft={state.comparisonDraft} step={state.comparisonStep} onDraft={comparisonDraft} onStep={step=>commit({...stateRef.current,comparisonStep:step})} onBack={abandonComparison} onCommit={onCompareCommit}/>}
    {state.view==="clarification"&&state.activeClarification&&<ClarificationStep code={state.activeClarification} onAnswer={onAnswerClarification}/>}
    {state.view==="review"&&<ReviewStep answers={state.answers} mode={state.mode??"structured"} onCreate={onPrimary} onCreateStructured={createStructured} onUseAi={useAiFromReview} onEdit={editStage} briefNeedsUpdate={state.briefNeedsUpdate} loading={state.loading}/>}
    {state.view==="brief"&&state.savedBrief&&<BriefView saved={state.savedBrief} answers={state.answers} dismissedCode={state.dismissedCode} error={state.error} requestCount={state.requestCount} retryAllowed={state.retryAllowed} reviewed={state.reviewed} onReview={value=>commit(markReviewed(stateRef.current,value))} onEdit={()=>editStage(1)} onRetry={retryAI} onAnother={createAnother} onClear={clearStored} storageWarning={state.storageMessage==="unavailable"}/>}
    {state.view==="brief"&&!state.savedBrief&&<ReviewStep answers={state.answers} mode={state.mode??"structured"} onCreate={onPrimary} onCreateStructured={createStructured} onUseAi={useAiFromReview} onEdit={editStage} briefNeedsUpdate={state.briefNeedsUpdate} loading={state.loading}/>}
   </div>
   {embedded&&<a className="dc-open-window" href="/tools/desired-client-matter" target="_blank" rel="noreferrer">Open the tool in its own window</a>}
 </div>;
}
