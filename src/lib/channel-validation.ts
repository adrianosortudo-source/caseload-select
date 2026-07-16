/**
 * Content Studio publishing evidence system, Workstream 6: channel-specific
 * validation. Each validator answers one question -- "does the evidence on
 * this receipt actually support the publication claim it makes" -- and
 * never fabricates a result it cannot check.
 *
 * Website and PDF/lead-magnet destinations are independently verifiable: a
 * plain HTTP request either finds the claimed content live or it does not.
 * LinkedIn and Google Business Profile are NOT independently verifiable
 * here (per mega-assignment doctrine: "do not add direct LinkedIn or GBP
 * publishing automation unless a functioning authorized integration
 * already exists"); their validator can only confirm the RECEIPT itself
 * carries the evidence an operator is expected to supply (a URL/external
 * post id, or a screenshot), never that the live post actually exists.
 * Every result records exactly which question it did and did not answer.
 */

import "server-only";
import { createHash } from "node:crypto";
import { ssrfSafeFetch } from "@/lib/ssrf-fetch";
import type { PlacementDestination, PublicationArtifactType, PublicationReceipt } from "@/lib/types";

export type ChannelValidationOutcome = "verified" | "failed" | "unverifiable";

/**
 * Corrective-release finding 5: the explicit allowlist of destinations
 * where manual (operator-attestation) verification is permitted, because
 * their automated validator (validateSocialReceipt above) can never itself
 * return "verified" or "failed" -- there is no authorized read API to check
 * the live post against, only evidence-presence on the receipt. Every
 * OTHER destination (today: firm_website, which covers both the webpage
 * and PDF sub-cases via validateWebsiteReceipt/validatePdfReceipt) has a
 * real automated check and must go through it; manual verification for
 * those destinations is rejected even for an operator, so URL/byte/hash
 * evidence can never be bypassed by an attestation.
 */
export const MANUALLY_VERIFIABLE_DESTINATIONS: readonly PlacementDestination[] = [
  "linkedin_article",
  "linkedin_post",
  "linkedin_company_page",
  "google_business_profile",
  "email_delivery",
];

export function isManuallyVerifiableDestination(destination: PlacementDestination): boolean {
  return (MANUALLY_VERIFIABLE_DESTINATIONS as PlacementDestination[]).includes(destination);
}

export interface ChannelValidationResult {
  outcome: ChannelValidationOutcome;
  method: "url_fetch" | "operator_attestation";
  checks: Record<string, boolean | string | number | null>;
  reason: string | null;
}

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetches a receipt's public_url with SSRF protection (see ssrf-fetch.ts):
 * HTTPS-only, no embedded credentials, no localhost/private/link-local/CGNAT/
 * cloud-metadata host on the initial URL OR any redirect hop, DNS pinned to
 * the validated address to close the rebinding gap. Returns the finalUrl the
 * request actually landed on after any redirects, since that -- not
 * whatever a naive res.url would report under manual redirect handling -- is
 * what a caller's host-match check must inspect.
 */
async function fetchWithTimeout(url: string, method: string): Promise<{ res: Response; finalUrl: string }> {
  return ssrfSafeFetch(url, { method, timeoutMs: FETCH_TIMEOUT_MS });
}

/**
 * Website destination: the receipt's public_url must be a real, live page.
 * Checks status 200 and, where a firm hostname is supplied, that the
 * resolved URL actually resolves to that firm's own domain -- a live page
 * on someone else's site is not evidence this firm published anything.
 */
export async function validateWebsiteReceipt(
  receipt: Pick<PublicationReceipt, "public_url">,
  expectedHost?: string | null,
): Promise<ChannelValidationResult> {
  if (!receipt.public_url) {
    return {
      outcome: "failed",
      method: "url_fetch",
      checks: { has_url: false },
      reason: "no public_url on this receipt to check",
    };
  }

  let res: Response;
  let finalUrl: string;
  try {
    ({ res, finalUrl } = await fetchWithTimeout(receipt.public_url, "GET"));
  } catch (err) {
    return {
      outcome: "failed",
      method: "url_fetch",
      checks: { has_url: true, fetch_error: err instanceof Error ? err.message : "fetch failed" },
      reason: "could not reach public_url",
    };
  }

  const resolvedHost = new URL(finalUrl).host;
  const hostMatches = expectedHost ? resolvedHost === expectedHost : null;
  const statusOk = res.status === 200;

  if (!statusOk) {
    return {
      outcome: "failed",
      method: "url_fetch",
      checks: { status: res.status, resolved_host: resolvedHost, host_matches: hostMatches },
      reason: `public_url returned HTTP ${res.status}`,
    };
  }
  if (hostMatches === false) {
    return {
      outcome: "failed",
      method: "url_fetch",
      checks: { status: res.status, resolved_host: resolvedHost, host_matches: false },
      reason: `public_url resolves to ${resolvedHost}, not the firm's own domain (${expectedHost})`,
    };
  }
  return {
    outcome: "verified",
    method: "url_fetch",
    checks: { status: res.status, resolved_host: resolvedHost, host_matches: hostMatches },
    reason: null,
  };
}

/**
 * PDF / lead-magnet destination: fetches the file and confirms it is
 * actually a PDF (content-type), and that the LIVE file's hash matches the
 * caller-supplied expectedSha256 -- proof the live artifact is
 * byte-identical to the approved version, not merely a file with the right
 * name at the right path. When no trusted hash is available to compare
 * against, this reports "unverifiable" rather than "verified": a live,
 * correctly-typed file is not the same claim as byte-identity, and this
 * validator never reports a check it did not actually run.
 */
export async function validatePdfReceipt(
  receipt: Pick<PublicationReceipt, "public_url">,
  expectedSha256?: string | null,
): Promise<ChannelValidationResult> {
  if (!receipt.public_url) {
    return {
      outcome: "failed",
      method: "url_fetch",
      checks: { has_url: false },
      reason: "no public_url on this receipt to check",
    };
  }

  let res: Response;
  try {
    ({ res } = await fetchWithTimeout(receipt.public_url, "GET"));
  } catch (err) {
    return {
      outcome: "failed",
      method: "url_fetch",
      checks: { has_url: true, fetch_error: err instanceof Error ? err.message : "fetch failed" },
      reason: "could not reach public_url",
    };
  }

  if (res.status !== 200) {
    return {
      outcome: "failed",
      method: "url_fetch",
      checks: { status: res.status },
      reason: `public_url returned HTTP ${res.status}`,
    };
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isPdf = contentType.includes("application/pdf");
  if (!isPdf) {
    return {
      outcome: "failed",
      method: "url_fetch",
      checks: { status: res.status, content_type: contentType },
      reason: `expected application/pdf, got "${contentType}"`,
    };
  }

  if (!expectedSha256) {
    // A live, correctly-typed file is not the same claim as "byte-identical
    // to the approved version" -- the whole point of registering a PDF
    // artifact. With no trusted hash to compare against (neither the
    // artifact nor the approved version carries one), that claim was never
    // actually checked, so this reports unverifiable rather than fabricating
    // "verified" for a check that did not run. See the docstring above.
    return {
      outcome: "unverifiable",
      method: "url_fetch",
      checks: { status: res.status, content_type: contentType, sha256_checked: false },
      reason: "no trusted sha256 on file (neither the artifact nor the approved version carries one) to compare the live bytes against",
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const actualSha256 = createHash("sha256").update(buf).digest("hex");
  const hashMatches = actualSha256 === expectedSha256;
  return {
    outcome: hashMatches ? "verified" : "failed",
    method: "url_fetch",
    checks: {
      status: res.status,
      content_type: contentType,
      sha256_checked: true,
      sha256_matches: hashMatches,
    },
    reason: hashMatches
      ? null
      : `live file's sha256 (${actualSha256}) does not match the approved artifact's sha256 (${expectedSha256})`,
  };
}

/**
 * LinkedIn / GBP destinations: no authorized posting or read API is wired
 * up, so this never claims to have checked the live post. It can only
 * confirm the receipt itself carries SOME independently-inspectable
 * evidence (a URL/external post id, or a screenshot in evidence storage)
 * and reports "unverifiable" rather than fabricating a pass. An operator
 * who has manually confirmed the live post uses verification_method
 * 'operator_attestation' on the receipt directly; this validator is not
 * that attestation.
 */
export function validateSocialReceipt(
  receipt: Pick<PublicationReceipt, "public_url" | "external_post_id" | "evidence_storage_path">,
): ChannelValidationResult {
  const hasUrl = Boolean(receipt.public_url);
  const hasExternalId = Boolean(receipt.external_post_id);
  const hasScreenshot = Boolean(receipt.evidence_storage_path);

  if (!hasUrl && !hasExternalId) {
    return {
      outcome: "failed",
      method: "operator_attestation",
      checks: { has_url: false, has_external_post_id: false, has_screenshot: hasScreenshot },
      reason: "no public_url or external_post_id recorded on this receipt",
    };
  }
  return {
    outcome: "unverifiable",
    method: "operator_attestation",
    checks: { has_url: hasUrl, has_external_post_id: hasExternalId, has_screenshot: hasScreenshot },
    reason:
      "this platform has no authorized read API wired up; an operator must manually confirm the live post and record verification_method='operator_attestation'",
  };
}

/**
 * Dispatches to the correct validator for a placement's destination. This
 * is the single entry point callers (the verify route, the preflight
 * endpoint) should use rather than importing individual validators.
 *
 * `firm_website` covers two shapes that need different checks: an ordinary
 * HTML page (requiredArtifactType 'webpage' or unset) and a downloadable
 * PDF lead magnet (requiredArtifactType 'pdf'). The destination alone
 * cannot distinguish them -- a PDF hosted on the firm's own site is still
 * `firm_website` -- so requiredArtifactType (from the placement) picks the
 * validator.
 */
export async function validateReceiptForDestination(
  destination: PlacementDestination,
  receipt: PublicationReceipt,
  opts?: {
    expectedHost?: string | null;
    expectedSha256?: string | null;
    requiredArtifactType?: PublicationArtifactType | null;
  },
): Promise<ChannelValidationResult> {
  switch (destination) {
    case "firm_website":
      return opts?.requiredArtifactType === "pdf"
        ? validatePdfReceipt(receipt, opts?.expectedSha256)
        : validateWebsiteReceipt(receipt, opts?.expectedHost);
    case "email_delivery":
      // A sent email has no independently-fetchable public artifact; treat
      // like a social destination (evidence-presence only).
      return validateSocialReceipt(receipt);
    case "linkedin_article":
    case "linkedin_post":
    case "linkedin_company_page":
    case "google_business_profile":
      return validateSocialReceipt(receipt);
    default: {
      const exhaustive: never = destination;
      throw new Error(`unhandled destination: ${exhaustive}`);
    }
  }
}
