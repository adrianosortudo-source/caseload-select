import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelConversationMessage } from "@/lib/channel-conversation";

vi.mock("server-only", () => ({}));

const FIRM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_FIRM_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "L-2026-09-01-META";
const SCREENED_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const LAWYER_ID = "55555555-5555-4555-8555-555555555555";
const OPERATOR_ID = "66666666-6666-4666-8666-666666666666";

type Session = {
  firm_id: string;
  role: "lawyer" | "operator" | "client";
  lawyer_id?: string;
} | null;

const openWindow = {
  isOpen: true,
  lastInboundAt: "2026-09-01T12:00:00.000Z",
  closesAt: "2026-09-02T12:00:00.000Z",
  reason: "open" as const,
};

const sentMessage: ChannelConversationMessage = {
  id: "event-sent",
  channel: "facebook" as const,
  direction: "outbound" as const,
  source: "operator" as const,
  body: "Thanks for reaching out.",
  status: "sent" as const,
  metaMessageId: "mid.sent",
  clientRequestId: REQUEST_ID,
  actorType: "lawyer" as const,
  actorId: LAWYER_ID,
  occurredAt: "2026-09-01T13:00:00.000Z",
  failureReason: null,
};

const state = {
  session: null as Session,
  previewResponse: null as Response | null,
  lead: null as null | {
    id: string;
    lead_id: string;
    firm_id: string;
    slot_answers: unknown;
  },
  leadError: null as { message: string } | null,
  conversations: [] as Array<{
    messages: ChannelConversationMessage[];
    replyWindow: {
      isOpen: boolean;
      lastInboundAt: string | null;
      closesAt: string | null;
      reason: "open" | "expired" | "no_authoritative_inbound";
    };
  } | null>,
  conversationCalls: 0,
  conversationError: null as Error | null,
  sendResult: { sent: true, messageId: "mid.sent" } as {
    sent: boolean;
    messageId?: string;
    reason?: string;
    deliveryUnknown?: boolean;
    code?:
      | "validation_failed"
      | "lead_not_found"
      | "reply_window_closed"
      | "duplicate_request"
      | "delivery_unknown"
      | "request_in_progress"
      | "ledger_unavailable";
  },
  sendCalls: [] as unknown[],
  dbReads: 0,
};

vi.mock("@/lib/portal-auth", () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

vi.mock("@/lib/preview-guard", () => ({
  denyWriteIfPreview: () => Promise.resolve(state.previewResponse),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => {
        const chain = {
          eq: () => chain,
          maybeSingle: () => {
            state.dbReads += 1;
            return Promise.resolve({ data: state.lead, error: state.leadError });
          },
        };
        return chain;
      },
    }),
  },
}));

vi.mock("@/lib/channel-conversation", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/channel-conversation")>();
  return {
    ...original,
    loadChannelConversation: () => {
      const index = state.conversationCalls++;
      if (state.conversationError) return Promise.reject(state.conversationError);
      return Promise.resolve(state.conversations[index] ?? state.conversations.at(-1) ?? null);
    },
  };
});

vi.mock("@/lib/channel-send", () => ({
  sendChannelMessage: (args: unknown) => {
    state.sendCalls.push(args);
    return Promise.resolve(state.sendResult);
  },
}));

import { POST } from "../route";

function messengerLead(firmId = FIRM_ID) {
  return {
    id: SCREENED_ID,
    lead_id: LEAD_ID,
    firm_id: firmId,
    slot_answers: {
      channel: "facebook",
      messenger_meta: {
        page_id: "page-from-db",
        sender_psid: "psid-from-db",
        sender_name: "Lead Name",
        message_mid: "mid.inbound",
      },
    },
  };
}

function openConversations(message = sentMessage) {
  state.conversations = [
    { messages: [], replyWindow: openWindow },
    { messages: [message], replyWindow: openWindow },
  ];
}

function request(
  body: unknown = {
    body: "  Thanks for reaching out.  ",
    client_request_id: REQUEST_ID,
  },
) {
  return new Request(
    `https://app.caseloadselect.ca/api/portal/${FIRM_ID}/triage/${LEAD_ID}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function params() {
  return { params: Promise.resolve({ firmId: FIRM_ID, leadId: LEAD_ID }) };
}

beforeEach(() => {
  state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: LAWYER_ID };
  state.previewResponse = null;
  state.lead = messengerLead();
  state.leadError = null;
  state.conversationCalls = 0;
  state.conversationError = null;
  state.sendResult = { sent: true, messageId: "mid.sent" };
  state.sendCalls = [];
  state.dbReads = 0;
  openConversations();
});

describe("POST /api/portal/[firmId]/triage/[leadId]/reply", () => {
  it("returns 401 without a session", async () => {
    state.session = null;
    const response = await POST(request() as never, params());
    expect(response.status).toBe(401);
    expect(state.dbReads).toBe(0);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("returns 403 for clients and mismatched-firm lawyers", async () => {
    state.session = { firm_id: FIRM_ID, role: "client" };
    let response = await POST(request() as never, params());
    expect(response.status).toBe(403);

    state.session = { firm_id: OTHER_FIRM_ID, role: "lawyer", lawyer_id: "lawyer-2" };
    response = await POST(request() as never, params());
    expect(response.status).toBe(403);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("requires a stable member UUID instead of recording a role placeholder", async () => {
    state.session = { firm_id: FIRM_ID, role: "lawyer" };
    let response = await POST(request() as never, params());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "reauth_required" });

    state.session = { firm_id: FIRM_ID, role: "lawyer", lawyer_id: "lawyer" };
    response = await POST(request() as never, params());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "reauth_required" });
    expect(state.dbReads).toBe(0);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("allows an operator across firms and records the operator identity", async () => {
    state.session = { firm_id: OTHER_FIRM_ID, role: "operator", lawyer_id: OPERATOR_ID };
    const response = await POST(request() as never, params());
    expect(response.status).toBe(200);
    expect(state.sendCalls).toHaveLength(1);
    expect(state.sendCalls[0]).toMatchObject({
      ledger: {
        actorType: "operator",
        actorId: OPERATOR_ID,
        source: "operator",
        requireOpenWindow: true,
      },
    });
  });

  it("applies the preview write guard before reading the lead", async () => {
    state.previewResponse = Response.json(
      { error: "Support preview is read-only", code: "support_preview_read_only" },
      { status: 403 },
    );
    const response = await POST(request() as never, params());
    expect(response.status).toBe(403);
    expect(state.dbReads).toBe(0);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("returns 404 for missing and cross-firm leads without leaking existence", async () => {
    state.lead = null;
    let response = await POST(request() as never, params());
    expect(response.status).toBe(404);

    state.lead = messengerLead(OTHER_FIRM_ID);
    response = await POST(request() as never, params());
    expect(response.status).toBe(404);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("validates the body and client_request_id before sending", async () => {
    let response = await POST(
      request({ body: "   ", client_request_id: REQUEST_ID }) as never,
      params(),
    );
    expect(response.status).toBe(400);

    response = await POST(
      request({ body: "Hello", client_request_id: "not-a-uuid" }) as never,
      params(),
    );
    expect(response.status).toBe(400);

    response = await POST(
      request({ body: "x".repeat(2001), client_request_id: REQUEST_ID }) as never,
      params(),
    );
    expect(response.status).toBe(400);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("rejects client-supplied routing data instead of accepting destinations or timestamps", async () => {
    const response = await POST(
      request({
        body: "  Thanks for reaching out.  ",
        client_request_id: REQUEST_ID,
        channel: "instagram",
        pageId: "attacker-page",
        recipient: "attacker-recipient",
        lastInboundAt: "2099-01-01T00:00:00.000Z",
      }) as never,
      params(),
    );
    expect(response.status).toBe(400);
    expect(state.dbReads).toBe(0);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("derives destination fields from the lead for the strict two-field request", async () => {
    const response = await POST(request() as never, params());
    expect(response.status).toBe(200);
    expect(state.sendCalls[0]).toMatchObject({
      firmId: FIRM_ID,
      text: "Thanks for reaching out.",
      sender: {
        channel: "facebook",
        pageId: "page-from-db",
        senderPsid: "psid-from-db",
      },
      ledger: {
        screenedLeadId: SCREENED_ID,
        clientRequestId: REQUEST_ID,
        actorType: "lawyer",
        actorId: LAWYER_ID,
      },
    });
    const body = await response.json();
    expect(body.message.id).toBe("event-sent");
    expect(body.replyWindow).toEqual(openWindow);
  });

  it("returns 422 when server-side channel metadata is unsupported or incomplete", async () => {
    state.lead = {
      ...messengerLead(),
      slot_answers: { channel: "email", recipient: "client@example.com" },
    };
    const response = await POST(request() as never, params());
    expect(response.status).toBe(422);
    expect(state.sendCalls).toHaveLength(0);
  });

  it("fails closed with the authoritative reply window and returns it", async () => {
    const closedWindow = {
      isOpen: false,
      lastInboundAt: "2026-08-31T12:00:00.000Z",
      closesAt: "2026-09-01T12:00:00.000Z",
      reason: "expired" as const,
    };
    state.conversations = [{ messages: [], replyWindow: closedWindow }];
    const response = await POST(request() as never, params());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ replyWindow: closedWindow });
    expect(state.sendCalls).toHaveLength(0);
  });

  it("returns 503 without sending when the conversation ledger cannot be loaded", async () => {
    state.conversationError = new Error("relation channel_conversation_events does not exist");

    const response = await POST(request() as never, params());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Conversation history is unavailable",
      code: "ledger_unavailable",
    });
    expect(state.sendCalls).toHaveLength(0);
  });

  it("returns the existing sent event for a duplicate without requiring another result shape", async () => {
    state.sendResult = {
      sent: true,
      messageId: "mid.sent",
      reason: "request already completed",
      code: "duplicate_request",
    };
    const response = await POST(request() as never, params());
    expect(response.status).toBe(200);
    expect((await response.json()).message).toMatchObject({
      clientRequestId: REQUEST_ID,
      status: "sent",
    });
  });

  it("returns an existing sent event even when the reply window has since closed", async () => {
    const closedWindow = {
      isOpen: false,
      lastInboundAt: "2026-08-31T12:00:00.000Z",
      closesAt: "2026-09-01T12:00:00.000Z",
      reason: "expired" as const,
    };
    state.conversations = [{ messages: [sentMessage], replyWindow: closedWindow }];

    const response = await POST(request() as never, params());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: { id: "event-sent", status: "sent" },
      replyWindow: closedWindow,
    });
    expect(state.sendCalls).toHaveLength(0);
  });

  it.each(["delivery_unknown", "request_in_progress"] as const)(
    "returns a non-terminal %s result without inventing a message",
    async (code) => {
      state.sendResult = {
        sent: false,
        deliveryUnknown: true,
        reason: "request is awaiting delivery reconciliation",
        code,
      };
      state.conversations = [
        { messages: [], replyWindow: openWindow },
        { messages: [], replyWindow: openWindow },
      ];

      const response = await POST(request() as never, params());

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code,
        deliveryUnknown: true,
        replyWindow: openWindow,
      });
      expect(state.sendCalls).toHaveLength(1);
    },
  );

  it("returns 502 with the failed ledger event after a Graph failure", async () => {
    const failedMessage = {
      ...sentMessage,
      id: "event-failed",
      status: "failed" as const,
      metaMessageId: null,
      failureReason: "Graph API rejected the message",
    };
    state.sendResult = { sent: false, reason: "Graph API rejected the message" };
    openConversations(failedMessage);
    const response = await POST(request() as never, params());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "Graph API rejected the message",
      message: { id: "event-failed", status: "failed" },
      replyWindow: openWindow,
    });
  });
});
