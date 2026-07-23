/**
 * Tests for sendDeployAlarm, in particular the silent-skip fix: sendEmail
 * returns {skipped:true} rather than throwing when RESEND_API_KEY is
 * missing, so without an explicit check a dropped alarm would leave no
 * trace anywhere.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: mocks.sendEmail,
}));

import { sendDeployAlarm } from "../alarm";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendDeployAlarm", () => {
  it("sends the email and logs nothing on a normal successful send", async () => {
    mocks.sendEmail.mockResolvedValue({ skipped: false, id: "email_1" });

    await sendDeployAlarm("dpl_1", "test reason", {});

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs an explicit error when sendEmail silently skips (no RESEND_API_KEY)", async () => {
    mocks.sendEmail.mockResolvedValue({ skipped: true });

    await sendDeployAlarm("dpl_2", "git_dirty", {});

    expect(console.error).toHaveBeenCalledTimes(1);
    const [message] = (console.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toContain("SKIPPED");
    expect(message).toContain("dpl_2");
  });

  it("catches and logs when sendEmail throws, never propagates", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("resend down"));

    await expect(sendDeployAlarm("dpl_3", "checks_failed", {})).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("uses the standard subject when no options are passed", async () => {
    mocks.sendEmail.mockResolvedValue({ skipped: false, id: "email_4" });
    await sendDeployAlarm("dpl_4", "test reason", {});
    const [, subject, html] = mocks.sendEmail.mock.calls[0];
    expect(subject).toBe("[DEPLOY ALARM] Unverified production deployment dpl_4");
    expect(html).not.toContain("Synthetic test fire");
  });

  it("tags the subject and prepends the drill note when subjectTag is set", async () => {
    mocks.sendEmail.mockResolvedValue({ skipped: false, id: "email_5" });
    await sendDeployAlarm("dpl_5", "deployment metadata unavailable", {}, { subjectTag: "[TEST]" });
    const [, subject, html] = mocks.sendEmail.mock.calls[0];
    expect(subject).toBe("[DEPLOY ALARM][TEST] Unverified production deployment dpl_5");
    expect(html).toContain("Synthetic test fire (operator drill)");
  });
});
