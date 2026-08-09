/**
 * Pure, offline DRG weekly-package staging protocol.
 *
 * This module performs no I/O and exposes no apply adapter. It turns one
 * sealed sixteen-piece package plus a read-only portal snapshot into an
 * all-or-nothing plan. A future writer must execute that plan transactionally
 * and then call reconcileDrgPackageStaging against a fresh read. Until that
 * second reconciliation proves all sixteen exact versions, the package stays
 * hidden from both Deliverables and Publishing Kit.
 */

import type {
  ContentKind,
  DeliverableRole,
  PublicationDestination,
} from "./types";
import {
  assertVerifiedDrgReleaseAuthorizationEnvelope,
  type VerifiedDrgReleaseAuthorizationEnvelope,
} from "./drg-release-authorization-envelope";

export type DrgLocale = "en-CA" | "pt-BR";

export const DRG_SIXTEEN_PIECE_REGISTRY = [
  { id: "CN-EN", locale: "en-CA", contentKind: "text", deliverableRole: "article", destination: "firm_website" },
  { id: "CN-PT", locale: "pt-BR", contentKind: "text", deliverableRole: "article", destination: "firm_website" },
  { id: "CIM-EN", locale: "en-CA", contentKind: "text", deliverableRole: "article", destination: "firm_website" },
  { id: "CIM-PT", locale: "pt-BR", contentKind: "text", deliverableRole: "article", destination: "firm_website" },
  { id: "CHECKLIST-LANDING-EN", locale: "en-CA", contentKind: "text", deliverableRole: "landing_page", destination: "firm_website" },
  { id: "CHECKLIST-PDF-EN", locale: "en-CA", contentKind: "pdf", deliverableRole: "lead_magnet_pdf", destination: "firm_website" },
  { id: "CHECKLIST-LANDING-PT", locale: "pt-BR", contentKind: "text", deliverableRole: "landing_page", destination: "firm_website" },
  { id: "CHECKLIST-PDF-PT", locale: "pt-BR", contentKind: "pdf", deliverableRole: "lead_magnet_pdf", destination: "firm_website" },
  { id: "MINUTE-EN", locale: "en-CA", contentKind: "text", deliverableRole: "email_newsletter", destination: "email" },
  { id: "LINKEDIN-CN-EN", locale: "en-CA", contentKind: "text", deliverableRole: "article", destination: "linkedin_article" },
  { id: "LINKEDIN-CIM-EN", locale: "en-CA", contentKind: "text", deliverableRole: "article", destination: "linkedin_article" },
  { id: "LINKEDIN-POST-CN-EN", locale: "en-CA", contentKind: "text", deliverableRole: "social_post", destination: "linkedin" },
  { id: "LINKEDIN-POST-CIM-EN", locale: "en-CA", contentKind: "text", deliverableRole: "social_post", destination: "linkedin" },
  { id: "GBP-CN-EN", locale: "en-CA", contentKind: "text", deliverableRole: "gbp_post", destination: "google_business_profile" },
  { id: "GBP-CIM-EN", locale: "en-CA", contentKind: "text", deliverableRole: "gbp_post", destination: "google_business_profile" },
  { id: "GBP-CHECKLIST-EN", locale: "en-CA", contentKind: "text", deliverableRole: "gbp_post", destination: "google_business_profile" },
] as const satisfies readonly {
  id: string;
  locale: DrgLocale;
  contentKind: ContentKind;
  deliverableRole: DeliverableRole;
  destination: PublicationDestination;
}[];

export type DrgPieceId = (typeof DRG_SIXTEEN_PIECE_REGISTRY)[number]["id"];

export const DRG_REQUIRED_DOCTRINE_PINS = Object.freeze([
  { id: "DRGLaw_ContentStrategy", version: "4.18", sha256: "7435afd74244ceef85be3d29f8b69ab11e5d72b5f9b3453502f84e6cf372c69e" },
  { id: "DRGLaw_BrandBook", version: "13", sha256: "9bc8594764cd242c498dab1b1d3ec194289cae4411c930750bf5819c11cec818" },
  { id: "DRG_Terminology", version: "2", sha256: "0f39469b752c043f3d7bc0ca3351a544c2d12d0a139ee1eaf47fcb982d374d16" },
  { id: "DECISION_RECORDS", version: "DR-118", sha256: "289fadf02782af6b3af35079b29d2d056233687deae416011a6dae6738884d37" },
] as const);

const REGISTRY_BY_ID = new Map<string, (typeof DRG_SIXTEEN_PIECE_REGISTRY)[number]>(
  DRG_SIXTEEN_PIECE_REGISTRY.map((piece) => [piece.id, piece]),
);

const SHA256_RE = /^[0-9a-f]{64}$/;

export interface ImmutableHashPin {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
}

export interface DrgTextVersionPayload {
  readonly kind: "text";
  readonly bodyHtml: string;
}

export interface DrgPdfVersionPayload {
  readonly kind: "pdf";
  readonly storageKey: string;
  readonly filename: string;
  readonly mimeType: "application/pdf";
  readonly byteSize: number;
  readonly assetSha256: string;
}

export type DrgVersionPayload = DrgTextVersionPayload | DrgPdfVersionPayload;

export interface DrgPackagePieceDraft {
  readonly id: string;
  readonly locale: string;
  readonly title: string;
  readonly sourceSha256: string;
  readonly payload: DrgVersionPayload;
}

export interface DrgWeeklyPackageDraft {
  readonly schemaVersion: "drg-weekly-package/v1";
  readonly packageId: string;
  readonly packageVersion: number;
  readonly firmId: string;
  readonly periodId: string;
  readonly sources: {
    readonly topicSelection: ImmutableHashPin;
    readonly researchEvidence: ImmutableHashPin;
    readonly contentManifest: ImmutableHashPin;
  };
  readonly doctrine: readonly ImmutableHashPin[];
  readonly pieces: readonly DrgPackagePieceDraft[];
}

export interface SealedDrgPackagePiece extends DrgPackagePieceDraft {
  readonly id: DrgPieceId;
  readonly locale: DrgLocale;
  readonly pieceSha256: string;
}

export interface SealedDrgWeeklyPackage extends Omit<DrgWeeklyPackageDraft, "pieces"> {
  readonly pieces: readonly SealedDrgPackagePiece[];
  readonly packageSha256: string;
}

export type Sha256Function = (canonicalUtf8Text: string) => string;

export interface DrgPackageBlocker {
  readonly code:
    | "invalid_package"
    | "package_hash_mismatch"
    | "scope_mismatch"
    | "duplicate_state_piece"
    | "unexpected_state_piece"
    | "deliverable_identity_mismatch"
    | "current_version_unresolved"
    | "release_authorization_mismatch";
  readonly pieceId: string | null;
  readonly message: string;
}

export const DRG_PACKAGE_VISIBILITY_CONTRACT = Object.freeze({
  beforeAtomicCommit: "hidden",
  duringPartialApply: "hidden",
  afterCommitBeforeSecondReconciliation: "hidden",
  visibleOnlyWhen: "a fresh zero-write reconciliation proves all sixteen exact package versions",
} as const);

export interface StagedVersionBinding {
  readonly id: string;
  readonly versionNumber: number;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly packageSha256: string;
  readonly pieceSha256: string;
  readonly sourceSha256: string;
}

export interface StagedApprovalBinding {
  readonly decision: "approved" | "changes_requested";
  readonly versionId: string;
  readonly packageSha256: string;
}

export interface StagedDeliverableSnapshot {
  readonly pieceId: string;
  readonly deliverableId: string;
  readonly firmId: string;
  readonly periodId: string;
  readonly locale: string;
  readonly contentKind: ContentKind;
  readonly deliverableRole: DeliverableRole;
  readonly destination: PublicationDestination;
  readonly currentVersionId: string | null;
  readonly approvedVersionId: string | null;
  readonly currentVersion: StagedVersionBinding | null;
  readonly approval: StagedApprovalBinding | null;
}

export interface DrgPortalStagingSnapshot {
  readonly firmId: string;
  readonly periodId: string;
  /** Only rows claimed by this package protocol may be included. */
  readonly deliverables: readonly StagedDeliverableSnapshot[];
}

interface PlanActionBase {
  readonly pieceId: DrgPieceId;
  readonly packageSha256: string;
  readonly pieceSha256: string;
  readonly deliverableIdempotencyKey: string;
  readonly versionIdempotencyKey: string;
}

export interface AddDeliverableAction extends PlanActionBase {
  readonly action: "add";
  readonly piece: SealedDrgPackagePiece;
}

export interface NewVersionAction extends PlanActionBase {
  readonly action: "new_version";
  readonly deliverableId: string;
  readonly priorVersionId: string | null;
  readonly expectedVersionNumber: number;
  readonly piece: SealedDrgPackagePiece;
}

export interface CorrectSkipAction extends PlanActionBase {
  readonly action: "correct_skip";
  readonly deliverableId: string;
  readonly versionId: string;
  readonly versionNumber: number;
}

export type DrgStagingAction = AddDeliverableAction | NewVersionAction | CorrectSkipAction;

export type DrgStagingPlan =
  | {
      readonly kind: "atomic_plan";
      readonly packageIdempotencyKey: string;
      readonly packageSha256: string;
      readonly actions: readonly DrgStagingAction[];
      readonly visibility: typeof DRG_PACKAGE_VISIBILITY_CONTRACT;
      readonly writesPerformed: 0;
    }
  | {
      readonly kind: "no_plan";
      readonly actions: readonly [];
      readonly blockers: readonly DrgPackageBlocker[];
      readonly visibility: typeof DRG_PACKAGE_VISIBILITY_CONTRACT;
      readonly writesPerformed: 0;
    };

export interface DrgPackageReconciliation {
  readonly status: "exact_match" | "not_reconciled" | "blocked";
  readonly visible: boolean;
  readonly writesPerformed: 0;
  readonly correctCount: number;
  readonly missingOrDriftedCount: number;
  readonly blockers: readonly DrgPackageBlocker[];
}

export interface PublishingKitPieceProjection {
  readonly pieceId: DrgPieceId;
  readonly locale: DrgLocale;
  readonly deliverableId: string;
  readonly approvedVersionId: string;
  readonly versionNumber: number;
  readonly packageSha256: string;
  readonly pieceSha256: string;
  readonly payload: DrgVersionPayload;
}

export type ReleaseAuthorizedPublishingKitProjection =
  | {
      readonly status: "ready";
      readonly packageSha256: string;
      readonly pieces: readonly PublishingKitPieceProjection[];
      readonly writesPerformed: 0;
    }
  | {
      readonly status: "blocked";
      readonly pieces: readonly [];
      readonly blockers: readonly DrgPackageBlocker[];
      readonly writesPerformed: 0;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** RFC-8785-shaped JSON for the package's JSON-compatible data model. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`canonical JSON rejects ${typeof value}`);
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as unknown as T;
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) clone[key] = cloneAndFreeze(item);
    return Object.freeze(clone) as unknown as T;
  }
  return value;
}

function validPin(pin: ImmutableHashPin): boolean {
  return Boolean(pin.id.trim() && pin.version.trim() && SHA256_RE.test(pin.sha256));
}

function comparePins(left: ImmutableHashPin, right: ImmutableHashPin): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  if (left.version < right.version) return -1;
  if (left.version > right.version) return 1;
  if (left.sha256 < right.sha256) return -1;
  if (left.sha256 > right.sha256) return 1;
  return 0;
}

function validateDraft(draft: DrgWeeklyPackageDraft): string[] {
  const errors: string[] = [];
  if (draft.schemaVersion !== "drg-weekly-package/v1") errors.push("schemaVersion must be drg-weekly-package/v1");
  if (!draft.packageId.trim()) errors.push("packageId is required");
  if (!Number.isInteger(draft.packageVersion) || draft.packageVersion < 1) errors.push("packageVersion must be a positive integer");
  if (!draft.firmId.trim() || !draft.periodId.trim()) errors.push("firmId and periodId are required");
  if (!validPin(draft.sources.topicSelection) || !validPin(draft.sources.researchEvidence) || !validPin(draft.sources.contentManifest)) {
    errors.push("all source pins require id, version, and lowercase SHA-256");
  }
  if (draft.doctrine.length === 0 || draft.doctrine.some((pin) => !validPin(pin))) {
    errors.push("doctrine requires at least one valid immutable hash pin");
  }
  if (new Set(draft.doctrine.map((pin) => pin.id)).size !== draft.doctrine.length) {
    errors.push("doctrine pin ids must be unique");
  }
  for (const required of DRG_REQUIRED_DOCTRINE_PINS) {
    if (!draft.doctrine.some((pin) => pin.id === required.id && pin.version === required.version && pin.sha256 === required.sha256)) {
      errors.push(`doctrine requires exact ${required.id} version ${required.version} SHA-256 ${required.sha256}`);
    }
  }
  if (draft.pieces.length !== DRG_SIXTEEN_PIECE_REGISTRY.length) {
    errors.push(`package must contain exactly ${DRG_SIXTEEN_PIECE_REGISTRY.length} pieces`);
  }
  const seen = new Set<string>();
  for (const piece of draft.pieces) {
    const expected = REGISTRY_BY_ID.get(piece.id);
    if (!expected) errors.push(`unexpected piece id ${piece.id}`);
    if (seen.has(piece.id)) errors.push(`duplicate piece id ${piece.id}`);
    seen.add(piece.id);
    if (expected && piece.locale !== expected.locale) errors.push(`${piece.id} must use locale ${expected.locale}`);
    if (!piece.title.trim()) errors.push(`${piece.id} requires a title`);
    if (!SHA256_RE.test(piece.sourceSha256)) errors.push(`${piece.id} requires a lowercase source SHA-256`);
    if (expected?.contentKind === "text" && (piece.payload.kind !== "text" || !piece.payload.bodyHtml.trim())) {
      errors.push(`${piece.id} requires non-empty HTML text payload`);
    }
    if (expected?.contentKind === "pdf") {
      if (
        piece.payload.kind !== "pdf" ||
        !piece.payload.storageKey.trim() ||
        !piece.payload.filename.trim() ||
        piece.payload.mimeType !== "application/pdf" ||
        !Number.isInteger(piece.payload.byteSize) ||
        piece.payload.byteSize < 1 ||
        !SHA256_RE.test(piece.payload.assetSha256)
      ) {
        errors.push(`${piece.id} requires a complete immutable PDF payload`);
      }
    }
  }
  for (const required of DRG_SIXTEEN_PIECE_REGISTRY) {
    if (!seen.has(required.id)) errors.push(`missing piece id ${required.id}`);
  }
  return errors;
}

function pieceHashInput(piece: DrgPackagePieceDraft): DrgPackagePieceDraft {
  return {
    id: piece.id,
    locale: piece.locale,
    title: piece.title,
    sourceSha256: piece.sourceSha256,
    payload: piece.payload,
  };
}

function packageHashInput(pkg: Omit<SealedDrgWeeklyPackage, "packageSha256"> | SealedDrgWeeklyPackage) {
  return {
    schemaVersion: pkg.schemaVersion,
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    sources: pkg.sources,
    doctrine: pkg.doctrine,
    pieces: pkg.pieces,
  };
}

function checkedHash(sha256: Sha256Function, value: unknown): string {
  const hash = sha256(canonicalJson(value));
  if (!SHA256_RE.test(hash)) throw new Error("SHA-256 function must return 64 lowercase hexadecimal characters");
  return hash;
}

export function sealDrgWeeklyPackage(
  draft: DrgWeeklyPackageDraft,
  sha256: Sha256Function,
): SealedDrgWeeklyPackage {
  const errors = validateDraft(draft);
  if (errors.length > 0) throw new Error(`invalid DRG package: ${errors.join("; ")}`);

  const draftById = new Map(draft.pieces.map((piece) => [piece.id, piece]));
  // Registry order is canonical. Input transport order cannot change package
  // identity, plan order, review order, or approval bindings.
  const pieces = DRG_SIXTEEN_PIECE_REGISTRY.map((registered) => {
    const piece = draftById.get(registered.id)!;
    return {
      ...pieceHashInput(piece),
      id: piece.id as DrgPieceId,
      locale: piece.locale as DrgLocale,
      pieceSha256: checkedHash(sha256, pieceHashInput(piece)),
    };
  });
  const doctrine = [...draft.doctrine].sort(comparePins);
  const withoutHash = { ...draft, doctrine, pieces };
  return cloneAndFreeze({
    ...withoutHash,
    packageSha256: checkedHash(sha256, packageHashInput(withoutHash)),
  } as const);
}

function verifyPackage(pkg: SealedDrgWeeklyPackage, sha256: Sha256Function): DrgPackageBlocker[] {
  const draftErrors = validateDraft(pkg);
  const blockers: DrgPackageBlocker[] = draftErrors.map((message) => ({
    code: "invalid_package",
    pieceId: null,
    message,
  }));
  for (let index = 0; index < DRG_SIXTEEN_PIECE_REGISTRY.length; index += 1) {
    if (pkg.pieces[index]?.id !== DRG_SIXTEEN_PIECE_REGISTRY[index].id) {
      blockers.push({
        code: "invalid_package",
        pieceId: pkg.pieces[index]?.id ?? null,
        message: `sealed package piece ${index + 1} must be ${DRG_SIXTEEN_PIECE_REGISTRY[index].id} in canonical registry order`,
      });
    }
  }
  const sortedDoctrine = [...pkg.doctrine].sort(comparePins);
  if (pkg.doctrine.some((pin, index) =>
    pin.id !== sortedDoctrine[index]?.id ||
    pin.version !== sortedDoctrine[index]?.version ||
    pin.sha256 !== sortedDoctrine[index]?.sha256
  )) {
    blockers.push({ code: "invalid_package", pieceId: null, message: "sealed package doctrine pins are not in canonical lexical order" });
  }
  for (const piece of pkg.pieces) {
    if (piece.pieceSha256 !== checkedHash(sha256, pieceHashInput(piece))) {
      blockers.push({ code: "package_hash_mismatch", pieceId: piece.id, message: `${piece.id} content hash does not match its payload` });
    }
  }
  if (pkg.packageSha256 !== checkedHash(sha256, packageHashInput(pkg))) {
    blockers.push({ code: "package_hash_mismatch", pieceId: null, message: "package SHA-256 does not match the canonical sealed package" });
  }
  return blockers;
}

function packageKey(pkg: SealedDrgWeeklyPackage): string {
  return ["drg-stage", pkg.firmId, pkg.periodId, pkg.packageId, `v${pkg.packageVersion}`, pkg.packageSha256]
    .map(encodeURIComponent)
    .join("/");
}

function actionKeys(pkg: SealedDrgWeeklyPackage, piece: SealedDrgPackagePiece) {
  const base = packageKey(pkg);
  return {
    deliverableIdempotencyKey: `${base}/deliverable/${piece.id}`,
    versionIdempotencyKey: `${base}/version/${piece.id}/${piece.pieceSha256}`,
  };
}

function noPlan(blockers: DrgPackageBlocker[]): DrgStagingPlan {
  return cloneAndFreeze({
    kind: "no_plan",
    actions: [],
    blockers,
    visibility: DRG_PACKAGE_VISIBILITY_CONTRACT,
    writesPerformed: 0,
  } as const);
}

export function planDrgPackageStaging(
  pkg: SealedDrgWeeklyPackage,
  snapshot: DrgPortalStagingSnapshot,
  sha256: Sha256Function,
): DrgStagingPlan {
  const blockers = verifyPackage(pkg, sha256);
  if (snapshot.firmId !== pkg.firmId || snapshot.periodId !== pkg.periodId) {
    blockers.push({ code: "scope_mismatch", pieceId: null, message: "snapshot firm/period does not match the sealed package" });
  }

  const byPiece = new Map<string, StagedDeliverableSnapshot>();
  for (const row of snapshot.deliverables) {
    if (!REGISTRY_BY_ID.has(row.pieceId)) {
      blockers.push({ code: "unexpected_state_piece", pieceId: row.pieceId, message: "snapshot contains a non-registered DRG package piece" });
      continue;
    }
    if (byPiece.has(row.pieceId)) {
      blockers.push({ code: "duplicate_state_piece", pieceId: row.pieceId, message: "snapshot contains more than one deliverable for the package piece" });
      continue;
    }
    byPiece.set(row.pieceId, row);
  }

  const actions: DrgStagingAction[] = [];
  for (const piece of pkg.pieces) {
    const expected = REGISTRY_BY_ID.get(piece.id)!;
    const row = byPiece.get(piece.id);
    const keys = actionKeys(pkg, piece);
    if (!row) {
      actions.push({ action: "add", pieceId: piece.id, packageSha256: pkg.packageSha256, pieceSha256: piece.pieceSha256, ...keys, piece });
      continue;
    }
    if (
      row.firmId !== pkg.firmId ||
      row.periodId !== pkg.periodId ||
      !row.deliverableId.trim() ||
      row.locale !== expected.locale ||
      row.contentKind !== expected.contentKind ||
      row.deliverableRole !== expected.deliverableRole ||
      row.destination !== expected.destination
    ) {
      blockers.push({ code: "deliverable_identity_mismatch", pieceId: piece.id, message: `${piece.id} is bound to incompatible scope or publication metadata` });
      continue;
    }
    if (row.currentVersionId !== (row.currentVersion?.id ?? null)) {
      blockers.push({ code: "current_version_unresolved", pieceId: piece.id, message: `${piece.id} current version pointer is missing, dangling, or cross-wired` });
      continue;
    }
    const current = row.currentVersion;
    if (
      current &&
      (
        !current.id.trim() ||
        !Number.isInteger(current.versionNumber) ||
        current.versionNumber < 1 ||
        !current.packageId.trim() ||
        !Number.isInteger(current.packageVersion) ||
        current.packageVersion < 1 ||
        !SHA256_RE.test(current.packageSha256) ||
        !SHA256_RE.test(current.pieceSha256) ||
        !SHA256_RE.test(current.sourceSha256)
      )
    ) {
      blockers.push({ code: "current_version_unresolved", pieceId: piece.id, message: `${piece.id} current version has malformed immutable identity fields` });
      continue;
    }
    const exact = Boolean(
      current &&
      current.packageId === pkg.packageId &&
      current.packageVersion === pkg.packageVersion &&
      current.packageSha256 === pkg.packageSha256 &&
      current.pieceSha256 === piece.pieceSha256 &&
      current.sourceSha256 === piece.sourceSha256,
    );
    if (exact && current) {
      actions.push({ action: "correct_skip", pieceId: piece.id, packageSha256: pkg.packageSha256, pieceSha256: piece.pieceSha256, ...keys, deliverableId: row.deliverableId, versionId: current.id, versionNumber: current.versionNumber });
    } else {
      actions.push({ action: "new_version", pieceId: piece.id, packageSha256: pkg.packageSha256, pieceSha256: piece.pieceSha256, ...keys, deliverableId: row.deliverableId, priorVersionId: current?.id ?? null, expectedVersionNumber: (current?.versionNumber ?? 0) + 1, piece });
    }
  }

  if (blockers.length > 0 || actions.length !== DRG_SIXTEEN_PIECE_REGISTRY.length) return noPlan(blockers);
  return cloneAndFreeze({
    kind: "atomic_plan",
    packageIdempotencyKey: packageKey(pkg),
    packageSha256: pkg.packageSha256,
    actions,
    visibility: DRG_PACKAGE_VISIBILITY_CONTRACT,
    writesPerformed: 0,
  } as const);
}

/**
 * Mandatory second pass. The function is intentionally incapable of writing.
 * exact_match means every action is now a correct_skip against a fresh read.
 */
export function reconcileDrgPackageStaging(
  pkg: SealedDrgWeeklyPackage,
  snapshot: DrgPortalStagingSnapshot,
  sha256: Sha256Function,
): DrgPackageReconciliation {
  const plan = planDrgPackageStaging(pkg, snapshot, sha256);
  if (plan.kind === "no_plan") {
    return cloneAndFreeze({ status: "blocked", visible: false, writesPerformed: 0, correctCount: 0, missingOrDriftedCount: 16, blockers: plan.blockers } as const);
  }
  const correctCount = plan.actions.filter((action) => action.action === "correct_skip").length;
  const exact = correctCount === DRG_SIXTEEN_PIECE_REGISTRY.length;
  return cloneAndFreeze({
    status: exact ? "exact_match" : "not_reconciled",
    visible: exact,
    writesPerformed: 0,
    correctCount,
    missingOrDriftedCount: DRG_SIXTEEN_PIECE_REGISTRY.length - correctCount,
    blockers: [],
  } as const);
}

export function projectReleaseAuthorizedDrgPublishingKit(
  pkg: SealedDrgWeeklyPackage,
  snapshot: DrgPortalStagingSnapshot,
  verifiedReleaseAuthorization: VerifiedDrgReleaseAuthorizationEnvelope,
  sha256: Sha256Function,
): ReleaseAuthorizedPublishingKitProjection {
  // A structural lookalike or TypeScript cast is not a release capability.
  // Only the canonical signature/evidence verifier can populate its private
  // WeakSet and pass this runtime boundary.
  assertVerifiedDrgReleaseAuthorizationEnvelope(verifiedReleaseAuthorization);
  const releaseAuthorization = verifiedReleaseAuthorization.envelope;
  const blockers = verifyPackage(pkg, sha256);
  const stagingReconciliation = reconcileDrgPackageStaging(pkg, snapshot, sha256);
  if (stagingReconciliation.status !== "exact_match") {
    blockers.push(
      ...stagingReconciliation.blockers,
      {
        code: "release_authorization_mismatch",
        pieceId: null,
        message: "Publishing Kit requires an exact sixteen-piece staging reconciliation",
      },
    );
  }
  if (
    releaseAuthorization.package.id !== pkg.packageId ||
    releaseAuthorization.package.version !== pkg.packageVersion ||
    releaseAuthorization.package.firm_id !== pkg.firmId ||
    releaseAuthorization.package.period_id !== pkg.periodId ||
    releaseAuthorization.package.package_sha256 !== pkg.packageSha256
  ) {
    blockers.push({ code: "release_authorization_mismatch", pieceId: null, message: "release authorization is not bound to this exact package SHA and version" });
  }
  const stateByPiece = new Map(snapshot.deliverables.map((row) => [row.pieceId, row]));
  const releaseAuthorizationByPiece = new Map(releaseAuthorization.pieces.map((piece) => [piece.piece_id, piece]));
  if (releaseAuthorizationByPiece.size !== DRG_SIXTEEN_PIECE_REGISTRY.length || releaseAuthorization.pieces.length !== DRG_SIXTEEN_PIECE_REGISTRY.length) {
    blockers.push({ code: "release_authorization_mismatch", pieceId: null, message: "release authorization must bind exactly sixteen unique package pieces" });
  }
  const pieces: PublishingKitPieceProjection[] = [];
  for (const piece of pkg.pieces) {
    const row = stateByPiece.get(piece.id);
    const authorized = releaseAuthorizationByPiece.get(piece.id);
    const version = row?.currentVersion;
    const exact = Boolean(
      row && authorized && version &&
      row.currentVersionId === version.id &&
      (authorized.path === "individual_approval"
        ? row.approvedVersionId === version.id && row.approval?.decision === "approved" && row.approval.versionId === version.id && row.approval.packageSha256 === pkg.packageSha256
        : Boolean(authorized.standing_authorization_event_id) && authorized.standing_authorization_active && !authorized.change_hold_active && !authorized.requires_individual_review) &&
      authorized.deliverable_id === row.deliverableId &&
      authorized.current_version_id === version.id &&
      authorized.version_number === version.versionNumber &&
      authorized.piece_sha256 === piece.pieceSha256 &&
      authorized.source_sha256 === piece.sourceSha256 &&
      (piece.payload.kind !== "pdf" || authorized.asset_sha256s.includes(piece.payload.assetSha256)) &&
      version.packageId === pkg.packageId &&
      version.packageVersion === pkg.packageVersion &&
      version.packageSha256 === pkg.packageSha256 &&
      version.pieceSha256 === piece.pieceSha256 &&
      version.sourceSha256 === piece.sourceSha256,
    );
    if (!exact || !row || !authorized || !version) {
      blockers.push({ code: "release_authorization_mismatch", pieceId: piece.id, message: `${piece.id} is not release-authorized on its exact current package version` });
      continue;
    }
    pieces.push({
      pieceId: piece.id,
      locale: piece.locale,
      deliverableId: row.deliverableId,
      approvedVersionId: version.id,
      versionNumber: version.versionNumber,
      packageSha256: pkg.packageSha256,
      pieceSha256: piece.pieceSha256,
      payload: piece.payload,
    });
  }

  if (blockers.length > 0 || pieces.length !== DRG_SIXTEEN_PIECE_REGISTRY.length) {
    return cloneAndFreeze({ status: "blocked", pieces: [], blockers, writesPerformed: 0 } as const);
  }
  return cloneAndFreeze({ status: "ready", packageSha256: pkg.packageSha256, pieces, writesPerformed: 0 } as const);
}
