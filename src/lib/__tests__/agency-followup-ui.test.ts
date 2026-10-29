import { describe, expect, it } from "vitest";
import { agencyFollowupDeliveryStatusLabel, canApproveAgencyFollowupMessage, formatAgencyFollowupScheduledAt } from "@/lib/agency-followup-ui";

describe("agency follow-up message approval action", () => {
  it("allows review when only approval and send timing are outstanding", () => {
    expect(canApproveAgencyFollowupMessage({
      messageState: "awaiting_review",
      sequenceReleased: true,
      blockers: ["message_not_approved", "approval_missing", "not_due", "minimum_spacing_not_elapsed", "outside_send_window"],
    })).toBe(true);
  });

  it("keeps hard eligibility and operations stops visible and blocks approval", () => {
    for (const blocker of ["eligibility_pending", "contactability_unknown", "contactability_blocked", "conversation_stopped", "prospect_status_stopped", "recipient_email_invalid"]) {
      expect(canApproveAgencyFollowupMessage({
        messageState: "awaiting_review",
        sequenceReleased: true,
        blockers: ["approval_missing", blocker],
      })).toBe(false);
    }
  });

  it("requires an individually released enrollment and a message awaiting review", () => {
    expect(canApproveAgencyFollowupMessage({ messageState: "awaiting_review", sequenceReleased: false, blockers: [] })).toBe(false);
    expect(canApproveAgencyFollowupMessage({ messageState: "approved", sequenceReleased: true, blockers: [] })).toBe(false);
  });
});

describe("agency follow-up delivery status label", () => {
  it("distinguishes the default status on unsent messages from an ambiguous dispatch", () => {
    for (const messageState of ["draft", "awaiting_review", "approved", "scheduled"]) {
      expect(agencyFollowupDeliveryStatusLabel({
        messageState,
        providerDeliveryStatus: "unknown",
      })).toBe("Not sent");
    }

    expect(agencyFollowupDeliveryStatusLabel({
      messageState: "claimed",
      providerDeliveryStatus: "unknown",
    })).toBe("Dispatch outcome pending");

    expect(agencyFollowupDeliveryStatusLabel({
      messageState: "unknown",
      providerDeliveryStatus: "unknown",
    })).toBe("Outcome unknown");
  });

  it("keeps provider reported statuses and their limits explicit", () => {
    expect(agencyFollowupDeliveryStatusLabel({ messageState: "accepted", providerDeliveryStatus: "accepted" }))
      .toBe("Accepted by provider");
    expect(agencyFollowupDeliveryStatusLabel({ messageState: "accepted", providerDeliveryStatus: "delivered" }))
      .toBe("Delivered per provider");
    expect(agencyFollowupDeliveryStatusLabel({ messageState: "accepted", providerDeliveryStatus: "suppressed" }))
      .toBe("Blocked by provider");
  });
});

describe("agency follow-up schedule display", () => {
  it("shows the exact scheduled instant in the journey timezone", () => {
    expect(formatAgencyFollowupScheduledAt("2026-10-29T02:00:00.000Z", "America/Toronto"))
      .toBe("2026-10-28 22:00");
  });

  it("fails visibly and safely for an invalid timestamp or timezone", () => {
    expect(formatAgencyFollowupScheduledAt("not-a-time", "America/Toronto")).toBe("scheduled time unavailable");
    expect(formatAgencyFollowupScheduledAt("2026-10-29T02:00:00.000Z", "Invalid/Timezone")).toBe("scheduled time unavailable");
  });
});
