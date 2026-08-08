/**
 * Phase 2.1 (F3): canon required_assets shapes, generated from Week 3's live,
 * shipped publishing_packages.manifest (period 9eaf6b3b-..., package
 * 807a3984-...; queried in full during Phase 2.1 and cross-checked field for
 * field against the values below -- they match exactly). Ported from
 * ToDelete/kit-build-manifest.mts's HERO/MASTER/PDFDOC/GBP_CARD/LI_COVER/
 * LI_CARD factories verbatim (Standing Rule 4): same field values, same
 * defaults, generalized into one dispatcher keyed by piece type instead of
 * being re-typed per week.
 *
 * Regeneration: to re-derive these shapes from a different canonical week,
 * query that week's publishing_packages.manifest and diff its pieces[].
 * required_assets against the factories below -- never auto-run, per F3.
 */
import type { PackageLocale } from "../../../src/lib/publishing-package-control-room-manifest";

export interface RequiredAssetShape {
  locale: PackageLocale;
  safe_area: string;
  asset_role: string;
  destination: string;
  text_policy: string;
  required_copy: null;
  required_width: number;
  required_height: number;
  overlay_language: string | null;
  selected_asset_id: null;
}

export type AssetShapeKind =
  | "articleHero"
  | "leadMagnetHero"
  | "minuteMaster"
  | "decisionTool"
  | "gbpCard"
  | "linkedinCover"
  | "linkedinCard";

function hero(locale: PackageLocale): RequiredAssetShape {
  return {
    locale,
    safe_area: "Keep the full text-free image available for website cropping.",
    asset_role: "website_article_hero",
    destination: "website",
    text_policy: "textless",
    required_copy: null,
    required_width: 1200,
    required_height: 628,
    overlay_language: null,
    selected_asset_id: null,
  };
}

function leadMagnetHero(locale: PackageLocale): RequiredAssetShape {
  return {
    ...hero(locale),
    asset_role: "lead_magnet_landing_page_hero",
    safe_area: "Keep the full text-free image available for landing-page cropping.",
  };
}

function master(locale: PackageLocale, destination: string): RequiredAssetShape {
  return {
    locale,
    safe_area: "Keep the full canonical image available for the required rendition.",
    asset_role: "canonical_textless_master",
    destination,
    text_policy: "textless",
    required_copy: null,
    required_width: 1200,
    required_height: 628,
    overlay_language: null,
    selected_asset_id: null,
  };
}

function pdfDoc(locale: PackageLocale): RequiredAssetShape {
  return {
    locale,
    safe_area: "Keep the full document available for the required rendition.",
    asset_role: "pdf_document",
    destination: "firm_website",
    text_policy: "text_bearing",
    required_copy: null,
    required_width: 0,
    required_height: 0,
    overlay_language: null,
    selected_asset_id: null,
  };
}

function gbpCard(): RequiredAssetShape {
  return {
    locale: "en-CA",
    safe_area: "Keep all overlay text inside the approved card safe area.",
    asset_role: "gbp_card",
    destination: "google_business_profile",
    text_policy: "text_bearing",
    required_copy: null,
    required_width: 1200,
    required_height: 900,
    overlay_language: "en",
    selected_asset_id: null,
  };
}

function linkedinCover(): RequiredAssetShape {
  return {
    locale: "en-CA",
    safe_area: "Keep all overlay text inside the approved LinkedIn cover safe area.",
    asset_role: "native_linkedin_article_cover",
    destination: "linkedin",
    text_policy: "text_bearing",
    required_copy: null,
    required_width: 1200,
    required_height: 628,
    overlay_language: "en",
    selected_asset_id: null,
  };
}

function linkedinCard(): RequiredAssetShape {
  return {
    locale: "en-CA",
    safe_area: "Keep all overlay text inside the approved LinkedIn safe area.",
    asset_role: "linkedin_post_card",
    destination: "linkedin",
    text_policy: "text_bearing",
    required_copy: null,
    required_width: 1200,
    required_height: 1200,
    overlay_language: "en",
    selected_asset_id: null,
  };
}

export function buildRequiredAssets(shape: AssetShapeKind, locale: PackageLocale): RequiredAssetShape[] {
  switch (shape) {
    case "articleHero":
      return [hero(locale)];
    case "leadMagnetHero":
      return [leadMagnetHero(locale)];
    case "minuteMaster":
      return [master(locale, "email")];
    case "decisionTool":
      return [master(locale, "firm_website"), pdfDoc(locale)];
    case "gbpCard":
      return [gbpCard()];
    case "linkedinCover":
      return [linkedinCover()];
    case "linkedinCard":
      return [linkedinCard()];
  }
}

export const CTA_NONE = { label: null, target: null, behavior: "none" as const, required: false };
export const CTA_DOWNLOAD = { label: null, target: null, behavior: "download" as const, required: false };
