/**
 * Pure-core coverage for the Canonical Publication Packet
 * (publication-packet.ts). Every test here traces to a specific friction
 * or requirement in the 2026-07-22 DRG Law calibration report -- see each
 * describe block's own comment for which one.
 */
import { describe, it, expect } from "vitest";
import type { ContentDeliverable, ContentPlacement, DeliverableVersion, PublicationArtifact, PublicationReceipt } from "@/lib/types";
import {
  htmlToPlainText,
  assemblePublicationPacket,
  resolveCta,
  resolveImageForPacket,
  checkDraftReleaseControl,
  classifyEvidence,
  checkCanonicalRecordMismatch,
  checkReadinessRequirements,
  type AssemblePublicationPacketInput,
} from "../publication-packet";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const DELIVERABLE_ID = "d1111111-1111-1111-1111-111111111111";
const VERSION_ID = "v1111111-1111-1111-1111-111111111111";
const PLACEMENT_ID = "p1111111-1111-1111-1111-111111111111";

function makeDeliverable(overrides: Partial<ContentDeliverable> = {}): ContentDeliverable {
  return {
    id: DELIVERABLE_ID,
    firm_id: FIRM_ID,
    title: "Renewal Clause: What Ontario Landlords Need to Know",
    description: null,
    content_kind: "text",
    status: "approved",
    current_version_id: VERSION_ID,
    approved_version_id: VERSION_ID,
    approved_at: new Date().toISOString(),
    created_by_role: "operator",
    created_by_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    excerpt: null,
    topic: null,
    byline: null,
    publish_date: null,
    read_time: null,
    hero_image_url: null,
    kicker: null,
    period_id: "period-1",
    format: null,
    locale: "en-CA",
    deliverable_role: "article",
    publication_destination: "firm_website",
    publication_path: "/journal/renewal-clause-ontario",
    cta_target_path: null,
    requires_legal_approval: null,
    requires_image: null,
    requires_file: null,
    requires_localized_route: null,
    ...overrides,
  } as ContentDeliverable;
}

function makeVersion(overrides: Partial<DeliverableVersion> = {}): DeliverableVersion {
  return {
    id: VERSION_ID,
    deliverable_id: DELIVERABLE_ID,
    firm_id: FIRM_ID,
    version_number: 1,
    body_html: "<p>Ontario landlords must provide <strong>60 days</strong> notice before a lease renewal.</p>",
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
    created_at: new Date().toISOString(),
    requires_individual_review: false,
    requires_individual_review_reason: null,
    requires_individual_review_set_by_role: null,
    requires_individual_review_set_by_id: null,
    requires_individual_review_set_by_name: null,
    requires_individual_review_set_at: null,
    ...overrides,
  } as DeliverableVersion;
}

function makePlacement(overrides: Partial<ContentPlacement> = {}): ContentPlacement {
  return {
    id: PLACEMENT_ID,
    firm_id: FIRM_ID,
    period_id: "period-1",
    deliverable_id: DELIVERABLE_ID,
    destination: "firm_website",
    locale: "en-CA",
    intended_path: "/journal/renewal-clause-ontario",
    required_artifact_type: "webpage",
    scheduled_publish_date: null,
    state: "ready",
    created_by_role: "operator",
    created_by_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as ContentPlacement;
}

function makeArtifact(overrides: Partial<PublicationArtifact> = {}): PublicationArtifact {
  return {
    id: "a1111111-1111-1111-1111-111111111111",
    firm_id: FIRM_ID,
    deliverable_id: DELIVERABLE_ID,
    version_id: VERSION_ID,
    artifact_type: "hero_image",
    locale: "en-CA",
    destination: "firm_website",
    storage_bucket: "firm-files",
    storage_path: "deliverables/hero/journal-renewal-clause-ontario-feature.png",
    public_url: "https://drglaw.ca/images/journal-renewal-clause-ontario-feature.png",
    repository: null,
    repository_path: null,
    deployment_commit: null,
    deployment_url: null,
    mime_type: "image/png",
    size_bytes: 12345,
    sha256: "a".repeat(64),
    validation_result: null,
    created_by_role: "operator",
    created_by_id: null,
    created_at: new Date().toISOString(),
    superseded_at: null,
    ...overrides,
  } as PublicationArtifact;
}

function makeReceipt(overrides: Partial<PublicationReceipt> = {}): PublicationReceipt {
  return {
    id: "r1111111-1111-1111-1111-111111111111",
    firm_id: FIRM_ID,
    period_id: "period-1",
    deliverable_id: DELIVERABLE_ID,
    placement_id: PLACEMENT_ID,
    destination: "firm_website",
    locale: "en-CA",
    approved_version_id: VERSION_ID,
    claim_id: null,
    artifact_id: null,
    artifact_sha256: null,
    public_url: null,
    external_post_id: null,
    published_at: new Date().toISOString(),
    actor_role: "operator",
    actor_id: null,
    actor_name: "Operator",
    verification_state: "verified",
    verified_at: new Date().toISOString(),
    verification_method: "manual_screenshot",
    evidence_storage_bucket: null,
    evidence_storage_path: null,
    failure_reason: null,
    reconciles_receipt_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as PublicationReceipt;
}

const WEBPAGE_ARTIFACT_ID = "a2222222-2222-2222-2222-222222222222";

function makeWebpageArtifact(overrides: Partial<PublicationArtifact> = {}): PublicationArtifact {
  return makeArtifact({
    id: WEBPAGE_ARTIFACT_ID,
    artifact_type: "webpage",
    public_url: "https://drglaw.ca/journal/renewal-clause-ontario",
    storage_path: null,
    ...overrides,
  });
}

/**
 * Article role's real requirement profile (publication-requirements.ts's
 * ARTICLE spec) needs a validated webpage artifact for the current
 * version/locale, not just a hero image -- basePacketInput's fixtures
 * must satisfy that for real-readiness ("readyToPublish=true") scenarios
 * to mean anything, rather than accidentally testing readiness.ready=false
 * every time (2026-07-22 audit follow-up: this gap was invisible while no
 * test asserted readyToPublish directly).
 */
function basePacketInput(overrides: Partial<AssemblePublicationPacketInput> = {}): AssemblePublicationPacketInput {
  const heroArtifact = makeArtifact();
  const webpageArtifact = makeWebpageArtifact();
  const artifacts = [heroArtifact, webpageArtifact];
  return {
    deliverable: makeDeliverable(),
    currentVersion: makeVersion(),
    placement: makePlacement(),
    artifacts,
    readinessInput: {
      currentVersion: makeVersion(),
      artifacts,
      latestValidationByArtifactId: {
        [WEBPAGE_ARTIFACT_ID]: {
          id: "val-1",
          artifact_id: WEBPAGE_ARTIFACT_ID,
          firm_id: FIRM_ID,
          validator: "route_check",
          result: "pass",
          details: null,
          validated_by_role: "system",
          validated_by_id: null,
          created_at: new Date().toISOString(),
        },
      },
    },
    standingAuthorizationActive: false,
    ctaRequired: false,
    ctaLabel: null,
    ctaHttpCheckPassed: null,
    currentReceipt: null,
    ...overrides,
  };
}

// ─── Verbatim copy (calibration friction #8) ────────────────────────────

describe("copy is verbatim -- format conversion only, never content change", () => {
  it("bodyHtmlVerbatim is byte-identical to the version's body_html", () => {
    const html = "<p>Exact approved wording, never altered.</p>";
    const packet = assemblePublicationPacket(basePacketInput({ currentVersion: makeVersion({ body_html: html }) }));
    expect(packet.copy.bodyHtmlVerbatim).toBe(html);
  });

  it("htmlToPlainText adds no word, link, hashtag, or emoji not already present as text", () => {
    const html = "<p>Ontario landlords must provide <strong>60 days</strong> notice.</p>";
    const plain = htmlToPlainText(html);
    expect(plain).toBe("Ontario landlords must provide 60 days notice.");
    expect(plain).not.toMatch(/#\w/); // no hashtag introduced
    expect(plain).not.toMatch(/https?:\/\//); // no link introduced
    expect(plain).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u); // no emoji introduced
  });

  it("htmlToPlainText decodes entities without adding new words", () => {
    expect(htmlToPlainText("<p>Terms &amp; Conditions</p>")).toBe("Terms & Conditions");
  });

  it("title is transported verbatim from the deliverable's own title column", () => {
    const packet = assemblePublicationPacket(basePacketInput({ deliverable: makeDeliverable({ title: "Exact Approved Title" }) }));
    expect(packet.copy.title).toBe("Exact Approved Title");
  });
});

// ─── CTA (calibration friction #9) ──────────────────────────────────────

describe("CTA: required-but-null is a named blocker, never substituted", () => {
  it("ctaRequired=true, cta_target_path=null -> cta_missing blocker, never a substituted URL", () => {
    const { cta, check } = resolveCta({ id: DELIVERABLE_ID, cta_target_path: null }, true);
    expect(cta.targetPath).toBeNull();
    expect(check.pass).toBe(false);
    expect(check.blockerCode).toBe("cta_missing");
    expect(check.owningAsset).toBe(DELIVERABLE_ID);
  });

  it("ctaRequired=false, cta_target_path=null -> no blocker (CTA genuinely not needed for this destination)", () => {
    const { check } = resolveCta({ id: DELIVERABLE_ID, cta_target_path: null }, false);
    expect(check.pass).toBe(true);
  });

  it("cta_target_path present -> transported exactly, never rewritten", () => {
    const { cta } = resolveCta({ id: DELIVERABLE_ID, cta_target_path: "/journal/good-standing-clause-ontario" }, true);
    expect(cta.targetPath).toBe("/journal/good-standing-clause-ontario");
  });

  it("ctaLabel is never invented -- null unless explicitly supplied by the caller", () => {
    const { cta } = resolveCta({ id: DELIVERABLE_ID, cta_target_path: "/journal/x" }, true, null);
    expect(cta.label).toBeNull();
  });
});

// ─── Image / rendition role (calibration friction #3) ───────────────────

describe("Image: wrong-role or missing artifact is a named blocker, never accepted", () => {
  it("firm_website destination requires a hero_image; a social_image on record does not satisfy it", () => {
    const { image, check } = resolveImageForPacket(
      makeDeliverable(),
      makeVersion(),
      makePlacement({ destination: "firm_website" }),
      [makeArtifact({ artifact_type: "social_image" })],
    );
    expect(image).toBeNull();
    expect(check.pass).toBe(false);
    expect(check.blockerCode).toBe("no_matching_image_artifact");
  });

  it("no image artifact at all -> no_matching_image_artifact blocker", () => {
    const { image, check } = resolveImageForPacket(makeDeliverable(), makeVersion(), makePlacement(), []);
    expect(image).toBeNull();
    expect(check.pass).toBe(false);
  });

  it("correct-role artifact, exact firm/deliverable/version/locale match -> resolved, no blocker", () => {
    const { image, check } = resolveImageForPacket(makeDeliverable(), makeVersion(), makePlacement(), [makeArtifact()]);
    expect(image).not.toBeNull();
    expect(check.pass).toBe(true);
  });

  it("email_delivery destination has no rendition-role requirement -> no blocker, no image required", () => {
    const { image, check } = resolveImageForPacket(
      makeDeliverable(),
      makeVersion(),
      makePlacement({ destination: "email_delivery" }),
      [],
    );
    expect(image).toBeNull();
    expect(check.pass).toBe(true);
  });

  it("an image artifact belonging to a DIFFERENT deliverable is never picked up, even if type/version/locale match", () => {
    const otherDeliverableArtifact = makeArtifact({ deliverable_id: "OTHER_DELIVERABLE" });
    const { image, check } = resolveImageForPacket(makeDeliverable(), makeVersion(), makePlacement(), [otherDeliverableArtifact]);
    expect(image).toBeNull();
    expect(check.pass).toBe(false);
  });
});

// ─── draft_release_control ───────────────────────────────────────────────

describe("draft_release_control: draft/watermarked/failed assets never enter a packet", () => {
  it("artifact flagged draft in validation_result -> blocker, image excluded from a clean packet even though it otherwise matches", () => {
    const draftArtifact = makeArtifact({ validation_result: { draft: true } });
    const image = { artifactId: draftArtifact.id, fileName: "hero.png", storageOrPublicUrl: null };
    const check = checkDraftReleaseControl(makeVersion(), image, [draftArtifact], DELIVERABLE_ID);
    expect(check.pass).toBe(false);
    expect(check.blockerCode).toBe("draft_or_unauthorized_asset");
    expect(check.owningAsset).toBe(draftArtifact.id);
  });

  it("artifact flagged watermarked -> blocker", () => {
    const watermarked = makeArtifact({ validation_result: { watermarked: true } });
    const image = { artifactId: watermarked.id, fileName: "hero.png", storageOrPublicUrl: null };
    const check = checkDraftReleaseControl(makeVersion(), image, [watermarked], DELIVERABLE_ID);
    expect(check.pass).toBe(false);
  });

  it("current version's own asset_validation flagged draft -> blocker even with no image at all", () => {
    const draftVersion = makeVersion({ asset_validation: { draft: true } });
    const check = checkDraftReleaseControl(draftVersion, null, [], DELIVERABLE_ID);
    expect(check.pass).toBe(false);
    expect(check.blockerCode).toBe("draft_or_unauthorized_asset");
  });

  it("clean artifact, no draft/watermark flags -> passes", () => {
    const check = checkDraftReleaseControl(makeVersion(), { artifactId: "a1", fileName: "x", storageOrPublicUrl: null }, [makeArtifact()], DELIVERABLE_ID);
    expect(check.pass).toBe(true);
  });
});

// ─── readiness_requirements (2026-07-22 audit follow-up: partition-leak fix) ─

describe("readiness_requirements: a readiness-evaluator-only failure is a named, reasoned check", () => {
  it("readiness.ready=true -> passes", () => {
    const check = checkReadinessRequirements({ ready: true }, DELIVERABLE_ID);
    expect(check.pass).toBe(true);
  });

  it("readiness.ready=false with missingRequirements -> fails, blockerCode readiness_requirements_unmet, reason names the exact missing keys", () => {
    const check = checkReadinessRequirements({ ready: false, missingRequirements: ["webpage_artifact", "webpage_validated"] }, DELIVERABLE_ID);
    expect(check.pass).toBe(false);
    expect(check.blockerCode).toBe("readiness_requirements_unmet");
    expect(check.reason).toContain("webpage_artifact");
    expect(check.reason).toContain("webpage_validated");
    expect(check.owningAsset).toBe(DELIVERABLE_ID);
  });

  it("readiness.ready=false with no missingRequirements field (the archived-deliverable shape) -> fails with an explicit archived/excluded reason, never a blank one", () => {
    const check = checkReadinessRequirements({ ready: false }, DELIVERABLE_ID);
    expect(check.pass).toBe(false);
    expect(check.reason).toBeTruthy();
    expect(check.reason).toMatch(/archived|excluded/);
  });
});

// ─── Approval never implies published (calibration friction #1, #11) ────

describe("legal_authorized never implies published -- publication requires independent evidence", () => {
  it("fully legal_authorized, ready, but no receipt at all -> published=false, readyToPublish=true, needsAttention=false (awaiting publication is not a defect)", () => {
    const packet = assemblePublicationPacket(basePacketInput({ currentReceipt: null }));
    expect(packet.legalAuthorized).toBe(true);
    expect(packet.published).toBe(false);
    expect(packet.readyToPublish).toBe(true);
    expect(packet.needsAttention).toBe(false);
  });

  it("legal_authorized=true does not set published=true even when everything else is clean", () => {
    const packet = assemblePublicationPacket(basePacketInput({}));
    expect(packet.legalAuthorized).toBe(true);
    expect(packet.published).toBe(false);
    expect(packet.checks.find((c) => c.name === "publication_proof")?.pass).toBe(false);
  });

  it("exists on the website (canonicalPublicationPath set) is never read as proof of publication on its own", () => {
    const packet = assemblePublicationPacket(basePacketInput({ deliverable: makeDeliverable({ publication_path: "/journal/renewal-clause-ontario" }) }));
    expect(packet.identity.canonicalPublicationPath).toBe("/journal/renewal-clause-ontario");
    expect(packet.published).toBe(false);
  });
});

// ─── Evidence levels (calibration friction #11) ─────────────────────────

describe("classifyEvidence: exactly the three levels, mapped onto existing receipt fields, verified state required", () => {
  it("external_post_id present, verified -> direct_api_receipt", () => {
    const evidence = classifyEvidence(makeReceipt({ external_post_id: "urn:li:post:123", verification_state: "verified" }));
    expect(evidence?.level).toBe("direct_api_receipt");
  });

  it("public_url present (no external_post_id), verified -> verified_public_url", () => {
    const evidence = classifyEvidence(makeReceipt({ public_url: "https://drglaw.ca/journal/renewal-clause-ontario", external_post_id: null, verification_state: "verified" }));
    expect(evidence?.level).toBe("verified_public_url");
  });

  it("operator actor, no external_post_id, no public_url, verified -> operator_confirmation", () => {
    const evidence = classifyEvidence(makeReceipt({ external_post_id: null, public_url: null, actor_role: "operator", verification_state: "verified" }));
    expect(evidence?.level).toBe("operator_confirmation");
  });

  it("no receipt at all -> null, never a default level", () => {
    expect(classifyEvidence(null)).toBeNull();
  });

  it("receipt exists but verification_state is NOT verified -> null, none of the three levels satisfied", () => {
    const evidence = classifyEvidence(makeReceipt({ external_post_id: "urn:li:post:123", verification_state: "unverified" }));
    expect(evidence).toBeNull();
  });

  it("each of the three evidence levels, when present, sets packet.published=true", () => {
    for (const overrides of [
      { external_post_id: "urn:li:post:1" },
      { external_post_id: null, public_url: "https://drglaw.ca/x" },
      { external_post_id: null, public_url: null, actor_role: "operator" as const },
    ]) {
      const packet = assemblePublicationPacket(basePacketInput({ currentReceipt: makeReceipt(overrides) }));
      expect(packet.published).toBe(true);
      expect(packet.evidence).not.toBeNull();
    }
  });
});

// ─── Dates (calibration friction #7) ─────────────────────────────────────

describe("dates: scheduled_for and published_at are separate, never conflated", () => {
  it("a scheduled-but-not-yet-published placement never surfaces a publishedAt value", () => {
    const packet = assemblePublicationPacket(
      basePacketInput({
        placement: makePlacement({ scheduled_publish_date: "2026-07-25" }),
        currentReceipt: null,
      }),
    );
    expect(packet.dates.scheduledFor).toBe("2026-07-25");
    expect(packet.dates.publishedAt).toBeNull();
  });

  it("published_at is populated ONLY from an actual receipt's published_at, never from scheduled_publish_date", () => {
    const receipt = makeReceipt({ published_at: "2026-07-22T12:00:00Z" });
    const packet = assemblePublicationPacket(
      basePacketInput({
        placement: makePlacement({ scheduled_publish_date: "2026-07-20" }),
        currentReceipt: receipt,
      }),
    );
    expect(packet.dates.scheduledFor).toBe("2026-07-20");
    expect(packet.dates.publishedAt).toBe("2026-07-22T12:00:00Z");
    expect(packet.dates.publishedAt).not.toBe(packet.dates.scheduledFor);
  });
});

// ─── canonical_record_mismatch (calibration friction #4) ────────────────

describe("canonical_record_mismatch: every field must resolve to the same deliverable id", () => {
  it("placement.deliverable_id different from the packet's deliverable -> blocker", () => {
    const check = checkCanonicalRecordMismatch(
      makeDeliverable(),
      null,
      [],
      { deliverable_id: "SOME_OTHER_DELIVERABLE" },
    );
    expect(check.pass).toBe(false);
    expect(check.blockerCode).toBe("canonical_record_mismatch");
  });

  it("hero image artifact belonging to a different deliverable than the packet -> blocker (Clause in the Margin class of bug)", () => {
    const wrongArtifact = makeArtifact({ id: "wrong-artifact", deliverable_id: "GOOD_STANDING_DELIVERABLE" });
    const image = { artifactId: "wrong-artifact", fileName: "x.png", storageOrPublicUrl: null };
    const check = checkCanonicalRecordMismatch(makeDeliverable(), image, [wrongArtifact], { deliverable_id: DELIVERABLE_ID });
    expect(check.pass).toBe(false);
    expect(check.blockerCode).toBe("canonical_record_mismatch");
  });

  it("everything aligned to the same deliverable id -> passes", () => {
    const artifact = makeArtifact();
    const image = { artifactId: artifact.id, fileName: "x.png", storageOrPublicUrl: null };
    const check = checkCanonicalRecordMismatch(makeDeliverable(), image, [artifact], { deliverable_id: DELIVERABLE_ID });
    expect(check.pass).toBe(true);
  });
});

// ─── Named checks (calibration: "name the exact failed check and asset") ─

describe("every failed check names itself and its owning asset -- never a generic blocked label", () => {
  it("a packet with multiple simultaneous failures reports EACH check by name with its own reason and asset", () => {
    const packet = assemblePublicationPacket(
      basePacketInput({
        deliverable: makeDeliverable({ status: "draft", approved_version_id: null }),
        artifacts: [],
        readinessInput: { currentVersion: makeVersion(), artifacts: [], latestValidationByArtifactId: {} },
        ctaRequired: true,
      }),
    );
    const failed = packet.checks.filter((c) => !c.pass);
    expect(failed.length).toBeGreaterThan(1);
    for (const check of failed) {
      expect(check.reason).toBeTruthy();
      expect(check.blockerCode).not.toBeNull();
      expect(check.name).toBeTruthy();
    }
    // Distinct check names, not one generic repeated blocker
    const names = new Set(failed.map((c) => c.name));
    expect(names.size).toBeGreaterThan(1);
  });

  it("needsAttention is true whenever any check fails and the packet is not published", () => {
    const packet = assemblePublicationPacket(basePacketInput({ artifacts: [] }));
    expect(packet.checks.some((c) => !c.pass)).toBe(true);
    expect(packet.needsAttention).toBe(true);
  });

  it("needsAttention is false once published, even if some non-blocking check state exists historically", () => {
    const packet = assemblePublicationPacket(basePacketInput({ currentReceipt: makeReceipt() }));
    expect(packet.published).toBe(true);
    expect(packet.needsAttention).toBe(false);
  });
});

// ─── State exclusivity invariant (2026-07-22 audit follow-up) ───────────

describe("state exclusivity: published XOR readyToPublish XOR needsAttention, always", () => {
  function narrativeCount(packet: ReturnType<typeof assemblePublicationPacket>): number {
    return [packet.published, packet.readyToPublish, packet.needsAttention].filter(Boolean).length;
  }

  it("clean, unpublished packet -> readyToPublish=true, the ONLY true narrative", () => {
    const packet = assemblePublicationPacket(basePacketInput({ currentReceipt: null }));
    expect(narrativeCount(packet)).toBe(1);
    expect(packet.readyToPublish).toBe(true);
  });

  it("published packet -> published=true, the ONLY true narrative (readyToPublish is never also true)", () => {
    const packet = assemblePublicationPacket(basePacketInput({ currentReceipt: makeReceipt() }));
    expect(narrativeCount(packet)).toBe(1);
    expect(packet.published).toBe(true);
  });

  it("a genuinely blocked (non-proof check failing) packet -> needsAttention=true, the ONLY true narrative", () => {
    const packet = assemblePublicationPacket(basePacketInput({ artifacts: [] }));
    expect(narrativeCount(packet)).toBe(1);
    expect(packet.needsAttention).toBe(true);
  });

  it("archived deliverable, no receipt -> exactly one narrative true (needsAttention, readiness excluded)", () => {
    const packet = assemblePublicationPacket(basePacketInput({ deliverable: makeDeliverable({ status: "archived" }), currentReceipt: null }));
    expect(narrativeCount(packet)).toBe(1);
  });

  it("READINESS-ONLY failure (2026-07-22 audit follow-up, the exact leak a probe test found): hero image bound (every packet check passes) but NO webpage artifact deployed -- previously published=false, readyToPublish=false, needsAttention=false all at once (a fourth, silent, unnamed state). Now needsAttention=true, the ONLY true narrative, with a named reason.", () => {
    const heroOnly = [makeArtifact()]; // artifact_type: "hero_image" by default -- no "webpage" artifact at all
    const packet = assemblePublicationPacket(
      basePacketInput({
        artifacts: heroOnly,
        readinessInput: { currentVersion: makeVersion(), artifacts: heroOnly, latestValidationByArtifactId: {} },
        currentReceipt: null,
      }),
    );
    // Every packet-level check (asset_exists_and_role_ok included -- firm_website
    // only requires a hero_image for its rendition role) passes on its own.
    expect(packet.checks.filter((c) => c.name === "asset_exists_and_role_ok")[0]?.pass).toBe(true);
    // The narrative that used to vanish is now exactly one, named, and reasoned.
    expect(narrativeCount(packet)).toBe(1);
    expect(packet.published).toBe(false);
    expect(packet.readyToPublish).toBe(false);
    expect(packet.needsAttention).toBe(true);
    const readinessCheck = packet.checks.find((c) => c.name === "readiness_requirements");
    expect(readinessCheck?.pass).toBe(false);
    expect(readinessCheck?.blockerCode).toBe("readiness_requirements_unmet");
    expect(readinessCheck?.reason).toContain("webpage_artifact");
  });
});

describe("check names: no two checks in one packet share a name", () => {
  it("a packet exercising every check still produces unique check names", () => {
    const packet = assemblePublicationPacket(
      basePacketInput({
        deliverable: makeDeliverable({ status: "draft", approved_version_id: null }),
        artifacts: [],
        readinessInput: { currentVersion: makeVersion(), artifacts: [], latestValidationByArtifactId: {} },
        ctaRequired: true,
      }),
    );
    const names = packet.checks.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("canonical_record is its own named check, distinct from asset_exists_and_role_ok", () => {
    const packet = assemblePublicationPacket(basePacketInput({}));
    const canonicalCheck = packet.checks.find((c) => c.name === "canonical_record");
    const assetCheck = packet.checks.find((c) => c.name === "asset_exists_and_role_ok");
    expect(canonicalCheck).toBeDefined();
    expect(assetCheck).toBeDefined();
    expect(canonicalCheck).not.toBe(assetCheck);
  });
});
