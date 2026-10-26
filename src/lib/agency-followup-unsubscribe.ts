import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { agencyFollowupRecipientEmailHash } from "./agency-followup-domain";

export const AGENCY_FOLLOWUP_UNSUBSCRIBE_ENDPOINT =
  "https://app.caseloadselect.ca/api/agency-followup/unsubscribe";
export const AGENCY_FOLLOWUP_UNSUBSCRIBE_PLACEHOLDER = "{{agency_followup_unsubscribe_url}}";

export interface AgencyFollowupUnsubscribeIdentity {
  enrollmentId: string;
  messageId: string;
  recipientEmailSha256: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const TOKEN_PART = /^[A-Za-z0-9_-]+$/;
const MINIMUM_SECRET_BYTES = 32;

export function isAgencyFollowupUnsubscribeSecretStrong(secret: string | undefined): secret is string {
  return typeof secret === "string" && Buffer.byteLength(secret.trim(), "utf8") >= MINIMUM_SECRET_BYTES;
}

function validIdentity(value: unknown): value is AgencyFollowupUnsubscribeIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return Object.keys(identity).sort().join(",") === "enrollmentId,messageId,recipientEmailSha256" &&
    typeof identity.enrollmentId === "string" && UUID.test(identity.enrollmentId) &&
    typeof identity.messageId === "string" && UUID.test(identity.messageId) &&
    typeof identity.recipientEmailSha256 === "string" && SHA256.test(identity.recipientEmailSha256);
}

export function createAgencyFollowupUnsubscribeToken(
  identity: AgencyFollowupUnsubscribeIdentity,
  secret: string,
): string {
  if (!isAgencyFollowupUnsubscribeSecretStrong(secret) || !validIdentity(identity)) {
    throw new Error("Agency follow-up unsubscribe signing input is invalid.");
  }
  const payload = Buffer.from(JSON.stringify({
    enrollmentId: identity.enrollmentId.toLowerCase(),
    messageId: identity.messageId.toLowerCase(),
    recipientEmailSha256: identity.recipientEmailSha256,
  }), "utf8").toString("base64url");
  const signed = `v1.${payload}`;
  const signature = createHmac("sha256", secret.trim()).update(signed).digest("base64url");
  return `${signed}.${signature}`;
}

export function verifyAgencyFollowupUnsubscribeToken(
  token: string | null | undefined,
  secret: string | undefined,
): AgencyFollowupUnsubscribeIdentity | null {
  if (!token || token.length > 2048 || !isAgencyFollowupUnsubscribeSecretStrong(secret)) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !TOKEN_PART.test(parts[1]) || !TOKEN_PART.test(parts[2])) return null;

  const signed = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret.trim()).update(signed).digest();
  let actual: Buffer;
  let payloadBytes: Buffer;
  try {
    actual = Buffer.from(parts[2], "base64url");
    payloadBytes = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || actual.toString("base64url") !== parts[2]) return null;
  if (!timingSafeEqual(actual, expected)) return null;
  if (payloadBytes.toString("base64url") !== parts[1]) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return null;
  }
  if (!validIdentity(payload)) return null;
  return {
    enrollmentId: payload.enrollmentId.toLowerCase(),
    messageId: payload.messageId.toLowerCase(),
    recipientEmailSha256: payload.recipientEmailSha256,
  };
}

export function createAgencyFollowupUnsubscribeUrl(input: {
  enrollmentId: string;
  messageId: string;
  recipientEmail: string;
  secret: string;
}): string {
  const identity = {
    enrollmentId: input.enrollmentId,
    messageId: input.messageId,
    recipientEmailSha256: agencyFollowupRecipientEmailHash(input.recipientEmail),
  };
  const url = new URL(AGENCY_FOLLOWUP_UNSUBSCRIBE_ENDPOINT);
  url.searchParams.set("token", createAgencyFollowupUnsubscribeToken(identity, input.secret));
  return url.toString();
}
