/**
 * Publication Operator, Workstream 2: destination-specific format/config
 * checks. Pure, no I/O. Evaluates a PublicationExecutionManifest's already-
 * loaded fields (publication-execution-manifest.ts) against each
 * destination's own platform constraints -- this is a PRE-publish shape
 * check, distinct from channel-validation.ts's POST-publish evidence check
 * (does a receipt's claimed URL/hash actually resolve). Neither module
 * duplicates the other: this one asks "would this content be accepted by
 * the destination," channel-validation.ts asks "did it actually get
 * published, and is the proof real."
 *
 * Platform limits below are documented public platform limits as commonly
 * published (LinkedIn feed post 3,000 chars; LinkedIn article body up to
 * ~110,000-125,000 chars, headline up to 220 chars; Google Business
 * Profile local-post body 1,500 chars, one image min 400x300px/5MB,
 * CTA action types LEARN_MORE | BOOK | ORDER | SHOP | SIGN_UP | CALL,
 * every type except CALL requires an HTTPS cta url), current as of this
 * build (2026-07). Re-verify against LinkedIn's and Google's own current
 * developer documentation before any future release-ladder step that adds
 * live API calls -- this module never calls either platform, so it cannot
 * self-detect drift.
 */

import type { PublicationExecutionManifest } from "@/lib/publication-execution-manifest";

export const LINKEDIN_POST_MAX_CHARS = 3000;
export const LINKEDIN_COMPANY_PAGE_POST_MAX_CHARS = 3000;
export const LINKEDIN_ARTICLE_HEADLINE_MAX_CHARS = 220;
export const LINKEDIN_ARTICLE_BODY_MAX_CHARS = 110000;
export const GBP_POST_BODY_MAX_CHARS = 1500;
export const GBP_CTA_ACTION_TYPES = ["LEARN_MORE", "BOOK", "ORDER", "SHOP", "SIGN_UP", "CALL"] as const;

export interface DestinationValidationIssue {
  code: string;
  severity: "block" | "warn";
  message: string;
}

function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function validateWebsiteFormat(manifest: PublicationExecutionManifest): DestinationValidationIssue[] {
  const issues: DestinationValidationIssue[] = [];
  if (!manifest.canonicalUrl) {
    // Already reflected in manifest.blockReasons (missing config/path); no
    // duplicate blocking issue here, only a defense-in-depth guard so this
    // function never assumes a URL exists before parsing it below.
    return issues;
  }
  let path: string;
  try {
    path = new URL(manifest.canonicalUrl).pathname;
  } catch {
    issues.push({ code: "canonical_url_unparseable", severity: "block", message: "canonical URL is not a valid URL" });
    return issues;
  }
  if (!/^\/[a-z0-9\-/]*$/.test(path)) {
    issues.push({
      code: "slug_non_canonical_characters",
      severity: "warn",
      message: `path "${path}" contains characters outside the conventional lowercase/hyphen slug pattern`,
    });
  }
  if (!manifest.locale) {
    issues.push({ code: "website_missing_locale", severity: "block", message: "website placement has no locale set" });
  }
  return issues;
}

function validateLinkedInPostFormat(manifest: PublicationExecutionManifest, maxChars: number): DestinationValidationIssue[] {
  const issues: DestinationValidationIssue[] = [];
  if (typeof manifest.body === "string") {
    const plain = stripHtmlToPlainText(manifest.body);
    if (plain.length > maxChars) {
      issues.push({
        code: "linkedin_post_over_limit",
        severity: "block",
        message: `post body is ${plain.length} characters, exceeds the ${maxChars}-character LinkedIn feed post limit`,
      });
    }
    if (plain.length === 0) {
      issues.push({ code: "linkedin_post_empty", severity: "block", message: "post body is empty after stripping markup" });
    }
  }
  return issues;
}

function validateLinkedInArticleFormat(manifest: PublicationExecutionManifest): DestinationValidationIssue[] {
  const issues: DestinationValidationIssue[] = [];
  if (manifest.title && manifest.title.length > LINKEDIN_ARTICLE_HEADLINE_MAX_CHARS) {
    issues.push({
      code: "linkedin_article_headline_over_limit",
      severity: "block",
      message: `headline is ${manifest.title.length} characters, exceeds the ${LINKEDIN_ARTICLE_HEADLINE_MAX_CHARS}-character LinkedIn article headline limit`,
    });
  }
  if (typeof manifest.body === "string") {
    const plain = stripHtmlToPlainText(manifest.body);
    if (plain.length > LINKEDIN_ARTICLE_BODY_MAX_CHARS) {
      issues.push({
        code: "linkedin_article_body_over_limit",
        severity: "block",
        message: `article body is ${plain.length} characters, exceeds the ${LINKEDIN_ARTICLE_BODY_MAX_CHARS}-character LinkedIn article limit`,
      });
    }
  }
  const hasCoverImage = manifest.assets.some((a) => a.artifactType === "hero_image" || a.artifactType === "social_image");
  if (!hasCoverImage) {
    issues.push({
      code: "linkedin_article_missing_cover_image",
      severity: "warn",
      message: "no hero_image or social_image asset registered for this LinkedIn article",
    });
  }
  return issues;
}

function validateGbpFormat(manifest: PublicationExecutionManifest): DestinationValidationIssue[] {
  const issues: DestinationValidationIssue[] = [];
  if (typeof manifest.body === "string") {
    const plain = stripHtmlToPlainText(manifest.body);
    if (plain.length > GBP_POST_BODY_MAX_CHARS) {
      issues.push({
        code: "gbp_post_over_limit",
        severity: "block",
        message: `post body is ${plain.length} characters, exceeds the ${GBP_POST_BODY_MAX_CHARS}-character Google Business Profile post limit`,
      });
    }
    if (plain.length === 0) {
      issues.push({ code: "gbp_post_empty", severity: "block", message: "post body is empty after stripping markup" });
    }
  }
  const hasImage = manifest.assets.some((a) => a.artifactType === "social_image" || a.artifactType === "hero_image");
  if (!hasImage) {
    issues.push({
      code: "gbp_missing_image",
      severity: "block",
      message: "Google Business Profile posts require at least one image; none registered for this version",
    });
  }
  if (!manifest.ctaTargetPath) {
    issues.push({
      code: "gbp_missing_cta_target",
      severity: "warn",
      message: "no cta_target_path recorded; a GBP post with a call-to-action button (every type except CALL) needs a destination URL",
    });
  }
  return issues;
}

function validateEmailFormat(manifest: PublicationExecutionManifest): DestinationValidationIssue[] {
  const issues: DestinationValidationIssue[] = [];
  if (typeof manifest.body === "string" && stripHtmlToPlainText(manifest.body).length === 0) {
    issues.push({ code: "email_body_empty", severity: "block", message: "email body is empty after stripping markup" });
  }
  return issues;
}

/**
 * Runs the format/config checks for whichever destination the manifest is
 * bound to. Never transforms manifest.body or manifest.title -- these are
 * read-only checks against the exact approved content, matching the "no
 * transformation of approved copy" instruction.
 */
export function validateDestinationFormat(manifest: PublicationExecutionManifest): DestinationValidationIssue[] {
  switch (manifest.destination) {
    case "firm_website":
      return validateWebsiteFormat(manifest);
    case "linkedin_post":
      return validateLinkedInPostFormat(manifest, LINKEDIN_POST_MAX_CHARS);
    case "linkedin_company_page":
      return validateLinkedInPostFormat(manifest, LINKEDIN_COMPANY_PAGE_POST_MAX_CHARS);
    case "linkedin_article":
      return validateLinkedInArticleFormat(manifest);
    case "google_business_profile":
      return validateGbpFormat(manifest);
    case "email_delivery":
      return validateEmailFormat(manifest);
    default:
      return [];
  }
}
