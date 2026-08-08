/**
 * publish-kit-pure.ts: pure view-model logic for the Publish Kit. No
 * mocking needed -- the module under test has no I/O, so these are plain
 * fixture-in / assertion-out tests, matching deliverables-pure.test.ts's
 * style.
 */

import { describe, it, expect } from "vitest";
import {
  htmlToPlainText,
  countWords,
  readConstraints,
  publisherLane,
  resolveDestinationPath,
  comparePieces,
  groupByPublishDate,
  toAgentRecord,
  toAgentManifest,
  toPublishKitView,
  copyColumnMessage,
  isLinkedInArticlePiece,
  linkedInArticlePasteEligibility,
  pieceMatchesFilter,
  filteredTotals,
  blockedPiecesAreFullyWithheld,
  ROLE_COPY_CONSTRAINTS,
  type PublishKitPiece,
  type PublishKitView,
  type PublishKitFilter,
} from "@/lib/publish-kit-pure";
import type {
  ContentExportBundle,
  ContentExportDeliverable,
  ContentExportVersionBody,
  ContentExportArtifact,
} from "@/lib/content-period-export";

// ─── Fixture builders ────────────────────────────────────────────────────────

function makeVersionBody(overrides: Partial<ContentExportVersionBody> = {}): ContentExportVersionBody {
  return {
    id: "v-default",
    version_number: 1,
    body_html: "<p>Default body</p>",
    storage_bucket: null,
    storage_path: null,
    signed_url: null,
    signed_url_expires_at: null,
    asset_mime: null,
    asset_size_bytes: null,
    asset_name: null,
    asset_sha256: null,
    note: null,
    responds_to_approval_id: null,
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function makeDeliverable(overrides: Partial<ContentExportDeliverable> = {}): ContentExportDeliverable {
  const built: ContentExportDeliverable = {
    id: "d-default",
    title: "Untitled deliverable",
    format: "Counsel Note",
    channel: "social_post",
    locale: "en-CA",
    content_kind: "text",
    status: "approved",
    publish_date: null,
    current_version_id: "v-default",
    approved_version_id: "v-default",
    is_current_version_approved: true,
    may_publish: true,
    may_publish_reason: null,
    current_version: makeVersionBody(),
    approved_version: null,
    individual_review_hold: null,
    publication_destination: "linkedin",
    publication_path: null,
    cta_target_path: null,
    artifacts: [],
    unresolved_change_request: null,
    unresolved_comments: [],
    warnings: [],
    ...overrides,
  };
  // Keep fixtures honest: matches_current_version is derived data. The real
  // exporter (see evaluateMayPublish / the artifact-mapping loop in
  // content-period-export.ts) computes it from the RESOLVED current_version,
  // not the raw current_version_id pointer -- a foreign or dangling pointer
  // resolves to a null current_version, and matches_current_version is false
  // for every artifact in that case, regardless of what the raw pointer says.
  // Recomputed here from built.current_version?.id so a fixture can never
  // assert a state the exporter cannot produce -- the exact failure mode
  // this follow-up series exists to catch.
  return {
    ...built,
    artifacts: built.artifacts.map((a) => ({
      ...a,
      matches_current_version: built.current_version?.id === a.version_id,
    })),
  };
}

function makeArtifact(overrides: Partial<ContentExportArtifact> = {}): ContentExportArtifact {
  return {
    id: "a-default",
    version_id: "v-default",
    artifact_type: "social_image",
    locale: "en-CA",
    destination: "linkedin",
    storage_bucket: "firm-files",
    storage_path: "publication-artifacts/d-default/a-default.png",
    public_url: null,
    sha256: "abc123",
    size_bytes: 1024,
    mime_type: "image/png",
    signed_url: "https://signed.example/a-default.png",
    signed_url_expires_at: "2026-07-01T01:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    superseded_at: null,
    matches_current_version: true,
    latest_validation: null,
    ...overrides,
  };
}

function makeBundle(deliverables: ContentExportDeliverable[]): ContentExportBundle {
  return {
    schema_version: "1.0",
    generated_at: "2026-07-01T00:00:00Z",
    firm: { id: "firm-1", name: "Test Firm" },
    period: {
      id: "period-1",
      title: "Test period",
      week_number: 1,
      starts_on: "2026-07-14",
      ends_on: "2026-07-20",
    },
    active_deliverable_count: deliverables.length,
    archived_deliverable_count: 0,
    warnings: [],
    generation_policy: {
      may_generate: false,
      may_rewrite: false,
      may_translate: false,
      use_portal_source_only: true,
    },
    deliverables,
    archived_deliverables: [],
  };
}

function makePiece(overrides: Partial<PublishKitPiece> = {}): PublishKitPiece {
  return {
    id: "p-default",
    title: "Untitled",
    format: null,
    role: null,
    locale: null,
    contentKind: "text",
    status: "approved",
    publishDate: null,
    destination: null,
    publicationPath: null,
    ctaTargetPath: null,
    destinationPath: null,
    lane: "unknown",
    mayPublish: true,
    mayPublishReason: null,
    individualReviewHold: null,
    bodyHtml: null,
    plainText: "",
    unapprovedDraftText: null,
    constraints: [],
    versionNumber: null,
    versionAsset: null,
    displayedVersionId: null,
    currentVersionId: null,
    anchorVersionId: null,
    boundArtifactsAreUnapproved: false,
    artifacts: [],
    otherVersionArtifacts: [],
    hasAnyArtifactToShow: false,
    hasCurrentArtifactToShow: false,
    currentVersionHasBody: false,
    unresolvedCommentCount: 0,
    changeRequestedAt: null,
    warnings: [],
    ...overrides,
  };
}

function piecesOf(view: PublishKitView): PublishKitPiece[] {
  return view.groups.flatMap((g) => g.pieces);
}

// ─── htmlToPlainText (cases 1-5) ─────────────────────────────────────────────

describe("htmlToPlainText", () => {
  it("returns an empty string for null", () => {
    expect(htmlToPlainText(null)).toBe("");
  });

  it("separates paragraphs with a blank line", () => {
    expect(htmlToPlainText("<p>A</p><p>B</p>")).toBe("A\n\nB");
  });

  it("puts each list item on its own line", () => {
    expect(htmlToPlainText("<ul><li>x</li><li>y</li></ul>")).toBe("x\ny");
  });

  it("decodes &amp; &quot; &#39; and &nbsp;", () => {
    expect(htmlToPlainText("<p>Tom &amp; Jerry&#39;s &quot;great&quot; day&nbsp;out</p>")).toBe(
      "Tom & Jerry's \"great\" day out",
    );
  });

  it("removes an inline tag like <strong> without eating adjacent words", () => {
    expect(htmlToPlainText("<p>Read the <strong>Counsel Note</strong> before you decide.</p>")).toBe(
      "Read the Counsel Note before you decide.",
    );
  });
});

// ─── countWords (cases 6-7) ───────────────────────────────────────────────────

describe("countWords", () => {
  it("returns 0 for an empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("does not count empty tokens created by repeated whitespace or newlines", () => {
    expect(countWords("one   two\n\nthree   ")).toBe(3);
  });
});

// ─── readConstraints (cases 8-13) ─────────────────────────────────────────────

describe("readConstraints", () => {
  it("gbp_post text of 28 words / 201 characters yields two 'ok' readings", () => {
    const text =
      "A commercial lease renewal option may preserve the location without controlling the next rent. " +
      "Review the right, notice process, conditions, and disagreement mechanism before the exercise window opens.";
    expect(countWords(text)).toBe(28);
    expect(text.length).toBe(201);

    const readings = readConstraints(text, ROLE_COPY_CONSTRAINTS.gbp_post);
    expect(readings).toHaveLength(2);
    expect(readings.find((r) => r.label === "words")).toMatchObject({ value: 28, state: "ok" });
    expect(readings.find((r) => r.label === "characters")).toMatchObject({ value: 201, state: "ok" });
  });

  it("gbp_post text over 300 characters yields an 'over' characters reading", () => {
    const longText = "word ".repeat(70); // 350 characters, comfortably over the 300 max
    expect(longText.length).toBeGreaterThan(300);
    const readings = readConstraints(longText, ROLE_COPY_CONSTRAINTS.gbp_post);
    const charsReading = readings.find((r) => r.label === "characters");
    expect(charsReading?.state).toBe("over");
  });

  it("social_post text of 20 words yields an 'under' words reading (below the 40-word floor)", () => {
    const text = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const readings = readConstraints(text, ROLE_COPY_CONSTRAINTS.social_post);
    const wordsReading = readings.find((r) => r.label === "words");
    expect(wordsReading?.value).toBe(20);
    expect(wordsReading?.state).toBe("under");
  });

  it("social_post text of 90 words yields an 'over' words reading (above the 80-word ceiling)", () => {
    const text = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ");
    const readings = readConstraints(text, ROLE_COPY_CONSTRAINTS.social_post);
    const wordsReading = readings.find((r) => r.label === "words");
    expect(wordsReading?.value).toBe(90);
    expect(wordsReading?.state).toBe("over");
  });

  it("a role with no constraint (article) yields an empty array", () => {
    expect(readConstraints("any text at all", ROLE_COPY_CONSTRAINTS.article)).toEqual([]);
  });

  it("clamps pct to 100 when the value exceeds the limit", () => {
    const longText = "word ".repeat(200); // 1000 characters, far over the 300 max
    const readings = readConstraints(longText, ROLE_COPY_CONSTRAINTS.gbp_post);
    const charsReading = readings.find((r) => r.label === "characters");
    expect(charsReading?.pct).toBe(100);
  });
});

// ─── publisherLane (cases 14-16) ──────────────────────────────────────────────

describe("publisherLane", () => {
  it("firm_website maps to pipeline", () => {
    expect(publisherLane("firm_website")).toBe("pipeline");
  });

  it("linkedin, linkedin_article, google_business_profile, and email all map to manual", () => {
    expect(publisherLane("linkedin")).toBe("manual");
    expect(publisherLane("linkedin_article")).toBe("manual");
    expect(publisherLane("google_business_profile")).toBe("manual");
    expect(publisherLane("email")).toBe("manual");
  });

  it("null maps to unknown", () => {
    expect(publisherLane(null)).toBe("unknown");
  });
});

// ─── destination path resolution ──────────────────────────────────────────────

describe("resolveDestinationPath", () => {
  it("gbp_post resolves from cta_target_path", () => {
    expect(resolveDestinationPath("gbp_post", null, "/resources/checklist")).toBe(
      "/resources/checklist",
    );
  });

  it("social_post resolves from cta_target_path", () => {
    expect(resolveDestinationPath("social_post", null, "/journal/x")).toBe("/journal/x");
  });

  it("article resolves from publication_path", () => {
    expect(resolveDestinationPath("article", "/journal/x", null)).toBe("/journal/x");
  });

  it("a non-post role never consults cta_target_path, even when set", () => {
    expect(resolveDestinationPath("article", "/journal/x", "/ignored")).toBe("/journal/x");
  });

  it("returns null when neither path is recorded", () => {
    expect(resolveDestinationPath(null, null, null)).toBeNull();
  });
});

describe("destination path end to end: view model and agent record", () => {
  it("a gbp_post with publication_path null and cta_target_path set produces a piece whose destinationPath is the CTA target", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        channel: "gbp_post",
        publication_path: null,
        cta_target_path: "/resources/checklist",
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.destinationPath).toBe("/resources/checklist");
  });

  it("toAgentRecord on that publishable piece returns the resolved path as destination, plus both raw columns", () => {
    const piece = makePiece({
      mayPublish: true,
      publicationPath: null,
      ctaTargetPath: "/resources/checklist",
      destinationPath: "/resources/checklist",
    });
    const record = toAgentRecord(piece);
    if (record.withheld) throw new Error("expected publishable");
    expect(record.destination).toBe("/resources/checklist");
    expect(record.publication_path).toBeNull();
    expect(record.cta_target_path).toBe("/resources/checklist");
  });
});

// ─── Version selection, via toPublishKitView (cases 17-19) ───────────────────

describe("version selection: which version's body a piece renders", () => {
  it("may_publish true: bodyHtml comes from current_version", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        may_publish_reason: null,
        current_version: makeVersionBody({
          id: "v2",
          version_number: 2,
          body_html: "<p>Current approved body</p>",
        }),
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.bodyHtml).toBe("<p>Current approved body</p>");
    expect(piece?.versionNumber).toBe(2);
  });

  it("may_publish false with an approved_version present: bodyHtml comes from approved_version, with the newer-version warning", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason:
          "The approved version is not the current version (a newer version was posted after approval and has not been re-approved).",
        current_version: makeVersionBody({
          id: "v3",
          version_number: 3,
          body_html: "<p>Newer unapproved draft</p>",
        }),
        approved_version: makeVersionBody({
          id: "v2",
          version_number: 2,
          body_html: "<p>Older approved body</p>",
        }),
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.bodyHtml).toBe("<p>Older approved body</p>");
    expect(piece?.versionNumber).toBe(2);
    expect(piece?.warnings).toContain("Showing the approved version. A newer unapproved version exists.");
  });

  it("may_publish false with no approved_version: bodyHtml is null and plainText is empty", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "No approved_version_id is recorded on this deliverable.",
        current_version: makeVersionBody({
          id: "v1",
          version_number: 1,
          body_html: "<p>Unapproved draft</p>",
        }),
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.bodyHtml).toBeNull();
    expect(piece?.plainText).toBe("");
  });
});

// ─── version asset: storagePath in the view model, version_asset on the agent record ──

describe("version asset completeness", () => {
  it("a piece whose version has a storage_path exposes it on versionAsset.storagePath", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({
          id: "v1",
          storage_path: "deliverables/f1/d1/v1.pdf",
          asset_sha256: "deadbeef",
        }),
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.versionAsset?.storagePath).toBe("deliverables/f1/d1/v1.pdf");
    expect(piece?.versionAsset?.sha256).toBe("deadbeef");
  });

  it("a publishable piece with a version asset yields an agent record whose version_asset matches", () => {
    const piece = makePiece({
      mayPublish: true,
      versionAsset: {
        name: "checklist.pdf",
        mime: "application/pdf",
        sizeBytes: 204800,
        sha256: "deadbeef",
        storagePath: "deliverables/f1/d1/v1.pdf",
        signedUrl: "https://signed.example/v1.pdf",
        signedUrlExpiresAt: "2026-07-01T01:00:00Z",
      },
    });
    const record = toAgentRecord(piece);
    if (record.withheld) throw new Error("expected publishable");
    expect(record.version_asset?.storage_path).toBe("deliverables/f1/d1/v1.pdf");
    expect(record.version_asset?.sha256).toBe("deadbeef");
  });

  it("a blocked piece has no version_asset key at all", () => {
    const piece = makePiece({
      mayPublish: false,
      mayPublishReason: "blocked",
      versionAsset: {
        name: "checklist.pdf",
        mime: "application/pdf",
        sizeBytes: 204800,
        sha256: "deadbeef",
        storagePath: "deliverables/f1/d1/v1.pdf",
        signedUrl: "https://signed.example/v1.pdf",
        signedUrlExpiresAt: "2026-07-01T01:00:00Z",
      },
    });
    const record = toAgentRecord(piece);
    expect(record).not.toHaveProperty("version_asset");
  });
});

// ─── artifact version binding ─────────────────────────────────────────────────

describe("artifact version binding", () => {
  it("an artifact matching the displayed (current) version is bound, not in otherVersionArtifacts", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [makeArtifact({ id: "a1", version_id: "v2" })],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a1"]);
    expect(piece?.otherVersionArtifacts).toEqual([]);
  });

  it("an artifact bound to a different version is in otherVersionArtifacts, not in artifacts", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [makeArtifact({ id: "a-stale", version_id: "v1" })],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts).toEqual([]);
    expect(piece?.otherVersionArtifacts.map((a) => a.id)).toEqual(["a-stale"]);
  });

  it("may_publish false with the approved version displayed: the artifact bound to the approved version is bound; one bound to the newer current version is other", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "newer unapproved version exists",
        current_version: makeVersionBody({ id: "v3" }),
        approved_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({ id: "a-approved", version_id: "v2" }),
          makeArtifact({ id: "a-newer", version_id: "v3" }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-approved"]);
    expect(piece?.otherVersionArtifacts.map((a) => a.id)).toEqual(["a-newer"]);
  });

  it("no version displayed: artifacts is empty and every artifact lands in otherVersionArtifacts", () => {
    // current_version: null here means there is no current version AT ALL --
    // the anchor is genuinely null. This is distinct from the reachable
    // "blocked piece with a current version" shape covered by its own
    // describe block below, where the anchor resolves to that current
    // version and its artifacts land in `artifacts`, not `otherVersionArtifacts`.
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "No current version exists for this deliverable.",
        current_version_id: null,
        current_version: null,
        approved_version: null,
        artifacts: [makeArtifact({ id: "a1", version_id: "v1" })],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.displayedVersionId).toBeNull();
    expect(piece?.artifacts).toEqual([]);
    expect(piece?.otherVersionArtifacts.map((a) => a.id)).toEqual(["a1"]);
  });

  it("an other-version artifact has its signedUrl, signedUrlExpiresAt, and publicUrl stripped; the bound artifact keeps them", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-bound",
            version_id: "v2",
            signed_url: "https://signed.example/bound.png",
            signed_url_expires_at: "2026-07-01T01:00:00Z",
            public_url: "https://drglaw.ca/bound.png",
          }),
          makeArtifact({
            id: "a-stale",
            version_id: "v1",
            signed_url: "https://signed.example/stale.png",
            signed_url_expires_at: "2026-07-01T01:00:00Z",
            public_url: "https://drglaw.ca/stale.png",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    const bound = piece?.artifacts.find((a) => a.id === "a-bound");
    const stale = piece?.otherVersionArtifacts.find((a) => a.id === "a-stale");
    expect(bound?.signedUrl).toBe("https://signed.example/bound.png");
    expect(bound?.publicUrl).toBe("https://drglaw.ca/bound.png");
    expect(stale?.signedUrl).toBeNull();
    expect(stale?.signedUrlExpiresAt).toBeNull();
    expect(stale?.publicUrl).toBeNull();
  });

  it("in the no-version-displayed case, the artifact in otherVersionArtifacts also has signedUrl stripped", () => {
    // current_version: null -- no current version at all, so the anchor is
    // genuinely null and every artifact falls to otherVersionArtifacts.
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "No current version exists for this deliverable.",
        current_version_id: null,
        current_version: null,
        approved_version: null,
        artifacts: [
          makeArtifact({
            id: "a1",
            version_id: "v1",
            signed_url: "https://signed.example/a1.png",
            public_url: "https://drglaw.ca/a1.png",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    const a1 = piece?.otherVersionArtifacts.find((a) => a.id === "a1");
    expect(a1?.signedUrl).toBeNull();
    expect(a1?.publicUrl).toBeNull();
  });

  it("two artifacts bound to the same version, same type and locale: only the most recently created one is kept as bound", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-old",
            version_id: "v2",
            artifact_type: "social_image",
            locale: "en-CA",
            created_at: "2026-07-01T00:00:00Z",
          }),
          makeArtifact({
            id: "a-new",
            version_id: "v2",
            artifact_type: "social_image",
            locale: "en-CA",
            created_at: "2026-07-02T00:00:00Z",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-new"]);
    expect(piece?.warnings.some((w) => w.includes("duplicate artifact"))).toBe(true);
  });

  it("two artifacts bound to the same version but different artifact_type are both kept, no over-aggressive dedup", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({ id: "a-hero", version_id: "v2", artifact_type: "hero_image", locale: "en-CA" }),
          makeArtifact({ id: "a-social", version_id: "v2", artifact_type: "social_image", locale: "en-CA" }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-hero", "a-social"]);
  });

  it("two artifacts bound to the same version and type but different locale are both kept", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({ id: "a-en", version_id: "v2", artifact_type: "social_image", locale: "en-CA" }),
          makeArtifact({ id: "a-pt", version_id: "v2", artifact_type: "social_image", locale: "pt-BR" }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-en", "a-pt"]);
  });

  it("two artifacts bound to the same version, type, and locale but different destination are both kept, with no false 'superseded' warning", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-linkedin",
            version_id: "v2",
            artifact_type: "social_image",
            locale: "en-CA",
            destination: "linkedin",
          }),
          makeArtifact({
            id: "a-gbp",
            version_id: "v2",
            artifact_type: "social_image",
            locale: "en-CA",
            destination: "google_business_profile",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-gbp", "a-linkedin"]);
    expect(piece?.warnings.some((w) => w.includes("superseded"))).toBe(false);
  });

  it("true duplicates (same type, locale, and destination) with equal created_at break the tie on the higher id, regardless of input order", () => {
    const artifactAlpha = makeArtifact({
      id: "a-alpha",
      version_id: "v2",
      artifact_type: "social_image",
      locale: "en-CA",
      destination: "linkedin",
      created_at: "2026-07-01T00:00:00Z",
    });
    const artifactBeta = makeArtifact({
      id: "a-beta",
      version_id: "v2",
      artifact_type: "social_image",
      locale: "en-CA",
      destination: "linkedin",
      created_at: "2026-07-01T00:00:00Z",
    });

    const forwardBundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [artifactAlpha, artifactBeta],
      }),
    ]);
    const reverseBundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [artifactBeta, artifactAlpha],
      }),
    ]);

    const forwardPiece = piecesOf(toPublishKitView(forwardBundle)).find((p) => p.id === "d1");
    const reversePiece = piecesOf(toPublishKitView(reverseBundle)).find((p) => p.id === "d1");
    expect(forwardPiece?.artifacts.map((a) => a.id)).toEqual(["a-beta"]);
    expect(reversePiece?.artifacts.map((a) => a.id)).toEqual(["a-beta"]);
  });

  it("three distinct (non-duplicate) artifacts produce the identical array regardless of input order -- the underlying query carries no ORDER BY, so this is the only thing standing between the operator and a reshuffled artifact list on an unrelated page reload", () => {
    const heroImage = makeArtifact({ id: "a-hero", version_id: "v2", artifact_type: "hero_image", locale: "en-CA" });
    const socialEn = makeArtifact({ id: "a-social-en", version_id: "v2", artifact_type: "social_image", locale: "en-CA" });
    const socialPt = makeArtifact({ id: "a-social-pt", version_id: "v2", artifact_type: "social_image", locale: "pt-BR" });
    const allOrderings = [
      [heroImage, socialEn, socialPt],
      [socialPt, heroImage, socialEn],
      [socialEn, socialPt, heroImage],
    ];
    const results = allOrderings.map((artifacts) => {
      const bundle = makeBundle([
        makeDeliverable({
          id: "d1",
          may_publish: true,
          current_version: makeVersionBody({ id: "v2" }),
          artifacts,
        }),
      ]);
      return piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1")?.artifacts.map((a) => a.id);
    });
    expect(results[0]).toEqual(["a-hero", "a-social-en", "a-social-pt"]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("toAgentRecord on a publishable piece with one bound and one unbound artifact returns only the bound one", () => {
    const boundArtifact = {
      id: "a-bound",
      versionId: "v2",
      artifactType: "social_image",
      locale: null,
      destination: null,
      filename: "bound.png",
      storagePath: "a/bound.png",
      publicUrl: null,
      sha256: "bound-sha",
      sizeBytes: 100,
      mime: "image/png",
      signedUrl: "https://signed.example/bound.png",
      signedUrlExpiresAt: null,
      createdAt: "2026-07-01T00:00:00Z",
      supersededAt: null,
      validation: null,
    };
    const piece = makePiece({
      mayPublish: true,
      artifacts: [boundArtifact],
      otherVersionArtifacts: [{ ...boundArtifact, id: "a-other", versionId: "v1" }],
    });
    const record = toAgentRecord(piece);
    if (record.withheld) throw new Error("expected publishable");
    expect(record.artifacts).toHaveLength(1);
    expect(record.artifacts[0].id).toBe("a-bound");
  });

  it("toArtifact maps filename to the basename of storagePath and passes signedUrl, sha256, and mime through unchanged", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v1" }),
        artifacts: [
          makeArtifact({
            id: "a1",
            version_id: "v1",
            storage_path: "a/b/hero.png",
            signed_url: "https://signed.example/hero.png",
            sha256: "hero-sha",
            mime_type: "image/png",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    const artifact = piece?.artifacts[0];
    expect(artifact?.filename).toBe("hero.png");
    expect(artifact?.signedUrl).toBe("https://signed.example/hero.png");
    expect(artifact?.sha256).toBe("hero-sha");
    expect(artifact?.mime).toBe("image/png");
  });

  it("the other-versions panel is deduped per version: two artifacts on the same other version collapse to the newer one, and an artifact on a different other version is kept alongside it", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v3" }),
        artifacts: [
          makeArtifact({
            id: "a-v1-old",
            version_id: "v1",
            artifact_type: "social_image",
            locale: "en-CA",
            destination: "linkedin",
            created_at: "2026-07-01T00:00:00Z",
          }),
          makeArtifact({
            id: "a-v1-new",
            version_id: "v1",
            artifact_type: "social_image",
            locale: "en-CA",
            destination: "linkedin",
            created_at: "2026-07-02T00:00:00Z",
          }),
          makeArtifact({
            id: "a-v2",
            version_id: "v2",
            artifact_type: "social_image",
            locale: "en-CA",
            destination: "linkedin",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.otherVersionArtifacts.map((a) => a.id)).toEqual(["a-v1-new", "a-v2"]);
  });
});

// ─── dedupeArtifacts: an active artifact always beats a superseded one ───────

describe("dedupeArtifacts: active vs superseded", () => {
  it("an active artifact is kept over a superseded one even when the superseded row has a later createdAt", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-active",
            version_id: "v2",
            created_at: "2026-07-01T00:00:00Z",
            superseded_at: null,
          }),
          makeArtifact({
            id: "a-superseded-but-newer",
            version_id: "v2",
            created_at: "2026-07-02T00:00:00Z",
            superseded_at: "2026-07-03T00:00:00Z",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-active"]);
    // No RETRACTION-SLOT warning: an active replacement exists in this slot,
    // so nothing is "retracted with no active replacement". The separate
    // duplicate-count warning may still fire (checked elsewhere) and its own
    // wording explains the preference rule using the word "retracted"
    // descriptively -- that is not what this assertion is guarding against.
    expect(piece?.warnings.some((w) => w.includes("no active replacement"))).toBe(false);
  });

  it("a slot with only a superseded artifact keeps it (nothing else to show) and carries the retraction warning", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-only-superseded",
            version_id: "v2",
            superseded_at: "2026-07-03T00:00:00Z",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-only-superseded"]);
    expect(piece?.warnings.some((w) => w.includes("retracted"))).toBe(true);
  });

  it("two active artifacts in the same slot still resolve by createdAt then id (no regression)", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({ id: "a-old", version_id: "v2", created_at: "2026-07-01T00:00:00Z" }),
          makeArtifact({ id: "a-new", version_id: "v2", created_at: "2026-07-02T00:00:00Z" }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-new"]);
  });
});

describe("dedupe and retraction warning wording", () => {
  it("active-older beats superseded-newer, and the warning does not claim 'most recently created' won", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({ id: "a-active-old", version_id: "v2", created_at: "2026-07-01T00:00:00Z", superseded_at: null }),
          makeArtifact({
            id: "a-superseded-new",
            version_id: "v2",
            created_at: "2026-07-09T00:00:00Z",
            superseded_at: "2026-07-10T00:00:00Z",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-active-old"]);
    expect(piece?.warnings.some((w) => w.includes("most recently created artifact per slot is shown"))).toBe(false);
  });

  it("two retracted slots on one piece: the warning reports '2 artifact slots'", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-social-retracted",
            version_id: "v2",
            artifact_type: "social_image",
            superseded_at: "2026-07-03T00:00:00Z",
          }),
          makeArtifact({
            id: "a-hero-retracted",
            version_id: "v2",
            artifact_type: "hero_image",
            superseded_at: "2026-07-03T00:00:00Z",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.warnings.some((w) => w.includes("2 artifact slots have been retracted"))).toBe(true);
  });

  it("one retracted slot: the warning reports '1 artifact slot has'", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({ id: "a-retracted", version_id: "v2", superseded_at: "2026-07-03T00:00:00Z" }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.warnings.some((w) => w.includes("1 artifact slot has been retracted"))).toBe(true);
  });
});

// ─── a retracted artifact is never downloadable, on any piece ────────────────

describe("a retracted artifact is never downloadable", () => {
  it("on a publishable piece, a retracted bound artifact has signedUrl and signedUrlExpiresAt null but keeps storagePath and sha256", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-retracted",
            version_id: "v2",
            storage_path: "publication-artifacts/d1/a-retracted.png",
            sha256: "retracted-sha",
            signed_url: "https://signed.example/a-retracted.png",
            signed_url_expires_at: "2026-07-01T01:00:00Z",
            superseded_at: "2026-07-03T00:00:00Z",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    const artifact = piece?.artifacts.find((a) => a.id === "a-retracted");
    expect(artifact?.signedUrl).toBeNull();
    expect(artifact?.signedUrlExpiresAt).toBeNull();
    expect(artifact?.storagePath).toBe("publication-artifacts/d1/a-retracted.png");
    expect(artifact?.sha256).toBe("retracted-sha");
  });

  it("on that same publishable piece, a non-retracted bound artifact in a different slot still keeps its signedUrl", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-retracted",
            version_id: "v2",
            artifact_type: "hero_image",
            signed_url: "https://signed.example/a-retracted.png",
            superseded_at: "2026-07-03T00:00:00Z",
          }),
          makeArtifact({
            id: "a-active",
            version_id: "v2",
            artifact_type: "social_image",
            signed_url: "https://signed.example/a-active.png",
            superseded_at: null,
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.find((a) => a.id === "a-active")?.signedUrl).toBe(
      "https://signed.example/a-active.png",
    );
    expect(piece?.artifacts.find((a) => a.id === "a-retracted")?.signedUrl).toBeNull();
  });

  it("toAgentRecord on a publishable piece returns the retracted artifact with signedUrl null and supersededAt set", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-retracted",
            version_id: "v2",
            signed_url: "https://signed.example/a-retracted.png",
            superseded_at: "2026-07-03T00:00:00Z",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    if (!piece) throw new Error("expected piece");
    const record = toAgentRecord(piece);
    if (record.withheld) throw new Error("expected publishable");
    expect(record.artifacts[0].signedUrl).toBeNull();
    expect(record.artifacts[0].supersededAt).toBe("2026-07-03T00:00:00Z");
  });
});

// ─── the anchor derives from the exporter's resolved, owned version ──────────

describe("the artifact anchor never trusts the raw current_version_id pointer", () => {
  it("a foreign or dangling current_version_id (current_version null) puts every artifact in otherVersionArtifacts, fully stripped", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason:
          "current_version_id resolves to a version belonging to a different deliverable; treated as missing.",
        current_version_id: "v-foreign",
        current_version: null,
        approved_version_id: null,
        approved_version: null,
        artifacts: [
          makeArtifact({
            id: "a-foreign",
            version_id: "v-foreign",
            signed_url: "https://signed.example/a-foreign.png",
            public_url: "https://drglaw.ca/foreign.png",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.currentVersionId).toBeNull();
    expect(piece?.boundArtifactsAreUnapproved).toBe(false);
    expect(piece?.artifacts).toEqual([]);
    const artifact = piece?.otherVersionArtifacts.find((a) => a.id === "a-foreign");
    expect(artifact?.signedUrl).toBeNull();
    expect(artifact?.publicUrl).toBeNull();
  });

  it("the fixture's own matches_current_version recompute agrees with the real exporter on this same foreign-pointer shape: false, not true from the raw pointer", () => {
    const built = makeDeliverable({
      id: "d1",
      current_version_id: "v-foreign",
      current_version: null,
      artifacts: [makeArtifact({ id: "a-foreign", version_id: "v-foreign" })],
    });
    // Matches content-period-export.test.ts's "matches_current_version is
    // false when current_version_id is a foreign/dangling pointer" test,
    // which proves the real exporter emits false for this exact shape.
    expect(built.artifacts[0].matches_current_version).toBe(false);
  });

  it("the normal case is unchanged: a resolved current_version's artifacts still land in artifacts", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version_id: "v1",
        current_version: makeVersionBody({ id: "v1" }),
        artifacts: [makeArtifact({ id: "a1", version_id: "v1" })],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a1"]);
  });
});

// ─── a blocked file deliverable's asset stays findable ───────────────────────

describe("a blocked file deliverable's asset stays findable", () => {
  it("versionAsset is non-null for a blocked piece whose current version has a storage_path, and its storagePath matches", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        content_kind: "pdf",
        may_publish: false,
        may_publish_reason: "No approved_version_id is recorded on this deliverable.",
        current_version_id: "v1",
        current_version: makeVersionBody({
          id: "v1",
          storage_path: "deliverables/f1/d1/checklist.pdf",
          asset_name: "checklist.pdf",
        }),
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.versionAsset?.storagePath).toBe("deliverables/f1/d1/checklist.pdf");
  });

  it("that versionAsset's signedUrl and signedUrlExpiresAt are null", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        content_kind: "pdf",
        may_publish: false,
        may_publish_reason: "blocked",
        current_version_id: "v1",
        current_version: makeVersionBody({
          id: "v1",
          storage_path: "deliverables/f1/d1/checklist.pdf",
          signed_url: "https://signed.example/checklist.pdf",
          signed_url_expires_at: "2026-07-01T01:00:00Z",
        }),
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.versionAsset?.signedUrl).toBeNull();
    expect(piece?.versionAsset?.signedUrlExpiresAt).toBeNull();
  });

  it("versionNumber is the current version's number, not null", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        content_kind: "pdf",
        may_publish: false,
        may_publish_reason: "blocked",
        current_version_id: "v1",
        current_version: makeVersionBody({
          id: "v1",
          version_number: 3,
          storage_path: "deliverables/f1/d1/checklist.pdf",
        }),
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.versionNumber).toBe(3);
  });

  it("hasAnyArtifactToShow is true", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        content_kind: "pdf",
        may_publish: false,
        may_publish_reason: "blocked",
        current_version_id: "v1",
        current_version: makeVersionBody({
          id: "v1",
          storage_path: "deliverables/f1/d1/checklist.pdf",
        }),
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.hasAnyArtifactToShow).toBe(true);
  });

  it("a blocked piece whose current version has no storage_path and no artifacts has hasAnyArtifactToShow false", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "blocked",
        current_version_id: "v1",
        current_version: makeVersionBody({ id: "v1", storage_path: null }),
        approved_version_id: null,
        approved_version: null,
        artifacts: [],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.hasAnyArtifactToShow).toBe(false);
  });

  it("toAgentRecord on that blocked piece still omits version_asset entirely -- the withholding property must not regress", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        content_kind: "pdf",
        may_publish: false,
        may_publish_reason: "blocked",
        current_version_id: "v1",
        current_version: makeVersionBody({
          id: "v1",
          storage_path: "deliverables/f1/d1/checklist.pdf",
        }),
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    if (!piece) throw new Error("expected piece");
    const record = toAgentRecord(piece);
    expect(record).not.toHaveProperty("version_asset");
  });
});

describe("hasCurrentArtifactToShow and currentVersionHasBody answer different questions than hasAnyArtifactToShow and currentVersionId", () => {
  it("a blocked pdf piece with no current-version file and only an other-version artifact: hasCurrentArtifactToShow is false while hasAnyArtifactToShow is true", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        content_kind: "pdf",
        may_publish: false,
        may_publish_reason: "blocked",
        current_version_id: "v1",
        current_version: makeVersionBody({ id: "v1", storage_path: null }),
        approved_version_id: null,
        approved_version: null,
        artifacts: [makeArtifact({ id: "a-other", version_id: "v-older" })],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    // The two flags must disagree here -- proving they answer different
    // questions. If they ever agreed on every fixture, one would be redundant.
    expect(piece?.hasCurrentArtifactToShow).toBe(false);
    expect(piece?.hasAnyArtifactToShow).toBe(true);
  });

  it("a blocked piece whose current version has no body: currentVersionHasBody is false", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "blocked",
        current_version_id: "v1",
        current_version: makeVersionBody({ id: "v1", body_html: null }),
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.currentVersionHasBody).toBe(false);
  });

  it.each(["<p></p>", "<p><br></p>", "<p>&nbsp;</p>"])(
    "a blocked piece whose current version's body is empty markup (%s) has currentVersionHasBody false -- the version-post route accepts this as a non-empty column",
    (bodyHtml) => {
      const bundle = makeBundle([
        makeDeliverable({
          id: "d1",
          may_publish: false,
          may_publish_reason: "blocked",
          current_version_id: "v1",
          current_version: makeVersionBody({ id: "v1", body_html: bodyHtml }),
          approved_version_id: null,
          approved_version: null,
        }),
      ]);
      const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
      expect(piece?.currentVersionHasBody).toBe(false);
    },
  );

  it("a blocked piece whose current version has a body: currentVersionHasBody is true", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "blocked",
        current_version_id: "v1",
        current_version: makeVersionBody({ id: "v1", body_html: "<p>Draft awaiting approval</p>" }),
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.currentVersionHasBody).toBe(true);
  });

  it("a publishable piece: both new fields still compute, independent of approval", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v1", body_html: "<p>Approved copy</p>", storage_path: "dl/v1.pdf" }),
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.currentVersionHasBody).toBe(true);
    expect(piece?.hasCurrentArtifactToShow).toBe(true);
  });
});

// ─── copyColumnMessage: the decision PublishKit.tsx used to make untested ────
//
// Before this function existed, this exact ternary sat inline in
// PublishKit.tsx (a "use client" component vitest never collects). Reverting
// round 6's fix to it left the entire test suite green -- verified directly.
// This table is what makes the decision itself testable, independent of
// which component consumes it.

describe("copyColumnMessage", () => {
  it.each([
    ["pdf", true, true, false, "file_delivery"],
    ["pdf", true, false, false, "no_copy"],
    ["pdf", false, false, true, "has_unapproved_copy"],
    ["pdf", false, false, false, "no_copy"],
    ["text", false, false, true, "has_unapproved_copy"],
    ["text", false, false, false, "no_copy"],
    ["text", true, false, true, "no_copy"],
    ["image", false, true, false, "file_delivery"],
  ] as const)(
    "contentKind=%s mayPublish=%s hasCurrentArtifactToShow=%s currentVersionHasBody=%s -> %s",
    (contentKind, mayPublish, hasCurrentArtifactToShow, currentVersionHasBody, expected) => {
      const piece = makePiece({ contentKind, mayPublish, hasCurrentArtifactToShow, currentVersionHasBody });
      expect(copyColumnMessage(piece)).toBe(expected);
    },
  );
});

// ─── LinkedIn Article paste eligibility ──────────────────────────────────────

describe("isLinkedInArticlePiece", () => {
  it.each([
    ["linkedin_article", true],
    ["linkedin", false], // the feed/promoter post, NOT an Article
    ["firm_website", false],
    ["google_business_profile", false],
    ["email", false],
    [null, false],
  ] as const)("destination=%s -> %s", (destination, expected) => {
    expect(isLinkedInArticlePiece({ destination })).toBe(expected);
  });

  it("is never fooled by title text alone -- a '[LINKEDIN POST]'-prefixed title on a linkedin_article destination still reads as an Article", () => {
    const piece = makePiece({ title: "[LINKEDIN POST] Renewal Clause Basics", destination: "linkedin_article" });
    expect(isLinkedInArticlePiece(piece)).toBe(true);
  });
});

describe("linkedInArticlePasteEligibility", () => {
  it.each([
    ["linkedin_article", "en-CA", "eligible"],
    ["linkedin_article", "en-US", "eligible"],
    ["linkedin_article", "pt-BR", "unsupported_locale"],
    ["linkedin_article", null, "unsupported_locale"], // unknown locale is treated as NOT confirmed English
    ["linkedin", "en-CA", "not_applicable"], // a feed/promoter post is never eligible, regardless of locale
    ["firm_website", "en-CA", "not_applicable"],
    [null, "en-CA", "not_applicable"],
  ] as const)("destination=%s locale=%s -> %s", (destination, locale, expected) => {
    const piece = makePiece({ destination, locale });
    expect(linkedInArticlePasteEligibility(piece)).toBe(expected);
  });

  it("is more conservative on unknown locale than the pure transform's own default -- a real operator surface must never assume English", () => {
    // toLinkedInArticlePasteHtmlEnglishOnly proceeds (ok: true) when locale is
    // omitted/null, because it is a generic library default for a caller with
    // nothing to pass. This function decides what an operator actually sees
    // for a real piece, so it deliberately disagrees: null reads as
    // "not confirmed English", the same as a known non-English locale.
    const piece = makePiece({ destination: "linkedin_article", locale: null });
    expect(linkedInArticlePasteEligibility(piece)).toBe("unsupported_locale");
  });
});

// ─── blocked piece with no approved version: the reachable shape ─────────────
//
// Per evaluateMayPublish in content-period-export.ts, approved_version_id can
// never differ from current_version_id in production (the only two writers --
// the approval RPC and deliverables.ts -- either match them or clear
// approved_version_id to null). So EVERY blocked piece takes this shape:
// approved_version is null, current_version is set, may_publish is false. This
// is the shape the exporter can actually emit -- unlike the "approved_version
// populated while may_publish is false" shape used in the FU3-3 tests below,
// which selectVersion's middle branch would need but which no writer produces.

describe("blocked piece with no approved version (the reachable blocked shape)", () => {
  function blockedBundle(overrides: Partial<ContentExportDeliverable> = {}) {
    return makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "No approved_version_id is recorded on this deliverable.",
        current_version_id: "v1",
        current_version: makeVersionBody({
          id: "v1",
          body_html: "<p>Copy awaiting approval</p>",
          storage_path: null,
        }),
        approved_version_id: null,
        approved_version: null,
        artifacts: [
          makeArtifact({
            id: "a-current",
            version_id: "v1",
            signed_url: "https://signed.example/a-current.png",
            signed_url_expires_at: "2026-07-01T01:00:00Z",
          }),
          makeArtifact({ id: "a-other", version_id: "v-older", artifact_type: "hero_image" }),
        ],
        ...overrides,
      }),
    ]);
  }

  it("displayedVersionId is null and currentVersionId equals the current version's id", () => {
    const piece = piecesOf(toPublishKitView(blockedBundle())).find((p) => p.id === "d1");
    expect(piece?.displayedVersionId).toBeNull();
    expect(piece?.currentVersionId).toBe("v1");
  });

  it("an artifact bound to the current version is in artifacts, not otherVersionArtifacts", () => {
    const piece = piecesOf(toPublishKitView(blockedBundle())).find((p) => p.id === "d1");
    expect(piece?.artifacts.map((a) => a.id)).toEqual(["a-current"]);
  });

  it("boundArtifactsAreUnapproved is true", () => {
    const piece = piecesOf(toPublishKitView(blockedBundle())).find((p) => p.id === "d1");
    expect(piece?.boundArtifactsAreUnapproved).toBe(true);
  });

  it("the bound current-version artifact still has signedUrl stripped (FU3-3's strip still applies)", () => {
    const piece = piecesOf(toPublishKitView(blockedBundle())).find((p) => p.id === "d1");
    const artifact = piece?.artifacts.find((a) => a.id === "a-current");
    expect(artifact?.signedUrl).toBeNull();
    expect(artifact?.signedUrlExpiresAt).toBeNull();
  });

  it("an artifact bound to a genuinely different version is still in otherVersionArtifacts", () => {
    const piece = piecesOf(toPublishKitView(blockedBundle())).find((p) => p.id === "d1");
    expect(piece?.otherVersionArtifacts.map((a) => a.id)).toEqual(["a-other"]);
  });

  it("for a publishable piece, boundArtifactsAreUnapproved is false", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({ id: "v1" }),
        artifacts: [makeArtifact({ id: "a1", version_id: "v1" })],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.boundArtifactsAreUnapproved).toBe(false);
  });

  it("the bound current-version artifact has its publicUrl withheld while unapproved -- reverted from an earlier round, see stripAccess's doc comment", () => {
    const bundle = blockedBundle({
      artifacts: [
        makeArtifact({
          id: "a-current",
          version_id: "v1",
          public_url: "https://drglaw.ca/current.png",
        }),
        makeArtifact({
          id: "a-other",
          version_id: "v-older",
          artifact_type: "hero_image",
          public_url: "https://drglaw.ca/older.png",
        }),
      ],
    });
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.find((a) => a.id === "a-current")?.publicUrl).toBeNull();
    expect(piece?.otherVersionArtifacts.find((a) => a.id === "a-other")?.publicUrl).toBeNull();
  });
});

// ─── anchorVersionId: displayedVersionId ?? currentVersionId, precomputed ────

describe("anchorVersionId", () => {
  // The three shapes below all have anchorVersionId === currentVersionId, so
  // none of them can tell this field apart from a plain alias of
  // currentVersionId. This one can: displayedVersionId and currentVersionId
  // genuinely differ, and the anchor must follow the DISPLAYED version,
  // because that is the version whose artifacts are on screen.
  it("follows displayedVersionId, not currentVersionId, when the two differ", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "The approved version is not the current version.",
        current_version_id: "v3",
        current_version: makeVersionBody({ id: "v3" }),
        approved_version_id: "v2",
        approved_version: makeVersionBody({ id: "v2", version_number: 2 }),
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.currentVersionId).toBe("v3");
    expect(piece?.displayedVersionId).toBe("v2");
    expect(piece?.anchorVersionId).toBe("v2");
  });

  it("equals displayedVersionId when a version is displayed", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version_id: "v1",
        current_version: makeVersionBody({ id: "v1" }),
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.displayedVersionId).toBe("v1");
    expect(piece?.anchorVersionId).toBe("v1");
  });

  it("equals currentVersionId when nothing is cleared to display", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "No approved_version_id is recorded on this deliverable.",
        current_version_id: "v1",
        current_version: makeVersionBody({ id: "v1" }),
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.displayedVersionId).toBeNull();
    expect(piece?.currentVersionId).toBe("v1");
    expect(piece?.anchorVersionId).toBe("v1");
  });

  it("is null when neither displayedVersionId nor currentVersionId resolves (a foreign/dangling pointer)", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "current_version_id resolves to a version belonging to a different deliverable.",
        current_version_id: "v-foreign",
        current_version: null,
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.currentVersionId).toBeNull();
    expect(piece?.anchorVersionId).toBeNull();
  });
});

// ─── blocked pieces: no working links in the RSC payload ─────────────────────

describe("blocked pieces carry no working links", () => {
  // NOTE: these three tests construct may_publish: false WITH approved_version
  // populated -- a shape evaluateMayPublish in content-period-export.ts cannot
  // currently produce (see the block comment above). They are kept as defense-in-depth coverage
  // of selectVersion's middle branch, in case a future writer ever sets
  // approved_version_id to something other than current_version_id or null.
  // They do NOT cover the actually-reachable blocked case; that is the
  // "blocked piece with no approved version" describe block above.
  it("a blocked piece's bound artifact has its signedUrl and signedUrlExpiresAt stripped, but keeps storagePath and sha256", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason:
          "The approved version is not the current version (a newer version was posted after approval and has not been re-approved).",
        current_version: makeVersionBody({ id: "v3" }),
        approved_version: makeVersionBody({ id: "v2" }),
        artifacts: [
          makeArtifact({
            id: "a-approved",
            version_id: "v2",
            storage_path: "publication-artifacts/d1/a-approved.png",
            sha256: "approved-sha",
            signed_url: "https://signed.example/a-approved.png",
            signed_url_expires_at: "2026-07-01T01:00:00Z",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    const artifact = piece?.artifacts.find((a) => a.id === "a-approved");
    expect(artifact?.signedUrl).toBeNull();
    expect(artifact?.signedUrlExpiresAt).toBeNull();
    expect(artifact?.storagePath).toBe("publication-artifacts/d1/a-approved.png");
    expect(artifact?.sha256).toBe("approved-sha");
  });

  it("a blocked piece's versionAsset has its signedUrl stripped, but keeps storagePath", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "blocked",
        current_version: makeVersionBody({ id: "v3" }),
        approved_version: makeVersionBody({
          id: "v2",
          storage_path: "deliverables/f1/d1/v2.pdf",
          asset_sha256: "v2-sha",
          signed_url: "https://signed.example/v2.pdf",
          signed_url_expires_at: "2026-07-01T01:00:00Z",
        }),
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.versionAsset?.signedUrl).toBeNull();
    expect(piece?.versionAsset?.signedUrlExpiresAt).toBeNull();
    expect(piece?.versionAsset?.storagePath).toBe("deliverables/f1/d1/v2.pdf");
    expect(piece?.versionAsset?.sha256).toBe("v2-sha");
  });

  it("a publishable piece keeps both its bound artifact's and its version asset's signedUrl", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: true,
        current_version: makeVersionBody({
          id: "v2",
          storage_path: "deliverables/f1/d1/v2.pdf",
          signed_url: "https://signed.example/v2.pdf",
        }),
        artifacts: [
          makeArtifact({
            id: "a1",
            version_id: "v2",
            signed_url: "https://signed.example/a1.png",
          }),
        ],
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.artifacts.find((a) => a.id === "a1")?.signedUrl).toBe(
      "https://signed.example/a1.png",
    );
    expect(piece?.versionAsset?.signedUrl).not.toBeNull();
  });
});

// ─── groupByPublishDate (cases 20-22) ─────────────────────────────────────────

describe("groupByPublishDate", () => {
  it("groups pieces under their publish date, in ascending date order", () => {
    const pieces = [
      makePiece({ id: "p3", publishDate: "2026-07-16", title: "C" }),
      makePiece({ id: "p1", publishDate: "2026-07-14", title: "A" }),
      makePiece({ id: "p2", publishDate: "2026-07-15", title: "B" }),
    ];
    const groups = groupByPublishDate(pieces);
    expect(groups.map((g) => g.date)).toEqual(["2026-07-14", "2026-07-15", "2026-07-16"]);
    expect(groups[0].pieces.map((p) => p.id)).toEqual(["p1"]);
  });

  it("pieces with a null publish date land in a single trailing group keyed ''", () => {
    const pieces = [
      makePiece({ id: "p1", publishDate: "2026-07-14" }),
      makePiece({ id: "p2", publishDate: null }),
      makePiece({ id: "p3", publishDate: null }),
    ];
    const groups = groupByPublishDate(pieces);
    const last = groups[groups.length - 1];
    expect(last.date).toBe("");
    expect(last.pieces.map((p) => p.id).sort()).toEqual(["p2", "p3"]);
  });

  it("an empty input returns an empty array", () => {
    expect(groupByPublishDate([])).toEqual([]);
  });
});

describe("comparePieces: id tiebreak", () => {
  it("two pieces sharing both publishDate and title order deterministically by id", () => {
    const a = makePiece({ id: "p-b", publishDate: "2026-07-14", title: "Same title" });
    const b = makePiece({ id: "p-a", publishDate: "2026-07-14", title: "Same title" });
    expect(comparePieces(a, b)).toBeGreaterThan(0);
    expect(comparePieces(b, a)).toBeLessThan(0);
    expect([a, b].sort(comparePieces).map((p) => p.id)).toEqual(["p-a", "p-b"]);
  });

  it("two undated pieces sharing a title also order deterministically by id", () => {
    const a = makePiece({ id: "p-b", publishDate: null, title: "Same title" });
    const b = makePiece({ id: "p-a", publishDate: null, title: "Same title" });
    expect([a, b].sort(comparePieces).map((p) => p.id)).toEqual(["p-a", "p-b"]);
  });
});

// ─── toAgentRecord: the withholding safety property (cases 23-25) ────────────

describe("toAgentRecord: the withholding safety property", () => {
  it("a publishable piece yields a record containing body, destination, and artifacts", () => {
    const piece = makePiece({
      mayPublish: true,
      bodyHtml: "<p>Approved copy</p>",
      plainText: "Approved copy",
      publicationPath: "/journal/example",
      artifacts: [],
    });
    const record = toAgentRecord(piece);
    expect(record.withheld).toBe(false);
    expect(record).toHaveProperty("body");
    expect(record).toHaveProperty("destination");
    expect(record).toHaveProperty("artifacts");
    expect(record).toHaveProperty("version_asset");
  });

  it("a non-publishable piece withholds body, plain_text, destination, and artifacts, and carries the exact reason", () => {
    const reason =
      "The approved version is not the current version (a newer version was posted after approval and has not been re-approved).";
    const piece = makePiece({
      mayPublish: false,
      mayPublishReason: reason,
      bodyHtml: "<p>Should never be exposed</p>",
      plainText: "Should never be exposed",
      publicationPath: "/journal/example",
    });
    const record = toAgentRecord(piece);
    expect(record.publishable).toBe(false);
    expect(record.withheld).toBe(true);
    if (record.withheld) {
      expect(record.blocked_reason).toBe(reason);
    }
    expect(record).not.toHaveProperty("body");
    expect(record).not.toHaveProperty("plain_text");
    expect(record).not.toHaveProperty("destination");
    expect(record).not.toHaveProperty("artifacts");
    expect(record).not.toHaveProperty("version_asset");
    expect(record).not.toHaveProperty("publication_path");
    expect(record).not.toHaveProperty("cta_target_path");
  });

  it("a blocked piece's version_number is nulled in the withheld record even though piece.versionNumber is set (FU5-4 findability leak, closed)", () => {
    const piece = makePiece({
      mayPublish: false,
      mayPublishReason: "blocked",
      versionNumber: 3,
    });
    const record = toAgentRecord(piece);
    expect(record.withheld).toBe(true);
    expect(record.version_number).toBeNull();
  });

  it("a publishable piece's version_number passes through unchanged", () => {
    const piece = makePiece({ mayPublish: true, versionNumber: 2 });
    const record = toAgentRecord(piece);
    expect(record.withheld).toBe(false);
    expect(record.version_number).toBe(2);
  });

  it("toAgentManifest includes every piece, publishable or not", () => {
    const pieces = [
      makePiece({ id: "p1", mayPublish: true }),
      makePiece({ id: "p2", mayPublish: false, mayPublishReason: "blocked" }),
      makePiece({ id: "p3", mayPublish: true }),
    ];
    const view: PublishKitView = {
      periodId: "period-1",
      periodTitle: "Test period",
      startsOn: "2026-07-14",
      endsOn: "2026-07-20",
      firmId: "firm-1",
      firmName: "Test Firm",
      generatedAt: "2026-07-14T00:00:00Z",
      totals: { total: 3, publishable: 2, blocked: 1, manual: 0, pipeline: 0 },
      groups: groupByPublishDate(pieces),
      bundleWarnings: [],
    };
    const manifest = toAgentManifest(view);
    expect(manifest.deliverables).toHaveLength(3);
    expect(manifest.deliverables.map((d) => d.deliverable_id).sort()).toEqual(["p1", "p2", "p3"]);
  });
});

// ─── totals (case 26) ─────────────────────────────────────────────────────────

describe("totals", () => {
  it("publishable + blocked always equals total", () => {
    const bundle = makeBundle([
      makeDeliverable({ id: "d1", may_publish: true }),
      makeDeliverable({ id: "d2", may_publish: false, may_publish_reason: "blocked" }),
      makeDeliverable({ id: "d3", may_publish: true }),
    ]);
    const view = toPublishKitView(bundle);
    expect(view.totals.publishable + view.totals.blocked).toBe(view.totals.total);
  });
});

// ─── pieceMatchesFilter / filteredTotals ──────────────────────────────────────
//
// The component keeps "all" / "any" as its own sentinel values for "no filter
// on this dimension" and maps them to null at the boundary before calling
// into this module (PublishKit.tsx's pieceFilter). These tests exercise the
// pure functions directly with null, the same shape the component sends.

const NO_FILTER: PublishKitFilter = { channel: null, lane: null };

describe("pieceMatchesFilter", () => {
  it("null channel and null lane match every piece", () => {
    expect(pieceMatchesFilter(makePiece({ destination: "linkedin", lane: "manual" }), NO_FILTER)).toBe(true);
  });

  it("a channel filter excludes pieces on a different destination", () => {
    const filter: PublishKitFilter = { channel: "linkedin", lane: null };
    expect(pieceMatchesFilter(makePiece({ destination: "linkedin" }), filter)).toBe(true);
    expect(pieceMatchesFilter(makePiece({ destination: "firm_website" }), filter)).toBe(false);
  });

  it("a lane filter excludes pieces in a different lane", () => {
    const filter: PublishKitFilter = { channel: null, lane: "pipeline" };
    expect(pieceMatchesFilter(makePiece({ lane: "pipeline" }), filter)).toBe(true);
    expect(pieceMatchesFilter(makePiece({ lane: "manual" }), filter)).toBe(false);
  });

  it("both filters set requires both to match", () => {
    const filter: PublishKitFilter = { channel: "linkedin", lane: "manual" };
    expect(pieceMatchesFilter(makePiece({ destination: "linkedin", lane: "manual" }), filter)).toBe(true);
    expect(pieceMatchesFilter(makePiece({ destination: "linkedin", lane: "pipeline" }), filter)).toBe(false);
  });
});

describe("filteredTotals", () => {
  function threeDeliverableView(): PublishKitView {
    const bundle = makeBundle([
      makeDeliverable({ id: "d1", publication_destination: "linkedin", may_publish: true }),
      makeDeliverable({
        id: "d2",
        publication_destination: "firm_website",
        may_publish: false,
        may_publish_reason: "blocked",
      }),
      makeDeliverable({ id: "d3", publication_destination: "linkedin", may_publish: true }),
    ]);
    return toPublishKitView(bundle);
  }

  it("unfiltered returns view.totals verbatim, marked isFiltered: false", () => {
    const view = threeDeliverableView();
    expect(filteredTotals(view, NO_FILTER)).toEqual({ ...view.totals, isFiltered: false });
  });

  it("a channel filter counts only the matching pieces, marked isFiltered: true", () => {
    const view = threeDeliverableView();
    const result = filteredTotals(view, { channel: "linkedin", lane: null });
    // Every field of view.totals, not a subset: the unfiltered branch spreads
    // all of them, so a filtered result missing manual/pipeline would make the
    // returned shape depend on filter state.
    expect(result).toEqual({
      total: 2,
      publishable: 2,
      blocked: 0,
      manual: 2,
      pipeline: 0,
      isFiltered: true,
    });
  });

  it("publishable + blocked equals total under every filter", () => {
    const view = threeDeliverableView();
    for (const filter of [
      NO_FILTER,
      { channel: "linkedin", lane: null },
      { channel: "firm_website", lane: null },
      { channel: null, lane: "pipeline" as const },
    ]) {
      const result = filteredTotals(view, filter);
      expect(result.publishable + result.blocked).toBe(result.total);
    }
  });

  it("a filter matching nothing returns all zeros, still marked isFiltered: true", () => {
    const view = threeDeliverableView();
    const result = filteredTotals(view, { channel: "google_business_profile", lane: null });
    expect(result).toEqual({
      total: 0,
      publishable: 0,
      blocked: 0,
      manual: 0,
      pipeline: 0,
      isFiltered: true,
    });
  });
});

// ─── blockedPiecesAreFullyWithheld ─────────────────────────────────────────────
//
// Pins the fact the blocked banner's stronger sentence relies on: every
// blocked piece's toPiece already strips its links, so this is always true in
// practice. The point is that the banner's claim is now traced to a checked
// fact instead of asserted unconditionally -- if a future change ever leaks a
// link into a blocked piece, the banner must stop making the claim rather
// than repeat something false.

describe("blockedPiecesAreFullyWithheld", () => {
  // The blocked piece must carry BOTH a bound artifact and an other-version
  // artifact, and a stored version asset. An earlier version of this test used
  // a bare deliverable with `artifacts: []` and no storage_path, which made
  // `.every()` trivially true over an empty array and the versionAsset
  // disjunct short-circuit: deleting the entire artifacts clause from the
  // predicate left it green. A fixture with nothing in it proves nothing.
  function blockedView(): PublishKitView {
    return toPublishKitView(
      makeBundle([
        makeDeliverable({
          id: "d1",
          may_publish: false,
          may_publish_reason: "blocked",
          current_version_id: "v1",
          current_version: makeVersionBody({ id: "v1", storage_path: "deliverables/d1/asset.pdf" }),
          approved_version_id: null,
          approved_version: null,
          artifacts: [
            makeArtifact({
              id: "a-bound",
              version_id: "v1",
              signed_url: "https://signed.example/bound.png",
              public_url: "https://drglaw.ca/bound.png",
            }),
            makeArtifact({
              id: "a-other",
              version_id: "v-older",
              artifact_type: "hero_image",
              signed_url: "https://signed.example/other.png",
              public_url: "https://drglaw.ca/other.png",
            }),
          ],
        }),
      ]),
    );
  }

  function piecesOfView(view: PublishKitView) {
    return view.groups.flatMap((g) => g.pieces);
  }

  it("true for a blocked piece whose artifacts, other-version artifacts and version asset are all stripped", () => {
    const pieces = piecesOfView(blockedView());
    const blocked = pieces.find((p) => p.id === "d1");
    // Guard the guard: the fixture must actually carry the things being checked.
    expect(blocked?.artifacts.length).toBeGreaterThan(0);
    expect(blocked?.otherVersionArtifacts.length).toBeGreaterThan(0);
    expect(blocked?.versionAsset).not.toBeNull();
    expect(blockedPiecesAreFullyWithheld(pieces)).toBe(true);
  });

  it.each([
    ["a bound artifact's signedUrl", (p: PublishKitPiece) => ({
      ...p,
      artifacts: p.artifacts.map((a, i) => (i === 0 ? { ...a, signedUrl: "https://leaked.example/x" } : a)),
    })],
    ["a bound artifact's publicUrl", (p: PublishKitPiece) => ({
      ...p,
      artifacts: p.artifacts.map((a, i) => (i === 0 ? { ...a, publicUrl: "https://drglaw.ca/leak.png" } : a)),
    })],
    ["an other-version artifact's signedUrl", (p: PublishKitPiece) => ({
      ...p,
      otherVersionArtifacts: p.otherVersionArtifacts.map((a, i) =>
        i === 0 ? { ...a, signedUrl: "https://leaked.example/x" } : a,
      ),
    })],
    ["an other-version artifact's publicUrl", (p: PublishKitPiece) => ({
      ...p,
      otherVersionArtifacts: p.otherVersionArtifacts.map((a, i) =>
        i === 0 ? { ...a, publicUrl: "https://drglaw.ca/leak.png" } : a,
      ),
    })],
    ["the version asset's signedUrl", (p: PublishKitPiece) => ({
      ...p,
      versionAsset: p.versionAsset ? { ...p.versionAsset, signedUrl: "https://leaked.example/x" } : null,
    })],
  ] as const)("false when %s leaks into a blocked piece", (_label, leak) => {
    const pieces = piecesOfView(blockedView()).map((p) => (p.mayPublish ? p : leak(p)));
    expect(blockedPiecesAreFullyWithheld(pieces)).toBe(false);
  });

  it("ignores publishable pieces entirely -- their links are supposed to work", () => {
    const view = toPublishKitView(
      makeBundle([
        makeDeliverable({
          id: "d1",
          may_publish: true,
          current_version_id: "v1",
          current_version: makeVersionBody({ id: "v1" }),
          artifacts: [makeArtifact({ id: "a1", version_id: "v1", signed_url: "https://signed.example/a1.png" })],
        }),
      ]),
    );
    expect(blockedPiecesAreFullyWithheld(piecesOfView(view))).toBe(true);
  });
});

// ─── unapprovedDraftText: the operator can still read and paste the draft ────
//
// The Publish Kit is operator-only, and the same bundle's Markdown export
// already prints unapproved body_html for that audience. Withholding the text
// here was friction, not protection -- the UI even told the operator to go
// read it on the review page -- and it broke producing the DRG Law Minute
// email, where the workflow is pasting the copy into the GHL template.
// ACCESS stays withheld for blocked pieces; CONTENT does not.

describe("unapprovedDraftText", () => {
  function unapprovedPiece(bodyHtml: string | null) {
    return piecesOf(
      toPublishKitView(
        makeBundle([
          makeDeliverable({
            id: "d1",
            may_publish: false,
            may_publish_reason: "Not release-authorized.",
            current_version_id: "v1",
            current_version: makeVersionBody({ id: "v1", body_html: bodyHtml }),
            approved_version_id: null,
            approved_version: null,
          }),
        ]),
      ),
    ).find((p) => p.id === "d1");
  }

  it("carries the current version's text when nothing is cleared to publish", () => {
    const piece = unapprovedPiece("<p>The renewal clause that shapes your next rent.</p>");
    expect(piece?.plainText).toBe("");
    expect(piece?.unapprovedDraftText).toBe("The renewal clause that shapes your next rent.");
  });

  it("is null when the piece has publishable copy -- the real copy is in plainText", () => {
    const piece = piecesOf(
      toPublishKitView(
        makeBundle([
          makeDeliverable({
            id: "d1",
            may_publish: true,
            current_version_id: "v1",
            current_version: makeVersionBody({ id: "v1", body_html: "<p>Approved copy.</p>" }),
          }),
        ]),
      ),
    ).find((p) => p.id === "d1");
    expect(piece?.plainText).toBe("Approved copy.");
    expect(piece?.unapprovedDraftText).toBeNull();
  });

  it("is null, not an empty string, when the draft renders to no text at all", () => {
    expect(unapprovedPiece("<p></p>")?.unapprovedDraftText).toBeNull();
    expect(unapprovedPiece(null)?.unapprovedDraftText).toBeNull();
  });

  it("never reaches the agent record: a withheld record still carries no copy", () => {
    const piece = unapprovedPiece("<p>Draft only.</p>")!;
    // Via unknown: AgentRecord is a discriminated union with no index
    // signature, and the point of this test is to assert that certain keys are
    // ABSENT -- which requires looking at the object as a bag of keys.
    const record = toAgentRecord(piece) as unknown as Record<string, unknown>;
    expect(record.withheld).toBe(true);
    expect(record.plain_text).toBeUndefined();
    expect(record.body).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain("Draft only");
  });

  it("blocked pieces still carry no working links -- content is shown, access is not", () => {
    const view = toPublishKitView(
      makeBundle([
        makeDeliverable({
          id: "d1",
          may_publish: false,
          may_publish_reason: "Not release-authorized.",
          current_version_id: "v1",
          current_version: makeVersionBody({ id: "v1", body_html: "<p>Draft.</p>" }),
          approved_version_id: null,
          approved_version: null,
          artifacts: [makeArtifact({ id: "a1", version_id: "v1" })],
        }),
      ]),
    );
    const pieces = view.groups.flatMap((g) => g.pieces);
    expect(pieces[0].unapprovedDraftText).toBe("Draft.");
    expect(blockedPiecesAreFullyWithheld(pieces)).toBe(true);
  });
});

// ─── htmlToPlainText: full HTML emails, not just simple fragments ────────────
//
// Surfaced by showing the DRG Law Minute's draft in the kit: it is a complete
// HTML email with a several-hundred-line <style> block, and stripping only
// TAGS left the whole stylesheet behind as prose. The operator was handed CSS
// to paste into the GHL template. Entities beyond the original seven
// (&middot;, curly quotes, numeric forms) came through raw for the same reason.

describe("htmlToPlainText: non-text elements and entities", () => {
  it("removes the CONTENT of a style block, not just its tags", () => {
    const html = "<style>.foot p{font-size:12px;color:var(--mid);}</style><p>Real copy.</p>";
    const out = htmlToPlainText(html);
    expect(out).toBe("Real copy.");
    expect(out).not.toContain("font-size");
  });

  it("removes script and head content too", () => {
    expect(htmlToPlainText("<script>var a = 1;</script><p>Body.</p>")).toBe("Body.");
    expect(htmlToPlainText("<head><title>Ignored</title></head><p>Body.</p>")).toBe("Body.");
  });

  it("removes HTML comments", () => {
    expect(htmlToPlainText("<p>Visible.</p><!-- hidden note -->")).toBe("Visible.");
  });

  it("decodes the entities a real editor emits, not just the original seven", () => {
    expect(htmlToPlainText("<p>DRG&middot;LAW&middot;MINUTE</p>")).toBe("DRG·LAW·MINUTE");
    expect(htmlToPlainText("<p>Commercial Lease &middot; Ontario</p>")).toBe("Commercial Lease · Ontario");
    expect(htmlToPlainText("<p>it&rsquo;s</p>")).toBe("it’s");
    expect(htmlToPlainText("<p>a &mdash; b</p>")).toBe("a — b");
  });

  it("decodes numeric entities, decimal and hex", () => {
    expect(htmlToPlainText("<p>it&#8217;s</p>")).toBe("it’s");
    expect(htmlToPlainText("<p>it&#x2019;s</p>")).toBe("it’s");
  });

  it("leaves an entity it does not know exactly as written", () => {
    expect(htmlToPlainText("<p>&zzz; stays</p>")).toBe("&zzz; stays");
  });

  it("does not double-decode: an escaped entity survives as literal text", () => {
    // The author wrote &amp;lt; to display "&lt;". Decoding in two passes
    // would turn it into "<".
    expect(htmlToPlainText("<p>&amp;lt;</p>")).toBe("&lt;");
  });

  it("still handles the simple fragments it always did", () => {
    expect(htmlToPlainText("<p>One</p><p>Two</p>")).toBe("One\n\nTwo");
    expect(htmlToPlainText("<p>a &amp; b</p>")).toBe("a & b");
  });
});

// ─── individualReviewHold: a person held this, and the card should say so ────
//
// requires_individual_review is the one thing that overrides an active
// standing publishing authorization, and it is always a deliberate act. The
// kit previously rendered only the predicate's mechanical output -- a version
// UUID and the word "flagged" -- which reads as a system fault rather than as
// a colleague's decision. Carrying the reason and its author lets the card
// attribute it.

describe("individualReviewHold", () => {
  function heldPiece(hold: {
    reason?: string | null;
    set_by_role?: string | null;
    set_by_name?: string | null;
    set_at?: string | null;
  }) {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "Not release-authorized: flagged requires_individual_review=true.",
        current_version_id: "v1",
        current_version: makeVersionBody({ id: "v1" }),
        approved_version_id: null,
        approved_version: null,
        individual_review_hold: {
          reason: hold.reason ?? null,
          set_by_role: hold.set_by_role ?? null,
          set_by_name: hold.set_by_name ?? null,
          set_at: hold.set_at ?? null,
        },
      }),
    ]);
    return piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
  }

  it("carries the recorded reason and who set it", () => {
    const piece = heldPiece({
      reason: "Unsubscribe link is a placeholder pending GHL sending setup.",
      set_by_role: "operator",
    });
    expect(piece?.individualReviewHold?.reason).toBe(
      "Unsubscribe link is a placeholder pending GHL sending setup.",
    );
    expect(piece?.individualReviewHold?.setByRole).toBe("operator");
  });

  it("survives a hold with no recorded reason -- the hold itself is still the fact", () => {
    const piece = heldPiece({ reason: null, set_by_role: "operator" });
    expect(piece?.individualReviewHold).not.toBeNull();
    expect(piece?.individualReviewHold?.reason).toBeNull();
  });

  it("is null for a piece nobody held, even when it is blocked for another reason", () => {
    const bundle = makeBundle([
      makeDeliverable({
        id: "d1",
        may_publish: false,
        may_publish_reason: "No approved_version_id is recorded.",
        current_version_id: "v1",
        current_version: makeVersionBody({ id: "v1" }),
        approved_version_id: null,
        approved_version: null,
      }),
    ]);
    const piece = piecesOf(toPublishKitView(bundle)).find((p) => p.id === "d1");
    expect(piece?.mayPublish).toBe(false);
    expect(piece?.individualReviewHold).toBeNull();
  });

  it("does not make the piece publishable -- it only explains why it is not", () => {
    const piece = heldPiece({ reason: "Held.", set_by_role: "operator" });
    expect(piece?.mayPublish).toBe(false);
  });
});
