/**
 * Tests for /api/instagram-intake.
 *
 * Coverage mirrors the messenger-intake test, with two IG-specific deltas:
 *   - Payload shape uses entry[].messaging[] (the most common IG Business
 *     webhook subscription shape).
 *   - The IG asset ID is entry[].id (the IG Business Account ID), routed
 *     to resolveFirmByInstagramBusinessAccountId.
 *   - Sender shape uses senderIgsid (not senderPsid).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

// Shared with messenger + whatsapp test files; see comment there.
const APP_SECRET = "shared_test_app_secret_for_meta_receivers";
const VERIFY_TOKEN = "test_ig_verify_token";
vi.hoisted(() => {
  process.env.META_APP_SECRET = "shared_test_app_secret_for_meta_receivers";
  process.env.META_INSTAGRAM_VERIFY_TOKEN = "test_ig_verify_token";
});

const mocks = vi.hoisted(() => ({
  resolveFirmByInstagramBusinessAccountId: vi.fn(),
  processChannelInbound: vi.fn(),
}));

vi.mock("@/lib/firm-resolver", () => ({
  resolveFirmByInstagramBusinessAccountId: mocks.resolveFirmByInstagramBusinessAccountId,
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

function makeIgPayload(opts: {
  igUserId?: string;
  senderId?: string;
  text?: string;
  mid?: string;
}): string {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: opts.igUserId ?? "17841400000123",
        time: 1715700000,
        messaging: [
          {
            sender: { id: opts.senderId ?? "igsid_abc" },
            recipient: { id: opts.igUserId ?? "17841400000123" },
            timestamp: 1715700000,
            message: {
              mid: opts.mid ?? "mid_ig_abc",
              text: opts.text ?? "Quick question about employment law",
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
  return new Request("https://app.caseloadselect.ca/api/instagram-intake", {
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
    `https://app.caseloadselect.ca/api/instagram-intake?${qs.toString()}`,
    { method: "GET" },
  );
}

beforeEach(() => {
  mocks.resolveFirmByInstagramBusinessAccountId.mockReset();
  mocks.processChannelInbound.mockReset();
  mocks.processChannelInbound.mockResolvedValue({
    persisted: true,
    leadId: "L-test",
    status: "triaging",
  });
});

describe("GET /api/instagram-intake", () => {
  it("echoes hub.challenge with 200 when verify_token matches", async () => {
    const res = await GET(
      makeGetRequest({
        mode: "subscribe",
        token: VERIFY_TOKEN,
        challenge: "chal_ig_777",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("chal_ig_777");
  });

  it("returns 403 on token mismatch", async () => {
    const res = await GET(
      makeGetRequest({ mode: "subscribe", token: "wrong", challenge: "x" }) as never,
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/instagram-intake", () => {
  it("returns 401 on missing signature", async () => {
    const body = makeIgPayload({});
    const res = await POST(makePostRequest(body, null) as never);
    expect(res.status).toBe(401);
  });

  it("calls processChannelInbound with InstagramSender when firm is matched", async () => {
    mocks.resolveFirmByInstagramBusinessAccountId.mockResolvedValue({
      firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
      firmName: "DRG Law Test",
    });
    const body = makeIgPayload({
      igUserId: "17841400000123",
      senderId: "igsid_xyz",
      text: "Need help with a workplace harassment case",
      mid: "mid_ig_xyz",
    });
    const res = await POST(makePostRequest(body, sign(body)) as never);
    expect(res.status).toBe(200);
    expect(mocks.resolveFirmByInstagramBusinessAccountId).toHaveBeenCalledWith(
      "17841400000123",
    );
    expect(mocks.processChannelInbound).toHaveBeenCalledTimes(1);
    const callArg = mocks.processChannelInbound.mock.calls[0]?.[0] as unknown as {
      firmId: string;
      text: string;
      sender: { channel: string; senderIgsid: string; igBusinessAccountId: string };
    };
    expect(callArg.firmId).toBe("eec1d25e-a047-4827-8e4a-6eb96becca2b");
    expect(callArg.sender.channel).toBe("instagram");
    expect(callArg.sender.senderIgsid).toBe("igsid_xyz");
    expect(callArg.sender.igBusinessAccountId).toBe("17841400000123");
  });

  it("drops the event with 200 when no firm matches the IG account", async () => {
    mocks.resolveFirmByInstagramBusinessAccountId.mockResolvedValue(null);
    const body = makeIgPayload({ igUserId: "11111111111" });
    const res = await POST(makePostRequest(body, sign(body)) as never);
    expect(res.status).toBe(200);
    expect(mocks.processChannelInbound).not.toHaveBeenCalled();
  });
});
