/**
 * Publishing Package Gateway: the pure validation core behind
 * POST /api/publishing-agent/hero-package.
 *
 * Scope, deliberately narrow (see the CLI's own header comment in
 * scripts/publishing-bind-heroes.mjs for the same principles restated
 * publishing-agent-side): this module authorizes exactly one operation --
 * upload one approved hero image and bind it to one exact deliverable. It
 * has no awareness of, and cannot be composed into, content-body edits,
 * title edits, approval, sign-off, status changes, placement, notification,
 * the Files hub, user sessions, external publishing, or direct database
 * writes beyond the single hero_image_url column this module itself
 * updates. A future generic "publish anything" capability must not be
 * built by loosening this module -- it must be its own, separately
 * reviewed surface.
 *
 * Publishing-agent operating principles this module enforces or assumes
 * (also restated in the CLI and in this repo's manifest-schema doc
 * comment, so the same list survives wherever a developer lands first):
 *   1. The Publishing Agent publishes from a manifest, never from browser
 *      inference -- this module never scans storage or guesses an asset's
 *      role from its filename; every field it trusts was supplied
 *      explicitly by the caller and is independently re-validated here.
 *   2. Every release object requires exact bindings: firm, deliverable,
 *      locale, content kind, asset role (hero, always, for this endpoint),
 *      asset filename, asset hash, destination (the deliverable's own
 *      hero_image_url column, the only destination this endpoint writes).
 *   3. A matching-looking asset is not valid evidence of correctness --
 *      the server independently computes SHA-256 from the actual received
 *      bytes and MIME-sniffs from actual bytes; it never trusts a
 *      caller-supplied filename, Content-Type header, or hash claim
 *      without checking it against the real bytes.
 *   4. An EN text-overlay asset must never bind to PT content and a PT
 *      text-overlay asset must never bind to EN content -- enforced here
 *      by requiring expectedLocale to equal the deliverable's own recorded
 *      locale exactly; a caller cannot bind an asset intended for one
 *      locale to a deliverable of another.
 *   5. A website hero, a Native LinkedIn Article cover, a LinkedIn post
 *      card, a GBP card, a Lead Magnet hero, and a Landing Page hero are
 *      distinct destination roles with no implicit substitution -- this
 *      endpoint binds hero_image_url ONLY, the website-hero role; it has
 *      no code path for any other asset role and must not be extended to
 *      accept one without a separate, reviewed design.
 *   6. This gateway is intentionally hero-image-upload/bind only. It must
 *      not become a generic publishing back door -- see the authorization-
 *      boundary tests in __tests__/publishing-package-gateway.test.ts,
 *      which prove the credential this endpoint accepts cannot reach any
 *      other operation.
 *   7. The broader publishing system will later need a complete weekly
 *      package manifest (source deliverable/version, locale, destination,
 *      content relationship, asset id/hash/dimensions, CTA label and exact
 *      target, PDF asset where applicable, approval state, planned
 *      placement, QA state) -- this module and its manifest sibling
 *      (publishing-package-manifest.ts) are the narrow asset-upload
 *      foundation for that future system, not a preview of its full shape.
 *
 * No I/O in this file except the pure byte-level MIME sniff and hash
 * functions below (both operate only on an in-memory Buffer, no network or
 * filesystem access). The actual Supabase read/write and storage upload
 * live in the route handler (src/app/api/publishing-agent/hero-package/route.ts),
 * which composes these pure checks with real I/O the same way this
 * codebase's other pure-core/thin-loader pairs do (e.g. publication-preflight.ts
 * + publication-preflight-loader.ts).
 */

import { createHash } from "crypto";

/** Reuses the same private bucket the existing operator-facing hero upload endpoint (src/app/api/portal/[firmId]/deliverables/[deliverableId]/hero/route.ts) already writes to -- "the established hero-image storage location," never a new bucket or an arbitrary caller-supplied path. */
export const HERO_PACKAGE_BUCKET = "firm-files";

/** Same 10 MB limit the existing hero upload endpoint already enforces. */
export const HERO_PACKAGE_MAX_BYTES = 10 * 1024 * 1024;

export type HeroPackageMimeType = "image/png" | "image/jpeg" | "image/webp";

/**
 * The only content kinds a hero image may bind to. Matches
 * types.ts's ContentKind exactly -- this module does not invent its own
 * vocabulary for a concept the schema already defines.
 */
export const SUPPORTED_HERO_PACKAGE_CONTENT_KINDS = ["text", "image", "pdf"] as const;
export type HeroPackageContentKind = (typeof SUPPORTED_HERO_PACKAGE_CONTENT_KINDS)[number];

/**
 * The locales this gateway accepts today. Mirrors the two locales actually
 * in production use across this codebase (en-CA, pt-BR); extend this list,
 * deliberately, when a firm adds a new locale -- never accept an
 * unrecognized locale string silently.
 */
export const SUPPORTED_HERO_PACKAGE_LOCALES = ["en-CA", "pt-BR"] as const;
export type HeroPackageLocale = (typeof SUPPORTED_HERO_PACKAGE_LOCALES)[number];

/** Single shared UUID-shape check -- the endpoint and the manifest validator (publishing-package-manifest.ts) both import this exact constant rather than each maintaining their own copy, so "the same UUID regex" is a real invariant, not a hand-kept one. */
export const HERO_PACKAGE_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** MIME-sniffs actual image bytes -- never trusts a filename or a caller-supplied Content-Type. Same magic-byte signatures the existing hero upload endpoint already uses, plus the classic JPEG/PNG/WebP set the brief requires (JPG and JPEG are the same format/signature). */
export function sniffHeroPackageMime(buf: Buffer): HeroPackageMimeType | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  return null;
}

/** SHA-256 of the actual received bytes, hex-encoded lowercase -- computed server-side, never trusted from the caller beyond the expected-hash comparison this module performs. */
export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function safeHeroPackageFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

/** Deterministic storage path within HERO_PACKAGE_BUCKET -- never a caller-supplied or arbitrary path. Mirrors the existing hero endpoint's own deliverables/hero/{firmId}/{deliverableId}/ prefix convention so both write into the same recognizable location. */
export function heroPackageStoragePath(input: {
  firmId: string;
  deliverableId: string;
  operationId: string;
  fileName: string;
}): string {
  return `deliverables/hero/${input.firmId}/${input.deliverableId}/${input.operationId}-${safeHeroPackageFileName(input.fileName)}`;
}

export type HeroPackageBytesRejectionReason =
  | "unsupported_mime"
  | "too_large"
  | "hash_mismatch";

export interface HeroPackageBytesValidation {
  ok: boolean;
  rejectionReason: HeroPackageBytesRejectionReason | null;
  sniffedMime: HeroPackageMimeType | null;
  computedSha256: string;
  byteSize: number;
}

/**
 * Validates the actual received bytes against the manifest-declared
 * expectation: real MIME (sniffed, never trusted from a header), real size
 * (never trusted from a Content-Length header), real SHA-256 (computed
 * server-side and compared against the caller's expected hash). Every
 * check independently capable of failing closed; the caller must treat any
 * non-ok result as a hard rejection with no partial credit.
 *
 * expectedSha256Hex is compared EXACTLY, byte for byte -- never
 * lowercased, trimmed, or otherwise normalized before comparison. This
 * mirrors the manifest schema's own "no silent normalization" rule
 * (publishing-package-manifest.ts): an uppercase-hex hash is a malformed
 * hash, not a case-insensitive match, and every real caller in this
 * codebase (the route, the CLI) already only ever produces lowercase hex
 * via Node's own createHash(...).digest("hex").
 */
export function validateHeroPackageBytes(bytes: Buffer, expectedSha256Hex: string): HeroPackageBytesValidation {
  const byteSize = bytes.length;
  const computedSha256 = sha256Hex(bytes);

  if (byteSize > HERO_PACKAGE_MAX_BYTES) {
    return { ok: false, rejectionReason: "too_large", sniffedMime: null, computedSha256, byteSize };
  }

  const sniffedMime = sniffHeroPackageMime(bytes);
  if (!sniffedMime) {
    return { ok: false, rejectionReason: "unsupported_mime", sniffedMime: null, computedSha256, byteSize };
  }

  if (computedSha256 !== expectedSha256Hex) {
    return { ok: false, rejectionReason: "hash_mismatch", sniffedMime, computedSha256, byteSize };
  }

  return { ok: true, rejectionReason: null, sniffedMime, computedSha256, byteSize };
}

/**
 * The minimal shape this module needs from a content_deliverables row --
 * never the full ContentDeliverable type, so this pure function's tests
 * don't need to construct every unrelated column.
 */
export interface HeroPackageDeliverableRecord {
  id: string;
  firm_id: string;
  status: string;
  locale: string | null;
  content_kind: string;
}

export type HeroPackageIdentityRejectionReason =
  | "deliverable_not_found"
  | "cross_firm"
  | "archived"
  | "locale_mismatch"
  | "content_kind_mismatch";

export interface HeroPackageIdentityValidation {
  ok: boolean;
  rejectionReason: HeroPackageIdentityRejectionReason | null;
}

/**
 * Confirms the exact firm/deliverable/locale/content-kind binding before
 * any storage write is attempted. A deliverable that resolves (exists,
 * matches firm) but has the wrong locale, wrong content kind, or is
 * archived is rejected just as firmly as one that does not exist at all --
 * "resolves to a real row" is never treated as sufficient on its own.
 */
export function validateHeroPackageDeliverableIdentity(
  deliverable: HeroPackageDeliverableRecord | null,
  expected: { firmId: string; deliverableId: string; expectedLocale: string; expectedContentKind: string },
): HeroPackageIdentityValidation {
  if (!deliverable) {
    return { ok: false, rejectionReason: "deliverable_not_found" };
  }
  if (deliverable.firm_id !== expected.firmId) {
    return { ok: false, rejectionReason: "cross_firm" };
  }
  if (deliverable.status === "archived") {
    return { ok: false, rejectionReason: "archived" };
  }
  if (deliverable.locale !== expected.expectedLocale) {
    return { ok: false, rejectionReason: "locale_mismatch" };
  }
  if (deliverable.content_kind !== expected.expectedContentKind) {
    return { ok: false, rejectionReason: "content_kind_mismatch" };
  }
  return { ok: true, rejectionReason: null };
}

export type HeroPackageFinalOutcome =
  | "confirmed"
  | "rejected_malformed_request"
  | "rejected_unsupported_mime"
  | "rejected_too_large"
  | "rejected_hash_mismatch"
  | "rejected_deliverable_not_found"
  | "rejected_cross_firm"
  | "rejected_archived"
  | "rejected_locale_mismatch"
  | "rejected_content_kind_mismatch"
  | "rejected_storage_write_failed"
  | "rejected_binding_write_failed";

export interface HeroPackageReceipt {
  operationId: string;
  timestamp: string;
  firmId: string;
  deliverableId: string;
  fileName: string;
  mimeType: string | null;
  byteSize: number;
  computedSha256: string;
  expectedSha256: string;
  /** Required accessibility text supplied with the upload -- transported and receipted, but NOT yet persisted (no hero_image_url-adjacent alt-text column exists; the migration-lineage freeze blocks adding one). See docs/publication-operator/publishing-package-gateway.md for the deferral. */
  altText: string;
  storageKey: string | null;
  resultingHeroBinding: string | null;
  finalValidationOutcome: HeroPackageFinalOutcome;
}
