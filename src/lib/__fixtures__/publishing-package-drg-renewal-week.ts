/**
 * The DRG Law "Renewal Clause" weekly package fixture (Section 21 of the
 * Weekly Package Control Room build spec). Local-only, syntactically valid
 * fake UUIDs -- never production database records, no real storage keys or
 * signed URLs.
 *
 * Sixteen pieces = {Counsel Note, Clause in the Margin, Decision Tool} x
 * {en-CA, pt-BR} [6] + {LinkedIn Article, LinkedIn Post, GBP, Lead Magnet
 * Document, Lead Magnet Landing Page} x {en-CA, pt-BR} [10]. Every one of
 * the 9 asset roles appears in at least one required_assets entry across
 * the set; the canonical_textless_master and rendered_qa_evidence roles
 * (which aren't tied to a single destination) are attached as extra
 * required_assets on the Counsel Note EN piece.
 *
 * `baseManifestJson()` returns a manifest that passes
 * validatePackageManifest() cleanly -- the deliberately-broken fixture
 * properties (cross-locale error, wrong-role error, Files-hub CTA error)
 * are separate named mutator functions applied on top of the base, so the
 * "valid 16-piece DRG fixture" test case and the "each specific rejection"
 * test cases stay independent of each other.
 */
import type { AssetGuardCandidate } from "@/lib/publishing-package-control-room-manifest";

export const DRG_FIRM_ID = "a1a1a1a1-0000-4000-8000-000000000001";
export const DRG_RENEWAL_PERIOD_ID = "b2b2b2b2-0000-4000-8000-000000000002";
export const DRG_RENEWAL_PACKAGE_ID = "c3c3c3c3-0000-4000-8000-000000000003";

const CANDIDATE_GROUP_COUNSEL_NOTE_EN_HERO = "d4d4d4d4-0000-4000-8000-000000000004";

function hash32(seed: string, salt: number): number {
  let hash = salt >>> 0;
  for (let i = 0; i < seed.length; i++) hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  return hash >>> 0;
}

function uid(seed: string): string {
  // Deterministic, syntactically valid UUID-shaped fake id from a short seed
  // string -- readable in test failures ("counsel-note-en-hero-selected" ->
  // a UUID that still sorts/greps distinctly per seed) without a random
  // generator (Math.random is unavailable in this environment's workflow
  // contexts, and determinism matters more than realism for a fixture).
  // Needs exactly 8 + 12 = 20 variable hex chars (the 4 middle segments are
  // fixed at "0000-4000-8000-" below); two independent 32-bit hashes give
  // 16 hex chars, so a third pass tops up the last 4.
  const a = hash32(seed, 0x9e3779b1).toString(16).padStart(8, "0");
  const b = hash32(seed, 0x85ebca6b).toString(16).padStart(8, "0");
  const c = hash32(seed, 0xc2b2ae35).toString(16).padStart(8, "0");
  const last12 = (b + c).slice(0, 12);
  return `${a}-0000-4000-8000-${last12}`;
}

interface PieceSpec {
  slot: string;
  title: string;
  format: string;
  locale: "en-CA" | "pt-BR";
  destination: string;
  requiredAssets: Array<{
    assetRole: string;
    destination: string;
    width: number;
    height: number;
    textPolicy: string;
    overlayLanguage: string | null;
    safeArea: string;
    requiredCopy: string | null;
    selectedAssetId: string | null;
  }>;
  cta: { required: boolean; label: string | null; target: string | null; behavior: string };
  pdfAssetId: string | null;
  placementStatus: string;
  approvalStatus: string;
}

const NO_CTA = { required: false, label: null, target: null, behavior: "none" };

function overlayFor(locale: "en-CA" | "pt-BR"): "en" | "pt" {
  return locale === "en-CA" ? "en" : "pt";
}

const PIECES: PieceSpec[] = [
  // ── Counsel Note (website) ──────────────────────────────────────────────
  {
    slot: "counsel-note-en", title: "Counsel Note: Renewal Clause Basics", format: "counsel_note",
    locale: "en-CA", destination: "website",
    requiredAssets: [
      { assetRole: "website_article_hero", destination: "website", width: 1600, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: uid("counsel-note-en-hero-selected") },
      { assetRole: "canonical_textless_master", destination: "internal", width: 3200, height: 1800, textPolicy: "textless", overlayLanguage: null, safeArea: "full bleed, no overlay", requiredCopy: null, selectedAssetId: uid("counsel-note-en-master-selected") },
      { assetRole: "rendered_qa_evidence", destination: "internal", width: 1280, height: 800, textPolicy: "platform_rendered_text", overlayLanguage: null, safeArea: "n/a -- screenshot evidence", requiredCopy: null, selectedAssetId: null },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "not_placed", approvalStatus: "in_review",
  },
  {
    // Deliberately the "one missing PT asset" fixture property: no candidate
    // has ever been registered for this requirement.
    slot: "counsel-note-pt", title: "Nota do Advogado: Cláusula de Renovação", format: "counsel_note",
    locale: "pt-BR", destination: "website",
    requiredAssets: [
      { assetRole: "website_article_hero", destination: "website", width: 1600, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: null },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "not_placed", approvalStatus: "in_review",
  },
  // ── Clause in the Margin (website) ──────────────────────────────────────
  {
    slot: "clause-margin-en", title: "Clause in the Margin: Renewal Language", format: "clause_in_the_margin",
    locale: "en-CA", destination: "website",
    requiredAssets: [
      { assetRole: "website_article_hero", destination: "website", width: 1600, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: uid("clause-margin-en-hero") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "placed", approvalStatus: "approved",
  },
  {
    slot: "clause-margin-pt", title: "Cláusula na Margem: Linguagem de Renovação", format: "clause_in_the_margin",
    locale: "pt-BR", destination: "website",
    requiredAssets: [
      { assetRole: "website_article_hero", destination: "website", width: 1600, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: uid("clause-margin-pt-hero") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "placed", approvalStatus: "approved",
  },
  // ── Decision Tool (website) ─────────────────────────────────────────────
  {
    slot: "decision-tool-en", title: "Should You Renew? A Decision Tool", format: "decision_tool",
    locale: "en-CA", destination: "website",
    requiredAssets: [
      { assetRole: "website_article_hero", destination: "website", width: 1600, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: uid("decision-tool-en-hero") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "not_placed", approvalStatus: "draft",
  },
  {
    slot: "decision-tool-pt", title: "Devo Renovar? Uma Ferramenta de Decisão", format: "decision_tool",
    locale: "pt-BR", destination: "website",
    requiredAssets: [
      { assetRole: "website_article_hero", destination: "website", width: 1600, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: uid("decision-tool-pt-hero") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "not_placed", approvalStatus: "draft",
  },
  // ── Native LinkedIn Article ──────────────────────────────────────────────
  {
    slot: "linkedin-article-en", title: "Renewal Clause Basics (LinkedIn Article)", format: "counsel_note",
    locale: "en-CA", destination: "linkedin_article",
    requiredAssets: [
      { assetRole: "native_linkedin_article_cover", destination: "linkedin_article", width: 1200, height: 627, textPolicy: "text_bearing", overlayLanguage: "en", safeArea: "keep text within the center 80%", requiredCopy: "Renewal Clause Basics", selectedAssetId: uid("linkedin-article-en-cover") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "placed", approvalStatus: "approved",
  },
  {
    slot: "linkedin-article-pt", title: "Cláusula de Renovação (Artigo do LinkedIn)", format: "counsel_note",
    locale: "pt-BR", destination: "linkedin_article",
    requiredAssets: [
      { assetRole: "native_linkedin_article_cover", destination: "linkedin_article", width: 1200, height: 627, textPolicy: "text_bearing", overlayLanguage: "pt", safeArea: "keep text within the center 80%", requiredCopy: "Cláusula de Renovação", selectedAssetId: uid("linkedin-article-pt-cover") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "placed", approvalStatus: "approved",
  },
  // ── LinkedIn post ────────────────────────────────────────────────────────
  {
    slot: "linkedin-post-en", title: "Renewal Clause: quick take (LinkedIn post)", format: "counsel_note",
    locale: "en-CA", destination: "linkedin_post",
    requiredAssets: [
      { assetRole: "linkedin_post_card", destination: "linkedin_post", width: 1200, height: 1200, textPolicy: "text_bearing", overlayLanguage: "en", safeArea: "keep text within the center 80%", requiredCopy: "Renewal Clause: what to check first", selectedAssetId: uid("linkedin-post-en-card") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "not_placed", approvalStatus: "in_review",
  },
  {
    slot: "linkedin-post-pt", title: "Cláusula de Renovação: resumo rápido (post do LinkedIn)", format: "counsel_note",
    locale: "pt-BR", destination: "linkedin_post",
    requiredAssets: [
      { assetRole: "linkedin_post_card", destination: "linkedin_post", width: 1200, height: 1200, textPolicy: "text_bearing", overlayLanguage: "pt", safeArea: "keep text within the center 80%", requiredCopy: "Cláusula de Renovação: o que verificar primeiro", selectedAssetId: uid("linkedin-post-pt-card") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "not_placed", approvalStatus: "in_review",
  },
  // ── Google Business Profile ──────────────────────────────────────────────
  {
    // The "one release-ready slot" fixture property.
    slot: "gbp-post-en", title: "Renewal season reminder (GBP)", format: "google_business_profile_post",
    locale: "en-CA", destination: "google_business_profile",
    requiredAssets: [
      { assetRole: "gbp_card", destination: "google_business_profile", width: 1200, height: 900, textPolicy: "text_bearing", overlayLanguage: "en", safeArea: "keep text within the center 80%", requiredCopy: "Renewal season is here", selectedAssetId: uid("gbp-post-en-card") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "placed", approvalStatus: "approved",
  },
  {
    slot: "gbp-post-pt", title: "Lembrete da temporada de renovação (GBP)", format: "google_business_profile_post",
    locale: "pt-BR", destination: "google_business_profile",
    requiredAssets: [
      { assetRole: "gbp_card", destination: "google_business_profile", width: 1200, height: 900, textPolicy: "text_bearing", overlayLanguage: "pt", safeArea: "keep text within the center 80%", requiredCopy: "A temporada de renovação chegou", selectedAssetId: uid("gbp-post-pt-card") },
    ],
    cta: NO_CTA, pdfAssetId: null, placementStatus: "not_placed", approvalStatus: "draft",
  },
  // ── Lead Magnet Document (+ PDF) ─────────────────────────────────────────
  {
    slot: "lead-magnet-document-en", title: "Renewal Clause Checklist (document)", format: "lead_magnet_document",
    locale: "en-CA", destination: "lead_magnet_document",
    requiredAssets: [
      { assetRole: "lead_magnet_document_hero", destination: "lead_magnet_document", width: 1200, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: uid("lead-magnet-document-en-hero") },
      { assetRole: "pdf_document", destination: "lead_magnet_document", width: 0, height: 0, textPolicy: "platform_rendered_text", overlayLanguage: null, safeArea: "n/a -- PDF, not an image", requiredCopy: null, selectedAssetId: uid("lead-magnet-document-en-pdf") },
    ],
    cta: { required: true, label: "Download the Renewal Clause Checklist (PDF)", target: "https://drglaw.ca/downloads/renewal-clause-checklist-en.pdf", behavior: "download" },
    pdfAssetId: uid("lead-magnet-document-en-pdf"), placementStatus: "placed", approvalStatus: "approved",
  },
  {
    slot: "lead-magnet-document-pt", title: "Checklist da Cláusula de Renovação (documento)", format: "lead_magnet_document",
    locale: "pt-BR", destination: "lead_magnet_document",
    requiredAssets: [
      { assetRole: "lead_magnet_document_hero", destination: "lead_magnet_document", width: 1200, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: uid("lead-magnet-document-pt-hero") },
      { assetRole: "pdf_document", destination: "lead_magnet_document", width: 0, height: 0, textPolicy: "platform_rendered_text", overlayLanguage: null, safeArea: "n/a -- PDF, not an image", requiredCopy: null, selectedAssetId: uid("lead-magnet-document-pt-pdf") },
    ],
    cta: { required: true, label: "Baixe o Checklist da Cláusula de Renovação (PDF)", target: "https://drglaw.ca/downloads/renewal-clause-checklist-pt.pdf", behavior: "download" },
    pdfAssetId: uid("lead-magnet-document-pt-pdf"), placementStatus: "placed", approvalStatus: "approved",
  },
  // ── Lead Magnet Landing Page ─────────────────────────────────────────────
  {
    slot: "lead-magnet-landing-en", title: "Renewal Clause Checklist (landing page)", format: "lead_magnet_landing_page",
    locale: "en-CA", destination: "lead_magnet_landing_page",
    requiredAssets: [
      { assetRole: "lead_magnet_landing_page_hero", destination: "lead_magnet_landing_page", width: 1600, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: uid("lead-magnet-landing-en-hero") },
    ],
    cta: { required: true, label: "Download the Renewal Clause Checklist (PDF)", target: "https://drglaw.ca/downloads/renewal-clause-checklist-en.pdf", behavior: "download" },
    pdfAssetId: uid("lead-magnet-document-en-pdf"), placementStatus: "placed", approvalStatus: "approved",
  },
  {
    // The "one blocked slot" fixture property (see DRG_CANDIDATE_ASSETS below
    // for the blocked candidate itself).
    slot: "lead-magnet-landing-pt", title: "Checklist da Cláusula de Renovação (landing page)", format: "lead_magnet_landing_page",
    locale: "pt-BR", destination: "lead_magnet_landing_page",
    requiredAssets: [
      { assetRole: "lead_magnet_landing_page_hero", destination: "lead_magnet_landing_page", width: 1600, height: 900, textPolicy: "textless", overlayLanguage: null, safeArea: "keep all text 80px from every edge", requiredCopy: null, selectedAssetId: null },
    ],
    cta: { required: true, label: "Baixe o Checklist da Cláusula de Renovação (PDF)", target: "https://drglaw.ca/downloads/renewal-clause-checklist-pt.pdf", behavior: "download" },
    pdfAssetId: uid("lead-magnet-document-pt-pdf"), placementStatus: "release_blocked", approvalStatus: "in_review",
  },
];

if (PIECES.length !== 16) {
  throw new Error(`DRG renewal week fixture must have exactly 16 pieces, has ${PIECES.length}`);
}

/**
 * Returns a fresh raw manifest object (snake_case, as validatePackageManifest
 * expects) that passes validation cleanly. Every call deep-clones -- callers
 * (including this file's own test suite) routinely mutate the returned
 * object in place to build broken variants, and PIECES is shared module
 * state, so returning it via structuredClone here is what keeps any two
 * calls independent instead of one test's mutation leaking into the next.
 */
export function baseManifestJson(): Record<string, unknown> {
  return structuredClone({
    schema_version: 1,
    firm_id: DRG_FIRM_ID,
    period_id: DRG_RENEWAL_PERIOD_ID,
    expected_piece_count: 16,
    revision: 1,
    pieces: PIECES.map((p) => ({
      content_slot_id: p.slot,
      deliverable_id: null,
      source_deliverable_id: null,
      source_version_id: uid(`${p.slot}-source-version`),
      reader_title: p.title,
      format_family: p.format,
      locale: p.locale,
      destination: p.destination,
      body_relationship: "adapted_from_source_deliverable",
      required_assets: p.requiredAssets.map((a) => ({
        asset_role: a.assetRole,
        locale: p.locale,
        destination: a.destination,
        required_width: a.width,
        required_height: a.height,
        text_policy: a.textPolicy,
        overlay_language: a.overlayLanguage,
        safe_area: a.safeArea,
        required_copy: a.requiredCopy,
        selected_asset_id: a.selectedAssetId,
      })),
      cta: p.cta,
      pdf_asset_id: p.pdfAssetId,
      planned_publish_at: null,
      placement_status: p.placementStatus,
      approval_status: p.approvalStatus,
    })),
  });
}

/** Deep-clones and mutates the base manifest to inject exactly one deliberate cross-locale overlay error (Section 21: "one cross-locale error") -- an "en" overlay_language on the pt-BR Decision Tool piece's text-bearing... this piece is textless in the base fixture, so this mutator additionally flips its text_policy so the overlay-language check actually fires, isolating this from every other rule. */
export function withCrossLocaleOverlayError(manifest: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(manifest);
  const pieces = clone.pieces as Array<Record<string, unknown>>;
  const piece = pieces.find((p) => p.content_slot_id === "decision-tool-pt")!;
  const asset = (piece.required_assets as Array<Record<string, unknown>>)[0];
  asset.text_policy = "text_bearing";
  asset.overlay_language = "en"; // wrong: this piece's locale is pt-BR, expected overlay is "pt"
  return clone;
}

/** Section 21: "one wrong-role error" -- reassigns the LinkedIn Article cover requirement to a LinkedIn post card role. */
export function withWrongRoleAsset(manifest: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(manifest);
  const pieces = clone.pieces as Array<Record<string, unknown>>;
  const piece = pieces.find((p) => p.content_slot_id === "linkedin-article-en")!;
  const asset = (piece.required_assets as Array<Record<string, unknown>>)[0];
  asset.asset_role = "linkedin_post_card"; // wrong: this slot requires native_linkedin_article_cover
  return clone;
}

/** Section 21: "one Files-hub CTA error" -- a lead-magnet CTA pointing at the portal Files hub instead of the direct PDF. */
export function withFilesHubCta(manifest: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(manifest);
  const pieces = clone.pieces as Array<Record<string, unknown>>;
  const piece = pieces.find((p) => p.content_slot_id === "lead-magnet-document-en")!;
  (piece.cta as Record<string, unknown>).target = "/files/renewal-clause-checklist-en.pdf";
  return clone;
}

/**
 * Three candidates for the Counsel Note EN website hero requirement
 * (Section 21: "at least three candidate images for one slot", plus one
 * selected / one rejected / one superseded from that same set), and one
 * blocked candidate for the Lead Magnet Landing Page PT slot (Section 21:
 * "one blocked slot").
 */
export const DRG_CANDIDATE_ASSETS: AssetGuardCandidate[] = [
  {
    id: uid("counsel-note-en-hero-selected"),
    role: "website_article_hero", locale: "en-CA", destination: "website",
    overlayLanguage: null, width: 1600, height: 900,
    sha256: "a".repeat(64),
    status: "release_ready", isSelected: true,
  },
  {
    id: uid("counsel-note-en-hero-rejected"),
    role: "website_article_hero", locale: "en-CA", destination: "website",
    overlayLanguage: null, width: 1600, height: 900,
    sha256: "b".repeat(64),
    status: "rejected", isSelected: false,
  },
  {
    id: uid("counsel-note-en-hero-superseded"),
    role: "website_article_hero", locale: "en-CA", destination: "website",
    overlayLanguage: null, width: 1600, height: 900,
    sha256: "c".repeat(64),
    status: "superseded", isSelected: false,
  },
  {
    id: uid("lead-magnet-landing-pt-hero-blocked"),
    role: "lead_magnet_landing_page_hero", locale: "pt-BR", destination: "lead_magnet_landing_page",
    overlayLanguage: null, width: 1600, height: 900,
    sha256: "d".repeat(64),
    status: "blocked", isSelected: false,
  },
];

export const COUNSEL_NOTE_EN_HERO_CANDIDATE_GROUP_ID = CANDIDATE_GROUP_COUNSEL_NOTE_EN_HERO;
