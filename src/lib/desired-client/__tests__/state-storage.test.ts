import {describe,expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {completeAnswers,validBlueprint} from "./blueprint-helpers";
import {buildStructuredBrief} from "../brief";
import {buildStructuredBlueprintV4} from "../structured-blueprint";
import {answerInterviewClarification,applyAnalysis,applyStructuredFallback,beginAiRun,canEnterStage,editAnswers,enterTool,failAnalysis,initialToolState,markReviewed,moveToStage,recordClarificationAttempt,showInterviewClarification} from "../state";
import {interviewClarificationSourceFingerprint,type InterviewClarificationPrompt} from "../types";
import {DRAFT_STORAGE_KEY,loadDraft,saveDraft,savedAnalysis} from "../storage";
import {ReviewStep} from "@/components/desired-client/ReviewStep";
import {BriefView} from "@/components/desired-client/BriefView";
import {ResumePanel} from "@/components/desired-client/ResumePanel";
function memory(){const values=new Map<string,string>();return {values,storage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}} as unknown as Storage};}
function legacyV22(a=completeAnswers()):Record<string,unknown>{return {schema_version:"dcm-v2.2",revision:a.revision,focus:a.focus,situation:a.situation,client:{goals:a.client.goals,concerns:a.client.concerns,decision_needs:a.client.decision_needs},value:{reasons:a.value.reasons,fee_effort:a.value.fee_effort,collected_fee:a.value.collected_fee,team_hours:a.value.team_hours,payment:a.value.payment},delivery:a.delivery,direction:{aim:a.direction.aim,evidence:a.direction.evidence,less:a.direction.less,less_note:a.direction.less_note},clarifications:{FOCUS_UNCLEAR:null,CLIENT_GOAL_UNCLEAR:null,CURRENT_CAPACITY_CONFLICT:null,FEE_EFFORT_CONFLICT:null,EXPERIENCE_DIRECTION_CONFLICT:null}};}
function legacyV1Brief(){const s=(text:string)=>({text,kind:"preference",source_answer_ids:["focus.work","situation.role","situation.trigger"]});return {report_version:"dcm-blueprint-v1",portrait:s("The firm wants to grow business acquisitions for business owners facing a planned transaction."),client_need:s("The owner wants to understand the transaction and decide what to do."),firm_value:s("The work fits the firm's skills and preferred direction."),marketing:{message:s("Understand the transaction before deciding."),content:s("What buyers should clarify before binding terms."),next_step:s("Discuss the planned acquisition.")},open_questions:[]};}
describe("draft lifecycle and migration",()=>{
 it("keeps follow-up consent in the live answers but out of saved answers and report snapshots",()=>{
  const {storage}=memory(),answers=completeAnswers();answers.interview.ai_clarification_consent=true;
  const report=savedAnalysis(validBlueprint(answers),answers)!;report.wordingReviewed=true;
  const now=Date.now(),saved=saveDraft(storage,answers,7,report,now);
  expect(saved.status).toBe("saved");
  expect(answers.interview.ai_clarification_consent).toBe(true);
  if(saved.status==="saved"){
   expect(saved.draft.answers.interview.ai_clarification_consent).toBe(false);
   expect((saved.draft.savedBrief?.sourceAnswersSnapshot as typeof answers|undefined)?.interview.ai_clarification_consent).toBe(false);
   expect(saved.draft.savedBrief?.wordingReviewed).toBe(true);
   const loaded=loadDraft(storage,now+1);
   expect(loaded.status).toBe("ready");
   if(loaded.status==="ready"){
    const resumed=enterTool({answers:loaded.draft.answers,stage:7,savedBrief:loaded.draft.savedBrief});
    expect(resumed.answers.interview.ai_clarification_consent).toBe(false);
    expect(resumed.savedBrief?.generatedAt).toBe(report.generatedAt);
    expect(resumed.reviewed).toBe(true);
    expect(resumed.reportNeedsRegeneration).toBe(false);
   }
  }
 });
 it("clears legacy persisted consent on reload without changing report review or expiry",()=>{
  const {storage,values}=memory(),answers=completeAnswers();answers.interview.ai_clarification_consent=true;
  const report=savedAnalysis(validBlueprint(answers),answers)!;report.wordingReviewed=true;
  const now=Date.now(),lastEditedAt=new Date(now-5000).toISOString(),expiresAt=new Date(now+100000).toISOString();
  storage.setItem(DRAFT_STORAGE_KEY,JSON.stringify({schemaVersion:2,answers,currentStage:7,lastEditedAt,expiresAt,savedBrief:report}));
  const loaded=loadDraft(storage,now);
  expect(loaded.status).toBe("ready");
  if(loaded.status==="ready"){
   expect(loaded.migrated).toBe(true);
   expect(loaded.draft.answers.interview.ai_clarification_consent).toBe(false);
   expect((loaded.draft.savedBrief?.sourceAnswersSnapshot as typeof answers|undefined)?.interview.ai_clarification_consent).toBe(false);
   expect(loaded.draft.savedBrief?.wordingReviewed).toBe(true);
   expect(loaded.draft.savedBrief?.generatedAt).toBe(report.generatedAt);
   expect(loaded.draft.reportNeedsRegeneration).toBeUndefined();
   expect(loaded.draft.lastEditedAt).toBe(lastEditedAt);
   expect(loaded.draft.expiresAt).toBe(expiresAt);
   const persisted=JSON.parse(values.get(DRAFT_STORAGE_KEY)!);
   expect(persisted.answers.interview.ai_clarification_consent).toBe(false);
   const resumed=enterTool({answers:loaded.draft.answers,stage:loaded.draft.currentStage as 7,savedBrief:loaded.draft.savedBrief,reportNeedsRegeneration:loaded.draft.reportNeedsRegeneration});
   expect(resumed.answers.interview.ai_clarification_consent).toBe(false);
   expect(resumed.savedBrief?.brief).toEqual(report.brief);
   expect(resumed.reviewed).toBe(true);
   expect(resumed.reportNeedsRegeneration).toBe(false);
  }
 });
 it("resets all dependent v3.3 discovery answers when focus changes",()=>{const a=completeAnswers();a.client.choice_priorities=["clear_fees"];a.client.choice_basis="firm_hypothesis";a.client.choice_detail="Fast advice";a.client.goal_detail="Understand the options";a.client.decision_context="Before committing";a.client.pathway_basis="firm_observation";a.client_context.discovery_behaviour="Searches for a referral";a.value.payment="predictable";a.value.payment_context="Recent invoices were paid on schedule.";a.value.payment_context_basis="firm_observation";a.write_ins={trigger:"Offer received",fit_signals:"Can share information"};const state={...initialToolState(),view:"brief" as const,answers:a,savedBrief:{brief:buildStructuredBrief(a),sourceBriefRevision:a.revision,generatedAt:new Date().toISOString(),wordingReviewed:true,mode:"structured" as const},reviewed:true};const next=editAnswers(state,d=>({...d,focus:{...d.focus,area:"employment"}}));expect(next.answers.situation.trigger).toBeNull();expect(next.answers.client.decision_needs).toEqual([]);expect(next.answers.client.choice_priorities).toEqual([]);expect(next.answers.client.choice_basis).toBeNull();expect(next.answers.client.choice_detail).toBe("");expect(next.answers.client.goal_detail).toBe("");expect(next.answers.client.decision_context).toBe("");expect(next.answers.client.pathway_basis).toBeNull();expect(next.answers.client_context.discovery_behaviour).toBe("");expect(next.answers.value.payment).toBeNull();expect(next.answers.value.payment_context).toBe("");expect(next.answers.value.payment_context_basis).toBeNull();expect(next.answers.delivery.fit_signals).toEqual([]);expect(next.answers.write_ins?.trigger).toBeUndefined();expect(next.savedBrief).toBeNull();expect(next.reviewed).toBe(false);});
 it("preserves the firm's practice direction and marketing trade-offs when the matter focus is chosen",()=>{const a=completeAnswers();a.direction={aim:"narrower",evidence:["preference"],less:"within",less_reason:"preference",less_note:"Routine one-off reviews"};const state={...initialToolState(),view:"questions" as const,stage:2 as const,answers:a};const next=editAnswers(state,d=>({...d,focus:{...d.focus,area:"business",work:"business_agreements"}}));expect(next.answers.direction).toEqual(a.direction);});
 it("migrates a strict v2.1 draft, preserves its TTL and maps its last section to the nearest new section",()=>{const {storage}=memory(),a=completeAnswers(),v22=legacyV22(a);const legacy={...v22,schema_version:"dcm-v2.1",situation:{timing:a.situation.timing,role:a.situation.role,role_other:a.situation.role_other,contact:a.situation.contact},client:{goals:a.client.goals,concerns:a.client.concerns},delivery:{conditions:a.delivery.conditions,capacity:a.delivery.capacity,limit:a.delivery.limit}} as Record<string,unknown>;const now=Date.now(),record={schemaVersion:2,answers:legacy,currentStage:6,lastEditedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+100000).toISOString()};storage.setItem(DRAFT_STORAGE_KEY,JSON.stringify(record));const loaded=loadDraft(storage,now);expect(loaded.status).toBe("ready");if(loaded.status==="ready"){expect(loaded.migrated).toBe(true);expect(loaded.draft.answers.schema_version).toBe("dcm-v3.3");expect(loaded.draft.answers.value.payment).toBe(a.value.payment);expect(loaded.draft.answers.value.payment_context).toBe("");expect(loaded.draft.answers.value.payment_context_basis).toBeNull();expect(loaded.draft.currentStage).toBe(5);expect(loaded.draft.savedBrief).toBeUndefined();expect(Date.parse(loaded.draft.expiresAt)).toBe(now+100000);} });
 it("migrates v2.2 fields conservatively and retains a v1 report without relabeling it",()=>{const {storage}=memory(),a=completeAnswers(),legacy=legacyV22(a),now=Date.now(),record={schemaVersion:2,answers:legacy,currentStage:4,lastEditedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+100000).toISOString(),savedBrief:{brief:legacyV1Brief(),sourceBriefRevision:a.revision,generatedAt:new Date(now).toISOString(),wordingReviewed:true,mode:"ai"}};storage.setItem(DRAFT_STORAGE_KEY,JSON.stringify(record));const loaded=loadDraft(storage,now);expect(loaded.status).toBe("ready");if(loaded.status==="ready"){expect(loaded.draft.answers.schema_version).toBe("dcm-v3.3");expect(loaded.draft.answers.opportunity.sources).toEqual(["unknown"]);expect(loaded.draft.answers.repeatability.success_measure).toBeNull();expect(loaded.draft.savedBrief?.brief.report_version).toBe("dcm-blueprint-v1");expect(loaded.draft.savedBrief?.sourceAnswersVersion).toBe("dcm-v2.2");expect((loaded.draft.savedBrief?.sourceAnswersSnapshot as {schema_version:string}).schema_version).toBe("dcm-v2.2");}});
  it("migrates a v3.2 consent-true draft, preserves its TTL and reopens its saved report",()=>{const {storage}=memory(),answers=completeAnswers();answers.interview.ai_clarification_consent=true;answers.value.payment="uncertain";const oldAnswers=structuredClone(answers) as unknown as Record<string,unknown>,oldValue=oldAnswers.value as Record<string,unknown>;oldAnswers.schema_version="dcm-v3.2";delete oldValue.payment_context;delete oldValue.payment_context_basis;const prior={brief:validBlueprint(answers).brief,sourceAnswersVersion:"dcm-v3.2",sourceAnswersSnapshot:structuredClone(oldAnswers),sourceBriefRevision:answers.revision,generatedAt:"2026-09-29T14:00:00.000Z",wordingReviewed:true,mode:"ai"};const now=Date.now(),record={schemaVersion:2,answers:oldAnswers,currentStage:7,lastEditedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+100000).toISOString(),savedBrief:prior};storage.setItem(DRAFT_STORAGE_KEY,JSON.stringify(record));const loaded=loadDraft(storage,now);expect(loaded.status).toBe("ready");if(loaded.status==="ready"){expect(loaded.migrated).toBe(true);expect(loaded.draft.answers.schema_version).toBe("dcm-v3.3");expect(loaded.draft.answers.interview.ai_clarification_consent).toBe(false);expect(loaded.draft.answers.value.payment_context).toBe("");expect(loaded.draft.answers.value.payment_context_basis).toBeNull();expect(loaded.draft.answers.value.payment).toBe("uncertain");expect(loaded.draft.savedBrief?.wordingReviewed).toBe(false);expect(loaded.draft.savedBrief?.refreshedFrom).toEqual({generatedAt:"2026-09-29T14:00:00.000Z",wordingReviewed:true,mode:"ai"});expect(loaded.draft.savedBrief?.sourceAnswersVersion).toBe("dcm-v3.3");expect((loaded.draft.savedBrief?.sourceAnswersSnapshot as typeof answers).interview.ai_clarification_consent).toBe(false);expect(loaded.draft.savedBrief?.sourceAnswersSnapshot).toEqual(loaded.draft.answers);expect(Date.parse(loaded.draft.expiresAt)).toBe(now+100000);const saved=saveDraft(storage,loaded.draft.answers,7,loaded.draft.savedBrief,now+1000);expect(saved.status).toBe("saved");const reopened=loadDraft(storage,now+1000);expect(reopened.status).toBe("ready");if(reopened.status==="ready"){expect(reopened.draft.savedBrief?.sourceAnswersVersion).toBe("dcm-v3.3");expect(reopened.draft.answers).toEqual(loaded.draft.answers);}}});
 it("saves and restores bounded multiline discovery answers",()=>{const {storage}=memory(),a=completeAnswers();a.practice.firm_type="Owner-led firms\nwith a planned acquisition";a.client.goal_detail="Understand the risks\nbefore agreeing to terms";const saved=saveDraft(storage,a,7);expect(saved.status).toBe("saved");const loaded=loadDraft(storage);expect(loaded.status).toBe("ready");if(loaded.status==="ready"){expect(loaded.draft.answers.practice.firm_type).toBe(a.practice.firm_type);expect(loaded.draft.answers.client.goal_detail).toBe(a.client.goal_detail);}});
 it("does not bless unstamped historical followups against the current answer context",()=>{const {storage}=memory(),a=completeAnswers();a.interview.clarification_count=1;a.interview.clarified_stages=[3];a.interview.followups=[{id:"11111111-1111-4111-8111-111111111111",stage:3,purpose:"firm_desirability",source_answer_ids:["value.reasons"],question:"Why does the firm prefer this work?",answer:"The work uses our transaction experience.",skipped:false}];const saved=saveDraft(storage,a,7);expect(saved.status).toBe("saved");const loaded=loadDraft(storage);expect(loaded.status).toBe("ready");if(loaded.status==="ready"){const followup=loaded.draft.answers.interview.followups[0];expect(followup.source_answer_fingerprint).toBeUndefined();expect(buildStructuredBrief(loaded.draft.answers).why_firm_wants_work.claims.some(claim=>claim.text.includes("The work uses our transaction experience."))).toBe(false);}});
 it("stamps each saved interview response against the source answers shown with its question",()=>{const a=completeAnswers(),runId="22222222-2222-4222-8222-222222222222",prompt={outcome:"ask" as const,id:"11111111-1111-4111-8111-111111111111",stage:3 as const,purpose:"firm_desirability" as const,source_answer_ids:["value.reasons" as const],question:"Why does the firm prefer this work?",choices:[{id:"fit",label:"It fits the team"},{id:"other",label:"Something else"}],reflection:""};const counted=recordClarificationAttempt({...initialToolState(),answers:a,view:"questions",stage:3},3,runId);const answered=answerInterviewClarification(showInterviewClarification(counted,prompt),"We value the work's practical impact.");expect(answered.answers.interview.followups[0].source_answer_fingerprint).toBe(interviewClarificationSourceFingerprint(a,prompt.source_answer_ids));});
 it("does not commit a custom follow-up answer the shared validator would reject",()=>{
   const answers=completeAnswers();
   const prompt={outcome:"ask",id:"11111111-1111-4111-8111-111111111111",stage:2,purpose:"client_goal_detail",source_answer_ids:["client.goal_detail"],question:"What outcome does the client want?",choices:[{id:"one",label:"Understand the options"},{id:"two",label:"Something else"}],reflection:""} as Extract<InterviewClarificationPrompt,{outcome:"ask"}>;
   const state=showInterviewClarification({...initialToolState(),view:"interviewClarification",answers,stage:2},prompt);
   const result=answerInterviewClarification(state,Array.from({length:13},()=>"line").join("\n"));
   expect(result).toBe(state);
   expect(result.answers.interview.followups).toHaveLength(0);
 });
 it("preserves the last valid draft when storage fails or input is invalid",()=>{const {storage,values}=memory(),a=completeAnswers();const first=saveDraft(storage,a,6);expect(first.status).toBe("saved");const previous=values.get(DRAFT_STORAGE_KEY);const broken={...storage,setItem:()=>{throw new DOMException("quota","QuotaExceededError");}} as unknown as Storage;const failed=saveDraft(broken,{...a,revision:a.revision+1},6);expect(failed.status).toBe("unavailable");expect(values.get(DRAFT_STORAGE_KEY)).toBe(previous);const unreadable={...storage,getItem:()=>{throw new DOMException("blocked","SecurityError");},setItem:()=>{throw new Error("must not overwrite without reading the previous value");}} as unknown as Storage;expect(saveDraft(unreadable,{...a,revision:a.revision+1},6).status).toBe("unavailable");expect(values.get(DRAFT_STORAGE_KEY)).toBe(previous);const invalid=saveDraft(storage,{...a,revision:-1},6);expect(invalid.status).toBe("invalid");const tooManyLines=structuredClone(a);tooManyLines.practice.firm_type=Array.from({length:13},()=>"line").join("\n");expect(saveDraft(storage,tooManyLines,6).status).toBe("invalid");expect(values.get(DRAFT_STORAGE_KEY)).toBe(previous);});
 it("restores a valid structured report directly into the report view",()=>{const {storage}=memory(),answers=completeAnswers(),state=applyStructuredFallback({...initialToolState(),view:"review" as const,stage:7 as const,answers});expect(state.savedBrief).toBeTruthy();const saved=saveDraft(storage,state.answers,7,state.savedBrief??undefined);expect(saved.status).toBe("saved");const loaded=loadDraft(storage);expect(loaded.status).toBe("ready");if(loaded.status==="ready"){const entered=enterTool({answers:loaded.draft.answers,stage:loaded.draft.currentStage as 7,savedBrief:loaded.draft.savedBrief});expect(entered.view).toBe("brief");expect(entered.mode).toBe("structured");expect(entered.savedBrief?.brief.report_version).toBe("dcm-blueprint-v4");expect(entered.legacyBriefReplaced).toBe(false);}});
  it("keeps an unchanged reviewed AI report through navigation, failed regeneration and reload",()=>{
  const {storage}=memory(),answers=completeAnswers(),generated=applyAnalysis({...initialToolState(),view:"review" as const,stage:7 as const,answers},validBlueprint(answers));
  expect(saveDraft(storage,generated.answers,7,generated.savedBrief??undefined).status).toBe("saved");
  const firstLoad=loadDraft(storage);
  expect(firstLoad.status).toBe("ready");
  if(firstLoad.status!=="ready")return;
  const firstResume=enterTool({answers:firstLoad.draft.answers,stage:7,savedBrief:firstLoad.draft.savedBrief,reportNeedsRegeneration:firstLoad.draft.reportNeedsRegeneration});
  const approved=markReviewed(firstResume,true);
  expect(approved.reviewed).toBe(true);
  expect(saveDraft(storage,approved.answers,7,approved.savedBrief??undefined).status).toBe("saved");
  const loaded=loadDraft(storage);
  expect(loaded.status).toBe("ready");
  if(loaded.status!=="ready")return;
  const resumed=enterTool({answers:loaded.draft.answers,stage:7,savedBrief:loaded.draft.savedBrief,reportNeedsRegeneration:loaded.draft.reportNeedsRegeneration});
  const section=moveToStage(resumed,3),review=moveToStage(section,7);
  const running=beginAiRun(review,()=>"33333333-3333-4333-8333-333333333333");
  expect(running.answers).toEqual(answers);
  expect(running.savedBrief).toEqual(resumed.savedBrief);
  expect(running.reviewed).toBe(true);
  expect(running.savedBrief?.wordingReviewed).toBe(true);
  const failed=failAnalysis(running,"unavailable",true);
  expect(failed.view).toBe("brief");
  expect(failed.savedBrief).toEqual(resumed.savedBrief);
  expect(failed.reviewed).toBe(true);
  const persisted=saveDraft(storage,failed.answers,failed.stage,failed.savedBrief??undefined,Date.now(),failed.reportNeedsRegeneration);
  expect(persisted.status).toBe("saved");
  const afterFailure=loadDraft(storage);
  expect(afterFailure.status).toBe("ready");
  if(afterFailure.status==="ready"){
    const reopened=enterTool({answers:afterFailure.draft.answers,stage:afterFailure.draft.currentStage as 7,savedBrief:afterFailure.draft.savedBrief,reportNeedsRegeneration:afterFailure.draft.reportNeedsRegeneration});
    expect(reopened.savedBrief?.sourceAnswersSnapshot).toEqual(answers);
    expect(reopened.savedBrief?.wordingReviewed).toBe(true);
    expect(reopened.reviewed).toBe(true);
  }
 });
 it("persists a stale-report notice after answers change without restoring that report as current",()=>{
  const {storage}=memory(),answers=completeAnswers(),generated=applyAnalysis({...initialToolState(),view:"review" as const,stage:7 as const,answers},validBlueprint(answers)),approved=markReviewed(generated,true);
  expect(saveDraft(storage,approved.answers,7,approved.savedBrief??undefined).status).toBe("saved");
  const changed=editAnswers(approved,a=>({...a,client:{...a.client,goal_detail:"Clarify the buyer's obligations before signing."}}));
  expect(changed.savedBrief).toBeNull();
  expect(changed.reportNeedsRegeneration).toBe(true);
  expect(saveDraft(storage,changed.answers,changed.stage,undefined,Date.now(),changed.reportNeedsRegeneration).status).toBe("saved");
  const loaded=loadDraft(storage);
  expect(loaded.status).toBe("ready");
  if(loaded.status==="ready"){
    expect(loaded.draft.savedBrief).toBeUndefined();
    expect(loaded.draft.reportNeedsRegeneration).toBe(true);
    const reopened=enterTool({answers:loaded.draft.answers,stage:loaded.draft.currentStage as 2,savedBrief:loaded.draft.savedBrief,reportNeedsRegeneration:loaded.draft.reportNeedsRegeneration});
    expect(reopened.reportNeedsRegeneration).toBe(true);
    expect(reopened.savedBrief).toBeNull();
  }
 });
 it("saves and resumes AI reports with the exact answer snapshot they were generated from",()=>{const {storage}=memory(),answers=completeAnswers(),result={brief:buildStructuredBrief(answers),clarification_code:null},state=applyAnalysis({...initialToolState(),view:"review" as const,stage:7 as const,answers},result);expect(state.savedBrief?.sourceAnswersVersion).toBe("dcm-v3.3");expect(state.savedBrief?.sourceAnswersSnapshot).toEqual(answers);const saved=saveDraft(storage,state.answers,7,state.savedBrief??undefined);expect(saved.status).toBe("saved");const loaded=loadDraft(storage);expect(loaded.status).toBe("ready");if(loaded.status==="ready"){const entered=enterTool({answers:loaded.draft.answers,stage:loaded.draft.currentStage as 7,savedBrief:loaded.draft.savedBrief});expect(entered.view).toBe("brief");expect(entered.mode).toBe("ai");expect(entered.savedBrief?.brief.report_version).toBe("dcm-blueprint-v4");expect(entered.savedBrief?.sourceAnswersSnapshot).toEqual(answers);}});
 it.each(["ai","structured"] as const)("opens every report edit section after resuming an early edit in %s mode",(mode)=>{
  const {storage}=memory(),answers=completeAnswers();
  const generated=mode==="ai"
    ?applyAnalysis({...initialToolState(),view:"review" as const,stage:7 as const,answers},validBlueprint(answers))
    :applyStructuredFallback({...initialToolState(),view:"review" as const,stage:7 as const,answers});
  expect(generated.savedBrief).toBeTruthy();
  const earlier=moveToStage(generated,1);
  expect(earlier.view).toBe("questions");
  expect(saveDraft(storage,earlier.answers,earlier.stage,earlier.savedBrief??undefined).status).toBe("saved");
  const loaded=loadDraft(storage);
  expect(loaded.status).toBe("ready");
  if(loaded.status!=="ready")return;
  const resumed=enterTool({answers:loaded.draft.answers,stage:loaded.draft.currentStage as 1,savedBrief:loaded.draft.savedBrief});
  expect(resumed.view).toBe("brief");
  expect(resumed.savedBrief?.sourceAnswersSnapshot).toEqual(answers);
  for(const stage of [1,2,3,4,5,6] as const){
    expect(canEnterStage(resumed,stage)).toBe(true);
    expect(moveToStage(resumed,stage).stage).toBe(stage);
    expect(moveToStage(resumed,stage).view).toBe("questions");
  }
  expect(editAnswers(moveToStage(resumed,3),a=>({...a,value:{...a.value,fee_amount:"9500"}})).savedBrief).toBeNull();
 });
 it("refreshes a previous structured report only from the exact saved answers and prompts a new review",()=>{
   const {storage,values}=memory(),answers=completeAnswers(),oldDate="2026-09-29T14:00:00.000Z",current=buildStructuredBrief(answers);
  const prior={brief:{...current,definition_sentence:"Earlier structured definition."},sourceAnswersVersion:"dcm-v3.2" as const,sourceAnswersSnapshot:structuredClone(answers),sourceBriefRevision:answers.revision,generatedAt:oldDate,wordingReviewed:true,mode:"structured" as const};
  const now=Date.now();
  storage.setItem(DRAFT_STORAGE_KEY,JSON.stringify({schemaVersion:2,answers,currentStage:7,lastEditedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+100000).toISOString(),savedBrief:prior}));
  const loaded=loadDraft(storage,now);
  expect(loaded.status).toBe("ready");
  if(loaded.status==="ready"){
   expect(loaded.migrated).toBe(true);
   expect(loaded.draft.answers).toEqual(answers);
   expect(loaded.draft.savedBrief?.brief).toEqual(current);
   expect(loaded.draft.savedBrief?.wordingReviewed).toBe(false);
    expect(loaded.draft.savedBrief?.refreshedFrom).toEqual({generatedAt:oldDate,wordingReviewed:true,mode:"structured"});
    expect(JSON.parse(values.get(DRAFT_STORAGE_KEY)!).savedBrief.refreshedFrom.generatedAt).toBe(oldDate);
   const html=renderToStaticMarkup(createElement(BriefView,{saved:loaded.draft.savedBrief!,answers:loaded.draft.answers,dismissedCode:null,reviewed:false,onReview:()=>{},onEdit:()=>{},onAnother:()=>{},onClear:()=>{},storageWarning:false}));
    expect(html).toContain("No AI generation was used.");
    expect(html).toContain("Review this refreshed wording before using it in marketing.");
    expect(html).toContain("This saved structured blueprint was rebuilt from its saved answers");
   }
  });
  it("persists the recovered-section marker across save and reopen without marking its wording reviewed",()=>{
   const {storage}=memory(),answers=completeAnswers(),result={brief:buildStructuredBlueprintV4(answers),clarification_code:null,recoveredSections:["why_firm_wants_work"] as Array<"why_firm_wants_work">};
   const generated=applyAnalysis({...initialToolState(),view:"review" as const,stage:7 as const,answers},result);
   expect(generated.savedBrief?.wordingReviewed).toBe(false);
   expect(generated.savedBrief?.recoveredSections).toEqual(["why_firm_wants_work"]);
   expect(saveDraft(storage,generated.answers,7,generated.savedBrief??undefined).status).toBe("saved");
   const loaded=loadDraft(storage);
   expect(loaded.status).toBe("ready");
   if(loaded.status==="ready"){
    const resumed=enterTool({answers:loaded.draft.answers,stage:7,savedBrief:loaded.draft.savedBrief});
    expect(resumed.savedBrief?.recoveredSections).toEqual(["why_firm_wants_work"]);
    expect(resumed.savedBrief?.wordingReviewed).toBe(false);
    const html=renderToStaticMarkup(createElement(BriefView,{saved:resumed.savedBrief!,answers:resumed.answers,dismissedCode:null,reviewed:false,onReview:()=>{},onEdit:()=>{},onAnother:()=>{},onClear:()=>{},storageWarning:false}));
    expect(html).toContain("This section was rebuilt from your answers because the AI combined different evidence types.");
    expect(html).toContain("AI-assisted draft with a structured recovery");
   }
  });
  it("revalidates recovered results before creating their saved representation",()=>{
   const answers=completeAnswers(),result={brief:buildStructuredBlueprintV4(answers),clarification_code:null,recoveredSections:["why_firm_wants_work"] as Array<"why_firm_wants_work">};
   const saved=savedAnalysis(result,answers);
   expect(saved?.recoveredSections).toEqual(["why_firm_wants_work"]);
   expect(saved?.brief.report_version).toBe("dcm-blueprint-v4");
   if(saved?.brief.report_version==="dcm-blueprint-v4"){
    expect(saved.brief.why_firm_wants_work).toEqual(buildStructuredBlueprintV4(answers).why_firm_wants_work);
   }
  });
  it("revalidates changed AI wording, resets its approval, and preserves the earlier report provenance",()=>{
   const {storage}=memory(),answers=completeAnswers(),oldDate="2026-09-29T14:00:00.000Z",current=buildStructuredBlueprintV4(answers);
   const previousDefinition=current.definition_sentence.replace("with the intended client benefit described as “Understand the assets, liabilities and closing obligations before deciding whether to proceed”; the firm prioritizes this work because","so the client can understand the assets, liabilities and closing obligations before deciding whether to proceed, because");
   expect(previousDefinition).not.toBe(current.definition_sentence);
   const prior={brief:{...current,definition_sentence:previousDefinition},sourceAnswersVersion:"dcm-v3.2" as const,sourceAnswersSnapshot:structuredClone(answers),sourceBriefRevision:answers.revision,generatedAt:oldDate,wordingReviewed:true,mode:"ai" as const};
   const now=Date.now();
   storage.setItem(DRAFT_STORAGE_KEY,JSON.stringify({schemaVersion:2,answers,currentStage:7,lastEditedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+100000).toISOString(),savedBrief:prior}));
   const loaded=loadDraft(storage,now);
   expect(loaded.status).toBe("ready");
   if(loaded.status==="ready"){
    const refreshed=loaded.draft.savedBrief!;
    expect(refreshed.brief).toEqual(current);
    expect(refreshed.wordingReviewed).toBe(false);
    expect(refreshed.generatedAt).not.toBe(oldDate);
    expect(refreshed.refreshedFrom).toEqual({generatedAt:oldDate,wordingReviewed:true,mode:"ai"});
    const html=renderToStaticMarkup(createElement(BriefView,{saved:refreshed,answers:loaded.draft.answers,dismissedCode:null,reviewed:false,onReview:()=>{},onEdit:()=>{},onAnother:()=>{},onClear:()=>{},storageWarning:false}));
    expect(html).toContain("This saved AI blueprint was revalidated from its saved answers");
    expect(html).toContain("No new AI request was made.");
    expect(html).toContain("The wording changed during the refresh, so review it again.");
    expect(html).toContain("The earlier version was marked as reviewed.");
    expect(html).toContain("Review this refreshed wording before using it in marketing.");
   }
  });
  it("retains approval for unchanged AI report wording",()=>{
   const {storage}=memory(),answers=completeAnswers(),oldDate="2026-09-29T14:00:00.000Z",brief=buildStructuredBlueprintV4(answers),prior={brief,sourceAnswersVersion:"dcm-v3.2" as const,sourceAnswersSnapshot:structuredClone(answers),sourceBriefRevision:answers.revision,generatedAt:oldDate,wordingReviewed:true,mode:"ai" as const},now=Date.now();
   storage.setItem(DRAFT_STORAGE_KEY,JSON.stringify({schemaVersion:2,answers,currentStage:7,lastEditedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+100000).toISOString(),savedBrief:prior}));
   const loaded=loadDraft(storage,now);
   expect(loaded.status).toBe("ready");
   if(loaded.status==="ready"){expect(loaded.draft.savedBrief?.wordingReviewed).toBe(true);expect(loaded.draft.savedBrief?.generatedAt).toBe(oldDate);expect(loaded.draft.savedBrief?.refreshedFrom).toBeUndefined();}
  });
  it("keeps the stale-report notice after answers change and clears it after replacement",()=>{
   const answers=completeAnswers(),resumed=enterTool({answers,stage:7,reportNeedsRegeneration:true});
   const warning=renderToStaticMarkup(createElement(ReviewStep,{answers,onCreate:()=>{},onRetry:()=>{},onEdit:()=>{},onCreateStructured:()=>{},briefNeedsUpdate:false,loading:false,error:"",retryAllowed:false,reportNeedsRegeneration:resumed.reportNeedsRegeneration}));
   expect(warning).toContain("A previous blueprint is no longer available as a current report.");
   const replaced=applyStructuredFallback(resumed);
   expect(replaced.reportNeedsRegeneration).toBe(false);
   const reviewed=markReviewed(replaced,true);
   expect(reviewed.reportNeedsRegeneration).toBe(false);
   const edited=editAnswers(reviewed,a=>({...a,client:{...a.client,goal_detail:"Clarify the buyer's obligations before signing."}}));
   expect(edited.savedBrief).toBeNull();
   expect(edited.reportNeedsRegeneration).toBe(true);
   const after=renderToStaticMarkup(createElement(ReviewStep,{answers:edited.answers,onCreate:()=>{},onRetry:()=>{},onEdit:()=>{},onCreateStructured:()=>{},briefNeedsUpdate:false,loading:false,error:"",retryAllowed:false,reportNeedsRegeneration:edited.reportNeedsRegeneration}));
   expect(after).toContain("A previous blueprint is no longer available as a current report.");
  });
  it("clears the regeneration notice after valid AI output replaces a previous report",()=>{
   const answers=completeAnswers(),resumed=enterTool({answers,stage:7,reportNeedsRegeneration:true}),generated=applyAnalysis(resumed,validBlueprint(answers));
   expect(generated.savedBrief?.mode).toBe("ai");
   expect(generated.reportNeedsRegeneration).toBe(false);
  });
 it("does not restore an out-of-context structured report when its saved answers differ",()=>{
  const {storage}=memory(),answers=completeAnswers(),snapshot=structuredClone(answers);
  snapshot.client.goal_detail="A different client goal that remains valid.";
  const prior={brief:{...buildStructuredBrief(answers),definition_sentence:"A report from a different answer context."},sourceAnswersVersion:"dcm-v3.2" as const,sourceAnswersSnapshot:snapshot,sourceBriefRevision:answers.revision,generatedAt:"2026-09-29T14:00:00.000Z",wordingReviewed:true,mode:"structured" as const};
  const now=Date.now();
  storage.setItem(DRAFT_STORAGE_KEY,JSON.stringify({schemaVersion:2,answers,currentStage:7,lastEditedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+100000).toISOString(),savedBrief:prior}));
  const loaded=loadDraft(storage,now);
  expect(loaded.status).toBe("ready");
  if(loaded.status==="ready"){expect(loaded.draft.answers).toEqual(answers);expect(loaded.draft.savedBrief).toBeUndefined();}
 });
 it("keeps answers on Review when AI generation fails instead of manufacturing a fallback profile",()=>{const answers=completeAnswers(),state={...initialToolState(),view:"review" as const,stage:7 as const,answers,reviewRunId:"run",requestCount:1,loading:true};const failed=failAnalysis(state,"unavailable",true);expect(failed.view).toBe("review");expect(failed.savedBrief).toBeNull();expect(failed.answers).toEqual(answers);expect(failed.retryAllowed).toBe(true);expect(failed.error).toBe("unavailable");});
 it("creates a clearly structured, source-linked blueprint only after the user chooses the fallback",()=>{const answers=completeAnswers(),state={...initialToolState(),view:"review" as const,stage:7 as const,answers,error:"unavailable" as const};const result=applyStructuredFallback(state);expect(result.view).toBe("brief");expect(result.mode).toBe("structured");expect(result.savedBrief?.mode).toBe("structured");expect(result.savedBrief?.brief.report_version).toBe("dcm-blueprint-v4");expect(result.savedBrief?.sourceAnswersSnapshot).toEqual(answers);});
 it("shows a specific recovery message after structured-draft assembly fails",()=>{const answers=completeAnswers();const html=renderToStaticMarkup(createElement(ReviewStep,{answers,onCreate:()=>{},onRetry:()=>{},onEdit:()=>{},onCreateStructured:()=>{},briefNeedsUpdate:false,loading:false,error:"structuredInvalid",retryAllowed:false}));expect(html).toContain("The structured blueprint could not be assembled from these answers.");expect(html).toContain("Continue with a structured draft");});
 it("shows a support reference for a failed AI draft without displaying validation internals",()=>{const answers=completeAnswers(),requestId="11111111-1111-4111-8111-111111111111";const html=renderToStaticMarkup(createElement(ReviewStep,{answers,onCreate:()=>{},onRetry:()=>{},onEdit:()=>{},briefNeedsUpdate:false,loading:false,error:"invalid",retryAllowed:true,failureReference:requestId}));expect(html).toContain(`include reference <code>${requestId}</code>`);expect(html).not.toContain("negative_contribution_claim");});
 it("keeps review answers in the section that asked them and routes open gaps to that section",()=>{const answers=completeAnswers();answers.practice.enjoys="Practice-stage enjoyment marker";answers.client.choice_detail="Firm-fit detail marker";answers.practice.client_strength_support="Firm-fit support marker";answers.delivery.fit_signals=["service"];answers.opportunity.sources=["website_search"];answers.repeatability.target="Evidence-stage target marker";answers.delivery.capacity="unknown";const html=renderToStaticMarkup(createElement(ReviewStep,{answers,onCreate:()=>{},onRetry:()=>{},onEdit:()=>{},onCreateStructured:()=>{},briefNeedsUpdate:false,loading:false,error:"",retryAllowed:false}));const rows=html.split('data-ui-component-content="review-summary-row"').slice(1);const row=(index:number)=>rows[index].split('data-ui-component-content="review-summary-row"')[0];expect(row(0)).toContain("Practice-stage enjoyment marker");expect(row(2)).not.toContain("Practice-stage enjoyment marker");expect(row(3)).toContain("Firm-fit detail marker");expect(row(3)).toContain("Firm-fit support marker");expect(row(3)).not.toContain("They are seeking the kind of work we have chosen");expect(row(4)).toContain("They are seeking the kind of work we have chosen");expect(row(4)).not.toContain("Website or search enquiries");expect(row(5)).toContain("Website or search enquiries");expect(row(5)).toContain("Evidence-stage target marker");const open=html.split('data-ui-component-content="desired-client-review-open-items"')[1];expect(open).toContain("Capacity for more of this work remains unknown");expect(open).toContain("Edit Work value");});
});
it("preserves answers and explains when a previous report cannot be reopened",()=>{const {storage}=memory(),answers=completeAnswers(),brief=buildStructuredBrief(answers);brief.why_firm_wants_work.claims[0].source_answer_ids=["answers.not_a_real_source" as never];const prior={brief,sourceAnswersVersion:"dcm-v3.2" as const,sourceAnswersSnapshot:structuredClone(answers),sourceBriefRevision:answers.revision,generatedAt:"2026-09-29T14:00:00.000Z",wordingReviewed:true,mode:"ai" as const};const now=Date.now();storage.setItem(DRAFT_STORAGE_KEY,JSON.stringify({schemaVersion:2,answers,currentStage:7,lastEditedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+100000).toISOString(),savedBrief:prior}));const loaded=loadDraft(storage,now);expect(loaded.status).toBe("ready");if(loaded.status==="ready"){expect(loaded.draft.answers).toEqual(answers);expect(loaded.draft.savedBrief).toBeUndefined();expect(loaded.draft.reportNeedsRegeneration).toBe(true);const saved=saveDraft(storage,answers,7,undefined,now+1000);expect(saved.status).toBe("saved");const resumed=loadDraft(storage,now+1001);expect(resumed.status).toBe("ready");if(resumed.status==="ready"){expect(resumed.draft.reportNeedsRegeneration).toBe(true);const html=renderToStaticMarkup(createElement(ResumePanel,{draft:resumed.draft,onResume:()=>{},onNew:()=>{},onClear:()=>{},notice:"",onNoticeDismiss:()=>{}}));expect(html).toContain("A previous blueprint is no longer available as a current report.");expect(html).toContain("Your answers are still saved.");}}});
