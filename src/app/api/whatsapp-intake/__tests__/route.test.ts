/**
 * Tests for /api/whatsapp-intake.
 *
 * WhatsApp's payload shape differs from Messenger/Instagram — it uses
 * entry[].changes[].value.messages[] with metadata.phone_number_id as the
 * asset ID. The contacts[] block may carry a sender display name.
 *
 * Coverage:
 *   - GET verification challenge (200 + echo, 403 on mismatch).
 *   - POST 401 on missing/wrong signature.
 *   - POST happy path: resolves firm by phone_number_id, invokes processor
 *     with WhatsAppSender (channel='whatsapp', wa_id, mid, name from contacts).
 *   - POST drops when no firm matches the phone_number_id.
 *   - POST ignores non-text message types (images, voice notes, etc).
 *   - POST tolerates statuses-only payloads (no inbound messages).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

// Shared with messenger + instagram test files; see comment there.
const APP_SECRET = "shared_test_app_secret_for_meta_receivers";
const VERIFY_TOKEN = "test_wa_verify_token";
vi.hoisted(() => {
  process.env.META_APP_SECRET = "shared_test_app_secret_for_meta_receivers";
  process.env.META_WHATSAPP_VERIFY_TOKEN = "test_wa_verify_token";
});

const mocks = vi.hoisted(() => ({
  resolveFirmByWhatsappPhoneNumberId: vi.fn(),
  processChannelInbound: vi.fn(),
}));

vi.mock("@/lib/firm-resolver", () => ({
  resolveFirmByWhatsappPhoneNumberId: mocks.resolveFirmByWhatsappPhoneNumberId,
}));

vi.mock("@/lib/channel-intake-processor", () => ({
  processChannelInbound: mocks.processChannelInbound,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => {
    void p.catch(() => undefined);
  },
}));

import { GET, POST } from "../route";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex");
}

function makeWaPayload(opts: {
  phoneNumberId?: string;
  wabaId?: string;
  senderWaId?: string;
  senderName?: string;
  text?: string;
  mid?: string;
  messageType?: string;
  includeContacts?: boolean;
  statusesOnly?: boolean;
}): string {
  const phoneNumberId = opts.phoneNumberId ?? "1135653749626764";
  const wabaId = opts.wabaId ?? "1346285637647296";
  const senderWaId = opts.senderWaId ?? "16475492106";
  const senderName = opts.senderName ?? "Adriano";
  const text = opts.text ?? "Need help with immigration.";
  const mid = opts.mid ?? "wamid.abc";
  const messageType = opts.messageType ?? "text";

  if (opts.statusesOnly) {
    return JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: wabaId,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: phoneNumberId, display_phone_number: "+15556298048" },
                statuses: [
                  { id: "wamid.s1", recipient_id: senderWaId, status: "delivered", timestamp: "1715700000" },
                ],
              },
            },
          ],
        },
      ],
    });
  }

  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "+15556298048" },
              contacts: opts.includeContacts === false
                ? undefined
                : [{ wa_id: senderWaId, profile: { name: senderName } }],
              messages: [
                messageType === "text"
                  ? { from: senderWaId, id: mid, timestamp: "1715700000", type: "text", text: { body: text } }
                  : { from: senderWaId, id: mid, timestamp: "1715700000", type: messageType },
              ],
            },
          },
        ],
      },
    ],
  });
}

function makePostRequest(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature) headers["x-hub-signature-256"] = signature;
  return new Request("https://app.caseloadselect.ca/api/whatsapp-intake", {
    method: "POST",
    headers,
    body,
  });
}

function makeGetRequest(params: {
  mode?: string;
  token?: string;
  challenge?: string;
}): Request {
  const qs = new URLSearchParams();
  if (params.mode !== undefined) qs.set("hub.mode", params.mode);
  if (params.token !== undefined) qs.set("hub.verify_token", params.token);
  if (params.challenge !== undefined) qs.set("hub.challenge", params.challenge);
  return new Request(
    `https://app.caseloadselect.ca/api/whatsapp-intake?${qs.toString()}`,
    { method: "GET" },
  );
}

beforeEach(() => {
  mocks.resolveFirmByWhatsappPhoneNumberId.mockReset();
  mocks.processChannelInbound.mockReset();
  mocks.processChannelInbound.mockResolvedValue({
    persisted: true,
    leadId: "L-test",
    status: "triaging",
  });
});

describe("GET /api/whatsapp-intake", () => {
  it("echoes hub.challenge with 200 when verify_token matches", async () => {
    const res = await GET(
      makeGetRequest({
        mode: "subscribe",
        token: VERIFY_TOKEN,
        challenge: "chal_wa_999",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("chal_wa_999");
  });

  it("returns 403 on token mismatch", async () => {
    const res = await GET(
      makeGetRequest({ mode: "subscribe", token: "wrong", challenge: "x" }) as never,
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/whatsapp-intake", () => {
  it("returns 401 on missing signature", async () => {
    const body = makeWaPayload({});
    const res = await POST(makePostRequest(body, null) as never);
    expect(res.status).toBe(401);
  });

  it("calls processChannelInbound with WhatsAppSender for a text message", async () => {
    mocks.resolveFirmByWhatsappPhoneNumberId.mockResolvedValue({
      firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
      firmName: "DRG Law Test",
    });
    const body = makeWaPayload({
      phoneNumberId: "1135653749626764",
      senderWaId: "16475492106",
      senderName: "Adriano",
      text: "Need help with a family law matter",
      mid: "wamid.xyz",
    });
    const res = await POST(makePostRequest(body, sign(body)) as never);
    expect(res.status).toBe(200);
    expect(mocks.resolveFirmByWhatsappPhoneNumberId).toHaveBeenCalledWith(
      "1135653749626764",
    );
    expect(mocks.processChannelInbound).toHaveBeenCalledTimes(1);
    const callArg = mocks.processChannelInbound.mock.calls[0]?.[0] as unknown as {
      firmId: string;
      text: string;
      sender: {
        channel: string;
        senderWaId: string;
        senderName: string | null;
        phoneNumberId: string;
        messageMid: string;
      };
    };
    expect(callArg.firmId).toBe("eec1d25e-a047-4827-8e4a-6eb96becca2b");
    expect(callArg.sender.channel).toBe("whatsapp");
    expect(callArg.sender.senderWaId).toBe("16475492106");
    expect(callArg.sender.senderName).toBe("Adriano");
    expect(callArg.sender.phoneNumberId).toBe("1135653749626764");
    expect(callArg.sender.messageMid).toBe("wamid.xyz");
  });

  it("drops the event with 200 when no firm matches the phone_number_id", async () => {
    mocks.resolveFirmByWhatsappPhoneNumberId.mockResolvedValue(null);
    const body = makeWaPayload({ phoneNumberId: "9999999999" });
    const res = await POST(makePostRequest(body, sign(body)) as never);
    expect(res.status).toBe(200);
    expect(mocks.processChannelInbound).not.toHaveBeenCalled();
  });

  it("ignores non-text message types (image, audio, etc.) and ACKs 200", async () => {
    mocks.resolveFirmByWhatsappPhoneNumberId.mockResolvedValue({
      firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
      firmName: "DRG Law Test",
    });
    const body = makeWaPayload({ messageType: "image" });
    const res = await POST(makePostRequest(body, sign(body)) as never);
    expect(res.status).toBe(200);
    // Non-text inbound: the receiver logs but does not invoke the processor
    // for image/audio/document/etc. payloads.
    expect(mocks.processChannelInbound).not.toHaveBeenCalled();
  });

  it("tolerates statuses-only payloads (delivery receipts) without calling the processor", async () => {
    mocks.resolveFirmByWhatsappPhoneNumberId.mockResolvedValue({
      firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
      firmName: "DRG Law Test",
    });
    const body = makeWaPayload({ statusesOnly: true });
    const res = await POST(makePostRequest(body, sign(body)) as never);
    expect(res.status).toBe(200);
    expect(mocks.processChannelInbound).not.toHaveBeenCalled();
  });
});
