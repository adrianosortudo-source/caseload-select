import { describe, it, expect } from "vitest";
import { evaluateGate, requiresGate } from "../verify";

describe("requiresGate", () => {
  it("gates production targets", () => {
    expect(requiresGate({ target: "production" })).toBe(true);
  });

  it("does not gate preview targets", () => {
    expect(requiresGate({ target: "preview" })).toBe(false);
    expect(requiresGate({ target: null })).toBe(false);
  });
});

describe("evaluateGate", () => {
  const cleanMeta = {
    target: "production",
    githubCommitSha: "abc123",
    githubOrg: "adrianosortudo-source",
    githubRepo: "caseload-select",
  };

  it("passes non-production deployments unconditionally", () => {
    expect(evaluateGate({ target: "preview" }, null)).toEqual({ pass: true, reason: "not_production" });
  });

  it("fails a dirty-tree deployment even with green check runs for the parent sha", () => {
    const decision = evaluateGate({ ...cleanMeta, gitDirty: "1" }, [{ completed: true, success: true }]);
    expect(decision).toEqual({ pass: false, reason: "git_dirty" });
  });

  it("fails a deployment with no traceable git source", () => {
    expect(evaluateGate({ target: "production" }, [{ completed: true, success: true }])).toEqual({
      pass: false,
      reason: "no_git_source",
    });
  });

  it("fails closed when no check runs exist yet", () => {
    expect(evaluateGate(cleanMeta, null)).toEqual({ pass: false, reason: "no_check_runs" });
    expect(evaluateGate(cleanMeta, [])).toEqual({ pass: false, reason: "no_check_runs" });
  });

  it("fails while checks are still running", () => {
    const decision = evaluateGate(cleanMeta, [
      { completed: true, success: true },
      { completed: false, success: false },
    ]);
    expect(decision).toEqual({ pass: false, reason: "checks_pending" });
  });

  it("fails when a completed check did not succeed", () => {
    const decision = evaluateGate(cleanMeta, [
      { completed: true, success: true },
      { completed: true, success: false },
    ]);
    expect(decision).toEqual({ pass: false, reason: "checks_failed" });
  });

  it("passes a clean commit with all check runs green", () => {
    const decision = evaluateGate(cleanMeta, [
      { completed: true, success: true },
      { completed: true, success: true },
    ]);
    expect(decision).toEqual({ pass: true, reason: "checks_green" });
  });
});
