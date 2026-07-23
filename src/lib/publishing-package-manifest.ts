/**
 * The Publishing Package Gateway's hero-binding manifest: the exact schema
 * scripts/publishing-bind-heroes.mjs (the CLI) reads from local disk, and
 * the only source of truth the Publishing Agent binds assets from -- never
 * a directory scan, never a filename-based guess. See
 * publishing-package-gateway.ts's own header comment for the full list of
 * publishing-agent operating principles this schema exists to enforce;
 * principle 1 in particular ("the Publishing Agent publishes from a
 * manifest, never from browser inference") is this file's entire reason to
 * exist.
 *
 * Shape (schema_version 1):
 *   {
 *     "schema_version": 1,
 *     "firm_id": "uuid",
 *     "operations": [
 *       {
 *         "deliverable_id": "uuid",
 *         "expected_locale": "en-CA",
 *         "expected_content_kind": "text",
 *         "asset_path": "assets/example.png",
 *         "expected_sha256": "64-lowercase-hex-characters",
 *         "alt_text": "required accessibility text"
 *       }
 *     ]
 *   }
 *
 * Every field is validated exactly as authored -- this module never
 * lowercases, trims, defaults, or otherwise silently normalizes malformed
 * data into something that happens to pass. A malformed manifest is a hard
 * validation failure, reported with every violation found (not just the
 * first), so a caller can fix the whole manifest in one pass rather than
 * discovering violations one CLI run at a time.
 */

import {
  SUPPORTED_HERO_PACKAGE_CONTENT_KINDS,
  SUPPORTED_HERO_PACKAGE_LOCALES,
  HERO_PACKAGE_UUID_RE as UUID_RE,
} from "@/lib/publishing-package-gateway";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export interface PublishingPackageManifestOperation {
  deliverableId: string;
  expectedLocale: string;
  expectedContentKind: string;
  assetPath: string;
  expectedSha256: string;
  altText: string;
}

export interface PublishingPackageManifest {
  schemaVersion: 1;
  firmId: string;
  operations: PublishingPackageManifestOperation[];
}

export interface ManifestValidationError {
  /** e.g. "operations[2].expected_sha256" -- always points at the exact offending field. */
  path: string;
  message: string;
}

export type ManifestValidationResult =
  | { ok: true; manifest: PublishingPackageManifest; errors: [] }
  | { ok: false; manifest: null; errors: ManifestValidationError[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates a raw, already-JSON-parsed manifest value against the exact
 * schema above. Collects every violation found across the whole manifest
 * (not just the first) so the CLI's own "validate the entire manifest
 * before the first write" requirement has something real to report in one
 * pass.
 */
export function validatePublishingPackageManifest(raw: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = [];

  if (!isPlainObject(raw)) {
    return { ok: false, manifest: null, errors: [{ path: "$", message: "manifest must be a JSON object" }] };
  }

  if (raw.schema_version !== 1) {
    errors.push({ path: "schema_version", message: `schema_version must equal 1 (got ${JSON.stringify(raw.schema_version)})` });
  }

  const firmId = raw.firm_id;
  if (typeof firmId !== "string" || !UUID_RE.test(firmId)) {
    errors.push({ path: "firm_id", message: `firm_id must be a valid UUID (got ${JSON.stringify(firmId)})` });
  }

  const rawOperations = raw.operations;
  if (!Array.isArray(rawOperations)) {
    errors.push({ path: "operations", message: "operations must be an array" });
  } else if (rawOperations.length === 0) {
    errors.push({ path: "operations", message: "operations must not be empty" });
  }

  const operations: PublishingPackageManifestOperation[] = [];
  const seenDeliverableIds = new Set<string>();
  const seenAssetPaths = new Set<string>();
  const duplicateDeliverableIds = new Set<string>();
  const duplicateAssetPaths = new Set<string>();

  if (Array.isArray(rawOperations)) {
    rawOperations.forEach((rawOp, index) => {
      const base = `operations[${index}]`;
      if (!isPlainObject(rawOp)) {
        errors.push({ path: base, message: "each operation must be a JSON object" });
        return;
      }

      const deliverableId = rawOp.deliverable_id;
      if (typeof deliverableId !== "string" || !UUID_RE.test(deliverableId)) {
        errors.push({ path: `${base}.deliverable_id`, message: `deliverable_id must be a valid UUID (got ${JSON.stringify(deliverableId)})` });
      } else {
        if (seenDeliverableIds.has(deliverableId)) duplicateDeliverableIds.add(deliverableId);
        seenDeliverableIds.add(deliverableId);
      }

      const expectedLocale = rawOp.expected_locale;
      if (typeof expectedLocale !== "string" || !(SUPPORTED_HERO_PACKAGE_LOCALES as readonly string[]).includes(expectedLocale)) {
        errors.push({
          path: `${base}.expected_locale`,
          message: `expected_locale must be one of ${SUPPORTED_HERO_PACKAGE_LOCALES.join(", ")} (got ${JSON.stringify(expectedLocale)})`,
        });
      }

      const expectedContentKind = rawOp.expected_content_kind;
      if (
        typeof expectedContentKind !== "string" ||
        !(SUPPORTED_HERO_PACKAGE_CONTENT_KINDS as readonly string[]).includes(expectedContentKind)
      ) {
        errors.push({
          path: `${base}.expected_content_kind`,
          message: `expected_content_kind must be one of ${SUPPORTED_HERO_PACKAGE_CONTENT_KINDS.join(", ")} (got ${JSON.stringify(expectedContentKind)})`,
        });
      }

      const assetPath = rawOp.asset_path;
      if (typeof assetPath !== "string" || assetPath.length === 0) {
        errors.push({ path: `${base}.asset_path`, message: "asset_path must be a non-empty relative path" });
      } else {
        if (seenAssetPaths.has(assetPath)) duplicateAssetPaths.add(assetPath);
        seenAssetPaths.add(assetPath);
      }

      const expectedSha256 = rawOp.expected_sha256;
      if (typeof expectedSha256 !== "string" || !SHA256_HEX_RE.test(expectedSha256)) {
        errors.push({
          path: `${base}.expected_sha256`,
          message: `expected_sha256 must be exactly 64 lowercase hexadecimal characters (got ${JSON.stringify(expectedSha256)})`,
        });
      }

      const altText = rawOp.alt_text;
      if (typeof altText !== "string" || altText.trim().length === 0) {
        errors.push({ path: `${base}.alt_text`, message: "alt_text must be non-empty" });
      }

      if (
        typeof deliverableId === "string" &&
        UUID_RE.test(deliverableId) &&
        typeof expectedLocale === "string" &&
        (SUPPORTED_HERO_PACKAGE_LOCALES as readonly string[]).includes(expectedLocale) &&
        typeof expectedContentKind === "string" &&
        (SUPPORTED_HERO_PACKAGE_CONTENT_KINDS as readonly string[]).includes(expectedContentKind) &&
        typeof assetPath === "string" &&
        assetPath.length > 0 &&
        typeof expectedSha256 === "string" &&
        SHA256_HEX_RE.test(expectedSha256) &&
        typeof altText === "string" &&
        altText.trim().length > 0
      ) {
        operations.push({ deliverableId, expectedLocale, expectedContentKind, assetPath, expectedSha256, altText });
      }
    });
  }

  for (const dup of duplicateDeliverableIds) {
    errors.push({ path: "operations", message: `duplicate deliverable_id in manifest: ${dup}` });
  }
  for (const dup of duplicateAssetPaths) {
    errors.push({ path: "operations", message: `duplicate asset_path in manifest: ${dup}` });
  }

  if (errors.length > 0 || typeof firmId !== "string") {
    return { ok: false, manifest: null, errors };
  }

  return {
    ok: true,
    manifest: { schemaVersion: 1, firmId, operations },
    errors: [],
  };
}
