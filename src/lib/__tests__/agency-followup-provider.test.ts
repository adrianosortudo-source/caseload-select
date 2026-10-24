import { describe, expect, it } from "vitest";
import {
  FakeAgencyFollowupProvider,
  runAgencyFollowupAttempt,
} from "../agency-followup-provider";
import {
  agencyFollowupContentHash,
  agencyFollowupRecipientHash,
  type AgencyFollowupSendContext,
} from "../agency-followup-domain";

const recipient = {
  prospectId: "synthetic-prospect-01",
  firmName: "Synthetic Firm",
  contactName: "Taylor Example",
  contactEmail: "taylor@example.test",
};
const content = { channel: "email" as const, subject: "Synthetic subject", body: "Synthetic body." };
const context: AgencyFollowupSendContext = {
  prospectId: recipient.prospectId,
  prospectStage: "contacted",
  recipient,
  contactability: "allowed",
  conversationStatus: "awaiting_reply",
  eligibility: "eligible",
  eligibilityEvidenceRef: "synthetic-evidence",
  optInState: "granted",
  sequenceReleased: true,
  messageApproved: true,
  approval: {
    approvedContentHash: agencyFollowupContentHash(content),
    approvedRecipientHash: agencyFollowupRecipientHash(recipient),
    reviewerId: "synthetic-operator",
    reviewedAt: "2026-10-12T15:00:00.000Z",
  },
  content,
  dueAt: "2026-10-12T14:00:00.000Z",
  now: "2026-10-12T15:00:00.000Z",
  previousAcceptedAt: null,
  minimumSpacingMs: 7 * 24 * 60 * 60 * 1000,
  cancelled: false,
};

describe("Agency follow-up fake provider", () => {
  it("does not call a provider when a fresh send-time gate blocks the message", async () => {
    const provider = new FakeAgencyFollowupProvider();
    const result = await runAgencyFollowupAttempt({
      enrollmentId: "enrollment-01",
      messageId: "message-01",
      context: { ...context, contactability: "unsubscribed" },
      provider,
    });
    expect(result.state).toBe("blocked");
    expect(result.blockers).toContain("contactability_blocked");
    expect(provider.uniqueIdempotencyKeysSeen).toBe(0);
  });

  it("returns the original provider acceptance for a repeated logical message key", async () => {
    const provider = new FakeAgencyFollowupProvider([
      { kind: "accepted", providerMessageId: "fake-acceptance-01", acceptedAt: "2026-10-12T15:00:01.000Z" },
    ]);
    const input = { enrollmentId: "enrollment-01", messageId: "message-01", context, provider };
    const first = await runAgencyFollowupAttempt(input);
    const repeated = await runAgencyFollowupAttempt(input);
    expect(first.state).toBe("accepted");
    expect(repeated).toEqual(first);
    expect(provider.uniqueIdempotencyKeysSeen).toBe(1);
  });

  it("quarantines an unknown provider result and never converts it to an automatic retry", async () => {
    const provider = new FakeAgencyFollowupProvider([
      { kind: "unknown", detail: "synthetic transport interruption after handoff" },
    ]);
    const input = { enrollmentId: "enrollment-02", messageId: "message-02", context, provider };
    const first = await runAgencyFollowupAttempt(input);
    const repeated = await runAgencyFollowupAttempt(input);
    expect(first.state).toBe("quarantine_unknown");
    expect(repeated.state).toBe("quarantine_unknown");
    expect(provider.uniqueIdempotencyKeysSeen).toBe(1);
  });
});
