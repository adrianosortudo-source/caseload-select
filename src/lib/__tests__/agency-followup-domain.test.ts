import { describe, expect, it } from "vitest";
import {
  agencyFollowupApprovalIsCurrent,
  agencyFollowupContentHash,
  agencyFollowupLogicalMessageKey,
  agencyFollowupRecipientHash,
  agencyFollowupRecipientEmailHash,
  agencyFollowupStepsHaveApprovedTemplates,
  evaluateAgencyFollowupSend,
  resolveAgencyProviderOutcome,
  type AgencyFollowupApprovalSnapshot,
  type AgencyFollowupMessageContent,
  type AgencyFollowupRecipientSnapshot,
  type AgencyFollowupSendContext,
} from "../agency-followup-domain";

const recipient: AgencyFollowupRecipientSnapshot = {
  prospectId: "prospect-001",
  firmName: "Synthetic Firm LLP",
  contactName: "Jordan Example",
  contactEmail: "jordan@example.test",
};
const content: AgencyFollowupMessageContent = {
  channel: "email",
  subject: "A follow-up question",
  body: "Hello Jordan,\n\nWould a short conversation be useful?",
};

function approvedSnapshot(
  nextRecipient: AgencyFollowupRecipientSnapshot = recipient,
  nextContent: AgencyFollowupMessageContent = content,
): AgencyFollowupApprovalSnapshot {
  return {
    approvedContentHash: agencyFollowupContentHash(nextContent),
    approvedRecipientHash: agencyFollowupRecipientHash(nextRecipient),
    reviewerId: "operator-001",
    reviewedAt: "2098-05-01T12:00:00.000Z",
  };
}

function readyContext(overrides: Partial<AgencyFollowupSendContext> = {}): AgencyFollowupSendContext {
  return {
    prospectId: recipient.prospectId,
    prospectStage: "contacted",
    recipient,
    contactability: "allowed",
    conversationStatus: "awaiting_reply",
    eligibility: "eligible",
    eligibilityEvidenceRef: "synthetic-evidence-001",
    optInState: "granted",
    sequenceReleased: true,
    messageApproved: true,
    approval: approvedSnapshot(),
    content,
    dueAt: "2098-05-01T11:00:00.000Z",
    now: "2098-05-01T12:00:00.000Z",
    previousAcceptedAt: null,
    minimumSpacingMs: 7 * 24 * 60 * 60 * 1000,
    cancelled: false,
    ...overrides,
  };
}

describe("Agency follow-up domain", () => {
  it("allows a reviewed, eligible, due message when every send-time gate passes", () => {
    expect(evaluateAgencyFollowupSend(readyContext())).toEqual([]);
  });

  it("invalidates message approval when content or recipient details change", () => {
    const approval = approvedSnapshot();
    expect(agencyFollowupApprovalIsCurrent(approval, content, recipient)).toBe(true);
    expect(
      agencyFollowupApprovalIsCurrent(approval, { ...content, body: content.body + " Updated." }, recipient),
    ).toBe(false);
    expect(
      agencyFollowupApprovalIsCurrent(approval, content, { ...recipient, contactEmail: "changed@example.test" }),
    ).toBe(false);
  });

  it("requires an approved reviewer identity and a valid review timestamp at send time", () => {
    expect(
      evaluateAgencyFollowupSend(
        readyContext({ approval: { ...approvedSnapshot(), reviewerId: "  " } }),
      ),
    ).toContain("approval_invalid_reviewer_or_time");
    expect(
      evaluateAgencyFollowupSend(
        readyContext({ approval: { ...approvedSnapshot(), reviewedAt: "not-a-time" } }),
      ),
    ).toContain("approval_invalid_reviewer_or_time");
  });

  it("hashes a normalized raw email exactly as the database validator does", () => {
    expect(agencyFollowupRecipientEmailHash(" Jordan@Example.test ")).toBe(
      "82a430687bf78d6812c1fb0c12180dbdb9f4e3ff537dba38e0895c47ea93622d",
    );
  });

  it("normalizes harmless recipient whitespace and email casing in the approval fingerprint", () => {
    expect(agencyFollowupRecipientHash(recipient)).toBe(
      agencyFollowupRecipientHash({
        ...recipient,
        firmName: "  Synthetic   Firm LLP ",
        contactEmail: "JORDAN@EXAMPLE.TEST",
      }),
    );
  });

  it("allows multiple journey steps to reuse one approved template and rejects any unapproved reference", () => {
    expect(agencyFollowupStepsHaveApprovedTemplates(["template-1", "template-1"], ["template-1"])).toBe(true);
    expect(agencyFollowupStepsHaveApprovedTemplates(["template-1", "template-2"], ["template-1"])).toBe(false);
  });

  it("fails closed on missing eligibility evidence, suppression, reply, unapproved message, and changed recipient", () => {
    const blockers = evaluateAgencyFollowupSend(
      readyContext({
        eligibilityEvidenceRef: null,
        contactability: "unsubscribed",
        conversationStatus: "replied",
        messageApproved: false,
        recipient: { ...recipient, contactEmail: "new@example.test" },
      }),
    );
    expect(blockers).toEqual(
      expect.arrayContaining([
        "eligibility_evidence_missing",
        "contactability_blocked",
        "conversation_stopped",
        "message_not_approved",
        "approval_stale_recipient",
      ]),
    );
  });

  it("requires the latest exact opt-in event to be granted", () => {
    expect(evaluateAgencyFollowupSend(readyContext({ optInState: "missing" })))
      .toContain("explicit_opt_in_missing");
    expect(evaluateAgencyFollowupSend(readyContext({ optInState: "withdrawn" })))
      .toContain("explicit_opt_in_withdrawn");
    expect(evaluateAgencyFollowupSend(readyContext({ optInState: "granted" })))
      .not.toContain("explicit_opt_in_missing");
  });

  it("blocks a message until due and until the minimum spacing from provider acceptance has elapsed", () => {
    const spacingMs = 7 * 24 * 60 * 60 * 1000;
    expect(
      evaluateAgencyFollowupSend(
        readyContext({ dueAt: "2098-05-02T12:00:00.000Z", previousAcceptedAt: "2098-04-30T12:00:00.000Z" }),
      ),
    ).toEqual(expect.arrayContaining(["not_due", "minimum_spacing_not_elapsed"]));
    expect(
      evaluateAgencyFollowupSend(
        readyContext({ previousAcceptedAt: new Date(Date.parse("2098-05-01T12:00:00.000Z") - spacingMs).toISOString() }),
      ),
    ).toEqual([]);
  });

  it("requires dispatch to remain inside the configured local business-day window", () => {
    const schedulePolicy = {
      timezone: "America/Toronto",
      businessDays: [1, 2, 3, 4, 5],
      localWindowStart: "09:00",
      localWindowEnd: "17:00",
    };
    expect(evaluateAgencyFollowupSend(readyContext({
      now: "2026-10-13T18:00:00.000Z", // 14:00 Toronto, Tuesday
      dueAt: "2026-10-13T13:00:00.000Z",
      schedulePolicy,
    }))).toEqual([]);
    expect(evaluateAgencyFollowupSend(readyContext({
      now: "2026-10-17T16:00:00.000Z", // Saturday in Toronto
      dueAt: "2026-10-13T13:00:00.000Z",
      schedulePolicy,
    }))).toContain("outside_send_window");
    expect(evaluateAgencyFollowupSend(readyContext({
      now: "2026-10-13T21:00:00.000Z", // 17:00 Toronto, end is exclusive
      dueAt: "2026-10-13T13:00:00.000Z",
      schedulePolicy,
    }))).toContain("outside_send_window");
  });

  it("uses stable logical message keys and never blindly retries an unknown provider outcome", () => {
    expect(agencyFollowupLogicalMessageKey("enrollment-1", "message-2")).toBe(
      agencyFollowupLogicalMessageKey(" enrollment-1 ", " message-2 "),
    );
    expect(resolveAgencyProviderOutcome({ kind: "unknown", detail: "connection closed" })).toBe(
      "quarantine_unknown",
    );
    expect(resolveAgencyProviderOutcome({ kind: "definitive_retryable_failure", code: "rate_limited" })).toBe(
      "retry_same_key",
    );
    expect(resolveAgencyProviderOutcome({ kind: "accepted", providerMessageId: "fake-1", acceptedAt: "2098-05-01T12:00:00Z" })).toBe("accepted");
  });
});
