/**
 * DRG package protocol v1.
 *
 * This is deliberately a pure, read-only projection over the existing
 * Content Period export. It does not create Deliverables rows, stage a
 * Publishing Kit, alter approvals, write storage, or publish a website.
 * Those are separate Control Room adapters and their state remains theirs.
 * This protocol owns only the source-to-release-authorized-website-export
 * boundary. Client release authorization is immutable evidence, not a
 * fabricated individual-approval record: a package may be authorized either
 * by an exact individual approval or by a standing authorization snapshot
 * bound to the exact current version.
 */
import { createHash } from "crypto";

import type { ContentExportBundle, ContentExportDeliverable } from "@/lib/content-period-export";
import {
  createSignedDrgWebsiteProjectionAuthorization,
  verifyDrgReleaseAuthorizationEnvelope,
  verifyDrgWebsiteProjectionAuthorization,
  DRG_RELEASE_AUTHORIZATION_MAX_TTL_MS,
  type DrgReleaseAuthorizationEnvelope,
  type DrgReleaseAuthorizationPieceSnapshot,
  type DrgWebsiteProjectionAuthorization,
} from "@/lib/drg-release-authorization-envelope";
import { loadConfiguredDrgReleaseAuthorizationSigner } from "@/lib/drg-release-authorization-envelope-server";

export const DRG_WEBSITE_PACKAGE_SCHEMA_VERSION = "drg.website-package-export.v1" as const;

const SHA256_RE = /^[a-f0-9]{64}$/;
/** These accept the currently registered portal vocabulary without guessing from filenames. */
const ARTICLE_IMAGE_ROLES = new Set(["website_article_hero", "website_article_hero_overlay"]);
const CHECKLIST_PDF_ROLES = new Set(["checklist_pdf", "lead_magnet_pdf", "website_checklist_pdf"]);

export const DRG_PACKAGE_STATES = [
  "initialized",
  "topic_options_presented",
  "topic_selected",
  "source_brief_locked",
  "counsel_note_locked",
  "derivatives_generated",
  "validation_passed",
  "release_authorization_pending",
  "release_authorized",
  "website_export_ready",
  "website_release_authorized",
  "published",
  "blocked",
  "needs_editorial_decision",
] as const;

export type DrgPackageState = (typeof DRG_PACKAGE_STATES)[number];

export const DRG_PACKAGE_GATE_KINDS = [
  "topic_selection",
  "source_brief_lock",
  "counsel_note_lock",
  "release_authorization",
  "website_release_authorization",
] as const;

export type DrgPackageGateKind = (typeof DRG_PACKAGE_GATE_KINDS)[number];

export interface DrgPackageGateEvidence {
  kind: DrgPackageGateKind;
  /** Exact immutable object accepted at the gate. Never an unspecific approval. */
  subject_sha256: string;
  actor_id: string;
  recorded_at: string;
}

/**
 * Immutable, per-piece client release evidence.  The standing path is an
 * explicit snapshot bound to this exact deliverable version; it never
 * pretends that an approval_records row exists.
 */
export interface DrgDoctrinePin {
  id: string;
  version: string;
  sha256: string;
}

export interface DrgSourceVersion {
  source_id: string;
  source_kind: "research" | "source_brief" | "counsel_note" | "decision_record" | "package_piece_source";
  version: string;
  sha256: string;
}

export interface DrgPackageDependency {
  /** The dependent website piece id. */
  piece_id: string;
  /** The upstream website piece id. */
  depends_on_piece_id: string;
}

export interface DrgWebsitePackagePiece {
  piece_id: string;
  deliverable_id: string;
  deliverable_version_id: string;
  locale: "en-CA" | "pt-BR";
  role: "counsel_note" | "clause_in_margin" | "checklist";
  slug: string;
  route: string;
  title: string;
  body_html: string | null;
  publication_path: string | null;
  cta_target_path: string | null;
  release_authorization: DrgReleaseAuthorizationPieceSnapshot;
  /** Deterministic verification expectations for the later website release adapter. */
  expected_metadata: {
    canonical_route: string;
    alternate_routes: { "en-CA": string; "pt-BR": string };
    required_structured_data: string[];
  };
  /** Asset identities only. URLs are intentionally excluded because signed URLs expire. */
  assets: Array<{
    artifact_id: string;
    version_id: string;
    asset_role: string | null;
    locale: string | null;
    destination: string | null;
    storage_bucket: string | null;
    storage_path: string | null;
    sha256: string | null;
    mime_type: string | null;
  }>;
}

export interface DrgWebsitePackageExport {
  schema_version: typeof DRG_WEBSITE_PACKAGE_SCHEMA_VERSION;
  package: {
    id: string;
    version: number;
    firm_id: string;
    period_id: string;
    source_content_export_schema_version: string;
    /** SHA of the exact sixteen-piece package authorized by the portal. */
    source_package_sha256: string;
    doctrine: DrgDoctrinePin[];
    source_versions: DrgSourceVersion[];
    package_sha256: string;
  };
  release_authorization_envelope: DrgReleaseAuthorizationEnvelope;
  website_projection_authorization: DrgWebsiteProjectionAuthorization;
  pieces: DrgWebsitePackagePiece[];
  dependencies: DrgPackageDependency[];
}

export function drgWebsiteProjectionPayload(value: Pick<DrgWebsitePackageExport, "schema_version" | "package" | "release_authorization_envelope" | "pieces" | "dependencies">) {
  const { package_sha256: ignoredPackageSha, ...packageWithoutHash } = value.package;
  return {
    schema_version: value.schema_version,
    package: packageWithoutHash,
    release_envelope_sha256: value.release_authorization_envelope.envelope_sha256,
    pieces: value.pieces,
    dependencies: value.dependencies,
  };
}

export interface DrgWebsitePieceSelection {
  piece_id: string;
  deliverable_id: string;
  /** Must equal the currently approved version exported from the Control Room. */
  deliverable_version_id: string;
  locale: "en-CA" | "pt-BR";
  role: "counsel_note" | "clause_in_margin" | "checklist";
  slug: string;
  /** A root-relative immutable website destination, for example /journal/example. */
  route: string;
  expected_metadata: DrgWebsitePackagePiece["expected_metadata"];
}

export interface DrgWebsitePackageBuildInput {
  package_id: string;
  package_version: number;
  doctrine: DrgDoctrinePin[];
  source_versions: DrgSourceVersion[];
  pieces: DrgWebsitePieceSelection[];
  dependencies: DrgPackageDependency[];
}

export interface DrgProtocolViolation {
  path: string;
  message: string;
}

export type DrgWebsitePackageBuildResult =
  | { ok: true; value: DrgWebsitePackageExport; errors: [] }
  | { ok: false; value: null; errors: DrgProtocolViolation[] };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

/** Canonical JSON used for hashes and idempotency, independent of object insertion order. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * One retry identity per operation, package version, and piece version.
 * Reject empty segments instead of silently producing collision-prone keys.
 */
export function buildDrgIdempotencyKey(input: {
  firm_id: string;
  package_id: string;
  package_version: number;
  piece_id: string;
  deliverable_version_id: string;
  operation: string;
}): string {
  const stringFields = [input.firm_id, input.package_id, input.piece_id, input.deliverable_version_id, input.operation];
  if (stringFields.some((field) => !isNonEmptyString(field))) {
    throw new Error("idempotency key fields must be non-empty strings");
  }
  if (!Number.isSafeInteger(input.package_version) || input.package_version < 1) {
    throw new Error("package_version must be a positive safe integer");
  }
  return [
    input.firm_id,
    input.package_id,
    String(input.package_version),
    input.piece_id,
    input.deliverable_version_id,
    input.operation,
  ].join("/");
}

const NEXT_STATES: Readonly<Record<DrgPackageState, readonly DrgPackageState[]>> = {
  initialized: ["topic_options_presented", "blocked"],
  topic_options_presented: ["topic_selected", "blocked"],
  topic_selected: ["source_brief_locked", "blocked"],
  source_brief_locked: ["counsel_note_locked", "blocked", "needs_editorial_decision"],
  counsel_note_locked: ["derivatives_generated", "blocked", "needs_editorial_decision"],
  derivatives_generated: ["validation_passed", "blocked", "needs_editorial_decision"],
  validation_passed: ["release_authorization_pending", "blocked", "needs_editorial_decision"],
  release_authorization_pending: ["release_authorized", "blocked", "needs_editorial_decision"],
  release_authorized: ["website_export_ready", "blocked"],
  website_export_ready: ["website_release_authorized", "blocked"],
  website_release_authorized: ["published", "blocked"],
  published: [],
  blocked: ["needs_editorial_decision"],
  needs_editorial_decision: ["source_brief_locked", "counsel_note_locked", "blocked"],
};

const GATE_FOR_DESTINATION: Partial<Record<DrgPackageState, DrgPackageGateKind>> = {
  topic_selected: "topic_selection",
  source_brief_locked: "source_brief_lock",
  counsel_note_locked: "counsel_note_lock",
  release_authorized: "release_authorization",
  website_release_authorized: "website_release_authorization",
};

/** Checks a monotonic state transition and the evidence type demanded by its destination. */
export function validateDrgPackageTransition(input: {
  from: DrgPackageState;
  to: DrgPackageState;
  evidence: DrgPackageGateEvidence[];
}): DrgProtocolViolation[] {
  const errors: DrgProtocolViolation[] = [];
  if (!NEXT_STATES[input.from].includes(input.to)) {
    errors.push({ path: "transition", message: `${input.from} cannot transition directly to ${input.to}` });
  }
  const requiredGate = GATE_FOR_DESTINATION[input.to];
  if (input.evidence.some((entry) => !isNonEmptyString(entry.actor_id) || !isNonEmptyString(entry.recorded_at) || Number.isNaN(Date.parse(entry.recorded_at)))) {
    errors.push({ path: "evidence", message: "every gate record requires a named actor_id and an ISO-parseable recorded_at timestamp" });
  }
  if (requiredGate && !input.evidence.some((entry) => entry.kind === requiredGate && isSha256(entry.subject_sha256) && isNonEmptyString(entry.actor_id) && !Number.isNaN(Date.parse(entry.recorded_at)))) {
    errors.push({ path: "evidence", message: `${input.to} requires ${requiredGate} evidence bound to a SHA-256 subject` });
  }
  return errors;
}

function validatePins(
  records: Array<DrgDoctrinePin | DrgSourceVersion>,
  path: string,
  errors: DrgProtocolViolation[],
): void {
  const ids = new Set<string>();
  records.forEach((record, index) => {
    const id = "id" in record ? record.id : record.source_id;
    if (!isNonEmptyString(id)) errors.push({ path: `${path}[${index}]`, message: "id must be non-empty" });
    if (ids.has(id)) errors.push({ path: `${path}[${index}]`, message: `duplicate id ${id}` });
    ids.add(id);
    if ("source_kind" in record && !["research", "source_brief", "counsel_note", "decision_record"].includes(record.source_kind)) {
      errors.push({ path: `${path}[${index}].source_kind`, message: "must be a supported immutable source kind" });
    }
    if (!isNonEmptyString(record.version)) errors.push({ path: `${path}[${index}].version`, message: "version must be non-empty" });
    if (!isSha256(record.sha256)) errors.push({ path: `${path}[${index}].sha256`, message: "sha256 must be lowercase SHA-256 hex" });
  });
}

function hasDependencyCycle(pieces: DrgWebsitePackagePiece[], dependencies: DrgPackageDependency[]): boolean {
  const upstream = new Map<string, string[]>();
  pieces.forEach((piece) => upstream.set(piece.piece_id, []));
  dependencies.forEach((dependency) => upstream.get(dependency.piece_id)?.push(dependency.depends_on_piece_id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const parent of upstream.get(id) ?? []) if (visit(parent)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return pieces.some((piece) => visit(piece.piece_id));
}

function routeMatchesLocale(route: string, locale: "en-CA" | "pt-BR"): boolean {
  return locale === "pt-BR" ? route.startsWith("/pt/") : !route.startsWith("/pt/");
}

function hasRequiredAsset(piece: DrgWebsitePackagePiece): boolean {
  return piece.assets.some((asset) => {
    const correctVersion = asset.version_id === piece.deliverable_version_id;
    const correctLocale = asset.locale === piece.locale;
    const hashPresent = asset.sha256 !== null && SHA256_RE.test(asset.sha256);
    if (piece.role === "checklist") return correctVersion && correctLocale && hashPresent && asset.mime_type === "application/pdf" && CHECKLIST_PDF_ROLES.has(asset.asset_role ?? "");
    return correctVersion && correctLocale && hashPresent && (asset.mime_type?.startsWith("image/") ?? false) && ARTICLE_IMAGE_ROLES.has(asset.asset_role ?? "");
  });
}

/** Structural validation which the website importer can reproduce without portal credentials. */
export function validateDrgWebsitePackageExport(raw: unknown): DrgProtocolViolation[] {
  const errors: DrgProtocolViolation[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [{ path: "$", message: "export must be an object" }];
  const value = raw as Partial<DrgWebsitePackageExport>;
  if (value.schema_version !== DRG_WEBSITE_PACKAGE_SCHEMA_VERSION) {
    errors.push({ path: "schema_version", message: `must equal ${DRG_WEBSITE_PACKAGE_SCHEMA_VERSION}` });
  }
  if (!value.package || typeof value.package !== "object") {
    errors.push({ path: "package", message: "package is required" });
    return errors;
  }
  if (!isNonEmptyString(value.package.id)) errors.push({ path: "package.id", message: "must be non-empty" });
  if (!Number.isSafeInteger(value.package.version) || (value.package.version ?? 0) < 1) errors.push({ path: "package.version", message: "must be a positive safe integer" });
  if (!isNonEmptyString(value.package.firm_id)) errors.push({ path: "package.firm_id", message: "must be non-empty" });
  if (!isNonEmptyString(value.package.period_id)) errors.push({ path: "package.period_id", message: "must be non-empty" });
  if (!isNonEmptyString(value.package.source_content_export_schema_version)) errors.push({ path: "package.source_content_export_schema_version", message: "must be non-empty" });
  let verifiedEnvelope: ReturnType<typeof verifyDrgReleaseAuthorizationEnvelope> | null = null;
  try {
    verifiedEnvelope = verifyDrgReleaseAuthorizationEnvelope(value.release_authorization_envelope);
    if (
      verifiedEnvelope.envelope.package.id !== value.package.id ||
      verifiedEnvelope.envelope.package.version !== value.package.version ||
      verifiedEnvelope.envelope.package.firm_id !== value.package.firm_id ||
      verifiedEnvelope.envelope.package.period_id !== value.package.period_id ||
      verifiedEnvelope.envelope.package.package_sha256 !== value.package.source_package_sha256
    ) errors.push({ path: "release_authorization_envelope", message: "must bind the exact source package identity, scope, and SHA" });
  } catch (error) {
    errors.push({ path: "release_authorization_envelope", message: error instanceof Error ? error.message : String(error) });
  }
  try {
    const projectionAuthorization = verifyDrgWebsiteProjectionAuthorization(value.website_projection_authorization);
    if (projectionAuthorization.release_envelope_sha256 !== verifiedEnvelope?.envelope.envelope_sha256) errors.push({ path: "website_projection_authorization", message: "must bind the exact verified release envelope" });
    const expectedProjectionSha = sha256(drgWebsiteProjectionPayload(value as DrgWebsitePackageExport));
    if (projectionAuthorization.projection_sha256 !== expectedProjectionSha) errors.push({ path: "website_projection_authorization", message: "does not bind the exact final six-piece website projection" });
  } catch (error) {
    errors.push({ path: "website_projection_authorization", message: error instanceof Error ? error.message : String(error) });
  }
  if (!Array.isArray(value.package.doctrine) || value.package.doctrine.length === 0) errors.push({ path: "package.doctrine", message: "must pin at least one doctrine release" });
  else validatePins(value.package.doctrine, "package.doctrine", errors);
  if (!Array.isArray(value.package.source_versions) || value.package.source_versions.length === 0) errors.push({ path: "package.source_versions", message: "must pin at least one source version" });
  else validatePins(value.package.source_versions, "package.source_versions", errors);
  if (!Array.isArray(value.pieces) || value.pieces.length === 0) {
    errors.push({ path: "pieces", message: "must contain at least one approved website piece" });
    return errors;
  }
  if (value.pieces.length !== 6) errors.push({ path: "pieces", message: "must contain exactly the six canonical EN/PT website pieces" });
  const ids = new Set<string>();
  const routesByLocale = new Set<string>();
  const roleKeys = new Set<string>();
  value.pieces.forEach((piece, index) => {
    const path = `pieces[${index}]`;
    if (!piece || typeof piece !== "object") {
      errors.push({ path, message: "must be an object" });
      return;
    }
    if (!isNonEmptyString(piece.piece_id)) errors.push({ path: `${path}.piece_id`, message: "must be non-empty" });
    else if (ids.has(piece.piece_id)) errors.push({ path: `${path}.piece_id`, message: `duplicate piece_id ${piece.piece_id}` });
    else ids.add(piece.piece_id);
    if (!isNonEmptyString(piece.deliverable_id) || !isNonEmptyString(piece.deliverable_version_id)) errors.push({ path, message: "must bind a deliverable and exact deliverable version" });
    if (piece.locale !== "en-CA" && piece.locale !== "pt-BR") errors.push({ path: `${path}.locale`, message: "must be en-CA or pt-BR" });
    if (piece.role !== "counsel_note" && piece.role !== "clause_in_margin" && piece.role !== "checklist") errors.push({ path: `${path}.role`, message: "must be counsel_note, clause_in_margin, or checklist" });
    else {
      const roleKey = `${piece.locale}:${piece.role}`;
      if (roleKeys.has(roleKey)) errors.push({ path: `${path}.role`, message: `duplicate role for locale ${piece.locale}` });
      roleKeys.add(roleKey);
    }
    if (!isNonEmptyString(piece.slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(piece.slug)) errors.push({ path: `${path}.slug`, message: "must be a lowercase kebab-case slug" });
    if (!isNonEmptyString(piece.route) || !piece.route.startsWith("/") || piece.route.includes("//")) errors.push({ path: `${path}.route`, message: "must be a root-relative route" });
    else {
      if (!routeMatchesLocale(piece.route, piece.locale)) errors.push({ path: `${path}.route`, message: "must use /pt/ only for pt-BR and never for en-CA" });
      if (routesByLocale.has(`${piece.locale}:${piece.route}`)) errors.push({ path: `${path}.route`, message: `duplicate route for locale ${piece.locale}` });
      routesByLocale.add(`${piece.locale}:${piece.route}`);
    }
    if (!isNonEmptyString(piece.title)) errors.push({ path: `${path}.title`, message: "must be non-empty" });
    if (!isNonEmptyString(piece.body_html) || piece.body_html.trim().length === 0) errors.push({ path: `${path}.body_html`, message: "must be non-empty approved content" });
    const authorization = piece.release_authorization;
    const envelopeAuthorization = verifiedEnvelope?.envelope.pieces.find((candidate) => candidate.piece_id === piece.piece_id);
    if (
      !authorization ||
      !envelopeAuthorization || authorization.evidence_sha256 !== envelopeAuthorization.evidence_sha256 ||
      authorization.deliverable_id !== piece.deliverable_id ||
      authorization.current_version_id !== piece.deliverable_version_id ||
      authorization.firm_id !== value.package?.firm_id ||
      authorization.period_id !== value.package?.period_id ||
      authorization.package_sha256 !== value.package?.source_package_sha256
    ) {
      errors.push({ path: `${path}.release_authorization`, message: "must be the exact verified portal-envelope piece snapshot" });
    }
    const metadata = piece.expected_metadata;
    if (!metadata || typeof metadata !== "object") errors.push({ path: `${path}.expected_metadata`, message: "is required" });
    else {
      if (metadata.canonical_route !== piece.route) errors.push({ path: `${path}.expected_metadata.canonical_route`, message: "must equal the piece route" });
      if (!routeMatchesLocale(metadata.alternate_routes?.["en-CA"] ?? "", "en-CA") || !routeMatchesLocale(metadata.alternate_routes?.["pt-BR"] ?? "", "pt-BR")) errors.push({ path: `${path}.expected_metadata.alternate_routes`, message: "must declare valid EN and PT routes" });
      if (metadata.alternate_routes?.["en-CA"] === metadata.alternate_routes?.["pt-BR"]) errors.push({ path: `${path}.expected_metadata.alternate_routes`, message: "EN and PT routes must be distinct" });
      const requiredType = piece.role === "checklist" ? "WebPage" : "Article";
      if (!Array.isArray(metadata.required_structured_data) || !metadata.required_structured_data.includes(requiredType) || !metadata.required_structured_data.includes("BreadcrumbList")) errors.push({ path: `${path}.expected_metadata.required_structured_data`, message: `must include ${requiredType} and BreadcrumbList` });
    }
    if (!Array.isArray(piece.assets)) errors.push({ path: `${path}.assets`, message: "must be an array" });
    else piece.assets.forEach((asset, assetIndex) => {
      if (asset.version_id !== piece.deliverable_version_id) errors.push({ path: `${path}.assets[${assetIndex}].version_id`, message: "asset version must equal the piece deliverable version" });
      if (asset.sha256 !== null && !isSha256(asset.sha256)) errors.push({ path: `${path}.assets[${assetIndex}].sha256`, message: "must be null or lowercase SHA-256 hex" });
    });
    if (Array.isArray(piece.assets) && !hasRequiredAsset(piece)) errors.push({ path: `${path}.assets`, message: piece.role === "checklist" ? "requires a locale-matched hash-bearing checklist PDF" : "requires a locale-matched hash-bearing website article image" });
    if (Array.isArray(piece.assets) && authorization && piece.assets.some((asset) => asset.sha256 && !authorization.asset_sha256s.includes(asset.sha256))) errors.push({ path: `${path}.assets`, message: "contains an asset hash absent from the signed portal envelope" });
  });
  const expectedRoleKeys = [
    "en-CA:counsel_note", "en-CA:clause_in_margin", "en-CA:checklist",
    "pt-BR:counsel_note", "pt-BR:clause_in_margin", "pt-BR:checklist",
  ];
  expectedRoleKeys.forEach((roleKey) => {
    if (!roleKeys.has(roleKey)) errors.push({ path: "pieces", message: `missing required website piece ${roleKey}` });
  });
  if (!Array.isArray(value.dependencies)) errors.push({ path: "dependencies", message: "must be an array" });
  else {
    value.dependencies.forEach((dependency, index) => {
      if (!ids.has(dependency.piece_id) || !ids.has(dependency.depends_on_piece_id)) errors.push({ path: `dependencies[${index}]`, message: "must reference known pieces" });
      if (dependency.piece_id === dependency.depends_on_piece_id) errors.push({ path: `dependencies[${index}]`, message: "a piece cannot depend on itself" });
    });
    if (errors.length === 0 && hasDependencyCycle(value.pieces as DrgWebsitePackagePiece[], value.dependencies)) errors.push({ path: "dependencies", message: "dependency graph contains a cycle" });
  }
  if (!isSha256(value.package.package_sha256)) errors.push({ path: "package.package_sha256", message: "must be lowercase SHA-256 hex" });
  else {
    const { package_sha256: _ignored, ...packageWithoutHash } = value.package;
    const expectedHash = sha256({
      schema_version: value.schema_version,
      package: packageWithoutHash,
      release_authorization_envelope: value.release_authorization_envelope,
      website_projection_authorization: value.website_projection_authorization,
      pieces: value.pieces,
      dependencies: value.dependencies,
    });
    if (value.package.package_sha256 !== expectedHash) errors.push({ path: "package.package_sha256", message: "does not match the immutable package payload" });
  }
  return errors;
}

function toPiece(selection: DrgWebsitePieceSelection, deliverable: ContentExportDeliverable, authorization: DrgReleaseAuthorizationPieceSnapshot): DrgWebsitePackagePiece {
  const version = deliverable.current_version!;
  return {
    piece_id: selection.piece_id,
    deliverable_id: deliverable.id,
    deliverable_version_id: version.id,
    locale: selection.locale,
    role: selection.role,
    slug: selection.slug,
    route: selection.route,
    title: deliverable.title,
    body_html: version.body_html,
    publication_path: deliverable.publication_path,
    cta_target_path: deliverable.cta_target_path,
    release_authorization: authorization,
    expected_metadata: selection.expected_metadata,
    assets: deliverable.artifacts
      .filter((asset) => asset.matches_current_version && asset.superseded_at === null)
      .map((asset) => ({
        artifact_id: asset.id,
        version_id: asset.version_id,
        asset_role: asset.asset_role ?? null,
        locale: asset.locale,
        destination: asset.destination,
        storage_bucket: asset.storage_bucket,
        storage_path: asset.storage_path,
        sha256: asset.sha256,
        mime_type: asset.mime_type,
      }))
      .sort((a, b) => a.artifact_id.localeCompare(b.artifact_id)),
  };
}

/**
 * Projects the existing, read-only Control Room ContentExportBundle into a
 * deterministic website-import bundle. A caller supplies the explicit route
 * map; this function refuses to infer a route from a title or filename.
 */
export function buildDrgWebsitePackageExport(
  source: ContentExportBundle,
  input: DrgWebsitePackageBuildInput,
): DrgWebsitePackageBuildResult {
  const errors: DrgProtocolViolation[] = [];
  if (!isNonEmptyString(input.package_id)) errors.push({ path: "package_id", message: "must be non-empty" });
  if (!Number.isSafeInteger(input.package_version) || input.package_version < 1) errors.push({ path: "package_version", message: "must be a positive safe integer" });
  validatePins(input.doctrine, "doctrine", errors);
  validatePins(input.source_versions, "source_versions", errors);
  let verifiedEnvelope: ReturnType<typeof verifyDrgReleaseAuthorizationEnvelope> | null = null;
  try {
    verifiedEnvelope = verifyDrgReleaseAuthorizationEnvelope(source.release_authorization_envelope);
    if (
      verifiedEnvelope.envelope.package.id !== input.package_id ||
      verifiedEnvelope.envelope.package.version !== input.package_version ||
      verifiedEnvelope.envelope.package.firm_id !== source.firm.id ||
      verifiedEnvelope.envelope.package.period_id !== source.period.id
    ) errors.push({ path: "release_authorization_envelope", message: "does not match the requested exact package and export scope" });
  } catch (error) {
    errors.push({ path: "release_authorization_envelope", message: error instanceof Error ? error.message : String(error) });
  }
  const envelopeByDeliverable = new Map((verifiedEnvelope?.envelope.pieces ?? []).map((piece) => [piece.deliverable_id, piece]));
  const deliverables = new Map(source.deliverables.map((deliverable) => [deliverable.id, deliverable]));
  const pieces: DrgWebsitePackagePiece[] = [];
  input.pieces.forEach((selection, index) => {
    const deliverable = deliverables.get(selection.deliverable_id);
    if (!deliverable) {
      errors.push({ path: `pieces[${index}].deliverable_id`, message: "does not exist in the Control Room export" });
      return;
    }
    if (deliverable.publication_destination !== "firm_website") {
      errors.push({ path: `pieces[${index}].deliverable_id`, message: "is not a firm_website deliverable" });
      return;
    }
    if (!deliverable.may_publish || !deliverable.current_version) {
      errors.push({ path: `pieces[${index}].deliverable_id`, message: "does not have a current release-authorized, publishable version" });
      return;
    }
    if (deliverable.current_version.id !== selection.deliverable_version_id) {
      errors.push({ path: `pieces[${index}].deliverable_version_id`, message: "does not equal the exact current release-authorized version" });
      return;
    }
    const authorization = envelopeByDeliverable.get(deliverable.id);
    if (!authorization || authorization.current_version_id !== deliverable.current_version.id) {
      errors.push({ path: `deliverables.${deliverable.id}.release_authorization`, message: "signed portal envelope does not bind this exact current version" });
      return;
    }
    if (deliverable.unresolved_change_request || (deliverable.individual_review_hold && authorization.path === "standing_authorization")) {
      errors.push({ path: `deliverables.${deliverable.id}.release_authorization`, message: "open change request or individual-review hold blocks package export" });
      return;
    }
    if (deliverable.locale !== selection.locale) {
      errors.push({ path: `pieces[${index}].locale`, message: "does not equal the Control Room deliverable locale" });
      return;
    }
    const artifactHashes = deliverable.artifacts.filter((asset) => asset.matches_current_version && asset.superseded_at === null && asset.sha256).map((asset) => asset.sha256 as string);
    if (artifactHashes.some((hash) => !authorization.asset_sha256s.includes(hash))) {
      errors.push({ path: `deliverables.${deliverable.id}.release_authorization`, message: "signed portal envelope does not bind every current asset hash" });
      return;
    }
    pieces.push(toPiece(selection, deliverable, authorization));
  });
  if (errors.length > 0) return { ok: false, value: null, errors };
  const withoutHash = {
    schema_version: DRG_WEBSITE_PACKAGE_SCHEMA_VERSION,
    package: {
      id: input.package_id,
      version: input.package_version,
      firm_id: source.firm.id,
      period_id: source.period.id,
      source_content_export_schema_version: source.schema_version,
      source_package_sha256: verifiedEnvelope!.envelope.package.package_sha256,
      doctrine: [...input.doctrine].sort((a, b) => a.id.localeCompare(b.id)),
      source_versions: [...input.source_versions].sort((a, b) => a.source_id.localeCompare(b.source_id)),
    },
    release_authorization_envelope: verifiedEnvelope!.envelope,
    pieces: [...pieces].sort((a, b) => a.piece_id.localeCompare(b.piece_id)),
    dependencies: [...input.dependencies].sort((a, b) => `${a.piece_id}:${a.depends_on_piece_id}`.localeCompare(`${b.piece_id}:${b.depends_on_piece_id}`)),
  };
  let websiteProjectionAuthorization: DrgWebsiteProjectionAuthorization;
  try {
    const issuedAt = new Date().toISOString();
    websiteProjectionAuthorization = createSignedDrgWebsiteProjectionAuthorization({
      authorizationId: `drg-website-projection:${input.package_id}:v${input.package_version}:${verifiedEnvelope!.envelope.envelope_sha256}`,
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + DRG_RELEASE_AUTHORIZATION_MAX_TTL_MS).toISOString(),
      releaseEnvelopeSha256: verifiedEnvelope!.envelope.envelope_sha256,
      projectionSha256: sha256(drgWebsiteProjectionPayload({ ...withoutHash, package: { ...withoutHash.package, package_sha256: "" } } as DrgWebsitePackageExport)),
      signer: loadConfiguredDrgReleaseAuthorizationSigner(),
    });
  } catch (error) {
    return { ok: false, value: null, errors: [{ path: "website_projection_authorization", message: `issuance failed closed: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  const value: DrgWebsitePackageExport = {
    ...withoutHash,
    website_projection_authorization: websiteProjectionAuthorization,
    package: { ...withoutHash.package, package_sha256: sha256({ ...withoutHash, website_projection_authorization: websiteProjectionAuthorization }) },
  };
  const structuralErrors = validateDrgWebsitePackageExport(value);
  return structuralErrors.length ? { ok: false, value: null, errors: structuralErrors } : { ok: true, value, errors: [] };
}
