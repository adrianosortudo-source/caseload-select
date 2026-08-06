/**
 * Locks the seo-check calibration against silent drift.
 *
 * The live acceptance script (scripts/seo-check-calibration-acceptance.mjs)
 * cannot run in PR CI: it needs a running dev server, network access to 28
 * third-party sites, and it is flaky when a domain is down. This test
 * reproduces every headline score and grade offline from a recorded snapshot
 * of the panel (src/app/api/tools/seo-check/__tests__/__fixtures__/calibration-panel.json),
 * plus the three distribution properties that make the scale usable: span,
 * floor, and band coverage.
 *
 * If this test fails, it means one of two things: either a scoring change
 * (weights, caps, or category logic) was made without re-recording the panel
 * (`npm run record:seo-calibration`), or the scale has genuinely compressed
 * and needs investigating, the way Phase A found the engine could not issue
 * a grade below B+ across 21 real sites.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  applyEligibilityCaps,
  computeGrade,
  computeWeightedScore,
  type CheckItem,
  type EligibilityGates,
} from "../engine-core";

interface FixtureCategory {
  name: string;
  score: number;
  maxScore: number;
}

interface FixtureGates {
  httpsStatus: string | null;
  indexableStatus: string | null;
  robotsStatus: string | null;
  renderingRisk: string;
}

interface FixtureEntry {
  domain: string;
  overallScore: number;
  grade: string;
  categories: FixtureCategory[];
  gates: FixtureGates;
}

interface Fixture {
  recordedCount: number;
  entries: FixtureEntry[];
}

function load(): Fixture {
  const p = path.join(__dirname, "__fixtures__", "calibration-panel.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

const FIXTURE = load();

// Same rules as deriveEligibilityGates (engine-core.ts): a null status means
// the item was not found on that entry, which deriveEligibilityGates treats
// as passing, not failing.
function gatesFor(gates: FixtureGates): EligibilityGates {
  return {
    httpsOk: gates.httpsStatus === null || gates.httpsStatus === "pass",
    indexableOk:
      (gates.indexableStatus === null || gates.indexableStatus === "pass") &&
      gates.robotsStatus !== "fail",
    renderingOk: gates.renderingRisk !== "high",
  };
}

describe("calibration-lock: recorded panel reproduces offline", () => {
  it("has a non-trivial recorded panel to test against", () => {
    expect(FIXTURE.entries.length).toBeGreaterThanOrEqual(22);
  });

  it("reproduces overallScore for every recorded entry", () => {
    for (const entry of FIXTURE.entries) {
      const categories = entry.categories.map((c) => ({ ...c, items: [] as CheckItem[] }));
      const gates = gatesFor(entry.gates);
      const recomputed = applyEligibilityCaps(computeWeightedScore(categories), gates);
      expect(recomputed, `overallScore mismatch for ${entry.domain}`).toBe(entry.overallScore);
    }
  });

  it("reproduces grade for every recorded entry", () => {
    for (const entry of FIXTURE.entries) {
      expect(computeGrade(entry.overallScore), `grade mismatch for ${entry.domain}`).toBe(entry.grade);
    }
  });

  it("scores span at least 30 points across the panel", () => {
    const scores = FIXTURE.entries.map((e) => e.overallScore);
    const spread = Math.max(...scores) - Math.min(...scores);
    expect(spread).toBeGreaterThanOrEqual(30);
  });

  it("at least 5 entries score below 60", () => {
    const below60 = FIXTURE.entries.filter((e) => e.overallScore < 60);
    expect(below60.length).toBeGreaterThanOrEqual(5);
  });

  it("at least 4 distinct grades appear across the panel", () => {
    const distinctGrades = new Set(FIXTURE.entries.map((e) => e.grade));
    expect(distinctGrades.size).toBeGreaterThanOrEqual(4);
  });
});
