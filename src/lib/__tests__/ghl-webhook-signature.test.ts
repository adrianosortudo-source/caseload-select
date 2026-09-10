import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyEd25519Signature } from "../ghl-webhook-signature";

describe("HighLevel Ed25519 webhook signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const body = Buffer.from('{"id":"CALL_fixture","locationId":"location"}', "utf8");
  const signature = sign(null, body, privateKey).toString("base64");

  it("verifies the byte-exact raw request body", () => {
    expect(verifyEd25519Signature(body, signature, pem)).toBe(true);
    expect(verifyEd25519Signature(Buffer.from(`${body.toString()} `), signature, pem)).toBe(false);
  });

  it.each([null, "", "N/A", "not-base64", `${signature} `, Buffer.alloc(63).toString("base64")])(
    "rejects absent, malformed or wrong-length signatures: %s",
    value => expect(verifyEd25519Signature(body, value, pem)).toBe(false),
  );
});
