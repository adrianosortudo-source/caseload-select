/**
 * The Canonical Publication Packet: read-only assembly of everything a
 * publishing agent or operator needs to manually or automatically publish
 * one deliverable to one destination, per the 2026-07-22 DRG Law
 * calibration report (docs/publication-operator/ -- see that report for
 * the full narrative this module encodes as checks and types).
 *
 * NON-NEGOTIABLE CONTENT POLICY (calibration report, "do not create
 * content"): this module retrieves the current approved version, converts
 * it between presentation formats WITHOUT changing its words, assembles
 * the approved body/CTA/asset into a packet, and validates -- it never
 * writes or rewrites a headline, body, CTA, disclaimer, or translation;
 * never adds hashtags, links, emojis, or suggested language absent from
 * the approved record; never selects a "close enough" image or
 * destination; never lets a draft/watermarked artifact into a packet; and
 * never converts a missing field into a guess. Where a required source is
 * missing or contradictory, the packet carries a named, precise check
 * failure -- never an invented value.
 *
 * Pure functions only. No I/O, no Supabase, no network call (matches this
 * codebase's "No I/O. No Supabase." convention -- see
 * publication-readiness.ts, release-graph-audit.ts). The loader
 * (publication-packet-loader.ts) does the actual data fetching and the
 * one genuinely I/O-shaped check (cta_resolves, an HTTP call) via an
 * injected function this module only calls if the loader supplies one.
 *
 * Composes from, never re-implements, this codebase's existing canonical
 * rules:
 *   - isVersionReleaseAuthorized (release-authorization.ts) for
 *     legal_authorized -- the ONE two-path authorization bar.
 *   - evaluateDeliverableReadiness (publication-readiness.ts) for the
 *     existing readiness evaluator this module's ready_to_publish state
 *     folds in.
 *   - requiredRenditionRole / findArtifact (release-graph-audit.ts,
 *     exported 2026-07-22 specifically for this reuse) for image-asset
 *     role/binding rules -- the same rules release-graph-audit.ts already
 *     enforces for the same destinations.
 *
 * Known, disclosed gap (see this repo's Publishing Package Gateway
 * calibration-plan final report for the full writeup): this schema has no
 * stored CTA BUTTON LABEL field anywhere (only content_deliverables.
 * cta_target_path, the URL). ctaLabel below is therefore always null from
 * every real caller today -- this module transports whatever label a
 * caller supplies (for when a future schema change adds one) but never
 * invents one, since a generated label would be exactly the "suggested
 * language absent from the approved record" the content policy forbids.
 */

import type {
  ContentDeliverable,
  ContentPlacement,
  DeliverableVersion,
  PlacementDestination,
  PublicationArtifact,
  PublicationArtifactType,
  PublicationReceipt,
} from "@/lib/types";
import {
  evaluateDeliverableReadiness,
  type EvaluateReadinessInput,
} from "@/lib/publication-readiness";
import { isVersionReleaseAuthorized, type ReleaseAuthorizationResult } from "@/lib/release-authorization";
import { requiredRenditionRole, findArtifact } from "@/lib/release-graph/release-graph-audit";

// ─── Pure format conversion ─────────────────────────────────────────────

const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Format conversion ONLY -- strips HTML tags and decodes the handful of
 * entities real editorial HTML in this codebase actually uses, collapses
 * whitespace left behind by tag removal. Adds no word, link, hashtag, or
 * emoji that was not already present as text in the source. This is the
 * one transform Publication Mode is allowed to perform on copy (calibration
 * report: "convert it between presentation formats without changing its
 * words, for example HTML to plain text").
 */
export function htmlToPlainText(html: string): string {
  const withoutTags = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const decoded = withoutTags.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITY_MAP[m] ?? m);
  return decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .trim();
}

// ─── Checks and blockers ─────────────────────────────────────────────────

export type PublicationPacketCheckName =
  | "legal_authority"
  | "final_copy_exists"
  | "asset_exists_and_role_ok"
  | "cta_exists"
  | "cta_resolves"
  | "draft_release_control"
  | "publication_proof";

export type PublicationPacketBlockerCode =
  | "legal_authorization_missing"
  | "final_copy_missing"
  | "no_matching_image_artifact"
  | "wrong_rendition_role"
  | "draft_or_unauthorized_asset"
  | "cta_missing"
  | "cta_unresolved"
  | "not_ready"
  | "no_publication_evidence"
  | "canonical_record_mismatch";

export interface PublicationPacketCheck {
  name: PublicationPacketCheckName;
  pass: boolean;
  /** Non-null only when pass=false. Always names the exact asset the check is about (calibration report: "The agent's status message must name the exact failed check and the asset it belongs to"). */
  reason: string | null;
  blockerCode: PublicationPacketBlockerCode | null;
  /** e.g. the deliverable id, artifact id, or "cta" -- whatever this check's failure is actually about. */
  owningAsset: string | null;
}

function passCheck(name: PublicationPacketCheckName): PublicationPacketCheck {
  return { name, pass: true, reason: null, blockerCode: null, owningAsset: null };
}
function failCheck(
  name: PublicationPacketCheckName,
  blockerCode: PublicationPacketBlockerCode,
  reason: string,
  owningAsset: string | null,
): PublicationPacketCheck {
  return { name, pass: false, reason, blockerCode, owningAsset };
}

// ─── Identity / copy / CTA / image / dates ──────────────────────────────

export interface PublicationPacketIdentity {
  deliverableId: string;
  firmId: string;
  channel: PlacementDestination;
  currentVersionId: string | null;
  locale: string | null;
  /** content_deliverables.publication_path -- the canonical route/identifier this deliverable's own record resolves to. */
  canonicalPublicationPath: string | null;
}

export interface PublicationPacketCopy {
  title: string;
  /** Byte-identical to the approved version's body_html -- this module is structurally incapable of altering it (no transform is ever applied to this field; htmlToPlainText produces a SEPARATE derived field). */
  bodyHtmlVerbatim: string;
  plainText: string;
}

export interface PublicationPacketCta {
  /** Always null from every real caller today -- see this module's header comment on the missing schema field. Never invented. */
  label: string | null;
  targetPath: string | null;
}

export interface PublicationPacketImage {
  artifactId: string;
  fileName: string;
  storageOrPublicUrl: string | null;
}

export interface PublicationPacketDates {
  scheduledFor: string | null;
  publishedAt: string | null;
}

export type PublicationEvidenceLevel = "direct_api_receipt" | "verified_public_url" | "operator_confirmation";

export interface PublicationPacketEvidence {
  level: PublicationEvidenceLevel;
  externalPostId: string | null;
  publicUrl: string | null;
  actorRole: PublicationReceipt["actor_role"] | null;
  verifiedAt: string | null;
}

export interface PublicationPacket {
  identity: PublicationPacketIdentity;
  copy: PublicationPacketCopy;
  cta: PublicationPacketCta;
  image: PublicationPacketImage | null;
  dates: PublicationPacketDates;
  legalAuthorized: boolean;
  readyToPublish: boolean;
  published: boolean;
  needsAttention: boolean;
  evidence: PublicationPacketEvidence | null;
  checks: PublicationPacketCheck[];
}

// ─── legal_authorized (C3.1f) ────────────────────────────────────────────

/** Derives legal_authorized SOLELY via isVersionReleaseAuthorized -- the one canonical two-path bar. Never re-derives from status/approved_version_id equality itself. */
export function deriveLegalAuthorization(
  deliverable: ContentDeliverable,
  currentVersion: DeliverableVersion | null,
  standingAuthorizationActive: boolean,
): { authorized: boolean; result: ReleaseAuthorizationResult | null; check: PublicationPacketCheck } {
  if (!currentVersion) {
    return {
      authorized: false,
      result: null,
      check: failCheck("legal_authority", "legal_authorization_missing", "No current version exists to evaluate for release authorization.", deliverable.id),
    };
  }
  const result = isVersionReleaseAuthorized({
    deliverableStatus: deliverable.status,
    approvedVersionId: deliverable.approved_version_id,
    targetVersionId: currentVersion.id,
    versionRequiresIndividualReview: currentVersion.requires_individual_review,
    standingAuthorizationActive,
  });
  if (!result.authorized) {
    return {
      authorized: false,
      result,
      check: failCheck("legal_authority", "legal_authorization_missing", result.reason, deliverable.id),
    };
  }
  return { authorized: true, result, check: passCheck("legal_authority") };
}

// ─── final_copy_exists ───────────────────────────────────────────────────

export function checkFinalCopyExists(currentVersion: DeliverableVersion | null, deliverableId: string): PublicationPacketCheck {
  if (!currentVersion || !currentVersion.body_html?.trim()) {
    return failCheck("final_copy_exists", "final_copy_missing", "No current version, or its body_html is empty.", deliverableId);
  }
  return passCheck("final_copy_exists");
}

// ─── CTA (C3.1c) ─────────────────────────────────────────────────────────

/** A required-but-null CTA is a named blocker, never substituted by topical similarity or any other deliverable's CTA. */
export function resolveCta(
  deliverable: Pick<ContentDeliverable, "id" | "cta_target_path">,
  ctaRequired: boolean,
  ctaLabel: string | null = null,
): { cta: PublicationPacketCta; check: PublicationPacketCheck } {
  const cta: PublicationPacketCta = { label: ctaLabel, targetPath: deliverable.cta_target_path };
  if (ctaRequired && !deliverable.cta_target_path) {
    return {
      cta,
      check: failCheck("cta_exists", "cta_missing", "This destination requires a CTA target, but cta_target_path is null. Never substituted by topical similarity.", deliverable.id),
    };
  }
  return { cta, check: passCheck("cta_exists") };
}

/**
 * cta_resolves is a PURE predicate here -- it only combines a caller-
 * supplied HTTP-check result with the CTA's own existence; the actual HTTP
 * call is loader-level (publication-packet-loader.ts's injectable fetch)
 * so this module stays free of I/O. httpCheckPassed is null when no CTA
 * exists to check (cta_exists already failed) or no check was attempted.
 */
export function checkCtaResolves(
  cta: PublicationPacketCta,
  httpCheckPassed: boolean | null,
  deliverableId: string,
): PublicationPacketCheck {
  if (!cta.targetPath) return passCheck("cta_resolves"); // nothing to resolve; cta_exists owns this gap
  if (httpCheckPassed === null) {
    return failCheck("cta_resolves", "cta_unresolved", "CTA target exists but has not been verified reachable yet.", deliverableId);
  }
  if (!httpCheckPassed) {
    return failCheck("cta_resolves", "cta_unresolved", `CTA target "${cta.targetPath}" did not resolve with an HTTP success status.`, deliverableId);
  }
  return passCheck("cta_resolves");
}

// ─── Image / rendition role (C3.1d) ─────────────────────────────────────

/**
 * Reuses requiredRenditionRole/findArtifact from release-graph-audit.ts
 * verbatim -- never re-derives the role-to-destination mapping or the
 * artifact-binding predicate. Defensively re-scopes `artifacts` to this
 * exact deliverable_id (and firm_id) before calling findArtifact, even
 * though a well-behaved loader should already pass pre-scoped artifacts --
 * this codebase's own documented lesson (release-graph-audit.ts) is to
 * never rely on a caller's pre-filtering as a substitute for checking the
 * actual row.
 */
export function resolveImageForPacket(
  deliverable: Pick<ContentDeliverable, "id" | "firm_id" | "locale">,
  currentVersion: DeliverableVersion | null,
  placement: Pick<ContentPlacement, "destination">,
  artifacts: PublicationArtifact[],
): { image: PublicationPacketImage | null; check: PublicationPacketCheck } {
  const requiredRole = requiredRenditionRole(placement.destination);
  if (requiredRole === null) {
    return { image: null, check: passCheck("asset_exists_and_role_ok") }; // e.g. email_delivery: no rendition-role requirement
  }

  const scoped = artifacts.filter((a) => a.deliverable_id === deliverable.id && a.firm_id === deliverable.firm_id);
  const artifactTypes: PublicationArtifactType[] = requiredRole === "textless_html_headline" ? ["hero_image"] : ["social_image"];
  const matching = findArtifact(scoped, artifactTypes, currentVersion?.id ?? null, deliverable.locale);

  if (!matching) {
    return {
      image: null,
      check: failCheck(
        "asset_exists_and_role_ok",
        "no_matching_image_artifact",
        `No ${artifactTypes.join("/")} artifact bound to the exact firm, deliverable, current version, and locale.`,
        deliverable.id,
      ),
    };
  }

  const fileName = matching.storage_path?.split("/").pop() ?? matching.id;
  return {
    image: { artifactId: matching.id, fileName, storageOrPublicUrl: matching.public_url ?? matching.storage_path },
    check: passCheck("asset_exists_and_role_ok"),
  };
}

// ─── draft_release_control (C3.1e) ───────────────────────────────────────

/**
 * A lead_magnet_pdf or any file asset whose exact current version is not
 * release-authorized, or whose artifact carries a draft/failed validation
 * flag, can never enter a packet -- checked independently of
 * legal_authorized so a caller sees the SPECIFIC reason (draft artifact vs.
 * missing authorization) rather than one generic block.
 */
export function checkDraftReleaseControl(
  currentVersion: DeliverableVersion | null,
  image: PublicationPacketImage | null,
  artifacts: PublicationArtifact[],
  deliverableId: string,
): PublicationPacketCheck {
  if (image) {
    const artifact = artifacts.find((a) => a.id === image.artifactId);
    const validation = artifact?.validation_result as { draft?: boolean; watermarked?: boolean; status?: string } | null;
    if (validation && (validation.draft === true || validation.watermarked === true || validation.status === "failed")) {
      return failCheck(
        "draft_release_control",
        "draft_or_unauthorized_asset",
        `Artifact ${image.artifactId} is flagged draft/watermarked/failed in its own validation_result -- never eligible for a release packet.`,
        image.artifactId,
      );
    }
  }
  if (currentVersion?.asset_validation) {
    const versionValidation = currentVersion.asset_validation as { draft?: boolean; watermarked?: boolean };
    if (versionValidation.draft === true || versionValidation.watermarked === true) {
      return failCheck(
        "draft_release_control",
        "draft_or_unauthorized_asset",
        `Current version ${currentVersion.id}'s own asset_validation is flagged draft/watermarked -- never eligible for a release packet.`,
        deliverableId,
      );
    }
  }
  return passCheck("draft_release_control");
}

// ─── Evidence model (C3.1g) ──────────────────────────────────────────────

/**
 * Maps the three calibration-report evidence levels onto EXISTING
 * publication_receipts fields only -- no new column, no new table. A
 * receipt qualifies for exactly the highest level its actual fields
 * support:
 *   direct_api_receipt   - external_post_id is present.
 *   verified_public_url  - public_url is present AND verification_state
 *                           is "verified".
 *   operator_confirmation - actor_role is "operator" (or "lawyer") AND
 *                           verification_state is "verified", with
 *                           neither of the above two signals present --
 *                           an operator/lawyer attested this was
 *                           published without an API receipt or an
 *                           independently verified public URL.
 * A receipt whose verification_state is not "verified" satisfies none of
 * the three levels -- "published" requires exactly one of them; "exists
 * on the website" or "is legally approved" is never sufficient on its own
 * (calibration report friction #1 and #11).
 */
export function classifyEvidence(receipt: PublicationReceipt | null): PublicationPacketEvidence | null {
  if (!receipt) return null;
  if (receipt.verification_state !== "verified") return null;

  const base = {
    externalPostId: receipt.external_post_id,
    publicUrl: receipt.public_url,
    actorRole: receipt.actor_role,
    verifiedAt: receipt.verified_at,
  };
  if (receipt.external_post_id) return { level: "direct_api_receipt", ...base };
  if (receipt.public_url) return { level: "verified_public_url", ...base };
  if (receipt.actor_role === "operator" || receipt.actor_role === "lawyer") return { level: "operator_confirmation", ...base };
  return null;
}

export function checkPublicationProof(evidence: PublicationPacketEvidence | null, deliverableId: string): PublicationPacketCheck {
  if (!evidence) {
    return failCheck("publication_proof", "no_publication_evidence", "No receipt with verification_state=verified and a recognized evidence level exists for this placement.", deliverableId);
  }
  return passCheck("publication_proof");
}

// ─── canonical_record_mismatch (C3.1h) ──────────────────────────────────

/**
 * Every field in one packet -- title, canonical publication path, locale,
 * hero asset, and CTA -- must resolve to the SAME canonical deliverable
 * id. This check exists because this exact class of mismatch (a
 * placement's related data pointing at a different, similarly-named
 * record) was the calibration report's friction #4 (Clause in the Margin
 * mis-mapping) and friction #8 (mixing up website/LinkedIn/GBP copy for
 * similar titles).
 */
export function checkCanonicalRecordMismatch(
  deliverable: Pick<ContentDeliverable, "id">,
  image: PublicationPacketImage | null,
  artifacts: PublicationArtifact[],
  placement: Pick<ContentPlacement, "deliverable_id">,
): PublicationPacketCheck {
  if (placement.deliverable_id !== deliverable.id) {
    return failCheck(
      "asset_exists_and_role_ok",
      "canonical_record_mismatch",
      `Placement's deliverable_id (${placement.deliverable_id}) does not match the packet's own deliverable (${deliverable.id}).`,
      deliverable.id,
    );
  }
  if (image) {
    const artifact = artifacts.find((a) => a.id === image.artifactId);
    if (artifact && artifact.deliverable_id !== deliverable.id) {
      return failCheck(
        "asset_exists_and_role_ok",
        "canonical_record_mismatch",
        `Hero/social image artifact ${image.artifactId} belongs to deliverable ${artifact.deliverable_id}, not this packet's deliverable ${deliverable.id}.`,
        deliverable.id,
      );
    }
  }
  return passCheck("asset_exists_and_role_ok");
}

// ─── Orchestrator (C3.1i) ────────────────────────────────────────────────

export interface AssemblePublicationPacketInput {
  deliverable: ContentDeliverable;
  currentVersion: DeliverableVersion | null;
  placement: ContentPlacement;
  /** Every publication_artifacts row for the PERIOD (multiple deliverables) -- this function defensively re-scopes to the exact deliverable, never trusting caller pre-filtering alone. */
  artifacts: PublicationArtifact[];
  readinessInput: Omit<EvaluateReadinessInput, "deliverable">;
  standingAuthorizationActive: boolean;
  ctaRequired: boolean;
  ctaLabel: string | null;
  /** Result of the loader's injected HTTP check for this CTA, or null if not attempted. */
  ctaHttpCheckPassed: boolean | null;
  currentReceipt: PublicationReceipt | null;
}

/** Composes every check above into one packet. Zero findings/checks failing is never assumed -- every branch is checked explicitly and named. */
export function assemblePublicationPacket(input: AssemblePublicationPacketInput): PublicationPacket {
  const { deliverable, currentVersion, placement, artifacts, standingAuthorizationActive, ctaRequired, ctaLabel, ctaHttpCheckPassed, currentReceipt } = input;

  const checks: PublicationPacketCheck[] = [];

  const legal = deriveLegalAuthorization(deliverable, currentVersion, standingAuthorizationActive);
  checks.push(legal.check);

  const copyCheck = checkFinalCopyExists(currentVersion, deliverable.id);
  checks.push(copyCheck);

  const { cta, check: ctaExistsCheck } = resolveCta(deliverable, ctaRequired, ctaLabel);
  checks.push(ctaExistsCheck);
  checks.push(checkCtaResolves(cta, ctaHttpCheckPassed, deliverable.id));

  const { image, check: imageCheck } = resolveImageForPacket(deliverable, currentVersion, placement, artifacts);
  checks.push(imageCheck);
  checks.push(checkCanonicalRecordMismatch(deliverable, image, artifacts, placement));
  checks.push(checkDraftReleaseControl(currentVersion, image, artifacts, deliverable.id));

  const readiness = deliverable.status === "archived"
    ? { ready: false, excluded: true }
    : evaluateDeliverableReadiness({ deliverable, ...input.readinessInput });
  const readyToPublish = legal.authorized && readiness.ready && checks.every((c) => c.pass);

  const evidence = classifyEvidence(currentReceipt);
  checks.push(checkPublicationProof(evidence, deliverable.id));
  const published = evidence !== null;

  const bodyHtmlVerbatim = currentVersion?.body_html ?? "";

  return {
    identity: {
      deliverableId: deliverable.id,
      firmId: deliverable.firm_id,
      channel: placement.destination,
      currentVersionId: currentVersion?.id ?? null,
      locale: deliverable.locale,
      canonicalPublicationPath: deliverable.publication_path,
    },
    copy: {
      title: deliverable.title,
      bodyHtmlVerbatim,
      plainText: htmlToPlainText(bodyHtmlVerbatim),
    },
    cta,
    image,
    dates: {
      scheduledFor: placement.scheduled_publish_date,
      publishedAt: currentReceipt?.published_at ?? null,
    },
    legalAuthorized: legal.authorized,
    readyToPublish,
    published,
    needsAttention: !published && checks.some((c) => !c.pass),
    evidence,
    checks,
  };
}
