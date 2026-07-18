/**
 * Content Studio publishing workflow: placement-tagged tracking
 * parameters. Closes the loop the Content Performance / Content-to-
 * Matter Attribution module (content-attribution-pure.ts) depends on --
 * that module only links a lead's evidence to a placement when
 * utm_content exactly equals a real content_placements.id. Without a
 * publishing workflow that actually tags outbound links this way, every
 * enquiry stays unknown. This module is that tagging step.
 *
 * Deliberately does NOT store or infer a firm's public website domain
 * anywhere -- intake_firms has no such field (custom_domain/subdomain
 * are the CaseLoad app's own white-label routing, not a firm's separate
 * marketing site), and guessing one would be exactly the kind of
 * invented fact this codebase's "No Invention" doctrine forbids. Every
 * function here operates on the query string / whatever base URL the
 * operator supplies, never a fabricated domain.
 */

import type { PlacementDestination } from "@/lib/types";

export type PlacementTrackingMedium = "organic" | "social" | "gbp" | "email";

const DESTINATION_MEDIUM: Record<PlacementDestination, PlacementTrackingMedium> = {
  firm_website: "organic",
  linkedin_article: "social",
  linkedin_post: "social",
  linkedin_company_page: "social",
  google_business_profile: "gbp",
  email_delivery: "email",
};

export const TRACKING_SOURCE = "content_studio";

export interface PlacementTrackingParams {
  utm_source: string;
  utm_medium: PlacementTrackingMedium;
  utm_content: string;
}

/**
 * The tracking parameters for one placement. utm_content is the
 * placement's own id -- the exact identifier
 * deriveObservedEvidence (content-attribution-pure.ts) matches against
 * to link a lead's evidence back to this placement.
 */
export function buildPlacementTrackingParams(
  placementId: string,
  destination: PlacementDestination,
): PlacementTrackingParams {
  return {
    utm_source: TRACKING_SOURCE,
    utm_medium: DESTINATION_MEDIUM[destination],
    utm_content: placementId,
  };
}

export function buildPlacementTrackingQueryString(
  placementId: string,
  destination: PlacementDestination,
): string {
  const params = buildPlacementTrackingParams(placementId, destination);
  return new URLSearchParams({
    utm_source: params.utm_source,
    utm_medium: params.utm_medium,
    utm_content: params.utm_content,
  }).toString();
}

/**
 * Appends this placement's tracking parameters onto a base URL the
 * caller supplies (e.g. the operator's own copy of the published page's
 * URL). Returns null on an unparseable base URL rather than guessing --
 * the caller decides how to surface that.
 */
export function appendPlacementTracking(
  baseUrl: string,
  placementId: string,
  destination: PlacementDestination,
): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  const params = buildPlacementTrackingParams(placementId, destination);
  url.searchParams.set("utm_source", params.utm_source);
  url.searchParams.set("utm_medium", params.utm_medium);
  url.searchParams.set("utm_content", params.utm_content);
  return url.toString();
}

/**
 * Whether a URL's own query string already carries this placement's
 * tracking (utm_content exactly equal to the placement id -- the same
 * exact-match rule content-attribution-pure.ts uses, no fuzzy
 * matching). Used by the publication_receipts release gate: a
 * firm_website receipt's public_url is verifiably the content's own
 * URL, so this is enforceable without knowing the firm's domain in
 * advance.
 */
export function urlCarriesPlacementTracking(candidateUrl: string, placementId: string): boolean {
  let url: URL;
  try {
    url = new URL(candidateUrl);
  } catch {
    return false;
  }
  return url.searchParams.get("utm_content") === placementId;
}
