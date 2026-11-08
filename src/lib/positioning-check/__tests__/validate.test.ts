import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS, type Evidence } from "../types";
import { validateAnalysis } from "../validate";
const evidence:Evidence[]=[{id:"text-1",kind:"text",sourceUrl:"https://example.com/",title:"Home",capturedAt:"2026-11-08T00:00:00Z",excerpt:"Family law",truncated:false},{id:"screenshot-desktop",kind:"screenshot",sourceUrl:"https://example.com/",title:"Desktop",capturedAt:"2026-11-08T00:00:00Z",screenshotId:"screenshot-desktop",visibleRegion:"Page"}];
function valid(){return {part1:{statement:"A family law practice.",rationale:"The site says family law.",elements:ELEMENT_KEYS.map(key=>({key,status:"observed",finding:"A finding.",clarity:2,confidence:"moderate",evidenceIds:["text-1"],reason:"The page says so.",uncertainty:"Only the page was reviewed.",conflict:false})),visualFindings:[{finding:"A visible heading.",evidenceIds:["screenshot-desktop"]}]},part2:{directions:[{id:"d1",label:"Clarify",audienceSituation:"Families",possibleStatement:"A family law practice.",evidenceIds:["text-1"],communicationImplication:"Clarify language.",clientExpectation:"Expect legal advice.",tradeoff:"Less breadth.",validationQuestions:["Does it fit?","Can the firm support it?","Does it resonate?"]}],limitations:[]}};}
describe("positioning model output validation",()=>{
  it("accepts a complete traceable report",()=>expect(validateAnalysis(valid(),evidence)).toEqual([]));
  it("rejects em dashes in generated copy",()=>{const r=valid();r.part1.statement="A firm — for families.";expect(validateAnalysis(r,evidence)).toContain("em_dash");});
  it("requires limited coverage to leave consistency unassessed",()=>{expect(validateAnalysis(valid(),evidence,1)).toContain("consistency_coverage");});
  it("rejects a false claim that fewer than three pages were readable",()=>{const r=valid();r.part1.elements[7].reason="Fewer than three substantive pages were readable.";expect(validateAnalysis(r,evidence,8)).toContain("false_coverage_count");});
  it("rejects high confidence for a conflict",()=>{const r=valid();r.part1.elements[0].conflict=true;r.part1.elements[0].confidence="high";expect(validateAnalysis(r,evidence)).toContain("conflict_confidence");});
  it("rejects guarantees and superlatives in proposed statements",()=>{const r=valid();r.part2.directions[0].possibleStatement="We guarantee the best firm service.";expect(validateAnalysis(r,evidence)).toContain("direction_guarantee_or_superlative");});
  it("permits the legal phrase best interests",()=>{const r=valid();r.part2.directions[0].possibleStatement="We support children and their best interests.";expect(validateAnalysis(r,evidence)).not.toContain("direction_guarantee_or_superlative");});
  it("rejects guaranteed outcomes in client expectations",()=>{const r=valid();r.part2.directions[0].clientExpectation="This ensures a fair outcome.";expect(validateAnalysis(r,evidence)).toContain("expectation_guarantee");});
  it("rejects made-up evidence IDs",()=>{const r=valid();r.part1.elements[0].evidenceIds=["made-up"];expect(validateAnalysis(r,evidence)).toContain("element_evidence");});
  it("rejects duplicate element keys",()=>{const r=valid();r.part1.elements[0].key=r.part1.elements[1].key;expect(validateAnalysis(r,evidence)).toContain("element_key");});
  it("rejects visual findings supported only by text",()=>{const r=valid();r.part1.visualFindings[0].evidenceIds=["text-1"];expect(validateAnalysis(r,evidence)).toContain("visual_evidence");});
  it("rejects scores for inaccessible elements",()=>{const r=valid();r.part1.elements[0].status="not_assessable";expect(validateAnalysis(r,evidence)).toContain("unassessable_scored");});
  it("requires both sides of a conflict",()=>{const r=valid();r.part1.elements[0].conflict=true;expect(validateAnalysis(r,evidence)).toContain("conflict_evidence");});
});






