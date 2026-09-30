import {describe,expect,it} from "vitest";
import {emptyAnswers} from "../brief";
import {migrateV22Answers,migrateV31Answers} from "../migration";
import {validateAnalysisRequest,validateDraftAnswers,validateLegacyV22DraftAnswers} from "../validation";
import {completeAnswers} from "./blueprint-helpers";
import type {AnalysisRequestEnvelope,DesiredClientAnswers} from "../types";

const envelope=(answers:DesiredClientAnswers):AnalysisRequestEnvelope=>({schemaVersion:4,operation:"generate",requestId:"11111111-1111-4111-8111-111111111111",answerRevision:answers.revision,reviewRunId:"22222222-2222-4222-8222-222222222222",analysisIndex:0,aiConsent:true,answers,clarifications:[]});
function legacyV22(a=completeAnswers()):Record<string,unknown>{
  return {schema_version:"dcm-v2.2",revision:a.revision,focus:a.focus,situation:a.situation,client:{goals:a.client.goals,concerns:a.client.concerns,decision_needs:a.client.decision_needs},
    value:{reasons:a.value.reasons,fee_effort:a.value.fee_effort,collected_fee:a.value.collected_fee,team_hours:a.value.team_hours,payment:a.value.payment},
    delivery:a.delivery,direction:{aim:a.direction.aim,evidence:a.direction.evidence,less:a.direction.less,less_note:a.direction.less_note},clarifications:{FOCUS_UNCLEAR:null,CLIENT_GOAL_UNCLEAR:null,CURRENT_CAPACITY_CONFLICT:null,FEE_EFFORT_CONFLICT:null,EXPERIENCE_DIRECTION_CONFLICT:null}};
}

describe("Desired Client answer validation",()=>{
 it("migrates v3.1 without inventing client-choice or pathway evidence",()=>{
  const a=completeAnswers();
  const old=JSON.parse(JSON.stringify(a)); old.schema_version="dcm-v3.1"; delete old.interview;
  for(const key of ["client_strength","client_strength_effect","client_strength_support"])delete old.practice[key];
  for(const key of ["goal_detail","decision_context","pathway_basis","choice_priorities","choice_detail","choice_basis"])delete old.client[key];
  delete old.client_context.discovery_behaviour;
  const migrated=migrateV31Answers(old);
  expect(migrated?.schema_version).toBe("dcm-v3.2");
  expect(migrated?.practice.capability).toBe(a.practice.capability);
  expect(migrated?.client.choice_priorities).toEqual([]);
  expect(migrated?.client.choice_basis).toBeNull();
  expect(migrated?.client.pathway_basis).toBeNull();
  expect(migrated?.interview.ai_clarification_consent).toBe(false);
 });
 it("accepts a complete v3 profile and the bounded analysis envelope",()=>{const a=completeAnswers();expect(validateAnalysisRequest(envelope(a)).valid).toBe(true);});
 it("accepts explicit uncertainty and the controlled not-sure work value",()=>{const a=completeAnswers();a.focus.work="other";a.focus.work_other="Not sure yet";a.focus.route="exploring";a.practice.experience="unknown";a.situation.trigger="unknown";a.situation.timing="unknown";a.situation.role="unknown";a.value.reasons=["undecided"];a.delivery.capacity="unknown";a.delivery.fit_signals=["unknown"];a.opportunity.sources=["no_evidence"];a.repeatability.success_measure="unknown";expect(validateAnalysisRequest(envelope(a)).valid).toBe(true);});
 it("rejects mixed unknown choices, invalid provenance enums and unsafe write-ins",()=>{const a=completeAnswers();a.delivery.fit_signals=["unknown","scope"];expect(validateDraftAnswers(a)).toBe(false);const b=completeAnswers();b.opportunity.data_basis="audited" as never;expect(validateDraftAnswers(b)).toBe(false);const c=completeAnswers();c.write_ins={fit_signals:"x".repeat(181)};expect(validateDraftAnswers(c)).toBe(false);});
 it("accepts a sparse v3 draft but rejects unsupported schemas",()=>{expect(validateDraftAnswers(emptyAnswers())).toBe(true);const old=emptyAnswers() as DesiredClientAnswers;(old as unknown as {schema_version:string}).schema_version="dcm-v2.2";expect(validateDraftAnswers(old)).toBe(false);});
 it("requires exact nested keys and matching revisions",()=>{const a=completeAnswers();expect(validateAnalysisRequest({...envelope(a),answerRevision:a.revision+1}).valid).toBe(false);expect(validateAnalysisRequest({...envelope(a),extra:true} as never).valid).toBe(false);});
 it("strictly validates v2.2 before migrating and leaves new evidence unknown",()=>{const old=legacyV22();expect(validateLegacyV22DraftAnswers(old)).toBe(true);const migrated=migrateV22Answers(old);expect(migrated?.schema_version).toBe("dcm-v3.2");expect(migrated?.value.currency).toBe("");expect(migrated?.opportunity.sources).toEqual(["unknown"]);expect(migrated?.repeatability.success_measure).toBeNull();expect(migrateV22Answers({...old,unexpected:true})).toBeNull();});
 it("enforces current-practice and target-route consistency in v3.2",()=>{const a=completeAnswers();a.practice.experience="new";a.focus.route="established";expect(validateDraftAnswers(a)).toBe(false);a.practice.experience="regular";expect(validateDraftAnswers(a)).toBe(true);});
 it("requires the stage-two client goal and accepts its supported trigger write-in",()=>{const a=completeAnswers();a.practice.experience="regular";a.client.choice_priorities=["clear_fees"];a.practice.client_strength="clear_advice";expect(validateAnalysisRequest(envelope(a)).valid).toBe(true);const noGoal=structuredClone(a);noGoal.client.goals=[];expect(validateAnalysisRequest(envelope(noGoal)).valid).toBe(false);a.situation.trigger=null;a.write_ins={trigger:"A planned acquisition"};expect(validateAnalysisRequest(envelope(a)).valid).toBe(true);});
});
