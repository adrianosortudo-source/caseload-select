/**
 * score-components.test.ts
 *
 * Regression guard for the source-aware ScoreRationaleInput builder.
 * The helper branches on leads.scoring_model to return the right fit/value
 * maxes and the right factor set per engine. These tests cover the branch
 * behaviour that the admin and portal lead detail pages rely on.
 */

import { describe, it, expect } from "vitest";
import {
  buildScoreRationaleInput,
  resolveScoringModel,
  type LeadScoringRow,
} from "../score-components";

describe("resolveScoringModel", () => {
  it("returns gpt_cpi_v1 when tagged", () => {
    expect(resolveScoringModel({ scoring_model: "gpt_cpi_v1" })).toBe("gpt_cpi_v1");
  });

  it("returns v2.1_form when tagged", () => {
    expect(resolveScoringModel({ scoring_model: "v2.1_form" })).toBe("v2.1_form");
  });

  it("defaults unknown tag to v2.1_form (legacy rows)", () => {
    expect(resolveScoringModel({ scoring_model: null })).toBe("v2.1_form");
    expect(resolveScoringModel({})).toBe("v2.1_form");
    expect(resolveScoringModel({ scoring_model: "something_else" })).toBe("v2.1_form");
  });
});

describe("buildScoreRationaleInput", () => {
  it("returns null when no band is present", () => {
    const row: LeadScoringRow = { fit_score: 20, value_score: 40 };
    expect(buildScoreRationaleInput(row)).toBeNull();
  });

  it("falls back to priority_band when band is missing", () => {
    const row: LeadScoringRow = {
      priority_band: "B",
      priority_index: 75,
      fit_score: 20,
      value_score: 45,
    };
    const result = buildScoreRationaleInput(row);
    expect(result?.band).toBe("B");
  });

  describe("v2.1_form engine", () => {
    const formRow: LeadScoringRow = {
      band: "A",
      priority_index: 92,
      fit_score: 28,
      value_score: 60,
      geo_score: 9,
      contactability_score: 10,
      legitimacy_score: 9,
      complexity_score: 22,
      urgency_score: 18,
      strategic_score: 10,
      fee_score: 10,
      scoring_model: "v2.1_form",
    };

    it("returns fit max 30 and val max 65", () => {
      const result = buildScoreRationaleInput(formRow);
      expect(result?.fit).toEqual({ value: 28, max: 30 });
      expect(result?.val).toEqual({ value: 60, max: 65 });
    });

    it("includes all 7 form factors with correct maxes", () => {
      const result = buildScoreRationaleInput(formRow);
      const labels = result?.components.map((c) => c.label) ?? [];
      expect(labels).toEqual([
        "Geographic fit",
        "Contactability",
        "Inquiry legitimacy",
        "Case complexity",
        "Urgency",
        "Strategic value",
        "Fee capacity",
      ]);
      const maxes = result?.components.map((c) => c.max) ?? [];
      expect(maxes).toEqual([10, 10, 10, 25, 20, 10, 10]);
    });

    it("reads sub-score values from top-level columns", () => {
      const result = buildScoreRationaleInput(formRow);
      const contactability = result?.components.find((c) => c.label === "Contactability");
      const strategic = result?.components.find((c) => c.label === "Strategic value");
      expect(contactability?.value).toBe(10);
      expect(strategic?.value).toBe(10);
    });

    it("defaults legacy rows (no scoring_model) to form engine", () => {
      const legacy: LeadScoringRow = { ...formRow, scoring_model: null };
      const result = buildScoreRationaleInput(legacy);
      expect(result?.fit.max).toBe(30);
      expect(result?.val.max).toBe(65);
      expect(result?.components).toHaveLength(7);
    });
  });

  describe("gpt_cpi_v1 engine", () => {
    const gptRow: LeadScoringRow = {
      band: "A",
      priority_index: 85,
      // Overlapping columns populated by the OTP verify writer
      geo_score: 9,
      legitimacy_score: 8,
      complexity_score: 20,
      urgency_score: 18,
      fee_score: 9,
      // fit_score / value_score deliberately null on GPT leads
      fit_score: null,
      value_score: null,
      scoring_model: "gpt_cpi_v1",
      score_components: {
        geo_score: 9,
        practice_score: 10,
        legitimacy_score: 8,
        referral_score: 5,
        urgency_score: 18,
        complexity_score: 20,
        multi_practice_score: 3,
        fee_score: 9,
        fit_score: 32,
        value_score: 50,
        total: 82,
        band: "A",
      },
    };

    it("returns fit max 40 and val max 60", () => {
      const result = buildScoreRationaleInput(gptRow);
      expect(result?.fit).toEqual({ value: 32, max: 40 });
      expect(result?.val).toEqual({ value: 50, max: 60 });
    });

    it("includes all 8 GPT factors with correct maxes", () => {
      const result = buildScoreRationaleInput(gptRow);
      const labels = result?.components.map((c) => c.label) ?? [];
      expect(labels).toEqual([
        "Geographic fit",
        "Practice fit",
        "Inquiry legitimacy",
        "Referral signal",
        "Urgency",
        "Case complexity",
        "Multi-practice fit",
        "Fee capacity",
      ]);
      const maxes = result?.components.map((c) => c.max) ?? [];
      expect(maxes).toEqual([10, 10, 10, 10, 20, 25, 5, 10]);
    });

    it("reads GPT-specific factors from score_components JSONB", () => {
      const result = buildScoreRationaleInput(gptRow);
      const practice = result?.components.find((c) => c.label === "Practice fit");
      const referral = result?.components.find((c) => c.label === "Referral signal");
      const multi = result?.components.find((c) => c.label === "Multi-practice fit");
      expect(practice?.value).toBe(10);
      expect(referral?.value).toBe(5);
      expect(multi?.value).toBe(3);
    });

    it("reads fit_score and value_score from JSONB (top-level columns are null for GPT)", () => {
      const result = buildScoreRationaleInput(gptRow);
      expect(result?.fit.value).toBe(32);
      expect(result?.val.value).toBe(50);
    });

    it("falls back to 0 when score_components is missing (graceful degrade)", () => {
      const partial: LeadScoringRow = {
        band: "B",
        scoring_model: "gpt_cpi_v1",
        priority_index: 70,
        geo_score: 8,
        urgency_score: 15,
      };
      const result = buildScoreRationaleInput(partial);
      // Overlapping factors still render from top-level columns
      expect(result?.components.find((c) => c.label === "Geographic fit")?.value).toBe(8);
      expect(result?.components.find((c) => c.label === "Urgency")?.value).toBe(15);
      // GPT-only factors degrade to 0 rather than throw
      expect(result?.components.find((c) => c.label === "Practice fit")?.value).toBe(0);
      expect(result?.components.find((c) => c.label === "Multi-practice fit")?.value).toBe(0);
    });
  });

  it("passes through missingFields untouched", () => {
    const row: LeadScoringRow = {
      band: "C",
      priority_index: 50,
      fit_score: 15,
      value_score: 35,
      cpi_missing_fields: ["urgency level", "estimated case value"],
    };
    const result = buildScoreRationaleInput(row);
    expect(result?.missingFields).toEqual(["urgency level", "estimated case value"]);
  });

  it("wires opts.aiAngle into the output", () => {
    const row: LeadScoringRow = {
      band: "A",
      priority_index: 90,
      fit_score: 28,
      value_score: 60,
    };
    const result = buildScoreRationaleInput(row, { aiAngle: "Probe limitation period on the first call." });
    expect(result?.aiAngle).toBe("Probe limitation period on the first call.");
  });
});
