import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateEmailResponse, ErrorResponse } from "resend";
import {
  createAgencyFollowupResendProvider,
  type AgencyFollowupResendSend,
} from "../agency-followup-resend-provider";
import {
  AGENCY_FOLLOWUP_UNSUBSCRIBE_ENDPOINT,
  AGENCY_FOLLOWUP_UNSUBSCRIBE_PLACEHOLDER,
  verifyAgencyFollowupUnsubscribeToken,
} from "../agency-followup-unsubscribe";
import { agencyFollowupRecipientEmailHash } from "../agency-followup-domain";

const env = {
  AGENCY_FOLLOWUP_SEND_MODE: "test",
  AGENCY_FOLLOWUP_FROM: "CaseLoad Select <noreply@caseloadselect.ca>",
  AGENCY_FOLLOWUP_REPLY_TO: "support@caseloadselect.ca",
  RESEND_API_KEY: "synthetic-api-key-never-used-for-network",
  AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET: "whsec_synthetic-never-used-for-network",
  AGENCY_FOLLOWUP_UNSUBSCRIBE_SECRET: "synthetic-unsubscribe-secret-with-at-least-32-bytes",
  AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST: "owner@example.test",
  AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST: JSON.stringify([
    { enrollmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", messageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", recipientEmail: "owner@example.test" },
  ]),
};

function accepted(id = "re_synthetic_message_01"): CreateEmailResponse {
  return { data: { id }, error: null };
}

function rejected(name: ErrorResponse["name"]): CreateEmailResponse {
  return { data: null, error: { name, message: "Synthetic provider response." } };
}

const request = {
  idempotencyKey: "agency-followup:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  recipientEmail: "owner@example.test",
  subject: "Exact approved subject",
  body: `Exact approved plain text body.\nSecond line.\n\nTo stop these messages, unsubscribe: ${AGENCY_FOLLOWUP_UNSUBSCRIBE_PLACEHOLDER}`,
};

describe("Agency follow-up Resend provider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends only the exact approved recipient/content with monitored routing and the stable idempotency key", async () => {
    const sendEmail = vi.fn<AgencyFollowupResendSend>().mockResolvedValue(accepted());
    const provider = createAgencyFollowupResendProvider({
      env,
      sendEmail,
      now: () => new Date("2026-10-19T15:30:00.000Z"),
    });

    await expect(provider.send(request)).resolves.toEqual({
      kind: "accepted",
      providerMessageId: "re_synthetic_message_01",
      acceptedAt: "2026-10-19T15:30:00.000Z",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith({
      from: "CaseLoad Select <noreply@caseloadselect.ca>",
      replyTo: "support@caseloadselect.ca",
      to: "owner@example.test",
      subject: "Exact approved subject",
      text: expect.stringContaining("Exact approved plain text body.\nSecond line.\n\nTo stop these messages, unsubscribe: https://app.caseloadselect.ca/api/agency-followup/unsubscribe?token=v1."),
      headers: {
        "List-Unsubscribe": expect.stringMatching(/^<https:\/\/app\.caseloadselect\.ca\/api\/agency-followup\/unsubscribe\?token=v1\./),
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [
        { name: "agency_followup_message_id", value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        { name: "agency_followup_enrollment_id", value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      ],
    }, { idempotencyKey: request.idempotencyKey });
    const payload = sendEmail.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    const link = payload?.text?.match(/https:\/\/app\.caseloadselect\.ca\/api\/agency-followup\/unsubscribe\?token=([^\s]+)/)?.[0];
    expect(link).toBeDefined();
    const unsubscribeUrl = new URL(link!);
    expect(unsubscribeUrl.origin + unsubscribeUrl.pathname).toBe(AGENCY_FOLLOWUP_UNSUBSCRIBE_ENDPOINT);
    expect(verifyAgencyFollowupUnsubscribeToken(unsubscribeUrl.searchParams.get("token"), env.AGENCY_FOLLOWUP_UNSUBSCRIBE_SECRET)).toEqual({
      enrollmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      messageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      recipientEmailSha256: agencyFollowupRecipientEmailHash(request.recipientEmail),
    });
    expect(link).not.toContain(request.recipientEmail);
  });

  it("blocks content without exactly one approved unsubscribe placeholder", async () => {
    const sendEmail = vi.fn<AgencyFollowupResendSend>().mockResolvedValue(accepted());
    const provider = createAgencyFollowupResendProvider({ env, sendEmail });
    await expect(provider.send({ ...request, body: "No unsubscribe link." })).resolves.toEqual({
      kind: "blocked",
      blockers: ["unsubscribe_placeholder_missing_or_repeated"],
    });
    await expect(provider.send({ ...request, body: `${request.body}\n${AGENCY_FOLLOWUP_UNSUBSCRIBE_PLACEHOLDER}` })).resolves.toEqual({
      kind: "blocked",
      blockers: ["unsubscribe_placeholder_missing_or_repeated"],
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns a typed blocked result without handoff when mode is off, config is missing, or record/recipient mismatches", async () => {
    const sendEmail = vi.fn<AgencyFollowupResendSend>().mockResolvedValue(accepted());
    const off = createAgencyFollowupResendProvider({ env: { ...env, AGENCY_FOLLOWUP_SEND_MODE: "off" }, sendEmail });
    await expect(off.send(request)).resolves.toEqual({ kind: "blocked", blockers: ["send_mode_off"] });

    const missingConfig = createAgencyFollowupResendProvider({ env: { ...env, AGENCY_FOLLOWUP_REPLY_TO: "" }, sendEmail });
    await expect(missingConfig.send(request)).resolves.toEqual({ kind: "blocked", blockers: ["followup_reply_to_missing_or_unverified"] });

    const mismatchedRecipient = createAgencyFollowupResendProvider({ env, sendEmail });
    await expect(mismatchedRecipient.send({ ...request, recipientEmail: "different@example.test" })).resolves.toEqual({
      kind: "blocked",
      blockers: ["test_recipient_not_allowlisted", "test_enrollment_message_recipient_not_allowlisted"],
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["rate_limit_exceeded", "definitive_retryable_failure"],
    ["concurrent_idempotent_requests", "definitive_retryable_failure"],
    ["invalid_idempotency_key", "definitive_permanent_failure"],
    ["invalid_from_address", "definitive_permanent_failure"],
    ["invalid_idempotent_request", "unknown"],
    ["application_error", "unknown"],
    ["internal_server_error", "unknown"],
  ] as const)("conservatively classifies documented Resend error %s as %s", async (name, kind) => {
    const sendEmail = vi.fn<AgencyFollowupResendSend>().mockResolvedValue(rejected(name));
    const provider = createAgencyFollowupResendProvider({ env, sendEmail });
    const result = await provider.send(request);
    expect(result.kind).toBe(kind);
    if (result.kind === "definitive_retryable_failure" || result.kind === "definitive_permanent_failure") {
      expect(result.code).toBe(`resend_${name}`);
    }
  });

  it("quarantines transport exceptions without logging or exposing provider error text", async () => {
    const sendEmail = vi.fn<AgencyFollowupResendSend>().mockRejectedValue(new Error("synthetic socket reset with sensitive detail"));
    const provider = createAgencyFollowupResendProvider({ env, sendEmail });
    await expect(provider.send(request)).resolves.toEqual({
      kind: "unknown",
      detail: "resend_transport_outcome_unknown",
    });
  });

  it("quarantines malformed success and invalid acceptance time because acceptance may already have occurred", async () => {
    const malformed = { data: { id: " " }, error: null } as CreateEmailResponse;
    const missingId = createAgencyFollowupResendProvider({ env, sendEmail: vi.fn().mockResolvedValue(malformed) });
    await expect(missingId.send(request)).resolves.toEqual({
      kind: "unknown",
      detail: "resend_success_missing_provider_message_id",
    });

    const malformedResponse = createAgencyFollowupResendProvider({
      env,
      sendEmail: vi.fn().mockResolvedValue(undefined),
    });
    await expect(malformedResponse.send(request)).resolves.toEqual({
      kind: "unknown",
      detail: "resend_malformed_response",
    });

    const invalidClock = createAgencyFollowupResendProvider({
      env,
      sendEmail: vi.fn<AgencyFollowupResendSend>().mockResolvedValue(accepted()),
      now: () => new Date("invalid"),
    });
    await expect(invalidClock.send(request)).resolves.toEqual({
      kind: "unknown",
      detail: "resend_acceptance_timestamp_invalid",
    });

    const throwingClock = createAgencyFollowupResendProvider({
      env,
      sendEmail: vi.fn<AgencyFollowupResendSend>().mockResolvedValue(accepted()),
      now: () => { throw new Error("synthetic clock failure"); },
    });
    await expect(throwingClock.send(request)).resolves.toEqual({
      kind: "unknown",
      detail: "resend_acceptance_timestamp_invalid",
    });
  });

  it("blocks malformed logical identities before the SDK call", async () => {
    const sendEmail = vi.fn<AgencyFollowupResendSend>().mockResolvedValue(accepted());
    const provider = createAgencyFollowupResendProvider({ env, sendEmail });
    await expect(provider.send({ ...request, idempotencyKey: "other:enrollment-01:message-01" })).resolves.toEqual({
      kind: "blocked",
      blockers: ["logical_message_identity_invalid"],
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
