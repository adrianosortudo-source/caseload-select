import { describe, expect, it, vi } from "vitest";
import { agencyFollowupRecipientEmailHash } from "../agency-followup-domain";
import {
  AGENCY_FOLLOWUP_UNSUBSCRIBE_ENDPOINT,
  AGENCY_FOLLOWUP_UNSUBSCRIBE_PLACEHOLDER,
  createAgencyFollowupUnsubscribeToken,
  createAgencyFollowupUnsubscribeUrl,
  isAgencyFollowupUnsubscribeSecretStrong,
  verifyAgencyFollowupUnsubscribeToken,
} from "../agency-followup-unsubscribe";

vi.mock("server-only", () => ({}));

const secret = "synthetic-unsubscribe-signing-secret-at-least-32-bytes";
const identity = {
  enrollmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  messageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  recipientEmailSha256: agencyFollowupRecipientEmailHash("owner@example.test"),
};

describe("Agency follow-up recipient unsubscribe tokens", () => {
  it("signs an exact recipient/message/enrollment identity without exposing the address", () => {
    const token = createAgencyFollowupUnsubscribeToken(identity, secret);
    expect(verifyAgencyFollowupUnsubscribeToken(token, secret)).toEqual(identity);
    expect(token).not.toContain("owner@example.test");
    expect(verifyAgencyFollowupUnsubscribeToken(`${token}x`, secret)).toBeNull();
    expect(verifyAgencyFollowupUnsubscribeToken(token, "wrong-secret-with-at-least-32-bytes")).toBeNull();
  });

  it("rejects a noncanonical Base64URL signature alias", () => {
    const token = createAgencyFollowupUnsubscribeToken(identity, secret);
    const [version, payload, signature] = token.split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const lastIndex = alphabet.indexOf(signature.at(-1)!);
    const aliasIndex = (lastIndex & ~3) | ((lastIndex + 1) & 3);
    const aliasSignature = `${signature.slice(0, -1)}${alphabet[aliasIndex]}`;
    const aliasToken = `${version}.${payload}.${aliasSignature}`;

    expect(Buffer.from(aliasSignature, "base64url")).toEqual(Buffer.from(signature, "base64url"));
    expect(verifyAgencyFollowupUnsubscribeToken(aliasToken, secret)).toBeNull();
  });

  it("requires a strong signing secret and emits a fixed production endpoint", () => {
    expect(isAgencyFollowupUnsubscribeSecretStrong("short")).toBe(false);
    expect(isAgencyFollowupUnsubscribeSecretStrong(secret)).toBe(true);
    const url = new URL(createAgencyFollowupUnsubscribeUrl({
      enrollmentId: identity.enrollmentId,
      messageId: identity.messageId,
      recipientEmail: "owner@example.test",
      secret,
    }));
    expect(url.origin + url.pathname).toBe(AGENCY_FOLLOWUP_UNSUBSCRIBE_ENDPOINT);
    expect(url.searchParams.get("token")).toBeTruthy();
    expect(AGENCY_FOLLOWUP_UNSUBSCRIBE_PLACEHOLDER).toBe("{{agency_followup_unsubscribe_url}}");
  });

  it("rejects malformed identities before signing", () => {
    expect(() => createAgencyFollowupUnsubscribeToken({ ...identity, messageId: "not-a-uuid" }, secret)).toThrow();
  });
});
