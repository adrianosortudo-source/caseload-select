import { describe, it, expect } from "vitest";
import {
  nextAttemptDelaySeconds,
  decideAttemptOutcome,
  DEFAULT_MAX_ATTEMPTS,
} from "../webhook-outbox-pure";

describe("nextAttemptDelaySeconds — exponential backoff with cap", () => {
  it("first retry waits 30s", () => {
    expect(nextAttemptDelaySeconds(0)).toBe(30);
  });

  it("each retry quadruples the delay", () => {
    expect(nextAttemptDelaySeconds(1)).toBe(120);    // 2 min
    expect(nextAttemptDelaySeconds(2)).toBe(480);    // 8 min
    expect(nextAttemptDelaySeconds(3)).toBe(1920);   // 32 min
  });

  it("attempt 4 lands at ~2h before the cap engages", () => {
    expect(nextAttemptDelaySeconds(4)).toBe(7_680); // 30s * 4^4 = 7,680s = 2h08m
  });

  it("caps at 6 hours (21,600s) so a long-stuck row stays retriable", () => {
    expect(nextAttemptDelaySeconds(5)).toBe(21_600);   // raw would be 30*1024 = 30,720s; capped
    expect(nextAttemptDelaySeconds(10)).toBe(21_600);
    expect(nextAttemptDelaySeconds(100)).toBe(21_600);
  });

  it("clamps negative attempt counts to 0", () => {
    expect(nextAttemptDelaySeconds(-5)).toBe(30);
  });
});

describe("decideAttemptOutcome — three branches", () => {
  it("success → sent", () => {
    const outcome = decideAttemptOutcome({
      fired: true,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    });
    expect(outcome.next).toBe("sent");
  });

  it("first failure with retries left → pending with future next_attempt_at", () => {
    const now = new Date("2026-05-05T12:00:00Z");
    const outcome = decideAttemptOutcome({
      fired: false,
      attempts: 0,
      maxAttempts: 5,
      now,
    });
    expect(outcome.next).toBe("pending");
    if (outcome.next === "pending") {
      expect(outcome.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("fourth failure with max=5 reschedules (still has one retry left)", () => {
    const outcome = decideAttemptOutcome({
      fired: false,
      attempts: 3,
      maxAttempts: 5,
    });
    expect(outcome.next).toBe("pending");
  });

  it("final attempt failure → failed (no retry)", () => {
    // attempts=4 means 4 failed tries already; this is the 5th. With max=5,
    // post-attempt count = 5, which equals max → failed.
    const outcome = decideAttemptOutcome({
      fired: false,
      attempts: 4,
      maxAttempts: 5,
    });
    expect(outcome.next).toBe("failed");
  });

  it("respects custom max_attempts", () => {
    expect(decideAttemptOutcome({ fired: false, attempts: 0, maxAttempts: 1 }).next).toBe("failed");
    expect(decideAttemptOutcome({ fired: false, attempts: 1, maxAttempts: 3 }).next).toBe("pending");
    expect(decideAttemptOutcome({ fired: false, attempts: 2, maxAttempts: 3 }).next).toBe("failed");
  });

  it("DEFAULT_MAX_ATTEMPTS is 5", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5);
  });
});
