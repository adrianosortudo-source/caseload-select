/**
 * Fixture assertions for placement-resolution.ts, run directly:
 *   npx tsx scripts/weekly-publish/lib/__tests__/placement-resolution.check.ts
 *
 * NOT a vitest file. This repo's vitest.config.ts collects only
 * src/**\/__tests__/**\/*.test.ts -- a file under scripts/ would never be
 * picked up by `npm test`, would never run, and would sit there implying
 * coverage that does not exist. That is precisely the failure class named in
 * EXECUTION-PLAN_weekly-publish-placement-fix_v1.md Standing Rule 6: "a
 * verification that passes because of state some other session created is
 * not a verification." A phantom test file is the same defect one layer up
 * -- it would pass by never running at all. So this is a plain, immediately
 * executable script using node:assert/strict, exercised directly as part of
 * this fix's own Phase 3 verification, not deferred to a test runner that
 * cannot see it.
 *
 * Exists because prove.ts's own run against W32 CANNOT prove the detector
 * works: W32 is already fully placed (this fix's Phase 1 work), so the
 * assertion would pass whether or not missingPlacementRoles() is correct.
 * These four cases are what actually exercise it.
 */
import assert from "node:assert/strict";
import {
  resolveEffectiveRole,
  missingPlacementRoles,
  REQUIRED_ARTICLE_PLACEMENT_ROLES,
  type ArtifactRow,
  type RoleAssignmentRow,
} from "../placement-resolution";

const VERSION = "v1";
const OTHER_VERSION = "v0";

function artifact(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: "art-1",
    versionId: VERSION,
    artifactType: "hero_image",
    assetRole: null,
    supersededAt: null,
    ...overrides,
  };
}

function assignment(overrides: Partial<RoleAssignmentRow> = {}): RoleAssignmentRow {
  return {
    artifactId: "art-1",
    assetRole: "website_article_hero_overlay",
    supersededAt: null,
    ...overrides,
  };
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

console.log("placement-resolution.check.ts");

check("case 1: role set directly on the artifact row resolves", () => {
  const a = artifact({ assetRole: "website_article_hero_overlay" });
  assert.equal(resolveEffectiveRole(a, []), "website_article_hero_overlay");
});

check("case 2: role only via an active assignment resolves", () => {
  const a = artifact({ id: "art-1", assetRole: null });
  const assigns = [assignment({ artifactId: "art-1", assetRole: "website_article_hero_overlay" })];
  assert.equal(resolveEffectiveRole(a, assigns), "website_article_hero_overlay");
});

check("case 3: an artifact whose only assignment is superseded does NOT resolve", () => {
  const a = artifact({ id: "art-1", assetRole: null });
  const assigns = [assignment({ artifactId: "art-1", supersededAt: "2026-01-01T00:00:00Z" })];
  assert.equal(resolveEffectiveRole(a, assigns), null);
});

check("case 4a: an article missing BOTH placements reports both roles missing", () => {
  const result = missingPlacementRoles("deliv-1", VERSION, [], []);
  assert.deepEqual(result.missingRoles, [...REQUIRED_ARTICLE_PLACEMENT_ROLES]);
});

check("case 4b: an article missing only the homepage CTA reports exactly that role", () => {
  const artifacts = [artifact({ id: "hero-art", assetRole: "website_article_hero_overlay" })];
  const result = missingPlacementRoles("deliv-1", VERSION, artifacts, []);
  assert.deepEqual(result.missingRoles, ["website_homepage_cta_textless"]);
});

check("case 4c: an article with both placements filled (one direct, one via assignment) reports nothing missing", () => {
  const artifacts = [
    artifact({ id: "hero-art", assetRole: null }),
    artifact({ id: "cta-art", assetRole: "website_homepage_cta_textless" }),
  ];
  const assigns = [assignment({ artifactId: "hero-art", assetRole: "website_article_hero_overlay" })];
  const result = missingPlacementRoles("deliv-1", VERSION, artifacts, assigns);
  assert.deepEqual(result.missingRoles, []);
});

check("case 4d: a role filled only on a NON-current version does not count", () => {
  const artifacts = [artifact({ id: "hero-art", versionId: OTHER_VERSION, assetRole: "website_article_hero_overlay" })];
  const result = missingPlacementRoles("deliv-1", VERSION, artifacts, []);
  assert.deepEqual(result.missingRoles, [...REQUIRED_ARTICLE_PLACEMENT_ROLES]);
});

check("case 4e: a superseded artifact on the current version does not count even with a role set directly", () => {
  const artifacts = [artifact({ id: "hero-art", assetRole: "website_article_hero_overlay", supersededAt: "2026-01-01T00:00:00Z" })];
  const result = missingPlacementRoles("deliv-1", VERSION, artifacts, []);
  assert.deepEqual(result.missingRoles, [...REQUIRED_ARTICLE_PLACEMENT_ROLES]);
});

console.log(`\n${passed}/${passed} PASS`);
