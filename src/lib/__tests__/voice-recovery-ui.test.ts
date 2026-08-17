import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VoiceRecoveryCard } from "@/components/portal/VoiceRecoveryClient";
import {
  consentLabel,
  deriveRecoveryCounts,
  isSlaOverdue,
  recoveryDisplayStatus,
  recoveryExcerpt,
  recoveryReasonLabel,
  type VoiceRecoveryCase,
} from "@/lib/voice-recovery-ui";

function makeCase(overrides: Partial<VoiceRecoveryCase> = {}): VoiceRecoveryCase {
  return {
    id: "7c544d84-4d98-4030-83e0-9f40b05effd0",
    firm_id: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
    ghl_call_event_id: "call-123",
    ghl_contact_id: "contact-123",
    disposition: "unclear",
    recovery_reason: "unknown",
    status: "open",
    owner_name: null,
    sla_due_at: "2026-08-14T20:30:00.000Z",
    acknowledged_at: null,
    acknowledged_by: null,
    observed_caller_id: "+16479430547",
    spoken_callback_number: null,
    callback_number_verified: false,
    sms_consent: null,
    whatsapp_consent: null,
    messaging_consent_provenance: null,
    messaging_consent_at: null,
    caller_name: null,
    name_source: "none",
    message_excerpt: "I am looking for the owner of the business.",
    raw_transcript: "I am looking for the owner of the business.",
    transcript_source: "ghl_voice_ai",
    recording_url: null,
    urgency: "urgent",
    alert_status: "sent",
    delivery_state: "email_sent",
    follow_up_state: null,
    follow_up_count: 0,
    last_follow_up_at: null,
    last_follow_up_summary: null,
    promoted_screened_lead_id: null,
    created_at: "2026-08-14T19:24:00.000Z",
    updated_at: "2026-08-14T19:24:00.000Z",
    ...overrides,
  };
}

describe("voice recovery status", () => {
  it("keeps an ambiguous open caller separate from a screened lead", () => {
    expect(recoveryDisplayStatus(makeCase())).toBe("new");
    expect(consentLabel(null)).toBe("No messaging permission recorded");
  });

  it("gives promotion and resolution priority over follow-up state", () => {
    expect(recoveryDisplayStatus(makeCase({ follow_up_state: "attempted" }))).toBe("follow_up");
    expect(recoveryDisplayStatus(makeCase({ follow_up_state: "attempted", status: "resolved" }))).toBe("resolved");
    expect(recoveryDisplayStatus(makeCase({ promoted_screened_lead_id: "lead-db-id" }))).toBe("promoted");
  });

  it("derives the five operator-facing counts", () => {
    const cases = [
      makeCase({ id: "new" }),
      makeCase({ id: "ack", status: "acknowledged" }),
      makeCase({ id: "follow", follow_up_state: "completed" }),
      makeCase({ id: "resolved", status: "resolved" }),
      makeCase({ id: "promoted", promoted_screened_lead_id: "lead" }),
    ];
    expect(deriveRecoveryCounts(cases)).toEqual({
      new: 1,
      acknowledged: 1,
      follow_up: 1,
      resolved: 1,
      promoted: 1,
      total: 5,
    });
  });

  it("identifies an overdue open SLA but not a resolved one", () => {
    const now = new Date("2026-08-14T21:00:00.000Z");
    expect(isSlaOverdue(makeCase(), now)).toBe(true);
    expect(isSlaOverdue(makeCase({ status: "resolved" }), now)).toBe(false);
  });

  it("uses an evidence note first and truncates long excerpts", () => {
    const item = makeCase({ last_follow_up_summary: "Human callback completed", raw_transcript: "Transcript" });
    expect(recoveryExcerpt(item)).toBe("Human callback completed");
    expect(recoveryExcerpt(makeCase({ message_excerpt: null, raw_transcript: "a".repeat(20) }), 10)).toBe("aaaaaaa...");
  });

  it("labels recovery causes without exposing storage keys", () => {
    expect(recoveryReasonLabel("no_usable_transcript")).toBe("No usable transcript");
    expect(recoveryReasonLabel("integration_error")).toBe("Integration error");
  });
});

describe("VoiceRecoveryCard accessibility and doctrine", () => {
  const handlers = {
    onEdit: vi.fn(),
    onAcknowledge: vi.fn(),
    onClaim: vi.fn(),
    onFollowUp: vi.fn(),
    onResolve: vi.fn(),
    onPromote: vi.fn(),
  };

  it("labels evidence and exposes all operator decisions without calling the caller a lead", () => {
    const html = renderToStaticMarkup(createElement(VoiceRecoveryCard, {
      item: makeCase(),
      busy: false,
      editorMode: null,
      ...handlers,
    }));
    expect(html).toContain("Unknown caller");
    expect(html).toContain("Unclear intent");
    expect(html).toContain("Observed caller ID");
    expect(html).toContain("Spoken callback number");
    expect(html).toContain("No messaging permission recorded");
    expect(html).toContain("Acknowledge");
    expect(html).toContain("Claim");
    expect(html).toContain("Record follow-up");
    expect(html).toContain("Resolve non-lead");
    expect(html).toContain("Promote to Screen");
    expect(html).not.toContain("Qualified lead");
    expect(html).toMatch(/<article[^>]+aria-labelledby=/);
  });

  it("removes mutating controls after resolution", () => {
    const html = renderToStaticMarkup(createElement(VoiceRecoveryCard, {
      item: makeCase({ status: "resolved" }),
      busy: false,
      editorMode: null,
      ...handlers,
    }));
    expect(html).toContain("Resolved non-lead");
    expect(html).not.toContain("Promote to Screen");
    expect(html).not.toContain("Record follow-up");
  });
});
