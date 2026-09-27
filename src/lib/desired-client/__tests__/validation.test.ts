import {describe,expect,it} from "vitest";
import {emptyAnswers} from "../brief";
import {validateAnalysisRequest,validateDraftAnswers} from "../validation";
import {completeAnswers} from "./blueprint-helpers";
import type {AnalysisRequestEnvelope,DesiredClientAnswers} from "../types";
const envelope=(answers:DesiredClientAnswers):AnalysisRequestEnvelope=>({schemaVersion:2,requestId:"11111111-1111-4111-8111-111111111111",answerRevision:answers.revision,reviewRunId:"22222222-2222-4222-8222-222222222222",analysisIndex:0,aiConsent:true,answers,clarifications:[]});
describe("Desired Client answer validation",()=>{
 it("accepts a complete v2.2 profile with the required trigger and fit signals",()=>{const a=completeAnswers();expect(validateAnalysisRequest(envelope(a)).valid).toBe(true);});
 it("rejects missing required groups, mixed unknown selections, and unsafe write-ins",()=>{const a=completeAnswers();a.situation.trigger=null;expect(validateAnalysisRequest(envelope(a)).valid).toBe(false);const b=completeAnswers();b.delivery.fit_signals=["unknown","scope"];expect(validateDraftAnswers(b)).toBe(false);const c=completeAnswers();c.write_ins={fit_signals:"x".repeat(181)};expect(validateDraftAnswers(c)).toBe(false);});
 it("allows a sparse saved draft and rejects unsupported schema versions",()=>{expect(validateDraftAnswers(emptyAnswers())).toBe(true);const old=emptyAnswers() as DesiredClientAnswers; (old as unknown as {schema_version:string}).schema_version="dcm-v2.1";expect(validateDraftAnswers(old)).toBe(false);});
 it("requires exact answer keys and a matching request revision",()=>{const a=completeAnswers();expect(validateAnalysisRequest({...envelope(a),answerRevision:a.revision+1}).valid).toBe(false);expect(validateAnalysisRequest({...envelope(a),extra:true} as never).valid).toBe(false);});
});
