import { createPublicKey, verify } from "node:crypto";

/**
 * HighLevel's current Ed25519 webhook verification key. This is a public key,
 * not a credential. Source:
 * https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/
 */
export const GHL_WEBHOOK_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

function decodeSignature(value: string | null): Buffer | null {
  if (!value || value === "N/A" || value !== value.trim()) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 64) return null;
    const canonical = decoded.toString("base64").replace(/=+$/, "");
    return value.replace(/=+$/, "") === canonical ? decoded : null;
  } catch {
    return null;
  }
}

/** Byte-exact verifier exported separately so tests can use an ephemeral key. */
export function verifyEd25519Signature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  publicKeyPem: string,
): boolean {
  const signature = decodeSignature(signatureHeader);
  if (!signature) return false;
  try {
    return verify(null, Buffer.from(rawBody), createPublicKey(publicKeyPem), signature);
  } catch {
    return false;
  }
}

export function verifyGhlWebhookSignature(rawBody: Uint8Array, signatureHeader: string | null): boolean {
  return verifyEd25519Signature(rawBody, signatureHeader, GHL_WEBHOOK_ED25519_PUBLIC_KEY);
}
