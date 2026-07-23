/**
 * Tests for evaluateAndAlarm, the background alarm loop for a single
 * production deployment (issue #61 detection layer).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getDeploymentInfo: vi.fn(),
  fetchCheckRuns: vi.fn(),
  sendDeployAlarm: vi.fn(),
}));

vi.mock("../vercel-api", () => ({
  getDeploymentInfo: mocks.getDeploymentInfo,
}));

vi.mock("../github-status", () => ({
  fetchCheckRuns: mocks.fetchCheckRuns,
}));

vi.mock("../alarm", () => ({
  sendDeployAlarm: mocks.sendDeployAlarm,
}));

import { evaluateAndAlarm } from "../resolve";

const CLEAN_INFO = {
  id: "dpl_1",
  target: "production",
  meta: {
    githubCommitSha: "abc123",
    githubOrg: "adrianosortudo-source",
    githubRepo: "caseload-select",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendDeployAlarm.mockResolvedValue(undefined);
});

describe("evaluateAndAlarm", () => {
  it("alarms immediately on a dirty deployment without polling GitHub", async () => {
    mocks.getDeploymentInfo.mockResolvedValue({
      ...CLEAN_INFO,
      meta: { ...CLEAN_INFO.meta, gitDirty: "1" },
    });

    await evaluateAndAlarm("dpl_dirty");

    expect(mocks.sendDeployAlarm).toHaveBeenCalledTimes(1);
    const [deploymentId, reason] = mocks.sendDeployAlarm.mock.calls[0];
    expect(deploymentId).toBe("dpl_dirty");
    expect(reason).toContain("uncommitted changes");
    expect(mocks.fetchCheckRuns).not.toHaveBeenCalled();
  });

  it("alarms when there is no traceable githubCommitSha", async () => {
    mocks.getDeploymentInfo.mockResolvedValue({
      id: "dpl_2",
      target: "production",
      meta: {},
    });

    await evaluateAndAlarm("dpl_no_sha");

    expect(mocks.sendDeployAlarm).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCheckRuns).not.toHaveBeenCalled();
  });

  it("does not alarm a clean deployment with green checks", async () => {
    mocks.getDeploymentInfo.mockResolvedValue(CLEAN_INFO);
    mocks.fetchCheckRuns.mockResolvedValue([{ completed: true, success: true }]);

    await evaluateAndAlarm("dpl_clean");

    expect(mocks.sendDeployAlarm).not.toHaveBeenCalled();
  });

  it("alarms when GitHub checks complete but fail", async () => {
    mocks.getDeploymentInfo.mockResolvedValue(CLEAN_INFO);
    mocks.fetchCheckRuns.mockResolvedValue([{ completed: true, success: false }]);

    await evaluateAndAlarm("dpl_failed_ci");

    expect(mocks.sendDeployAlarm).toHaveBeenCalledTimes(1);
    const [deploymentId, reason] = mocks.sendDeployAlarm.mock.calls[0];
    expect(deploymentId).toBe("dpl_failed_ci");
    expect(reason).toContain("failed");
  });

  it("alarms when deployment metadata cannot be fetched", async () => {
    mocks.getDeploymentInfo.mockResolvedValue(null);

    await evaluateAndAlarm("dpl_missing");

    expect(mocks.sendDeployAlarm).toHaveBeenCalledTimes(1);
    const [deploymentId, reason] = mocks.sendDeployAlarm.mock.calls[0];
    expect(deploymentId).toBe("dpl_missing");
    expect(reason).toBe("deployment metadata unavailable");
  });

  it("threads options through to the alarm on metadata-unavailable", async () => {
    mocks.getDeploymentInfo.mockResolvedValue(null);
    await evaluateAndAlarm("dpl_test_fire", { subjectTag: "[TEST]" });
    expect(mocks.sendDeployAlarm).toHaveBeenCalledTimes(1);
    const call = mocks.sendDeployAlarm.mock.calls[0];
    expect(call[0]).toBe("dpl_test_fire");
    expect(call[3]).toEqual({ subjectTag: "[TEST]" });
  });
});
