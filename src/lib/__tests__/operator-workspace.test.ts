import { beforeEach, describe, expect, it } from "vitest";
import {
  isSafeWorkspaceDestination,
  makeOperatorWorkspaceCookie,
  verifyOperatorWorkspaceValue,
} from "../operator-workspace";

const FIRM = "11111111-1111-4111-8111-111111111111";

describe("operator workspace context", () => {
  beforeEach(() => {
    process.env.PORTAL_SECRET = "workspace-test-secret";
  });

  it("round-trips a signed firm-bound operator context", () => {
    const cookie = makeOperatorWorkspaceCookie({ operatorId: "operator-1", firmId: FIRM, ttlSeconds: 60 });
    expect(verifyOperatorWorkspaceValue(cookie.value)).toMatchObject({ operator_id: "operator-1", firm_id: FIRM });
    expect(verifyOperatorWorkspaceValue(`${cookie.value}tampered`)).toBeNull();
  });

  it("rejects unsafe and cross-firm destinations", () => {
    expect(isSafeWorkspaceDestination(`/portal/${FIRM}/deliverables`, FIRM)).toBe(true);
    expect(isSafeWorkspaceDestination("https://evil.example", FIRM)).toBe(false);
    expect(isSafeWorkspaceDestination(`/portal/other/triage`, FIRM)).toBe(false);
    expect(isSafeWorkspaceDestination(`//evil.example/${FIRM}`, FIRM)).toBe(false);
    expect(isSafeWorkspaceDestination(`/portal/${FIRM}\\evil`, FIRM)).toBe(false);
  });
});
