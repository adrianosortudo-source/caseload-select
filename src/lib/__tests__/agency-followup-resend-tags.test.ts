import { describe, expect, it, vi } from "vitest";
import type { CreateEmailResponse } from "resend";
import {
  createAgencyFollowupResendProvider,
  type AgencyFollowupResendSend,
} from "../agency-followup-resend-provider";

const enrollmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const messageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = {
  idempotencyKey: `agency-followup:${enrollmentId}:${messageId}`,
  recipientEmail: "owner@example.test",
  subject: "Approved subject",
  body: "Approved body",
};
const env = {
  AGENCY_FOLLOWUP_SEND_MODE: "test",
  AGENCY_FOLLOWUP_FROM: "CaseLoad Select <noreply@caseloadselect.ca>",
  AGENCY_FOLLOWUP_REPLY_TO: "support@caseloadselect.ca",
  RESEND_API_KEY: "synthetic-api-key-never-used-for-network",
  AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET: "whsec_synthetic-never-used-for-network",
  AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST: "owner@example.test",
  AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST: JSON.stringify([
    { enrollmentId, messageId, recipientEmail: "owner@example.test" },
  ]),
};

function accepted(): CreateEmailResponse {
  return { data: { id: "re_synthetic_message_01" }, error: null };
}

describe("Agency follow-up Resend identity tags", () => {
  it("sends the exact stable enrollment/message UUID tags alongside the stable idempotency key", async () => {
    const sendEmail = vi.fn<AgencyFollowupResendSend>().mockResolvedValue(accepted());
    const provider = createAgencyFollowupResendProvider({ env, sendEmail });

    await provider.send(request);
    await provider.send(request);

    expect(sendEmail).toHaveBeenCalledTimes(2);
    for (const [payload, options] of sendEmail.mock.calls) {
      expect(payload.tags).toEqual([
        { name: "agency_followup_message_id", value: messageId },
        { name: "agency_followup_enrollment_id", value: enrollmentId },
      ]);
      expect(options).toEqual({ idempotencyKey: request.idempotencyKey });
    }
  });

  it("blocks a noncanonical logical identity before provider handoff", async () => {
    const sendEmail = vi.fn<AgencyFollowupResendSend>().mockResolvedValue(accepted());
    const provider = createAgencyFollowupResendProvider({ env, sendEmail });

    await expect(provider.send({
      ...request,
      idempotencyKey: `agency-followup:${enrollmentId}:message-not-a-uuid`,
    })).resolves.toEqual({ kind: "blocked", blockers: ["logical_message_identity_invalid"] });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
