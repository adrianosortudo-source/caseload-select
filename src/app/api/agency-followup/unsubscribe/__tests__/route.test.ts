import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: h.rpc } }));

import { GET, POST } from "../route";
import { createAgencyFollowupUnsubscribeToken } from "@/lib/agency-followup-unsubscribe";
import { agencyFollowupRecipientEmailHash } from "@/lib/agency-followup-domain";

const secret = "synthetic-unsubscribe-signing-secret-at-least-32-bytes";
const identity = {
  enrollmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  messageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  recipientEmailSha256: agencyFollowupRecipientEmailHash("owner@example.test"),
};
const token = createAgencyFollowupUnsubscribeToken(identity, secret);
const tokenUrl = `https://app.caseloadselect.ca/api/agency-followup/unsubscribe?token=${encodeURIComponent(token)}`;

function post(body = "List-Unsubscribe=One-Click", contentType = "application/x-www-form-urlencoded") {
  return new NextRequest(tokenUrl, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

function noncanonicalSignatureAlias(value: string): string {
  const [version, payload, signature] = value.split(".");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastIndex = alphabet.indexOf(signature.at(-1)!);
  const aliasIndex = (lastIndex & ~3) | ((lastIndex + 1) & 3);
  return `${version}.${payload}.${signature.slice(0, -1)}${alphabet[aliasIndex]}`;
}

describe("Agency follow-up unsubscribe endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENCY_FOLLOWUP_UNSUBSCRIBE_SECRET = secret;
    h.rpc.mockResolvedValue({ data: [{ event_id: "event-1", replayed: false }], error: null });
  });

  it("renders a confirmation form on GET without applying an unsubscribe", async () => {
    const response = await GET(new NextRequest(tokenUrl));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(body).toContain('name="List-Unsubscribe" value="One-Click"');
    expect(body).toContain("Stop CaseLoad Select follow-up");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("records a one-click unsubscribe against the exact signed recipient and is replay-safe", async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ event_id: "event-1", replayed: false }], error: null });
    h.rpc.mockResolvedValueOnce({ data: [{ event_id: "event-1", replayed: true }], error: null });
    const response = await POST(post());
    const replay = await POST(post());
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(body).toContain("You have been unsubscribed");
    expect(body).toContain("A message that was already being sent may still arrive.");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.rpc).toHaveBeenCalledWith("record_agency_followup_recipient_unsubscribe", {
      p_message_id: identity.messageId,
      p_enrollment_id: identity.enrollmentId,
      p_recipient_email_sha256: identity.recipientEmailSha256,
      p_token_sha256: createHash("sha256").update(token, "utf8").digest("hex"),
    });
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.rpc.mock.calls[1]).toEqual(h.rpc.mock.calls[0]);
  });

  it("rejects invalid tokens, non-one-click posts, and unsupported content types before database access", async () => {
    const invalid = new NextRequest(`${tokenUrl}x`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click",
    });
    expect((await POST(invalid)).status).toBe(400);
    expect((await POST(post("List-Unsubscribe=Other"))).status).toBe(400);
    expect((await POST(post("List-Unsubscribe=One-Click", "text/plain"))).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rejects an oversized form body before accessing the database", async () => {
    expect((await POST(post(`List-Unsubscribe=One-Click&padding=${"x".repeat(2048)}`))).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rejects noncanonical token aliases before recording a second opt-out event", async () => {
    const url = new URL(tokenUrl);
    url.searchParams.set("token", noncanonicalSignatureAlias(token));
    const alias = new NextRequest(url, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click",
    });

    expect((await POST(alias)).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("does not claim success when durable opt-out storage fails", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "synthetic database failure" } });
    expect((await POST(post())).status).toBe(503);
  });
});
