import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as null | { lawyer_id: string | null } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => mocks.session }));

import { GET } from "../route";

const target = {
  enrollmentId: "10000000-0000-4000-8000-000000000001",
  messageId: "10000000-0000-4000-8000-000000000002",
  recipientEmail: "owner@example.test",
};
const secretValues = ["synthetic-provider-key", "synthetic-webhook-secret", "synthetic-unsubscribe-secret-with-32-bytes"];

beforeEach(() => {
  mocks.session = { lawyer_id: "operator" };
  vi.stubEnv("AGENCY_FOLLOWUP_SEND_MODE", "off");
  vi.stubEnv("AGENCY_FOLLOWUP_FROM", "CaseLoad Select <noreply@caseloadselect.ca>");
  vi.stubEnv("AGENCY_FOLLOWUP_REPLY_TO", target.recipientEmail);
  vi.stubEnv("RESEND_API_KEY", secretValues[0]);
  vi.stubEnv("AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET", secretValues[1]);
  vi.stubEnv("AGENCY_FOLLOWUP_UNSUBSCRIBE_SECRET", secretValues[2]);
  vi.stubEnv("AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST", target.recipientEmail);
  vi.stubEnv("AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST", JSON.stringify([target]));
});

afterEach(() => vi.unstubAllEnvs());

describe("operator follow-up test readiness", () => {
  it("rejects missing sessions and sessions without an operator identity", async () => {
    mocks.session = null;
    expect((await GET()).status).toBe(401);
    mocks.session = { lawyer_id: null };
    expect((await GET()).status).toBe(403);
  });

  it("reports the exact runtime restriction while leaving real sending off and never exposing credentials", async () => {
    // Reply-to must be in the verified sender domain to pass the existing rules.
    vi.stubEnv("AGENCY_FOLLOWUP_REPLY_TO", "owner@caseloadselect.ca");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.actualMode).toBe("off");
    expect(body.simulatedTestConfigurationReady).toBe(true);
    expect(body.singleRecipientAndRecord).toBe(true);
    expect(body.testTarget).toEqual(target);
    expect(body.maxBatchSize).toBe(1);
    expect(body.replyToMatchesTestRecipient).toBe(false);
    expect(body.providerAuthorizationVerified).toBe(false);
    expect(process.env.AGENCY_FOLLOWUP_SEND_MODE).toBe("off");
    for (const secret of secretValues) expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("requires exactly one well-formed record and one matching recipient", async () => {
    vi.stubEnv("AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST", JSON.stringify([target, { ...target, messageId: "other" }]));
    let body = await (await GET()).json();
    expect(body.singleRecipientAndRecord).toBe(false);
    expect(body.testTarget).toBeNull();

    vi.stubEnv("AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST", "not-json");
    body = await (await GET()).json();
    expect(body.singleRecipientAndRecord).toBe(false);
    expect(body.simulatedTestConfigurationReady).toBe(false);

    vi.stubEnv("AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST", JSON.stringify([target]));
    vi.stubEnv("AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST", "other@example.test");
    body = await (await GET()).json();
    expect(body.singleRecipientAndRecord).toBe(false);
    expect(body.testTarget).toBeNull();
  });

  it("reports a reply-to match without exposing its configured value", async () => {
    const owner = { ...target, recipientEmail: "owner@caseloadselect.ca" };
    vi.stubEnv("AGENCY_FOLLOWUP_REPLY_TO", owner.recipientEmail);
    vi.stubEnv("AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST", owner.recipientEmail);
    vi.stubEnv("AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST", JSON.stringify([owner]));
    const body = await (await GET()).json();
    expect(body.replyToMatchesTestRecipient).toBe(true);
    expect(body.providerAuthorizationVerified).toBe(false);
  });
});
