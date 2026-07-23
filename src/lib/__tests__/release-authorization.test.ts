/**
 * isVersionReleaseAuthorized (release-authorization.ts): the ONE canonical
 * two-path release-authorization interpreter for this codebase. Table-driven
 * coverage of its full decision tree, matched against
 * claim_placement_for_publish()'s own Path A / Path B branch (supabase/
 * migrations/20260717230956_standing_publishing_authorization.sql,
 * lines 407-439) -- every row below corresponds to a real combination that
 * branch can reach.
 */

import { describe, it, expect } from "vitest";
import { isVersionReleaseAuthorized, type ReleaseAuthorizationInput, type ReleaseAuthorizationResultKind } from "@/lib/release-authorization";

const TARGET_VERSION_ID = "v-target-0001";
const OTHER_VERSION_ID = "v-other-9999";

interface Row {
  name: string;
  input: ReleaseAuthorizationInput;
  expectedKind: ReleaseAuthorizationResultKind;
  expectedAuthorized: boolean;
  expectedPath: "individual_approval" | "standing_authorization" | null;
}

const ROWS: Row[] = [
  {
    name: "Path A: individually approved, requires_individual_review=false, no standing authorization",
    input: { deliverableStatus: "approved", approvedVersionId: TARGET_VERSION_ID, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: false, standingAuthorizationActive: false },
    expectedKind: "individually_approved",
    expectedAuthorized: true,
    expectedPath: "individual_approval",
  },
  {
    name: "Scenario D: individual approval authorizes even when requires_individual_review=true (approval overrides the need for standing path)",
    input: { deliverableStatus: "approved", approvedVersionId: TARGET_VERSION_ID, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: true, standingAuthorizationActive: false },
    expectedKind: "individually_approved",
    expectedAuthorized: true,
    expectedPath: "individual_approval",
  },
  {
    name: "Individual approval wins even when standing authorization is ALSO active",
    input: { deliverableStatus: "approved", approvedVersionId: TARGET_VERSION_ID, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: false, standingAuthorizationActive: true },
    expectedKind: "individually_approved",
    expectedAuthorized: true,
    expectedPath: "individual_approval",
  },
  {
    name: "Individual approval wins even when standing active AND requires_individual_review=true",
    input: { deliverableStatus: "approved", approvedVersionId: TARGET_VERSION_ID, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: true, standingAuthorizationActive: true },
    expectedKind: "individually_approved",
    expectedAuthorized: true,
    expectedPath: "individual_approval",
  },
  {
    name: "Scenario B: no individual approval, standing authorization active, requires_individual_review=false -> authorized via standing authorization",
    input: { deliverableStatus: "draft", approvedVersionId: null, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: false, standingAuthorizationActive: true },
    expectedKind: "standing_authorization",
    expectedAuthorized: true,
    expectedPath: "standing_authorization",
  },
  {
    name: "Scenario C: no individual approval, standing authorization active, but requires_individual_review=true -> blocked (the exception is absolute)",
    input: { deliverableStatus: "draft", approvedVersionId: null, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: true, standingAuthorizationActive: true },
    expectedKind: "blocked_requires_individual_review",
    expectedAuthorized: false,
    expectedPath: null,
  },
  {
    name: "requires_individual_review blocks even when standing authorization is ALSO inactive",
    input: { deliverableStatus: "draft", approvedVersionId: null, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: true, standingAuthorizationActive: false },
    expectedKind: "blocked_requires_individual_review",
    expectedAuthorized: false,
    expectedPath: null,
  },
  {
    name: "Scenario E: stale approval (approved_version_id references another version), standing authorization inactive -> blocked, never called approved",
    input: { deliverableStatus: "approved", approvedVersionId: OTHER_VERSION_ID, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: false, standingAuthorizationActive: false },
    expectedKind: "approved_version_mismatch",
    expectedAuthorized: false,
    expectedPath: null,
  },
  {
    name: "Scenario F: stale approval PLUS valid standing authorization -> authorized through standing authorization, NOT individual approval",
    input: { deliverableStatus: "approved", approvedVersionId: OTHER_VERSION_ID, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: false, standingAuthorizationActive: true },
    expectedKind: "standing_authorization",
    expectedAuthorized: true,
    expectedPath: "standing_authorization",
  },
  {
    name: "Stale approval + requires_individual_review=true + standing active -> still blocked (review overrides, and the stale approval never qualifies as Path A)",
    input: { deliverableStatus: "approved", approvedVersionId: OTHER_VERSION_ID, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: true, standingAuthorizationActive: true },
    expectedKind: "blocked_requires_individual_review",
    expectedAuthorized: false,
    expectedPath: null,
  },
  {
    name: "Scenario G: never individually approved, standing authorization inactive/revoked -> blocked",
    input: { deliverableStatus: "draft", approvedVersionId: null, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: false, standingAuthorizationActive: false },
    expectedKind: "standing_authorization_inactive",
    expectedAuthorized: false,
    expectedPath: null,
  },
  {
    // The ID literally matches -- only deliverableStatus disqualifies Path
    // A. Both conditions are required (matching claim_placement_for_publish()'s
    // own `status = 'approved' and approved_version_id = ...` check), so
    // this correctly falls through to approved_version_mismatch -- but the
    // REASON text must never claim the IDs don't match, since they do. This
    // combination is believed unreachable via any real mutation path in
    // this codebase today (status and approved_version_id are always
    // written together), but this module does not itself enforce that
    // invariant, so its own reason text must stay accurate regardless.
    name: "approved_version_id matches the target version, but deliverableStatus is not \"approved\" -> blocked, reason must not claim an ID mismatch that isn't real",
    input: { deliverableStatus: "draft", approvedVersionId: TARGET_VERSION_ID, targetVersionId: TARGET_VERSION_ID, versionRequiresIndividualReview: false, standingAuthorizationActive: false },
    expectedKind: "approved_version_mismatch",
    expectedAuthorized: false,
    expectedPath: null,
  },
];

describe("isVersionReleaseAuthorized: full two-path decision-tree matrix", () => {
  it.each(ROWS)("$name", (row) => {
    const result = isVersionReleaseAuthorized(row.input);
    expect(result.kind).toBe(row.expectedKind);
    expect(result.authorized).toBe(row.expectedAuthorized);
    expect(result.authorizationPath).toBe(row.expectedPath);
    // Every result carries the raw evidence it decided from, verbatim --
    // never dropped, so a caller can explain the decision without
    // re-fetching or re-deriving anything.
    expect(result.approvedVersionId).toBe(row.input.approvedVersionId);
    expect(result.targetVersionId).toBe(row.input.targetVersionId);
    expect(result.versionRequiresIndividualReview).toBe(row.input.versionRequiresIndividualReview);
    expect(result.standingAuthorizationActive).toBe(row.input.standingAuthorizationActive);
  });

  it("reason text never describes a standing-authorized version as individually approved", () => {
    const result = isVersionReleaseAuthorized({
      deliverableStatus: "draft",
      approvedVersionId: null,
      targetVersionId: TARGET_VERSION_ID,
      versionRequiresIndividualReview: false,
      standingAuthorizationActive: true,
    });
    expect(result.reason).toMatch(/standing publishing authorization/i);
    // requires_individual_review is legitimately named in this reason (the
    // flag this path is conditioned on) -- the real invariant is that the
    // reason never CLAIMS individual approval happened.
    expect(result.reason).not.toMatch(/individual(ly)? approv/i);
  });

  it("reason text never describes individual approval as standing authorization", () => {
    const result = isVersionReleaseAuthorized({
      deliverableStatus: "approved",
      approvedVersionId: TARGET_VERSION_ID,
      targetVersionId: TARGET_VERSION_ID,
      versionRequiresIndividualReview: false,
      standingAuthorizationActive: false,
    });
    expect(result.reason).toMatch(/individual version approval/i);
    expect(result.reason).not.toMatch(/standing/i);
  });

  it("reason text explicitly names the path when authorized -- never a bare 'approved'", () => {
    const individualResult = isVersionReleaseAuthorized({
      deliverableStatus: "approved",
      approvedVersionId: TARGET_VERSION_ID,
      targetVersionId: TARGET_VERSION_ID,
      versionRequiresIndividualReview: false,
      standingAuthorizationActive: false,
    });
    expect(individualResult.reason).toMatch(/Release-authorized through individual version approval/);

    const standingResult = isVersionReleaseAuthorized({
      deliverableStatus: "draft",
      approvedVersionId: null,
      targetVersionId: TARGET_VERSION_ID,
      versionRequiresIndividualReview: false,
      standingAuthorizationActive: true,
    });
    expect(standingResult.reason).toMatch(/Release-authorized through active standing publishing authorization/);
  });

  it("reason text never asserts an ID mismatch when approved_version_id actually matches the target version (status is the real blocker)", () => {
    const result = isVersionReleaseAuthorized({
      deliverableStatus: "draft",
      approvedVersionId: TARGET_VERSION_ID,
      targetVersionId: TARGET_VERSION_ID,
      versionRequiresIndividualReview: false,
      standingAuthorizationActive: false,
    });
    expect(result.kind).toBe("approved_version_mismatch");
    expect(result.authorized).toBe(false);
    expect(result.reason).not.toMatch(/does not match/);
    expect(result.reason).toMatch(/matches the evaluated version/);
    expect(result.reason).toMatch(/deliverableStatus="draft" is not "approved"/);
  });

  it("the same fix applies to the requires_individual_review-blocked reason text", () => {
    const result = isVersionReleaseAuthorized({
      deliverableStatus: "in_review",
      approvedVersionId: TARGET_VERSION_ID,
      targetVersionId: TARGET_VERSION_ID,
      versionRequiresIndividualReview: true,
      standingAuthorizationActive: true,
    });
    expect(result.kind).toBe("blocked_requires_individual_review");
    expect(result.reason).not.toMatch(/does not match/);
    expect(result.reason).toMatch(/matches the evaluated version/);
  });
});
