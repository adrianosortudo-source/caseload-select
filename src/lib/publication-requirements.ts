/**
 * Publication Readiness, Workstream 3: requirement profiles.
 *
 * What a deliverable needs before it can be called publishable is a function
 * of its deliverable_role, locale, and publication_destination — never a
 * scattered title check. This module is the single, typed, unit-tested
 * source of that mapping. publication-readiness.ts (Workstream 4) is the
 * only consumer; it evaluates each requirement against real evidence and
 * never invents a requirement of its own.
 *
 * Doctrine this encodes (00_System/01_Doctrine/DECISION_RECORDS.md):
 *   DR-093 Content-complete and publishable are separate states.
 *   DR-094 Approval binds to immutable artifact bytes.
 * And the three Authority playbooks:
 *   PB_Authority_ContentArtifactReleaseRegister_v1.md
 *   PB_Authority_MultilingualPublishability_v1.md
 *   PB_Authority_LeadMagnetProduction_v2.md
 *
 * No I/O. No Supabase. Pure data in, pure data out.
 */

import type { ContentDeliverable, DeliverableRole } from "./types";

export type RequirementKey =
  | "current_body"
  | "current_version_approved"
  | "hero_image"
  | "webpage_artifact"
  | "webpage_validated"
  | "localized_route"
  | "publication_destination_set"
  | "pdf_artifact"
  | "pdf_bytes_bound"
  | "pdf_validated"
  | "landing_page_placement"
  | "form_present"
  | "delivery_email_present"
  | "thank_you_page_present"
  | "journey_validated"
  | "campaign_image"
  | "destination_configuration"
  | "publish_schedule_set"
  | "role_and_locale_known";

export interface RequirementSpec {
  key: RequirementKey;
  label: string;
  blocking: boolean;
}

const ALWAYS_FIRST: RequirementSpec[] = [
  { key: "role_and_locale_known", label: "Deliverable role and locale are set", blocking: true },
  { key: "current_body", label: "Current version has content", blocking: true },
  { key: "current_version_approved", label: "Current version is legally approved", blocking: true },
];

const ARTICLE: RequirementSpec[] = [
  ...ALWAYS_FIRST,
  { key: "hero_image", label: "Hero image is bound to the current version", blocking: true },
  { key: "webpage_artifact", label: "Webpage is deployed for the current version", blocking: true },
  { key: "localized_route", label: "Localized route exists for this locale", blocking: true },
  { key: "publication_destination_set", label: "Publication destination and path are set", blocking: true },
  { key: "webpage_validated", label: "Webpage passed its last validation", blocking: true },
];

const LEAD_MAGNET_PDF: RequirementSpec[] = [
  ...ALWAYS_FIRST,
  { key: "pdf_artifact", label: "PDF artifact is bound to the current version", blocking: true },
  { key: "pdf_bytes_bound", label: "PDF has SHA-256, size, and MIME type recorded", blocking: true },
  { key: "pdf_validated", label: "PDF passed its accessibility/technical validation", blocking: true },
  { key: "landing_page_placement", label: "A landing page placement is recorded for this file", blocking: true },
];

const LANDING_PAGE: RequirementSpec[] = [
  ...ALWAYS_FIRST,
  { key: "webpage_artifact", label: "Landing page is deployed for the current version", blocking: true },
  { key: "localized_route", label: "Localized route exists for this locale", blocking: true },
  { key: "form_present", label: "Form is present and configured", blocking: true },
  { key: "delivery_email_present", label: "Delivery email is configured", blocking: true },
  { key: "thank_you_page_present", label: "Thank-you experience is present", blocking: true },
  { key: "journey_validated", label: "Full journey passed its last validation", blocking: true },
];

const SOCIAL_OR_GBP_BASE: RequirementSpec[] = [
  ...ALWAYS_FIRST,
  { key: "campaign_image", label: "Campaign image is bound to the current version", blocking: true },
  { key: "destination_configuration", label: "Destination account/configuration is set", blocking: true },
];

const GBP_POST: RequirementSpec[] = [
  ...SOCIAL_OR_GBP_BASE,
  { key: "publish_schedule_set", label: "Publish date or schedule is set", blocking: true },
];

const PROFILE_BY_ROLE: Record<DeliverableRole, RequirementSpec[]> = {
  article: ARTICLE,
  lead_magnet_pdf: LEAD_MAGNET_PDF,
  landing_page: LANDING_PAGE,
  social_post: SOCIAL_OR_GBP_BASE,
  gbp_post: GBP_POST,
};

/**
 * The requirement list for a role, before any per-row override is applied.
 * Exported for tests and for any surface that wants to show "what this role
 * normally needs" independent of a specific deliverable.
 */
export function profileForRole(role: DeliverableRole): RequirementSpec[] {
  return PROFILE_BY_ROLE[role];
}

/**
 * Resolves the actual requirement set for a specific deliverable: the
 * role's profile, with the four requires_* override columns applied where
 * the deliverable sets them (NULL always means "keep the profile
 * default"). Unknown/missing role returns just the role_and_locale_known
 * check so the evaluator fails closed with a clear reason rather than
 * throwing.
 */
export function resolveRequirements(
  deliverable: Pick<
    ContentDeliverable,
    | "deliverable_role"
    | "locale"
    | "requires_legal_approval"
    | "requires_image"
    | "requires_file"
    | "requires_localized_route"
  >,
): RequirementSpec[] {
  if (!deliverable.deliverable_role) {
    return [ALWAYS_FIRST[0]];
  }

  const base = profileForRole(deliverable.deliverable_role);

  const overrides: Partial<Record<RequirementKey, boolean>> = {};
  if (deliverable.requires_legal_approval === false) {
    overrides.current_version_approved = false;
  }
  if (deliverable.requires_image === false) {
    overrides.hero_image = false;
    overrides.campaign_image = false;
  }
  if (deliverable.requires_file === false) {
    overrides.pdf_artifact = false;
    overrides.pdf_bytes_bound = false;
    overrides.pdf_validated = false;
  }
  // requires_localized_route: NULL means "the profile default applies,
  // which is true whenever locale is not the firm's default locale
  // (en-CA)." An explicit false always wins; an explicit true only matters
  // for roles that don't already require it (none today, kept for
  // forward-compatibility rather than dropped).
  const localeIsNonDefault = deliverable.locale != null && deliverable.locale !== "en-CA";
  if (deliverable.requires_localized_route === false) {
    overrides.localized_route = false;
  } else if (deliverable.requires_localized_route === null && !localeIsNonDefault) {
    overrides.localized_route = false;
  }

  if (Object.keys(overrides).length === 0) return base;

  // A requirement whose override sets it to non-blocking is kept in the
  // list (never silently dropped) so the evaluator can still surface it as
  // "not_required" — an explicit, visible state, not a disappearance.
  return base.map((spec) =>
    spec.key in overrides ? { ...spec, blocking: overrides[spec.key] as boolean } : spec,
  );
}
