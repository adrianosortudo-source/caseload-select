import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));

import { NextRequest } from "next/server";
import { POST } from "../route";
import { agencyFollowupRecipientEmailHash } from "@/lib/agency-followup-domain";
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
      p_recipient_sha256: agencyFollowupRecipientEmailHash("Owner@example.com"),
    }));
  });

  it("persists signed provider suppression events with the exact recipient fingerprint", async () => {
    const response = await POST(request({
      type: "email.suppressed",
      created_at: "2026-10-24T05:00:00.000Z",
      data: { email_id: "re_msg_suppressed", to: ["Owner@example.com"] },
    }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("persist_agency_followup_resend_event", expect.objectContaining({
      p_provider_message_id: "re_msg_suppressed",
      p_event_type: "email.suppressed",
      p_contact_status: null,
      p_recipient_email: "Owner@example.com",
      p_recipient_sha256: agencyFollowupRecipientEmailHash("Owner@example.com"),
    }));
  });

  it("accepts only unsubscribe contact updates and sends no contact email on other statuses", async () => {
    const response = await POST(request({
      type: "contact.updated",
      created_at: "2026-10-19T12:00:00.000Z",
      data: { email: "owner@example.com", unsubscribed: true },
    }));
    expect(response.status).toBe(200);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("persist_agency_followup_resend_contact_event", expect.objectContaining({
      p_provider_event_id: "evt_123",
      p_occurred_at: "2026-10-19T12:00:00.000Z",
      p_recipient_email: "owner@example.com",
      p_recipient_sha256: agencyFollowupRecipientEmailHash("owner@example.com"),
    }));
  });

  it("recognizes the contact status unsubscribe shape", async () => {
    const response = await POST(request({
      type: "contact.updated",
      created_at: "2026-10-19T12:00:00.000Z",
      data: { email: "owner@example.com", status: "unsubscribed" },
    }));
    expect(response.status).toBe(200);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("persist_agency_followup_resend_contact_event", expect.objectContaining({
      p_provider_event_id: "evt_123",
      p_occurred_at: "2026-10-19T12:00:00.000Z",
      p_recipient_email: "owner@example.com",
      p_recipient_sha256: agencyFollowupRecipientEmailHash("owner@example.com"),
    }));
  });

  it("asks Resend to retry when an event arrives before message acceptance is persisted", async () => {
    mocks.rpc.mockResolvedValue({ data: { result: "unmatched_message" }, error: null });
    const response = await POST(request({
      type: "email.delivered",
      created_at: "2026-10-19T12:00:00.000Z",
      data: {
        email_id: "re_msg_123",
        to: ["owner@example.com"],
        tags: {
          agency_followup_message_id: "11111111-1111-1111-1111-111111111111",
          agency_followup_enrollment_id: "22222222-2222-2222-2222-222222222222",
        },
      },
    }));
    expect(response.status).toBe(503);
  });

  it("acknowledges unmatched shared Resend events without Agency identity tags", async () => {
    mocks.rpc.mockResolvedValue({ data: { result: "unmatched_message" }, error: null });
    const response = await POST(request({
      type: "email.delivered",
      created_at: "2026-10-19T12:00:00.000Z",
      data: { email_id: "re_transactional_123", to: ["owner@example.com"] },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: "unmatched_message" });
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

  it("rejects oversized streamed bodies without a Content-Length header", async () => {
    let cancelled = false;
    const response = await POST(new NextRequest("https://example.test/api/webhooks/resend/agency-followup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel() { cancelled = true; },
      }),
      duplex: "half",
    }));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});
