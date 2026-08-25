import { describe, it, expect } from "vitest";
import {
  capAndRank,
  computeSurvivors,
  resolveProfileFromSurvivors,
  buildStatement,
  proofSlotIndex,
  assembleBrief,
  type CardWork,
} from "../engine";
import { DIFFERENTIATOR_CARDS, KEEP_CAP } from "../differentiators";
import { TIE_BREAK_ORDER } from "../profiles";

const PASS_TESTS = { provable: true, inDemand: true, unique: true };
const FAIL_TESTS = { provable: false, inDemand: true, unique: true };

function workFor(cardId: string, proof = "Eleven of fourteen files last year."): CardWork {
  return { cardId, proof, tests: PASS_TESTS };
}

describe("capAndRank", () => {
  it("preserves deck order, not selection order", () => {
    const shuffled = ["community_roles", "single_area_depth", "fixed_fee_consult"];
    const ranked = capAndRank(shuffled);
    const deckOrder = DIFFERENTIATOR_CARDS.filter((c) => shuffled.includes(c.id)).map(
      (c) => c.id,
    );
    expect(ranked).toEqual(deckOrder);
  });

  it("truncates to KEEP_CAP", () => {
    const eight = DIFFERENTIATOR_CARDS.slice(0, 8).map((c) => c.id);
    expect(capAndRank(eight)).toHaveLength(KEEP_CAP);
  });

  it("returns everything when under the cap", () => {
    const three = ["single_area_depth", "fixed_fee_consult", "community_roles"];
    expect(capAndRank(three)).toHaveLength(3);
  });
});

describe("computeSurvivors: happy path", () => {
  it("a well-evidenced, untainted card survives", () => {
    const { survivors, dropped } = computeSurvivors([workFor("single_area_depth")]);
    expect(survivors).toHaveLength(1);
    expect(dropped).toHaveLength(0);
    expect(survivors[0].card.id).toBe("single_area_depth");
  });
});

describe("computeSurvivors: zero survivors", () => {
  it("returns an empty survivor list without throwing", () => {
    const result = computeSurvivors([]);
    expect(result.survivors).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
    expect(result.survivorCategories).toHaveLength(0);
  });

  it("resolveProfileFromSurvivors returns null with no categories", () => {
    expect(resolveProfileFromSurvivors([])).toBeNull();
  });
});

describe("computeSurvivors: all-blocked", () => {
  it("R1 (past_results) is always blocked regardless of tests or proof", () => {
    const { survivors, dropped } = computeSurvivors([
      { cardId: "past_results", proof: "We closed the file on time.", tests: PASS_TESTS },
    ]);
    expect(survivors).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].compliance.blocked).toBe(true);
    expect(dropped[0].dropReason).toMatch(/promise how a matter ends/i);
  });

  it("a superlative typed into the proof line blocks a card with no static flag", () => {
    const { survivors, dropped } = computeSurvivors([
      {
        cardId: "single_area_depth",
        proof: "We are the best in the GTA at this.",
        tests: PASS_TESTS,
      },
    ]);
    expect(survivors).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].compliance.textRules.some((r) => r.id === "R3")).toBe(true);
  });

  it("failing any one test drops the card even with clean proof", () => {
    const { survivors, dropped } = computeSurvivors([
      { cardId: "single_area_depth", proof: "Eleven of fourteen files.", tests: FAIL_TESTS },
    ]);
    expect(survivors).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].dropReason).toMatch(/three tests/i);
  });

  it("an empty proof line cannot survive even with all tests passed", () => {
    const { survivors, dropped } = computeSurvivors([
      { cardId: "single_area_depth", proof: "   ", tests: PASS_TESTS },
    ]);
    expect(survivors).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].dropReason).toMatch(/no evidence/i);
  });
});

describe("computeSurvivors: R2 conversion rendering (converted, not blocked)", () => {
  it("a card flagged R2 survives when tests and proof are clean", () => {
    const { survivors, dropped } = computeSurvivors([
      workFor("sub_area_focus", "Shareholder exit clauses come back on every file."),
    ]);
    expect(dropped).toHaveLength(0);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].compliance.staticRule?.id).toBe("R2");
    expect(survivors[0].compliance.staticRule?.verdict).toBe("converted");
    expect(survivors[0].compliance.blocked).toBe(false);
  });

  it("R4 and R5 carriers also survive on converted verdicts", () => {
    const { survivors, dropped } = computeSurvivors([
      workFor("personal_service", "Clients get my cell number on day one."),
      workFor("experience_claim", "Fourteen years, always residential closings."),
    ]);
    expect(dropped).toHaveLength(0);
    expect(survivors).toHaveLength(2);
    expect(survivors.map((s) => s.compliance.staticRule?.id).sort()).toEqual(["R4", "R5"]);
  });
});

describe("resolveProfileFromSurvivors: tie-break priority", () => {
  it("a tie resolves toward the earlier TIE_BREAK_ORDER category", () => {
    // named_community -> client_niche, fixed_fee_consult -> fees_clarity.
    // client_niche sits earlier than fees_clarity in TIE_BREAK_ORDER.
    const profile = resolveProfileFromSurvivors(["client_niche", "fees_clarity"]);
    expect(profile?.id).toBe("client_niche");
  });

  it("respects the documented fixed order end to end", () => {
    expect(TIE_BREAK_ORDER[0]).toBe("practice_focus");
    const profile = resolveProfileFromSurvivors(["process_follow_through", "practice_focus"]);
    expect(profile?.id).toBe("practice_focus");
  });

  it("the category with strictly more survivors wins over tie-break order", () => {
    const profile = resolveProfileFromSurvivors([
      "fees_clarity",
      "fees_clarity",
      "practice_focus",
    ]);
    expect(profile?.id).toBe("fees_clarity");
  });
});

describe("buildStatement", () => {
  it("P1 renders the focus pattern", () => {
    const text = buildStatement("P1", [
      "Hale Law",
      "restaurant owners",
      "lease disputes",
      "Eleven of fourteen matters last year were commercial leases.",
    ]);
    expect(text).toBe(
      "Hale Law acts for restaurant owners on lease disputes. Eleven of fourteen matters last year were commercial leases.",
    );
  });

  it("P2 renders the commitment pattern", () => {
    const text = buildStatement("P2", [
      "client",
      "a written estimate before signing anything",
      "It lists the fixed fee and what it covers.",
    ]);
    expect(text).toBe(
      "Every client gets a written estimate before signing anything. It lists the fixed fee and what it covers.",
    );
  });

  it("P3 renders the fit pattern", () => {
    const text = buildStatement("P3", [
      "a residential purchase in Peel Region",
      "We referred nine matters out last year.",
    ]);
    expect(text).toBe(
      "If your matter is a residential purchase in Peel Region, this firm is built for it. If it is not, we say so and refer you. We referred nine matters out last year.",
    );
  });

  it("returns an empty string for an unknown pattern id", () => {
    expect(buildStatement("P9", ["x"])).toBe("");
  });
});

describe("proofSlotIndex", () => {
  it("is the last slot for every pattern", () => {
    expect(proofSlotIndex("P1")).toBe(3);
    expect(proofSlotIndex("P2")).toBe(2);
    expect(proofSlotIndex("P3")).toBe(1);
  });
});

describe("assembleBrief: gate modes are a presentation concern, not an engine concern", () => {
  it("produces the same BriefData regardless of which gate mode the caller will render with", () => {
    const input = {
      alternatives: [{ id: "cheapest_online" }, { id: "other", otherText: "Ask a cousin who is a paralegal." }],
      work: [workFor("single_area_depth")],
      patternId: "P2",
      statementValues: ["client", "a written estimate", "We publish the fee."],
      firmName: "Hale Law",
    };
    const brief = assembleBrief(input);
    expect(brief.alternatives).toHaveLength(1);
    expect(brief.alternativeOtherText).toBe("Ask a cousin who is a paralegal.");
    expect(brief.survivors).toHaveLength(1);
    expect(brief.profile?.id).toBe("practice_focus");
    expect(brief.statement).toContain("Every client gets a written estimate");
    expect(brief.statementBlocked).toBe(false);
    expect(brief.firmName).toBe("Hale Law");
  });

  it("blocks the assembled statement when a slot value trips a hard rule", () => {
    const input = {
      alternatives: [],
      work: [workFor("single_area_depth")],
      patternId: "P1",
      statementValues: ["Hale Law", "clients", "the best legal work in the city", "proof"],
      firmName: "Hale Law",
    };
    const brief = assembleBrief(input);
    expect(brief.statementBlocked).toBe(true);
    expect(brief.statement).toBe("");
  });

  it("returns a null profile and empty survivors when nothing was submitted", () => {
    const brief = assembleBrief({
      alternatives: [],
      work: [],
      patternId: null,
      statementValues: [],
      firmName: "",
    });
    expect(brief.profile).toBeNull();
    expect(brief.survivors).toHaveLength(0);
    expect(brief.statement).toBe("");
  });
});
