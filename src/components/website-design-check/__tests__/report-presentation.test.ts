import { describe, expect, it } from "vitest";
import { assessment, copyPlan, coverageText, displayEvidence, groups, matchFlag, presentFinding } from "../report-presentation";
import { fixture } from "../../../../tests/website-design-check/fixture";
import type { RankedFinding } from "../WebsiteDesignCheckReport";

const finding = (label: string, evidence = "Sample observation."): RankedFinding => ({dimension:"Typography and Legibility",label,evidence,opportunity:"Original",severity:"high",estimatedEffort:"low"});
describe("report presentation", () => {
  it("groups exact members in ranked order and does not mutate input", () => {
    const original = structuredClone(fixture); const result = groups(fixture);
    expect(result[0].findings).toHaveLength(2); expect(result[1].copy.group).toBe("Testimonial attribution");
    expect(result[0].status).toBe("Needs confirmation"); expect(fixture).toEqual(original);
  });
  it("uses unique flag label only when no key was emitted", () => {
    const flag=fixture.redFlagPanel.activeFlags[0], f=fixture.rankedFindings[0];
    expect(matchFlag({...f,flagKey:undefined},[flag])).toEqual(flag);
    expect(matchFlag({...f,flagKey:undefined},[flag,flag])).toBeUndefined();
    expect(matchFlag({...f,flagKey:"unknown"},[flag])).toBeUndefined();
  });
  it("keeps unknowns and selects direction-specific actions", () => {
    expect(presentFinding(finding("Unknown"),[]).copy.title).toBe("Review this automated finding.");
    expect(presentFinding(finding("Body line length","~30 characters per line, narrower than the 45-75 range that keeps reading rhythm comfortable."),[]).copy.action).toContain("widen");
    expect(presentFinding(finding("Body line length","~90 characters per line, wider than the 45-75 range that keeps reading rhythm comfortable."),[]).copy.action).toContain("narrow");
  });
  it("removes only the scoped LCP sentence and retains measurements", () => {
    const f={...finding("Largest Contentful Paint","5.0s, poor. Conversions fall roughly 7% for every second past 3s."),dimension:"Performance and Technical Health"};
    expect(displayEvidence(f)).toBe("5.0s, poor."); expect(displayEvidence({...f,dimension:"Other"})).toContain("Conversions fall");
  });
  it("selects both producer performance and line-height branches", () => {
    const p=(label:string,evidence:string)=>presentFinding({...finding(label,evidence),dimension:"Performance and Technical Health"},[]).copy.title;
    expect(p("Total Blocking Time","300ms, elevated main-thread blocking during load.")).toBe("Main thread is blocked");
    expect(p("Total Blocking Time","700ms, heavy main-thread blocking during load. The page may feel unresponsive right after it appears loaded.")).toBe("Main thread blocking is high");
    expect(presentFinding(finding("Body line height","110% of font size, tighter than the 120-145% range."),[]).copy.title).toBe("Line spacing is tight");
    expect(presentFinding(finding("Body line height","150% of font size, looser than the 120-145% range."),[]).copy.title).toBe("Line spacing is loose");
  });
  it("qualifies legal detector statements and preserves samples", () => {
    const f={...finding('Legal-information disclaimer present','No disclaimer detected.'),dimension:'Authority and Positioning'};
    const item=presentFinding(f,[]); expect(item.evidence).toContain('not a verified legal conclusion'); expect(item.copy.action).toContain('supporting evidence');
    const sample=finding('Unknown','1 of 1 sampled buttons, 20px against a 44px threshold.');
    expect(presentFinding(sample,[]).evidence).toBe(sample.evidence);
  });
  it("describes coverage without claiming a visual judgment", () => {
    expect(coverageText(fixture)).toContain("not supplied");
    expect(coverageText({...fixture,judgmentCoverage:{wholePage:true}})).toContain("not clipped");
    expect(coverageText({...fixture,judgmentCoverage:{wholePage:false,judgedTopPx:100,actualPageHeightPx:500}})).toContain("top 100 pixels");
  });
  it("handles one finding, null scores and unmatched or unknown-confidence flags", () => {
    const only={...fixture,rankedFindings:[finding("Unknown")],dimensionBar:[{name:"Unknown",weight:1,score:null}]};
    expect(groups(only)).toHaveLength(1); expect(assessment(only,groups(only))).toContain("homepage");
    const unknown={...fixture.redFlagPanel.activeFlags[0],confidence:undefined} as unknown as typeof fixture.redFlagPanel.activeFlags[0];
    const mixed={...fixture,redFlagPanel:{...fixture.redFlagPanel,activeFlags:[unknown]}};
    expect(groups(mixed)[0].status).not.toBe("Confirmed");
    const unmatched={...fixture.rankedFindings[0],flagKey:"unknown"};
    expect(presentFinding(unmatched,[]).copy.title).toBe("Review this automated finding.");
    expect(presentFinding(unmatched,[]).evidence).toBe(unmatched.evidence);
    expect(assessment({...fixture,rankedFindings:[]},[])).toContain("does not establish that the entire website is issue-free");
  });
  it("handles zero findings and all grade limitations in copy", () => {
    const empty={...fixture,rankedFindings:[],dimensionBar:[]}; expect(assessment(empty,[])).toContain("No actionable findings");
    const many={...fixture,redFlagPanel:{...fixture.redFlagPanel,activeFlags:Array.from({length:5},(_,i)=>({...fixture.redFlagPanel.activeFlags[0],key:`key${i}`,label:`Flag ${i}`}))}};
    expect(copyPlan(many,groups(many).slice(0,3))).toContain("Flag 4: Needs confirmation");
  });
});
