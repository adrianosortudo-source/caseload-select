/**
 * Trust-fix pass WI-1: an item with scored:false is displayed and still
 * generates issues-list findings, but contributes nothing to any grade.
 * See docs/SEO-TOOL-TRUST-FIX-PASS-v1.md.
 */

import { describe, it, expect } from "vitest";
import { scoreItems, computeWeightedScore, aiScoresFromItems, type CheckItem, type CategoryResult } from "../engine-core";

describe("scoreItems: scored:false items are excluded from both score and maxScore", () => {
  it("a warn(unscored) item does not lower the score below what the scored pass earns", () => {
    const items: CheckItem[] = [
      { label: "A", status: "pass", detail: "" },
      { label: "B", status: "warn", detail: "", scored: false },
    ];
    expect(scoreItems(items)).toEqual({ score: 10, maxScore: 10 });
  });

  it("a fail(unscored) item does not lower the score either", () => {
    const items: CheckItem[] = [
      { label: "A", status: "pass", detail: "" },
      { label: "B", status: "fail", detail: "", scored: false },
    ];
    expect(scoreItems(items)).toEqual({ score: 10, maxScore: 10 });
  });

  it("a pass(unscored) item does not raise the score either (symmetry)", () => {
    const items: CheckItem[] = [
      { label: "A", status: "warn", detail: "" },
      { label: "B", status: "pass", detail: "", scored: false },
    ];
    expect(scoreItems(items)).toEqual({ score: 5, maxScore: 10 });
  });

  it("all-unscored category returns 0/0, not a penalized non-zero maxScore", () => {
    const items: CheckItem[] = [
      { label: "A", status: "fail", detail: "", scored: false },
      { label: "B", status: "pass", detail: "", scored: false },
    ];
    expect(scoreItems(items)).toEqual({ score: 0, maxScore: 0 });
  });
});

describe("computeWeightedScore: an all-unscored category never drags the overall score down", () => {
  const cat = (name: string, items: CheckItem[]): CategoryResult => {
    const { score, maxScore } = scoreItems(items);
    return { name, score, maxScore, items };
  };

  it("identical overall score with and without an extra all-unscored category present", () => {
    const base = [cat("On-Page SEO", [{ label: "x", status: "pass", detail: "" }])];
    const withExtra = [
      ...base,
      cat("Technical & Security", [
        { label: "CSP", status: "fail", detail: "", scored: false },
        { label: "HSTS header", status: "fail", detail: "", scored: false },
      ]),
    ];
    expect(computeWeightedScore(withExtra)).toBe(computeWeightedScore(base));
  });

  it("identical overall score whether a category's items are all scored-pass or all scored:false-with-any-status", () => {
    const withHeaders = [
      cat("On-Page SEO", [{ label: "x", status: "pass", detail: "" }]),
      cat("Technical & Security", [
        { label: "HTTPS", status: "pass", detail: "" },
        { label: "Mixed content", status: "pass", detail: "" },
        { label: "CSP", status: "pass", detail: "", scored: false },
        { label: "HSTS header", status: "pass", detail: "", scored: false },
      ]),
    ];
    const withoutHeaders = [
      cat("On-Page SEO", [{ label: "x", status: "pass", detail: "" }]),
      cat("Technical & Security", [
        { label: "HTTPS", status: "pass", detail: "" },
        { label: "Mixed content", status: "pass", detail: "" },
        { label: "CSP", status: "fail", detail: "", scored: false },
        { label: "HSTS header", status: "fail", detail: "", scored: false },
      ]),
    ];
    expect(computeWeightedScore(withHeaders)).toBe(computeWeightedScore(withoutHeaders));
  });
});

describe("aiScoresFromItems: unscored items do not move the AEO Readiness (search) score", () => {
  it("identical search score with and without an unscored llms.txt pass item", () => {
    const base: CheckItem[] = [
      { label: "Question-format headings", status: "pass", detail: "" },
      { label: "Direct-answer sentences", status: "warn", detail: "" },
    ];
    const withLlms: CheckItem[] = [...base, { label: "llms.txt file", status: "pass", detail: "", scored: false }];
    expect(aiScoresFromItems(withLlms).search).toBe(aiScoresFromItems(base).search);
  });

  it("identical search score whether the unscored item is pass or fail", () => {
    const withPass: CheckItem[] = [
      { label: "Question-format headings", status: "pass", detail: "" },
      { label: "llms.txt file", status: "pass", detail: "", scored: false },
    ];
    const withFail: CheckItem[] = [
      { label: "Question-format headings", status: "pass", detail: "" },
      { label: "llms.txt file", status: "fail", detail: "", scored: false },
    ];
    expect(aiScoresFromItems(withPass).search).toBe(aiScoresFromItems(withFail).search);
  });

  it("policy score (AI training bot control) is unaffected by the scored flag", () => {
    const items: CheckItem[] = [
      { label: "AI training bot control", status: "warn", detail: "" },
      { label: "llms.txt file", status: "pass", detail: "", scored: false },
    ];
    expect(aiScoresFromItems(items).policy).toBe(50);
  });
});
