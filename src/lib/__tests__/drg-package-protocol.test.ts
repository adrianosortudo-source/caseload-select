import { describe, expect, it } from "vitest";
import { createPrivateKey, sign } from "node:crypto";

import {
  buildDrgIdempotencyKey,
  buildDrgWebsitePackageExport,
  drgWebsiteProjectionPayload,
  DRG_WEBSITE_PACKAGE_SCHEMA_VERSION,
  sha256,
  validateDrgPackageTransition,
  validateDrgWebsitePackageExport,
  type DrgWebsitePackageBuildInput,
} from "@/lib/drg-package-protocol";
import type { ContentExportBundle, ContentExportDeliverable } from "@/lib/content-period-export";
import {
  DRG_RELEASE_AUTHORIZATION_MAX_TTL_MS,
  DRG_RELEASE_AUTHORIZATION_PIECE_IDS,
  DRG_RELEASE_TRUST_BUNDLE_SHA256,
  computeDrgReleaseEvidenceSha256,
  createSignedDrgReleaseAuthorizationEnvelope,
  type DrgReleaseAuthorizationPieceSnapshot,
} from "@/lib/drg-release-authorization-envelope";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const ROLES = ["counsel_note", "clause_in_margin", "checklist"] as const;
const LOCALES = ["en-CA", "pt-BR"] as const;
const TEST_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJ1hsZ3v/VpguoRK9JLsLMREScVpezJpGXA7rAMcrn9g\n-----END PRIVATE KEY-----\n";
const TEST_SIGNER = {
  keyId: "drg-release-rfc8032-test-v1",
  publicKeySpkiSha256: "06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9",
  sign: (payload: Uint8Array) => sign(null, payload, createPrivateKey(TEST_PRIVATE_KEY)).toString("base64"),
};

function idFor(role: string, locale: string): string {
  return `${role}-${locale === "en-CA" ? "en" : "pt"}`;
}

function pieceIdFor(role: (typeof ROLES)[number], locale: (typeof LOCALES)[number]): (typeof DRG_RELEASE_AUTHORIZATION_PIECE_IDS)[number] {
  if (role === "counsel_note") return locale === "en-CA" ? "CN-EN" : "CN-PT";
  if (role === "clause_in_margin") return locale === "en-CA" ? "CIM-EN" : "CIM-PT";
  return locale === "en-CA" ? "CHECKLIST-LANDING-EN" : "CHECKLIST-LANDING-PT";
}

function makeDeliverable(role: (typeof ROLES)[number], locale: (typeof LOCALES)[number]): ContentExportDeliverable {
  const id = idFor(role, locale);
  const versionId = `${id}-v2`;
  return {
    id,
    title: `Approved ${role} ${locale}`,
    format: role,
    channel: role === "checklist" ? "lead_magnet_pdf" : "article",
    locale,
    content_kind: "text",
    status: "in_review",
    publish_date: "2026-08-12",
    current_version_id: versionId,
    approved_version_id: null,
    is_current_version_approved: false,
    may_publish: true,
    may_publish_reason: null,
    release_authorization: null,
    current_version: { id: versionId, version_number: 2, body_html: `<p>${id} locked.</p>`, storage_bucket: null, storage_path: null, signed_url: null, signed_url_expires_at: null, asset_mime: null, asset_size_bytes: null, asset_name: null, asset_sha256: null, note: null, responds_to_approval_id: null, created_at: "2026-08-08T00:00:00.000Z" },
    approved_version: null,
    individual_review_hold: null,
    publication_destination: "firm_website",
    publication_path: locale === "en-CA" ? `/journal/${id}` : `/pt/journal/${id}`,
    cta_target_path: "/contact",
    artifacts: [{ id: `${id}-asset`, version_id: versionId, artifact_type: role === "checklist" ? "pdf" : "hero_image", asset_role: role === "checklist" ? "checklist_pdf" : "website_article_hero", locale, destination: "firm_website", storage_bucket: "firm-files", storage_path: `approved/${id}.${role === "checklist" ? "pdf" : "png"}`, public_url: null, sha256: HASH_B, size_bytes: 100, mime_type: role === "checklist" ? "application/pdf" : "image/png", signed_url: null, signed_url_expires_at: null, created_at: "2026-08-08T00:00:00.000Z", superseded_at: null, matches_current_version: true, latest_validation: null }],
    unresolved_change_request: null,
    unresolved_comments: [],
    warnings: [],
  };
}

function makeEnvelope(deliverables: ContentExportDeliverable[]) {
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const pieces = DRG_RELEASE_AUTHORIZATION_PIECE_IDS.map((pieceId, index) => {
    const deliverable = deliverables.find((candidate) => {
      const role = ROLES.find((candidateRole) => candidate.id.startsWith(`${candidateRole}-`));
      return role ? pieceIdFor(role, candidate.locale as (typeof LOCALES)[number]) === pieceId : false;
    });
    const evidenceWithoutHash: Omit<DrgReleaseAuthorizationPieceSnapshot, "evidence_sha256"> = {
      piece_id: pieceId,
      firm_id: "firm-1",
      period_id: "period-1",
      package_id: "drg-2026-w33",
      package_version: 2,
      package_sha256: HASH_A,
      deliverable_id: deliverable?.id ?? `other-deliverable-${index}`,
      current_version_id: deliverable?.current_version_id ?? `other-version-${index}`,
      version_number: 2,
      piece_sha256: HASH_A,
      source_sha256: HASH_B,
      asset_sha256s: [HASH_B],
      path: "standing_authorization",
      approval_record_id: null,
      standing_authorization_event_id: "standing-event-1",
      standing_authorization_active: true,
      change_hold_active: false,
      requires_individual_review: false,
      revoked_at: null,
      evidence_recorded_at: issuedAt,
    };
    return { ...evidenceWithoutHash, evidence_sha256: computeDrgReleaseEvidenceSha256(evidenceWithoutHash) };
  });
  return createSignedDrgReleaseAuthorizationEnvelope({
    envelopeId: `drg-release:drg-2026-w33:v2:${HASH_A}`,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + DRG_RELEASE_AUTHORIZATION_MAX_TTL_MS).toISOString(),
    package: { id: "drg-2026-w33", version: 2, firm_id: "firm-1", period_id: "period-1", package_sha256: HASH_A },
    pieces,
    signer: {
      keyId: "drg-release-rfc8032-test-v1",
      publicKeySpkiSha256: "06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9",
      sign: (payload) => sign(null, payload, createPrivateKey(TEST_PRIVATE_KEY)).toString("base64"),
    },
  });
}

function makeSource(): ContentExportBundle {
  const deliverables = LOCALES.flatMap((locale) => ROLES.map((role) => makeDeliverable(role, locale)));
  return {
    schema_version: "1.1",
    generated_at: "2026-08-08T00:00:00.000Z",
    firm: { id: "firm-1", name: "DRG Law" },
    period: { id: "period-1", title: "Week 5", week_number: 5, starts_on: "2026-08-10", ends_on: "2026-08-16" },
    active_deliverable_count: 6,
    archived_deliverable_count: 0,
    warnings: [],
    generation_policy: { may_generate: false, may_rewrite: false, may_translate: false, use_portal_source_only: true },
    deliverables,
    archived_deliverables: [],
    release_authorization_envelope: makeEnvelope(deliverables),
  };
}

function makeInput(): DrgWebsitePackageBuildInput {
  return {
    package_id: "drg-2026-w33",
    package_version: 2,
    doctrine: [{ id: "csb", version: "4.18", sha256: HASH_A }],
    source_versions: [{ source_id: "cn-brief", source_kind: "source_brief", version: "1", sha256: HASH_B }],
    pieces: LOCALES.flatMap((locale) => ROLES.map((role) => {
      const id = idFor(role, locale);
      const slug = id.replace(/_/g, "-");
      const route = locale === "en-CA" ? `/journal/${slug}` : `/pt/journal/${slug}`;
      return { piece_id: pieceIdFor(role, locale), deliverable_id: id, deliverable_version_id: `${id}-v2`, locale, role, slug, route, expected_metadata: { canonical_route: route, alternate_routes: { "en-CA": `/journal/${slug}`, "pt-BR": `/pt/journal/${slug}` }, required_structured_data: [role === "checklist" ? "WebPage" : "Article", "BreadcrumbList"] } };
    })),
    dependencies: [
      { piece_id: "CIM-EN", depends_on_piece_id: "CN-EN" },
      { piece_id: "CHECKLIST-LANDING-EN", depends_on_piece_id: "CN-EN" },
      { piece_id: "CIM-PT", depends_on_piece_id: "CN-PT" },
      { piece_id: "CHECKLIST-LANDING-PT", depends_on_piece_id: "CN-PT" },
    ],
  };
}

describe("DRG package protocol", () => {
  it("pins the portal trust bundle to the cross-repository parity fixture", () => {
    expect(DRG_RELEASE_TRUST_BUNDLE_SHA256).toBe("2c3f4af2928181d507d1c3b0f15d4d8ccdacaf6a83238311825eb121e6808247");
  });

  it("builds a deterministic complete six-piece website package from standing release authorization without fabricating approval records", () => {
    const source = makeSource();
    const first = buildDrgWebsitePackageExport(source, makeInput(), TEST_SIGNER);
    const second = buildDrgWebsitePackageExport(source, makeInput(), TEST_SIGNER);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.schema_version).toBe(DRG_WEBSITE_PACKAGE_SCHEMA_VERSION);
    expect(first.value.pieces).toHaveLength(6);
    expect(first.value.pieces.every((piece) => piece.release_authorization.path === "standing_authorization")).toBe(true);
    expect(first.value.package.package_sha256).toBe(second.value.package.package_sha256);
    expect(validateDrgWebsitePackageExport(first.value)).toEqual([]);
  });

  it("fails closed when canonical release evidence is fabricated, revoked, held, or superseded by a client change request", () => {
    const cases = [
      (source: ContentExportBundle) => { source.release_authorization_envelope = null; },
      (source: ContentExportBundle) => {
        source.release_authorization_envelope = structuredClone(source.release_authorization_envelope!);
        (source.release_authorization_envelope.signature as { signature_base64: string }).signature_base64 = Buffer.from("forged").toString("base64");
      },
      (source: ContentExportBundle) => {
        source.release_authorization_envelope = structuredClone(source.release_authorization_envelope!);
        (source.release_authorization_envelope.pieces[0] as { revoked_at: string | null }).revoked_at = "2026-08-09T00:00:00.000Z";
      },
      (source: ContentExportBundle) => { source.deliverables[0].individual_review_hold = { reason: "client exception", set_by_role: "operator", set_by_name: "CaseLoad", set_at: "2026-08-09T00:00:00.000Z" }; },
      (source: ContentExportBundle) => { source.deliverables[0].unresolved_change_request = { approval_record_id: "change-1", requested_at: "2026-08-09T00:00:00.000Z", signer_name: "Client", note: "Revise" }; },
    ];
    for (const mutate of cases) {
      const source = makeSource();
      mutate(source);
      expect(buildDrgWebsitePackageExport(source, makeInput(), TEST_SIGNER).ok).toBe(false);
    }
  });

  it("refuses an export when a selection is not the exact approved source version", () => {
    const input = makeInput();
    input.pieces[0].deliverable_version_id = "old-version";
    const result = buildDrgWebsitePackageExport(makeSource(), input, TEST_SIGNER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("exact current release-authorized version");
  });

  it("rejects incomplete, cyclic, and hash-tampered package payloads", () => {
    const incomplete = makeInput();
    incomplete.pieces.pop();
    expect(buildDrgWebsitePackageExport(makeSource(), incomplete, TEST_SIGNER).ok).toBe(false);

    const good = buildDrgWebsitePackageExport(makeSource(), makeInput(), TEST_SIGNER);
    if (!good.ok) throw new Error("expected good package");
    const cyclic = structuredClone(good.value);
    cyclic.dependencies.push({ piece_id: "CN-EN", depends_on_piece_id: "CIM-EN" });
    expect(validateDrgWebsitePackageExport(cyclic).some((error) => error.message.includes("cycle"))).toBe(true);

    const tampered = structuredClone(good.value);
    tampered.pieces[0].title = "Changed after approval";
    expect(validateDrgWebsitePackageExport(tampered).some((error) => error.message.includes("does not match"))).toBe(true);
  });

  it.each(["title", "body_html", "route"] as const)("rejects benign %s tamper even when the caller recomputes the self-package hash", (field) => {
    const good = buildDrgWebsitePackageExport(makeSource(), makeInput(), TEST_SIGNER);
    if (!good.ok) throw new Error("expected good package");
    const tampered = structuredClone(good.value);
    if (field === "title") tampered.pieces[0].title = "Benign editorial title change";
    if (field === "body_html") tampered.pieces[0].body_html = "<p>Benign editorial body change.</p>";
    if (field === "route") {
      tampered.pieces[0].route = "/journal/benign-route-change";
      tampered.pieces[0].publication_path = tampered.pieces[0].route;
      tampered.pieces[0].expected_metadata.canonical_route = tampered.pieces[0].route;
      tampered.pieces[0].expected_metadata.alternate_routes["en-CA"] = tampered.pieces[0].route;
    }
    const { package_sha256: ignored, ...packageWithoutHash } = tampered.package;
    tampered.package.package_sha256 = sha256({
      schema_version: tampered.schema_version,
      package: packageWithoutHash,
      release_authorization_envelope: tampered.release_authorization_envelope,
      website_projection_authorization: tampered.website_projection_authorization,
      pieces: tampered.pieces,
      dependencies: tampered.dependencies,
    });
    expect(tampered.website_projection_authorization.projection_sha256).not.toBe(sha256(drgWebsiteProjectionPayload(tampered)));
    expect(validateDrgWebsitePackageExport(tampered).some((error) => error.message.includes("exact final six-piece website projection"))).toBe(true);
  });

  it("requires traceable source-lock gate evidence and generates collision-resistant idempotency keys", () => {
    expect(validateDrgPackageTransition({ from: "topic_selected", to: "source_brief_locked", evidence: [] })).toHaveLength(1);
    expect(validateDrgPackageTransition({ from: "topic_selected", to: "source_brief_locked", evidence: [{ kind: "source_brief_lock", subject_sha256: HASH_A, actor_id: "", recorded_at: "not-a-date" }] })).toHaveLength(2);
    expect(validateDrgPackageTransition({ from: "topic_selected", to: "source_brief_locked", evidence: [{ kind: "source_brief_lock", subject_sha256: HASH_A, actor_id: "operator-1", recorded_at: "2026-08-08T00:00:00Z" }] })).toEqual([]);
    expect(buildDrgIdempotencyKey({ firm_id: "firm-1", package_id: "drg-2026-w33", package_version: 2, piece_id: "counsel_note-en", deliverable_version_id: "counsel_note-en-v2", operation: "website_export" })).toBe("firm-1/drg-2026-w33/2/counsel_note-en/counsel_note-en-v2/website_export");
    expect(sha256({ b: 1, a: 2 })).toBe(sha256({ a: 2, b: 1 }));
  });
});
