/**
 * Tests for /api/messenger-intake.
 *
 * Coverage:
 *   - GET verification challenge: correct token echoes; wrong token returns 403.
 *   - POST signature verification: missing/wrong signature returns 401.
 *   - POST valid payload + matched firm: invokes processChannelInbound with
 *     the correct MessengerSender shape (channel='facebook', PSID, page ID,
 *     mid) and the channel-intake-processor's promise is handed to waitUntil.
 *   - POST valid payload but unmatched page ID: drops the event with a 200,
 *     does NOT invoke processChannelInbound.
 *   - POST invalid JSON: returns 400.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

// IMPORTANT: this constant must match across all three Meta receiver
// test files (messenger/instagram/whatsapp). Vitest runs test files in
// shared workers; each receiver route captures `process.env.META_APP_SECRET`
// at module-load time, so the LAST file that imports a route wins on this
// process.env value. Using one shared value across all three test files
// keeps every receiver route's captured APP_SECRET consistent.
const APP_SECRET = "shared_test_app_secret_for_meta_receivers";
const VERIFY_TOKEN = "test_msgr_verify_token";

// vi.hoisted runs BEFORE the route module's `import` is resolved.
// Plain `process.env.X = ...` statements run AFTER imports hoist, which is
// too late — the route's `const APP_SECRET = process.env.META_APP_SECRET`
// has already captured an empty string by then.
vi.hoisted(() => {
  process.env.META_APP_SECRET = "shared_test_app_secret_for_meta_receivers";
  process.env.META_MESSENGER_VERIFY_TOKEN = "test_msgr_verify_token";
});

// Mocks declared via vi.hoisted so the factory functions below can
// reference them directly. Plain `const x = vi.fn()` references inside
// vi.mock factories fail because vi.mock is hoisted above the const.
const mocks = vi.hoisted(() => ({
  resolveFirmByFacebookPageId: vi.fn(),
  processChannelInbound: vi.fn(),
}));

vi.mock("@/lib/firm-resolver", () => ({
  resolveFirmByFacebookPageId: mocks.resolveFirmByFacebookPageId,
}));

vi.mock("@/lib/channel-intake-processor", () => ({
  processChannelInbound: mocks.processChannelInbound,
}));

// Stub waitUntil to invoke immediately (so async side effects land in-test).
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => {
    void p.catch(() => undefined);
  },
}));

// Import the SUT after mocks.
import { GET, POST } from "../route";

// ─── Helpers ────────────────────────────────────────────────────────────

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex");
}

function makeMessengerPayload(opts: {
  pageId?: string;
  senderId?: string;
  text?: string;
  mid?: string;
}): string {
  return JSON.stringify({
    object: "page",
    entry: [
      {
        id: opts.pageId ?? "1179834051874177",
        time: 1715700000,
        messaging: [
          {
            sender: { id: opts.senderId ?? "psid_abc" },
            recipient: { id: opts.pageId ?? "1179834051874177" },
            timestamp: 1715700000,
            message: {
              mid: opts.mid ?? "mid_abc",
              text: opts.text ?? "Hi, I need help with an immigration matter.",
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
  return new Request("https://app.caseloadselect.ca/api/messenger-intake", {
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
    `https://app.caseloadselect.ca/api/messenger-intake?${qs.toString()}`,
    { method: "GET" },
  );
}

beforeEach(() => {
  mocks.resolveFirmByFacebookPageId.mockReset();
  mocks.processChannelInbound.mockReset();
  mocks.processChannelInbound.mockResolvedValue({
    persisted: true,
    leadId: "L-test",
    status: "triaging",
  });
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe("GET /api/messenger-intake", () => {
  it("echoes hub.challenge with HTTP 200 when verify_token matches", async () => {
    const res = await GET(
      makeGetRequest({
        mode: "subscribe",
        token: VERIFY_TOKEN,
        challenge: "challenge_abc_123",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("challenge_abc_123");
  });

  it("returns 403 when verify_token does not match", async () => {
    const res = await GET(
      makeGetRequest({
        mode: "subscribe",
        token: "wrong_token",
        challenge: "x",
      }) as never,
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/messenger-intake", () => {
  it("returns 401 when X-Hub-Signature-256 header is missing", async () => {
    const body = makeMessengerPayload({});
    const res = await POST(makePostRequest(body, null) as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the signature does not match", async () => {
    const body = makeMessengerPayload({});
    const res = await POST(makePostRequest(body, "sha256=deadbeef") as never);
    expect(res.status).toBe(401);
  });

  it("calls processChannelInbound with MessengerSender when firm is matched", async () => {
    mocks.resolveFirmByFacebookPageId.mockResolvedValue({
      firmId: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
      firmName: "DRG Law Test",
    });
    const body = makeMessengerPayload({
      pageId: "1179834051874177",
      senderId: "psid_xyz",
      text: "Hi, my situation is...",
      mid: "mid_xyz_42",
    });
    const res = await POST(makePostRequest(body, sign(body)) as never);
    expect(res.status).toBe(200);
    expect(mocks.resolveFirmByFacebookPageId).toHaveBeenCalledWith("1179834051874177");
    expect(mocks.processChannelInbound).toHaveBeenCalledTimes(1);
    const callArg = mocks.processChannelInbound.mock.calls[0]?.[0] as unknown as {
      firmId: string;
      text: string;
      sender: { channel: string; senderPsid: string; pageId: string; messageMid: string };
    };
    expect(callArg.firmId).toBe("eec1d25e-a047-4827-8e4a-6eb96becca2b");
    expect(callArg.text).toBe("Hi, my situation is...");
    expect(callArg.sender.channel).toBe("facebook");
    expect(callArg.sender.senderPsid).toBe("psid_xyz");
    expect(callArg.sender.pageId).toBe("1179834051874177");
    expect(callArg.sender.messageMid).toBe("mid_xyz_42");
  });

  it("drops the event with 200 when no firm is mapped to the page id", async () => {
    mocks.resolveFirmByFacebookPageId.mockResolvedValue(null);
    const body = makeMessengerPayload({ pageId: "9999999999" });
    const res = await POST(makePostRequest(body, sign(body)) as never);
    expect(res.status).toBe(200);
    expect(mocks.processChannelInbound).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON body", async () => {
    const body = "not valid json {";
    const res = await POST(makePostRequest(body, sign(body)) as never);
    expect(res.status).toBe(400);
  });
});
