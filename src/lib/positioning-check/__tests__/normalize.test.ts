import { describe, expect, it } from "vitest";
import { normalizeAuthoredCopy, hasUnapprovedEmDash } from "../normalize";
import type { Evidence } from "../types";
const evidence:Evidence[]=[{id:"text-1",kind:"text",sourceUrl:"https://example.com/",title:"Home",capturedAt:"2026-11-08",excerpt:"The firm says: Clear advice — with care.",truncated:false}];
describe("authored copy punctuation",()=>{
 it("normalizes prose without changing evidence",()=>{const input={finding:"Advice — with care"};expect(normalizeAuthoredCopy(input,evidence)).toEqual({finding:"Advice, with care"});expect(evidence[0].kind==="text"&&evidence[0].excerpt).toContain("—");});
 it("preserves exact source quotations, not invented ones",()=>{const input={finding:'“Clear advice — with care.” and “invented — words”'};const result=normalizeAuthoredCopy(input,evidence);expect(result).toEqual({finding:'“Clear advice — with care.” and “invented, words”'});expect(hasUnapprovedEmDash(result,evidence)).toBe(false);});
});
