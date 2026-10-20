import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));

import { NextRequest } from "next/server";
import { POST } from "../route";
import { supabaseAdmin } from "@/lib/supabase-admin";

const webhookSecret = `whsec_${Buffer.from("synthetic-webhook-secret").toString("base64")}`;

function request(body: unknown, signatureOverride?: string, rawBody = JSON.stringify(body)) {
  const id = "evt_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signingSecret = Buffer.from(webhookSecret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", signingSecret).update(`${id}.${timestamp}.${JSON.stringify(body)}`).digest("base64");
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

describe("Resend Agency follow-up webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET = webhookSecret;
    mocks.rpc.mockResolvedValue({ data: { result: "matched" }, error: null });
  });

  it("fails closed when the signing secret is missing", async () => {
    delete process.env.AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET;
    const response = await POST(request({}));
    expect(response.status).toBe(503);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures before parsing or persistence", async () => {
    const response = await POST(request({ type: "email.delivered" }, "invalid"));
    expect(response.status).toBe(400);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("uses the real Svix verifier and rejects a signed payload after body alteration", async () => {
    const original = {
      type: "email.delivered",
      created_at: "2026-10-19T12:00:00.000Z",
      data: { email_id: "re_msg_123", to: ["owner@example.com"] },
    };
    const altered = JSON.stringify({ ...original, data: { ...original.data, email_id: "re_msg_tampered" } });
    const response = await POST(request(original, undefined, altered));
    expect(response.status).toBe(400);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("hashes the exact single recipient and delegates durable dedupe to the database", async () => {
    const response = await POST(request({
      type: "email.delivered",
      created_at: "2026-10-19T12:00:00.000Z",
      data: { email_id: "re_msg_123", to: ["Owner@example.com"] },
    }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("persist_agency_followup_resend_event", expect.objectContaining({
      p_provider_event_id: "evt_123",
      p_provider_message_id: "re_msg_123",
      p_event_type: "email.delivered",
      p_recipient_email: "Owner@example.com",
      p_recipient_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("accepts only unsubscribe contact updates and sends no contact email on other statuses", async () => {
    const response = await POST(request({
      type: "contact.updated",
      created_at: "2026-10-19T12:00:00.000Z",
      data: { email: "owner@example.com", unsubscribed: true },
    }));
    expect(response.status).toBe(200);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("persist_agency_followup_resend_event", expect.objectContaining({
      p_provider_message_id: null,
      p_contact_status: "unsubscribed",
      p_recipient_email: "owner@example.com",
      p_recipient_sha256: null,
    }));
  });

  it("recognizes the contact status unsubscribe shape", async () => {
    const response = await POST(request({
      type: "contact.updated",
      created_at: "2026-10-19T12:00:00.000Z",
      data: { email: "owner@example.com", status: "unsubscribed" },
    }));
    expect(response.status).toBe(200);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("persist_agency_followup_resend_event", expect.objectContaining({
      p_contact_status: "unsubscribed",
      p_recipient_email: "owner@example.com",
    }));
  });

  it("asks Resend to retry when an event arrives before message acceptance is persisted", async () => {
    mocks.rpc.mockResolvedValue({ data: { result: "unmatched_message" }, error: null });
    const response = await POST(request({
      type: "email.delivered",
      created_at: "2026-10-19T12:00:00.000Z",
      data: { email_id: "re_msg_123", to: ["owner@example.com"] },
    }));
    expect(response.status).toBe(503);
  });

  it("rejects multi-recipient messages without persisting them", async () => {
    const response = await POST(request({
      type: "email.delivered",
      created_at: "2026-10-19T12:00:00.000Z",
      data: { email_id: "re_msg_123", to: ["one@example.com", "two@example.com"] },
    }));
    expect(response.status).toBe(400);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});
