import { describe, expect, it } from "vitest";
import {
  parseAgencyFollowupLogicalKey,
  resolveAgencyFollowupSendConfig,
} from "../agency-followup-send-config";

const configured = {
  AGENCY_FOLLOWUP_SEND_MODE: "test",
  AGENCY_FOLLOWUP_FROM: "CaseLoad Select <noreply@caseloadselect.ca>",
  AGENCY_FOLLOWUP_REPLY_TO: "support@caseloadselect.ca",
  RESEND_API_KEY: "synthetic-api-key",
  AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET: "synthetic-webhook-secret",
  AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST: "owner@example.test",
  AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST: JSON.stringify([
    { enrollmentId: "enrollment-01", messageId: "message-01", recipientEmail: "owner@example.test" },
  ]),
};

describe("Agency follow-up send configuration", () => {
  it("defaults missing, blank, and invalid modes to off", () => {
    for (const value of [undefined, "", "production", " true "]) {
      const config = resolveAgencyFollowupSendConfig({ ...configured, AGENCY_FOLLOWUP_SEND_MODE: value });
      expect(config.mode).toBe("off");
      expect(config.ready).toBe(false);
      expect(config.authorize({
        enrollmentId: "enrollment-01",
        messageId: "message-01",
        recipientEmail: "owner@example.test",
      })).toEqual(["send_mode_off"]);
    }
  });

  it("requires both an exact test recipient and the exact enrollment/message/recipient triple", () => {
    const config = resolveAgencyFollowupSendConfig(configured);
    expect(config.ready).toBe(true);
    expect(config.maxBatchSize).toBe(1);
    expect(config.authorize({ enrollmentId: "enrollment-01", messageId: "message-01", recipientEmail: "owner@example.test" })).toEqual([]);
    expect(config.authorize({ enrollmentId: "enrollment-01", messageId: "message-02", recipientEmail: "owner@example.test" })).toContain("test_enrollment_message_recipient_not_allowlisted");
    expect(config.authorize({ enrollmentId: "enrollment-01", messageId: "message-01", recipientEmail: "other@example.test" })).toEqual([
      "test_recipient_not_allowlisted",
      "test_enrollment_message_recipient_not_allowlisted",
    ]);
    expect(config.authorize({ enrollmentId: " enrollment-01", messageId: "message-01", recipientEmail: "owner@example.test" })).toContain("send_target_invalid");
  });

  it("fails closed for missing key, missing allowlists, invalid sender, or unmonitored reply routing", () => {
    const variants = [
      { RESEND_API_KEY: "" },
      { AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET: "" },
      { AGENCY_FOLLOWUP_TEST_RECIPIENT_ALLOWLIST: "" },
      { AGENCY_FOLLOWUP_TEST_RECORD_ALLOWLIST: "not-json" },
      { AGENCY_FOLLOWUP_FROM: "CaseLoad Select <noreply@unverified.example>" },
      { AGENCY_FOLLOWUP_REPLY_TO: "noreply@caseloadselect.ca\r\nBcc: attacker@example.test" },
    ];
    for (const variant of variants) {
      const config = resolveAgencyFollowupSendConfig({ ...configured, ...variant });
      expect(config.ready).toBe(false);
      expect(config.blockers.length).toBeGreaterThan(0);
      expect(config.authorize({ enrollmentId: "enrollment-01", messageId: "message-01", recipientEmail: "owner@example.test" })).toEqual(config.blockers);
    }
  });

  it("requires a non-empty exact live enrollment allowlist and permits only listed enrollments", () => {
    const live = {
      AGENCY_FOLLOWUP_SEND_MODE: "live",
      AGENCY_FOLLOWUP_FROM: configured.AGENCY_FOLLOWUP_FROM,
      AGENCY_FOLLOWUP_REPLY_TO: configured.AGENCY_FOLLOWUP_REPLY_TO,
      RESEND_API_KEY: configured.RESEND_API_KEY,
      AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET: configured.AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET,
      AGENCY_FOLLOWUP_LIVE_ENROLLMENT_ALLOWLIST: "enrollment-live-01",
    };
    const config = resolveAgencyFollowupSendConfig(live);
    expect(config.ready).toBe(true);
    expect(config.maxBatchSize).toBe(1);
    expect(config.authorize({ enrollmentId: "enrollment-live-01", messageId: "message-99", recipientEmail: "firm@example.test" })).toEqual([]);
    expect(config.authorize({ enrollmentId: "enrollment-live-02", messageId: "message-99", recipientEmail: "firm@example.test" })).toEqual([
      "live_enrollment_not_allowlisted",
    ]);
    expect(resolveAgencyFollowupSendConfig({ ...live, AGENCY_FOLLOWUP_LIVE_ENROLLMENT_ALLOWLIST: "" }).ready).toBe(false);
  });

  it("parses only the bounded, exact logical-message-key format", () => {
    expect(parseAgencyFollowupLogicalKey("agency-followup:enrollment-01:message-01")).toEqual({
      enrollmentId: "enrollment-01",
      messageId: "message-01",
    });
    expect(parseAgencyFollowupLogicalKey("agency-followup:enrollment-01:message:extra")).toBeNull();
    expect(parseAgencyFollowupLogicalKey("wrong-prefix:enrollment-01:message-01")).toBeNull();
    expect(parseAgencyFollowupLogicalKey(`agency-followup:${"e".repeat(240)}:message-01`)).toBeNull();
  });
});
