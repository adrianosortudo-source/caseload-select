/**
 * Repository-controlled trust anchors for DRG package staging authorization.
 *
 * This registry is intentionally empty until a human-controlled DRG Law or
 * client-authorized Ed25519 key is approved through normal code review. The
 * operator CLI fails closed while empty. Runtime environment variables may
 * supply the matching public-key bytes, but may never create a new trust root.
 */

export interface DrgTrustedStagingAuthorizationSigner {
  readonly signingKeyId: string;
  readonly spkiSha256: string;
  readonly authorizerRoles: readonly ("lawyer" | "client_authorized")[];
}

export const DRG_TRUSTED_STAGING_AUTHORIZATION_SIGNERS = Object.freeze(
  [] as readonly DrgTrustedStagingAuthorizationSigner[],
);
