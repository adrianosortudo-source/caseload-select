import { describe, it, expect } from "vitest";
import {
  isReminderDue,
  buildDeadlineReminderEmail,
  REMINDER_WINDOW_MS,
  MIN_ROW_AGE_MS,
  type ReminderCandidateRow,
} from "@/lib/deadline-reminder-pure";

const NOW = new Date("2026-07-02T18:00:00.000Z");

function row(overrides: Partial<ReminderCandidateRow> = {}): ReminderCandidateRow {
  return {
    status: "triaging",
    deadline_reminder_sent_at: null,
    // 36h old, deadline in 11h: the canonical 48h-window case at T-11h.
    created_at: new Date(NOW.getTime() - 36 * 3600_000).toISOString(),
    decision_deadline: new Date(NOW.getTime() + 11 * 3600_000).toISOString(),
    ...overrides,
  };
}

describe("isReminderDue", () => {
  it("fires for a 48h-window lead at T-11h", () => {
    expect(isReminderDue(row(), NOW)).toBe(true);
  });

  it("does not fire before the window opens (deadline 13h out)", () => {
    expect(
      isReminderDue(
        row({ decision_deadline: new Date(NOW.getTime() + 13 * 3600_000).toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });

  it("does not fire past the deadline (backstop territory)", () => {
    expect(
      isReminderDue(
        row({ decision_deadline: new Date(NOW.getTime() - 60_000).toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });

  it("does not fire on a fresh lead (12h-deadline row created just now)", () => {
    expect(
      isReminderDue(
        row({
          created_at: new Date(NOW.getTime() - 3600_000).toISOString(),
          decision_deadline: new Date(NOW.getTime() + 11 * 3600_000).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("fires for a 24h-window lead exactly at the minimum age", () => {
    expect(
      isReminderDue(
        row({
          created_at: new Date(NOW.getTime() - MIN_ROW_AGE_MS).toISOString(),
          decision_deadline: new Date(NOW.getTime() + REMINDER_WINDOW_MS).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("does not fire twice", () => {
    expect(
      isReminderDue(row({ deadline_reminder_sent_at: NOW.toISOString() }), NOW),
    ).toBe(false);
  });

  it("does not fire on non-triaging rows", () => {
    expect(isReminderDue(row({ status: "taken" }), NOW)).toBe(false);
    expect(isReminderDue(row({ status: "declined" }), NOW)).toBe(false);
  });

  it("does not fire without a deadline", () => {
    expect(isReminderDue(row({ decision_deadline: null }), NOW)).toBe(false);
  });
});

describe("buildDeadlineReminderEmail", () => {
  const input = {
    firmName: "DRG Law Professional Corporation",
    contactName: "Sarah Chen",
    matterType: "wrongful_dismissal",
    practiceArea: "employment",
    band: "B" as const,
    decisionDeadlineIso: new Date(NOW.getTime() + 11 * 3600_000).toISOString(),
    briefUrl: "https://app.caseloadselect.ca/portal/f1/triage/L-2026-07-02-ABC",
    channel: "whatsapp",
    now: NOW,
  };

  it("prefixes the new-lead subject with [Reminder]", () => {
    const email = buildDeadlineReminderEmail(input);
    expect(email.subject.startsWith("[Reminder] Priority B")).toBe(true);
    expect(email.subject).toContain("Sarah");
    expect(email.subject).toContain("(via WhatsApp)");
  });

  it("body carries the remaining time, band line, and brief link", () => {
    const email = buildDeadlineReminderEmail(input);
    expect(email.html).toContain("11h");
    expect(email.html).toContain("Priority B");
    expect(email.html).toContain(input.briefUrl);
    expect(email.html).toContain("Decision window closing");
  });

  it("Band D copy offers Refer and says passed, not declined", () => {
    const email = buildDeadlineReminderEmail({ ...input, band: "D" });
    expect(email.html).toContain("or Refer");
    expect(email.html).toContain("marks it passed");
  });

  it("escapes HTML in lead-supplied fields", () => {
    const email = buildDeadlineReminderEmail({
      ...input,
      contactName: '<script>x</script> Chen',
    });
    expect(email.html).not.toContain("<script>x</script>");
  });

  it("falls back cleanly when contact name is missing", () => {
    const email = buildDeadlineReminderEmail({ ...input, contactName: null });
    expect(email.subject).toContain("this lead");
  });
});
