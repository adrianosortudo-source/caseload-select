import "server-only";

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

import {
  DRG_RELEASE_AUTHORIZATION_PUBLIC_KEYS,
  type DrgReleaseAuthorizationSigner,
} from "@/lib/drg-release-authorization-envelope";

function normalizePem(value: string): string {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
}

/**
 * Loads the only server-side signing authority. No key is generated and no
 * approval is inferred. An unprovisioned or mismatched production process
 * fails closed before an envelope can be issued.
 */
export function loadConfiguredDrgReleaseAuthorizationSigner(
  env: NodeJS.ProcessEnv = process.env,
): DrgReleaseAuthorizationSigner {
  const keyId = env.DRG_RELEASE_AUTHORIZATION_SIGNING_KEY_ID?.trim() ?? "";
  const privateKeyPem = normalizePem(env.DRG_RELEASE_AUTHORIZATION_PRIVATE_KEY_PEM?.trim() ?? "");
  if (!keyId || !privateKeyPem) throw new Error("DRG release authorization signer is not provisioned");
  const trusted = DRG_RELEASE_AUTHORIZATION_PUBLIC_KEYS.find((entry) => entry.keyId === keyId);
  if (!trusted) throw new Error("DRG release authorization signing key is not repository-pinned");
  if (env.NODE_ENV === "production" && trusted.environment !== "production") throw new Error("test-only DRG release signer is forbidden in production");
  const privateKey = createPrivateKey(privateKeyPem);
  const publicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const publicKeySpkiSha256 = createHash("sha256").update(publicDer).digest("hex");
  if (publicKeySpkiSha256 !== trusted.publicKeySpkiSha256) throw new Error("DRG release private key does not match the repository-pinned public key");
  return Object.freeze({
    keyId,
    publicKeySpkiSha256,
    sign: (payload: Uint8Array) => sign(null, payload, privateKey).toString("base64"),
  });
}
