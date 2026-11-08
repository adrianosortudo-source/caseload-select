import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS, type Evidence } from "../types";
import { repairFeedback, validateAnalysis } from "../validate";
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
  it("accepts exact cited quotations",()=>{const r=valid();r.part1.elements[0].finding='The site states "Family law".';expect(validateAnalysis(r,evidence)).not.toContain("quote_not_in_cited_evidence");});
  it("rejects invented or uncited quotations",()=>{const r=valid();r.part1.elements[0].finding='The site states "Invented words".';expect(validateAnalysis(r,evidence)).toContain("quote_not_in_cited_evidence");r.part1.elements[0].finding='The site states "Family law".';r.part1.elements[0].evidenceIds=["screenshot-desktop"];expect(validateAnalysis(r,evidence)).toContain("quote_not_in_cited_evidence");});
  it("matches single-quoted source words and ignores ordinary apostrophes",()=>{const r=valid();const ev:Evidence[]=[{id:"text-1",kind:"text",sourceUrl:"https://example.com/",title:"Home",capturedAt:"2026-11-08",excerpt:"We consider children's best interests.",truncated:false}];r.part1.elements[0].finding="The firm's work reflects ‘children’s best interests’.";expect(validateAnalysis(r,ev)).not.toContain("quote_not_in_cited_evidence");r.part1.elements[0].finding="The firm's work reflects 'invented words'.";expect(validateAnalysis(r,ev)).toContain("quote_not_in_cited_evidence");expect(repairFeedback(r,ev)).toContainEqual({path:"part1.elements[0].finding",phrase:r.part1.elements[0].finding});r.part1.elements[0].finding="The firm's work protects each client's interests.";expect(validateAnalysis(r,ev)).not.toContain("quote_not_in_cited_evidence");});
  it("matches source quotations across case and HTML entity rendering only",()=>{const r=valid();const ev:Evidence[]=[{id:"text-1",kind:"text",sourceUrl:"https://example.com/",title:"Home",capturedAt:"2026-11-08",excerpt:"Advice &amp; Support",truncated:false}];r.part1.elements[0].finding='The site says "advice & support".';expect(validateAnalysis(r,ev)).not.toContain("quote_not_in_cited_evidence");r.part1.elements[0].finding='The site says "advice and support".';expect(validateAnalysis(r,ev)).toContain("quote_not_in_cited_evidence");});
  it("rejects ensured outcomes",()=>{const r=valid();r.part2.directions[0].clientExpectation="A fair result is ensured.";expect(validateAnalysis(r,evidence)).toContain("expectation_guarantee");});
  it("gives repair the path and count for overlong element copy",()=>{const r=valid();r.part1.elements[0].reason=Array(46).fill("word").join(" ");expect(repairFeedback(r,evidence)).toContainEqual({path:"part1.elements[0].reason",phrase:r.part1.elements[0].reason,wordCount:46,maxWords:45});});
  it("rejects guaranteed and risk-free direction labels while allowing ordinary contingency access",()=>{const r=valid();r.part2.directions[0].label="Guaranteed wins";expect(validateAnalysis(r,evidence)).toContain("direction_label_guarantee_or_superlative");expect(repairFeedback(r,evidence).some(x=>x.path==="part2.directions[0].label")).toBe(true);r.part2.directions[0].label="Risk-Free Contingency";expect(validateAnalysis(r,evidence)).toContain("direction_label_guarantee_or_superlative");r.part2.directions[0].label="Contingency-fee access";expect(validateAnalysis(r,evidence)).not.toContain("direction_label_guarantee_or_superlative");});
  it("rejects made-up evidence IDs",()=>{const r=valid();r.part1.elements[0].evidenceIds=["made-up"];expect(validateAnalysis(r,evidence)).toContain("element_evidence");});
  it("rejects duplicate element keys",()=>{const r=valid();r.part1.elements[0].key=r.part1.elements[1].key;expect(validateAnalysis(r,evidence)).toContain("element_key");});
  it("rejects visual findings supported only by text",()=>{const r=valid();r.part1.visualFindings[0].evidenceIds=["text-1"];expect(validateAnalysis(r,evidence)).toContain("visual_evidence");});
  it("rejects scores for inaccessible elements",()=>{const r=valid();r.part1.elements[0].status="not_assessable";expect(validateAnalysis(r,evidence)).toContain("unassessable_scored");});
  it("requires both sides of a conflict",()=>{const r=valid();r.part1.elements[0].conflict=true;expect(validateAnalysis(r,evidence)).toContain("conflict_evidence");});
});











