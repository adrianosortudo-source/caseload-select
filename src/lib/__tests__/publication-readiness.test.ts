import { describe, it, expect } from "vitest";
import {
  evaluateDeliverableReadiness,
  evaluatePeriodReadiness,
  sliceReadinessForPeriod,
  deriveDisplayState,
  evaluateActivationPreflight,
  summarizeDisplayStates,
  type EvaluateReadinessInput,
} from "../publication-readiness";
import { resolveRequirements, profileForRole } from "../publication-requirements";
import type { ContentDeliverable, DeliverableVersion, PublicationArtifact, PublicationArtifactValidation } from "../types";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const CURRENT_VERSION_ID = "v2222222-2222-2222-2222-222222222222";
const OLDER_VERSION_ID = "v1111111-1111-1111-1111-111111111111";

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

describe("publication-requirements: profileForRole", () => {
  it("returns a distinct, non-empty profile for every role", () => {
    const roles = ["article", "social_post", "gbp_post", "lead_magnet_pdf", "landing_page"] as const;
    for (const role of roles) {
      const profile = profileForRole(role);
      expect(profile.length).toBeGreaterThan(0);
      expect(profile.every((r) => r.blocking)).toBe(true);
    }
  });

  it("gbp_post requires a publish schedule, social_post does not", () => {
    expect(profileForRole("gbp_post").some((r) => r.key === "publish_schedule_set")).toBe(true);
    expect(profileForRole("social_post").some((r) => r.key === "publish_schedule_set")).toBe(false);
  });
});

describe("publication-requirements: resolveRequirements overrides", () => {
  it("falls back to just role_and_locale_known when deliverable_role is unset", () => {
    const reqs = resolveRequirements(makeDeliverable({ deliverable_role: null }));
    expect(reqs).toEqual([{ key: "role_and_locale_known", label: expect.any(String), blocking: true }]);
  });

  it("requires_image=false marks hero_image as not_required", () => {
    const reqs = resolveRequirements(makeDeliverable({ requires_image: false }));
    const heroReq = reqs.find((r) => r.key === "hero_image");
    expect(heroReq?.blocking).toBe(false);
  });

  it("localized_route defaults to not blocking at the default locale (en-CA)", () => {
    const reqs = resolveRequirements(makeDeliverable({ locale: "en-CA" }));
    expect(reqs.find((r) => r.key === "localized_route")?.blocking).toBe(false);
  });

  it("localized_route defaults to blocking at a non-default locale (pt-BR)", () => {
    const reqs = resolveRequirements(makeDeliverable({ locale: "pt-BR" }));
    expect(reqs.find((r) => r.key === "localized_route")?.blocking).toBe(true);
  });

  it("an explicit requires_localized_route=true forces it blocking even at the default locale", () => {
    const reqs = resolveRequirements(makeDeliverable({ locale: "en-CA", requires_localized_route: true }));
    expect(reqs.find((r) => r.key === "localized_route")?.blocking).toBe(true);
  });
});

describe("evaluateDeliverableReadiness: archived exclusion", () => {
  it("returns excluded=true, ready=false, no checks for an archived deliverable", () => {
    const result = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ status: "archived" }) }));
    expect(result.excluded).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.checks).toEqual([]);
  });
});

describe("evaluateDeliverableReadiness: role/locale unknown fails closed", () => {
  it("fails role_and_locale_known and is not ready", () => {
    const result = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ deliverable_role: null }) }));
    expect(result.ready).toBe(false);
    expect(result.missingRequirements).toContain("role_and_locale_known");
  });
});

describe("evaluateDeliverableReadiness: approval binding", () => {
  it("passes current_version_approved when approved_version_id equals current_version_id", () => {
    const result = evaluateDeliverableReadiness(makeInput());
    const check = result.checks.find((c) => c.key === "current_version_approved");
    expect(check?.status).toBe("pass");
  });

  it("fails current_version_approved when the current version has never been approved", () => {
    const result = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ approved_version_id: null }) }),
    );
    const check = result.checks.find((c) => c.key === "current_version_approved");
    expect(check?.status).toBe("fail");
    expect(check?.reason).toMatch(/not been formally approved/);
    expect(result.ready).toBe(false);
  });

  it("fails current_version_approved when approval is on an OLDER version than current", () => {
    const result = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ approved_version_id: OLDER_VERSION_ID, current_version_id: CURRENT_VERSION_ID }) }),
    );
    const check = result.checks.find((c) => c.key === "current_version_approved");
    expect(check?.status).toBe("fail");
    expect(check?.reason).toMatch(/is not the current version/);
    expect(result.ready).toBe(false);
  });
});

describe("evaluateDeliverableReadiness: artifact version-pinning and staleness", () => {
  it("passes hero_image when the artifact is bound to the CURRENT version", () => {
    const artifact = makeArtifact({ version_id: CURRENT_VERSION_ID });
    const result = evaluateDeliverableReadiness(makeInput({ artifacts: [artifact] }));
    expect(result.checks.find((c) => c.key === "hero_image")?.status).toBe("pass");
  });

  it("fails hero_image and reports staleness when the artifact is bound to an OLDER version", () => {
    const artifact = makeArtifact({ version_id: OLDER_VERSION_ID });
    const result = evaluateDeliverableReadiness(makeInput({ artifacts: [artifact] }));
    const check = result.checks.find((c) => c.key === "hero_image");
    expect(check?.status).toBe("fail");
    expect(check?.evidence?.versionId).toBe(OLDER_VERSION_ID);
    expect(result.staleArtifacts).toContain("hero_image");
  });

  it("fails hero_image with no staleness evidence when no artifact exists at all", () => {
    const result = evaluateDeliverableReadiness(makeInput({ artifacts: [] }));
    const check = result.checks.find((c) => c.key === "hero_image");
    expect(check?.status).toBe("fail");
    expect(check?.evidence).toBeUndefined();
    expect(result.staleArtifacts).not.toContain("hero_image");
  });
});

describe("evaluateDeliverableReadiness: webpage + validation", () => {
  it("fails webpage_validated when the webpage artifact has no passing validation on record", () => {
    const webpage = makeArtifact({ id: "wp-1", artifact_type: "webpage", version_id: CURRENT_VERSION_ID, locale: "en-CA" });
    const result = evaluateDeliverableReadiness(makeInput({ artifacts: [webpage] }));
    expect(result.checks.find((c) => c.key === "webpage_validated")?.status).toBe("fail");
  });

  it("passes webpage_validated once its latest validation result is pass", () => {
    const webpage = makeArtifact({ id: "wp-1", artifact_type: "webpage", version_id: CURRENT_VERSION_ID, locale: "en-CA" });
    const result = evaluateDeliverableReadiness(
      makeInput({ artifacts: [webpage], latestValidationByArtifactId: { "wp-1": makePassingValidation("wp-1") } }),
    );
    expect(result.checks.find((c) => c.key === "webpage_validated")?.status).toBe("pass");
  });
});

describe("evaluateDeliverableReadiness: localized route (PT gap)", () => {
  it("fails localized_route for a pt-BR article with no pt-BR webpage artifact, even if an en-CA one exists", () => {
    const enWebpage = makeArtifact({ id: "wp-en", artifact_type: "webpage", version_id: CURRENT_VERSION_ID, locale: "en-CA" });
    const result = evaluateDeliverableReadiness(
      makeInput({
        deliverable: makeDeliverable({ locale: "pt-BR", publication_path: null }),
        artifacts: [enWebpage],
      }),
    );
    const check = result.checks.find((c) => c.key === "localized_route");
    expect(check?.status).toBe("fail");
    expect(check?.reason).toMatch(/pt-BR content exists, but the localized webpage artifact is missing/);
    expect(result.ready).toBe(false);
  });

  it("passes localized_route once a pt-BR webpage artifact exists bound to the current version", () => {
    const ptWebpage = makeArtifact({ id: "wp-pt", artifact_type: "webpage", version_id: CURRENT_VERSION_ID, locale: "pt-BR" });
    const result = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ locale: "pt-BR" }), artifacts: [ptWebpage] }),
    );
    expect(result.checks.find((c) => c.key === "localized_route")?.status).toBe("pass");
  });
});

describe("evaluateDeliverableReadiness: lead_magnet_pdf profile", () => {
  it("fails pdf_artifact when neither deliverable_versions nor publication_artifacts carries the file", () => {
    const result = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ deliverable_role: "lead_magnet_pdf", content_kind: "pdf" }) }),
    );
    expect(result.checks.find((c) => c.key === "pdf_artifact")?.status).toBe("fail");
    expect(result.ready).toBe(false);
  });

  it("passes pdf_artifact/pdf_bytes_bound/pdf_validated when deliverable_versions carries a fully-bound, validated asset (the shipped pdf_artifact_integrity path)", () => {
    const version = makeVersion({
      storage_path: "resources/founder-vesting-checklist.pdf",
      asset_mime: "application/pdf",
      asset_size_bytes: 164381,
      asset_sha256: "b".repeat(64),
      asset_validation: { profile: "drg_accessible_pdf_v1", checks: ["tagged", "language"] },
    });
    const result = evaluateDeliverableReadiness(
      makeInput({
        deliverable: makeDeliverable({ deliverable_role: "lead_magnet_pdf", content_kind: "pdf" }),
        currentVersion: version,
      }),
    );
    expect(result.checks.find((c) => c.key === "pdf_artifact")?.status).toBe("pass");
    expect(result.checks.find((c) => c.key === "pdf_bytes_bound")?.status).toBe("pass");
    expect(result.checks.find((c) => c.key === "pdf_validated")?.status).toBe("pass");
  });

  it("reports the version-3-vs-version-4 staleness case explicitly when the pdf artifact belongs to an older version", () => {
    const staleArtifact = makeArtifact({ id: "pdf-1", artifact_type: "pdf", version_id: OLDER_VERSION_ID });
    const result = evaluateDeliverableReadiness(
      makeInput({
        deliverable: makeDeliverable({ deliverable_role: "lead_magnet_pdf", content_kind: "pdf" }),
        artifacts: [staleArtifact],
      }),
    );
    const check = result.checks.find((c) => c.key === "pdf_artifact");
    expect(check?.status).toBe("fail");
    expect(check?.reason).toMatch(/Regenerate and reapprove the PDF/);
  });
});

describe("evaluateDeliverableReadiness: gbp_post profile", () => {
  it("fails publish_schedule_set when publish_date is null", () => {
    const image = makeArtifact({ artifact_type: "social_image" });
    const result = evaluateDeliverableReadiness(
      makeInput({
        deliverable: makeDeliverable({ deliverable_role: "gbp_post", publication_destination: "google_business_profile", publish_date: null }),
        artifacts: [image],
      }),
    );
    expect(result.checks.find((c) => c.key === "publish_schedule_set")?.status).toBe("fail");
    expect(result.ready).toBe(false);
  });
});

describe("evaluateDeliverableReadiness: fully complete deliverable is ready", () => {
  it("is ready when every blocking requirement passes", () => {
    const hero = makeArtifact({ id: "hero-1", artifact_type: "hero_image", version_id: CURRENT_VERSION_ID, locale: "en-CA" });
    const webpage = makeArtifact({ id: "wp-1", artifact_type: "webpage", version_id: CURRENT_VERSION_ID, locale: "en-CA", public_url: "https://drglaw.ca/journal/test" });
    const result = evaluateDeliverableReadiness(
      makeInput({
        artifacts: [hero, webpage],
        latestValidationByArtifactId: { "wp-1": makePassingValidation("wp-1") },
      }),
    );
    expect(result.ready).toBe(true);
    expect(result.missingRequirements).toEqual([]);
  });
});

describe("evaluatePeriodReadiness: summary counts", () => {
  it("counts active/ready/blocked/excluded correctly across a mixed week", () => {
    const readyHero = makeArtifact({ id: "hero-1", artifact_type: "hero_image", version_id: CURRENT_VERSION_ID });
    const readyWebpage = makeArtifact({ id: "wp-1", artifact_type: "webpage", version_id: CURRENT_VERSION_ID });
    const ready = makeInput({
      deliverable: makeDeliverable({ id: "ready-1" }),
      artifacts: [readyHero, readyWebpage],
      latestValidationByArtifactId: { "wp-1": makePassingValidation("wp-1") },
    });
    const blocked = makeInput({
      deliverable: makeDeliverable({ id: "blocked-1", approved_version_id: null }),
    });
    const excluded = makeInput({
      deliverable: makeDeliverable({ id: "excluded-1", status: "archived" }),
    });

    const { summary } = evaluatePeriodReadiness([ready, blocked, excluded]);
    expect(summary).toEqual({ active: 2, ready: 1, blocked: 1, excluded: 1 });
  });
});

describe("sliceReadinessForPeriod: real periodId threading (release-gate fix)", () => {
  it("returns only the items belonging to the requested period's deliverable ids", () => {
    const weekOne = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ id: "week1-piece" }) }));
    const weekTwo = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ id: "week2-piece", approved_version_id: null }) }),
    );

    const week1Slice = sliceReadinessForPeriod([weekOne, weekTwo], new Set(["week1-piece"]));

    expect(week1Slice.items).toHaveLength(1);
    expect(week1Slice.items[0].deliverableId).toBe("week1-piece");
    expect(week1Slice.items.map((i) => i.deliverableId)).not.toContain("week2-piece");
  });

  it("recomputes summary counts scoped to just that period, not the whole plan", () => {
    const hero = makeArtifact({ id: "hero-p1", artifact_type: "hero_image", version_id: CURRENT_VERSION_ID });
    const webpage = makeArtifact({ id: "wp-p1", artifact_type: "webpage", version_id: CURRENT_VERSION_ID });
    const readyInPeriod = evaluateDeliverableReadiness(
      makeInput({
        deliverable: makeDeliverable({ id: "p1-ready" }),
        artifacts: [hero, webpage],
        latestValidationByArtifactId: { "wp-p1": makePassingValidation("wp-p1") },
      }),
    );
    const blockedInPeriod = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ id: "p1-blocked", approved_version_id: null }) }),
    );
    const blockedInOtherPeriod = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ id: "p2-blocked", approved_version_id: null }) }),
    );

    const period1 = sliceReadinessForPeriod(
      [readyInPeriod, blockedInPeriod, blockedInOtherPeriod],
      new Set(["p1-ready", "p1-blocked"]),
    );

    // Whole-plan would show blocked:2; the period-1 slice must show blocked:1,
    // proving the per-week card is not silently reusing the whole-plan count.
    expect(period1.summary).toEqual({ active: 2, ready: 1, blocked: 1, excluded: 0 });
  });

  it("returns an empty, zeroed slice for a period with no matching deliverable ids", () => {
    const someOtherPeriodItem = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ id: "elsewhere" }) }));
    const empty = sliceReadinessForPeriod([someOtherPeriodItem], new Set(["this-period-has-nothing"]));
    expect(empty.items).toEqual([]);
    expect(empty.summary).toEqual({ active: 0, ready: 0, blocked: 0, excluded: 0 });
  });
});

// DR-097 (revised after review): explicit three-state period lifecycle.
// Regression coverage for TWO distinct bugs the first draft had:
// (1) every legacy period (deliverable_role/locale never backfilled)
// rendered as red "Blocked", indistinguishable from a genuine current
// publication blocker; (2) the first fix keyed display state off a single
// nullable timestamp, which wrongly labelled the CURRENT/future period
// (e.g. Founder Vesting, already fully metadata-complete) as "Historical",
// and made "Setup required" unreachable. This suite pins that a period
// explicitly classified "setup_required" (current/future/stalled work)
// renders differently from one explicitly classified
// "legacy_unreconciled", and that only "enforced" ever produces a genuine
// ready/blocked split.
describe("deriveDisplayState", () => {
  it("is 'excluded' for an archived deliverable regardless of lifecycle", () => {
    const archived = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ status: "archived" }) }));
    expect(deriveDisplayState(archived, "legacy_unreconciled")).toBe("excluded");
    expect(deriveDisplayState(archived, "setup_required")).toBe("excluded");
    expect(deriveDisplayState(archived, "enforced")).toBe("excluded");
  });

  it("is 'historical_unreconciled' ONLY for a period explicitly classified legacy_unreconciled", () => {
    const noMetadata = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ deliverable_role: null, locale: null }) }));
    expect(deriveDisplayState(noMetadata, "legacy_unreconciled")).toBe("historical_unreconciled");
  });

  it("is 'setup_required' for a setup_required period, never 'historical_unreconciled' -- this is the Founder Vesting case: current work, not legacy", () => {
    // Fully metadata-complete deliverable (matches Founder Vesting's real
    // state today) in a period that is current/active but not yet
    // activated. Must read as "needs activation", never "historical".
    const metadataComplete = evaluateDeliverableReadiness(makeInput());
    expect(deriveDisplayState(metadataComplete, "setup_required")).toBe("setup_required");
    expect(deriveDisplayState(metadataComplete, "setup_required")).not.toBe("historical_unreconciled");
  });

  it("is 'setup_required' for a setup_required period even when metadata is genuinely missing (Relocation Clause's un-backfilled case)", () => {
    const noMetadata = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ deliverable_role: null, locale: null }) }));
    expect(deriveDisplayState(noMetadata, "setup_required")).toBe("setup_required");
  });

  it("never returns 'blocked' for a period that is not enforced, regardless of how badly a deliverable fails", () => {
    // Missing hero_image/webpage_artifact/webpage_validated (a "genuine"
    // failure once enforced) must still read as calm "setup_required"
    // while the period itself has not been activated -- red "Blocked"
    // is reserved for enforced periods only.
    const wouldBeBlockedIfEnforced = evaluateDeliverableReadiness(makeInput());
    expect(deriveDisplayState(wouldBeBlockedIfEnforced, "legacy_unreconciled")).not.toBe("blocked");
    expect(deriveDisplayState(wouldBeBlockedIfEnforced, "setup_required")).not.toBe("blocked");
  });

  it("is 'blocked' for an enforced period when metadata is complete but a real requirement fails", () => {
    // Default makeInput() has full role/locale/destination metadata but no
    // artifacts, so hero_image/webpage_artifact/webpage_validated fail --
    // a genuine, current publication blocker, not a legacy metadata gap.
    const genuinelyBlocked = evaluateDeliverableReadiness(makeInput());
    expect(genuinelyBlocked.missingRequirements).not.toContain("role_and_locale_known");
    expect(deriveDisplayState(genuinelyBlocked, "enforced")).toBe("blocked");
  });

  it("is 'ready' for an enforced period when every requirement passes", () => {
    const hero = makeArtifact({ id: "hero-2", artifact_type: "hero_image", version_id: CURRENT_VERSION_ID, locale: "en-CA" });
    const webpage = makeArtifact({ id: "wp-2", artifact_type: "webpage", version_id: CURRENT_VERSION_ID, locale: "en-CA", public_url: "https://drglaw.ca/journal/test" });
    const fullyReady = evaluateDeliverableReadiness(
      makeInput({ artifacts: [hero, webpage], latestValidationByArtifactId: { "wp-2": makePassingValidation("wp-2") } }),
    );
    expect(deriveDisplayState(fullyReady, "enforced")).toBe("ready");
  });

  it("stays 'setup_required', not 'blocked', when a metadata-only failure survives into an enforced period (defense in depth)", () => {
    // resolveRequirements collapses to just [role_and_locale_known] when
    // deliverable_role is unset (publication-requirements.ts), so a
    // null-role deliverable's ONLY failing check is ever the metadata one.
    // The database trigger should make this state unreachable in practice
    // (it refuses to enforce a period with incomplete metadata), but the
    // pure function still fails calm, not alarming, if it ever occurs.
    const noMetadata = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ deliverable_role: null }) }));
    expect(deriveDisplayState(noMetadata, "enforced")).toBe("setup_required");
  });
});

describe("summarizeDisplayStates", () => {
  it("buckets a mixed set of items correctly for an enforced period", () => {
    const hero = makeArtifact({ id: "hero-3", artifact_type: "hero_image", version_id: CURRENT_VERSION_ID, locale: "en-CA" });
    const webpage = makeArtifact({ id: "wp-3", artifact_type: "webpage", version_id: CURRENT_VERSION_ID, locale: "en-CA", public_url: "https://drglaw.ca/journal/test" });
    const ready = evaluateDeliverableReadiness(
      makeInput({
        deliverable: makeDeliverable({ id: "ready-1" }),
        artifacts: [hero, webpage],
        latestValidationByArtifactId: { "wp-3": makePassingValidation("wp-3") },
      }),
    );
    const blocked = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ id: "blocked-1" }) }));
    const setupRequired = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ id: "setup-1", deliverable_role: null, locale: null }) }),
    );
    const archived = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ id: "archived-1", status: "archived" }) }));

    const counts = summarizeDisplayStates([ready, blocked, setupRequired, archived], "enforced");
    expect(counts).toEqual({ historicalUnreconciled: 0, setupRequired: 1, blocked: 1, ready: 1, excluded: 1 });
  });

  it("puts every non-excluded item into historical_unreconciled for a legacy_unreconciled period", () => {
    const blocked = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ id: "blocked-2" }) }));
    const setupRequired = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ id: "setup-2", deliverable_role: null }) }),
    );
    const counts = summarizeDisplayStates([blocked, setupRequired], "legacy_unreconciled");
    expect(counts).toEqual({ historicalUnreconciled: 2, setupRequired: 0, blocked: 0, ready: 0, excluded: 0 });
  });

  it("puts every non-excluded item into setup_required for a setup_required period -- proves it is NOT the same bucket as legacy_unreconciled", () => {
    const metadataComplete = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ id: "current-1" }) }));
    const metadataMissing = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ id: "current-2", deliverable_role: null }) }),
    );
    const counts = summarizeDisplayStates([metadataComplete, metadataMissing], "setup_required");
    expect(counts).toEqual({ historicalUnreconciled: 0, setupRequired: 2, blocked: 0, ready: 0, excluded: 0 });
  });
});

describe("evaluateActivationPreflight", () => {
  it("canActivate is true when every active deliverable has role/locale/destination set", () => {
    const complete1 = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ id: "c1" }) }));
    const complete2 = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ id: "c2" }) }));
    const preflight = evaluateActivationPreflight([complete1, complete2]);
    expect(preflight.canActivate).toBe(true);
    expect(preflight.blockingDeliverableIds).toEqual([]);
  });

  it("canActivate is false and lists the blocking ids when any active deliverable is missing metadata", () => {
    const complete = evaluateDeliverableReadiness(makeInput({ deliverable: makeDeliverable({ id: "c1" }) }));
    const incomplete = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ id: "incomplete-1", deliverable_role: null, locale: null }) }),
    );
    const preflight = evaluateActivationPreflight([complete, incomplete]);
    expect(preflight.canActivate).toBe(false);
    expect(preflight.blockingDeliverableIds).toEqual(["incomplete-1"]);
  });

  it("exempts archived deliverables from the preflight even with missing metadata", () => {
    const archivedIncomplete = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ id: "archived-incomplete", deliverable_role: null, status: "archived" }) }),
    );
    const preflight = evaluateActivationPreflight([archivedIncomplete]);
    expect(preflight.canActivate).toBe(true);
    expect(preflight.blockingDeliverableIds).toEqual([]);
  });

  it("also blocks activation when role/locale are set but publication_destination/path are not", () => {
    const noDestination = evaluateDeliverableReadiness(
      makeInput({ deliverable: makeDeliverable({ id: "no-dest", publication_destination: null, publication_path: null }) }),
    );
    const preflight = evaluateActivationPreflight([noDestination]);
    expect(preflight.canActivate).toBe(false);
    expect(preflight.blockingDeliverableIds).toEqual(["no-dest"]);
  });
});
