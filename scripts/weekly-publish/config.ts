/**
 * weekly-publish per-week configuration (F13).
 *
 * ID constants and evidence-table data for one week live in ONE entry here,
 * keyed by "--week" (e.g. "2026-W32"). A future week adds a new entry to
 * WEEKS; nothing else in the tool changes.
 */
import type { AssetShapeKind } from "./canon/manifest-shapes";

export type ArtifactType =
  | "hero_image"
  | "social_image"
  | "pdf"
  | "webpage"
  | "email"
  | "thank_you_page"
  | "form"
  | "external_post";

export type Destination = "firm_website" | "linkedin" | "google_business_profile";

export interface EvidenceRowConfig {
  deliverableId: string;
  /** Human-readable label for logs and STOP messages only, not written to the DB. */
  label: string;
  artifactType: ArtifactType;
  destination: Destination;
  locale: string;
  /**
   * Relative to the week root's assets/ dir (Appendix A). Reference only:
   * register-evidence sources bytes from the deliverable's already-uploaded
   * hero_image_url in storage (the proven ToDelete/register-w32-evidence.mjs
   * mechanism), never from this local path. The gate command reads this
   * path directly for the manifest sha256 check (F11).
   */
  file: string;
  /**
   * Expected sha256 of the asset (Appendix A). register-evidence verifies
   * the storage-sourced bytes against this before insert (mismatch stops
   * the run); the DB row itself still stores sha256: null, matching Week 3
   * canon exactly (Phase 0.1 / Amendments).
   */
  sha256: string;
}

export interface PdfEvidenceRowConfig {
  deliverableId: string;
  label: string;
  locale: string;
}

export interface PieceConfig {
  contentSlotId: string;
  deliverableId: string;
  formatFamily: string;
  locale: "en-CA" | "pt-BR";
  /** Piece-level channel destination (article/gbp_post/linkedin_article/etc.), distinct from a required_asset's own narrower destination vocabulary (canon/manifest-shapes.ts). */
  destination: string;
  assetShape: AssetShapeKind;
  cta: "none" | "download";
}

export interface KitAssetRowConfig {
  contentSlotId: string;
  assetRole: string;
  locale: "en-CA" | "pt-BR";
  /** Matches the required_asset's own destination vocabulary (canon/manifest-shapes.ts), not the piece-level channel. */
  destination: string;
  /** Local file path (image rows), relative to the week root. Null for PDF rows, sourced from Storage instead. */
  file: string | null;
  /** Storage object path for PDF rows (already uploaded via bind-checklist-pdf-artifact.ts). Null for image rows. */
  storagePath: string | null;
  sha256: string;
  altText: string;
  textPolicy: "textless" | "text_bearing" | "platform_rendered_text";
  overlayLanguage: "en" | "pt" | null;
}

export interface WeekConfig {
  week: string;
  firmId: string;
  periodId: string;
  packageId: string;
  bodyRelationship: string;
  expectedPieceCount: number;
  evidence: EvidenceRowConfig[];
  pdfEvidence: PdfEvidenceRowConfig[];
  pieces: PieceConfig[];
  kitAssets: KitAssetRowConfig[];
}

export const WEEKS: Record<string, WeekConfig> = {
  "2026-W32": {
    week: "2026-W32",
    firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
    periodId: "19911577-6e6f-45ba-a9b9-73a93a4f230c",
    packageId: "60aaec09-8c7c-4bd6-98d0-34889427d711",
    bodyRelationship: "week_4_federal_annual_filing_package",
    expectedPieceCount: 16,

    evidence: [
      {
        deliverableId: "3d3d71d5-7c97-4e9c-a0c5-cbb3ec4ea90a",
        label: "article EN (Counsel Note)",
        artifactType: "hero_image",
        destination: "firm_website",
        locale: "en-CA",
        file: "assets/website/counsel-note-article-hero-v2.png",
        sha256: "4d597a3c109445ed89e0dec881acaf56a664220216b3cb19d61fcbd8284d6abb",
      },
      {
        deliverableId: "5c959092-3468-43b1-8eb6-ef26733b6644",
        label: "article PT (Counsel Note)",
        artifactType: "hero_image",
        destination: "firm_website",
        locale: "pt-BR",
        file: "assets/website/counsel-note-article-hero-v2.png",
        sha256: "4d597a3c109445ed89e0dec881acaf56a664220216b3cb19d61fcbd8284d6abb",
      },
      {
        deliverableId: "1452704a-286c-488d-8393-c1d5e3ec97ce",
        label: "article EN (Clause)",
        artifactType: "hero_image",
        destination: "firm_website",
        locale: "en-CA",
        file: "assets/website/clause-margin-article-hero-v3.png",
        sha256: "3e36667f05cc8e44023db5345bd5f13baa46788c5a099aa68666efdb299ae3ed",
      },
      {
        deliverableId: "4eaefa5a-403e-4131-a194-ba63236fabf3",
        label: "article PT (Clause)",
        artifactType: "hero_image",
        destination: "firm_website",
        locale: "pt-BR",
        file: "assets/website/clause-margin-article-hero-v3.png",
        sha256: "3e36667f05cc8e44023db5345bd5f13baa46788c5a099aa68666efdb299ae3ed",
      },
      {
        deliverableId: "cf1b23e3-14b6-41e4-9c7f-0cd952452c0a",
        label: "linkedin article (Counsel)",
        artifactType: "social_image",
        destination: "linkedin",
        locale: "en-CA",
        file: "assets/linkedin/linkedin-counsel-cover-v2.png",
        sha256: "1930eca16454188684e6fee0e89dd2e55ada9d1d3830e3cd4932ebab3415e841",
      },
      {
        deliverableId: "e4cb53a4-c78b-4fd2-a517-bdfa8a51f6c3",
        label: "linkedin article (Clause)",
        artifactType: "social_image",
        destination: "linkedin",
        locale: "en-CA",
        file: "assets/linkedin/linkedin-clause-cover-v3.png",
        sha256: "c1a08980f53e2f8f9f6a3e9ed631f0ed2405ead9787ec2d6f93eebd88e2faa29",
      },
      {
        deliverableId: "5025180f-78af-48e1-8590-15f9b45f3d5c",
        label: "gbp_post (Counsel)",
        artifactType: "social_image",
        destination: "google_business_profile",
        locale: "en-CA",
        file: "assets/gbp/GBP-W32-COUNSEL-NOTE_1200x900.png",
        sha256: "e80f35b79320ef25f05a67ce00cd98441912ce5986a03ec259e4811d10472be3",
      },
      {
        deliverableId: "baedf64c-7112-4150-8bea-751cdede2176",
        label: "gbp_post (Clause)",
        artifactType: "social_image",
        destination: "google_business_profile",
        locale: "en-CA",
        file: "assets/gbp/GBP-W32-CLAUSE_1200x900.png",
        sha256: "ba03f7844485ac5b02c8bf59f94aa869c545d35b04aaad54aacde0d90585d037",
      },
      {
        deliverableId: "59b2833a-f099-4503-aab4-29ee9f17a359",
        label: "gbp_post (Checklist)",
        artifactType: "social_image",
        destination: "google_business_profile",
        locale: "en-CA",
        file: "assets/gbp/GBP-W32-CHECKLIST_1200x900.png",
        sha256: "00aed6d653590998e010ff2eee290793556ef7b3619b3c521a27564c39cef22f",
      },
    ],

    // publication_artifacts 'pdf' rows, one per lead_magnet_pdf deliverable
    // (F5 correction -- see lib/register-pdf-evidence.ts header).
    pdfEvidence: [
      { deliverableId: "66ef8598-178c-40fd-9d1f-42d96ebe5902", label: "checklist EN (Federal Corporation Annual Filing Check)", locale: "en-CA" },
      { deliverableId: "21df651f-4b96-43e9-b01f-6e15a7e56b7c", label: "checklist PT (Verificação anual da empresa federal)", locale: "pt-BR" },
    ],

    // 16 pieces, structural mirror of Week 3's shipped manifest (Phase 0/2.1).
    pieces: [
      { contentSlotId: "counsel-note-en", deliverableId: "3d3d71d5-7c97-4e9c-a0c5-cbb3ec4ea90a", formatFamily: "counsel_note", locale: "en-CA", destination: "firm_website", assetShape: "articleHero", cta: "none" },
      { contentSlotId: "counsel-note-pt", deliverableId: "5c959092-3468-43b1-8eb6-ef26733b6644", formatFamily: "counsel_note", locale: "pt-BR", destination: "firm_website", assetShape: "articleHero", cta: "none" },
      { contentSlotId: "clause-en", deliverableId: "1452704a-286c-488d-8393-c1d5e3ec97ce", formatFamily: "clause_in_the_margin", locale: "en-CA", destination: "firm_website", assetShape: "articleHero", cta: "none" },
      { contentSlotId: "clause-pt", deliverableId: "4eaefa5a-403e-4131-a194-ba63236fabf3", formatFamily: "clause_in_the_margin", locale: "pt-BR", destination: "firm_website", assetShape: "articleHero", cta: "none" },
      { contentSlotId: "minute-en", deliverableId: "6fce8f96-5c08-4cfa-ac77-8241fb1a0dc5", formatFamily: "minute_drg", locale: "en-CA", destination: "email", assetShape: "minuteMaster", cta: "none" },
      { contentSlotId: "gbp-counsel-note-en", deliverableId: "5025180f-78af-48e1-8590-15f9b45f3d5c", formatFamily: "google_business_profile_post", locale: "en-CA", destination: "google_business_profile", assetShape: "gbpCard", cta: "none" },
      { contentSlotId: "gbp-clause-en", deliverableId: "baedf64c-7112-4150-8bea-751cdede2176", formatFamily: "google_business_profile_post", locale: "en-CA", destination: "google_business_profile", assetShape: "gbpCard", cta: "none" },
      { contentSlotId: "gbp-checklist-en", deliverableId: "59b2833a-f099-4503-aab4-29ee9f17a359", formatFamily: "google_business_profile_post", locale: "en-CA", destination: "google_business_profile", assetShape: "gbpCard", cta: "none" },
      { contentSlotId: "lead-magnet-en", deliverableId: "ccdc7eec-9290-46e9-b3b0-c2888f3a600b", formatFamily: "lead_magnet_landing_page", locale: "en-CA", destination: "firm_website", assetShape: "leadMagnetHero", cta: "download" },
      { contentSlotId: "lead-magnet-pt", deliverableId: "b28394af-3dce-45da-bdfb-ad7efd397135", formatFamily: "lead_magnet_landing_page", locale: "pt-BR", destination: "firm_website", assetShape: "leadMagnetHero", cta: "download" },
      { contentSlotId: "checklist-en", deliverableId: "66ef8598-178c-40fd-9d1f-42d96ebe5902", formatFamily: "decision_tool", locale: "en-CA", destination: "firm_website", assetShape: "decisionTool", cta: "none" },
      { contentSlotId: "checklist-pt", deliverableId: "21df651f-4b96-43e9-b01f-6e15a7e56b7c", formatFamily: "decision_tool", locale: "pt-BR", destination: "firm_website", assetShape: "decisionTool", cta: "none" },
      { contentSlotId: "linkedin-counsel-note-en", deliverableId: "cf1b23e3-14b6-41e4-9c7f-0cd952452c0a", formatFamily: "linkedin_article", locale: "en-CA", destination: "linkedin", assetShape: "linkedinCover", cta: "none" },
      { contentSlotId: "linkedin-clause-en", deliverableId: "e4cb53a4-c78b-4fd2-a517-bdfa8a51f6c3", formatFamily: "linkedin_article", locale: "en-CA", destination: "linkedin", assetShape: "linkedinCover", cta: "none" },
      { contentSlotId: "linkedin-post-counsel-note-en", deliverableId: "f09d7604-3dd3-44fd-bead-ce356a0229bb", formatFamily: "linkedin_post", locale: "en-CA", destination: "linkedin", assetShape: "linkedinCard", cta: "none" },
      { contentSlotId: "linkedin-post-clause-en", deliverableId: "2a1c25bf-d7ef-49d5-b373-92fa5ebecd74", formatFamily: "linkedin_post", locale: "en-CA", destination: "linkedin", assetShape: "linkedinCard", cta: "none" },
    ],

    // 11 kit-asset candidates (Appendix B row kit-register-assets.mjs). Image
    // rows verify sha256 against a local file; PDF rows verify against the
    // bucket object at storagePath (Phase 2.2 improvement over the one-off
    // script -- see lib/kit-assets.ts header).
    kitAssets: [
      { contentSlotId: "counsel-note-en", assetRole: "website_article_hero", locale: "en-CA", destination: "website", file: "assets/website/counsel-note-article-hero-v2.png", storagePath: null, sha256: "4d597a3c109445ed89e0dec881acaf56a664220216b3cb19d61fcbd8284d6abb", altText: "Text-free article hero: burgundy minute book in the reading room", textPolicy: "textless", overlayLanguage: null },
      { contentSlotId: "counsel-note-pt", assetRole: "website_article_hero", locale: "pt-BR", destination: "website", file: "assets/website/counsel-note-article-hero-v2.png", storagePath: null, sha256: "4d597a3c109445ed89e0dec881acaf56a664220216b3cb19d61fcbd8284d6abb", altText: "Text-free article hero: burgundy minute book in the reading room", textPolicy: "textless", overlayLanguage: null },
      { contentSlotId: "clause-en", assetRole: "website_article_hero", locale: "en-CA", destination: "website", file: "assets/website/clause-margin-article-hero-v3.png", storagePath: null, sha256: "3e36667f05cc8e44023db5345bd5f13baa46788c5a099aa68666efdb299ae3ed", altText: "Text-free article hero: burgundy minute book in the reading room", textPolicy: "textless", overlayLanguage: null },
      { contentSlotId: "clause-pt", assetRole: "website_article_hero", locale: "pt-BR", destination: "website", file: "assets/website/clause-margin-article-hero-v3.png", storagePath: null, sha256: "3e36667f05cc8e44023db5345bd5f13baa46788c5a099aa68666efdb299ae3ed", altText: "Text-free article hero: burgundy minute book in the reading room", textPolicy: "textless", overlayLanguage: null },
      { contentSlotId: "linkedin-counsel-note-en", assetRole: "native_linkedin_article_cover", locale: "en-CA", destination: "linkedin", file: "assets/linkedin/linkedin-counsel-cover-v2.png", storagePath: null, sha256: "1930eca16454188684e6fee0e89dd2e55ada9d1d3830e3cd4932ebab3415e841", altText: "LinkedIn article cover with baked headline", textPolicy: "text_bearing", overlayLanguage: "en" },
      { contentSlotId: "linkedin-clause-en", assetRole: "native_linkedin_article_cover", locale: "en-CA", destination: "linkedin", file: "assets/linkedin/linkedin-clause-cover-v3.png", storagePath: null, sha256: "c1a08980f53e2f8f9f6a3e9ed631f0ed2405ead9787ec2d6f93eebd88e2faa29", altText: "LinkedIn article cover with baked headline", textPolicy: "text_bearing", overlayLanguage: "en" },
      { contentSlotId: "gbp-counsel-note-en", assetRole: "gbp_card", locale: "en-CA", destination: "google_business_profile", file: "assets/gbp/GBP-W32-COUNSEL-NOTE_1200x900.png", storagePath: null, sha256: "e80f35b79320ef25f05a67ce00cd98441912ce5986a03ec259e4811d10472be3", altText: "GBP typographic card", textPolicy: "text_bearing", overlayLanguage: "en" },
      { contentSlotId: "gbp-clause-en", assetRole: "gbp_card", locale: "en-CA", destination: "google_business_profile", file: "assets/gbp/GBP-W32-CLAUSE_1200x900.png", storagePath: null, sha256: "ba03f7844485ac5b02c8bf59f94aa869c545d35b04aaad54aacde0d90585d037", altText: "GBP typographic card", textPolicy: "text_bearing", overlayLanguage: "en" },
      { contentSlotId: "gbp-checklist-en", assetRole: "gbp_card", locale: "en-CA", destination: "google_business_profile", file: "assets/gbp/GBP-W32-CHECKLIST_1200x900.png", storagePath: null, sha256: "00aed6d653590998e010ff2eee290793556ef7b3619b3c521a27564c39cef22f", altText: "GBP typographic card", textPolicy: "text_bearing", overlayLanguage: "en" },
      { contentSlotId: "checklist-en", assetRole: "pdf_document", locale: "en-CA", destination: "firm_website", file: null, storagePath: "deliverables/eec1d25e-a047-4827-8e4a-6eb96becca2b/66ef8598-178c-40fd-9d1f-42d96ebe5902/artifacts/v3-c02e827c15a145985ddae5df8fd4519e2968cbf8d296570f72131a18fac0e3ad.pdf", sha256: "c02e827c15a145985ddae5df8fd4519e2968cbf8d296570f72131a18fac0e3ad", altText: "Checklist PDF v1.0", textPolicy: "text_bearing", overlayLanguage: "en" },
      { contentSlotId: "checklist-pt", assetRole: "pdf_document", locale: "pt-BR", destination: "firm_website", file: null, storagePath: "deliverables/eec1d25e-a047-4827-8e4a-6eb96becca2b/21df651f-4b96-43e9-b01f-6e15a7e56b7c/artifacts/v3-93a81ac78312830078bbd099a00eb2de1d24d7c05556f5c4c8e02ec9800a1c6a.pdf", sha256: "93a81ac78312830078bbd099a00eb2de1d24d7c05556f5c4c8e02ec9800a1c6a", altText: "Checklist PDF v1.0", textPolicy: "text_bearing", overlayLanguage: "pt" },
    ],
  },
};

export function getWeekConfig(week: string): WeekConfig {
  const cfg = WEEKS[week];
  if (!cfg) {
    throw new Error(`No config for week "${week}". Add an entry to scripts/weekly-publish/config.ts (F13).`);
  }
  return cfg;
}
