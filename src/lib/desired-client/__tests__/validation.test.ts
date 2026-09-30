import {describe,expect,it} from "vitest";
import {emptyAnswers} from "../brief";
import {migrateV22Answers} from "../migration";
import {validateAnalysisRequest,validateDraftAnswers,validateLegacyV22DraftAnswers} from "../validation";
import {completeAnswers} from "./blueprint-helpers";
import type {AnalysisRequestEnvelope,DesiredClientAnswers} from "../types";

const envelope=(answers:DesiredClientAnswers):AnalysisRequestEnvelope=>({schemaVersion:3,requestId:"11111111-1111-4111-8111-111111111111",answerRevision:answers.revision,reviewRunId:"22222222-2222-4222-8222-222222222222",analysisIndex:0,aiConsent:true,answers,clarifications:[]});
function legacyV22(a=completeAnswers()):Record<string,unknown>{
  return {schema_version:"dcm-v2.2",revision:a.revision,focus:a.focus,situation:a.situation,client:a.client,
    value:{reasons:a.value.reasons,fee_effort:a.value.fee_effort,collected_fee:a.value.collected_fee,team_hours:a.value.team_hours,payment:a.value.payment},
    delivery:a.delivery,direction:a.direction,clarifications:{FOCUS_UNCLEAR:null,CLIENT_GOAL_UNCLEAR:null,CURRENT_CAPACITY_CONFLICT:null,FEE_EFFORT_CONFLICT:null,EXPERIENCE_DIRECTION_CONFLICT:null}};
}

describe("Desired Client answer validation",()=>{
 it("accepts a complete v3 profile and the bounded analysis envelope",()=>{const a=completeAnswers();expect(validateAnalysisRequest(envelope(a)).valid).toBe(true);});
 it("accepts explicit uncertainty and the controlled not-sure work value",()=>{const a=completeAnswers();a.focus.work="other";a.focus.work_other="Not sure yet";a.focus.route="exploring";a.situation.trigger="unknown";a.situation.timing="unknown";a.situation.role="unknown";a.value.reasons=["undecided"];a.delivery.capacity="unknown";a.delivery.fit_signals=["unknown"];a.opportunity.sources=["no_evidence"];a.repeatability.success_measure="unknown";expect(validateAnalysisRequest(envelope(a)).valid).toBe(true);});
 it("rejects mixed unknown choices, invalid provenance enums and unsafe write-ins",()=>{const a=completeAnswers();a.delivery.fit_signals=["unknown","scope"];expect(validateDraftAnswers(a)).toBe(false);const b=completeAnswers();b.opportunity.data_basis="audited" as never;expect(validateDraftAnswers(b)).toBe(false);const c=completeAnswers();c.write_ins={fit_signals:"x".repeat(181)};expect(validateDraftAnswers(c)).toBe(false);});
 it("accepts a sparse v3 draft but rejects unsupported schemas",()=>{expect(validateDraftAnswers(emptyAnswers())).toBe(true);const old=emptyAnswers() as DesiredClientAnswers;(old as unknown as {schema_version:string}).schema_version="dcm-v2.2";expect(validateDraftAnswers(old)).toBe(false);});
 it("requires exact nested keys and matching revisions",()=>{const a=completeAnswers();expect(validateAnalysisRequest({...envelope(a),answerRevision:a.revision+1}).valid).toBe(false);expect(validateAnalysisRequest({...envelope(a),extra:true} as never).valid).toBe(false);});
 it("strictly validates v2.2 before migrating and leaves new evidence unknown",()=>{const old=legacyV22();expect(validateLegacyV22DraftAnswers(old)).toBe(true);const migrated=migrateV22Answers(old);expect(migrated?.schema_version).toBe("dcm-v3.0");expect(migrated?.value.currency).toBe("");expect(migrated?.opportunity.sources).toEqual(["unknown"]);expect(migrated?.repeatability.success_measure).toBeNull();expect(migrateV22Answers({...old,unexpected:true})).toBeNull();});
});
