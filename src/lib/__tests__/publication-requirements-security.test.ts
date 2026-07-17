/**
 * Defense-in-depth tests for the publication readiness fail-closed
 * guarantees. These are narrower than publication-readiness.test.ts's full
 * pass/fail matrix; they exist to pin two specific security-relevant
 * invariants that, if they regressed, would let an unpublishable or
 * archived deliverable read as ready:
 *
 *   (a) archived status always wins, regardless of how complete the
 *       deliverable's checks would otherwise be.
 *   (b) resolveRequirements never returns an empty requirement list for a
 *       known deliverable_role, with or without per-row overrides applied.
 *       An empty list would make evaluateDeliverableReadiness vacuously
 *       report ready:true (every requirement in an empty set "passes").
 *
 * Fixture style adapted from publication-readiness.test.ts (read that file
 * first): plain builder functions with sane defaults, overridden per test.
 * No I/O; pure functions only.
 */

import { describe, it, expect } from "vitest";
import { evaluateDeliverableReadiness, type EvaluateReadinessInput } from "../publication-readiness";
import { resolveRequirements } from "../publication-requirements";
import type { ContentDeliverable, DeliverableRole, DeliverableVersion, PublicationArtifact, PublicationArtifactValidation } from "../types";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const CURRENT_VERSION_ID = "v2222222-2222-2222-2222-222222222222";

function makeDeliverable(overrides: Partial<ContentDeliverable> = {}): ContentDeliverable {
  return {
    id: DELIVERABLE_ID,
    firm_id: FIRM_ID,
    title: "Test deliverable",
    description: null,
    content_kind: "text",
    status: "approved",
    current_version_id: CURRENT_VERSION_ID,
    approved_version_id: CURRENT_VERSION_ID,
    approved_at: "2026-07-14T00:00:00Z",
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z",
    excerpt: null,
    topic: null,
    byline: null,
    publish_date: "2026-07-14",
    read_time: null,
    hero_image_url: null,
    kicker: null,
    period_id: null,
    format: null,
    locale: "en-CA",
    deliverable_role: "article",
    publication_destination: "firm_website",
    publication_path: "/journal/test",
    cta_target_path: null,
    requires_legal_approval: null,
    requires_image: null,
    requires_file: null,
    requires_localized_route: null,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<DeliverableVersion> = {}): DeliverableVersion {
  return {
    id: CURRENT_VERSION_ID,
    deliverable_id: DELIVERABLE_ID,
    firm_id: FIRM_ID,
    version_number: 2,
    body_html: "<p>Real content.</p>",
    storage_path: null,
    asset_mime: null,
    asset_size_bytes: null,
    asset_name: null,
    note: null,
    responds_to_approval_id: null,
    asset_sha256: null,
    asset_validation: null,
    created_by_role: "operator",
    created_by_id: null,
    created_at: "2026-07-14T00:00:00Z",
    requires_individual_review: false,
    requires_individual_review_reason: null,
    requires_individual_review_set_by_role: null,
    requires_individual_review_set_by_id: null,
    requires_individual_review_set_by_name: null,
    requires_individual_review_set_at: null,
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<PublicationArtifact> = {}): PublicationArtifact {
  return {
    id: "a1111111-1111-1111-1111-111111111111",
    firm_id: FIRM_ID,
    deliverable_id: DELIVERABLE_ID,
    version_id: CURRENT_VERSION_ID,
    artifact_type: "hero_image",
    locale: "en-CA",
    destination: "firm_website",
    storage_bucket: "firm-files",
    storage_path: "images/hero.png",
    public_url: null,
    repository: null,
    repository_path: null,
    deployment_commit: null,
    deployment_url: null,
    mime_type: "image/png",
    size_bytes: 1024,
    sha256: "a".repeat(64),
    validation_result: null,
    created_by_role: "system",
    created_by_id: null,
    created_at: "2026-07-14T00:00:00Z",
    superseded_at: null,
    ...overrides,
  };
}

function makePassingValidation(artifactId: string): PublicationArtifactValidation {
  return {
    id: `val-${artifactId}`,
    artifact_id: artifactId,
    firm_id: FIRM_ID,
    validator: "storage_object_check",
    result: "pass",
    details: null,
    validated_by_role: "system",
    validated_by_id: null,
    created_at: "2026-07-14T00:00:00Z",
  };
}

function makeInput(overrides: Partial<EvaluateReadinessInput> = {}): EvaluateReadinessInput {
  return {
    deliverable: makeDeliverable(),
    currentVersion: makeVersion(),
    artifacts: [],
    latestValidationByArtifactId: {},
    ...overrides,
  };
}

describe("security: archived status always wins", () => {
  it("excluded:true, ready:false for an archived deliverable with every other check fully complete", () => {
    // Build a deliverable that would be `ready: true` under evaluateDeliverableReadiness
    // if status were "approved" instead of "archived" — same shape as the
    // "fully complete deliverable is ready" fixture in publication-readiness.test.ts.
    const hero = makeArtifact({ id: "hero-1", artifact_type: "hero_image", version_id: CURRENT_VERSION_ID, locale: "en-CA" });
    const webpage = makeArtifact({
      id: "wp-1",
      artifact_type: "webpage",
      version_id: CURRENT_VERSION_ID,
      locale: "en-CA",
      public_url: "https://drglaw.ca/journal/test",
    });

    const fullyCompleteArchived = makeInput({
      deliverable: makeDeliverable({ status: "archived" }),
      artifacts: [hero, webpage],
      latestValidationByArtifactId: { "wp-1": makePassingValidation("wp-1") },
    });

    const result = evaluateDeliverableReadiness(fullyCompleteArchived);
    expect(result.excluded).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.checks).toEqual([]);

    // Sanity: the exact same input with status flipped back to "approved"
    // WOULD be ready, proving the fixture is genuinely complete and it is
    // archived status alone that suppresses it.
    const nonArchivedResult = evaluateDeliverableReadiness(
      makeInput({ ...fullyCompleteArchived, deliverable: makeDeliverable({ status: "approved" }) }),
    );
    expect(nonArchivedResult.excluded).toBe(false);
    expect(nonArchivedResult.ready).toBe(true);
  });
});

describe("security: resolveRequirements never returns an empty array for a known role", () => {
  const KNOWN_ROLES: DeliverableRole[] = ["article", "social_post", "gbp_post", "lead_magnet_pdf", "landing_page"];

  it("returns at least one requirement for every known role with no overrides set", () => {
    for (const role of KNOWN_ROLES) {
      const reqs = resolveRequirements(
        makeDeliverable({ deliverable_role: role, requires_legal_approval: null, requires_image: null, requires_file: null, requires_localized_route: null }),
      );
      expect(reqs.length).toBeGreaterThan(0);
    }
  });

  it("stays non-empty for every known role even when every requires_* override is explicitly set to false", () => {
    // An override flips a requirement's `blocking` flag; it must never
    // remove the requirement from the list (that would silently disappear
    // the check instead of surfacing it as "not_required").
    for (const role of KNOWN_ROLES) {
      const reqs = resolveRequirements(
        makeDeliverable({
          deliverable_role: role,
          requires_legal_approval: false,
          requires_image: false,
          requires_file: false,
          requires_localized_route: false,
        }),
      );
      expect(reqs.length).toBeGreaterThan(0);
      // role_and_locale_known is never overridable and must always survive.
      expect(reqs.some((r) => r.key === "role_and_locale_known" && r.blocking)).toBe(true);
    }
  });

  it("stays non-empty for every known role at a non-default locale with requires_localized_route=true", () => {
    for (const role of KNOWN_ROLES) {
      const reqs = resolveRequirements(makeDeliverable({ deliverable_role: role, locale: "pt-BR", requires_localized_route: true }));
      expect(reqs.length).toBeGreaterThan(0);
    }
  });

  it("an empty requirement list would be a fail-open bug: confirm a deliverable with zero requirements would vacuously read as ready (documents why this must never happen)", () => {
    // This test does not call resolveRequirements with a real role (that path
    // is proven non-empty above). It directly constructs the pathological
    // input to document the failure mode the other tests in this file guard
    // against: if a role's profile ever collapsed to [], every requirement
    // in that empty set trivially "passes" and the deliverable reads ready.
    const result = evaluateDeliverableReadiness(
      makeInput({
        deliverable: makeDeliverable({ deliverable_role: null }),
      }),
    );
    // With no role set, resolveRequirements degrades to a single check
    // (role_and_locale_known), not an empty list — so this still fails
    // closed, not open. That single check is exactly the guard that would
    // be lost if resolveRequirements' null-role fallback were ever changed
    // to return [].
    expect(result.ready).toBe(false);
    expect(result.missingRequirements).toContain("role_and_locale_known");
  });
});
