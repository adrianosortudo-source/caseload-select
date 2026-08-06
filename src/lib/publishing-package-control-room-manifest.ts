/**
 * The Weekly Package Control Room's own manifest schema -- distinct from,
 * and richer than, the Publishing Package Gateway's hero-binding manifest
 * (publishing-package-manifest.ts), which stays exactly what it is: the
 * narrow CLI-side format for one upload+bind operation. This file's
 * manifest is the full weekly-package shape (pieces, required assets, CTA,
 * locale, placement, approval) that the Control Room's Overview/Content/
 * Assets/Review/Release tabs all read from.
 *
 * Same validation discipline as the gateway's manifest validator: collects
 * every violation in one pass (never stops at the first), never silently
 * normalizes malformed data into something that happens to pass, and
 * reports errors as exact `path` strings so a caller can fix the whole
 * manifest at once.
 *
 * Hand-written, no schema-validation dependency (Zod or otherwise) -- this
 * repo doesn't have one installed and the Control Room build was scoped to
 * not add one.
 */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export const PACKAGE_LOCALES = ["en-CA", "pt-BR"] as const;
export type PackageLocale = (typeof PACKAGE_LOCALES)[number];

export const OVERLAY_LANGUAGES = ["en", "pt"] as const;
export type OverlayLanguage = (typeof OVERLAY_LANGUAGES)[number];

export const ASSET_ROLES = [
  "website_article_hero",
  "native_linkedin_article_cover",
  "linkedin_post_card",
  "gbp_card",
  "lead_magnet_document_hero",
  "lead_magnet_landing_page_hero",
  "canonical_textless_master",
  "pdf_document",
  "rendered_qa_evidence",
] as const;
export type AssetRole = (typeof ASSET_ROLES)[number];

export const TEXT_POLICIES = ["textless", "text_bearing", "platform_rendered_text"] as const;
export type TextPolicy = (typeof TEXT_POLICIES)[number];

export const CTA_BEHAVIORS = ["download", "open", "navigate", "none"] as const;
export type CtaBehavior = (typeof CTA_BEHAVIORS)[number];

/** Format families that require a resolved source_version_id (Section 8: "missing source version where the format requires a source"). Every format family carries a body drawn from an existing deliverable version except a bare CTA-only or not-yet-drafted slot. */
export const FORMAT_FAMILIES_REQUIRING_SOURCE_VERSION = [
  "counsel_note",
  "clause_in_the_margin",
  "decision_tool",
  "lead_magnet_document",
  "lead_magnet_landing_page",
  "google_business_profile_post",
] as const;

export interface PackageManifestCta {
  required: boolean;
  label: string | null;
  target: string | null;
  behavior: CtaBehavior;
}

export interface PackageManifestRequiredAsset {
  assetRole: AssetRole;
  locale: PackageLocale;
  destination: string;
  requiredWidth: number;
  requiredHeight: number;
  textPolicy: TextPolicy;
  overlayLanguage: OverlayLanguage | null;
  safeArea: string;
  requiredCopy: string | null;
  selectedAssetId: string | null;
}

export interface PackageManifestPiece {
  contentSlotId: string;
  deliverableId: string | null;
  sourceDeliverableId: string | null;
  sourceVersionId: string | null;
  readerTitle: string;
  formatFamily: string;
  locale: PackageLocale;
  destination: string;
  bodyRelationship: string;
  requiredAssets: PackageManifestRequiredAsset[];
  cta: PackageManifestCta;
  pdfAssetId: string | null;
  plannedPublishAt: string | null;
  placementStatus: string;
  approvalStatus: string;
}

export interface PackageManifest {
  schemaVersion: 1;
  firmId: string;
  periodId: string;
  expectedPieceCount: number;
  revision: number;
  pieces: PackageManifestPiece[];
}

export interface ManifestValidationError {
  /** e.g. "pieces[3].required_assets[1].selected_asset_id" -- always the exact offending field. */
  path: string;
  message: string;
}

export type PackageManifestValidationResult =
  | { ok: true; manifest: PackageManifest; errors: [] }
  | { ok: false; manifest: null; errors: ManifestValidationError[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNullableUuid(v: unknown): v is string | null {
  return v === null || isUuid(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Section 15/16: a lead-magnet CTA target pointing at the portal Files hub is a release blocker -- never a partial pass. Matches by path segment, not a full-URL parse, since targets may be root-relative ("/files/...") or absolute (".../files/...";  a named reference to "the Files hub" in prose is explicitly NOT a substitute for removing the link, per this project's own prior finding on that exact failure mode). */
export function targetsFilesHub(target: string): boolean {
  return /(^|\/)files(\/|$|\?)/i.test(target);
}

/**
 * Validates a raw, already-JSON-parsed Control Room package manifest.
 * Merges the source spec's Section 8 (manifest validation) and Section 17
 * (locale/role/destination guards) into one rule set -- they describe the
 * same requirements from two angles in the original prompt; implementing
 * them as two separate validators would risk the two drifting apart.
 */
export function validatePackageManifest(raw: unknown): PackageManifestValidationResult {
  const errors: ManifestValidationError[] = [];

  if (!isPlainObject(raw)) {
    return { ok: false, manifest: null, errors: [{ path: "$", message: "manifest must be a JSON object" }] };
  }

  if (raw.schema_version !== 1) {
    errors.push({ path: "schema_version", message: `schema_version must equal 1 (got ${JSON.stringify(raw.schema_version)})` });
  }
  if (!isUuid(raw.firm_id)) {
    errors.push({ path: "firm_id", message: `firm_id must be a valid UUID (got ${JSON.stringify(raw.firm_id)})` });
  }
  if (!isUuid(raw.period_id)) {
    errors.push({ path: "period_id", message: `period_id must be a valid UUID (got ${JSON.stringify(raw.period_id)})` });
  }
  if (typeof raw.expected_piece_count !== "number" || !Number.isInteger(raw.expected_piece_count) || raw.expected_piece_count < 1) {
    errors.push({ path: "expected_piece_count", message: `expected_piece_count must be a positive integer (got ${JSON.stringify(raw.expected_piece_count)})` });
  }
  if (typeof raw.revision !== "number" || !Number.isInteger(raw.revision) || raw.revision < 1) {
    errors.push({ path: "revision", message: `revision must be a positive integer (got ${JSON.stringify(raw.revision)})` });
  }

  const rawPieces = raw.pieces;
  if (!Array.isArray(rawPieces)) {
    errors.push({ path: "pieces", message: "pieces must be an array" });
  }

  const pieces: PackageManifestPiece[] = [];
  const seenSlotIds = new Set<string>();
  const duplicateSlotIds = new Set<string>();

  if (Array.isArray(rawPieces)) {
    rawPieces.forEach((rawPiece, pieceIndex) => {
      const base = `pieces[${pieceIndex}]`;
      if (!isPlainObject(rawPiece)) {
        errors.push({ path: base, message: "each piece must be a JSON object" });
        return;
      }

      const contentSlotId = rawPiece.content_slot_id;
      if (!isNonEmptyString(contentSlotId)) {
        errors.push({ path: `${base}.content_slot_id`, message: "content_slot_id must be a non-empty string" });
      } else {
        if (seenSlotIds.has(contentSlotId)) duplicateSlotIds.add(contentSlotId);
        seenSlotIds.add(contentSlotId);
      }

      if (!isNullableUuid(rawPiece.deliverable_id)) {
        errors.push({ path: `${base}.deliverable_id`, message: "deliverable_id must be a UUID or null" });
      }
      if (!isNullableUuid(rawPiece.source_deliverable_id)) {
        errors.push({ path: `${base}.source_deliverable_id`, message: "source_deliverable_id must be a UUID or null" });
      }
      const sourceVersionId = rawPiece.source_version_id;
      if (!isNullableUuid(sourceVersionId)) {
        errors.push({ path: `${base}.source_version_id`, message: "source_version_id must be a UUID or null" });
      }

      if (!isNonEmptyString(rawPiece.reader_title)) {
        errors.push({ path: `${base}.reader_title`, message: "reader_title must be a non-empty string" });
      }

      const formatFamily = rawPiece.format_family;
      if (!isNonEmptyString(formatFamily)) {
        errors.push({ path: `${base}.format_family`, message: "format_family must be a non-empty string" });
      } else if (
        (FORMAT_FAMILIES_REQUIRING_SOURCE_VERSION as readonly string[]).includes(formatFamily) &&
        (sourceVersionId === null || sourceVersionId === undefined)
      ) {
        errors.push({
          path: `${base}.source_version_id`,
          message: `format_family "${formatFamily}" requires a source_version_id, but none was provided`,
        });
      }

      const pieceLocale = rawPiece.locale;
      if (!(PACKAGE_LOCALES as readonly unknown[]).includes(pieceLocale)) {
        errors.push({ path: `${base}.locale`, message: `locale must be one of ${PACKAGE_LOCALES.join(", ")} (got ${JSON.stringify(pieceLocale)})` });
      }

      if (!isNonEmptyString(rawPiece.destination)) {
        errors.push({ path: `${base}.destination`, message: "destination must be a non-empty string" });
      }
      if (!isNonEmptyString(rawPiece.body_relationship)) {
        errors.push({ path: `${base}.body_relationship`, message: "body_relationship must be a non-empty string" });
      }

      // ── cta ──────────────────────────────────────────────────────────
      const rawCta = rawPiece.cta;
      let cta: PackageManifestCta | null = null;
      if (!isPlainObject(rawCta)) {
        errors.push({ path: `${base}.cta`, message: "cta must be a JSON object" });
      } else {
        const ctaBase = `${base}.cta`;
        if (typeof rawCta.required !== "boolean") {
          errors.push({ path: `${ctaBase}.required`, message: "cta.required must be a boolean" });
        }
        if (rawCta.label !== null && typeof rawCta.label !== "string") {
          errors.push({ path: `${ctaBase}.label`, message: "cta.label must be a string or null" });
        }
        const ctaTarget = rawCta.target;
        if (ctaTarget !== null && typeof ctaTarget !== "string") {
          errors.push({ path: `${ctaBase}.target`, message: "cta.target must be a string or null" });
        }
        const ctaBehavior = rawCta.behavior;
        if (!(CTA_BEHAVIORS as readonly unknown[]).includes(ctaBehavior)) {
          errors.push({ path: `${ctaBase}.behavior`, message: `cta.behavior must be one of ${CTA_BEHAVIORS.join(", ")} (got ${JSON.stringify(ctaBehavior)})` });
        }

        // Section 16 / 8: lead-magnet CTA rules -- /files is a hard blocker,
        // behavior must be exactly "download", regardless of what the label says.
        const isLeadMagnet = formatFamily === "lead_magnet_document" || formatFamily === "lead_magnet_landing_page";
        if (isLeadMagnet && typeof ctaTarget === "string" && targetsFilesHub(ctaTarget)) {
          errors.push({ path: `${ctaBase}.target`, message: `lead-magnet CTA must not point at the Files hub (got ${JSON.stringify(ctaTarget)})` });
        }
        if (isLeadMagnet && ctaBehavior !== undefined && ctaBehavior !== "download") {
          errors.push({ path: `${ctaBase}.behavior`, message: `lead-magnet CTA behavior must be "download" (got ${JSON.stringify(ctaBehavior)})` });
        }

        if (
          typeof rawCta.required === "boolean" &&
          (rawCta.label === null || typeof rawCta.label === "string") &&
          (ctaTarget === null || typeof ctaTarget === "string") &&
          (CTA_BEHAVIORS as readonly unknown[]).includes(ctaBehavior)
        ) {
          cta = {
            required: rawCta.required,
            label: rawCta.label as string | null,
            target: ctaTarget as string | null,
            behavior: ctaBehavior as CtaBehavior,
          };
        }
      }

      const pdfAssetId = rawPiece.pdf_asset_id;
      if (!isNullableUuid(pdfAssetId)) {
        errors.push({ path: `${base}.pdf_asset_id`, message: "pdf_asset_id must be a UUID or null" });
      }
      // Section 8: "required direct-PDF CTA not immediately after the hero in
      // its content specification." A direct-PDF piece is one that carries a
      // pdf_asset_id -- if it does, its CTA must be required and point somewhere
      // real (not /files, checked above) rather than being optional/absent.
      if (isUuid(pdfAssetId) && cta && !cta.required) {
        errors.push({ path: `${base}.cta.required`, message: "a piece with a pdf_asset_id must carry a required direct-PDF CTA" });
      }

      if (rawPiece.planned_publish_at !== null && typeof rawPiece.planned_publish_at !== "string") {
        errors.push({ path: `${base}.planned_publish_at`, message: "planned_publish_at must be an ISO datetime string or null" });
      }
      if (!isNonEmptyString(rawPiece.placement_status)) {
        errors.push({ path: `${base}.placement_status`, message: "placement_status must be a non-empty string" });
      }
      if (!isNonEmptyString(rawPiece.approval_status)) {
        errors.push({ path: `${base}.approval_status`, message: "approval_status must be a non-empty string" });
      }

      // ── required_assets ─────────────────────────────────────────────
      const rawRequiredAssets = rawPiece.required_assets;
      const requiredAssets: PackageManifestRequiredAsset[] = [];
      if (!Array.isArray(rawRequiredAssets)) {
        errors.push({ path: `${base}.required_assets`, message: "required_assets must be an array" });
      } else {
        rawRequiredAssets.forEach((rawAsset, assetIndex) => {
          const assetBase = `${base}.required_assets[${assetIndex}]`;
          if (!isPlainObject(rawAsset)) {
            errors.push({ path: assetBase, message: "each required asset must be a JSON object" });
            return;
          }

          const assetRole = rawAsset.asset_role;
          if (!(ASSET_ROLES as readonly unknown[]).includes(assetRole)) {
            errors.push({ path: `${assetBase}.asset_role`, message: `asset_role must be one of ${ASSET_ROLES.join(", ")} (got ${JSON.stringify(assetRole)})` });
          }

          const assetLocale = rawAsset.locale;
          if (!(PACKAGE_LOCALES as readonly unknown[]).includes(assetLocale)) {
            errors.push({ path: `${assetBase}.locale`, message: `locale must be one of ${PACKAGE_LOCALES.join(", ")} (got ${JSON.stringify(assetLocale)})` });
          } else if (typeof pieceLocale === "string" && assetLocale !== pieceLocale) {
            // Section 8: "selected asset whose locale differs from the content" /
            // Section 17: locale equality guard.
            errors.push({
              path: `${assetBase}.locale`,
              message: `required asset locale (${assetLocale}) must match the piece's locale (${pieceLocale})`,
            });
          }

          if (!isNonEmptyString(rawAsset.destination)) {
            errors.push({ path: `${assetBase}.destination`, message: "destination must be a non-empty string" });
          }
          // pdf_document is the one role with no pixel dimensions -- 0 is the
          // valid "not applicable" value there; every image-bearing role must
          // still carry real positive dimensions.
          const dimensionsApplicable = assetRole !== "pdf_document";
          if (
            typeof rawAsset.required_width !== "number" ||
            (dimensionsApplicable ? rawAsset.required_width <= 0 : rawAsset.required_width < 0)
          ) {
            errors.push({ path: `${assetBase}.required_width`, message: dimensionsApplicable ? "required_width must be a positive number" : "required_width must be 0 or greater for pdf_document" });
          }
          if (
            typeof rawAsset.required_height !== "number" ||
            (dimensionsApplicable ? rawAsset.required_height <= 0 : rawAsset.required_height < 0)
          ) {
            errors.push({ path: `${assetBase}.required_height`, message: dimensionsApplicable ? "required_height must be a positive number" : "required_height must be 0 or greater for pdf_document" });
          }

          const textPolicy = rawAsset.text_policy;
          if (!(TEXT_POLICIES as readonly unknown[]).includes(textPolicy)) {
            errors.push({ path: `${assetBase}.text_policy`, message: `text_policy must be one of ${TEXT_POLICIES.join(", ")} (got ${JSON.stringify(textPolicy)})` });
          }

          const overlayLanguage = rawAsset.overlay_language;
          if (overlayLanguage !== null && !(OVERLAY_LANGUAGES as readonly unknown[]).includes(overlayLanguage)) {
            errors.push({ path: `${assetBase}.overlay_language`, message: `overlay_language must be one of ${OVERLAY_LANGUAGES.join(", ")} or null (got ${JSON.stringify(overlayLanguage)})` });
          } else if (textPolicy === "text_bearing" && overlayLanguage) {
            // Section 8: "EN text-bearing asset assigned to PT" / "PT text-bearing
            // asset assigned to EN" -- overlay language must match the piece's
            // own locale exactly (en-CA piece -> "en" overlay, pt-BR -> "pt").
            const expectedOverlay = pieceLocale === "pt-BR" ? "pt" : pieceLocale === "en-CA" ? "en" : null;
            if (expectedOverlay && overlayLanguage !== expectedOverlay) {
              errors.push({
                path: `${assetBase}.overlay_language`,
                message: `text-bearing asset overlay_language "${overlayLanguage}" does not match piece locale "${pieceLocale}" (expected "${expectedOverlay}")`,
              });
            }
          }

          if (!isNonEmptyString(rawAsset.safe_area)) {
            errors.push({ path: `${assetBase}.safe_area`, message: "safe_area must be a non-empty human-readable rule string" });
          }
          if (rawAsset.required_copy !== null && typeof rawAsset.required_copy !== "string") {
            errors.push({ path: `${assetBase}.required_copy`, message: "required_copy must be a string or null" });
          }
          if (!isNullableUuid(rawAsset.selected_asset_id)) {
            errors.push({ path: `${assetBase}.selected_asset_id`, message: "selected_asset_id must be a UUID or null" });
          }

          if (
            (ASSET_ROLES as readonly unknown[]).includes(assetRole) &&
            (PACKAGE_LOCALES as readonly unknown[]).includes(assetLocale) &&
            isNonEmptyString(rawAsset.destination) &&
            typeof rawAsset.required_width === "number" &&
            typeof rawAsset.required_height === "number" &&
            (TEXT_POLICIES as readonly unknown[]).includes(textPolicy) &&
            (overlayLanguage === null || (OVERLAY_LANGUAGES as readonly unknown[]).includes(overlayLanguage)) &&
            isNonEmptyString(rawAsset.safe_area) &&
            (rawAsset.required_copy === null || typeof rawAsset.required_copy === "string") &&
            isNullableUuid(rawAsset.selected_asset_id)
          ) {
            requiredAssets.push({
              assetRole: assetRole as AssetRole,
              locale: assetLocale as PackageLocale,
              destination: rawAsset.destination as string,
              requiredWidth: rawAsset.required_width as number,
              requiredHeight: rawAsset.required_height as number,
              textPolicy: textPolicy as TextPolicy,
              overlayLanguage: (overlayLanguage ?? null) as OverlayLanguage | null,
              safeArea: rawAsset.safe_area as string,
              requiredCopy: (rawAsset.required_copy ?? null) as string | null,
              selectedAssetId: (rawAsset.selected_asset_id ?? null) as string | null,
            });
          }
        });

        // Section 8: "missing required asset" -- an empty required_assets array
        // on a piece whose format expects visuals is itself a gap. Every piece in
        // this manifest's domain (weekly firm content) carries at least one
        // required asset; a genuinely visual-less slot is out of this schema's
        // scope, so zero-length is always flagged here.
        if (Array.isArray(rawRequiredAssets) && rawRequiredAssets.length === 0) {
          errors.push({ path: `${base}.required_assets`, message: "required_assets must not be empty -- every piece needs at least one required asset" });
        }
      }

      if (
        isNonEmptyString(contentSlotId) &&
        isNullableUuid(rawPiece.deliverable_id) &&
        isNullableUuid(rawPiece.source_deliverable_id) &&
        isNullableUuid(sourceVersionId) &&
        isNonEmptyString(rawPiece.reader_title) &&
        isNonEmptyString(formatFamily) &&
        (PACKAGE_LOCALES as readonly unknown[]).includes(pieceLocale) &&
        isNonEmptyString(rawPiece.destination) &&
        isNonEmptyString(rawPiece.body_relationship) &&
        cta !== null &&
        isNullableUuid(pdfAssetId) &&
        (rawPiece.planned_publish_at === null || typeof rawPiece.planned_publish_at === "string") &&
        isNonEmptyString(rawPiece.placement_status) &&
        isNonEmptyString(rawPiece.approval_status)
      ) {
        pieces.push({
          contentSlotId,
          deliverableId: rawPiece.deliverable_id as string | null,
          sourceDeliverableId: rawPiece.source_deliverable_id as string | null,
          sourceVersionId: sourceVersionId as string | null,
          readerTitle: rawPiece.reader_title as string,
          formatFamily,
          locale: pieceLocale as PackageLocale,
          destination: rawPiece.destination as string,
          bodyRelationship: rawPiece.body_relationship as string,
          requiredAssets,
          cta,
          pdfAssetId: pdfAssetId as string | null,
          plannedPublishAt: (rawPiece.planned_publish_at ?? null) as string | null,
          placementStatus: rawPiece.placement_status as string,
          approvalStatus: rawPiece.approval_status as string,
        });
      }
    });
  }

  for (const dup of duplicateSlotIds) {
    errors.push({ path: "pieces", message: `duplicate content_slot_id in manifest: ${dup}` });
  }

  // Section 8: "piece count not equal to expected_piece_count".
  if (
    typeof raw.expected_piece_count === "number" &&
    Array.isArray(rawPieces) &&
    rawPieces.length !== raw.expected_piece_count
  ) {
    errors.push({
      path: "pieces",
      message: `manifest has ${rawPieces.length} piece(s) but expected_piece_count is ${raw.expected_piece_count}`,
    });
  }

  if (errors.length > 0 || !isUuid(raw.firm_id) || !isUuid(raw.period_id)) {
    return { ok: false, manifest: null, errors };
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: 1,
      firmId: raw.firm_id,
      periodId: raw.period_id,
      expectedPieceCount: raw.expected_piece_count as number,
      revision: raw.revision as number,
      pieces,
    },
    errors: [],
  };
}

// ─── Asset-lifecycle guards (Section 17) ────────────────────────────────────
//
// These operate on individual candidate/selected-asset records (the shape
// publishing_package_assets rows take), not on the manifest JSON -- the
// manifest only carries a `selected_asset_id` pointer, not full candidate
// state. Kept here, next to the manifest validators, because the source
// prompt describes them as the same rule family (Section 8 + Section 17 are
// one merged checklist per this build's task breakdown); CR-16's asset
// mutation actions call these before writing any status transition.

export interface AssetGuardCandidate {
  id: string;
  role: AssetRole;
  locale: PackageLocale;
  destination: string;
  overlayLanguage: OverlayLanguage | null;
  width: number;
  height: number;
  sha256: string;
  status:
    | "required" | "missing" | "candidate" | "visually_selected" | "hash_verified"
    | "uploaded" | "bound" | "rendered_verified" | "release_ready" | "blocked"
    | "rejected" | "superseded" | "not_planned";
  isSelected: boolean;
}

export interface AssetGuardRequirement {
  assetRole: AssetRole;
  locale: PackageLocale;
  destination: string;
  requiredWidth: number;
  requiredHeight: number;
  overlayLanguage: OverlayLanguage | null;
}

export interface AssetGuardResult {
  ok: boolean;
  reason: string | null;
}

const PASS: AssetGuardResult = { ok: true, reason: null };
function fail(reason: string): AssetGuardResult {
  return { ok: false, reason };
}

/** Rejection example: "LinkedIn post card assigned as Native LinkedIn Article cover", "GBP card assigned as website hero", "website hero assigned as GBP card". */
export function checkAssetRoleMatches(candidate: AssetGuardCandidate, requirement: AssetGuardRequirement): AssetGuardResult {
  if (candidate.role !== requirement.assetRole) {
    return fail(`asset role "${candidate.role}" does not match required role "${requirement.assetRole}"`);
  }
  return PASS;
}

/** Rejection example: "missing PT rendition" surfaces as a locale mismatch when an EN candidate is offered against a PT requirement, and vice versa. */
export function checkAssetLocaleMatches(candidate: AssetGuardCandidate, requirement: AssetGuardRequirement): AssetGuardResult {
  if (candidate.locale !== requirement.locale) {
    return fail(`asset locale "${candidate.locale}" does not match required locale "${requirement.locale}"`);
  }
  return PASS;
}

/** Rejection example: "EN text-overlay image on PT content", "PT text-overlay image on EN content". */
export function checkOverlayLanguageMatches(candidate: AssetGuardCandidate, requirement: AssetGuardRequirement): AssetGuardResult {
  if (requirement.overlayLanguage === null) return PASS;
  if (candidate.overlayLanguage !== requirement.overlayLanguage) {
    return fail(`asset overlay_language "${candidate.overlayLanguage ?? "null"}" does not match required overlay_language "${requirement.overlayLanguage}"`);
  }
  return PASS;
}

export function checkAssetDestinationMatches(candidate: AssetGuardCandidate, requirement: AssetGuardRequirement): AssetGuardResult {
  if (candidate.destination !== requirement.destination) {
    return fail(`asset destination "${candidate.destination}" does not match required destination "${requirement.destination}"`);
  }
  return PASS;
}

export function checkAssetDimensionsMatch(candidate: AssetGuardCandidate, requirement: AssetGuardRequirement): AssetGuardResult {
  if (candidate.width !== requirement.requiredWidth || candidate.height !== requirement.requiredHeight) {
    return fail(`asset dimensions ${candidate.width}x${candidate.height} do not match required ${requirement.requiredWidth}x${requirement.requiredHeight}`);
  }
  return PASS;
}

export function checkSha256Shape(sha256: string): AssetGuardResult {
  if (!SHA256_HEX_RE.test(sha256)) {
    return fail(`sha256 must be exactly 64 lowercase hex characters (got ${JSON.stringify(sha256)})`);
  }
  return PASS;
}

/** Rejection example: "unselected candidate bound" -- only a candidate the operator explicitly selected may proceed to binding. */
export function checkCandidateIsSelectedForBinding(candidate: AssetGuardCandidate): AssetGuardResult {
  if (!candidate.isSelected) {
    return fail(`candidate ${candidate.id} is not selected and cannot be bound`);
  }
  return PASS;
}

/** Rejection example: "superseded candidate bound". */
export function checkCandidateNotSuperseded(candidate: AssetGuardCandidate): AssetGuardResult {
  if (candidate.status === "superseded") {
    return fail(`candidate ${candidate.id} has been superseded and cannot be bound`);
  }
  if (candidate.status === "rejected") {
    return fail(`candidate ${candidate.id} has been rejected and cannot be bound`);
  }
  return PASS;
}

/** Rejection example: "hash-mismatched asset marked verified". Compares the candidate's own recorded sha256 against a freshly computed one (never trusts a caller's claim that a hash was already checked). */
export function checkHashMatchesForVerification(candidate: AssetGuardCandidate, computedSha256: string): AssetGuardResult {
  if (candidate.sha256 !== computedSha256) {
    return fail(`candidate sha256 "${candidate.sha256}" does not match computed sha256 "${computedSha256}" -- cannot mark hash_verified`);
  }
  return PASS;
}

/** Section 17: "selected-candidate uniqueness" -- at most one candidate in a candidate group may be marked selected at a time. */
export function checkSingleSelectedCandidate(candidates: AssetGuardCandidate[]): AssetGuardResult {
  const selected = candidates.filter((c) => c.isSelected);
  if (selected.length > 1) {
    return fail(`candidate group has ${selected.length} selected candidates; exactly one is required (ids: ${selected.map((c) => c.id).join(", ")})`);
  }
  return PASS;
}

/** Runs every applicable per-candidate guard against a requirement and returns every failure (not just the first), matching this module's collect-all-violations discipline. */
export function checkCandidateAgainstRequirement(
  candidate: AssetGuardCandidate,
  requirement: AssetGuardRequirement,
): AssetGuardResult[] {
  return [
    checkAssetRoleMatches(candidate, requirement),
    checkAssetLocaleMatches(candidate, requirement),
    checkOverlayLanguageMatches(candidate, requirement),
    checkAssetDestinationMatches(candidate, requirement),
    checkAssetDimensionsMatch(candidate, requirement),
    checkSha256Shape(candidate.sha256),
  ].filter((r) => !r.ok);
}
