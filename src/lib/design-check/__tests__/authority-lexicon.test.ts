import { describe, it, expect } from "vitest";
import { scanForLexiconHits, scoreClaimIntegrity, SELF_DESIGNATION_LEXICON } from "../authority-lexicon";

/**
 * The earned-versus-claimed classifier is the Authority module's core
 * scoring mechanic ("the mechanic that makes the dimension defensible").
 * It had zero coverage before this file, and the one real domain the tool
 * was verified against (sakurabalaw.ca) contains no self-designation
 * language at all, so every live run scored claim integrity 100 without
 * ever exercising a single branch. These fixtures are the first thing to
 * actually run the classifier against copy that trips it.
 */

describe("scanForLexiconHits", () => {
  it("finds nothing in copy that makes no self-designation claim", () => {
    const text = "We handle commercial leases and shareholder agreements for Toronto businesses.";
    expect(scanForLexiconHits(text)).toEqual([]);
  });

  it("flags a naked superlative with no proof nearby", () => {
    const hits = scanForLexiconHits("We are the best firm for your business.");
    expect(hits).toHaveLength(1);
    expect(hits[0].term).toBe("best");
    expect(hits[0].category).toBe("prohibited");
    expect(hits[0].hasAdjacentProof).toBe(false);
  });

  it("treats a strong claim as proof-backed when verifiable evidence sits nearby", () => {
    // Module Part 2: "Claim with adjacent verifiable proof: neutral to
    // positive. The proof is what scores, not the adjective."
    const hits = scanForLexiconHits("An award-winning practice, recognized by the Law Society of Ontario in 2024.");
    const awardHit = hits.find((h) => h.term === "award-winning");
    expect(awardHit).toBeDefined();
    expect(awardHit!.hasAdjacentProof).toBe(true);
  });

  it("does not let proof elsewhere on the page launder a distant naked claim", () => {
    // The proof window is bounded. A credential 2000 characters away is
    // not "the same section or component" the module requires.
    const filler = "x".repeat(2000);
    const hits = scanForLexiconHits(`We are the leading firm.${filler}Called to the bar in 2015.`);
    const leadingHit = hits.find((h) => h.term === "leading");
    expect(leadingHit).toBeDefined();
    expect(leadingHit!.hasAdjacentProof).toBe(false);
  });

  it("categorizes law-marketing aggressiveness framing distinctly from generic puffery", () => {
    const hits = scanForLexiconHits("We dominate opposing counsel.");
    expect(hits.some((h) => h.term === "dominate" && h.category === "law_marketing")).toBe(true);
  });

  it("marks specialist and expert as gatable, since LSO permits them only with the Certified Specialist designation", () => {
    const hits = scanForLexiconHits("Our expert team. Speak to a specialist.");
    const gatable = hits.filter((h) => h.gatable).map((h) => h.term);
    expect(gatable).toContain("expert");
    expect(gatable).toContain("specialist");
  });

  it("finds every occurrence, not just the first", () => {
    const hits = scanForLexiconHits("The best. Truly the best.");
    expect(hits.filter((h) => h.term === "best")).toHaveLength(2);
  });

  it("matches on word boundaries, so an unrelated word containing a term is not a hit", () => {
    // "expertise" is not the self-designation "expert"; a substring match
    // would produce a false positive on ordinary, compliant copy.
    expect(scanForLexiconHits("Our expertise covers commercial leasing.")).toEqual([]);
  });

  // Every case below is a legal term of art. Flagging one tells a firm it
  // has a Rule 4.2-1 compliance problem when it is using ordinary legal
  // vocabulary, which is worse than missing a real violation. The first
  // case is the live false positive that prompted these: a real family-law
  // site was flagged for "keeping the best interests of the family in focus".
  it.each([
    ["best interests of the child", "We act with the best interests of the child in mind."],
    ["best interests of the family", "keeping the best interests of the family in focus"],
    ["best efforts", "The parties shall use best efforts to close."],
    ["best endeavours", "subject to best endeavours under the agreement"],
    ["personal guarantee", "Review any personal guarantee before you sign the lease."],
    ["guarantee of payment", "The landlord required a guarantee of payment."],
  ])("does not flag %s as a self-designation claim", (_label, text) => {
    expect(scanForLexiconHits(text)).toEqual([]);
  });

  it("still flags the same words when they are a real claim rather than a term of art", () => {
    // The exclusion must be narrow. "We are simply the best" is not a term
    // of art and must still be caught.
    expect(scanForLexiconHits("We are simply the best.").map((h) => h.term)).toContain("best");
    expect(scanForLexiconHits("We guarantee you will win.").map((h) => h.term)).toContain("guarantee");
  });

  it("flags a real claim that appears in the same copy as a term of art", () => {
    const hits = scanForLexiconHits(
      "We protect the best interests of the child. " + "z".repeat(120) + " We are the best firm in Toronto."
    );
    expect(hits.filter((h) => h.term === "best")).toHaveLength(1);
  });

  it("terminates on every lexicon entry (no catastrophic or zero-width regex hang)", () => {
    const text = SELF_DESIGNATION_LEXICON.map((e) => e.term).join(" ") + " ".repeat(50);
    expect(() => scanForLexiconHits(text)).not.toThrow();
  });
});

describe("scoreClaimIntegrity", () => {
  it("scores 100 when nothing was claimed", () => {
    expect(scoreClaimIntegrity([]).score).toBe(100);
  });

  it("scores 100 when every strong claim is backed by adjacent proof", () => {
    const hits = scanForLexiconHits("Award-winning, as recognized by the Law Society of Ontario in 2024.");
    const result = scoreClaimIntegrity(hits);
    expect(result.nakedHits).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it("deducts per naked claim", () => {
    const hits = scanForLexiconHits("We are the best.");
    expect(scoreClaimIntegrity(hits).score).toBe(85);
  });

  it("drives toward zero on high self-designation density with no proof, and never below zero", () => {
    // Module: "High self-designation density with low proof density
    // drives this sub-score toward zero."
    const text = "The best, leading, premier, elite, top-rated, world-class, renowned, unmatched, trusted firm.";
    const result = scoreClaimIntegrity(scanForLexiconHits(text));
    expect(result.nakedHits.length).toBeGreaterThanOrEqual(7);
    expect(result.score).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("separates proof-backed from naked hits rather than lumping them", () => {
    const hits = scanForLexiconHits("Called to the bar in 2015, an award-winning lawyer. " + "y".repeat(2000) + " Simply the best.");
    const result = scoreClaimIntegrity(hits);
    expect(result.proofBackedHits.length).toBeGreaterThan(0);
    expect(result.nakedHits.length).toBeGreaterThan(0);
  });
});
