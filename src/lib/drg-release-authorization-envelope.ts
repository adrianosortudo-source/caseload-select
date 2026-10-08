import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

export const DRG_RELEASE_AUTHORIZATION_SCHEMA = "drg.release-authorization-envelope.v1" as const;
export const DRG_RELEASE_AUTHORIZATION_SIGNATURE_ALGORITHM = "Ed25519" as const;
export const DRG_RELEASE_AUTHORIZATION_MAX_TTL_MS = 15 * 60_000;
export const DRG_WEBSITE_PROJECTION_AUTHORIZATION_SCHEMA = "drg.website-projection-authorization.v1" as const;

export const DRG_RELEASE_AUTHORIZATION_PIECE_IDS = [
  "CN-EN", "CN-PT", "CIM-EN", "CIM-PT",
  "CHECKLIST-LANDING-EN", "CHECKLIST-PDF-EN",
  "CHECKLIST-LANDING-PT", "CHECKLIST-PDF-PT",
  "MINUTE-EN", "LINKEDIN-CN-EN", "LINKEDIN-CIM-EN",
  "LINKEDIN-POST-CN-EN", "LINKEDIN-POST-CIM-EN",
  "GBP-CN-EN", "GBP-CIM-EN", "GBP-CHECKLIST-EN",
] as const;

export type DrgReleaseAuthorizationPieceId = (typeof DRG_RELEASE_AUTHORIZATION_PIECE_IDS)[number];
export type DrgReleaseAuthorizationPath = "individual_approval" | "standing_authorization";

export interface DrgReleaseAuthorizationPieceSnapshot {
  readonly piece_id: DrgReleaseAuthorizationPieceId;
  readonly firm_id: string;
  readonly period_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly package_sha256: string;
  readonly deliverable_id: string;
  readonly current_version_id: string;
  readonly version_number: number;
  readonly piece_sha256: string;
  readonly source_sha256: string;
  readonly asset_sha256s: readonly string[];
  readonly path: DrgReleaseAuthorizationPath;
  readonly approval_record_id: string | null;
  readonly standing_authorization_event_id: string | null;
  readonly standing_authorization_active: boolean;
  readonly change_hold_active: boolean;
  readonly requires_individual_review: boolean;
  readonly revoked_at: string | null;
  readonly evidence_recorded_at: string;
  readonly evidence_sha256: string;
}

export interface DrgReleaseAuthorizationEnvelope {
  readonly schema_version: typeof DRG_RELEASE_AUTHORIZATION_SCHEMA;
  readonly trust_bundle_sha256: string;
  readonly envelope_id: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly package: {
    readonly id: string;
    readonly version: number;
    readonly firm_id: string;
    readonly period_id: string;
    readonly package_sha256: string;
  };
  readonly pieces: readonly DrgReleaseAuthorizationPieceSnapshot[];
  readonly envelope_sha256: string;
  readonly signature: {
    readonly key_id: string;
    readonly algorithm: typeof DRG_RELEASE_AUTHORIZATION_SIGNATURE_ALGORITHM;
    readonly public_key_spki_sha256: string;
    readonly signature_base64: string;
  };
}

export interface DrgWebsiteProjectionAuthorization {
  readonly schema_version: typeof DRG_WEBSITE_PROJECTION_AUTHORIZATION_SCHEMA;
  readonly trust_bundle_sha256: string;
  readonly authorization_id: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly release_envelope_sha256: string;
  readonly projection_sha256: string;
  readonly authorization_sha256: string;
  readonly signature: DrgReleaseAuthorizationEnvelope["signature"];
}

export interface DrgReleaseAuthorizationSigner {
  readonly keyId: string;
  readonly publicKeySpkiSha256: string;
  sign(payload: Uint8Array): string;
}

export interface DrgReleaseAuthorizationPublicKey {
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly publicKeySpkiSha256: string;
  readonly environment: "production" | "test_only";
  readonly effectiveAt: string;
  readonly retiredAt: string | null;
}

/**
 * Deliberate repository trust registry. Production activation requires adding
 * the provisioned public key here and copying the same entry to the website
 * repository. The RFC 8032 vector is test-only and is rejected in production.
 */
export const DRG_RELEASE_AUTHORIZATION_PUBLIC_KEYS: readonly DrgReleaseAuthorizationPublicKey[] = [{
  keyId: "drg-release-rfc8032-test-v1",
  publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=\n-----END PUBLIC KEY-----\n",
  publicKeySpkiSha256: "06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9",
  environment: "test_only",
  effectiveAt: "2026-08-09T00:00:00.000Z",
  retiredAt: null,
}, {
  keyId: "drg-release-rfc8032-retired-test-v1",
  publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=\n-----END PUBLIC KEY-----\n",
  publicKeySpkiSha256: "06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9",
  environment: "test_only",
  effectiveAt: "2026-08-09T00:00:00.000Z",
  retiredAt: "2026-08-09T12:00:00.000Z",
}] as const;

const SHA256_RE = /^[a-f0-9]{64}$/;
const verifiedAuthorizationBrand: unique symbol = Symbol("verified-drg-release-authorization");
const verifiedAuthorizationResults = new WeakSet<object>();

export interface VerifiedDrgReleaseAuthorizationEnvelope {
  readonly [verifiedAuthorizationBrand]: true;
  readonly envelope: DrgReleaseAuthorizationEnvelope;
}

/** Runtime brand check. A TypeScript assertion cannot mint this capability. */
export function assertVerifiedDrgReleaseAuthorizationEnvelope(
  value: VerifiedDrgReleaseAuthorizationEnvelope,
): void {
  if (!value || typeof value !== "object" || !verifiedAuthorizationResults.has(value)) {
    throw new Error("release authorization verifier result was not issued by the canonical verifier");
  }
}

function deepFreezeReleaseEnvelope(envelope: DrgReleaseAuthorizationEnvelope): DrgReleaseAuthorizationEnvelope {
  for (const piece of envelope.pieces) {
    Object.freeze(piece.asset_sha256s);
    Object.freeze(piece);
  }
  Object.freeze(envelope.pieces);
  Object.freeze(envelope.package);
  Object.freeze(envelope.signature);
  return Object.freeze(envelope);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** RFC-8785-shaped canonical JSON for this JSON-compatible contract. */
export function canonicalDrgReleaseJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical release JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalDrgReleaseJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalDrgReleaseJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`canonical release JSON rejects ${typeof value}`);
}

export function sha256DrgRelease(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export const DRG_RELEASE_TRUST_BUNDLE = Object.freeze({
  schema_version: "drg.release-trust-bundle.v1" as const,
  keys: DRG_RELEASE_AUTHORIZATION_PUBLIC_KEYS.map((key) => ({
    key_id: key.keyId,
    public_key_spki_sha256: key.publicKeySpkiSha256,
    public_key_pem: key.publicKeyPem,
    environment: key.environment,
    effective_at: key.effectiveAt,
    retired_at: key.retiredAt,
  })),
});
export const DRG_RELEASE_TRUST_BUNDLE_SHA256 = sha256DrgRelease(canonicalDrgReleaseJson(DRG_RELEASE_TRUST_BUNDLE));

function envelopeHashPayload(envelope: Pick<DrgReleaseAuthorizationEnvelope, "schema_version" | "trust_bundle_sha256" | "envelope_id" | "issued_at" | "expires_at" | "package" | "pieces">) {
  return {
    schema_version: envelope.schema_version,
    trust_bundle_sha256: envelope.trust_bundle_sha256,
    envelope_id: envelope.envelope_id,
    issued_at: envelope.issued_at,
    expires_at: envelope.expires_at,
    package: envelope.package,
    pieces: envelope.pieces,
  };
}

function signaturePayload(envelope: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalDrgReleaseJson(envelope));
}

export function computeDrgReleaseEvidenceSha256(
  snapshot: Omit<DrgReleaseAuthorizationPieceSnapshot, "evidence_sha256">,
): string {
  return sha256DrgRelease(canonicalDrgReleaseJson(snapshot));
}

export function createSignedDrgReleaseAuthorizationEnvelope(input: {
  readonly envelopeId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly package: DrgReleaseAuthorizationEnvelope["package"];
  readonly pieces: readonly DrgReleaseAuthorizationPieceSnapshot[];
  readonly signer: DrgReleaseAuthorizationSigner;
}): DrgReleaseAuthorizationEnvelope {
  const payload = {
    schema_version: DRG_RELEASE_AUTHORIZATION_SCHEMA,
    trust_bundle_sha256: DRG_RELEASE_TRUST_BUNDLE_SHA256,
    envelope_id: input.envelopeId,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
    package: input.package,
    pieces: [...input.pieces],
  } as const;
  const envelopeWithoutSignature = {
    ...payload,
    envelope_sha256: sha256DrgRelease(canonicalDrgReleaseJson(envelopeHashPayload(payload))),
  };
  return Object.freeze({
    ...envelopeWithoutSignature,
    signature: Object.freeze({
      key_id: input.signer.keyId,
      algorithm: DRG_RELEASE_AUTHORIZATION_SIGNATURE_ALGORITHM,
      public_key_spki_sha256: input.signer.publicKeySpkiSha256,
      signature_base64: input.signer.sign(signaturePayload(envelopeWithoutSignature)),
    }),
  });
}

export function createSignedDrgWebsiteProjectionAuthorization(input: {
  readonly authorizationId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly releaseEnvelopeSha256: string;
  readonly projectionSha256: string;
  readonly signer: DrgReleaseAuthorizationSigner;
}): DrgWebsiteProjectionAuthorization {
  if (!SHA256_RE.test(input.releaseEnvelopeSha256) || !SHA256_RE.test(input.projectionSha256)) throw new Error("website projection authorization hashes are malformed");
  const payload = {
    schema_version: DRG_WEBSITE_PROJECTION_AUTHORIZATION_SCHEMA,
    trust_bundle_sha256: DRG_RELEASE_TRUST_BUNDLE_SHA256,
    authorization_id: input.authorizationId,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
    release_envelope_sha256: input.releaseEnvelopeSha256,
    projection_sha256: input.projectionSha256,
  } as const;
  const authorizationWithoutSignature = { ...payload, authorization_sha256: sha256DrgRelease(canonicalDrgReleaseJson(payload)) };
  return Object.freeze({
    ...authorizationWithoutSignature,
    signature: Object.freeze({
      key_id: input.signer.keyId,
      algorithm: DRG_RELEASE_AUTHORIZATION_SIGNATURE_ALGORITHM,
      public_key_spki_sha256: input.signer.publicKeySpkiSha256,
      signature_base64: input.signer.sign(signaturePayload(authorizationWithoutSignature)),
    }),
  });
}

export function verifyDrgWebsiteProjectionAuthorization(value: unknown, now: Date = new Date()): DrgWebsiteProjectionAuthorization {
  if (!isRecord(value)) throw new Error("website projection authorization must be an object");
  const authorization = value as unknown as DrgWebsiteProjectionAuthorization;
  if (authorization.schema_version !== DRG_WEBSITE_PROJECTION_AUTHORIZATION_SCHEMA || !authorization.authorization_id) throw new Error("unsupported website projection authorization schema");
  if (authorization.trust_bundle_sha256 !== DRG_RELEASE_TRUST_BUNDLE_SHA256) throw new Error("website projection trust bundle SHA mismatch");
  const issuedAt = Date.parse(authorization.issued_at);
  const expiresAt = Date.parse(authorization.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > DRG_RELEASE_AUTHORIZATION_MAX_TTL_MS || expiresAt <= now.getTime()) throw new Error("website projection authorization timestamps are invalid or expired");
  if (!SHA256_RE.test(authorization.release_envelope_sha256) || !SHA256_RE.test(authorization.projection_sha256)) throw new Error("website projection authorization hashes are malformed");
  const { authorization_sha256: ignoredSha, signature, ...hashPayload } = authorization;
  if (authorization.authorization_sha256 !== sha256DrgRelease(canonicalDrgReleaseJson(hashPayload))) throw new Error("website projection authorization SHA mismatch");
  if (!signature || signature.algorithm !== DRG_RELEASE_AUTHORIZATION_SIGNATURE_ALGORITHM || !signature.signature_base64 || !SHA256_RE.test(signature.public_key_spki_sha256)) throw new Error("website projection authorization signature is malformed");
  const trusted = DRG_RELEASE_AUTHORIZATION_PUBLIC_KEYS.find((entry) => entry.keyId === signature?.key_id);
  if (!trusted || trusted.publicKeySpkiSha256 !== signature.public_key_spki_sha256) throw new Error("website projection signer is not repository-pinned");
  if (process.env.NODE_ENV === "production" && trusted.environment !== "production") throw new Error("test-only website projection signer is forbidden in production");
  const effectiveAt = Date.parse(trusted.effectiveAt);
  const retiredAt = trusted.retiredAt === null ? null : Date.parse(trusted.retiredAt);
  if (!Number.isFinite(effectiveAt) || issuedAt < effectiveAt || (retiredAt !== null && (!Number.isFinite(retiredAt) || issuedAt >= retiredAt))) throw new Error("website projection signer was not active when authorization was issued");
  const { signature: ignoredSignature, ...withoutSignature } = authorization;
  if (!verifySignature(null, signaturePayload(withoutSignature), trusted.publicKeyPem, Buffer.from(signature.signature_base64, "base64"))) throw new Error("website projection authorization signature verification failed");
  return deepFreezeReleaseEnvelopeValue(structuredClone(authorization));
}

function deepFreezeReleaseEnvelopeValue<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeReleaseEnvelopeValue(child);
    Object.freeze(value);
  }
  return value;
}

function validatePiece(
  piece: DrgReleaseAuthorizationPieceSnapshot,
  expectedId: DrgReleaseAuthorizationPieceId,
  pkg: DrgReleaseAuthorizationEnvelope["package"],
): void {
  if (piece.piece_id !== expectedId) throw new Error(`release envelope piece order/topology mismatch at ${expectedId}`);
  if (
    !piece.deliverable_id || !piece.current_version_id || !Number.isSafeInteger(piece.version_number) || piece.version_number < 1 ||
    piece.firm_id !== pkg.firm_id || piece.period_id !== pkg.period_id || piece.package_id !== pkg.id ||
    piece.package_version !== pkg.version || piece.package_sha256 !== pkg.package_sha256 ||
    !SHA256_RE.test(piece.piece_sha256) || !SHA256_RE.test(piece.source_sha256) ||
    !Array.isArray(piece.asset_sha256s) || piece.asset_sha256s.some((hash) => !SHA256_RE.test(hash)) ||
    [...piece.asset_sha256s].sort().join(":") !== piece.asset_sha256s.join(":") || new Set(piece.asset_sha256s).size !== piece.asset_sha256s.length ||
    !piece.evidence_recorded_at || Number.isNaN(Date.parse(piece.evidence_recorded_at)) || !SHA256_RE.test(piece.evidence_sha256)
  ) throw new Error(`release envelope contains malformed exact evidence for ${expectedId}`);
  const { evidence_sha256: _ignored, ...evidenceWithoutHash } = piece;
  if (piece.evidence_sha256 !== computeDrgReleaseEvidenceSha256(evidenceWithoutHash)) throw new Error(`release evidence SHA mismatch for ${expectedId}`);
  if (piece.change_hold_active || piece.revoked_at !== null) throw new Error(`release envelope contains blocked or revoked evidence for ${expectedId}`);
  if (piece.path === "individual_approval") {
    if (!piece.approval_record_id || piece.standing_authorization_event_id !== null) throw new Error(`individual approval evidence is incomplete for ${expectedId}`);
  } else if (piece.path === "standing_authorization") {
    if (!piece.standing_authorization_event_id || piece.approval_record_id !== null || !piece.standing_authorization_active || piece.requires_individual_review) throw new Error(`standing authorization evidence is inactive or requires individual review for ${expectedId}`);
  } else throw new Error(`unsupported release path for ${expectedId}`);
}

export function verifyDrgReleaseAuthorizationEnvelope(
  value: unknown,
  now: Date = new Date(),
): VerifiedDrgReleaseAuthorizationEnvelope {
  if (!isRecord(value)) throw new Error("release authorization envelope must be an object");
  const envelope = value as unknown as DrgReleaseAuthorizationEnvelope;
  if (envelope.schema_version !== DRG_RELEASE_AUTHORIZATION_SCHEMA || !envelope.envelope_id) throw new Error("unsupported release authorization envelope schema");
  if (envelope.trust_bundle_sha256 !== DRG_RELEASE_TRUST_BUNDLE_SHA256) throw new Error("release authorization trust bundle SHA mismatch");
  const issuedAt = Date.parse(envelope.issued_at);
  const expiresAt = Date.parse(envelope.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > DRG_RELEASE_AUTHORIZATION_MAX_TTL_MS) throw new Error("release authorization envelope timestamps are invalid");
  if (issuedAt > now.getTime() + 5 * 60_000) throw new Error("release authorization envelope is future-dated");
  if (expiresAt <= now.getTime()) throw new Error("release authorization envelope has expired");
  if (!envelope.package || !envelope.package.id || !Number.isSafeInteger(envelope.package.version) || envelope.package.version < 1 || !envelope.package.firm_id || !envelope.package.period_id || !SHA256_RE.test(envelope.package.package_sha256)) throw new Error("release authorization envelope package binding is malformed");
  if (!Array.isArray(envelope.pieces) || envelope.pieces.length !== DRG_RELEASE_AUTHORIZATION_PIECE_IDS.length) throw new Error("release authorization envelope must contain exactly sixteen pieces");
  DRG_RELEASE_AUTHORIZATION_PIECE_IDS.forEach((pieceId, index) => validatePiece(envelope.pieces[index], pieceId, envelope.package));
  const expectedEnvelopeSha = sha256DrgRelease(canonicalDrgReleaseJson(envelopeHashPayload(envelope)));
  if (!SHA256_RE.test(envelope.envelope_sha256) || envelope.envelope_sha256 !== expectedEnvelopeSha) throw new Error("release authorization envelope SHA mismatch");
  const signature = envelope.signature;
  if (!signature || signature.algorithm !== DRG_RELEASE_AUTHORIZATION_SIGNATURE_ALGORITHM || !signature.signature_base64) throw new Error("release authorization envelope signature is malformed");
  const trusted = DRG_RELEASE_AUTHORIZATION_PUBLIC_KEYS.find((entry) => entry.keyId === signature.key_id);
  if (!trusted || trusted.publicKeySpkiSha256 !== signature.public_key_spki_sha256) throw new Error("release authorization signer is not repository-pinned");
  if (process.env.NODE_ENV === "production" && trusted.environment !== "production") throw new Error("test-only release authorization signer is forbidden in production");
  const effectiveAt = Date.parse(trusted.effectiveAt);
  const retiredAt = trusted.retiredAt === null ? null : Date.parse(trusted.retiredAt);
  if (!Number.isFinite(effectiveAt) || issuedAt < effectiveAt || (retiredAt !== null && (!Number.isFinite(retiredAt) || issuedAt >= retiredAt))) throw new Error("release authorization signer was not active when the envelope was issued");
  const publicDer = createPublicKey(trusted.publicKeyPem).export({ type: "spki", format: "der" });
  if (sha256DrgRelease(publicDer) !== trusted.publicKeySpkiSha256) throw new Error("repository-pinned release authorization key hash is invalid");
  const { signature: _signature, ...withoutSignature } = envelope;
  if (!verifySignature(null, signaturePayload(withoutSignature), trusted.publicKeyPem, Buffer.from(signature.signature_base64, "base64"))) throw new Error("release authorization envelope signature verification failed");
  // Never brand caller-owned mutable memory. Otherwise a caller could verify a
  // valid envelope and mutate its evidence before passing the branded result to
  // a downstream projection.
  const immutableEnvelope = deepFreezeReleaseEnvelope(structuredClone(envelope));
  const result = Object.freeze({ [verifiedAuthorizationBrand]: true as const, envelope: immutableEnvelope });
  verifiedAuthorizationResults.add(result);
  return result;
}
