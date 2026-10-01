import { describe, expect, it } from "vitest";
import { calculateContribution } from "../economics";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { completeAnswers } from "./blueprint-helpers";

function comparable() {
  const a=completeAnswers();
  Object.assign(a.value,{fee_amount:"18,000.00",direct_cost_amount:"9,000.00",currency:"CAD",amount_scope:"per_matter",amount_basis:"estimated"});
  return a;
}
describe("comparable matter economics",()=>{
  it("calculates contribution with explicit shared scope, currency and evidence basis",()=>{
    const a=comparable();
    expect(calculateContribution(a)).toMatchObject({amount:"$9,000.00",currency:"CAD",scope:"per matter",basis:"firm_reported_estimate"});
    a.value.amount_basis="recorded";
    expect(calculateContribution(a)?.basis).toBe("firm_reported_recorded");
  });
  it("preserves negative contribution and zero collected fees without introducing a rate",()=>{
    const a=comparable(); a.value.fee_amount="0"; a.value.direct_cost_amount="250";
    const result=calculateContribution(a);
    expect(result?.amount).toBe("-$250.00");
    expect(result).not.toHaveProperty("rate"); expect(result).not.toHaveProperty("margin");
    a.value.fee_amount="250";
    expect(calculateContribution(a)?.amount).toBe("$0.00");
  });
  it("subtracts decimal amounts in cents",()=>{
    const a=comparable();a.value.fee_amount="0.30";a.value.direct_cost_amount="0.20";
    expect(calculateContribution(a)?.amount).toBe("$0.10");
  });
  it.each(["", "18,00", "1,2", "18000-20000", "18k", "NaN", "Infinity", "1e5", "-1", "12.345", "9007199254740992"])("does not calculate an invalid or ambiguous fee %s",fee=>{
    const a=comparable();a.value.fee_amount=fee;expect(calculateContribution(a)).toBeNull();
  });
  it("does not calculate from a range, different scope, unknown basis, missing cost or unshared currency",()=>{
    for(const patch of [{amount_scope:"range"},{amount_scope:"other"},{amount_scope:null},{amount_basis:"unknown"},{amount_basis:null},{direct_cost_amount:""},{direct_cost_amount:"1,2"},{currency:""},{currency:"CAD/USD"}]) {
      const a=comparable();Object.assign(a.value,patch);expect(calculateContribution(a)).toBeNull();
    }
  });
  it("reports the calculation's sources and estimated per-matter basis without calling it net profit",()=>{
    const a=comparable();a.value.fee_amount="0";a.value.direct_cost_amount="250";
    const b=buildStructuredBlueprintV4(a);
    const claim=b.why_firm_wants_work.claims.find(c=>c.text.includes("calculated as collected fee"));
    expect(claim?.text).toContain("estimated contribution before overhead and acquisition costs: -$250.00 per matter");
    expect(claim?.text).toContain("do not establish net profit");
    expect(claim?.evidence_basis).toBe("firm_reported_estimate");
    expect(claim?.source_answer_ids).toEqual(expect.arrayContaining(["value.fee_amount","value.direct_cost_amount","value.currency","value.amount_basis","value.amount_scope"]));
    expect(claim?.text).not.toContain("%");
  });
  it("keeps incompatible figures visible without deriving a contribution",()=>{
    const a=comparable();a.value.amount_scope="other";
    const b=buildStructuredBlueprintV4(a);
    const claims=b.why_firm_wants_work.claims.map(c=>c.text).join(" ");
    expect(claims).toContain("18,000.00");
    expect(claims).not.toContain("calculated as collected fee");
  });
});
