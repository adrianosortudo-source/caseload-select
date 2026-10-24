import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));

import { NextRequest } from "next/server";
import { POST } from "../route";
import { agencyFollowupRecipientEmailHash } from "@/lib/agency-followup-domain";

const webhookSecret = `whsec_${Buffer.from("synthetic-webhook-secret").toString("base64")}`;
const messageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const enrollmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function signedRawRequest(rawBody: string, signatureOverride?: string) {
  const id = "evt_tag_correlation";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(webhookSecret.slice(6), "base64"))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return new NextRequest("https://example.test/api/webhooks/resend/agency-followup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signatureOverride ?? `v1,${signature}`,
    },
    body: rawBody,
  });
}

function signedRequest(body: unknown, signatureOverride?: string) {
  return signedRawRequest(JSON.stringify(body), signatureOverride);
}

function emailSent(tags?: unknown) {
  return {
    type: "email.sent",
    created_at: "2026-10-24T17:00:00.000Z",
    data: {
      email_id: "re_synthetic_accepted",
      to: ["Owner@example.com"],
      ...(tags === undefined ? {} : { tags }),
    },
  };
}

describe("Resend Agency follow-up tagged webhook correlation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET = webhookSecret;
    mocks.rpc.mockResolvedValue({ data: { result: "matched" }, error: null });
  });

  it("forwards the verified canonical message/enrollment pair and exact recipient fingerprint", async () => {
    const response = await POST(signedRequest(emailSent({
      agency_followup_message_id: messageId,
      agency_followup_enrollment_id: enrollmentId,
      unrelated_provider_tag: "ignored",
    })));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("persist_agency_followup_resend_event", expect.objectContaining({
      p_agency_followup_message_id: messageId,
      p_agency_followup_enrollment_id: enrollmentId,
      p_recipient_email: "Owner@example.com",
      p_recipient_sha256: agencyFollowupRecipientEmailHash("Owner@example.com"),
    }));
  });

  it("preserves historical tagless events and passes a null pair", async () => {
    const response = await POST(signedRequest(emailSent()));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("persist_agency_followup_resend_event", expect.objectContaining({
      p_agency_followup_message_id: null,
      p_agency_followup_enrollment_id: null,
    }));
  });

  it.each([
    ["partial pair", { agency_followup_message_id: messageId }],
    ["malformed UUID", {
      agency_followup_message_id: messageId.toUpperCase(),
      agency_followup_enrollment_id: enrollmentId,
    }],
    ["non-object tags", []],
  ])("rejects %s without database persistence", async (_label, tags) => {
    const response = await POST(signedRequest(emailSent(tags)));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects duplicate known object keys in the signed raw payload", async () => {
    const rawBody = `{"type":"email.sent","created_at":"2026-10-24T17:00:00.000Z","data":{"email_id":"re_synthetic_accepted","to":["Owner@example.com"],"tags":{"agency_followup_message_id":"${messageId}","agency_followup_message_id":"${messageId}","agency_followup_enrollment_id":"${enrollmentId}"}}}`;
    const response = await POST(signedRawRequest(rawBody));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_message_tags" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects known identity tags on contact updates", async () => {
    const response = await POST(signedRequest({
      type: "contact.updated",
      created_at: "2026-10-24T17:00:00.000Z",
      data: {
        email: "owner@example.com",
        unsubscribed: true,
        tags: {
          agency_followup_message_id: messageId,
          agency_followup_enrollment_id: enrollmentId,
        },
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("verifies Svix before interpreting malformed tag content", async () => {
    const response = await POST(signedRequest(emailSent({
      agency_followup_message_id: "malformed",
      agency_followup_enrollment_id: enrollmentId,
    }), "invalid"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_signature" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
