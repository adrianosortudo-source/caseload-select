import { describe, it, expect } from "vitest";
import { initialiseState } from "../extractor";

/**
 * Lock-in: the canonical Meta App Review test message classifies to a
 * DRG-in-scope matter type (employment / wrongful_dismissal). The
 * previous test message was an immigration scenario, which DRG does
 * not practice (LSO 4 areas: corporate, real estate, employment,
 * estates). An out-of-scope demo produces a Band D brief without the
 * Phase B fee estimate or four-axis depth — Meta reviewers see a thin
 * brief and the demo undersells the product.
 *
 * If this test fails on a future engine change, regenerate the demo
 * MP4s with a new test message that still classifies in-scope.
 */

const APP_REVIEW_TEST_MESSAGE =
  "I was let go from my job last week after 6 years. They offered me 8 weeks of severance " +
  "but I'm not sure if that's fair. I want to understand my options before I sign anything.";

describe("Meta App Review canonical test message", () => {
  const state = initialiseState(APP_REVIEW_TEST_MESSAGE);

  it("classifies to the employment practice area", () => {
    expect(state.practice_area).toBe("employment");
  });

  it("matter_type is wrongful_dismissal (Phase B sub-type), NOT out_of_scope", () => {
    expect(state.matter_type).toBe("wrongful_dismissal");
    expect(state.matter_type).not.toBe("out_of_scope");
    expect(state.matter_type).not.toBe("employment_general");
  });

  it("brief renders with a Phase B matter pack (not the thin OOS template)", () => {
    // Phase B sub-type packs have proper banding via four_axis. The thin
    // OOS template doesn't. Asserting matter_type is wrongful_dismissal
    // is the leading indicator; the brief content follows from the pack.
    expect(state.matter_type).toBe("wrongful_dismissal");
  });
});
